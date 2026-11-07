-- Spa & Salon: the business logo printed on invoices (a link to the uploaded image).
-- Safe to run more than once. The app runs it on its own when the logo is first saved.
ALTER TABLE salon_settings ADD COLUMN IF NOT EXISTS logo_url TEXT;

NOTIFY pgrst, 'reload schema';
