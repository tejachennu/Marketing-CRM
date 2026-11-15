-- The business's own web address for its online store (e.g. shop.theirname.com). Safe to run more than once.
-- The app runs it on its own when first needed.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS store_domain TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS organizations_store_domain_key ON organizations (store_domain) WHERE store_domain IS NOT NULL;

NOTIFY pgrst, 'reload schema';
