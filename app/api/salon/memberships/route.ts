import { NextRequest, NextResponse } from 'next/server'
import { can } from '@/lib/rbac'
import { appOrigin, badRequest, loadSalonSettings, salonAccess, serverError } from '@/lib/salon/server'
import { resolveRange, rangeBounds } from '@/lib/salon/ranges'
import { adjustCard, cardsForCustomer, loadCard, loadPlans, savePlan } from '@/lib/salon/membership-store'
import { cardState, membershipReport, withMembershipSchema } from '@/lib/salon/memberships'
import { cardLink, cardMessage, sendCustomerText } from '@/lib/salon/whatsapp'
import { isUuid } from '@/lib/record-visibility'

export const runtime = 'nodejs'

const read = async (query: PromiseLike<any>) => {
  const { data, error } = await withMembershipSchema(() => query)
  if (error) throw new Error(error.message)
  return data
}

/**
 * GET ?organizationId&view=
 *   plans                       the plans (anyone at the counter, to sell them)
 *   cards&q&state               cards, newest first; state = active | expiring | expired | cancelled
 *   card&id                     one card with its history
 *   customer&contact_id|phone   the cards a customer can use today (for billing)
 *   report&preset&from&to       numbers for the period (managers)
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const access = await salonAccess(request, url.searchParams.get('organizationId'))
  if (!access.ok) return access.response
  const { db, organizationId } = access.ctx
  const view = url.searchParams.get('view') || 'cards'
  const origin = appOrigin(request)
  try {
    if (view === 'plans') return NextResponse.json({ plans: await loadPlans(db, organizationId) })
    if (view === 'customer') {
      const cards = await cardsForCustomer(db, organizationId, { contact_id: url.searchParams.get('contact_id'), phone: url.searchParams.get('phone') })
      return NextResponse.json({ cards })
    }
    if (view === 'card') {
      const card = await loadCard(db, organizationId, String(url.searchParams.get('id') || ''))
      if (!card) return NextResponse.json({ error: 'That card was not found.' }, { status: 404 })
      const usage = await read(db.from('salon_membership_usage').select('*').eq('organization_id', organizationId).eq('membership_id', card.id).order('created_at', { ascending: false }).limit(100))
      return NextResponse.json({ card, usage: usage || [], link: cardLink(origin, card.public_token) })
    }
    if (view === 'report') {
      if (!can(access.ctx.user, 'automation.manage')) return NextResponse.json({ error: 'Only managers and admins see membership reports.' }, { status: 403 })
      const range = resolveRange(url.searchParams.get('preset'), url.searchParams.get('from'), url.searchParams.get('to'))
      const { start, end } = rangeBounds(range)
      const [cards, usage, plans] = await Promise.all([
        read(db.from('salon_memberships').select('id, plan, status, starts_at, expires_at, credit_balance, sessions').eq('organization_id', organizationId).limit(5000)),
        read(db.from('salon_membership_usage').select('membership_id, kind, amount, sessions, created_at').eq('organization_id', organizationId).gte('created_at', start).lt('created_at', end).limit(10000)),
        loadPlans(db, organizationId),
      ])
      const recent = await read(db.from('salon_membership_usage').select('*, salon_memberships(card_number, customer_name)').eq('organization_id', organizationId).gte('created_at', start).lt('created_at', end).order('created_at', { ascending: false }).limit(100))
      return NextResponse.json({ range, report: membershipReport(cards || [], usage || [], plans), recent: recent || [] })
    }
    // cards
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 60)
    const state = String(url.searchParams.get('state') || '')
    let query = db.from('salon_memberships').select('*').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(300)
    if (q) {
      const digits = q.replace(/\D/g, '')
      const safe = q.replace(/[%,()*]/g, ' ')
      query = digits.length >= 4 ? query.like('customer_phone', `%${digits.slice(-10)}%`) : query.or(`customer_name.ilike.%${safe}%,card_number.ilike.%${safe}%`)
    }
    let cards = (await read(query)) || []
    const now = new Date()
    if (state) cards = cards.filter((card: any) => cardState(card, now) === state || (state === 'active' && cardState(card, now) === 'expiring'))
    return NextResponse.json({ cards })
  } catch (error: any) {
    return serverError('Memberships', error)
  }
}

/**
 * POST { organizationId, action }
 *   save_plan { plan }                      add or change a plan (managers)
 *   plan_active { plan_id, active }         take a plan off sale or back on (managers)
 *   adjust { card_id, change }              extend, add credit / sessions, cancel (managers)
 *   send_card { card_id }                   send the card's link on WhatsApp (anyone at the counter)
 * Selling a card and using one on a bill are counter actions (/api/salon/act).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const action = body?.action || {}
  const manager = ['save_plan', 'plan_active', 'adjust'].includes(action.type)
  const access = await salonAccess(request, body?.organizationId, manager ? 'automation.manage' : 'records.write')
  if (!access.ok) return access.response
  const { db, organizationId } = access.ctx
  const userId = access.ctx.user?.id || null
  try {
    switch (action.type) {
      case 'save_plan':
        return NextResponse.json({ plan: await savePlan(db, organizationId, action.plan) })
      case 'plan_active': {
        if (!isUuid(action.plan_id)) return badRequest('Choose a plan.')
        const plan = await read(db.from('salon_membership_plans').update({ active: action.active !== false, updated_at: new Date().toISOString() }).eq('id', action.plan_id).eq('organization_id', organizationId).select('*').maybeSingle())
        if (!plan) return badRequest('That plan was not found.')
        return NextResponse.json({ plan })
      }
      case 'adjust': {
        const change = action.change || {}
        if (!['extend', 'credit', 'sessions', 'cancel'].includes(change.type)) return badRequest('Unknown change.')
        const card = await adjustCard(db, organizationId, String(action.card_id || ''), change, userId)
        return NextResponse.json({ card })
      }
      case 'send_card': {
        const card = await loadCard(db, organizationId, String(action.card_id || ''))
        if (!card) return badRequest('That card was not found.')
        if (!card.customer_phone) return badRequest('This customer has no phone number.')
        const settings = await loadSalonSettings(db, organizationId)
        const whatsapp = await sendCustomerText(db, organizationId, card.customer_phone, cardMessage(card, settings.business_name, cardLink(appOrigin(request), card.public_token)))
        return NextResponse.json({ whatsapp })
      }
      default:
        return badRequest('Unknown action.')
    }
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'That could not be done. Please try again.' }, { status: 400 })
  }
}
