/**
 * Customer accounts on a business's online store page: shoppers sign in with Google, and then see their
 * orders with where each one is (placed → confirmed → on the way / ready → delivered), keep their cart on
 * every device, and get their name, phone and address filled in at checkout. Guests can still order, and
 * can track an order with its number and their phone.
 *
 * Sign-in uses the same Supabase Auth as WAMA (Google), but shoppers are kept per store in store_shoppers,
 * and their orders are linked by commerce_orders.shopper_id. A shopper never sees another store's data,
 * and nothing about the workspace.
 */

import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'
import { normalizePhone } from '../public-api/keys'
import { isUuid } from '../record-visibility'
import { deliveredAt, readReturn } from './returns'

/** supabase/migrations/20261121_store_accounts.sql word for word. */
export const STORE_ACCOUNTS_SQL = `-- Customer accounts on the online store page (sign in with Google, order history, saved cart). Safe to run more than once.
-- The app runs it on its own when first needed.
CREATE TABLE IF NOT EXISTS store_shoppers (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  email TEXT,
  name TEXT,
  phone TEXT,
  address JSONB,
  cart JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
-- Only the server reads it (no policies: the public keys see nothing)
ALTER TABLE store_shoppers ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_orders ADD COLUMN IF NOT EXISTS shopper_id UUID;
CREATE INDEX IF NOT EXISTS commerce_orders_shopper_idx ON commerce_orders (organization_id, shopper_id, created_at DESC) WHERE shopper_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
`

export const STORE_ACCOUNTS_LOCK = 724519018
export const storeAccountsSchemaSetup = createAutoSetup('Store accounts', (connectionString) => runMigrationSql(connectionString, STORE_ACCOUNTS_SQL, STORE_ACCOUNTS_LOCK))

/** Run a database step; if the shopper table or column is missing, add them and try again. */
export async function withStoreAccountsSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = storeAccountsSchemaSetup): Promise<any> {
  const first = await step()
  if (!isMissingSchemaError(first.error, /store_shoppers|shopper_id/)) return first
  if (!(await setup.ensure())) return first
  let result = await step()
  for (let attempt = 1; attempt < 4 && isMissingSchemaError(result.error, /store_shoppers|shopper_id/); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
    result = await step()
  }
  return result
}

export interface Shopper {
  id: string
  email: string
  name: string
  picture: string
}

/** The signed-in shopper from "Authorization: Bearer <Supabase access token>", or null for a guest. */
export async function shopperFrom(request: { headers: { get(name: string): string | null } }, db: any): Promise<Shopper | null> {
  const header = request.headers.get('authorization') || ''
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  if (!token || token.length > 4000) return null
  try {
    const { data, error } = await db.auth.getUser(token)
    const user = data?.user
    if (error || !user?.id) return null
    const meta = user.user_metadata || {}
    return {
      id: user.id,
      email: String(user.email || '').slice(0, 200),
      name: String(meta.full_name || meta.name || '').trim().slice(0, 120),
      picture: /^https:\/\//.test(String(meta.avatar_url || meta.picture || '')) ? String(meta.avatar_url || meta.picture).slice(0, 500) : '',
    }
  } catch {
    return null
  }
}

/** A saved cart: product id → quantity (1–99), at most 60 products, only products the store sells. */
export function cleanCart(raw: unknown, productIds?: Set<string>): Record<string, number> {
  const out: Record<string, number> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [id, qty] of Object.entries(raw as Record<string, unknown>)) {
    // "productId", or "productId:variantId" for a product with options (size, colour…)
    const [productId, variantId, extra] = id.split(':')
    if (extra !== undefined || !isUuid(productId) || (variantId !== undefined && !isUuid(variantId)) || (productIds && !productIds.has(productId))) continue
    const n = Math.floor(Number(qty))
    if (n >= 1) out[id] = Math.min(99, n)
    if (Object.keys(out).length >= 60) break
  }
  return out
}

/** Two carts made one (the phone's and the saved one): the larger quantity of each product wins. */
export function mergeCarts(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...a }
  for (const [id, qty] of Object.entries(b)) out[id] = Math.min(99, Math.max(out[id] || 0, qty))
  return out
}

const text = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** A saved delivery address (the same fields as checkout). */
export function cleanAddress(raw: any): Record<string, string> | null {
  if (!raw || typeof raw !== 'object') return null
  const address = {
    address_line_1: text(raw.address_line_1, 200),
    address_line_2: text(raw.address_line_2, 200),
    city: text(raw.city, 80),
    state: text(raw.state, 80),
    pincode: text(raw.pincode, 12),
  }
  return address.address_line_1 || address.city ? address : null
}

