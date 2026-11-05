import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { applySubscription, creditTopup, recordPayment, topupNotes } from '@/lib/billing-service'
import { verifyWebhookSignature } from '@/lib/razorpay'

/**
 * Razorpay webhook for WAMA CRM's own billing (set it up in Razorpay → Settings → Webhooks with
 * RAZORPAY_WEBHOOK_SECRET). Keeps subscriptions in step (renewals, failures, cancellations) and adds
 * AI credit for top-ups even when the customer closed the page before Checkout returned.
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
        await recordPayment(db, { organization_id: organizationId, purpose: 'subscription', amount_paise: Number(payment.amount) || 0, razorpay_payment_id: payment.id, razorpay_subscription_id: subscription.id })
      }
    } else if (event.event === 'payment.captured' && payment?.id) {
      const notes = await topupNotes(payment)
      if (notes?.app === 'wamacrm' && notes.purpose === 'ai_topup' && notes.organization_id) {
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
