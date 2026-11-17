import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { formatMoney } from '@/lib/commerce/commerce-utils'
import { createOrderNumber } from '@/lib/commerce/commerce-webhook-handler'
import { createManualOrder } from '@/lib/commerce/manual-order'
import { changeVariantStock } from '@/lib/commerce/variant-store'
import { deliveryCharge, loadStore, parseStoreOrder } from '@/lib/commerce/storefront'
import { sendPush } from '@/lib/push'
import { checkRateLimit } from '@/lib/rate-limiter'
import { createStorePayment, storeRazorpayKeys } from '@/lib/commerce/store-payments'
import { saveShopper, shopperFrom, withStoreAccountsSchema } from '@/lib/commerce/store-accounts'

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
    const { data: org } = await db.from('organizations').select('id, currency, commerce_default_shipping_fee, commerce_free_shipping_threshold, store_razorpay_key_id, store_razorpay_key_secret').eq('id', page.organization.id).maybeSingle()
    const keys = parsed.pay === 'online' ? storeRazorpayKeys(org) : null
    if (parsed.pay === 'online' && !keys) return NextResponse.json({ error: 'Online payment is not available here right now. Please choose to pay on delivery or pick up.' }, { status: 400 })
    if (parsed.order.handover === 'delivery') parsed.order.shippingFee = deliveryCharge(page.settings, parsed.subtotal, org || {})
    const made = await createManualOrder(db, org || page.organization, parsed.order, createOrderNumber)
    if ('error' in made) return NextResponse.json({ error: made.error }, { status: 400 })
    const order = made.order
    const total = formatMoney(order.total_amount, order.currency)
    // Stock of the chosen sizes / colours goes down (put back if the order is cancelled)
    for (const item of parsed.order.items) if (item.variantId) await changeVariantStock(db, page.organization.id, item.variantId, -item.quantity).catch(() => null)

    // A signed-in shopper: the order goes in their history, and their details are kept for next time
    const shopper = page.settings.accounts ? await shopperFrom(request, db) : null
    if (shopper) {
      await withStoreAccountsSchema(() => db.from('commerce_orders').update({ shopper_id: shopper.id }).eq('id', order.id)).catch(() => null)
      await saveShopper(db, page.organization.id, shopper, {
        name: parsed.order.customer.name || undefined,
        phone: parsed.order.customer.phone || undefined,
        ...(parsed.order.address ? { address: parsed.order.address } : {}),
        cart: {},
      }).catch((error: any) => console.error('[Store order shopper]', error?.message))
    }

    // Pay online: the order waits for its payment, which goes to the business's own Razorpay
    if (keys) {
      try {
        const payment = await createStorePayment(keys, order)
        const shipping = { ...(order.shipping_address || {}), payment: { gateway: 'razorpay', order_id: payment.id } }
        await db.from('commerce_orders').update({ status: 'payment_pending', payment_method: 'razorpay', shipping_address: shipping }).eq('id', order.id)
        return NextResponse.json({
          success: true, orderNumber: order.order_number, total: Number(order.total_amount), shipping: Number(order.shipping_fee), currency: order.currency,
          razorpay: { keyId: keys.keyId, orderId: payment.id, amount: payment.amount, currency: payment.currency, name: page.organization.name, customer: { name: parsed.order.customer.name, contact: parsed.order.customer.phone } },
        })
      } catch (error: any) {
        console.error('[Store page payment]', error?.message)
        await db.from('commerce_order_items').delete().eq('order_id', order.id)
        await db.from('commerce_orders').delete().eq('id', order.id)
        return NextResponse.json({ error: page.pay.later ? 'Online payment is not working right now. Please choose to pay on delivery or pick up, or try again in a minute.' : 'Online payment is not working right now. Please try again in a minute or call the shop.' }, { status: 502 })
      }
    }

    await sendPush(db, { organizationId: page.organization.id }, { kind: 'order', title: `New website order · ${total}`, body: `${parsed.order.customer.name} · ${parsed.order.handover === 'delivery' ? 'delivery' : 'pick up'} · #${order.order_number}`, open: 'orders', tag: `order:${order.id}` })
    return NextResponse.json({ success: true, orderNumber: order.order_number, total: Number(order.total_amount), shipping: Number(order.shipping_fee), currency: order.currency })
  } catch (error: any) {
    console.error('[Store page order]', error?.message)
    return NextResponse.json({ error: 'The order could not be placed. Please try again or call the shop.' }, { status: 500 })
  }
}
