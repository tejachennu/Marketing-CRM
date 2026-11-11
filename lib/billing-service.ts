/**
 * Billing actions shared by the API routes and the Razorpay webhook: activating a subscription,
 * keeping its status in step with Razorpay, and crediting AI top-ups exactly once.
 */

import { billingLimits, billingState, getBilling, MAX_AI_TOPUP, MIN_AI_TOPUP, TRIAL_DAYS, type BillingRow } from './billing'
import { allowsMap, getPlan, isPlanId, limitsOf, planDirection, planIdOf, PLAN_CURRENCY, PLAN_INTERVAL, PLANS, upgradeDifferencePaise, type PlanId } from './plans'
import { cancelSubscription, capturePayment, createSubscription, createTopupOrder, fetchOrder, fetchPayment, fetchSubscription, type OrderPurpose } from './razorpay'
import { withPlansSchema } from './plans-schema'
import { creditMessages, LOW_MESSAGE_BALANCE, MAX_MESSAGE_TOPUP, messageHistory, messagePrices, MIN_MESSAGE_TOPUP } from './message-wallet'

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

/** The WAMA plan a Razorpay subscription is for (its notes); the old single-plan ones are Growth. */
export function subscriptionPlan(subscription: any): PlanId {
  return planIdOf(subscription?.notes?.plan)
}

/** Has this subscription been charged at least once? */
function charged(subscription: any): boolean {
  return Number(subscription?.paid_count) > 0
}

/**
 * Copy a Razorpay subscription's state onto the workspace.
 *
 * The workspace has a current subscription and, while changing plan, a pending one (the new plan,
 * starting on the old bill date). Events for any other subscription (replaced, cancelled before its
 * first charge, or left over from test mode) are ignored. `adopt` is for the Checkout result itself.
 * - Pending one approved (auto-pay set up): the current one is cancelled at the end of its month.
 * - Pending one charged: it becomes the current one and its plan applies.
 * - Current one charged: its plan applies (so an upgrade whose new auto-pay was never set up ends
 *   when the old plan renews).
 * - Current one cancelled while a pending one waits: nothing changes; the pending one takes over.
 */
export async function applySubscription(db: any, organizationId: string, subscription: any, options: { adopt?: boolean; cancel?: typeof cancelSubscription } = {}): Promise<void> {
  const { data: current } = await db.from('organization_billing').select('*').eq('organization_id', organizationId).maybeSingle()
  const status = mapSubscriptionStatus(String(subscription?.status || ''))
  const now = new Date().toISOString()

  if (current?.pending_subscription_id && current.pending_subscription_id === subscription?.id) {
    if (status === 'cancelled') {
      // The new plan's auto-pay was stopped before it started: forget it
      await checked(db.from('organization_billing').update({ pending_subscription_id: null, pending_plan: null, updated_at: now }).eq('organization_id', organizationId))
      return
    }
    if (status !== 'active') return
    if (!charged(subscription)) {
      // Approved for a later start: stop the old auto-pay at the end of its month, once
      if (current.razorpay_subscription_id && !current.cancel_at_period_end) {
        await (options.cancel || cancelSubscription)(current.razorpay_subscription_id, fetch, true).catch((error: any) => console.warn('[Billing] Could not stop the old auto-pay:', error?.message))
        await checked(db.from('organization_billing').update({ cancel_at_period_end: true, updated_at: now }).eq('organization_id', organizationId))
      }
      return
    }
    // First charge of the new plan: it becomes the workspace's subscription
    const periodEnd = fromUnix(subscription.current_end) || fromUnix(subscription.charge_at)
    await checked(db.from('organization_billing').update({
      razorpay_subscription_id: subscription.id, pending_subscription_id: null, pending_plan: null,
      plan: subscriptionPlan(subscription), subscription_plan: subscriptionPlan(subscription), status: 'active', cancel_at_period_end: false,
      ...(periodEnd ? { current_period_end: periodEnd } : {}),
      ...(subscription.customer_id ? { razorpay_customer_id: subscription.customer_id } : {}),
      updated_at: now,
    }).eq('organization_id', organizationId))
    return
  }

  if (!options.adopt && current?.razorpay_subscription_id !== subscription?.id) return
  const update: Record<string, any> = { razorpay_subscription_id: subscription.id, updated_at: now }
  // The old plan's auto-pay ending while the new one waits to start: the workspace stays as it is
  const handingOver = Boolean(current?.pending_subscription_id) && status === 'cancelled'
  if (status && !handingOver) update.status = status
  const periodEnd = fromUnix(subscription.current_end) || fromUnix(subscription.charge_at)
  if (periodEnd) update.current_period_end = periodEnd
  if (subscription.customer_id) update.razorpay_customer_id = subscription.customer_id
  // A new subscription (paid, or auto-pay set up for a later start) clears an earlier "cancel at the end of the month"
  if (status === 'active' && !subscription.ended_at && !current?.pending_subscription_id) update.cancel_at_period_end = false
  if (status === 'cancelled' && !handingOver) update.cancel_at_period_end = true
  // The plan follows the subscription that is paying (or set up to pay) for it
  if (status === 'active' && (charged(subscription) || options.adopt) && subscription?.notes?.plan) {
    update.plan = subscriptionPlan(subscription)
    update.subscription_plan = subscriptionPlan(subscription)
  }
  await checked(db.from('organization_billing').update(update).eq('organization_id', organizationId))
}

