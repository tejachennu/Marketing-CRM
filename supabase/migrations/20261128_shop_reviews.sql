-- Shop product reviews with photos. Safe to run more than once. The app runs it on its own when first needed.
CREATE TABLE IF NOT EXISTS commerce_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES commerce_products(id) ON DELETE CASCADE,
  order_id UUID REFERENCES commerce_orders(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL,
  body TEXT,
  photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  customer_name TEXT,
  published BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_commerce_reviews_product ON commerce_reviews(product_id, published, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commerce_reviews_org ON commerce_reviews(organization_id, created_at DESC);
ALTER TABLE commerce_reviews ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
