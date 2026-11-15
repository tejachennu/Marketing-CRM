-- The online store page's settings (banners, categories, colour, delivery). Safe to run more than once.
-- The app runs it on its own when first needed.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS storefront JSONB;

NOTIFY pgrst, 'reload schema';