/**
 * Each plan payment adds the plan's monthly AI credit, once per payment. Never throws: a missing
 * grant must not stop a payment from being recorded.
 */
export async function grantMonthlyAi(db: any, organizationId: string, planId: unknown, paymentId: string, overrides?: Record<string, unknown> | null): Promise<number> {
  const amount = limitsOf(planId, overrides).aiMonthly
  if (!(amount > 0) || !paymentId) return 0
  try {
    const { error } = await db.rpc('ai_wallet_credit', { p_org: organizationId, p_amount: amount, p_kind: 'plan_grant', p_payment_id: `grant_${paymentId}`, p_created_by: null })
    if (error) throw new Error(error.message)
    return amount
  } catch (error: any) {
    console.error('[Billing] Could not add the monthly AI credit:', error?.message)
    return 0
  }
}

/** Record a captured payment once. Returns false when it was already recorded. */
export async function recordPayment(db: any, row: { organization_id: string; purpose: 'subscription' | OrderPurpose; amount_paise: number; razorpay_payment_id: string; razorpay_order_id?: string | null; razorpay_subscription_id?: string | null; plan?: string | null }): Promise<boolean> {
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

const PURPOSE_WORDS: Record<string, string> = { ai_topup: 'an AI credit top-up', message_topup: 'a message wallet top-up', upgrade: 'a plan upgrade' }

/**
 * Apply a one-time payment after checking it with Razorpay: an AI credit top-up, a message wallet
 * top-up, or the difference for an upgrade (the new plan starts at once). It must be for this
 * workspace, within the allowed amounts, and captured (an authorized one is captured first, so nothing
 * is given for money that could still be released). Safe to call twice for one payment.
 */
export async function creditTopup(db: any, organizationId: string, paymentId: string, fetcher: typeof fetch = fetch, expected?: OrderPurpose): Promise<{ credited: boolean; amount: number; purpose: OrderPurpose; plan?: PlanId }> {
  let payment = await fetchPayment(paymentId, fetcher)
  if (!['captured', 'authorized'].includes(String(payment.status))) throw new Error('The payment has not gone through yet.')
  const notes = await topupNotes(payment, fetcher)
  const purpose = String(notes?.purpose || '') as OrderPurpose
  const known = purpose in PURPOSE_WORDS
  if (!known || notes?.organization_id !== organizationId || (expected && purpose !== expected)) {
    throw new Error(`This payment is not ${PURPOSE_WORDS[expected || (known ? purpose : 'ai_topup')]} for this workspace.`)
  }
  const amount = Number(payment.amount) / 100
  const [min, max] = purpose === 'ai_topup' ? [MIN_AI_TOPUP, MAX_AI_TOPUP] : purpose === 'message_topup' ? [MIN_MESSAGE_TOPUP, MAX_MESSAGE_TOPUP] : [1, getPlan('pro_3').amountPaise / 100]
  if (!(amount >= min && amount <= max)) throw new Error('The payment amount is not a valid top-up.')
  if (purpose === 'upgrade' && !isPlanId(notes?.plan)) throw new Error('This upgrade payment does not say which plan it is for.')
  if (payment.status === 'authorized') {
    // Captured automatically a moment later on most accounts; whichever happens first wins
    payment = await capturePayment(paymentId, Number(payment.amount), fetcher).catch(() => fetchPayment(paymentId, fetcher))
    if (payment.status !== 'captured') throw new Error('The payment has not been completed yet. It is added as soon as it is.')
  }
  await getBilling(db, organizationId)
  const plan = purpose === 'upgrade' ? planIdOf(notes?.plan) : undefined
  const fresh = await recordPayment(db, { organization_id: organizationId, purpose, amount_paise: Number(payment.amount), razorpay_payment_id: paymentId, razorpay_order_id: payment.order_id || null, ...(plan ? { plan } : {}) })
  if (purpose === 'ai_topup') {
    await checked(db.rpc('ai_wallet_credit', { p_org: organizationId, p_amount: amount, p_kind: 'topup', p_payment_id: paymentId, p_created_by: null }))
  } else if (purpose === 'message_topup') {
    await creditMessages(db, organizationId, amount, 'topup', paymentId)
  } else if (fresh) {
    // The difference is paid: the bigger plan starts now
    await checked(db.from('organization_billing').update({ plan, updated_at: new Date().toISOString() }).eq('organization_id', organizationId))
  }
  return { credited: fresh, amount, purpose, ...(plan ? { plan } : {}) }
}

/** After Checkout: confirm the subscription with Razorpay and switch the workspace to paid. */
export async function activateSubscription(db: any, organizationId: string, subscriptionId: string, paymentId: string, fetcher: typeof fetch = fetch): Promise<void> {
  const subscription = await fetchSubscription(subscriptionId, fetcher)
  if (subscription.notes?.organization_id && subscription.notes.organization_id !== organizationId) throw new Error('This subscription belongs to another workspace.')
  await applySubscription(db, organizationId, { ...subscription, status: mapSubscriptionStatus(subscription.status) ? subscription.status : 'active' }, { adopt: true })
  // Charged straight away: record it. Auto-pay set up for a later start has only authorised a small
  // verification amount; the real charge is recorded by the webhook when it happens.
  if (subscription.status === 'active' && Number(subscription.paid_count) > 0) {
    const plan = subscriptionPlan(subscription)
    const fresh = await recordPayment(db, { organization_id: organizationId, purpose: 'subscription', amount_paise: getPlan(plan).amountPaise, razorpay_payment_id: paymentId, razorpay_subscription_id: subscriptionId, plan })
    if (fresh) await grantMonthlyAi(db, organizationId, plan, paymentId, (await getBilling(db, organizationId))?.plan_overrides)
  }
}

/**
 * Stop auto-pay. Before the first charge (auto-pay set up during the trial) there is no billing
 * cycle to finish, so the subscription is cancelled at once and the workspace simply carries on
 * with its free trial. Once paying, renewal stops and access lasts to the end of the paid month.
 */
export async function stopAutoPay(db: any, organizationId: string, fetcher: typeof fetch = fetch): Promise<{ accessUntil: string | null; trial: boolean }> {
  const billing = await getBilling(db, organizationId)
  if (!billing?.razorpay_subscription_id || billing.status !== 'active') throw new Error('There is no active plan to cancel.')
  const subscription = await fetchSubscription(billing.razorpay_subscription_id, fetcher)
  const beforeFirstCharge = ['created', 'authenticated'].includes(String(subscription.status)) || !(Number(subscription.paid_count) > 0)
  if (beforeFirstCharge) {
    await cancelSubscription(billing.razorpay_subscription_id, fetcher, false)
    await checked(db.from('organization_billing').update({ status: 'trialing', razorpay_subscription_id: null, current_period_end: null, cancel_at_period_end: false, updated_at: new Date().toISOString() }).eq('organization_id', organizationId))
    return { accessUntil: billing.trial_ends_at, trial: true }
  }
  await cancelSubscription(billing.razorpay_subscription_id, fetcher, true)
  // A plan change waiting to start is stopped too
  if (billing.pending_subscription_id) await cancelSubscription(billing.pending_subscription_id, fetcher, false).catch((error: any) => console.warn('[Billing] Could not stop the waiting plan change:', error?.message))
  await checked(db.from('organization_billing').update({ cancel_at_period_end: true, pending_subscription_id: null, pending_plan: null, updated_at: new Date().toISOString() }).eq('organization_id', organizationId))
  return { accessUntil: billing.current_period_end, trial: false }
}

/** What the billing page and the app's gate need to know. */
/** A plan as the pages and the app show it. */
export function planView(planId: unknown) {
  const plan = getPlan(planId)
  return { id: plan.id, name: plan.name, tagline: plan.tagline, price: plan.amountPaise / 100, currency: PLAN_CURRENCY, interval: PLAN_INTERVAL, whatsapp: plan.whatsapp, features: plan.features, limits: plan.limits }
}

export async function billingSummary(db: any, organizationId: string, options: { payments?: boolean } = {}) {
  const row = await getBilling(db, organizationId)
  const state = billingState(row)
  const limits = billingLimits(row)
  let payments: { purpose: string; amount: number; date: string; plan?: string | null }[] = []
  let messages: Awaited<ReturnType<typeof messageHistory>> = []
  // Auto-pay set up but not charged yet (subscribed during the trial): no plan payment recorded so far
  let autoPayPending = false
  if (row?.razorpay_subscription_id && row.status === 'active') {
    const { count } = await db.from('billing_payments').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('purpose', 'subscription')
    autoPayPending = !count
  }
  if (options.payments && row) {
    const { data } = await db.from('billing_payments').select('*').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(12)
    payments = (data || []).map((payment: any) => ({ purpose: payment.purpose, amount: Number(payment.amount_paise) / 100, date: payment.created_at, plan: payment.plan || null }))
    messages = await messageHistory(db, organizationId, 20)
  }
  return {
    configured: row !== null,
    plan: planView(row?.plan),
    plans: PLANS.map((plan) => planView(plan.id)),
    limits,
    allows: allowsMap(limits),
    pendingPlan: row?.pending_plan ? planView(row.pending_plan) : null,
    whatsappMode: row?.whatsapp_mode === 'shared' ? 'shared' as const : 'own' as const,
    messageBalance: Math.round((Number(row?.message_balance) || 0) * 100) / 100,
    messagePrices: messagePrices(),
    messageLow: Number(row?.message_balance || 0) < LOW_MESSAGE_BALANCE && row?.whatsapp_mode === 'shared',
    messages,
    ...state,
    trialDays: TRIAL_DAYS,
    hasSubscription: Boolean(row?.razorpay_subscription_id) && ['active', 'past_due'].includes(String(row?.status)),
    autoPayPending,
    trialEndsAt: row?.trial_ends_at || null,
    payments,
  }
}

export type PlanChange =
  /** Not paying yet (trial, or plan ended): the plan changed at once, for free */
  | { kind: 'switched'; plan: PlanId; autoPayCleared: boolean }
  /** Upgrade: pay the difference for the days left this month, then set up auto-pay for the new price */
  | { kind: 'pay_difference'; plan: PlanId; orderId: string; amount: number; currency: string }
  /** Set up auto-pay for the new plan; the first charge is on the old plan's bill date */
  | { kind: 'auto_pay'; plan: PlanId; subscriptionId: string; startsAt: string | null }

/**
 * Change a workspace's plan (see docs/PLAN-plans-signin-stores.md, 1d):
 * - Trial or not paying: switch now, free. Auto-pay set up during the trial is for the old price, so it
 *   is stopped and asked for again.
 * - Upgrade while paying: pay the difference for the days left (the bigger plan starts once paid), then
 *   auto-pay for the new price from the bill date.
 * - Downgrade while paying: auto-pay for the smaller plan from the bill date; the plan changes then.
 * Razorpay cannot change the amount of an auto-pay, so a new one replaces the old at the bill date.
 */
export async function changePlan(db: any, organizationId: string, target: PlanId, fetcher: typeof fetch = fetch, now = Date.now()): Promise<PlanChange> {
  if (!isPlanId(target)) throw new Error('Choose a plan.')
  const billing = await getBilling(db, organizationId)
  if (!billing) throw new Error('Billing is not set up yet. Please contact support.')
  if (billing.billing_exempt) throw new Error('This workspace does not need a plan.')
  const stamp = new Date(now).toISOString()
  const current = billing.razorpay_subscription_id ? await fetchSubscription(billing.razorpay_subscription_id, fetcher).catch(() => null) : null
  // Paying = a month has been paid for and is still running (even when auto-pay was stopped: an upgrade
  // still pays the difference, so stopping auto-pay can never give a bigger plan for free)
  const paying = Boolean(current) && charged(current) && ['active', 'past_due'].includes(billing.status)

  if (!paying) {
    let autoPayCleared = false
    if (current && ['created', 'authenticated'].includes(String(current.status)) && planIdOf(current.notes?.plan) !== target) {
      await cancelSubscription(current.id, fetcher, false).catch((error: any) => console.warn('[Billing] Could not stop the trial auto-pay:', error?.message))
      autoPayCleared = true
    }
    const update: Record<string, any> = { plan: target, pending_plan: null, pending_subscription_id: null, updated_at: stamp }
    if (autoPayCleared) Object.assign(update, { razorpay_subscription_id: null, subscription_plan: null, status: 'trialing', current_period_end: null, cancel_at_period_end: false })
    await checked(db.from('organization_billing').update(update).eq('organization_id', organizationId))
    return { kind: 'switched', plan: target, autoPayCleared }
  }

  const autoPayPlan = planIdOf(current!.notes?.plan)
  if (billing.pending_subscription_id) {
    if (billing.pending_plan !== target) throw new Error(`A change to ${getPlan(billing.pending_plan).name} is already waiting to start. Contact support to change it.`)
    const pending = await fetchSubscription(billing.pending_subscription_id, fetcher).catch(() => null)
    if (pending?.status === 'created') return { kind: 'auto_pay', plan: target, subscriptionId: pending.id, startsAt: fromUnix(pending.start_at) }
    throw new Error(`Your change to ${getPlan(target).name} is set up. It starts on your next bill date.`)
  }
  if (autoPayPlan === target && planIdOf(billing.plan) === target) throw new Error(`You are already on ${getPlan(target).name}.`)

  // Upgrade: the difference for the days left first (not when it was already paid: the plan is already the bigger one)
  if (planDirection(billing.plan, target) === 'up') {
    const difference = upgradeDifferencePaise(billing.plan, target, billing.current_period_end, now)
    if (difference > 0) {
      const order = await createTopupOrder(organizationId, difference / 100, fetcher, 'upgrade', { plan: target })
      return { kind: 'pay_difference', plan: target, orderId: order.id, amount: order.amount, currency: order.currency }
    }
    await checked(db.from('organization_billing').update({ plan: target, updated_at: stamp }).eq('organization_id', organizationId))
  }

  // Auto-pay for the new price, first charge on the bill date (now if the month is already over)
  const periodEnd = billing.current_period_end ? Date.parse(billing.current_period_end) : NaN
  const startAt = Number.isFinite(periodEnd) && periodEnd - now > 60 * 60 * 1000 ? Math.floor(periodEnd / 1000) : undefined
  const created = await createSubscription(organizationId, { plan: target, startAt }, fetcher)
  await checked(db.from('organization_billing').update({ pending_subscription_id: created.id, pending_plan: target, updated_at: stamp }).eq('organization_id', organizationId))
  return { kind: 'auto_pay', plan: target, subscriptionId: created.id, startsAt: startAt ? new Date(startAt * 1000).toISOString() : null }
}

/** After Checkout for a plan change's auto-pay: check it with Razorpay and apply it (see applySubscription). */
export async function confirmPlanAutoPay(db: any, organizationId: string, subscriptionId: string, fetcher: typeof fetch = fetch): Promise<void> {
  const billing = await getBilling(db, organizationId)
  if (!billing || billing.pending_subscription_id !== subscriptionId) throw new Error('This payment is for a different plan change.')
  const subscription = await fetchSubscription(subscriptionId, fetcher)
  if (subscription.notes?.organization_id && subscription.notes.organization_id !== organizationId) throw new Error('This subscription belongs to another workspace.')
  await applySubscription(db, organizationId, subscription, { cancel: (id, _fetcher, atCycleEnd) => cancelSubscription(id, fetcher, atCycleEnd) })
}

/**
 * A new workspace starts its trial on the plan picked on the pricing page. Starter uses WAMA's number
 * and Front Desk only, so the other connectors (on by default) are switched off. Best effort: a
 * failure leaves the default plan (Growth) and never fails the sign-up.
 */
export async function startPlan(db: any, organizationId: string, plan: unknown): Promise<void> {
  if (!isPlanId(plan)) return
  try {
    const billing = await getBilling(db, organizationId)
    if (!billing || billing.billing_exempt) return
    const shared = getPlan(plan).whatsapp === 'shared'
    const { error } = await withPlansSchema(() => db.from('organization_billing').update({ plan, whatsapp_mode: shared ? 'shared' : 'own', updated_at: new Date().toISOString() }).eq('organization_id', organizationId))
    if (error) throw new Error(error.message)
    if (shared) await db.from('organizations').update({ enabled_connectors: ['salon'], enable_commerce: false, enable_pipeline: false }).eq('id', organizationId)
  } catch (error: any) {
    console.error('[Billing] Could not start the chosen plan:', error?.message)
  }
}
