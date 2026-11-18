/**
 * Shop reports from the database (numbers in shop-reports.ts) and the store visit counter. Server only.
 */

import { getPool } from '../campaign-stats'
import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'
import { buildShopReport, istDay, periodStart, type ShopReport } from './shop-reports'

/** supabase/migrations/20261130_shop_reports.sql word for word. */
export const REPORTS_SQL = `-- Shop reports: store visits per day. Safe to run more than once. The app runs it on its own when first needed.
CREATE TABLE IF NOT EXISTS commerce_store_visits (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  visits INTEGER NOT NULL DEFAULT 0,
  product_views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, day)
);
ALTER TABLE commerce_store_visits ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
`
export const REPORTS_LOCK = 724519027
export const reportsSchemaSetup = createAutoSetup('Shop reports', (connectionString) => runMigrationSql(connectionString, REPORTS_SQL, REPORTS_LOCK))

export async function withReportsSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = reportsSchemaSetup): Promise<any> {
  const first = await step()
  if (!isMissingSchemaError(first.error, /commerce_store_visits/)) return first
  if (!(await setup.ensure())) return first
  return step()
}

/** One store visit (or a product page view) today. Exact with a direct database connection; close enough without. */
export async function countVisit(db: any, organizationId: string, kind: 'visit' | 'product', now: Date = new Date(), pool: any = getPool()) {
  const day = istDay(now)
  const column = kind === 'product' ? 'product_views' : 'visits'
  if (pool) {
    const run = () => pool.query(
      `INSERT INTO commerce_store_visits (organization_id, day, ${column}) VALUES ($1, $2, 1)
       ON CONFLICT (organization_id, day) DO UPDATE SET ${column} = commerce_store_visits.${column} + 1`,
      [organizationId, day],
    )
    try { await run(); return } catch (error: any) {
      if (!isMissingSchemaError(error, /commerce_store_visits/) || !(await reportsSchemaSetup.ensure())) throw error
      await run()
      return
    }
  }
  const { data } = await withReportsSchema(() => db.from('commerce_store_visits').select('*').eq('organization_id', organizationId).eq('day', day).maybeSingle())
  if (data) await db.from('commerce_store_visits').update({ [column]: (Number(data[column]) || 0) + 1 }).eq('organization_id', organizationId).eq('day', day)
  else await db.from('commerce_store_visits').insert({ organization_id: organizationId, day, visits: kind === 'visit' ? 1 : 0, product_views: kind === 'product' ? 1 : 0 })
}

/** The report for the last `days` days. */
export async function loadShopReport(db: any, organizationId: string, days: number, now: Date = new Date()): Promise<ShopReport> {
  const since = periodStart(days, now)
  const { data: orders } = await db.from('commerce_orders')
    .select('id, status, total_amount, created_at, checkout_type, contact_id, shipping_address, contact:contacts(first_name, last_name, phone_number)')
    .eq('organization_id', organizationId).gte('created_at', since).order('created_at', { ascending: false }).limit(5000)
  const ids = (orders || []).map((o: any) => o.id)
  const items: any[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('commerce_order_items').select('order_id, product_id, title, quantity, unit_price, total_price').in('order_id', ids.slice(i, i + 200))
    items.push(...(data || []))
  }
  const { data: checkouts, error: cartError } = await db.from('commerce_checkouts').select('created_at, reminded_at, recovered_order_id, total').eq('organization_id', organizationId).gte('created_at', since).limit(5000)
  const { data: visits } = await withReportsSchema(() => db.from('commerce_store_visits').select('day, visits, product_views').eq('organization_id', organizationId).gte('day', istDay(since)))
  // Phones that ordered before this period: those customers are coming back
  const { data: earlier } = await db.from('commerce_orders').select('shipping_address').eq('organization_id', organizationId).lt('created_at', since).neq('status', 'canceled').order('created_at', { ascending: false }).limit(5000)
  return buildShopReport({
    days, now,
    orders: orders || [],
    items,
    checkouts: cartError ? [] : checkouts || [],
    visits: visits || [],
    earlierPhones: (earlier || []).map((o: any) => o.shipping_address?.phone_number).filter(Boolean),
  })
}
