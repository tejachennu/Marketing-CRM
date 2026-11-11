-- WAMA CRM plans: Starter ₹999 (WAMA's own WhatsApp number, Front Desk only), Growth ₹2,500, and
-- Pro 1 / 2 / 3 (₹6,000 / ₹9,000 / ₹12,000), plus a message wallet for WhatsApp messages sent from
-- WAMA's number at Meta's price. Safe to run more than once. The app runs it on its own when needed.

ALTER TABLE organization_billing ALTER COLUMN plan SET DEFAULT 'growth';
ALTER TABLE organization_billing ADD COLUMN IF NOT EXISTS plan_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE organization_billing ADD COLUMN IF NOT EXISTS pending_plan TEXT;
ALTER TABLE organization_billing ADD COLUMN IF NOT EXISTS pending_subscription_id TEXT;
-- The plan the current auto-pay charges for (empty on the old ₹3,000 auto-pay)
ALTER TABLE organization_billing ADD COLUMN IF NOT EXISTS subscription_plan TEXT;
-- own = the business's WhatsApp number; shared = WAMA's number sends its booking messages
ALTER TABLE organization_billing ADD COLUMN IF NOT EXISTS whatsapp_mode TEXT NOT NULL DEFAULT 'own';
-- Rupees with paise fractions
ALTER TABLE organization_billing ADD COLUMN IF NOT EXISTS message_balance NUMERIC(14, 4) NOT NULL DEFAULT 0;

-- Workspaces from before the plans keep every connector they use (Super Admin can change this)
UPDATE organization_billing
   SET plan_overrides = plan_overrides || '{"connectors": 3}'::jsonb
 WHERE plan = 'pro_monthly' AND NOT (plan_overrides ? 'connectors');
-- The old single plan (₹3,000 a month) is now Growth
UPDATE organization_billing SET plan = 'growth' WHERE plan = 'pro_monthly';

CREATE TABLE IF NOT EXISTS message_wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- topup | usage | refund | adjustment
  kind TEXT NOT NULL,
  amount NUMERIC(14, 4) NOT NULL,
  -- usage: our reference for the message (one charge per message); refund: the same reference
  message_ref TEXT,
  category TEXT,
  razorpay_payment_id TEXT UNIQUE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_message_wallet_one_charge ON message_wallet_transactions (message_ref) WHERE kind = 'usage';
CREATE UNIQUE INDEX IF NOT EXISTS idx_message_wallet_one_refund ON message_wallet_transactions (message_ref) WHERE kind = 'refund';
CREATE INDEX IF NOT EXISTS idx_message_wallet_org ON message_wallet_transactions (organization_id, created_at DESC);
ALTER TABLE message_wallet_transactions ENABLE ROW LEVEL SECURITY;
-- No policies: only the server (service role) reads and writes the wallet.

-- Charge one message. Returns TRUE when the balance covered it; FALSE (nothing taken) when it did not,
-- so the message is not sent. Charging the same message twice takes the money once.
CREATE OR REPLACE FUNCTION message_wallet_charge(p_org UUID, p_amount NUMERIC, p_ref TEXT, p_category TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_balance NUMERIC;
BEGIN
  IF EXISTS (SELECT 1 FROM message_wallet_transactions WHERE message_ref = p_ref AND kind = 'usage') THEN
    RETURN TRUE;
  END IF;
  SELECT message_balance INTO old_balance FROM organization_billing WHERE organization_id = p_org FOR UPDATE;
  IF old_balance IS NULL OR old_balance < p_amount THEN
    RETURN FALSE;
  END IF;
  UPDATE organization_billing SET message_balance = old_balance - p_amount, updated_at = NOW() WHERE organization_id = p_org;
  INSERT INTO message_wallet_transactions (organization_id, kind, amount, message_ref, category)
  VALUES (p_org, 'usage', -p_amount, p_ref, p_category);
  RETURN TRUE;
END;
$$;

-- Give back a message's charge (Meta refused it or reported it failed). Once per message.
CREATE OR REPLACE FUNCTION message_wallet_refund(p_ref TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  charge RECORD;
BEGIN
  SELECT organization_id, amount, category INTO charge FROM message_wallet_transactions WHERE message_ref = p_ref AND kind = 'usage';
  IF charge IS NULL OR EXISTS (SELECT 1 FROM message_wallet_transactions WHERE message_ref = p_ref AND kind = 'refund') THEN
    RETURN 0;
  END IF;
  UPDATE organization_billing SET message_balance = message_balance - charge.amount, updated_at = NOW() WHERE organization_id = charge.organization_id;
  INSERT INTO message_wallet_transactions (organization_id, kind, amount, message_ref, category)
  VALUES (charge.organization_id, 'refund', -charge.amount, p_ref, charge.category);
  RETURN -charge.amount;
END;
$$;

-- Add money (top-up or admin adjustment) once per payment.
CREATE OR REPLACE FUNCTION message_wallet_credit(p_org UUID, p_amount NUMERIC, p_kind TEXT, p_payment_id TEXT, p_created_by UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance NUMERIC;
BEGIN
  IF p_payment_id IS NOT NULL AND EXISTS (SELECT 1 FROM message_wallet_transactions WHERE razorpay_payment_id = p_payment_id) THEN
    SELECT message_balance INTO new_balance FROM organization_billing WHERE organization_id = p_org;
    RETURN new_balance;
  END IF;
  INSERT INTO organization_billing (organization_id) VALUES (p_org) ON CONFLICT (organization_id) DO NOTHING;
  UPDATE organization_billing
     SET message_balance = GREATEST(message_balance + p_amount, 0), updated_at = NOW()
   WHERE organization_id = p_org
  RETURNING message_balance INTO new_balance;
  INSERT INTO message_wallet_transactions (organization_id, kind, amount, razorpay_payment_id, created_by)
  VALUES (p_org, p_kind, p_amount, p_payment_id, p_created_by);
  RETURN new_balance;
END;
$$;

REVOKE ALL ON FUNCTION message_wallet_charge(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION message_wallet_refund(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION message_wallet_credit(UUID, NUMERIC, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION message_wallet_charge(UUID, NUMERIC, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION message_wallet_refund(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION message_wallet_credit(UUID, NUMERIC, TEXT, TEXT, UUID) TO service_role;

-- Payments now also cover upgrades and message top-ups; AI credit can come with each plan payment
ALTER TABLE billing_payments ADD COLUMN IF NOT EXISTS plan TEXT;

NOTIFY pgrst, 'reload schema';
