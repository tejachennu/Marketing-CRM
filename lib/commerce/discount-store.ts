/**
 * Offers and discount codes in the database (rules in discounts.ts): the offers, each use (to count them
 * and to allow one per phone), and the discount kept on the order.
 */

import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'
import { applyDiscount, bestAutomatic, cleanCode, isOpen, type CartForDiscount, type Discount, type DiscountResult } from './discounts'

/** supabase/migrations/20261125_shop_discounts.sql word for word. */
export const DISCOUNT_SQL = `-- Shop offers and discount codes. Safe to run more than once. The app runs it on its own when first needed.
-- kind: percent, flat, free_delivery, buy_get. code NULL = applies by itself.
CREATE TABLE IF NOT EXISTS commerce_discounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  code TEXT,
  kind TEXT NOT NULL,
  value NUMERIC(12,2) NOT NULL DEFAULT 0,
  buy_qty INTEGER NOT NULL DEFAULT 0,
  get_qty INTEGER NOT NULL DEFAULT 0,
  min_order NUMERIC(12,2) NOT NULL DEFAULT 0,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  once_per_phone BOOLEAN NOT NULL DEFAULT FALSE,
  first_order_only BOOLEAN NOT NULL DEFAULT FALSE,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_commerce_discounts_org ON commerce_discounts(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_discounts_code ON commerce_discounts(organization_id, code) WHERE code IS NOT NULL;

CREATE TABLE IF NOT EXISTS commerce_discount_uses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  discount_id UUID NOT NULL REFERENCES commerce_discounts(id) ON DELETE CASCADE,
  order_id UUID,
  phone_key TEXT,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_commerce_discount_uses ON commerce_discount_uses(discount_id, phone_key);

ALTER TABLE commerce_orders ADD COLUMN IF NOT EXISTS discount_code TEXT;
ALTER TABLE commerce_orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE commerce_discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_discount_uses ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
`

export const DISCOUNT_LOCK = 724519022
export const discountSchemaSetup = createAutoSetup('Shop offers', (connectionString) => runMigrationSql(connectionString, DISCOUNT_SQL, DISCOUNT_LOCK))
const DISCOUNT_SCHEMA = /commerce_discount|discount_code|discount_amount/

export async function withDiscountSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = discountSchemaSetup): Promise<any> {
  const first = await step()
  if (!isMissingSchemaError(first.error, DISCOUNT_SCHEMA)) return first
  if (!(await setup.ensure())) return first
  let result = await step()
  for (let attempt = 1; attempt < 4 && isMissingSchemaError(result.error, DISCOUNT_SCHEMA); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
    result = await step()
  }
  return result
}

const phoneKey = (phone: unknown) => String(phone ?? '').replace(/\D/g, '').slice(-10)

export function rowToDiscount(row: any): Discount {
  return {
    id: row.id, title: row.title, code: row.code || null, kind: row.kind, value: Number(row.value) || 0,
    buy_qty: Number(row.buy_qty) || 0, get_qty: Number(row.get_qty) || 0, min_order: Number(row.min_order) || 0,
    max_uses: row.max_uses === null || row.max_uses === undefined ? null : Number(row.max_uses), uses: Number(row.uses) || 0,
    once_per_phone: row.once_per_phone === true, first_order_only: row.first_order_only === true,
    starts_at: row.starts_at || null, ends_at: row.ends_at || null, active: row.active !== false,
    for_phone: row.for_phone || null,
  }
}

/** Every offer of the business (none yet = empty, without making the tables). */
export async function listDiscounts(db: any, organizationId: string): Promise<Discount[]> {
  const { data, error } = await db.from('commerce_discounts').select('*').eq('organization_id', organizationId).order('created_at', { ascending: false })
  if (error) return []
  return (data || []).map(rowToDiscount)
}

/** For a phone: has it used this offer, and has it ordered here before (not counting cancelled orders)? */
export async function phoneContext(db: any, organizationId: string, discountId: string | undefined, phone: string | null): Promise<{ usedByPhone: boolean; orderedBefore: boolean; phoneKey: string }> {
  const key = phoneKey(phone)
  if (key.length < 10) return { usedByPhone: false, orderedBefore: false, phoneKey: '' }
  let usedByPhone = false
  if (discountId) {
    const { data } = await db.from('commerce_discount_uses').select('id').eq('discount_id', discountId).eq('phone_key', key).limit(1)
    usedByPhone = Boolean(data?.length)
  }
  const { data: contacts } = await db.from('contacts').select('id').eq('organization_id', organizationId).ilike('phone_number', `%${key}`).limit(5)
  const ids = (contacts || []).map((c: any) => c.id)
  let orderedBefore = false
  if (ids.length) {
    const { data: orders } = await db.from('commerce_orders').select('id, status').eq('organization_id', organizationId).in('contact_id', ids).limit(20)
    orderedBefore = (orders || []).some((o: any) => o.status !== 'canceled')
  }
  return { usedByPhone, orderedBefore, phoneKey: key }
}

export type Decided = (DiscountResult & { ok: true; discount: Discount }) | { ok: false; reason: string } | null

/**
 * The discount for this order: the typed code (or why it does not apply), else the best offer that applies
 * by itself. null = nothing applies and nothing was typed.
 */
export async function decideDiscount(db: any, organizationId: string, code: unknown, cart: CartForDiscount, phone: string | null): Promise<Decided> {
  const typed = String(code ?? '').trim()
  const all = await listDiscounts(db, organizationId)
  if (typed) {
    const clean = cleanCode(typed)
    const d = clean ? all.find((x) => x.code === clean) : null
    if (!d) return { ok: false, reason: 'That code is not right. Check it and try again.' }
    const r = applyDiscount(d, cart, await phoneContext(db, organizationId, d.id, phone))
    return r.ok ? { ...r, discount: d } : r
  }
  const automatic = all.filter((d) => d.code === null && isOpen(d))
  if (!automatic.length) return null
  // One context per offer would cost many reads; first-order and once-per-phone use the phone's history
  const ctxFor = await phoneContext(db, organizationId, undefined, phone)
  const candidates: Discount[] = []
  for (const d of automatic) {
    if (d.once_per_phone) {
      const c = await phoneContext(db, organizationId, d.id, phone)
      if (c.usedByPhone) continue
    }
    candidates.push(d)
  }
  return bestAutomatic(candidates, cart, ctxFor)
}

/** Count a use (once per order): the offer's use count goes up; the phone is remembered. */
export async function recordDiscountUse(db: any, organizationId: string, discount: Discount, orderId: string, phone: string | null, amount: number): Promise<void> {
  if (!discount.id) return
  await withDiscountSchema(() => db.from('commerce_discount_uses').insert({ organization_id: organizationId, discount_id: discount.id, order_id: orderId, phone_key: phoneKey(phone) || null, amount }))
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: row } = await db.from('commerce_discounts').select('id, uses').eq('id', discount.id).maybeSingle()
    if (!row) return
    const { data: done } = await db.from('commerce_discounts').update({ uses: (Number(row.uses) || 0) + 1, updated_at: new Date().toISOString() }).eq('id', discount.id).eq('uses', row.uses).select('id')
    if (done?.length) return
  }
}

/** Offers that apply by themselves, for the store page to show ("Buy 2 get 1 free"). */
export function publicOffers(discounts: Discount[], now = Date.now()) {
  return discounts.filter((d) => d.code === null && !d.for_phone && isOpen(d, now)).map((d) => ({ title: d.title, kind: d.kind, min_order: d.min_order }))
}
