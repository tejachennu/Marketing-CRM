/**
 * The Spa & Salon tables. SALON_SCHEMA_SQL is supabase/migrations/20261106_spa_salon_connector.sql
 * SALON_LOGO_SQL is 20261107_salon_logo.sql and SALON_WHATSAPP_SQL is 20261108_salon_whatsapp.sql,
 * word for word (tests/salon.test.cjs checks). It sets itself up the first time the connector is
 * used, through the app's own database connection, so no one has to run SQL by hand.
 */

import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'

export const SALON_SCHEMA_SQL = `-- Spa & Salon connector: services, staff, appointments and GST invoices for the front counter.
-- Safe to run more than once. The app runs it on its own the first time the connector is used.

-- Which use-case connectors a workspace has switched on (E-commerce uses enable_commerce)
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS enabled_connectors TEXT[] NOT NULL DEFAULT '{}';

-- Business details printed on invoices, and counter preferences
CREATE TABLE IF NOT EXISTS salon_settings (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  business_name TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  gstin TEXT,
  invoice_prefix TEXT NOT NULL DEFAULT 'INV',
  prices_include_tax BOOLEAN NOT NULL DEFAULT FALSE,
  invoice_note TEXT,
  voice_replies BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS salon_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'General',
  name TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 18,
  sac_code TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_salon_services_org ON salon_services(organization_id);

CREATE TABLE IF NOT EXISTS salon_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  service_ids UUID[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_salon_staff_org ON salon_staff(organization_id);

-- status: booked, arrived, in_service, completed, cancelled, no_show
-- services: what was booked, as it was priced then [{ service_id, name, price, duration_minutes, tax_rate, sac_code }]
CREATE TABLE IF NOT EXISTS salon_appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  staff_id UUID REFERENCES salon_staff(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked',
  services JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  invoice_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_salon_appointments_org ON salon_appointments(organization_id, starts_at);

-- status: unpaid, paid, void. Issued invoices are never deleted.
-- business: the business details as they were when the invoice was issued
CREATE TABLE IF NOT EXISTS salon_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  number TEXT NOT NULL,
  appointment_id UUID REFERENCES salon_appointments(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  customer_gstin TEXT,
  staff_name TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  prices_include_tax BOOLEAN NOT NULL DEFAULT FALSE,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  taxable NUMERIC(12,2) NOT NULL DEFAULT 0,
  cgst NUMERIC(12,2) NOT NULL DEFAULT 0,
  sgst NUMERIC(12,2) NOT NULL DEFAULT 0,
  igst NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unpaid',
  payment_method TEXT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  public_token TEXT NOT NULL UNIQUE,
  business JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_salon_invoices_org ON salon_invoices(organization_id, issued_at DESC);

-- What was said at the counter and what was done with it (the audio itself is never kept)
CREATE TABLE IF NOT EXISTS salon_voice_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID,
  transcript TEXT NOT NULL,
  action JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_salon_voice_log_org ON salon_voice_log(organization_id, created_at DESC);

-- Only the server (service role) reads and writes these tables
ALTER TABLE salon_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_voice_log ENABLE ROW LEVEL SECURITY;

-- Supabase's API caches the list of tables: reload it so the counter works straight away
NOTIFY pgrst, 'reload schema';
`

/** supabase/migrations/20261107_salon_logo.sql word for word: the logo on invoices. */
export const SALON_LOGO_SQL = `-- Spa & Salon: the business logo printed on invoices (a link to the uploaded image).
-- Safe to run more than once. The app runs it on its own when the logo is first saved.
ALTER TABLE salon_settings ADD COLUMN IF NOT EXISTS logo_url TEXT;

NOTIFY pgrst, 'reload schema';
`

/** supabase/migrations/20261108_salon_whatsapp.sql word for word: chat, bookings, feedback, commission. */
export const SALON_WHATSAPP_SQL = `-- Spa & Salon on WhatsApp: the chat assistant, bookings by chat (with approval), feedback after
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
`

/** supabase/migrations/20261109_salon_feedback_form.sql word for word: per-person ratings, tags, source. */
export const SALON_FEEDBACK_FORM_SQL = `-- Spa & Salon: the feedback form. A rating for each person who served, what stood out, and
-- where the feedback came from (the form, or a rating tapped in the chat).
-- Safe to run more than once. The app runs it on its own when feedback is first saved.
ALTER TABLE salon_feedback ADD COLUMN IF NOT EXISTS staff_ratings JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE salon_feedback ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE salon_feedback ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'chat';

NOTIFY pgrst, 'reload schema';
`

/** supabase/migrations/20261110_front_desk.sql word for word: business type and the template for each message. */
export const FRONT_DESK_SQL = `-- Front Desk (formerly Spa & Salon): the kind of business, used for wording and by the WhatsApp
-- assistant, and which WhatsApp template goes out for each automatic message (bill, booking,
-- reminder, feedback) with what fills each of its blanks.
-- Safe to run more than once. The app runs it on its own when these settings are first saved.
ALTER TABLE salon_settings ADD COLUMN IF NOT EXISTS business_type TEXT NOT NULL DEFAULT 'salon';
ALTER TABLE salon_settings ADD COLUMN IF NOT EXISTS message_templates JSONB NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
`

