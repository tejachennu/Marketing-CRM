import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { findStoreOrder, markStoreOrderPaid, razorpayOrderOf, verifyStoreWebhook } from '@/lib/commerce/store-payments'
import { loadBookingPage } from '@/lib/salon/booking-page'
import { findBooking, markBookingPaid } from '@/lib/salon/booking-payments'

export const runtime = 'nodejs'

/**
 * Razorpay → the business: a payment was captured (or an order paid), for a store order or a booking. Set in the
 * business's own Razorpay dashboard (Settings → Webhooks) with the secret saved in WAMA CRM. Marks it paid even
 * when the customer closed the page before it came back.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const raw = await request.text()
  const db = getSupabaseAdminClient()
  const { data: org } = await db.from('organizations').select('id, store_razorpay_webhook_secret').eq('slug', slug).maybeSingle()
  if (!org || !verifyStoreWebhook(String(org.store_razorpay_webhook_secret || ''), raw, request.headers.get('x-razorpay-signature'))) {
    return NextResponse.json({ error: 'Not accepted' }, { status: 401 })
  }
  try {
    const event = JSON.parse(raw)
    const payment = event?.payload?.payment?.entity
    if ((event?.event === 'payment.captured' || event?.event === 'order.paid') && payment?.order_id && payment.status === 'captured') {
      const notes = { ...(payment.notes || {}), ...(event?.payload?.order?.entity?.notes || {}) }
      if (notes.wama_kind === 'booking') {
        // A booking paid online (website or booking page)
        const page = await loadBookingPage(db, slug)
        const booking = page ? await findBooking(db, org.id, { id: notes.wama_booking_id, ref: String(payment.order_id) }) : null
        if (page && booking && booking.payment_ref === payment.order_id && booking.payment_status !== 'paid') {
          await markBookingPaid(db, page, booking, { id: String(payment.id), amount: Number(payment.amount) || 0, gateway: 'razorpay' })
        }
      } else {
        const order = await findStoreOrder(db, org.id, event)
        if (order && razorpayOrderOf(order) === payment.order_id && order.payment_status !== 'paid') {
          await markStoreOrderPaid(db, order, { id: String(payment.id), amount: Number(payment.amount) || 0 })
        }
      }
    }
  } catch (error: any) {
    console.error('[Razorpay webhook]', error?.message)
  }
  return NextResponse.json({ received: true })
}
