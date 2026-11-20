-- The Front Desk business website: cover photo, gallery, words, colour, which parts to show, and which site the
-- business's own domain opens (website or online store). Safe to run more than once. The app runs it on its own.
ALTER TABLE salon_settings ADD COLUMN IF NOT EXISTS website JSONB NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
