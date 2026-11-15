import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { markStoreOrderPaid, razorpayOrderOf, verifyStoreWebhook } from '@/lib/commerce/store-payments'

export const runtime = 'nodejs'

/**
 * Razorpay → the business's store: a payment was captured (or an order paid). Set in the business's own
 * Razorpay dashboard (Settings → Webhooks) with the secret saved in WAMA CRM. Marks the order paid even
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
      const orderId = String(payment.notes?.wama_order_id || '')
      const query = db.from('commerce_orders').select('*').eq('organization_id', org.id)
      const { data: order } = orderId ? await query.eq('id', orderId).maybeSingle() : await query.eq('order_number', String(payment.notes?.wama_order_number || '')).maybeSingle()
      if (order && razorpayOrderOf(order) === payment.order_id && order.payment_status !== 'paid') {
        await markStoreOrderPaid(db, order, { id: String(payment.id), amount: Number(payment.amount) || 0 })
      }
    }
  } catch (error: any) {
    console.error('[Store Razorpay webhook]', error?.message)
  }
  return NextResponse.json({ received: true })
}
