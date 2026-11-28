-- Front Desk: "Takes time" on each service. Off = billing only: no minutes, and customers cannot book it (booking
-- page, website, WhatsApp booking, the counter's New booking); it still goes on bills. On by default, so nothing
-- changes for existing services. Safe to run more than once. The app runs it on its own the first time it is saved.
ALTER TABLE salon_services ADD COLUMN IF NOT EXISTS takes_time BOOLEAN NOT NULL DEFAULT TRUE;

NOTIFY pgrst, 'reload schema';
