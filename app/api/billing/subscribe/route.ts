import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { getBilling } from '@/lib/billing'
import { activateSubscription } from '@/lib/billing-service'
import { createSubscription, fetchSubscription, razorpayKeys, verifySubscriptionSignature } from '@/lib/razorpay'

/**
 * POST { organizationId }: start (or reuse) a Razorpay subscription for Checkout.
 * POST { organizationId, razorpay_payment_id, razorpay_subscription_id, razorpay_signature }: Checkout
 * finished; verify the signature and switch the workspace to the paid plan.
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
    if (billing.billing_exempt) return NextResponse.json({ error: 'This workspace does not need a plan.' }, { status: 400 })

    // Checkout finished
    if (body.razorpay_payment_id) {
      const subscriptionId = String(body.razorpay_subscription_id || '')
      if (!verifySubscriptionSignature(String(body.razorpay_payment_id), subscriptionId, body.razorpay_signature)) {
        return NextResponse.json({ error: 'The payment could not be verified. If money was taken, it will be refunded or applied automatically.' }, { status: 400 })
      }
      if (billing.razorpay_subscription_id && billing.razorpay_subscription_id !== subscriptionId) {
        return NextResponse.json({ error: 'This payment is for a different subscription.' }, { status: 400 })
      }
      await activateSubscription(db, organizationId, subscriptionId, String(body.razorpay_payment_id))
      return NextResponse.json({ success: true })
    }

    if (billing.status === 'active' && billing.razorpay_subscription_id) {
      return NextResponse.json({ error: 'This workspace already has an active plan.' }, { status: 400 })
    }
    // A subscription created earlier and not paid yet can be used again
    let subscriptionId = billing.razorpay_subscription_id
    if (subscriptionId) {
      const existing = await fetchSubscription(subscriptionId).catch(() => null)
      if (!existing || !['created', 'authenticated'].includes(String(existing.status))) subscriptionId = null
    }
    if (!subscriptionId) {
      const created = await createSubscription(organizationId)
      subscriptionId = created.id
      const { error } = await db.from('organization_billing').update({ razorpay_subscription_id: subscriptionId, updated_at: new Date().toISOString() }).eq('organization_id', organizationId)
      if (error) throw new Error(error.message)
    }
    return NextResponse.json({ subscriptionId, keyId: keys.keyId })
  } catch (error: any) {
    console.error('[Billing subscribe]', error?.message)
    return NextResponse.json({ error: error?.message || 'The subscription could not be started' }, { status: 502 })
  }
}
