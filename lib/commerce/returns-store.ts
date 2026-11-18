/**
 * Returns and refunds in the database (rules in returns.ts). Refunds are rows in commerce_refunds; the
 * return ask lives on the order. Online payments go back through the shop's own Razorpay. Server only.
 */

import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'
import { formatMoney } from './commerce-utils'
import { readReturn, readReturnSettings, refundable, type ReturnRequest, type ReturnSettings } from './returns'
import { sendShopMessage } from './shop-messages-send'
import { refundStorePayment, storeRazorpayKeys } from './store-payments'
import { changeVariantStock } from './variant-store'
import { returnPointsFor } from './loyalty-store'
import { issueCreditNote } from './invoice-store'

/** supabase/migrations/20261201_shop_returns.sql word for word. */
export const RETURNS_SQL = `-- Shop returns and refunds. Safe to run more than once. The app runs it on its own when first needed.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS shop_returns JSONB;
CREATE TABLE IF NOT EXISTS commerce_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES commerce_orders(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  reason TEXT,
  method TEXT NOT NULL,
  razorpay_refund_id TEXT,
  status TEXT NOT NULL DEFAULT 'done',
  restocked BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_commerce_refunds_order ON commerce_refunds(order_id, created_at);
ALTER TABLE commerce_refunds ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
`
export const RETURNS_LOCK = 724519028
export const returnsSchemaSetup = createAutoSetup('Shop returns', (connectionString) => runMigrationSql(connectionString, RETURNS_SQL, RETURNS_LOCK))
const RETURNS_SCHEMA = /commerce_refunds|shop_returns/

export async function withReturnsSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = returnsSchemaSetup): Promise<any> {
  const first = await step()
  if (!isMissingSchemaError(first.error, RETURNS_SCHEMA)) return first
  if (!(await setup.ensure())) return first
  let result = await step()
  for (let attempt = 1; attempt < 4 && isMissingSchemaError(result.error, RETURNS_SCHEMA); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
    result = await step()
  }
  return result
}

export async function loadReturnSettings(db: any, organizationId: string): Promise<ReturnSettings> {
  const { data } = await withReturnsSchema(() => db.from('organizations').select('id, shop_returns').eq('id', organizationId).maybeSingle())
  return readReturnSettings(data?.shop_returns)
}

export async function saveReturnSettings(db: any, organizationId: string, settings: ReturnSettings) {
  return withReturnsSchema(() => db.from('organizations').update({ shop_returns: readReturnSettings(settings) }).eq('id', organizationId))
}

export async function refundsFor(db: any, organizationId: string, orderId: string): Promise<any[]> {
  const { data } = await withReturnsSchema(() => db.from('commerce_refunds').select('*').eq('organization_id', organizationId).eq('order_id', orderId).order('created_at', { ascending: true }))
  return data || []
}

async function tellCustomer(db: any, organizationId: string, order: any, what: string) {
  const phone = order.shipping_address?.phone_number
  if (!phone) return
  const { data: org } = await db.from('organizations').select('*').eq('id', organizationId).maybeSingle()
  if (!org) return
  const name = String(order.shipping_address?.full_name || '').split(' ')[0] || 'there'
  await sendShopMessage(db, org, String(phone), 'refund_update', {
    text: `Hi ${name}, about your order #${order.order_number}: ${what}`,
    values: [name, String(order.order_number || ''), what],
  }).catch(() => null)
}

/** The customer asks to return a delivered order (checked by the caller with returnChance). */
export async function askReturn(db: any, order: any, request: ReturnRequest) {
  const { error } = await db.from('commerce_orders').update({ shipping_address: { ...(order.shipping_address || {}), return: request }, updated_at: new Date().toISOString() }).eq('id', order.id)
  if (error) throw new Error(error.message)
}

