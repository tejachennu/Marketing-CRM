-- Front Desk: "We take appointments". Shops that only bill walk-ins switch it off: bookings, the calendar, the
-- booking page, booking on WhatsApp and reminders are hidden; walk-in bills, invoices, reviews, memberships and the
-- team stay. On by default, so nothing changes for existing businesses. Safe to run more than once. The app runs it
-- on its own the first time the switch is saved.
ALTER TABLE salon_settings ADD COLUMN IF NOT EXISTS takes_appointments BOOLEAN NOT NULL DEFAULT TRUE;

NOTIFY pgrst, 'reload schema';
