-- More photos and a video for each product. Safe to run more than once. The app runs it when first needed.
ALTER TABLE commerce_products ADD COLUMN IF NOT EXISTS images JSONB;
ALTER TABLE commerce_products ADD COLUMN IF NOT EXISTS video_url TEXT;
NOTIFY pgrst, 'reload schema';
