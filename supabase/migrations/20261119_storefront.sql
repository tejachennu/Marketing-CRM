-- The online store page's settings (banners, categories, colour, delivery). Safe to run more than once.
-- The app runs it on its own when first needed.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS storefront JSONB;
-- The business's own Razorpay account, for online payment on the store page (server only; never sent to a page)
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS store_razorpay_key_id TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS store_razorpay_key_secret TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS store_razorpay_webhook_secret TEXT;

NOTIFY pgrst, 'reload schema';
