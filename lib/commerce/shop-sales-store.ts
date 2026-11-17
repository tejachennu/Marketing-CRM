/**
 * Database side of the WhatsApp selling features: message settings, carts left at checkout (for the reminder)
 * and "tell me when it's back" requests. Server only.
 */

import { randomBytes } from 'node:crypto'
import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'

/** supabase/migrations/20261127_shop_whatsapp_selling.sql word for word. */
export const SALES_SQL = `-- Shop selling on WhatsApp: message settings, carts left at checkout, back-in-stock requests.
-- Safe to run more than once. The app runs it on its own when first needed.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS shop_messages JSONB;

CREATE TABLE IF NOT EXISTS commerce_checkouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  phone_key TEXT NOT NULL,
  name TEXT,
  cart JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary TEXT,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  token TEXT NOT NULL UNIQUE,
  reminded_at TIMESTAMPTZ,
  recovered_order_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, phone_key)
);
CREATE INDEX IF NOT EXISTS idx_commerce_checkouts_due ON commerce_checkouts(reminded_at, recovered_order_id, updated_at);

CREATE TABLE IF NOT EXISTS commerce_stock_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES commerce_products(id) ON DELETE CASCADE,
  variant_id UUID,
  phone TEXT NOT NULL,
  phone_key TEXT NOT NULL,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_commerce_stock_alerts_product ON commerce_stock_alerts(product_id, sent_at);

ALTER TABLE commerce_checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_stock_alerts ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
`
export const SALES_LOCK = 724519024
export const salesSchemaSetup = createAutoSetup('Shop WhatsApp selling', (connectionString) => runMigrationSql(connectionString, SALES_SQL, SALES_LOCK))
const SALES_SCHEMA = /shop_messages|commerce_checkouts|commerce_stock_alerts/

export async function withSalesSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = salesSchemaSetup): Promise<any> {
  const first = await step()
  if (!isMissingSchemaError(first.error, SALES_SCHEMA)) return first
  if (!(await setup.ensure())) return first
  let result = await step()
  for (let attempt = 1; attempt < 4 && isMissingSchemaError(result.error, SALES_SCHEMA); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
    result = await step()
  }
  return result
}

export const phoneKey = (phone: unknown) => String(phone ?? '').replace(/\D/g, '').slice(-10)
export const newCartToken = () => randomBytes(18).toString('base64url')
