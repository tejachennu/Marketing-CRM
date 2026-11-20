import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { markStoreOrderPaid, stripeSessionOf } from '@/lib/commerce/store-payments'
import { readCheckout, verifyStripeWebhook } from '@/lib/payments/stripe'
import { loadBookingPage } from '@/lib/salon/booking-page'
import { findBooking, markBookingPaid } from '@/lib/salon/booking-payments'
import { isUuid } from '@/lib/record-visibility'

export const runtime = 'nodejs'

/**
 * Stripe → the business: a Checkout payment went through, for a store order or a booking. Set in the business's
 * own Stripe dashboard (Developers → Webhooks, events checkout.session.completed and
 * checkout.session.async_payment_succeeded) with its signing secret saved in WAMA CRM. Marks it paid even when the
 * customer closed the page before coming back.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const raw = await request.text()
  const db = getSupabaseAdminClient()
  const { data: org } = await db.from('organizations').select('*').eq('slug', slug).maybeSingle()
  if (!org || !verifyStripeWebhook(String(org.stripe_webhook_secret || ''), raw, request.headers.get('stripe-signature'))) {
    return NextResponse.json({ error: 'Not accepted' }, { status: 400 })
  }
  try {
    const event = JSON.parse(raw)
    if (event?.type === 'checkout.session.completed' || event?.type === 'checkout.session.async_payment_succeeded') {
      const session = readCheckout(event?.data?.object)
      if (session.paid && session.id) {
        const payment = { id: session.paymentIntent || session.id, amount: session.amount, gateway: 'stripe' as const, intent: session.paymentIntent }
        if (session.metadata.wama_kind === 'booking') {
          const page = await loadBookingPage(db, slug)
          const booking = page ? await findBooking(db, org.id, { id: session.metadata.wama_booking_id, ref: session.id }) : null
          if (page && booking && booking.payment_ref === session.id && booking.payment_status !== 'paid') await markBookingPaid(db, page, booking, payment)
        } else {
          const id = String(session.metadata.wama_order_id || '')
          const { data: order } = isUuid(id)
            ? await db.from('commerce_orders').select('*').eq('organization_id', org.id).eq('id', id).maybeSingle()
            : await db.from('commerce_orders').select('*').eq('organization_id', org.id).eq('shipping_address->payment->>session_id', session.id).maybeSingle()
          if (order && stripeSessionOf(order) === session.id && order.payment_status !== 'paid') await markStoreOrderPaid(db, order, payment)
        }
      }
    }
  } catch (error: any) {
    console.error('[Stripe webhook]', error?.message)
  }
  return NextResponse.json({ received: true })
}
