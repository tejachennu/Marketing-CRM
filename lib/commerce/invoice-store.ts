/**
 * Shop GST invoices in the database (maths in invoice.ts). One invoice per order, numbered per financial
 * year, kept as it was issued (shop details, customer, lines, tax), so later changes to products or
 * settings never change an issued invoice. A cancelled order marks its invoice Cancelled. Server only.
 */

import { randomBytes } from 'node:crypto'
import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'
import { readStorefront } from './storefront'
import {
  GST_STATES, computeShopInvoice, creditNoteLines, creditNoteNumber, financialYear, readInvoiceSettings, readRate, shopInvoiceNumber, stateCodeOf, stateOfGstin,
  type InvoiceSettings,
} from './invoice'
import { businessCurrency } from '../money'

/** supabase/migrations/20261129_shop_invoices.sql word for word. */
export const INVOICE_SQL = `-- Shop GST invoices. Safe to run more than once. The app runs it on its own when first needed.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS shop_invoice JSONB;
ALTER TABLE commerce_products ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(5,2);
CREATE TABLE IF NOT EXISTS commerce_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES commerce_orders(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  fy TEXT NOT NULL,
  seq INTEGER NOT NULL,
  public_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'issued',
  registered BOOLEAN NOT NULL DEFAULT FALSE,
  inter_state BOOLEAN NOT NULL DEFAULT FALSE,
  place_of_supply TEXT,
  business JSONB NOT NULL DEFAULT '{}'::jsonb,
  customer JSONB NOT NULL DEFAULT '{}'::jsonb,
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  tax_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  order_number TEXT,
  payment TEXT,
  items_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  delivery NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  taxable NUMERIC(12,2) NOT NULL DEFAULT 0,
  cgst NUMERIC(12,2) NOT NULL DEFAULT 0,
  sgst NUMERIC(12,2) NOT NULL DEFAULT 0,
  igst NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  UNIQUE (order_id),
  UNIQUE (organization_id, fy, seq)
);
CREATE INDEX IF NOT EXISTS idx_commerce_invoices_org ON commerce_invoices(organization_id, issued_at DESC);
ALTER TABLE commerce_invoices ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
`
export const INVOICE_LOCK = 724519026
export const invoiceSchemaSetup = createAutoSetup('Shop invoices', (connectionString) => runMigrationSql(connectionString, INVOICE_SQL, INVOICE_LOCK))
const INVOICE_SCHEMA = /commerce_invoices|shop_invoice|gst_rate/

export async function withInvoiceSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = invoiceSchemaSetup): Promise<any> {
  const first = await step()
  if (!isMissingSchemaError(first.error, INVOICE_SCHEMA)) return first
  if (!(await setup.ensure())) return first
  let result = await step()
  for (let attempt = 1; attempt < 4 && isMissingSchemaError(result.error, INVOICE_SCHEMA); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
    result = await step()
  }
  return result
}

export async function loadInvoiceSettings(db: any, organizationId: string): Promise<InvoiceSettings> {
  const { data } = await withInvoiceSchema(() => db.from('organizations').select('id, shop_invoice').eq('id', organizationId).maybeSingle())
  return readInvoiceSettings(data?.shop_invoice)
}

export async function saveInvoiceSettings(db: any, organizationId: string, settings: InvoiceSettings) {
  return withInvoiceSchema(() => db.from('organizations').update({ shop_invoice: settings }).eq('id', organizationId))
}

/** A product's own GST rate from the product form; undefined when the form did not send one. */
export function productGstValue(product: any): { gst_rate: number | null } | null {
  if (!product || product.gst_rate === undefined) return null
  return { gst_rate: readRate(product.gst_rate) }
}

/** Where to open an invoice: <app>/invoice/<token>. */
export function invoiceLink(appUrl: string, token: string): string {
  return `${String(appUrl).replace(/\/$/, '')}/invoice/${token}`
}

const PAYMENT_TEXT: Record<string, string> = { razorpay: 'Paid online', upi: 'UPI', card: 'Card', cash: 'Cash', cod: 'Cash on delivery' }

