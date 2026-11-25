import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { formatMoney } from '@/lib/commerce/commerce-utils'
import { createOrderNumber } from '@/lib/commerce/commerce-webhook-handler'
import { createManualOrder } from '@/lib/commerce/manual-order'
import { changeVariantStock } from '@/lib/commerce/variant-store'
import { cartForDiscount, deliveryCharge, loadStore, parseStoreOrder } from '@/lib/commerce/storefront'
import { decideDiscount, recordDiscountUse } from '@/lib/commerce/discount-store'
import { markRecovered } from '@/lib/commerce/cart-reminders'
import { askCodCheck } from '@/lib/commerce/cod-check'
import { sendPush } from '@/lib/push'
import { sendShared } from '@/lib/shared-whatsapp'
import { usesSharedNumber } from '@/lib/salon/whatsapp'
import { checkRateLimit } from '@/lib/rate-limiter'
import { createStorePayment, storeRazorpayKeys } from '@/lib/commerce/store-payments'
import { onlineGateway } from '@/lib/payments/gateway'
import { createCheckout, SESSION_PLACEHOLDER, stripeKeys } from '@/lib/payments/stripe'
import { withPaymentsSchema } from '@/lib/payments/schema'
import { returnBase, withQuery } from '@/lib/payments/return-url'
import { loadShopper, samePhone, saveShopper, shopperFrom, withStoreAccountsSchema } from '@/lib/commerce/store-accounts'
import { loadLoyaltySettings, pointsBalance, usePoints } from '@/lib/commerce/loyalty-store'
import { memberDiscount, pointsUsable } from '@/lib/commerce/loyalty'
import { cardsForCustomer } from '@/lib/salon/membership-store'

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
  const body = await request.json().catch(() => null)
  const parsed = parseStoreOrder(body, page)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  if (!checkRateLimit(`store-order-phone:${parsed.order.customer.phone}`, 6, 24 * 60 * 60_000).allowed) return NextResponse.json({ error: 'You have placed several orders today. Please call the shop for more.' }, { status: 429 })
  try {
    const { data: org } = await db.from('organizations').select('*').eq('id', page.organization.id).maybeSingle()
    // Online payment through the business's own Razorpay or Stripe (its pick when both are connected)
    const gateway = parsed.pay === 'online' ? onlineGateway(org) : null
    const keys = gateway === 'razorpay' ? storeRazorpayKeys(org) : null
    const stripe = gateway === 'stripe' ? stripeKeys(org) : null
    if (parsed.pay === 'online' && !keys && !stripe) return NextResponse.json({ error: 'Online payment is not available here right now. Please choose to pay on delivery or pick up.' }, { status: 400 })
    if (parsed.order.handover === 'delivery') parsed.order.shippingFee = deliveryCharge(page.settings, parsed.subtotal, org || {})
    // A typed code, or the best offer that applies by itself (decided here, never by the browser)
    const decided = await decideDiscount(db, page.organization.id, body?.code, cartForDiscount(page, parsed.order.items, parsed.order.shippingFee || 0), parsed.order.customer.phone)
    if (decided && !decided.ok) return NextResponse.json({ error: decided.reason, field: 'code' }, { status: 400 })
    if (decided?.ok) parsed.order.discount = { code: decided.code, title: decided.title, amount: decided.amount, freeDelivery: decided.freeDelivery }
    // Loyalty points: only a signed-in shopper, for their own saved phone (decided here, never by the browser)
    const shopper = page.settings.accounts ? await shopperFrom(request, db) : null
    let pointsUsed = 0
    const saved = shopper ? await loadShopper(db, page.organization.id, shopper.id).catch(() => null) : null
    const ownPhone = Boolean(saved?.phone && samePhone(saved.phone, parsed.order.customer.phone))
    const loyalty = ownPhone ? await loadLoyaltySettings(db, page.organization.id) : null
    // Front Desk members: their plan's discount, when it is better than the offer (never both)
    if (loyalty?.members && ownPhone) {
      const cards = await cardsForCustomer(db, page.organization.id, { phone: saved!.phone }).catch(() => [])
      const member = memberDiscount(cards as any[], parsed.subtotal)
      const offerSaving = decided?.ok ? decided.amount + (decided.freeDelivery ? parsed.order.shippingFee || 0 : 0) : 0
      if (member && member.amount > offerSaving) {
        parsed.order.discount = { code: null, title: member.title, amount: member.amount, freeDelivery: false }
        if (decided?.ok) { decided.amount = 0; decided.freeDelivery = false }
      }
    }
    if (body?.usePoints === true && shopper) {
      if (loyalty && ownPhone) {
        const afterOffer = parsed.subtotal - (parsed.order.discount?.amount || 0)
        pointsUsed = pointsUsable(await pointsBalance(db, page.organization.id, saved!.phone), afterOffer, loyalty)
      }
      if (pointsUsed > 0) {
        const offer = parsed.order.discount
        parsed.order.discount = offer
          ? { ...offer, code: `${offer.code || offer.title} + ${pointsUsed} points`, amount: offer.amount + pointsUsed }
          : { code: null, title: `${pointsUsed} points`, amount: pointsUsed, freeDelivery: false }
      }
    }
    const made = await createManualOrder(db, org || page.organization, parsed.order, createOrderNumber)
    if ('error' in made) return NextResponse.json({ error: made.error }, { status: 400 })
    const order = made.order
    const total = formatMoney(order.total_amount, order.currency)
    // Stock of the chosen sizes / colours goes down (put back if the order is cancelled)
    for (const item of parsed.order.items) if (item.variantId) await changeVariantStock(db, page.organization.id, item.variantId, -item.quantity).catch(() => null)
    await markRecovered(db, page.organization.id, parsed.order.customer.phone, order.id).catch(() => null)
    // Cash on Delivery: ask on WhatsApp before shipping ("Yes, send it" / "Cancel order")
    if (!keys && !stripe && parsed.order.handover === 'delivery' && parsed.order.customer.phone) {
      const { data: fullOrg } = await db.from('organizations').select('*').eq('id', page.organization.id).maybeSingle()
      if (fullOrg) await askCodCheck(db, fullOrg, order, parsed.order.customer.phone).catch(() => null)
    }
    if (decided?.ok && decided.amount > 0) await recordDiscountUse(db, page.organization.id, decided.discount, order.id, parsed.order.customer.phone, decided.amount).catch(() => null)
    if (pointsUsed > 0) await usePoints(db, page.organization.id, parsed.order.customer.phone, pointsUsed, order.id).catch((error: any) => console.error('[Store points]', error?.message))

    // A signed-in shopper: the order goes in their history, and their details are kept for next time
    if (shopper) {
      await withStoreAccountsSchema(() => db.from('commerce_orders').update({ shopper_id: shopper.id }).eq('id', order.id)).catch(() => null)
      await saveShopper(db, page.organization.id, shopper, {
        name: parsed.order.customer.name || undefined,
        phone: parsed.order.customer.phone || undefined,
        ...(parsed.order.address ? { address: parsed.order.address } : {}),
        cart: {},
      }).catch((error: any) => console.error('[Store order shopper]', error?.message))
    }

    // Pay online: the order waits for its payment, which goes to the business's own Razorpay or Stripe
    if (keys || stripe) {
      try {
        if (stripe) {
          // Back to the page the customer paid from (WAMA's address or the shop's own domain)
          const base = returnBase({ origin: request.headers.get('origin'), appUrl: process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin, domain: page.organization.domain, path: body?.returnPath, fallback: `/s/${page.organization.slug}` })
          const session = await createCheckout(stripe.secretKey, {
            amount: Number(order.total_amount) || 0, currency: String(order.currency || 'INR'),
            title: `${page.organization.name} · order #${order.order_number}`,
            description: parsed.order.items.map((i) => `${i.quantity} × ${i.title}`).join(', ').slice(0, 400),
            metadata: { wama_kind: 'order', wama_order_id: order.id, wama_order_number: order.order_number },
            reference: order.order_number,
            successUrl: withQuery(base, { paid: order.order_number, session: SESSION_PLACEHOLDER }),
            cancelUrl: withQuery(base, { unpaid: order.order_number }),
            email: body?.email ? String(body.email) : null,
            minutes: 60,
          })
          const shipping = { ...(order.shipping_address || {}), payment: { gateway: 'stripe', session_id: session.id } }
          await withPaymentsSchema(() => db.from('commerce_orders').update({ status: 'payment_pending', payment_method: 'stripe', shipping_address: shipping }).eq('id', order.id))
          return NextResponse.json({
            success: true, orderNumber: order.order_number, total: Number(order.total_amount), shipping: Number(order.shipping_fee), currency: order.currency,
            stripe: { sessionId: session.id, url: session.url },
          })
        }
        const payment = await createStorePayment(keys!, order)
        const shipping = { ...(order.shipping_address || {}), payment: { gateway: 'razorpay', order_id: payment.id } }
        await db.from('commerce_orders').update({ status: 'payment_pending', payment_method: 'razorpay', shipping_address: shipping }).eq('id', order.id)
        return NextResponse.json({
          success: true, orderNumber: order.order_number, total: Number(order.total_amount), shipping: Number(order.shipping_fee), currency: order.currency,
          razorpay: { keyId: keys!.keyId, orderId: payment.id, amount: payment.amount, currency: payment.currency, name: page.organization.name, customer: { name: parsed.order.customer.name, contact: parsed.order.customer.phone } },
        })
      } catch (error: any) {
        console.error('[Store page payment]', error?.message)
        await db.from('commerce_order_items').delete().eq('order_id', order.id)
        if (pointsUsed > 0) await db.from('commerce_points').delete().eq('order_id', order.id)
        await db.from('commerce_orders').delete().eq('id', order.id)
        return NextResponse.json({ error: page.pay.later ? 'Online payment is not working right now. Please choose to pay on delivery or pick up, or try again in a minute.' : 'Online payment is not working right now. Please try again in a minute or call the shop.' }, { status: 502 })
      }
    }

    await sendPush(db, { organizationId: page.organization.id }, { kind: 'order', title: `New website order · ${total}`, body: `${parsed.order.customer.name} · ${parsed.order.handover === 'delivery' ? 'delivery' : 'pick up'} · #${order.order_number}`, open: 'orders', tag: `order:${order.id}` })
    // Without its own WhatsApp (₹300 plan), WAMA CRM's number confirms the order to the customer (best effort)
    if (parsed.order.customer.phone && await usesSharedNumber(db, page.organization.id).catch(() => false)) {
      await sendShared(db, page.organization.id, parsed.order.customer.phone, 'order', {
        first_name: String(parsed.order.customer.name || '').split(' ')[0] || 'there',
        business: String(page.organization.name || ''),
        bill_number: String(order.order_number),
        amount: total,
      }).catch((error: any) => console.error('[Store order] Confirmation from WAMA number failed:', error?.message))
    }
    return NextResponse.json({ success: true, orderNumber: order.order_number, total: Number(order.total_amount), shipping: Number(order.shipping_fee), currency: order.currency })
  } catch (error: any) {
    console.error('[Store page order]', error?.message)
    return NextResponse.json({ error: 'The order could not be placed. Please try again or call the shop.' }, { status: 500 })
  }
}
