-- Front Desk: the business's own service categories, in order, including ones with no services yet.
-- Safe to run more than once. The app runs it on its own when categories are first saved.
ALTER TABLE salon_settings ADD COLUMN IF NOT EXISTS service_categories TEXT[] NOT NULL DEFAULT '{}';

NOTIFY pgrst, 'reload schema';
