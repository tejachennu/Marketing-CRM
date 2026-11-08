-- Front Desk (formerly Spa & Salon): the kind of business, used for wording and by the WhatsApp
-- assistant, and which WhatsApp template goes out for each automatic message (bill, booking,
-- reminder, feedback) with what fills each of its blanks.
-- Safe to run more than once. The app runs it on its own when these settings are first saved.
ALTER TABLE salon_settings ADD COLUMN IF NOT EXISTS business_type TEXT NOT NULL DEFAULT 'salon';
ALTER TABLE salon_settings ADD COLUMN IF NOT EXISTS message_templates JSONB NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
