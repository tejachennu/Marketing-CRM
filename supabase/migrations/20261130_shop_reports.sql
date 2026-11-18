-- Shop reports: store visits per day. Safe to run more than once. The app runs it on its own when first needed.
CREATE TABLE IF NOT EXISTS commerce_store_visits (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  visits INTEGER NOT NULL DEFAULT 0,
  product_views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, day)
);
ALTER TABLE commerce_store_visits ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
