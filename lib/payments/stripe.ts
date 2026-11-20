/**
 * Stripe for a business's OWN Stripe account (money goes straight to the business, not to WAMA CRM), used by the
 * store page and by bookings. Plain REST calls (form-encoded, as Stripe's API takes them), no SDK.
 *
 * Customers pay on Stripe's own Checkout page: we create a Checkout Session, send the customer to its url, and
 * Stripe sends them back to our page with ?session=<id>. A payment counts only when Stripe itself says the session
 * is paid (asked with the secret key) or its signed webhook says so.
 *
 * Keys live in organizations.stripe_secret_key / stripe_webhook_secret (server only; never sent to any page).
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

const API = 'https://api.stripe.com/v1'

export interface StripeKeys { secretKey: string; webhookSecret: string }

export function stripeKeys(org: Record<string, any> | null | undefined): StripeKeys | null {
  const secretKey = String(org?.stripe_secret_key || '').trim()
  return secretKey ? { secretKey, webhookSecret: String(org?.stripe_webhook_secret || '').trim() } : null
}

/** A secret key (sk_live_…, sk_test_…) or a restricted key (rk_live_…, rk_test_…). */
export function isStripeKey(value: unknown): boolean {
  return /^(sk|rk)_(live|test)_[A-Za-z0-9]{10,250}$/.test(String(value ?? '').trim())
}

/** A webhook signing secret: whsec_… */
export function isStripeWebhookSecret(value: unknown): boolean {
  return /^whsec_[A-Za-z0-9+/=]{10,200}$/.test(String(value ?? '').trim())
}

export const stripeLive = (secretKey: string) => /^(sk|rk)_live_/.test(secretKey)

/** Currencies Stripe counts in whole units (no paise / cents). */
const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'])

/** An amount in the smallest unit Stripe counts (₹120.50 → 12050). */
export function minorUnits(amount: number, currency: string): number {
  const value = Number(amount) || 0
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? Math.round(value) : Math.round(value * 100)
}

/** And back: 12050 → 120.5 */
export function majorUnits(minor: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? Number(minor) || 0 : Math.round(Number(minor) || 0) / 100
}

/**
 * Stripe's form encoding: nested objects and lists as brackets (metadata[order]=1, line_items[0][quantity]=1).
 * Empty values are left out.
 */
export function formBody(data: Record<string, unknown>): string {
  const parts: string[] = []
  const add = (key: string, value: unknown) => {
    if (value === undefined || value === null || value === '') return
    if (Array.isArray(value)) value.forEach((item, i) => add(`${key}[${i}]`, item))
    else if (typeof value === 'object') for (const [k, v] of Object.entries(value as Record<string, unknown>)) add(`${key}[${k}]`, v)
    else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  }
  for (const [key, value] of Object.entries(data)) add(key, value)
  return parts.join('&')
}