/** The shop accepts or declines a return that was asked. */
export async function decideReturn(db: any, organizationId: string, orderId: string, decision: 'accepted' | 'declined', note = '') {
  const { data: order } = await db.from('commerce_orders').select('*').eq('id', orderId).eq('organization_id', organizationId).maybeSingle()
  const current = readReturn(order)
  if (!order || !current) return { error: 'This order has no return asked.' }
  if (current.status !== 'asked') return { error: 'This return was already answered.' }
  const next: ReturnRequest = { ...current, status: decision, decided_at: new Date().toISOString(), decline_note: decision === 'declined' ? String(note || '').slice(0, 300) || null : null }
  const { error } = await db.from('commerce_orders').update({ shipping_address: { ...(order.shipping_address || {}), return: next } }).eq('id', orderId)
  if (error) throw new Error(error.message)
  await tellCustomer(db, organizationId, order, decision === 'accepted'
    ? 'we have accepted your return. We will tell you here when the refund is made.'
    : `we could not accept the return.${next.decline_note ? ` ${next.decline_note}` : ''} Reply here if you have questions.`)
  return { return: next }
}

/**
 * Refund all or part of an order. Paid online through the shop's Razorpay → the money goes back through
 * Razorpay now; otherwise it is recorded as paid back by hand. Can put the sizes / colours back in stock.
 */
export async function refundOrder(db: any, org: any, order: any, input: { amount: number; reason: string; restock: boolean; byUserId?: string | null }, fetcher: typeof fetch = fetch) {
  const before = await refundsFor(db, org.id, order.id)
  const { left } = refundable(order, before)
  if (input.amount > left + 0.001) return { error: 'Nothing (or less) is left to refund on this order.' }
  const paymentId = String(order.shipping_address?.payment?.payment_id || '')
  const keys = order.payment_method === 'razorpay' && paymentId ? storeRazorpayKeys(org) : null
  let method = 'manual'
  let razorpay: { id: string; status: string } | null = null
  if (keys) {
    try {
      razorpay = await refundStorePayment(keys, paymentId, input.amount * 100, { order: String(order.order_number || ''), reason: input.reason.slice(0, 200) }, fetcher)
      method = 'razorpay'
    } catch (error: any) {
      return { error: `Razorpay did not make the refund: ${error?.message || 'please try again'}.` }
    }
  }
  const { data: saved, error } = await withReturnsSchema(() => db.from('commerce_refunds').insert({
    organization_id: org.id, order_id: order.id, amount: input.amount, reason: input.reason || null, method,
    razorpay_refund_id: razorpay?.id || null, status: razorpay ? (razorpay.status === 'processed' ? 'done' : 'pending') : 'done',
    restocked: input.restock, created_by: input.byUserId || null,
  }).select('*').single())
  if (error) throw new Error(error.message)

  if (input.restock) {
    const { data: items } = await db.from('commerce_order_items').select('variant_id, quantity').eq('order_id', order.id)
    for (const item of items || []) if (item.variant_id) await changeVariantStock(db, org.id, item.variant_id, Number(item.quantity) || 0).catch(() => null)
  }
  const after = refundable(order, [...before, saved])
  const ship = { ...(order.shipping_address || {}), refunded_amount: after.refunded }
  const current = readReturn(order)
  if (current && current.status !== 'declined') ship.return = { ...current, status: 'refunded', decided_at: current.decided_at || new Date().toISOString() }
  await db.from('commerce_orders').update({ shipping_address: ship, ...(after.left <= 0 ? { payment_status: 'refunded' } : {}), updated_at: new Date().toISOString() }).eq('id', order.id)

  // An invoiced order gets a GST credit note for the refund (best effort)
  await issueCreditNote(db, org.id, order.id, { id: saved.id, amount: input.amount, reason: input.reason }).catch((error: any) => console.error('[Credit note]', error?.message))
  // Refunded in full: points used come back, points earned go
  if (after.left <= 0) await returnPointsFor(db, org.id, order.id).catch(() => null)
  const amount = formatMoney(input.amount, order.currency || 'INR')
  await tellCustomer(db, org.id, order, method === 'razorpay'
    ? `we have refunded ${amount}. It goes back to the same card, UPI or bank account in 5–7 working days.`
    : `we have refunded ${amount}.`)
  return { refund: saved, method, left: after.left }
}
