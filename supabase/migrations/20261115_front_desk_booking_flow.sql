-- Front Desk: the WhatsApp booking flow (customer sends "Book", then picks service, day and time).
-- Safe to run more than once. The app runs it on its own when the flow is first saved.
ALTER TABLE salon_settings ADD COLUMN IF NOT EXISTS booking_flow JSONB NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