/** What the invoice says about payment. */
function paymentText(order: any): string {
  const method = String(order.payment_method || '')
  if (order.payment_status === 'paid') return method === 'razorpay' || method === 'stripe' ? 'Paid online' : `Paid${PAYMENT_TEXT[method] && method !== 'cod' ? ` · ${PAYMENT_TEXT[method]}` : ''}`
  return order.shipping_address?.handover === 'pickup' ? 'Pay at pick up' : method === 'cod' ? 'Cash on delivery' : 'Not paid yet'
}

export async function invoiceForOrder(db: any, organizationId: string, orderId: string) {
  const { data, error } = await withInvoiceSchema(() => db.from('commerce_invoices').select('*').eq('organization_id', organizationId).eq('order_id', orderId).maybeSingle())
  if (error && !isMissingSchemaError(error, INVOICE_SCHEMA)) throw new Error(error.message)
  return data || null
}

export async function invoiceByToken(db: any, token: string) {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) return null
  const { data } = await withInvoiceSchema(() => db.from('commerce_invoices').select('*').eq('public_token', token).maybeSingle())
  return data || null
}

/** Orders that can have an invoice: confirmed (paid or cash on delivery), shipped or delivered. */
export function canInvoice(order: any): boolean {
  return Boolean(order) && ['paid', 'cod_confirmed', 'shipped', 'delivered'].includes(String(order.status || ''))
}

/**
 * The order's invoice: the one already issued, or a new one with the next number. Returns null when the
 * order can't have one (waiting for payment, cancelled) or does not belong to the workspace.
 */
