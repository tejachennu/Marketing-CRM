-- Shop returns and refunds. Safe to run more than once. The app runs it on its own when first needed.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS shop_returns JSONB;
CREATE TABLE IF NOT EXISTS commerce_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES commerce_orders(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  reason TEXT,
  method TEXT NOT NULL,
  razorpay_refund_id TEXT,
  status TEXT NOT NULL DEFAULT 'done',
  restocked BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_commerce_refunds_order ON commerce_refunds(order_id, created_at);
ALTER TABLE commerce_refunds ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
