-- Front Desk: shop holidays. Days the business is closed besides its weekly closed days: one-off (Diwali this year)
-- or repeating every year, every month on a date, or every month on a weekday (the 2nd Tuesday). On a holiday no
-- times are offered for bookings, the website says it is closed, and attendance does not count it as a working day.
-- A JSON list: [{ id, name, start, days, repeat }]. Safe to run more than once. The app runs it on its own the first
-- time a holiday is saved.
ALTER TABLE salon_settings ADD COLUMN IF NOT EXISTS holidays JSONB NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
