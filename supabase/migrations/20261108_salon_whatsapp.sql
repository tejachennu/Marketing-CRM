-- Spa & Salon on WhatsApp: the chat assistant, bookings by chat (with approval), feedback after
-- visits, appointment reminders and staff commission. Safe to run more than once. The app runs it
-- on its own the first time one of these is used.

-- Opening hours, and what the salon does on WhatsApp
ALTER TABLE salon_settings ADD COLUMN IF NOT EXISTS opens_at TEXT NOT NULL DEFAULT '10:00';
ALTER TABLE salon_settings ADD COLUMN IF NOT EXISTS closes_at TEXT NOT NULL DEFAULT '21:00';
ALTER TABLE salon_settings ADD COLUMN IF NOT EXISTS closed_weekdays INTEGER[] NOT NULL DEFAULT '{}';
ALTER TABLE salon_settings ADD COLUMN IF NOT EXISTS chat_assistant BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE salon_settings ADD COLUMN IF NOT EXISTS auto_approve_bookings BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE salon_settings ADD COLUMN IF NOT EXISTS reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE salon_settings ADD COLUMN IF NOT EXISTS feedback_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE salon_settings ADD COLUMN IF NOT EXISTS feedback_delay_minutes INTEGER NOT NULL DEFAULT 120;
ALTER TABLE salon_settings ADD COLUMN IF NOT EXISTS review_link TEXT;

-- Commission: the share of each service's value (before GST, after discount) the person who did it earns
ALTER TABLE salon_staff ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5,2) NOT NULL DEFAULT 0;

-- Where a booking came from (counter, voice, chat). Chat bookings wait as status 'requested'
-- until the counter approves them, unless the salon approves free slots automatically.
ALTER TABLE salon_appointments ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'counter';
ALTER TABLE salon_appointments ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_salon_appointments_status ON salon_appointments(organization_id, status, starts_at);

-- Feedback is asked a while after the bill: due time, then sent / skipped / failed
ALTER TABLE salon_invoices ADD COLUMN IF NOT EXISTS feedback_due_at TIMESTAMPTZ;
ALTER TABLE salon_invoices ADD COLUMN IF NOT EXISTS feedback_status TEXT;
CREATE INDEX IF NOT EXISTS idx_salon_invoices_feedback ON salon_invoices(organization_id, feedback_due_at) WHERE feedback_status IS NULL;

-- Ratings from customers, with who served them
CREATE TABLE IF NOT EXISTS salon_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES salon_invoices(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  customer_name TEXT,
  customer_phone TEXT,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  staff_ids UUID[] NOT NULL DEFAULT '{}',
  staff_names TEXT[] NOT NULL DEFAULT '{}',
  followed_up_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (invoice_id)
);
CREATE INDEX IF NOT EXISTS idx_salon_feedback_org ON salon_feedback(organization_id, created_at DESC);

-- Times offered to a customer in the chat: tapping one books it (the button carries the offer id)
CREATE TABLE IF NOT EXISTS salon_chat_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  customer_name TEXT,
  customer_phone TEXT NOT NULL,
  service_ids UUID[] NOT NULL DEFAULT '{}',
  staff_id UUID REFERENCES salon_staff(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_salon_chat_offers_org ON salon_chat_offers(organization_id, created_at DESC);

ALTER TABLE salon_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_chat_offers ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
