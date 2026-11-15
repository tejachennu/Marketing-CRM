-- Customer accounts on the online store page (sign in with Google, order history, saved cart). Safe to run more than once.
-- The app runs it on its own when first needed.
CREATE TABLE IF NOT EXISTS store_shoppers (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  email TEXT,
  name TEXT,
  phone TEXT,
  address JSONB,
  cart JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
-- Only the server reads it (no policies: the public keys see nothing)
ALTER TABLE store_shoppers ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_orders ADD COLUMN IF NOT EXISTS shopper_id UUID;
CREATE INDEX IF NOT EXISTS commerce_orders_shopper_idx ON commerce_orders (organization_id, shopper_id, created_at DESC) WHERE shopper_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
