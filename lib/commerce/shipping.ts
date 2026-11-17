/**
 * Delivery partners for a business: its settings, rates for an order, booking a courier, cancelling,
 * and tracking updates (webhook, or a check every 30 minutes) that move the order on and tell the customer
 * on WhatsApp. The courier calls live in shiprocket.ts and delhivery.ts; the rules in shipping-rules.ts.
 *
 * Settings: organizations.shipping_settings (JSON, no secrets) + shiprocket_api_password,
 * shiprocket_api_token, shiprocket_token_at, delhivery_api_token, shipping_webhook_token (server only:
 * their names match isSecretColumn). Shipments: commerce_shipments. Products get weight_grams, hsn_code.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'
import {
  DEFAULT_PARCEL, FINAL_SHIPMENT_STATUSES, PROVIDER_NAMES, cleanParcel, cleanPin, noticeFor, noticeText, orderStatusFor,
  parcelFor, shipBlocker, shouldMoveTo, sortRates, trackingLink,
  type ParcelDefaults, type RateOption, type ShipmentStatus, type ShippingProvider,
} from './shipping-rules'
import { ShippingError, shiprocketClient, shiprocketOrderPayload, type TrackingUpdate } from './shiprocket'
import { delhiveryClient, delhiveryShipmentPayload } from './delhivery'

/** supabase/migrations/20261123_shop_delivery_partners.sql word for word. */
export const SHIPPING_SQL = `-- Delivery partners (Shiprocket, Delhivery): settings, shipments, product weight. Safe to run more than once.
-- The app runs it on its own when first needed.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS shipping_settings JSONB;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS shiprocket_api_password TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS shiprocket_api_token TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS shiprocket_token_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS delhivery_api_token TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS shipping_webhook_token TEXT;

ALTER TABLE commerce_products ADD COLUMN IF NOT EXISTS weight_grams INTEGER;
ALTER TABLE commerce_products ADD COLUMN IF NOT EXISTS hsn_code TEXT;

-- status: booked, pickup_scheduled, picked_up, in_transit, out_for_delivery, delivered, undelivered,
-- returning, returned, cancelled, lost. notices: which WhatsApp messages the customer already got.
CREATE TABLE IF NOT EXISTS commerce_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES commerce_orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_order_id TEXT,
  provider_shipment_id TEXT,
  awb TEXT,
  courier_name TEXT,
  label_url TEXT,
  status TEXT NOT NULL DEFAULT 'booked',
  status_text TEXT,
  expected_at TEXT,
  charge NUMERIC(12,2),
  cod BOOLEAN NOT NULL DEFAULT FALSE,
  weight_grams INTEGER,
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  notices JSONB NOT NULL DEFAULT '{}'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  booked_by UUID,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_commerce_shipments_order ON commerce_shipments(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commerce_shipments_open ON commerce_shipments(status, last_checked_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_shipments_awb ON commerce_shipments(provider, awb) WHERE awb IS NOT NULL;
ALTER TABLE commerce_shipments ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
`

export const SHIPPING_LOCK = 724519020
export const shippingSchemaSetup = createAutoSetup('Delivery partners', (connectionString) => runMigrationSql(connectionString, SHIPPING_SQL, SHIPPING_LOCK))
const SHIPPING_SCHEMA = /shipping_settings|shiprocket_|delhivery_|shipping_webhook_token|commerce_shipments|weight_grams|hsn_code/

/** Run a database step; if the delivery tables or columns are missing, add them and try again. */
export async function withShippingSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = shippingSchemaSetup): Promise<any> {
  const first = await step()
  if (!isMissingSchemaError(first.error, SHIPPING_SCHEMA)) return first
  if (!(await setup.ensure())) return first
  let result = await step()
  for (let attempt = 1; attempt < 4 && isMissingSchemaError(result.error, SHIPPING_SCHEMA); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
    result = await step()
  }
  return result
}

export const SHIPPING_ORG_COLUMNS = 'id, name, slug, contact_email, contact_address, currency, shipping_settings, shiprocket_api_password, shiprocket_api_token, shiprocket_token_at, delhivery_api_token, shipping_webhook_token'

export interface ShippingSettings {
  shiprocket: { email: string; pickup_location: string; pickup_pin: string } | null
  delhivery: { warehouse: string; pickup_pin: string; live: boolean; seller_name: string; seller_address: string; gstin: string } | null
  parcel: ParcelDefaults
  /** Tell the customer on WhatsApp as the parcel moves. */
  notify: boolean
}

