import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { loadStore } from '@/lib/commerce/storefront'
import { markStoreOrderPaid, paidPayment, razorpayOrderOf, storeRazorpayKeys, verifyStoreSignature } from '@/lib/commerce/store-payments'
import { formatMoney } from '@/lib/commerce/commerce-utils'
import { sendPush } from '@/lib/push'
import { checkRateLimit } from '@/lib/rate-limiter'

export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * After Razorpay checkout on the store page:
 *   { orderNumber, razorpayOrderId, paymentId, signature }  the payment went through: check and mark paid
 *   { orderNumber, razorpayOrderId, action: 'check' }       the page lost track: ask Razorpay if it was paid
 *   { orderNumber, razorpayOrderId, action: 'later' }       pay on delivery / pick up instead (when allowed)
 * The Razorpay order id is the proof the caller placed this order (only that customer's page has it).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  if (!checkRateLimit(`store-pay:${ip}`, 30, 60 * 60_000).allowed) return NextResponse.json({ error: 'Too many tries. Please wait a little.' }, { status: 429 })
  const { slug } = await params
  const body = await request.json().catch(() => ({}))
  const db = getSupabaseAdminClient()
  const page = await loadStore(db, slug)
  if (!page) return NextResponse.json({ error: 'This store is not available.' }, { status: 404 })
  const { data: org } = await db.from('organizations').select('id, store_razorpay_key_id, store_razorpay_key_secret').eq('id', page.organization.id).maybeSingle()
  const keys = storeRazorpayKeys(org)
  const { data: order } = await db.from('commerce_orders').select('*').eq('organization_id', page.organization.id).eq('order_number', String(body?.orderNumber || '')).maybeSingle()
  const razorpayOrderId = String(body?.razorpayOrderId || '')
  if (!order || !razorpayOrderId || razorpayOrderOf(order) !== razorpayOrderId) return NextResponse.json({ error: 'That order could not be found.' }, { status: 404 })
  if (order.payment_status === 'paid') return NextResponse.json({ success: true, paid: true })

  if (body?.action === 'later') {
    if (!page.pay.later) return NextResponse.json({ error: 'This shop takes online payment only.' }, { status: 400 })
    if (order.status !== 'payment_pending') return NextResponse.json({ success: true, paid: false })
    await db.from('commerce_orders').update({ status: 'cod_confirmed', payment_method: 'cod', updated_at: new Date().toISOString() }).eq('id', order.id).eq('status', 'payment_pending')
    await sendPush(db, { organizationId: page.organization.id }, { kind: 'order', title: `New website order · ${formatMoney(order.total_amount, order.currency)}`, body: `#${order.order_number} · pays on ${order.shipping_address?.handover === 'delivery' ? 'delivery' : 'pick up'}`, open: 'orders', tag: `order:${order.id}` })
    return NextResponse.json({ success: true, paid: false, later: true })
  }
  if (!keys) return NextResponse.json({ error: 'Online payment is not set up for this shop.' }, { status: 400 })

  try {
    if (body?.action === 'check') {
      const payment = await paidPayment(keys, razorpayOrderId)
      if (payment) await markStoreOrderPaid(db, order, payment)
      return NextResponse.json({ success: true, paid: Boolean(payment) })
    }
    const paymentId = String(body?.paymentId || '')
    if (!paymentId || !verifyStoreSignature(keys.keySecret, razorpayOrderId, paymentId, body?.signature)) return NextResponse.json({ error: 'The payment could not be confirmed. If money was taken, the shop will see it shortly.' }, { status: 400 })
    // The signature proves this payment belongs to this order; the amount is read from Razorpay itself
    const payment = await paidPayment(keys, razorpayOrderId)
    if (payment) await markStoreOrderPaid(db, order, payment)
    return NextResponse.json({ success: true, paid: Boolean(payment) })
  } catch (error: any) {
    console.error('[Store page pay]', error?.message)
    return NextResponse.json({ error: 'The payment could not be checked right now. If money was taken, the shop will see it shortly.' }, { status: 502 })
  }
}
