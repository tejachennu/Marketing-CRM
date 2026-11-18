/**
 * Loyalty points in the database (rules in loyalty.ts): a ledger of points earned (+) and used (−) per
 * phone. Earned once per order when it is delivered; used at checkout; given back if that order is
 * cancelled; taken back if a delivered order is refunded in full. Server only.
 */

import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'
import { phoneKey, pointsEarned, readLoyaltySettings, type LoyaltySettings } from './loyalty'

/** supabase/migrations/20261202_shop_loyalty.sql word for word. */
export const LOYALTY_SQL = `-- Shop loyalty points and codes for one customer. Safe to run more than once. The app runs it on its own when first needed.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS shop_loyalty JSONB;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'commerce_discounts') THEN
    ALTER TABLE commerce_discounts ADD COLUMN IF NOT EXISTS for_phone TEXT;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS commerce_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  phone_key TEXT NOT NULL,
  points INTEGER NOT NULL,
  reason TEXT NOT NULL,
  order_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_commerce_points_phone ON commerce_points(organization_id, phone_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_points_order_reason ON commerce_points(order_id, reason) WHERE order_id IS NOT NULL;
ALTER TABLE commerce_points ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
`
export const LOYALTY_LOCK = 724519029
export const loyaltySchemaSetup = createAutoSetup('Shop loyalty', (connectionString) => runMigrationSql(connectionString, LOYALTY_SQL, LOYALTY_LOCK))
const LOYALTY_SCHEMA = /commerce_points|shop_loyalty|for_phone/

export async function withLoyaltySchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = loyaltySchemaSetup): Promise<any> {
  const first = await step()
  // Only this feature's own columns and table (a missing discounts table is set up by the offers code)
  if (!first.error || !LOYALTY_SCHEMA.test(String(first.error.message || '')) || !isMissingSchemaError(first.error, LOYALTY_SCHEMA)) return first
  if (!(await setup.ensure())) return first
  let result = await step()
  for (let attempt = 1; attempt < 4 && result.error && LOYALTY_SCHEMA.test(String(result.error.message || '')); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
    result = await step()
  }
  return result
}

export async function loadLoyaltySettings(db: any, organizationId: string): Promise<LoyaltySettings> {
  const { data } = await withLoyaltySchema(() => db.from('organizations').select('id, shop_loyalty').eq('id', organizationId).maybeSingle())
  return readLoyaltySettings(data?.shop_loyalty)
}

export async function saveLoyaltySettings(db: any, organizationId: string, settings: LoyaltySettings) {
  return withLoyaltySchema(() => db.from('organizations').update({ shop_loyalty: readLoyaltySettings(settings) }).eq('id', organizationId))
}

/** A phone's points right now. */
export async function pointsBalance(db: any, organizationId: string, phone: unknown): Promise<number> {
  const key = phoneKey(phone)
  if (key.length !== 10) return 0
  const { data, error } = await db.from('commerce_points').select('points').eq('organization_id', organizationId).eq('phone_key', key)
  if (error) return 0
  return Math.max(0, (data || []).reduce((sum: number, row: any) => sum + (Number(row.points) || 0), 0))
}

async function addEntry(db: any, row: { organization_id: string; phone_key: string; points: number; reason: string; order_id: string | null }) {
  const { error } = await withLoyaltySchema(() => db.from('commerce_points').insert(row))
  // Already recorded for this order (unique per order and reason): nothing to do
  if (error && String(error.code) !== '23505') throw new Error(error.message)
  return !error
}

/** Points used on a new order (taken off the balance). */
export async function usePoints(db: any, organizationId: string, phone: unknown, points: number, orderId: string) {
  if (points <= 0) return false
  return addEntry(db, { organization_id: organizationId, phone_key: phoneKey(phone), points: -Math.floor(points), reason: 'used', order_id: orderId })
}

/** A delivered order earns its points (once). Points used on the order are not earned back. */
export async function earnPointsFor(db: any, organizationId: string, orderId: string) {
  const { data: org } = await withLoyaltySchema(() => db.from('organizations').select('id, shop_loyalty').eq('id', organizationId).maybeSingle())
  const settings = readLoyaltySettings(org?.shop_loyalty)
  if (!settings.on) return 0
  const { data: order } = await db.from('commerce_orders').select('id, status, total_amount, shipping_address').eq('id', orderId).eq('organization_id', organizationId).maybeSingle()
  if (!order || order.status !== 'delivered') return 0
  const key = phoneKey(order.shipping_address?.phone_number)
  const points = pointsEarned(Number(order.total_amount) || 0, settings)
  if (key.length !== 10 || points <= 0) return 0
  return (await addEntry(db, { organization_id: organizationId, phone_key: key, points, reason: 'earned', order_id: orderId })) ? points : 0
}

/** A cancelled order gives back the points it used. */
export async function returnPointsFor(db: any, organizationId: string, orderId: string) {
  const { data, error } = await db.from('commerce_points').select('phone_key, points, reason').eq('organization_id', organizationId).eq('order_id', orderId)
  if (error) return
  const used = (data || []).find((r: any) => r.reason === 'used')
  if (used) await addEntry(db, { organization_id: organizationId, phone_key: used.phone_key, points: Math.abs(Number(used.points) || 0), reason: 'given_back', order_id: orderId })
  const earned = (data || []).find((r: any) => r.reason === 'earned')
  if (earned) await addEntry(db, { organization_id: organizationId, phone_key: earned.phone_key, points: -Math.abs(Number(earned.points) || 0), reason: 'taken_back', order_id: orderId })
}
