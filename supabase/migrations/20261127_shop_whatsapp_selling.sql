-- Shop selling on WhatsApp: message settings, carts left at checkout, back-in-stock requests.
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
