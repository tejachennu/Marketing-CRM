-- Shop loyalty points and codes for one customer. Safe to run more than once. The app runs it on its own when first needed.
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
