-- Front Desk: services can come from the product catalog (E-commerce), and each one can be kept off
-- bills. Every change to Front Desk setup is written to a change history: who, what, when.
-- Safe to run more than once. The app runs it on its own the first time it is needed.
ALTER TABLE salon_services ADD COLUMN IF NOT EXISTS billable BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE salon_services ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'own';
ALTER TABLE salon_services ADD COLUMN IF NOT EXISTS catalog_product_id UUID;
ALTER TABLE salon_services ADD COLUMN IF NOT EXISTS image_url TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_salon_services_catalog ON salon_services(organization_id, catalog_product_id) WHERE catalog_product_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS salon_change_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID,
  user_name TEXT,
  area TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_salon_change_log_org ON salon_change_log(organization_id, created_at DESC);
ALTER TABLE salon_change_log ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
