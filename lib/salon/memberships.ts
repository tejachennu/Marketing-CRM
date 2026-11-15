/**
 * Front Desk memberships: plans a business sells (credit to spend, free sessions of chosen services,
 * a discount on services, or any mix), the cards customers hold, and every time a card is used.
 *
 * Selling a plan issues a normal GST bill and a card with its own number, link and QR (/m/<token>).
 * At billing, a card covers its free sessions first, then its discount, then pays from its credit.
 * Each use is written to salon_membership_usage; cancelling a bill gives the use back.
 */

import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'

/** supabase/migrations/20261122_front_desk_memberships.sql word for word. */
export const MEMBERSHIP_SQL = `-- Front Desk memberships: plans, customers' cards and their use. Safe to run more than once.
-- The app runs it on its own when first needed.
CREATE TABLE IF NOT EXISTS salon_membership_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  validity_days INTEGER NOT NULL DEFAULT 365,
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  credit NUMERIC(12,2) NOT NULL DEFAULT 0,
  sessions JSONB NOT NULL DEFAULT '[]'::jsonb,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 18,
  colour TEXT,
  terms TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_salon_membership_plans_org ON salon_membership_plans(organization_id);

-- status: active, cancelled. sessions: [{ service_id, name, total, used }]
CREATE TABLE IF NOT EXISTS salon_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  card_number TEXT NOT NULL,
  plan_id UUID REFERENCES salon_membership_plans(id) ON DELETE SET NULL,
  plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  credit_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  sessions JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  sold_invoice_id UUID,
  public_token TEXT NOT NULL UNIQUE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_salon_memberships_phone ON salon_memberships(organization_id, customer_phone);
CREATE INDEX IF NOT EXISTS idx_salon_memberships_contact ON salon_memberships(organization_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_salon_memberships_expiry ON salon_memberships(organization_id, expires_at);

-- kind: sale, session, discount, credit, refund, adjust, cancel
CREATE TABLE IF NOT EXISTS salon_membership_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  membership_id UUID NOT NULL REFERENCES salon_memberships(id) ON DELETE CASCADE,
  invoice_id UUID,
  kind TEXT NOT NULL,
  service_id UUID,
  detail TEXT,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_salon_membership_usage_org ON salon_membership_usage(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_salon_membership_usage_card ON salon_membership_usage(membership_id, created_at DESC);

ALTER TABLE salon_invoices ADD COLUMN IF NOT EXISTS membership_id UUID;
ALTER TABLE salon_invoices ADD COLUMN IF NOT EXISTS membership_paid NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE salon_membership_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_membership_usage ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
`

export const MEMBERSHIP_LOCK = 724519019
export const membershipSchemaSetup = createAutoSetup('Front Desk memberships', (connectionString) => runMigrationSql(connectionString, MEMBERSHIP_SQL, MEMBERSHIP_LOCK))
const MEMBERSHIP_SCHEMA = /salon_membership|membership_id|membership_paid/

/** Run a database step; if the membership tables or columns are missing, add them and try again. */
export async function withMembershipSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = membershipSchemaSetup): Promise<any> {
  const first = await step()
  if (!isMissingSchemaError(first.error, MEMBERSHIP_SCHEMA)) return first
  if (!(await setup.ensure())) return first
  let result = await step()
  for (let attempt = 1; attempt < 4 && isMissingSchemaError(result.error, MEMBERSHIP_SCHEMA); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
    result = await step()
  }
  return result
}

export * from './membership-rules'
