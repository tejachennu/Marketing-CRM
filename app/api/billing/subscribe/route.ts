import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { getBilling } from '@/lib/billing'
import { isPlanId, planIdOf } from '@/lib/plans'
import { activateSubscription, subscriptionStartAt } from '@/lib/billing-service'
import { cancelSubscription, createSubscription, fetchSubscription, razorpayKeys, verifySubscriptionSignature } from '@/lib/razorpay'

/**
 * POST { organizationId, plan? }: start (or reuse) a Razorpay subscription for Checkout, for the
 * workspace's plan (or `plan`, which becomes the workspace's plan; only before paying, see change-plan).
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

    if (billing.status === 'active' && billing.razorpay_subscription_id && !billing.cancel_at_period_end) {
      return NextResponse.json({ error: 'Auto-pay is already set up for this workspace.' }, { status: 400 })
    }
    // Choosing a plan while subscribing (trial, or after the plan ended)
    let plan = planIdOf(billing.plan)
    if (isPlanId(body.plan) && body.plan !== plan) {
      // In a month already paid for, a different plan goes through change-plan (an upgrade pays the difference)
      const paidMonthRunning = ['active', 'past_due'].includes(billing.status) && billing.current_period_end && Date.parse(billing.current_period_end) > Date.now()
      if (paidMonthRunning) return NextResponse.json({ error: 'To change plan, use Change plan in Billing.' }, { status: 400 })
      plan = body.plan
      const { error } = await db.from('organization_billing').update({ plan, updated_at: new Date().toISOString() }).eq('organization_id', organizationId)
      if (error) throw new Error(error.message)
    }
    // The first charge waits for the end of the trial or of the month already paid for
    const startAt = subscriptionStartAt(billing)
    let subscriptionId = billing.razorpay_subscription_id
    if (subscriptionId) {
      const existing = await fetchSubscription(subscriptionId).catch(() => null)
      // One created earlier for the same start and never paid can be used again
      const reusable = existing?.status === 'created' && (Number(existing.start_at) || undefined) === startAt && planIdOf(existing.notes?.plan) === plan && Boolean(existing.notes?.plan)
      if (!reusable) {
        // A failing one is stopped so Razorpay does not keep retrying it next to the new one
        if (existing && ['pending', 'halted'].includes(String(existing.status))) {
          await cancelSubscription(subscriptionId, fetch, false).catch((error) => console.warn('[Billing subscribe] Could not cancel the failing subscription:', error?.message))
        }
        subscriptionId = null
      }
    }
    if (!subscriptionId) {
      const created = await createSubscription(organizationId, { startAt, plan })
      subscriptionId = created.id
      const { error } = await db.from('organization_billing').update({ razorpay_subscription_id: subscriptionId, updated_at: new Date().toISOString() }).eq('organization_id', organizationId)
      if (error) throw new Error(error.message)
    }
    return NextResponse.json({ subscriptionId, keyId: keys.keyId, startsAt: startAt ? new Date(startAt * 1000).toISOString() : null })
  } catch (error: any) {
    console.error('[Billing subscribe]', error?.message)
    return NextResponse.json({ error: error?.message || 'The subscription could not be started' }, { status: 502 })
  }
}
