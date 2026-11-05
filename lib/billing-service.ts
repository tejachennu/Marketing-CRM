/**
 * Billing actions shared by the API routes and the Razorpay webhook: activating a subscription,
 * keeping its status in step with Razorpay, and crediting AI top-ups exactly once.
 */

import { billingState, getBilling, MAX_AI_TOPUP, MIN_AI_TOPUP, PLAN, TRIAL_DAYS, type BillingRow } from './billing'
import { capturePayment, fetchOrder, fetchPayment, fetchSubscription } from './razorpay'

async function checked(query: any) {
  const result = await query
  if (result.error) throw new Error(result.error.message)
  return result.data
}

const fromUnix = (seconds: unknown) => (Number(seconds) > 0 ? new Date(Number(seconds) * 1000).toISOString() : null)

/** Razorpay's subscription status as ours. */
export function mapSubscriptionStatus(status: string): BillingRow['status'] | null {
  switch (status) {
    case 'active':
    case 'authenticated':
      return 'active'
    case 'pending':
    case 'halted':
      return 'past_due'
    case 'cancelled':
    case 'completed':
    case 'expired':
      return 'cancelled'
    default:
      return null // created: not paid yet, nothing changes
  }
}

/**
 * When a new subscription's first charge should happen (Unix seconds): the end of the free trial, or
 * the end of a month already paid for. Undefined means charge now. Less than an hour away is treated
 * as now, since Razorpay needs a start date safely in the future.
 */
export function subscriptionStartAt(billing: Pick<BillingRow, 'status' | 'trial_ends_at' | 'current_period_end' | 'cancel_at_period_end'>, now = Date.now()): number | undefined {
  const paidUntil = billing.status === 'active' && billing.cancel_at_period_end && billing.current_period_end ? Date.parse(billing.current_period_end) : NaN
  const trialEnd = billing.status === 'trialing' ? Date.parse(billing.trial_ends_at) : NaN
  const start = Number.isFinite(paidUntil) ? paidUntil : trialEnd
  return Number.isFinite(start) && start - now > 60 * 60 * 1000 ? Math.floor(start / 1000) : undefined
}

/** Copy a Razorpay subscription's state onto the workspace. */
export async function applySubscription(db: any, organizationId: string, subscription: any): Promise<void> {
  // A subscription the workspace has since replaced (a failed one, or one that is running out) must
  // not overwrite the current one when its last events arrive
  const { data: current } = await db.from('organization_billing').select('razorpay_subscription_id').eq('organization_id', organizationId).maybeSingle()
  if (current?.razorpay_subscription_id && current.razorpay_subscription_id !== subscription?.id) return
  const status = mapSubscriptionStatus(String(subscription?.status || ''))
  const update: Record<string, any> = { razorpay_subscription_id: subscription.id, updated_at: new Date().toISOString() }
  if (status) update.status = status
  const periodEnd = fromUnix(subscription.current_end) || fromUnix(subscription.charge_at)
  if (periodEnd) update.current_period_end = periodEnd
  if (subscription.customer_id) update.razorpay_customer_id = subscription.customer_id
  // A new subscription (paid, or auto-pay set up for a later start) clears an earlier "cancel at the end of the month"
  if (status === 'active' && !subscription.ended_at) update.cancel_at_period_end = false
  if (status === 'cancelled') update.cancel_at_period_end = true
  await checked(db.from('organization_billing').update(update).eq('organization_id', organizationId))
}

/** Record a captured payment once. Returns false when it was already recorded. */
export async function recordPayment(db: any, row: { organization_id: string; purpose: 'subscription' | 'ai_topup'; amount_paise: number; razorpay_payment_id: string; razorpay_order_id?: string | null; razorpay_subscription_id?: string | null }): Promise<boolean> {
  const { error } = await db.from('billing_payments').insert({ ...row, status: 'captured' })
  if (!error) return true
  if (error.code === '23505' || /duplicate key/i.test(error.message || '')) return false
  throw new Error(error.message)
}

