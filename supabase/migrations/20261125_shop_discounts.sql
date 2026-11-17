-- Shop offers and discount codes. Safe to run more than once. The app runs it on its own when first needed.
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
