-- Shop GST invoices. Safe to run more than once. The app runs it on its own when first needed.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS shop_invoice JSONB;
ALTER TABLE commerce_products ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(5,2);
CREATE TABLE IF NOT EXISTS commerce_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES commerce_orders(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  fy TEXT NOT NULL,
  seq INTEGER NOT NULL,
  public_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'issued',
  registered BOOLEAN NOT NULL DEFAULT FALSE,
  inter_state BOOLEAN NOT NULL DEFAULT FALSE,
  place_of_supply TEXT,
  business JSONB NOT NULL DEFAULT '{}'::jsonb,
  customer JSONB NOT NULL DEFAULT '{}'::jsonb,
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  tax_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  order_number TEXT,
  payment TEXT,
  items_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  delivery NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  taxable NUMERIC(12,2) NOT NULL DEFAULT 0,
  cgst NUMERIC(12,2) NOT NULL DEFAULT 0,
  sgst NUMERIC(12,2) NOT NULL DEFAULT 0,
  igst NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  UNIQUE (order_id),
  UNIQUE (organization_id, fy, seq)
);
CREATE INDEX IF NOT EXISTS idx_commerce_invoices_org ON commerce_invoices(organization_id, issued_at DESC);
ALTER TABLE commerce_invoices ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
