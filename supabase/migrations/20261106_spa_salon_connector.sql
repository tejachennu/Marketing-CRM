-- Spa & Salon connector: services, staff, appointments and GST invoices for the front counter.
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
