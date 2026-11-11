import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { applySubscription, creditTopup, grantMonthlyAi, recordPayment, subscriptionPlan, topupNotes } from '@/lib/billing-service'
import { getBilling } from '@/lib/billing'
import { getPlan } from '@/lib/plans'
import { verifyWebhookSignature } from '@/lib/razorpay'

/**
 * Razorpay webhook for WAMA CRM's own billing (set it up in Razorpay → Settings → Webhooks with
 * RAZORPAY_WEBHOOK_SECRET). Keeps subscriptions in step (renewals, failures, cancellations) and adds
 * AI credit, message wallet top-ups and upgrades even when the customer closed the page before Checkout returned.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text()
  if (!verifyWebhookSignature(raw, request.headers.get('x-razorpay-signature'))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  let event: any
  try {
    event = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const db = getSupabaseAdminClient()
  const subscription = event?.payload?.subscription?.entity
  const payment = event?.payload?.payment?.entity

  try {
    // Only WAMA CRM's own subscriptions and top-ups; stores' payments never come here
    if (subscription && subscription.notes?.app === 'wamacrm' && subscription.notes?.organization_id) {
      const organizationId = String(subscription.notes.organization_id)
      await applySubscription(db, organizationId, subscription)
      if (event.event === 'subscription.charged' && payment?.id) {
        const plan = subscriptionPlan(subscription)
        const fresh = await recordPayment(db, { organization_id: organizationId, purpose: 'subscription', amount_paise: Number(payment.amount) || getPlan(plan).amountPaise, razorpay_payment_id: payment.id, razorpay_subscription_id: subscription.id, plan })
        // Each month's payment brings the plan's AI credit, once
        if (fresh) {
          const billing = await getBilling(db, organizationId)
          if (billing && billing.razorpay_subscription_id === subscription.id) await grantMonthlyAi(db, organizationId, billing.plan, String(payment.id), billing.plan_overrides)
        }
      }
    } else if (event.event === 'payment.captured' && payment?.id) {
      const notes = await topupNotes(payment)
      if (notes?.app === 'wamacrm' && ['ai_topup', 'message_topup', 'upgrade'].includes(String(notes.purpose)) && notes.organization_id) {
        await creditTopup(db, String(notes.organization_id), String(payment.id))
      }
    }
    return NextResponse.json({ received: true })
  } catch (error: any) {
    console.error('[Billing webhook]', event?.event, error?.message)
    // 500 makes Razorpay retry later
    return NextResponse.json({ error: 'Could not process the event' }, { status: 500 })
  }
}