const text = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

export function readShippingSettings(raw: any): ShippingSettings {
  const sr = raw?.shiprocket
  const dl = raw?.delhivery
  return {
    shiprocket: sr && text(sr.email, 200) ? { email: text(sr.email, 200).toLowerCase(), pickup_location: text(sr.pickup_location, 120), pickup_pin: cleanPin(sr.pickup_pin) || '' } : null,
    delhivery: dl && text(dl.warehouse, 120) ? {
      warehouse: text(dl.warehouse, 120), pickup_pin: cleanPin(dl.pickup_pin) || '', live: dl.live !== false,
      seller_name: text(dl.seller_name, 100), seller_address: text(dl.seller_address, 200), gstin: text(dl.gstin, 20).toUpperCase(),
    } : null,
    parcel: cleanParcel(raw?.parcel || DEFAULT_PARCEL),
    notify: raw?.notify !== false,
  }
}

/** Which partners are ready to book (connected, with a pickup place). */
export function readyPartners(org: any): ShippingProvider[] {
  const s = readShippingSettings(org?.shipping_settings)
  const out: ShippingProvider[] = []
  if (s.shiprocket && org?.shiprocket_api_password && s.shiprocket.pickup_location && s.shiprocket.pickup_pin) out.push('shiprocket')
  if (s.delhivery && org?.delhivery_api_token && s.delhivery.pickup_pin) out.push('delhivery')
  return out
}

/** What the settings screen sees (never the password or tokens). */
export function shippingView(org: any, appUrl: string) {
  const s = readShippingSettings(org?.shipping_settings)
  return {
    shiprocket: s.shiprocket ? { connected: Boolean(org?.shiprocket_api_password), email: s.shiprocket.email, pickupLocation: s.shiprocket.pickup_location, pickupPin: s.shiprocket.pickup_pin } : { connected: false },
    delhivery: s.delhivery ? { connected: Boolean(org?.delhivery_api_token), warehouse: s.delhivery.warehouse, pickupPin: s.delhivery.pickup_pin, live: s.delhivery.live, sellerName: s.delhivery.seller_name, sellerAddress: s.delhivery.seller_address, gstin: s.delhivery.gstin } : { connected: false },
    parcel: s.parcel,
    notify: s.notify,
    ready: readyPartners(org),
    // Shiprocket refuses webhook addresses with "shiprocket", "sr" or "kr" in them, so the path is plain
    webhookUrl: `${appUrl.replace(/\/$/, '')}/api/webhooks/parcel-updates`,
    webhookKey: org?.shipping_webhook_token || null,
  }
}

export function newWebhookKey(): string {
  return randomBytes(24).toString('hex')
}

export function sameKey(given: string | null | undefined, expected: string | null | undefined): boolean {
  const a = Buffer.from(String(given || ''))
  const b = Buffer.from(String(expected || ''))
  return b.length >= 16 && a.length === b.length && timingSafeEqual(a, b)
}

type Fetcher = typeof fetch

/** A Shiprocket session for this business that saves a fresh token for next time. */
export function shiprocketFor(db: any, org: any, fetcher?: Fetcher) {
  const s = readShippingSettings(org?.shipping_settings)
  if (!s.shiprocket || !org?.shiprocket_api_password) throw new ShippingError('Connect Shiprocket first (E-commerce → Store → Delivery partners).')
  return shiprocketClient(
    { email: s.shiprocket.email, password: org.shiprocket_api_password, token: org.shiprocket_api_token, tokenAt: org.shiprocket_token_at },
    {
      fetcher,
      onToken: async (token) => {
        await db.from('organizations').update({ shiprocket_api_token: token, shiprocket_token_at: new Date().toISOString() }).eq('id', org.id)
      },
    }
  )
}

export function delhiveryFor(org: any, fetcher?: Fetcher) {
  const s = readShippingSettings(org?.shipping_settings)
  if (!s.delhivery || !org?.delhivery_api_token) throw new ShippingError('Connect Delhivery first (E-commerce → Store → Delivery partners).')
  return delhiveryClient({ token: org.delhivery_api_token, warehouse: s.delhivery.warehouse, live: s.delhivery.live }, fetcher)
}

