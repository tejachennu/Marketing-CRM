import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { getBilling, MAX_AI_TOPUP, MIN_AI_TOPUP } from '@/lib/billing'
import { creditTopup } from '@/lib/billing-service'
import { createTopupOrder, razorpayKeys, verifyOrderSignature } from '@/lib/razorpay'

/**
 * POST { organizationId, amount }: a Razorpay order to add AI credit.
 * POST { organizationId, razorpay_order_id, razorpay_payment_id, razorpay_signature }: Checkout finished;
 * verify and add the credit (once).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const organizationId = String(body?.organizationId || '')
  const access = await verifyOrgAccess(request, organizationId, { permission: 'billing.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const keys = razorpayKeys()
  if (!keys) return NextResponse.json({ error: 'Online payments are not set up yet. Please contact support.' }, { status: 503 })
  const db = getSupabaseAdminClient()

  try {
    const billing = await getBilling(db, organizationId)
    if (!billing) return NextResponse.json({ error: 'Billing is not set up yet. Please contact support.' }, { status: 503 })
    if (billing.billing_exempt) return NextResponse.json({ error: 'This workspace uses its own AI key, so it has no AI credit to add.' }, { status: 400 })

    if (body.razorpay_payment_id) {
      const orderId = String(body.razorpay_order_id || '')
      const paymentId = String(body.razorpay_payment_id)
      if (!verifyOrderSignature(orderId, paymentId, body.razorpay_signature)) {
        return NextResponse.json({ error: 'The payment could not be verified. If money was taken, it will be added automatically.' }, { status: 400 })
      }
      const result = await creditTopup(db, organizationId, paymentId)
      return NextResponse.json({ success: true, credited: result.credited })
    }

    const amount = Math.round(Number(body.amount))
    if (!(amount >= MIN_AI_TOPUP && amount <= MAX_AI_TOPUP)) {
      return NextResponse.json({ error: `Choose an amount between ₹${MIN_AI_TOPUP} and ₹${MAX_AI_TOPUP.toLocaleString('en-IN')}.` }, { status: 400 })
    }
    const order = await createTopupOrder(organizationId, amount)
    return NextResponse.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: keys.keyId })
  } catch (error: any) {
    console.error('[Billing top-up]', error?.message)
    return NextResponse.json({ error: error?.message || 'The top-up could not be started' }, { status: 502 })
  }
}
