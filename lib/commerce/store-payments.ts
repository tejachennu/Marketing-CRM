/**
 * Online payment on the store page with the business's OWN Razorpay account (money goes straight to the
 * business, not to WAMA CRM). The keys live in organizations.store_razorpay_* (server only; the secret is
 * never sent to any page). A payment counts only when Razorpay's signature checks out, or Razorpay itself
 * says the order is paid; an order is marked paid once, whichever of the page, the webhook or a check
 * gets there first.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { formatMoney } from './commerce-utils'
import { sendPush } from '../push'
import { isUuid } from '../record-visibility'

const API = 'https://api.razorpay.com/v1'

export interface StoreRazorpayKeys {
  keyId: string
  keySecret: string
}

export function storeRazorpayKeys(org: Record<string, any> | null | undefined): StoreRazorpayKeys | null {
  const keyId = String(org?.store_razorpay_key_id || '').trim()
  const keySecret = String(org?.store_razorpay_key_secret || '').trim()
  return keyId && keySecret ? { keyId, keySecret } : null
}

/** A Key ID looks like rzp_live_… or rzp_test_… */
export function isKeyId(value: unknown): boolean {
  return /^rzp_(live|test)_[A-Za-z0-9]{6,40}$/.test(String(value ?? '').trim())
}

