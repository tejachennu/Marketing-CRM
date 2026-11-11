import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { changePlan, confirmPlanAutoPay, creditTopup } from '@/lib/billing-service'
import { razorpayKeys, verifyOrderSignature, verifySubscriptionSignature } from '@/lib/razorpay'
import { isPlanId } from '@/lib/plans'

/**
 * Change plan (see changePlan in lib/billing-service.ts).
 * POST { organizationId, plan }: switch now (trial), or get what to pay: the difference for an upgrade
 *   (an order) or the new auto-pay (a subscription), both for Razorpay Checkout.
 * POST { organizationId, razorpay_order_id, razorpay_payment_id, razorpay_signature }: the difference is
 *   paid; the bigger plan starts and the new auto-pay is returned for the next Checkout.
 * POST { organizationId, razorpay_subscription_id, razorpay_payment_id, razorpay_signature }: the new
 *   auto-pay is set up.
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
    if (body.razorpay_order_id) {
      const orderId = String(body.razorpay_order_id)
      const paymentId = String(body.razorpay_payment_id || '')
      if (!verifyOrderSignature(orderId, paymentId, body.razorpay_signature)) {
        return NextResponse.json({ error: 'The payment could not be verified. If money was taken, the new plan starts automatically.' }, { status: 400 })
      }
      const paid = await creditTopup(db, organizationId, paymentId, fetch, 'upgrade')
      // Now the auto-pay for the new price, starting on the bill date
      const next = await changePlan(db, organizationId, paid.plan!)
      return NextResponse.json({ success: true, ...next, keyId: keys.keyId })
    }
    if (body.razorpay_subscription_id) {
      const subscriptionId = String(body.razorpay_subscription_id)
      if (!verifySubscriptionSignature(String(body.razorpay_payment_id || ''), subscriptionId, body.razorpay_signature)) {
        return NextResponse.json({ error: 'The auto-pay could not be verified. Please try again.' }, { status: 400 })
      }
      await confirmPlanAutoPay(db, organizationId, subscriptionId)
      return NextResponse.json({ success: true })
    }
    if (!isPlanId(body.plan)) return NextResponse.json({ error: 'Choose a plan.' }, { status: 400 })
    const result = await changePlan(db, organizationId, body.plan)
    return NextResponse.json({ ...result, keyId: keys.keyId })
  } catch (error: any) {
    console.error('[Billing change plan]', error?.message)
    return NextResponse.json({ error: error?.message || 'The plan could not be changed' }, { status: 400 })
  }
}
