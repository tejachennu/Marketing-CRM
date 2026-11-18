-- Shop credit notes (refunds on invoiced orders). Safe to run more than once. The app runs it on its own when first needed.
CREATE TABLE IF NOT EXISTS commerce_credit_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES commerce_invoices(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES commerce_orders(id) ON DELETE CASCADE,
  refund_id UUID UNIQUE,
  number TEXT NOT NULL,
  fy TEXT NOT NULL,
  seq INTEGER NOT NULL,
  public_token TEXT NOT NULL UNIQUE,
  reason TEXT,
  registered BOOLEAN NOT NULL DEFAULT FALSE,
  inter_state BOOLEAN NOT NULL DEFAULT FALSE,
  place_of_supply TEXT,
  business JSONB NOT NULL DEFAULT '{}'::jsonb,
  customer JSONB NOT NULL DEFAULT '{}'::jsonb,
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  tax_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  order_number TEXT,
  invoice_number TEXT,
  items_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  delivery NUMERIC(12,2) NOT NULL DEFAULT 0,
  taxable NUMERIC(12,2) NOT NULL DEFAULT 0,
  cgst NUMERIC(12,2) NOT NULL DEFAULT 0,
  sgst NUMERIC(12,2) NOT NULL DEFAULT 0,
  igst NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, fy, seq)
);
CREATE INDEX IF NOT EXISTS idx_commerce_credit_notes_order ON commerce_credit_notes(order_id, issued_at);
ALTER TABLE commerce_credit_notes ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