async function call(keys: StoreRazorpayKeys, path: string, init: { method?: string; body?: unknown } = {}, fetcher: typeof fetch = fetch) {
  const res = await fetcher(`${API}${path}`, {
    method: init.method || 'GET',
    headers: { Authorization: 'Basic ' + Buffer.from(`${keys.keyId}:${keys.keySecret}`).toString('base64'), 'Content-Type': 'application/json' },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    // A slow Razorpay must not keep the customer waiting until the server gives up
    signal: AbortSignal.timeout(15000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const reason = data?.error?.description || `Razorpay answered ${res.status}`
    throw Object.assign(new Error(res.status === 401 ? 'Razorpay did not accept these keys. Copy the Key ID and Key Secret again from Razorpay → Account & Settings → API Keys.' : reason), { status: res.status })
  }
  return data
}

/** Do these keys work? (Reads one order; nothing is created or charged.) */
export async function checkStoreKeys(keys: StoreRazorpayKeys, fetcher: typeof fetch = fetch): Promise<{ ok: true; live: boolean } | { ok: false; error: string }> {
  try {
    await call(keys, '/orders?count=1', {}, fetcher)
    return { ok: true, live: keys.keyId.startsWith('rzp_live_') }
  } catch (error: any) {
    return { ok: false, error: error?.message || 'Razorpay could not be reached. Try again.' }
  }
}

/** A Razorpay order for the amount to pay (in paise), tied to our order by its notes. */
export async function createStorePayment(keys: StoreRazorpayKeys, order: { id: string; order_number: string; total_amount: unknown; currency?: string | null }, fetcher: typeof fetch = fetch): Promise<{ id: string; amount: number; currency: string }> {
  const amount = Math.round((Number(order.total_amount) || 0) * 100)
  if (amount < 100) throw new Error('The amount is too small to pay online.')
  const data = await call(keys, '/orders', { method: 'POST', body: { amount, currency: String(order.currency || 'INR').toUpperCase(), receipt: order.order_number.slice(0, 40), payment_capture: 1, notes: { wama_order_id: order.id, wama_order_number: order.order_number } } }, fetcher)
  return { id: data.id, amount: data.amount, currency: data.currency }
}

/** Razorpay's checkout signature: HMAC-SHA256 of "<order id>|<payment id>" with the key secret. */
export function verifyStoreSignature(keySecret: string, razorpayOrderId: string, paymentId: string, signature: unknown): boolean {
  const expected = createHmac('sha256', keySecret).update(`${razorpayOrderId}|${paymentId}`).digest('hex')
  const given = Buffer.from(String(signature ?? ''))
  const want = Buffer.from(expected)
  return given.length === want.length && timingSafeEqual(given, want)
}

/** A Razorpay webhook's signature: HMAC-SHA256 of the raw body with the webhook secret. */
export function verifyStoreWebhook(webhookSecret: string, rawBody: string, signature: unknown): boolean {
  if (!webhookSecret) return false
  const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex')
  const given = Buffer.from(String(signature ?? ''))
  const want = Buffer.from(expected)
  return given.length === want.length && timingSafeEqual(given, want)
}

/** Has this Razorpay order been paid? Returns the captured payment, if any. */
export async function paidPayment(keys: StoreRazorpayKeys, razorpayOrderId: string, fetcher: typeof fetch = fetch): Promise<{ id: string; amount: number } | null> {
  const data = await call(keys, `/orders/${encodeURIComponent(razorpayOrderId)}/payments`, {}, fetcher)
  const paid = (data?.items || []).find((p: any) => p.status === 'captured')
  return paid ? { id: String(paid.id), amount: Number(paid.amount) || 0 } : null
}

/**
 * Give money back for a captured payment (all or part, in paise), through the shop's own Razorpay.
 * Razorpay sends it to the same card, UPI or bank account. Returns its refund id and status.
 */
export async function refundStorePayment(keys: StoreRazorpayKeys, paymentId: string, amountPaise: number, notes: Record<string, string>, fetcher: typeof fetch = fetch): Promise<{ id: string; status: string }> {
  const data = await call(keys, `/payments/${encodeURIComponent(paymentId)}/refund`, { method: 'POST', body: { amount: Math.round(amountPaise), speed: 'normal', notes } }, fetcher)
  return { id: String(data?.id || ''), status: String(data?.status || 'pending') }
}

/** The Razorpay order id our order waits on (kept with the order's delivery details). */
export function razorpayOrderOf(order: { shipping_address?: any }): string {
  return String(order?.shipping_address?.payment?.order_id || '')
}

/**
 * Mark a website order paid (once). The amount must match the order. Records the transaction, and tells
 * the team. Returns true when this call marked it.
 */
export async function markStoreOrderPaid(db: any, order: any, payment: { id: string; amount: number }): Promise<boolean> {
  const expected = Math.round((Number(order.total_amount) || 0) * 100)
  if (payment.amount !== expected) {
    console.warn(`[Store payment] Order ${order.order_number}: paid ${payment.amount} paise, expected ${expected}`)
    return false
  }
  const shipping = { ...(order.shipping_address || {}), payment: { ...(order.shipping_address?.payment || {}), payment_id: payment.id, paid_at: new Date().toISOString() } }
  const { data: marked } = await db.from('commerce_orders')
    .update({ status: order.status === 'payment_pending' ? 'paid' : order.status, payment_status: 'paid', payment_method: 'razorpay', shipping_address: shipping, updated_at: new Date().toISOString() })
    .eq('id', order.id)
    .eq('organization_id', order.organization_id)
    .neq('payment_status', 'paid')
    .select('id')
  if (!marked || marked.length === 0) return false
  await db.from('commerce_transactions').insert({ order_id: order.id, organization_id: order.organization_id, gateway: 'razorpay', transaction_id: payment.id, amount: payment.amount / 100, currency: order.currency || 'INR', status: 'captured', raw_payload: { source: 'store_page' } })
  const name = String(order.shipping_address?.full_name || '').trim()
  await sendPush(db, { organizationId: order.organization_id }, {
    kind: 'order',
    title: `Paid online · ${formatMoney(order.total_amount, order.currency)}`,
    body: `Website order #${order.order_number}${name ? ` from ${name}` : ''} is paid and ready to ${order.shipping_address?.handover === 'delivery' ? 'send' : 'hand over'}.`,
    open: 'orders',
    tag: `order:${order.id}`,
  })
  return true
}

/**
 * Our order for a Razorpay event. Our ids ride on the Razorpay ORDER's notes (Razorpay does not copy them to
 * the payment), so look there first, then the payment's notes, then the Razorpay order id we kept.
 */
export async function findStoreOrder(db: any, organizationId: string, event: any) {
  const payment = event?.payload?.payment?.entity || {}
  const notes = { ...(payment.notes || {}), ...(event?.payload?.order?.entity?.notes || {}) }
  const base = () => db.from('commerce_orders').select('*').eq('organization_id', organizationId)
  const id = String(notes.wama_order_id || '')
  if (isUuid(id)) {
    const { data } = await base().eq('id', id).maybeSingle()
    if (data) return data
  }
  const number = String(notes.wama_order_number || '')
  if (number) {
    const { data } = await base().eq('order_number', number).maybeSingle()
    if (data) return data
  }
  const { data } = await base().eq('shipping_address->payment->>order_id', String(payment.order_id)).limit(1)
  return data?.[0] || null
}