/** The order with its lines and each product's weight / HSN. */
export async function loadOrderForShipping(db: any, organizationId: string, orderId: string) {
  const { data: order } = await db.from('commerce_orders').select('*, contact:contacts(first_name, last_name, phone_number, email)').eq('organization_id', organizationId).eq('id', orderId).maybeSingle()
  if (!order) return null
  const { data: items } = await withShippingSchema(() => db.from('commerce_order_items').select('*, product:commerce_products(weight_grams, hsn_code)').eq('order_id', orderId))
  return {
    order,
    items: (items || []).map((i: any) => ({ ...i, weight_grams: i.product?.weight_grams ?? null, hsn_code: i.product?.hsn_code ?? null })),
  }
}

export async function shipmentsForOrder(db: any, organizationId: string, orderId: string) {
  const { data } = await withShippingSchema(() => db.from('commerce_shipments').select('*').eq('organization_id', organizationId).eq('order_id', orderId).order('created_at', { ascending: false }))
  return data || []
}

/** Rates from every connected partner for this order, cheapest first. Partner errors come back as notes. */
export async function ratesForOrder(db: any, org: any, loaded: { order: any; items: any[] }, fetcher?: Fetcher) {
  const blocker = shipBlocker(loaded.order)
  if (blocker) throw new ShippingError(blocker)
  const s = readShippingSettings(org.shipping_settings)
  const ready = readyPartners(org)
  if (!ready.length) throw new ShippingError('Connect Shiprocket or Delhivery first (E-commerce → Store → Delivery partners).')
  const parcel = parcelFor(loaded.items, s.parcel)
  const toPin = cleanPin(loaded.order.shipping_address?.pincode)!
  const cod = loaded.order.payment_status !== 'paid' && (loaded.order.payment_method === 'cod' || loaded.order.status === 'cod_confirmed')
  const value = Number(loaded.order.total_amount) || 0
  const notes: string[] = []
  const all: RateOption[] = []
  await Promise.all(ready.map(async (provider) => {
    try {
      if (provider === 'shiprocket') all.push(...await shiprocketFor(db, org, fetcher).rates({ fromPin: s.shiprocket!.pickup_pin, toPin, weightGrams: parcel.weight_grams, cod, value }))
      else all.push(...await delhiveryFor(org, fetcher).rates({ fromPin: s.delhivery!.pickup_pin, toPin, weightGrams: parcel.weight_grams, cod }))
    } catch (error: any) {
      notes.push(`${PROVIDER_NAMES[provider]}: ${String(error?.message || 'could not be reached').replace(/^(Shiprocket|Delhivery): /, '')}`)
    }
  }))
  const usable = all.filter((o) => !cod || o.cod)
  if (!usable.length && !notes.length) notes.push(`No courier delivers to ${toPin}${cod ? ' with Cash on Delivery' : ''} from your pickup address.`)
  return { rates: sortRates(usable), parcel, cod, notes }
}

