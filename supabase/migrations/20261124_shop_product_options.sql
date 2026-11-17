-- Product options (size, colour…) with a price and stock for each combination. Safe to run more than once.
-- The app runs it on its own when first needed.
ALTER TABLE commerce_products ADD COLUMN IF NOT EXISTS options JSONB;

CREATE TABLE IF NOT EXISTS commerce_product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES commerce_products(id) ON DELETE CASCADE,
  options JSONB NOT NULL DEFAULT '{}'::jsonb,
  name TEXT NOT NULL,
  sku TEXT,
  price NUMERIC(12,2),
  stock INTEGER,
  image_url TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_commerce_product_variants_product ON commerce_product_variants(product_id, position);
CREATE INDEX IF NOT EXISTS idx_commerce_product_variants_org ON commerce_product_variants(organization_id);
ALTER TABLE commerce_product_variants ENABLE ROW LEVEL SECURITY;

ALTER TABLE commerce_order_items ADD COLUMN IF NOT EXISTS variant_id UUID;
ALTER TABLE commerce_order_items ADD COLUMN IF NOT EXISTS variant_name TEXT;

NOTIFY pgrst, 'reload schema';
