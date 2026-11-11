/**
 * Razorpay for WAMA CRM's own billing: the monthly plans (Subscriptions API), and wallet top-ups and
 * upgrade differences (Orders API). Keys come from the environment only: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and, for
 * the webhook, RAZORPAY_WEBHOOK_SECRET.
 *
 * This is separate from the stores' own Razorpay (WhatsApp Pay), which never uses these keys.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { getPlan, PLAN_CURRENCY, PLAN_INTERVAL, type PlanId } from './plans'

const API = 'https://api.razorpay.com/v1'

export function razorpayKeys(): { keyId: string; keySecret: string } | null {
  const keyId = String(process.env.RAZORPAY_KEY_ID || '').trim()
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || '').trim()
  return keyId && keySecret ? { keyId, keySecret } : null
}

export class RazorpayError extends Error {
  constructor(message: string, public status?: number) { super(message) }
}

async function call(path: string, init: { method?: string; body?: unknown } = {}, fetcher: typeof fetch = fetch): Promise<any> {
  const keys = razorpayKeys()
  if (!keys) throw new RazorpayError('Payments are not set up yet: add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.')
  const response = await fetcher(`${API}${path}`, {
    method: init.method || 'GET',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${keys.keyId}:${keys.keySecret}`).toString('base64'),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20000),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new RazorpayError(data?.error?.description || `Razorpay returned HTTP ${response.status}`, response.status)
  return data
}

/**
 * The env name for a WAMA plan's Razorpay plan id (RAZORPAY_PLAN_GROWTH…), set in Vercel only to pin one.
 * The old RAZORPAY_PLAN_ID was the ₹3,000 plan, so it is no longer used.
 */
export function planEnvName(planId: PlanId): string {
  return `RAZORPAY_PLAN_${planId.toUpperCase()}`
}

/**
 * The Razorpay plan for a WAMA plan: the id set in the environment, else found by its notes and price,
 * else created once. So nothing has to be set up by hand in Razorpay.
 */
export async function ensurePlan(planId: PlanId = 'growth', fetcher: typeof fetch = fetch): Promise<string> {
  const configured = String(process.env[planEnvName(planId)] || '').trim()
  if (configured) return configured
  const plan = getPlan(planId)
  const plans = await call('/plans?count=100', {}, fetcher)
  const existing = (plans.items || []).find((item: any) =>
    item.notes?.app === 'wamacrm' && item.notes?.plan === plan.id && Number(item.item?.amount) === plan.amountPaise && item.period === PLAN_INTERVAL)
  if (existing) return existing.id
  const created = await call('/plans', {
    method: 'POST',
    body: {
      period: PLAN_INTERVAL,
      interval: 1,
      item: { name: `WAMA CRM ${plan.name}`, amount: plan.amountPaise, currency: PLAN_CURRENCY, description: `WAMA CRM ${plan.name}, billed monthly` },
      notes: { app: 'wamacrm', plan: plan.id },
    },
  }, fetcher)
  return created.id
}

/**
 * A subscription for one workspace, set up in Razorpay Checkout. With `startAt` (Unix seconds) the
 * customer only authorises auto-pay now and the first charge happens on that date, so subscribing
 * during the trial (or before a paid month runs out) never costs them the days they already have.
 */
export async function createSubscription(organizationId: string, options: { startAt?: number; plan?: PlanId } = {}, fetcher: typeof fetch = fetch): Promise<{ id: string; status: string; start_at?: number; short_url?: string }> {
  const plan = options.plan || 'growth'
  const planId = await ensurePlan(plan, fetcher)
  return call('/subscriptions', {
    method: 'POST',
    body: {
      plan_id: planId, total_count: 120, quantity: 1, customer_notify: 1,
      ...(options.startAt ? { start_at: options.startAt } : {}),
      notes: { app: 'wamacrm', organization_id: organizationId, plan },
    },
  }, fetcher)
}

export function fetchSubscription(id: string, fetcher: typeof fetch = fetch) {
  return call(`/subscriptions/${encodeURIComponent(id)}`, {}, fetcher)
}

/** Cancel at the end of the paid month (the workspace keeps access until then), or straight away. */
export function cancelSubscription(id: string, fetcher: typeof fetch = fetch, atCycleEnd = true) {
  return call(`/subscriptions/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: { cancel_at_cycle_end: atCycleEnd ? 1 : 0 } }, fetcher)
}

export type OrderPurpose = 'ai_topup' | 'message_topup' | 'upgrade'

/** A one-time order: an AI or message wallet top-up, or the difference for an upgrade (`plan` in its notes). */
export function createTopupOrder(organizationId: string, rupees: number, fetcher: typeof fetch = fetch, purpose: OrderPurpose = 'ai_topup', extraNotes: Record<string, string> = {}): Promise<{ id: string; amount: number; currency: string }> {
  const prefix = purpose === 'ai_topup' ? 'ai' : purpose === 'message_topup' ? 'msg' : 'up'
  return call('/orders', {
    method: 'POST',
    body: {
      amount: Math.round(rupees * 100),
      currency: 'INR',
      receipt: `${prefix}_${organizationId.slice(0, 8)}_${Date.now()}`,
      notes: { app: 'wamacrm', purpose, organization_id: organizationId, ...extraNotes },
    },
  }, fetcher)
}

export function fetchOrder(id: string, fetcher: typeof fetch = fetch) {
  return call(`/orders/${encodeURIComponent(id)}`, {}, fetcher)
}

export function fetchPayment(id: string, fetcher: typeof fetch = fetch) {
  return call(`/payments/${encodeURIComponent(id)}`, {}, fetcher)
}

/** Capture an authorized payment (when the account does not capture automatically). */
export function capturePayment(id: string, amountPaise: number, fetcher: typeof fetch = fetch) {
  return call(`/payments/${encodeURIComponent(id)}/capture`, { method: 'POST', body: { amount: amountPaise, currency: 'INR' } }, fetcher)
}

function hmac(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

function same(expected: string, received: unknown): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(String(received || ''))
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Checkout's signature for an order payment: HMAC(order_id|payment_id). */
export function verifyOrderSignature(orderId: string, paymentId: string, signature: unknown): boolean {
  const keys = razorpayKeys()
  return Boolean(keys) && same(hmac(keys!.keySecret, `${orderId}|${paymentId}`), signature)
}

/** Checkout's signature for a subscription payment: HMAC(payment_id|subscription_id). */
export function verifySubscriptionSignature(paymentId: string, subscriptionId: string, signature: unknown): boolean {
  const keys = razorpayKeys()
  return Boolean(keys) && same(hmac(keys!.keySecret, `${paymentId}|${subscriptionId}`), signature)
}

/** A webhook's X-Razorpay-Signature over the raw body. */
export function verifyWebhookSignature(rawBody: string, signature: unknown): boolean {
  const secret = String(process.env.RAZORPAY_WEBHOOK_SECRET || '').trim()
  return Boolean(secret) && same(hmac(secret, rawBody), signature)
}