/** supabase/migrations/20261112_front_desk_categories.sql word for word: the business's service categories. */
export const FRONT_DESK_CATEGORIES_SQL = `-- Front Desk: the business's own service categories, in order, including ones with no services yet.
-- Safe to run more than once. The app runs it on its own when categories are first saved.
ALTER TABLE salon_settings ADD COLUMN IF NOT EXISTS service_categories TEXT[] NOT NULL DEFAULT '{}';

NOTIFY pgrst, 'reload schema';
`

/** supabase/migrations/20261113_front_desk_action_log.sql word for word: counter actions done once. */
export const FRONT_DESK_ACTION_LOG_SQL = `-- Front Desk: counter actions sent with a client reference (the mobile app's offline queue) are
-- remembered, so an action sent twice (a lost reply, a retry after the network came back) is done once.
-- Safe to run more than once. The app runs it on its own the first time it is needed.
CREATE TABLE IF NOT EXISTS salon_action_log (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_ref TEXT NOT NULL,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, client_ref)
);
ALTER TABLE salon_action_log ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
`

/** supabase/migrations/20261115_front_desk_booking_flow.sql word for word: the WhatsApp booking flow. */
export const FRONT_DESK_BOOKING_FLOW_SQL = `-- Front Desk: the WhatsApp booking flow (customer sends "Book", then picks service, day and time).
-- Safe to run more than once. The app runs it on its own when the flow is first saved.
ALTER TABLE salon_settings ADD COLUMN IF NOT EXISTS booking_flow JSONB NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
`

/** supabase/migrations/20261116_front_desk_booking_sessions.sql word for word: bookings in progress. */
export const FRONT_DESK_BOOKING_SESSIONS_SQL = `-- Front Desk booking flow with the business's own steps: a booking in progress on WhatsApp (which
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
`

/** supabase/migrations/20261117_front_desk_catalog_and_history.sql word for word: catalog services, billing on/off, change history. */
export const FRONT_DESK_CATALOG_SQL = `-- Front Desk: services can come from the product catalog (E-commerce), and each one can be kept off
-- bills. Every change to Front Desk setup is written to a change history: who, what, when.
-- Safe to run more than once. The app runs it on its own the first time it is needed.
ALTER TABLE salon_services ADD COLUMN IF NOT EXISTS billable BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE salon_services ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'own';
ALTER TABLE salon_services ADD COLUMN IF NOT EXISTS catalog_product_id UUID;
ALTER TABLE salon_services ADD COLUMN IF NOT EXISTS image_url TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_salon_services_catalog ON salon_services(organization_id, catalog_product_id) WHERE catalog_product_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS salon_change_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID,
  user_name TEXT,
  area TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_salon_change_log_org ON salon_change_log(organization_id, created_at DESC);
ALTER TABLE salon_change_log ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
`

const SALON_SCHEMA_LOCK = 724519002

export const salonSchemaSetup = createAutoSetup('Front Desk', (connectionString) => runMigrationSql(connectionString, `${SALON_SCHEMA_SQL}\n${SALON_LOGO_SQL}\n${SALON_WHATSAPP_SQL}\n${SALON_FEEDBACK_FORM_SQL}\n${FRONT_DESK_SQL}\n${FRONT_DESK_CATEGORIES_SQL}\n${FRONT_DESK_ACTION_LOG_SQL}\n${FRONT_DESK_BOOKING_FLOW_SQL}\n${FRONT_DESK_BOOKING_SESSIONS_SQL}\n${FRONT_DESK_CATALOG_SQL}`, SALON_SCHEMA_LOCK))

/** True when an error means the salon tables (or the connectors column) are not there yet. */
export function isMissingSalonSchema(error: any): boolean {
  return isMissingSchemaError(error, /salon_|enabled_connectors/)
}

/**
 * Run a database step; if it fails because the salon tables are missing, set them up and try once
 * more. `step` returns a Supabase-style { data, error } result.
 */
export async function withSalonSchema(step: () => PromiseLike<any>, options: { setup?: { ensure: () => Promise<boolean> }; waitMs?: number; attempts?: number } = {}): Promise<any> {
  const { setup = salonSchemaSetup, waitMs = 600, attempts = 4 } = options
  const first = await step()
  if (!isMissingSalonSchema(first.error)) return first
  if (!(await setup.ensure())) return first
  // Supabase's API notices new tables and columns a moment after they are added: give it a few tries
  let result = await step()
  for (let attempt = 1; attempt < attempts && isMissingSalonSchema(result.error); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, waitMs * attempt))
    result = await step()
  }
  return result
}
