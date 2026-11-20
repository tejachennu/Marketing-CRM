import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { getAiAccess } from '@/lib/ai-access'
import { answerFromKnowledge } from '@/lib/ai/faq-answer'
import { recordKnowledgeGap } from '@/lib/ai/knowledge-store'
import { asksAboutBooking, deskFacts, detailsGiven, serviceHits } from '@/lib/ai/site-assistant'
import { cleanChatHistory } from '@/lib/commerce/store-chat'
import { checkRateLimit } from '@/lib/rate-limiter'
import { holdsTime } from '@/lib/salon/availability'
import { paymentNote } from '@/lib/salon/booking-pay'
import { formatIstDay, formatIstTime, istDate } from '@/lib/salon/spoken'
import { openStatus, weekRows } from '@/lib/salon/website'
import { loadSite, type SiteData } from '@/lib/salon/website-store'

export const runtime = 'nodejs'
export const maxDuration = 60

const STATUS_WORDS: Record<string, string> = {
  booked: 'Confirmed', requested: 'Waiting for the shop to confirm', arrived: 'Checked in', in_service: 'In progress', awaiting_payment: 'Waiting for your payment',
}

/** The business's Front Desk data as facts for the AI. */
function factsFor(data: SiteData): string {
  const hours = data.page.setup.settings
  return deskFacts({
    business: data.view.business, address: data.view.address, phone: data.view.phone, hours: data.view.hours,
    openNow: openStatus(hours).text, week: weekRows(hours).map((w) => ({ day: w.day, time: w.time })),
    services: data.view.services, staff: data.view.staff, approval: data.view.approval, pay: data.view.pay,
    plans: data.site.show.memberships ? data.plans.map((p: any) => ({ name: p.name, price: Number(p.price) || 0, validity_days: Number(p.validity_days) || 0, discount_percent: Number(p.discount_percent) || 0, credit: Number(p.credit) || 0, sessions: Array.isArray(p.sessions) ? p.sessions : [] })) : [],
    about: data.site.about, rating: data.count ? { average: data.average, count: data.count } : undefined, showPrices: data.site.show.prices,
  })
}

/** A customer's upcoming visits, by the phone they booked with and their first name (both must match). */
async function upcomingVisits(db: any, data: SiteData, phone: string, name: string) {
  const digits = phone.replace(/\D/g, '').slice(-10)
  if (digits.length !== 10 || !name) return []
  const { data: rows } = await db.from('salon_appointments').select('*').eq('organization_id', data.page.organization.id)
    .like('customer_phone', `%${digits}`).gte('starts_at', new Date(Date.now() - 2 * 60 * 60_000).toISOString()).order('starts_at').limit(10)
  const first = name.trim().toLowerCase()
  return (rows || []).filter((a: any) => String(a.customer_name || '').trim().toLowerCase().split(/\s+/)[0] === first && holdsTime(a) && STATUS_WORDS[a.status]).slice(0, 3)
}

const reply = (body: Record<string, unknown>) => NextResponse.json({ services: [], buttons: [], attachments: [], handoff: false, ...body })

