-- The access a business gives WAMACRM to its Meta catalog through "Connect catalog with Meta"
-- (a Facebook Login for Business configuration that asks for catalog_management). Catalog calls use
-- it instead of the WhatsApp token, which Embedded Signup issues without catalog access.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS meta_catalog_token TEXT;