/** A payment's top-up notes: its own, or its order's (where WAMA CRM wrote them). */
export async function topupNotes(payment: any, fetcher: typeof fetch = fetch): Promise<Record<string, string> | null> {
  if (payment?.notes?.purpose) return payment.notes
  if (!payment?.order_id) return null
  const order = await fetchOrder(String(payment.order_id), fetcher).catch(() => null)
  return order?.notes || null
}

/**
 * Credit an AI top-up after checking the payment with Razorpay: it must be for this workspace, within
 * the allowed amounts, and captured (an authorized one is captured first, so credit is never given for
 * money that could still be released). Safe to call twice for one payment.
 */
export async function creditTopup(db: any, organizationId: string, paymentId: string, fetcher: typeof fetch = fetch): Promise<{ credited: boolean; amount: number }> {
  let payment = await fetchPayment(paymentId, fetcher)
  if (!['captured', 'authorized'].includes(String(payment.status))) throw new Error('The payment has not gone through yet.')
  const notes = await topupNotes(payment, fetcher)
  if (notes?.purpose !== 'ai_topup' || notes?.organization_id !== organizationId) throw new Error('This payment is not an AI credit top-up for this workspace.')
  const amount = Number(payment.amount) / 100
  if (!(amount >= MIN_AI_TOPUP && amount <= MAX_AI_TOPUP)) throw new Error('The payment amount is not a valid top-up.')
  if (payment.status === 'authorized') {
    // Captured automatically a moment later on most accounts; whichever happens first wins
    payment = await capturePayment(paymentId, Number(payment.amount), fetcher).catch(() => fetchPayment(paymentId, fetcher))
    if (payment.status !== 'captured') throw new Error('The payment has not been completed yet. Your credit is added as soon as it is.')
  }
  await getBilling(db, organizationId)
  const fresh = await recordPayment(db, { organization_id: organizationId, purpose: 'ai_topup', amount_paise: Number(payment.amount), razorpay_payment_id: paymentId, razorpay_order_id: payment.order_id || null })
  await checked(db.rpc('ai_wallet_credit', { p_org: organizationId, p_amount: amount, p_kind: 'topup', p_payment_id: paymentId, p_created_by: null }))
  return { credited: fresh, amount }
}

/** After Checkout: confirm the subscription with Razorpay and switch the workspace to paid. */
export async function activateSubscription(db: any, organizationId: string, subscriptionId: string, paymentId: string, fetcher: typeof fetch = fetch): Promise<void> {
  const subscription = await fetchSubscription(subscriptionId, fetcher)
  if (subscription.notes?.organization_id && subscription.notes.organization_id !== organizationId) throw new Error('This subscription belongs to another workspace.')
  await applySubscription(db, organizationId, { ...subscription, status: mapSubscriptionStatus(subscription.status) ? subscription.status : 'active' })
  // Charged straight away: record it. Auto-pay set up for a later start has only authorised a small
  // verification amount; the real charge is recorded by the webhook when it happens.
  if (subscription.status === 'active' && Number(subscription.paid_count) > 0) {
    await recordPayment(db, { organization_id: organizationId, purpose: 'subscription', amount_paise: PLAN.amountPaise, razorpay_payment_id: paymentId, razorpay_subscription_id: subscriptionId })
  }
}

/** What the billing page and the app's gate need to know. */
export async function billingSummary(db: any, organizationId: string, options: { payments?: boolean } = {}) {
  const row = await getBilling(db, organizationId)
  const state = billingState(row)
  let payments: { purpose: string; amount: number; date: string }[] = []
  if (options.payments && row) {
    const { data } = await db.from('billing_payments').select('purpose, amount_paise, created_at').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(12)
    payments = (data || []).map((payment: any) => ({ purpose: payment.purpose, amount: Number(payment.amount_paise) / 100, date: payment.created_at }))
  }
  return {
    configured: row !== null,
    plan: { id: PLAN.id, name: PLAN.name, price: PLAN.amountPaise / 100, currency: PLAN.currency, interval: PLAN.interval, features: PLAN.features },
    ...state,
    trialDays: TRIAL_DAYS,
    hasSubscription: Boolean(row?.razorpay_subscription_id) && ['active', 'past_due'].includes(String(row?.status)),
    payments,
  }
}