/**
 * POST { message, history }: the Front Desk website's AI chat (Front Desk → Setup → Website and booking → AI chat).
 *   - "My booking": answered from the bookings themselves (phone + first name must match), never by the AI.
 *   - Anything else: answered from every service with its price and length, hours, team, memberships, how booking
 *     and paying work, and the Knowledge Base; services it talks about come as cards with Book. Amounts are checked
 *     against the data.
 * Limits: 20 messages per 10 minutes from one address, 600 a day per business, 10 booking look-ups an hour.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params
  const body = await request.json().catch(() => ({}))
  const message = String(body?.message || '').replace(/\s+/g, ' ').trim().slice(0, 500)
  if (!message) return NextResponse.json({ error: 'Type your question.' }, { status: 400 })
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  if (!checkRateLimit(`site-chat:${ip}`, 20, 10 * 60_000).allowed) return NextResponse.json({ error: 'You have sent many messages. Please wait a few minutes, or message us on WhatsApp.' }, { status: 429 })

  const db = getSupabaseAdminClient()
  const data = await loadSite(db, slug).catch(() => null)
  if (!data || !data.chat) return NextResponse.json({ error: 'Chat is not available here.' }, { status: 404 })
  const orgId = data.page.organization.id
  if (!checkRateLimit(`site-chat-day:${orgId}`, 600, 24 * 60 * 60_000).allowed) return NextResponse.json({ error: 'The chat is busy right now. Please message us on WhatsApp.' }, { status: 429 })
  const history = cleanChatHistory(body?.history)

  // ── "My booking" — from the bookings themselves ──
  const given = detailsGiven(message, history)
  const lastAsked = history.at(-1)?.role === 'assistant' && /phone number and (your )?first name/i.test(history.at(-1)!.content)
  if (asksAboutBooking(message) || (lastAsked && (given.phone || given.name))) {
    if (given.phone && given.name) {
      if (!checkRateLimit(`site-chat-visits:${ip}`, 10, 60 * 60_000).allowed) return reply({ reply: 'You have checked many times. Please wait a little, or call us.', handoff: true })
      const visits = await upcomingVisits(db, data, given.phone, given.name).catch(() => [])
      if (!visits.length) return reply({ reply: `I could not find an upcoming booking for ${given.name} with that phone number. Please check both (the ones you booked with), or tap Book to make a new booking.`, form: 'booking' })
      const today = istDate()
      const staff = new Map(data.view.staff.map((m) => [m.id, m.name]))
      const bookings: { id: string; when: string; services: string[]; staff: string | null; status: string; paid: string }[] = visits.map((a: any) => ({
        id: a.id,
        when: `${formatIstDay(istDate(Date.parse(a.starts_at)), today)}, ${formatIstTime(new Date(a.starts_at))}`,
        services: (a.services || []).map((s: any) => s.name),
        staff: a.staff_id ? staff.get(a.staff_id) || null : null,
        status: STATUS_WORDS[a.status],
        paid: paymentNote(a),
      }))
      const lines = bookings.map((b) => `• ${b.when}: ${b.services.join(', ')}${b.staff ? ` with ${b.staff}` : ''} (*${b.status}*)${b.paid ? ` · ${b.paid}` : ''}`)
      return reply({ reply: `${bookings.length === 1 ? 'Your booking' : 'Your bookings'}:\n${lines.join('\n')}${data.view.phone ? `\nTo change or cancel, call ${data.view.phone}.` : ''}`, bookings })
    }
    return reply({ reply: 'Sure, I can check that. Please send the phone number and first name you booked with.', form: 'booking' })
  }

  // ── Everything else: the AI, from the business's own data ──
  const { data: org } = await db.from('organizations').select('*').eq('id', orgId).maybeSingle()
  if (!org || org.enable_ai === false) return NextResponse.json({ error: 'Chat is not available here.' }, { status: 404 })
  const ai = await getAiAccess(db, org.id, org)
  if (!ai.allowed) {
    console.warn(`[Website chat] ${slug}: ${ai.reason || 'AI not allowed'}`)
    return reply({ reply: `Sorry, I cannot answer questions just now. Please ${data.view.phone ? `call ${data.view.phone} or ` : ''}message us on WhatsApp.`, handoff: true })
  }

  const showPrices = data.site.show.prices
  const answer = await answerFromKnowledge({
    db, ai, org: { ...org, name: data.view.business }, message, history, channel: 'website', feature: 'website_chat',
    where: 'website chat', facts: factsFor(data), strictAmounts: true,
    products: (search) => serviceHits(data.view.services, search, 4, showPrices),
  })
  if (!answer) return NextResponse.json({ error: 'The chat could not answer just now. Please try again, or message us on WhatsApp.' }, { status: 502 })
  if (answer.handoff && answer.reason === 'not_answered') await recordKnowledgeGap(db, org.id, message, null)

  // The services the answer talked about, as cards with Book
  const used = answer.handoff || (answer.status !== 'answered' && answer.status !== 'chat') ? [] : [...new Set(answer.used.map((n) => answer.hits[n - 1]).filter((h) => h?.kind === 'service').map((h) => h!.id))]
  const services = used.slice(0, 4).map((id) => data.view.services.find((s) => s.id === id)).filter(Boolean)
    .map((s) => ({ id: s!.id, name: s!.name, category: s!.category, minutes: s!.minutes, price: showPrices ? s!.price : 0 }))
  return reply({
    reply: answer.reply,
    services,
    buttons: (answer.plan.buttons || []).map((b) => ({ title: b.title, question: b.id.replace(/^aq:/, '') })),
    attachments: answer.attachments,
    handoff: answer.handoff,
  })
}