/** Book the chosen courier, save the shipment, and move the order to Shipped. */
export async function bookShipment(db: any, org: any, loaded: { order: any; items: any[] }, choice: { provider: ShippingProvider; courierId: string; price?: number | null }, userId: string | null, fetcher?: Fetcher) {
  const blocker = shipBlocker(loaded.order)
  if (blocker) throw new ShippingError(blocker)
  if (!readyPartners(org).includes(choice.provider)) throw new ShippingError(`${PROVIDER_NAMES[choice.provider]} is not connected.`)
  const existing = await shipmentsForOrder(db, org.id, loaded.order.id)
  if (existing.some((s: any) => !['cancelled'].includes(s.status))) throw new ShippingError('This order already has a courier booked. Cancel that one first to book another.', 409)
  const s = readShippingSettings(org.shipping_settings)
  const parcel = parcelFor(loaded.items, s.parcel)
  const attempt = existing.length + 1
  const cod = loaded.order.payment_status !== 'paid' && (loaded.order.payment_method === 'cod' || loaded.order.status === 'cod_confirmed')

  let row: Record<string, unknown>
  if (choice.provider === 'shiprocket') {
    const payload = shiprocketOrderPayload({
      order: loaded.order, items: loaded.items, pickupLocation: s.shiprocket!.pickup_location, parcel, attempt,
      email: loaded.order.contact?.email || org.contact_email || s.shiprocket!.email,
    })
    const booking = await shiprocketFor(db, org, fetcher).book(payload, choice.courierId)
    row = {
      provider: 'shiprocket', provider_order_id: booking.providerOrderId, provider_shipment_id: booking.shipmentId, awb: booking.awb,
      courier_name: booking.courierName, label_url: booking.labelUrl, status: booking.status, warnings: booking.warnings,
      status_text: booking.pickupAt ? `Pickup on ${booking.pickupAt}` : null,
    }
  } else {
    const d = s.delhivery!
    const payload = delhiveryShipmentPayload({
      order: loaded.order, items: loaded.items, parcel, attempt,
      seller: { name: d.seller_name || org.name || 'Store', address: d.seller_address || org.contact_address || '', gstin: d.gstin || null },
    })
    const booking = await delhiveryFor(org, fetcher).book(payload, choice.courierId)
    row = {
      provider: 'delhivery', provider_order_id: String(payload.order), awb: booking.awb, courier_name: choice.courierId === 'E' ? 'Delhivery Express' : 'Delhivery Surface',
      status: booking.pickupId ? 'pickup_scheduled' : 'booked', warnings: booking.warnings, status_text: booking.pickupId ? `Pickup request ${booking.pickupId}` : null,
    }
  }
  const { data: shipment, error } = await withShippingSchema(() => db.from('commerce_shipments').insert({
    ...row, organization_id: org.id, order_id: loaded.order.id, charge: Number.isFinite(Number(choice.price)) ? Number(choice.price) : null,
    cod, weight_grams: parcel.weight_grams, booked_by: userId, last_checked_at: new Date().toISOString(),
  }).select('*').single())
  if (error || !shipment) throw new ShippingError(`Booked with the courier (AWB ${row.awb}) but WAMA could not save it: ${error?.message || 'unknown error'}. Note the AWB.`, 500)

  // The order shows the courier and AWB at once; it becomes Shipped when the courier picks it up
  const shipping = { ...(loaded.order.shipping_address || {}), carrier: shipment.courier_name || PROVIDER_NAMES[choice.provider], tracking_number: shipment.awb, tracking_url: trackingLink(choice.provider, shipment.awb) }
  await db.from('commerce_orders').update({ shipping_address: shipping, updated_at: new Date().toISOString() }).eq('id', loaded.order.id).eq('organization_id', org.id)
  return shipment
}

/** Cancel a booked shipment with the courier; the order goes back to "To ship". */
export async function cancelShipment(db: any, org: any, shipment: any, fetcher?: Fetcher) {
  if (FINAL_SHIPMENT_STATUSES.includes(shipment.status)) throw new ShippingError('This shipment is already finished and cannot be cancelled.')
  if (['picked_up', 'in_transit', 'out_for_delivery', 'undelivered', 'returning'].includes(shipment.status)) {
    throw new ShippingError('The courier already has this parcel. Ask the courier for a return (RTO) from their panel instead.')
  }
  if (shipment.provider === 'shiprocket') await shiprocketFor(db, org, fetcher).cancel(String(shipment.provider_order_id))
  else await delhiveryFor(org, fetcher).cancel(String(shipment.awb))
  const { data } = await db.from('commerce_shipments').update({ status: 'cancelled', status_text: 'Cancelled by you', updated_at: new Date().toISOString() }).eq('id', shipment.id).select('*').single()
  // Clear the AWB from the order
  const { data: order } = await db.from('commerce_orders').select('id, shipping_address').eq('id', shipment.order_id).maybeSingle()
  if (order) {
    const shipping = { ...(order.shipping_address || {}) }
    if (shipping.tracking_number === shipment.awb) { delete shipping.tracking_number; delete shipping.tracking_url; delete shipping.carrier }
    await db.from('commerce_orders').update({ shipping_address: shipping, updated_at: new Date().toISOString() }).eq('id', order.id)
  }
  return data
}

/**
 * A tracking update for one shipment: save it, move the order (Shipped / Delivered), and tell the customer
 * on WhatsApp once per step. Older or repeated updates change nothing.
 */