export async function issueInvoice(db: any, organizationId: string, orderId: string, now: Date = new Date()) {
  const existing = await invoiceForOrder(db, organizationId, orderId)
  if (existing) return existing
  const { data: order } = await db.from('commerce_orders').select('*, contact:contacts(first_name, last_name, phone_number)').eq('id', orderId).eq('organization_id', organizationId).maybeSingle()
  if (!canInvoice(order)) return null
  const { data: items } = await db.from('commerce_order_items').select('*').eq('order_id', orderId)
  const { data: org } = await withInvoiceSchema(() => db.from('organizations').select('*').eq('id', organizationId).maybeSingle())
  if (!org) return null
  const settings = readInvoiceSettings(org.shop_invoice)

  // Each product's own rate and HSN (rate: the shop's usual one when the product has none)
  const productIds = [...new Set((items || []).map((i: any) => i.product_id).filter(Boolean))]
  const products = new Map<string, any>()
  if (productIds.length) {
    const { data: rows } = await withInvoiceSchema(() => db.from('commerce_products').select('id, gst_rate, hsn_code').in('id', productIds))
    for (const row of rows || []) products.set(row.id, row)
  }

  const ship = order.shipping_address || {}
  const registered = Boolean(settings.gstin)
  const shopState = stateOfGstin(settings.gstin)
  const delivered = ship.handover !== 'pickup' && ship.handover !== 'now' && ship.address_line_1
  const customerState = delivered ? stateCodeOf(ship.state) : shopState
  const placeOfSupply = customerState || shopState
  const interState = Boolean(registered && shopState && customerState && shopState !== customerState)

  const totals = computeShopInvoice({
    items: (items || []).map((item: any) => {
      const product = products.get(item.product_id)
      return {
        name: [item.title, item.variant_name].filter(Boolean).join(' · ') || 'Item',
        hsn: product?.hsn_code || null,
        quantity: Number(item.quantity) || 1,
        unitPrice: Number(item.unit_price) || 0,
        rate: readRate(product?.gst_rate) ?? settings.defaultRate,
      }
    }),
    delivery: Number(order.shipping_fee) || 0,
    discount: Number(order.discount_amount) || 0,
    registered,
    interState,
  })

  const storefront = readStorefront(org.storefront)
  const business = {
    name: String(org.name || storefront.title || 'Shop'),
    legal_name: settings.legalName || null,
    gstin: settings.gstin || null,
    address: settings.address || String(org.contact_address || ''),
    state: shopState ? `${GST_STATES[shopState]} (${shopState})` : null,
    phone: String(org.contact_phone || org.whatsapp_default_phone || ''),
    logo_url: /^https:\/\//.test(storefront.logo) ? storefront.logo : null,
    currency: businessCurrency(org),
  }
  const customer = {
    name: String(ship.full_name || [order.contact?.first_name, order.contact?.last_name].filter(Boolean).join(' ') || 'Customer'),
    phone: String(ship.phone_number || order.contact?.phone_number || ''),
    address: delivered ? [ship.address_line_1, ship.address_line_2, ship.city, [ship.state, ship.pincode].filter(Boolean).join(' ')].map((p) => String(p || '').trim()).filter(Boolean).join(', ') : '',
  }
  const fy = financialYear(now)
  const token = randomBytes(18).toString('base64url')

  // The next number in this financial year; two at once → the second tries the number after
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: last } = await db.from('commerce_invoices').select('seq').eq('organization_id', organizationId).eq('fy', fy).order('seq', { ascending: false }).limit(1)
    const seq = (Number(last?.[0]?.seq) || 0) + 1
    const { data: saved, error } = await db.from('commerce_invoices').insert({
      organization_id: organizationId, order_id: orderId, number: shopInvoiceNumber(settings.prefix, fy, seq), fy, seq,
      public_token: token, status: 'issued', registered, inter_state: interState,
      place_of_supply: placeOfSupply ? `${GST_STATES[placeOfSupply]} (${placeOfSupply})` : null,
      business, customer, lines: totals.lines, tax_summary: totals.taxSummary,
      order_number: String(order.order_number || ''), payment: paymentText(order),
      items_total: totals.itemsTotal, delivery: totals.delivery, discount: totals.discount, taxable: totals.taxable,
      cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst, total: totals.total, issued_at: now.toISOString(),
    }).select('*').single()
    if (!error) {
      // The shopper's My orders shows the invoice link from here
      await db.from('commerce_orders').update({ shipping_address: { ...ship, invoice_token: token } }).eq('id', orderId)
      return saved
    }
    if (String(error.code) !== '23505') throw new Error(error.message)
    // Someone issued this order's invoice at the same moment: use theirs
    const raced = await invoiceForOrder(db, organizationId, orderId)
    if (raced) return raced
  }
  throw new Error('Could not number the invoice. Please try again.')
}

/** Issue the invoice once the order is delivered (best effort; never blocks the delivery update). */
export async function issueInvoiceQuietly(db: any, organizationId: string, orderId: string) {
  return issueInvoice(db, organizationId, orderId).catch((error: any) => {
    console.error('[Shop invoice]', error?.message)
    return null
  })
}

/** A cancelled order: its invoice (if any) says Cancelled. The number stays used, as GST asks. */
export async function cancelInvoiceFor(db: any, organizationId: string, orderId: string, now: Date = new Date()) {
  const { error } = await db.from('commerce_invoices').update({ status: 'cancelled', cancelled_at: now.toISOString() }).eq('organization_id', organizationId).eq('order_id', orderId).eq('status', 'issued')
  if (error && !isMissingSchemaError(error, INVOICE_SCHEMA)) throw new Error(error.message)
}

// ── Credit notes ─────────────────────────────────────────────────────────────

