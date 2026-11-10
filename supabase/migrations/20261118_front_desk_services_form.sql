-- Front Desk booking flow: customers can tick several services in one WhatsApp form, grouped by
-- category. The form is published on the business's WhatsApp account once; this remembers it.
-- Safe to run more than once. The app runs it on its own the first time it is needed.
ALTER TABLE salon_settings ADD COLUMN IF NOT EXISTS services_form JSONB;

NOTIFY pgrst, 'reload schema';