export async function applyTracking(db: any, shipment: any, update: TrackingUpdate, deps: { notify?: (args: { org: any; order: any; status: 'shipped' | 'delivered'; text: string }) => Promise<boolean> } = {}) {
  const now = new Date().toISOString()
  const next = update.status as ShipmentStatus | null
  const changes: Record<string, unknown> = { last_checked_at: now, updated_at: now }
  if (update.events.length) changes.events = update.events
  if (update.expected) changes.expected_at = update.expected
  if (update.statusText) changes.status_text = update.statusText
  const moves = Boolean(next) && shouldMoveTo(shipment.status, next!)
  if (moves) changes.status = next
  await db.from('commerce_shipments').update(changes).eq('id', shipment.id)
  if (!moves || !next) return { moved: false, status: shipment.status as ShipmentStatus }

  const { data: order } = await db.from('commerce_orders').select('*').eq('id', shipment.order_id).maybeSingle()
  if (!order) return { moved: true, status: next }
  const target = orderStatusFor(next, order.status)
  if (target) {
    const shipping = { ...(order.shipping_address || {}) }
    if (target === 'shipped') shipping.shipped_at = shipping.shipped_at || now
    if (target === 'delivered') shipping.delivered_at = now
    const updates: Record<string, unknown> = { status: target, shipping_address: shipping, updated_at: now }
    if (target === 'delivered' && order.payment_method === 'cod') updates.payment_status = 'paid'
    await db.from('commerce_orders').update(updates).eq('id', order.id).eq('status', order.status)
  }

  const { data: org } = await db.from('organizations').select('*').eq('id', shipment.organization_id).maybeSingle()
  const notice = noticeFor(next)
  const notices = shipment.notices || {}
  if (notice && !notices[notice] && org && readShippingSettings(org.shipping_settings).notify && deps.notify) {
    const message = noticeText(notice, {
      orderNumber: order.order_number, courier: shipment.courier_name, link: trackingLink(shipment.provider, shipment.awb),
      expected: update.expected || shipment.expected_at || null,
    })
    const sent = await deps.notify({ org, order, status: next === 'delivered' ? 'delivered' : 'shipped', text: message }).catch(() => false)
    if (sent) await db.from('commerce_shipments').update({ notices: { ...notices, [notice]: now } }).eq('id', shipment.id)
  }
  return { moved: true, status: next }
}

/** Ask the courier where an open shipment is now. */
export async function refreshShipment(db: any, org: any, shipment: any, deps: Parameters<typeof applyTracking>[3] = {}, fetcher?: Fetcher) {
  if (!shipment.awb) return { moved: false, status: shipment.status }
  const update = shipment.provider === 'shiprocket'
    ? await shiprocketFor(db, org, fetcher).track(String(shipment.awb))
    : await delhiveryFor(org, fetcher).track(String(shipment.awb))
  return applyTracking(db, shipment, update, deps)
}

/** Open shipments not checked in the last 30 minutes (for the scheduled check). */
export async function dueShipments(db: any, limit = 200, now = Date.now()) {
  const before = new Date(now - 30 * 60_000).toISOString()
  const { data, error } = await db.from('commerce_shipments').select('*')
    .not('status', 'in', `(${FINAL_SHIPMENT_STATUSES.join(',')})`)
    .not('awb', 'is', null)
    .lt('last_checked_at', before)
    .order('last_checked_at', { ascending: true })
    .limit(limit)
  if (error && isMissingSchemaError(error, /commerce_shipments/)) return []
  return data || []
}

/** Is a PIN code served, from the business's own partners (for the store page). */
export async function deliveryCheck(db: any, org: any, pin: string, fetcher?: Fetcher): Promise<{ served: boolean; cod: boolean; days: number | null; note: string | null } | null> {
  const ready = readyPartners(org)
  if (!ready.length) return null
  const s = readShippingSettings(org.shipping_settings)
  if (ready.includes('delhivery')) {
    try {
      const r = await delhiveryFor(org, fetcher).pin(pin)
      if (r.served || !ready.includes('shiprocket')) return { served: r.served, cod: r.cod, days: null, note: r.place }
    } catch { /* try the other partner */ }
  }
  if (ready.includes('shiprocket')) {
    try {
      const rates = await shiprocketFor(db, org, fetcher).rates({ fromPin: s.shiprocket!.pickup_pin, toPin: pin, weightGrams: s.parcel.weight_grams, cod: false, value: 500 })
      if (!rates.length) return { served: false, cod: false, days: null, note: null }
      const days = rates.map((r) => r.days).filter((d): d is number => d !== null)
      return { served: true, cod: rates.some((r) => r.cod), days: days.length ? Math.min(...days) : null, note: null }
    } catch { return null }
  }
  return null
}