/** supabase/migrations/20261203_shop_credit_notes.sql word for word. */
export const CREDIT_NOTE_SQL = `-- Shop credit notes (refunds on invoiced orders). Safe to run more than once. The app runs it on its own when first needed.
CREATE TABLE IF NOT EXISTS commerce_credit_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES commerce_invoices(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES commerce_orders(id) ON DELETE CASCADE,
  refund_id UUID UNIQUE,
  number TEXT NOT NULL,
  fy TEXT NOT NULL,
  seq INTEGER NOT NULL,
  public_token TEXT NOT NULL UNIQUE,
  reason TEXT,
  registered BOOLEAN NOT NULL DEFAULT FALSE,
  inter_state BOOLEAN NOT NULL DEFAULT FALSE,
  place_of_supply TEXT,
  business JSONB NOT NULL DEFAULT '{}'::jsonb,
  customer JSONB NOT NULL DEFAULT '{}'::jsonb,
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  tax_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  order_number TEXT,
  invoice_number TEXT,
  items_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  delivery NUMERIC(12,2) NOT NULL DEFAULT 0,
  taxable NUMERIC(12,2) NOT NULL DEFAULT 0,
  cgst NUMERIC(12,2) NOT NULL DEFAULT 0,
  sgst NUMERIC(12,2) NOT NULL DEFAULT 0,
  igst NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, fy, seq)
);
CREATE INDEX IF NOT EXISTS idx_commerce_credit_notes_order ON commerce_credit_notes(order_id, issued_at);
ALTER TABLE commerce_credit_notes ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
`
export const CREDIT_NOTE_LOCK = 724519030
export const creditNoteSchemaSetup = createAutoSetup('Shop credit notes', (connectionString) => runMigrationSql(connectionString, CREDIT_NOTE_SQL, CREDIT_NOTE_LOCK))

export async function withCreditNoteSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = creditNoteSchemaSetup): Promise<any> {
  const first = await step()
  if (!isMissingSchemaError(first.error, /commerce_credit_notes/)) return first
  if (!(await setup.ensure())) return first
  return step()
}

export async function creditNotesFor(db: any, organizationId: string, orderId: string): Promise<any[]> {
  const { data, error } = await db.from('commerce_credit_notes').select('*').eq('organization_id', organizationId).eq('order_id', orderId).order('issued_at', { ascending: true })
  return error ? [] : data || []
}

export async function creditNoteByToken(db: any, token: string) {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) return null
  const { data, error } = await db.from('commerce_credit_notes').select('*').eq('public_token', token).maybeSingle()
  return error ? null : data || null
}

/**
 * A refund on an order that has an invoice: a credit note for that amount, taking back the GST in the
 * same rates as the invoice. One per refund; none when the order has no invoice.
 */
export async function issueCreditNote(db: any, organizationId: string, orderId: string, refund: { id: string; amount: number; reason?: string | null }, now: Date = new Date()) {
  const invoice = await invoiceForOrder(db, organizationId, orderId)
  if (!invoice) return null
  const totals = creditNoteLines(Array.isArray(invoice.lines) ? invoice.lines : [], refund.amount, Boolean(invoice.inter_state))
  if (totals.total <= 0) return null
  const fy = financialYear(now)
  const token = randomBytes(18).toString('base64url')
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: last } = await withCreditNoteSchema(() => db.from('commerce_credit_notes').select('seq').eq('organization_id', organizationId).eq('fy', fy).order('seq', { ascending: false }).limit(1))
    const seq = (Number(last?.[0]?.seq) || 0) + 1
    const { data: saved, error } = await withCreditNoteSchema(() => db.from('commerce_credit_notes').insert({
      organization_id: organizationId, invoice_id: invoice.id, order_id: orderId, refund_id: refund.id, number: creditNoteNumber(fy, seq), fy, seq,
      public_token: token, reason: refund.reason || null, registered: invoice.registered, inter_state: invoice.inter_state, place_of_supply: invoice.place_of_supply,
      business: invoice.business, customer: invoice.customer, lines: totals.lines, tax_summary: totals.taxSummary,
      order_number: invoice.order_number, invoice_number: invoice.number, items_total: totals.itemsTotal, delivery: totals.delivery,
      taxable: totals.taxable, cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst, total: totals.total, issued_at: now.toISOString(),
    }).select('*').single())
    if (!error) return saved
    if (String(error.code) !== '23505') throw new Error(error.message)
    // Already made for this refund (unique refund_id): use it
    const { data: same } = await db.from('commerce_credit_notes').select('*').eq('refund_id', refund.id).maybeSingle()
    if (same) return same
  }
  throw new Error('Could not number the credit note. Please try again.')
}
