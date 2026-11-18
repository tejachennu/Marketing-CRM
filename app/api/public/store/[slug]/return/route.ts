import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { loadStore } from '@/lib/commerce/storefront'
import { samePhone, shopperFrom } from '@/lib/commerce/store-accounts'
import { cleanReturnRequest, returnChance } from '@/lib/commerce/returns'
import { askReturn } from '@/lib/commerce/returns-store'
import { sendPush } from '@/lib/push'
import { checkRateLimit } from '@/lib/rate-limiter'

export const runtime = 'nodejs'

/**
 * POST { order, phone?, reason, note? }: the customer asks to return a delivered order. A signed-in shopper's
 * own order, or a guest's order by its number and the phone it was placed with. The team gets a pop-up.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  if (!checkRateLimit(`store-return:${ip}`, 10, 60 * 60_000).allowed) return NextResponse.json({ error: 'Too many tries. Please wait a little, or call the shop.' }, { status: 429 })
  const { slug } = await params
  const db = getSupabaseAdminClient()
  const page = await loadStore(db, slug)
  if (!page) return NextResponse.json({ error: 'This store is not available.' }, { status: 404 })
  const body = await request.json().catch(() => ({}))
  const number = String(body?.order || '').replace(/^#/, '').trim().toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9-]{2,39}$/.test(number)) return NextResponse.json({ error: 'Which order?' }, { status: 400 })
  const { data: order } = await db.from('commerce_orders').select('*').eq('organization_id', page.organization.id).eq('order_number', number).maybeSingle()
  const shopper = order ? await shopperFrom(request, db) : null
  const mine = Boolean(order && ((shopper && order.shopper_id === shopper.id) || samePhone(order.shipping_address?.phone_number, body?.phone)))
  if (!order || !mine) return NextResponse.json({ error: 'We could not find that order. Use the phone number you ordered with.' }, { status: 404 })
  const chance = returnChance(order, page.returns || { on: false, days: 7 })
  if (!chance.ok) return NextResponse.json({ error: chance.reason }, { status: 409 })
  const request_ = cleanReturnRequest(body)
  if ('error' in request_) return NextResponse.json({ error: request_.error, field: 'reason' }, { status: 400 })
  await askReturn(db, order, request_)
  await sendPush(db, { organizationId: page.organization.id }, { kind: 'order', title: `Return asked · #${order.order_number}`, body: `${order.shipping_address?.full_name || 'A customer'}: ${request_.reason}`, open: 'orders', tag: `return:${order.id}` }).catch(() => null)
  return NextResponse.json({ success: true, status: 'asked' })
}
