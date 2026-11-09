-- Front Desk booking flow with the business's own steps: a booking in progress on WhatsApp (which
-- step, the services and person picked, the answers so far), and the answers carried to the times
-- offered so they end up on the booking. Safe to run more than once. The app runs it on its own.
CREATE TABLE IF NOT EXISTS salon_booking_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  customer_phone TEXT NOT NULL,
  step INTEGER NOT NULL DEFAULT 0,
  waiting TEXT,
  service_ids UUID[] NOT NULL DEFAULT '{}',
  staff_id UUID,
  answers JSONB NOT NULL DEFAULT '[]'::jsonb,
  language TEXT NOT NULL DEFAULT 'en',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_salon_booking_sessions_phone ON salon_booking_sessions(organization_id, customer_phone);
ALTER TABLE salon_booking_sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE salon_chat_offers ADD COLUMN IF NOT EXISTS notes TEXT;

NOTIFY pgrst, 'reload schema';