export type StepState = 'done' | 'now' | 'next' | 'stopped'

export interface TrackStep {
  key: string
  label: string
  state: StepState
  at: string | null
}

/** The status the shopper sees for an order, in plain words. */
export function shopperStatus(order: { status: string; payment_status?: string | null; shipping_address?: any }): { label: string; tone: 'blue' | 'grey' | 'red' | 'done' } {
  const pickup = order.shipping_address?.handover !== 'delivery'
  switch (order.status) {
    case 'payment_pending': return { label: 'Waiting for payment', tone: 'red' }
    case 'paid': case 'cod_confirmed': case 'confirmed': case 'processing': return { label: 'Confirmed', tone: 'blue' }
    case 'shipped': return { label: pickup ? 'Ready to pick up' : 'On the way', tone: 'blue' }
    case 'delivered': return { label: pickup ? 'Picked up' : 'Delivered', tone: 'done' }
    case 'canceled': case 'cancelled': return { label: 'Cancelled', tone: 'grey' }
    default: return { label: 'Placed', tone: 'blue' }
  }
}

/** Where the order is: Placed → Confirmed → On the way (or Ready to pick up) → Delivered (or Picked up). */
export function orderTimeline(order: { status: string; created_at?: string | null; updated_at?: string | null; payment_status?: string | null; shipping_address?: any }): TrackStep[] {
  const ship = order.shipping_address || {}
  const pickup = ship.handover !== 'delivery'
  const keys = ['placed', 'confirmed', 'shipped', 'delivered'] as const
  const labels = { placed: 'Order placed', confirmed: 'Confirmed by the shop', shipped: pickup ? 'Ready to pick up' : 'On the way', delivered: pickup ? 'Picked up' : 'Delivered' }
  const reached: Record<string, number> = { payment_pending: 0, pending: 0, placed: 0, paid: 1, cod_confirmed: 1, confirmed: 1, processing: 1, shipped: 2, delivered: 3 }
  const canceled = order.status === 'canceled' || order.status === 'cancelled'
  const at: Record<string, string | null> = {
    placed: order.created_at || null,
    confirmed: ship.payment?.paid_at || null,
    shipped: ship.shipped_at || null,
    delivered: ship.delivered_at || null,
  }
  if (canceled) {
    return [
      { key: 'placed', label: labels.placed, state: 'done', at: at.placed },
      { key: 'canceled', label: 'Cancelled', state: 'stopped', at: order.updated_at || null },
    ]
  }
  const level = reached[order.status] ?? 0
  return keys.map((key, i) => ({
    key,
    label: key === 'placed' && order.status === 'payment_pending' ? 'Order placed, waiting for payment' : labels[key],
    state: i < level ? 'done' : i === level ? (i === keys.length - 1 ? 'done' : 'now') : 'next',
    at: i <= level ? at[key] : null,
  }))
}

/** One order as the shopper sees it: no workspace ids, no notes from the team. */
export function shopperOrderView(order: any, items: any[]) {
  const ship = order.shipping_address || {}
  const status = shopperStatus(order)
  const method = String(order.payment_method || '')
  return {
    number: String(order.order_number || ''),
    placedAt: order.created_at || null,
    status: status.label,
    tone: status.tone,
    paid: order.payment_status === 'paid',
    payment: order.payment_status === 'paid' ? (method === 'razorpay' ? 'Paid online' : 'Paid') : ship.handover === 'delivery' ? 'Pay on delivery' : 'Pay at pick up',
    handover: ship.handover === 'delivery' ? 'delivery' : 'pickup',
    address: [ship.address_line_1, ship.address_line_2, ship.city, [ship.state, ship.pincode].filter(Boolean).join(' ')].map((p) => String(p || '').trim()).filter(Boolean).join(', '),
    tracking: ship.tracking_number ? { number: String(ship.tracking_number), carrier: String(ship.carrier || '') } : null,
    items: (items || []).map((item) => ({
      title: String(item.title || 'Item'), quantity: Number(item.quantity) || 1, price: Number(item.unit_price) || 0, total: Number(item.total_price) || 0,
      image: /^https:\/\//.test(String(item.image_url || '')) ? item.image_url : '',
      // What "Order again" puts back in the cart (the product, and its size / colour)
      key: item.product_id ? `${item.product_id}${item.variant_id ? `:${item.variant_id}` : ''}` : null,
    })),
    subtotal: Number(order.subtotal) || 0,
    delivery: Number(order.shipping_fee) || 0,
    total: Number(order.total_amount) || 0,
    currency: String(order.currency || 'INR'),
    timeline: orderTimeline(order),
    unpaid: order.status === 'payment_pending' && ship.payment?.order_id ? { razorpayOrderId: String(ship.payment.order_id) } : null,
    // Returns: when it was delivered (the store page knows the shop's return window) and any return asked
    deliveredAt: deliveredAt(order),
    returnStatus: readReturn(order)?.status || null,
    // The GST invoice, once the order has one (opens on the main app address, also from own domains)
    invoice: /^[A-Za-z0-9_-]{16,40}$/.test(String(ship.invoice_token || '')) ? `${String(process.env.NEXT_PUBLIC_APP_URL || 'https://wamacrm.magnetora.in').replace(/\/$/, '')}/invoice/${ship.invoice_token}` : null,
  }
}