async function call(secretKey: string, path: string, init: { method?: string; form?: Record<string, unknown>; idempotencyKey?: string } = {}, fetcher: typeof fetch = fetch) {
  const res = await fetcher(`${API}${path}`, {
    method: init.method || 'GET',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(init.form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(init.idempotencyKey ? { 'Idempotency-Key': init.idempotencyKey } : {}),
    },
    ...(init.form ? { body: formBody(init.form) } : {}),
    // A slow Stripe must not keep the customer waiting until the server gives up
    signal: AbortSignal.timeout(15000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const reason = data?.error?.message || `Stripe answered ${res.status}`
    throw Object.assign(new Error(res.status === 401 ? 'Stripe did not accept this key. Copy the Secret key again from Stripe → Developers → API keys.' : reason), { status: res.status })
  }
  return data
}

/** Does this key work? (Lists one Checkout Session; nothing is created or charged.) */
export async function checkStripeKey(secretKey: string, fetcher: typeof fetch = fetch): Promise<{ ok: true; live: boolean } | { ok: false; error: string }> {
  try {
    await call(secretKey, '/checkout/sessions?limit=1', {}, fetcher)
    return { ok: true, live: stripeLive(secretKey) }
  } catch (error: any) {
    if (error?.status === 403) return { ok: false, error: 'This restricted key cannot use Checkout. Give it "Checkout Sessions: Write" in Stripe, or use the Secret key.' }
    return { ok: false, error: error?.message || 'Stripe could not be reached. Try again.' }
  }
}

export interface CheckoutInput {
  /** The amount to pay, in rupees (or the currency's main unit) */
  amount: number
  currency: string
  /** What the customer sees on Stripe's page */
  title: string
  description?: string
  /** Our record, kept on the session (and its payment) so the webhook can find it */
  metadata: Record<string, string>
  /** Our id for this payment (order number, booking id) */
  reference: string
  successUrl: string
  cancelUrl: string
  email?: string | null
  /** How long the customer has to pay; Stripe allows 30 minutes to 24 hours */
  minutes?: number
}

/** Stripe's {CHECKOUT_SESSION_ID} placeholder, filled in by Stripe on the way back. */
export const SESSION_PLACEHOLDER = '{CHECKOUT_SESSION_ID}'

/** The form Stripe takes for a one-off Checkout payment (pure, for the tests). */
export function checkoutForm(input: CheckoutInput, now = Date.now()): Record<string, unknown> {
  const currency = input.currency.toLowerCase()
  const minutes = Math.min(24 * 60, Math.max(30, Math.round(input.minutes || 30)))
  return {
    mode: 'payment',
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.reference.slice(0, 200),
    customer_email: input.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ? input.email : undefined,
    expires_at: Math.floor(now / 1000) + minutes * 60 + 30,
    line_items: [{ quantity: 1, price_data: { currency, unit_amount: minorUnits(input.amount, input.currency), product_data: { name: input.title.slice(0, 250), description: input.description ? input.description.slice(0, 500) : undefined } } }],
    metadata: input.metadata,
    payment_intent_data: { metadata: input.metadata, description: input.title.slice(0, 250) },
  }
}

/** A Stripe Checkout page for one payment. Returns its id and the page to send the customer to. */
export async function createCheckout(secretKey: string, input: CheckoutInput, fetcher: typeof fetch = fetch): Promise<{ id: string; url: string }> {
  if (minorUnits(input.amount, input.currency) < 50) throw new Error('The amount is too small to pay online.')
  const data = await call(secretKey, '/checkout/sessions', { method: 'POST', form: checkoutForm(input), idempotencyKey: `wama-${input.reference}-${Math.round(input.amount * 100)}-${Math.floor(Date.now() / 60_000)}` }, fetcher)
  if (!data?.id || !data?.url) throw new Error('Stripe did not open a payment page.')
  return { id: String(data.id), url: String(data.url) }
}

export interface CheckoutState {
  id: string
  paid: boolean
  /** In the smallest unit (paise / cents) */
  amount: number
  currency: string
  paymentIntent: string
  metadata: Record<string, string>
  expired: boolean
}

/** What a Checkout Session says (read from Stripe, or from a webhook's event). */
export function readCheckout(session: any): CheckoutState {
  return {
    id: String(session?.id || ''),
    paid: session?.payment_status === 'paid',
    amount: Number(session?.amount_total) || 0,
    currency: String(session?.currency || '').toUpperCase(),
    paymentIntent: String(typeof session?.payment_intent === 'object' ? session?.payment_intent?.id || '' : session?.payment_intent || ''),
    metadata: session?.metadata && typeof session.metadata === 'object' ? session.metadata : {},
    expired: session?.status === 'expired',
  }
}

/** Ask Stripe about a Checkout Session. */
export async function getCheckout(secretKey: string, sessionId: string, fetcher: typeof fetch = fetch): Promise<CheckoutState> {
  if (!/^cs_(live|test)_[A-Za-z0-9]{10,200}$/.test(sessionId)) throw new Error('That payment could not be found.')
  return readCheckout(await call(secretKey, `/checkout/sessions/${encodeURIComponent(sessionId)}`, {}, fetcher))
}

/** Give money back for a payment (all or part, in the smallest unit), through the business's Stripe. */
export async function refundStripe(secretKey: string, paymentIntent: string, amountMinor: number, metadata: Record<string, string>, fetcher: typeof fetch = fetch): Promise<{ id: string; status: string }> {
  const data = await call(secretKey, '/refunds', { method: 'POST', form: { payment_intent: paymentIntent, amount: Math.round(amountMinor), metadata } }, fetcher)
  return { id: String(data?.id || ''), status: String(data?.status || 'pending') }
}

/**
 * A Stripe webhook's signature. The Stripe-Signature header is "t=<seconds>,v1=<hex>[,v1=…]"; the hex is
 * HMAC-SHA256 of "<t>.<raw body>" with the webhook secret. Events older than 5 minutes are refused.
 */
export function verifyStripeWebhook(webhookSecret: string, rawBody: string, header: unknown, now = Date.now(), toleranceSeconds = 300): boolean {
  if (!webhookSecret) return false
  const pairs = String(header ?? '').split(',').map((part) => part.trim().split('='))
  const t = pairs.find(([k]) => k === 't')?.[1] || ''
  const signatures = pairs.filter(([k]) => k === 'v1').map(([, v]) => v || '')
  if (!/^\d{1,12}$/.test(t) || !signatures.length) return false
  if (Math.abs(Math.floor(now / 1000) - Number(t)) > toleranceSeconds) return false
  const want = Buffer.from(createHmac('sha256', webhookSecret).update(`${t}.${rawBody}`).digest('hex'))
  return signatures.some((sig) => {
    const given = Buffer.from(sig)
    return given.length === want.length && timingSafeEqual(given, want)
  })
}
