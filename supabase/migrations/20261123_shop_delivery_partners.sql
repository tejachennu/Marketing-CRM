-- Delivery partners (Shiprocket, Delhivery): settings, shipments, product weight. Safe to run more than once.
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