/** Same phone? Compares the last 10 digits, so "+91 98765 43210" and "9876543210" match. */
export function samePhone(a: unknown, b: unknown): boolean {
  const x = String(a ?? '').replace(/\D/g, '').slice(-10)
  const y = String(b ?? '').replace(/\D/g, '').slice(-10)
  return x.length === 10 && x === y
}

/** The shopper's saved details in one store (null when they have never signed in there). */
export async function loadShopper(db: any, organizationId: string, userId: string) {
  const { data } = await withStoreAccountsSchema(() => db.from('store_shoppers').select('*').eq('organization_id', organizationId).eq('user_id', userId).maybeSingle())
  return data || null
}

/** Save (or update) the shopper's details in one store. Only the fields given are changed. */
export async function saveShopper(db: any, organizationId: string, shopper: Shopper, changes: { name?: string; phone?: string; address?: Record<string, string> | null; cart?: Record<string, number> }) {
  const row: Record<string, unknown> = { organization_id: organizationId, user_id: shopper.id, email: shopper.email, updated_at: new Date().toISOString() }
  if (changes.name !== undefined) row.name = text(changes.name, 120) || null
  if (changes.phone !== undefined) row.phone = normalizePhone(changes.phone) || null
  if (changes.address !== undefined) row.address = changes.address
  if (changes.cart !== undefined) row.cart = changes.cart
  const existing = await loadShopper(db, organizationId, shopper.id)
  if (!existing && row.name === undefined) row.name = shopper.name || null
  const { error } = await withStoreAccountsSchema(() => db.from('store_shoppers').upsert(row, { onConflict: 'organization_id,user_id' }))
  if (error) throw new Error(error.message)
}

/** The shopper's orders in one store, newest first, with their items. */
export async function shopperOrders(db: any, organizationId: string, userId: string, limit = 30) {
  const { data: orders } = await withStoreAccountsSchema(() =>
    db.from('commerce_orders').select('*').eq('organization_id', organizationId).eq('shopper_id', userId).order('created_at', { ascending: false }).limit(limit),
  )
  const list = orders || []
  if (!list.length) return []
  const { data: items } = await db.from('commerce_order_items').select('*').in('order_id', list.map((o: any) => o.id))
  return list.map((order: any) => shopperOrderView(order, (items || []).filter((item: any) => item.order_id === order.id)))
}

/** A guest's order by its number and the phone it was placed with (null when they do not match). */
export async function trackOrder(db: any, organizationId: string, orderNumber: string, phone: string) {
  const number = text(orderNumber, 40).replace(/^#/, '').toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9-]{2,39}$/.test(number) || String(phone || '').replace(/\D/g, '').length < 10) return null
  const { data: order } = await db.from('commerce_orders').select('*').eq('organization_id', organizationId).eq('order_number', number).maybeSingle()
  if (!order) return null
  let orderPhone = order.shipping_address?.phone_number
  if (!orderPhone && order.contact_id) {
    const { data: contact } = await db.from('contacts').select('phone_number').eq('id', order.contact_id).eq('organization_id', organizationId).maybeSingle()
    orderPhone = contact?.phone_number
  }
  if (!samePhone(orderPhone, phone)) return null
  const { data: items } = await db.from('commerce_order_items').select('*').eq('order_id', order.id)
  return shopperOrderView(order, items || [])
}
