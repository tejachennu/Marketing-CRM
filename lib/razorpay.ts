/**
 * Razorpay for WAMA CRM's own billing: the monthly plan (Subscriptions API) and AI wallet top-ups
 * (Orders API). Keys come from the environment only: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and, for
 * the webhook, RAZORPAY_WEBHOOK_SECRET.
 *
 * This is separate from the stores' own Razorpay (WhatsApp Pay), which never uses these keys.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { PLAN } from './billing'

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

/** The Razorpay plan for WAMA CRM Pro: found by its notes, created once if missing. */
export async function ensurePlan(fetcher: typeof fetch = fetch): Promise<string> {
  const configured = String(process.env.RAZORPAY_PLAN_ID || '').trim()
  if (configured) return configured
  const plans = await call('/plans?count=100', {}, fetcher)
  const existing = (plans.items || []).find((plan: any) =>
    plan.notes?.app === 'wamacrm' && plan.notes?.plan === PLAN.id && Number(plan.item?.amount) === PLAN.amountPaise && plan.period === PLAN.interval)
  if (existing) return existing.id
  const created = await call('/plans', {
    method: 'POST',
    body: {
      period: PLAN.interval,
      interval: 1,
      item: { name: PLAN.name, amount: PLAN.amountPaise, currency: PLAN.currency, description: 'WAMA CRM, every feature, billed monthly' },
      notes: { app: 'wamacrm', plan: PLAN.id },
    },
  }, fetcher)
  return created.id
}

/**
 * A subscription for one workspace, set up in Razorpay Checkout. With `startAt` (Unix seconds) the
 * customer only authorises auto-pay now and the first ₹3,000 is charged on that date, so subscribing
 * during the trial (or before a paid month runs out) never costs them the days they already have.
 */
export async function createSubscription(organizationId: string, options: { startAt?: number } = {}, fetcher: typeof fetch = fetch): Promise<{ id: string; status: string; start_at?: number; short_url?: string }> {
  const planId = await ensurePlan(fetcher)
  return call('/subscriptions', {
    method: 'POST',
    body: {
      plan_id: planId, total_count: 120, quantity: 1, customer_notify: 1,
      ...(options.startAt ? { start_at: options.startAt } : {}),
      notes: { app: 'wamacrm', organization_id: organizationId },
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

/** An order for an AI wallet top-up. */
export function createTopupOrder(organizationId: string, rupees: number, fetcher: typeof fetch = fetch): Promise<{ id: string; amount: number; currency: string }> {
  return call('/orders', {
    method: 'POST',
    body: {
      amount: Math.round(rupees * 100),
      currency: 'INR',
      receipt: `ai_${organizationId.slice(0, 8)}_${Date.now()}`,
      notes: { app: 'wamacrm', purpose: 'ai_topup', organization_id: organizationId },
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
