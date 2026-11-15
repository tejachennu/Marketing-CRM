import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { formatMoney } from '@/lib/commerce/commerce-utils'
import { createOrderNumber } from '@/lib/commerce/commerce-webhook-handler'
import { createManualOrder } from '@/lib/commerce/manual-order'
import { deliveryCharge, loadStore, parseStoreOrder } from '@/lib/commerce/storefront'
import { sendPush } from '@/lib/push'
import { checkRateLimit } from '@/lib/rate-limiter'

export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * POST { name, phone, items: [{ productId, quantity }], handover: 'pickup'|'delivery', address?, note? }:
 * order from the online store page. No sign-in; limited per address and per phone. Prices come from the
 * product list, never from the page. The order lands in Orders (Website) and pops up on the team's phones.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  if (!checkRateLimit(`store-order:${ip}`, 10, 60 * 60_000).allowed) return NextResponse.json({ error: 'Too many orders from here. Please call the shop instead.' }, { status: 429 })
  const { slug } = await params
  const db = getSupabaseAdminClient()
  const page = await loadStore(db, slug)
  if (!page) return NextResponse.json({ error: 'This store is not taking orders online right now.' }, { status: 404 })
  const parsed = parseStoreOrder(await request.json().catch(() => null), page)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  if (!checkRateLimit(`store-order-phone:${parsed.order.customer.phone}`, 6, 24 * 60 * 60_000).allowed) return NextResponse.json({ error: 'You have placed several orders today. Please call the shop for more.' }, { status: 429 })
  try {
    const { data: org } = await db.from('organizations').select('id, currency, commerce_default_shipping_fee, commerce_free_shipping_threshold').eq('id', page.organization.id).maybeSingle()
    if (parsed.order.handover === 'delivery') parsed.order.shippingFee = deliveryCharge(page.settings, parsed.subtotal, org || {})
    const made = await createManualOrder(db, org || page.organization, parsed.order, createOrderNumber)
    if ('error' in made) return NextResponse.json({ error: made.error }, { status: 400 })
    const order = made.order
    const total = formatMoney(order.total_amount, order.currency)
    await sendPush(db, { organizationId: page.organization.id }, { kind: 'order', title: `New website order · ${total}`, body: `${parsed.order.customer.name} · ${parsed.order.handover === 'delivery' ? 'delivery' : 'pick up'} · #${order.order_number}`, open: 'orders', tag: `order:${order.id}` })
    return NextResponse.json({ success: true, orderNumber: order.order_number, total: Number(order.total_amount), shipping: Number(order.shipping_fee), currency: order.currency })
  } catch (error: any) {
    console.error('[Store page order]', error?.message)
    return NextResponse.json({ error: 'The order could not be placed. Please try again or call the shop.' }, { status: 500 })
  }
}
