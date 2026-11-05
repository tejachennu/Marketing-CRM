-- WAMA CRM billing: one plan (₹3,000 a month, every feature) paid through Razorpay Subscriptions,
-- and an AI wallet: every workspace starts with ₹300 of AI usage and tops up when it runs out.
-- Workspaces marked billing_exempt (the platform's own, Magnetora's and Consular Helpdesk) are left
-- exactly as they were: no plan, no wallet, their own AI key.

CREATE TABLE IF NOT EXISTS organization_billing (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  billing_exempt BOOLEAN NOT NULL DEFAULT FALSE,
  plan TEXT NOT NULL DEFAULT 'pro_monthly',
  -- trialing | active | past_due | cancelled | expired
  status TEXT NOT NULL DEFAULT 'trialing',
  trial_ends_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  razorpay_subscription_id TEXT UNIQUE,
  razorpay_customer_id TEXT,
  -- AI wallet, in rupees with paise fractions (one AI reply costs a fraction of a paisa)
  ai_balance NUMERIC(14, 4) NOT NULL DEFAULT 300,
  -- The balance right after the last credit: "percentage left" is ai_balance / ai_allowance
  ai_allowance NUMERIC(14, 4) NOT NULL DEFAULT 300,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- free_grant | topup | usage | adjustment
  kind TEXT NOT NULL,
  amount NUMERIC(14, 4) NOT NULL,
  feature TEXT,
  model TEXT,
  tokens INTEGER,
  razorpay_payment_id TEXT UNIQUE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_wallet_transactions_org ON ai_wallet_transactions (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- subscription | ai_topup
  purpose TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  razorpay_payment_id TEXT UNIQUE NOT NULL,
  razorpay_order_id TEXT,
  razorpay_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'captured',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billing_payments_org ON billing_payments (organization_id, created_at DESC);

ALTER TABLE organization_billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_payments ENABLE ROW LEVEL SECURITY;
-- No policies: only the server (service role) reads and writes billing.

-- Charge AI usage atomically. Returns the new balance; never goes below zero.
CREATE OR REPLACE FUNCTION ai_wallet_charge(p_org UUID, p_amount NUMERIC, p_feature TEXT, p_model TEXT, p_tokens INTEGER)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance NUMERIC;
BEGIN
  UPDATE organization_billing
     SET ai_balance = GREATEST(ai_balance - p_amount, 0), updated_at = NOW()
   WHERE organization_id = p_org
  RETURNING ai_balance INTO new_balance;
  IF new_balance IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO ai_wallet_transactions (organization_id, kind, amount, feature, model, tokens)
  VALUES (p_org, 'usage', -p_amount, p_feature, p_model, p_tokens);
  RETURN new_balance;
END;
$$;

-- Add credit (top-up or admin adjustment) once per payment, and restart the percentage from the new balance.
CREATE OR REPLACE FUNCTION ai_wallet_credit(p_org UUID, p_amount NUMERIC, p_kind TEXT, p_payment_id TEXT, p_created_by UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance NUMERIC;
BEGIN
  IF p_payment_id IS NOT NULL AND EXISTS (SELECT 1 FROM ai_wallet_transactions WHERE razorpay_payment_id = p_payment_id) THEN
    SELECT ai_balance INTO new_balance FROM organization_billing WHERE organization_id = p_org;
    RETURN new_balance;
  END IF;
  INSERT INTO organization_billing (organization_id) VALUES (p_org) ON CONFLICT (organization_id) DO NOTHING;
  UPDATE organization_billing
     SET ai_balance = ai_balance + p_amount,
         ai_allowance = ai_balance + p_amount,
         updated_at = NOW()
   WHERE organization_id = p_org
  RETURNING ai_balance INTO new_balance;
  INSERT INTO ai_wallet_transactions (organization_id, kind, amount, razorpay_payment_id, created_by)
  VALUES (p_org, p_kind, p_amount, p_payment_id, p_created_by);
  RETURN new_balance;
END;
$$;

REVOKE ALL ON FUNCTION ai_wallet_charge(UUID, NUMERIC, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ai_wallet_credit(UUID, NUMERIC, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ai_wallet_charge(UUID, NUMERIC, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION ai_wallet_credit(UUID, NUMERIC, TEXT, TEXT, UUID) TO service_role;

-- Every existing workspace gets a billing row: a 14-day trial from today and ₹300 of AI credit.
INSERT INTO organization_billing (organization_id)
SELECT id FROM organizations
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO ai_wallet_transactions (organization_id, kind, amount)
SELECT b.organization_id, 'free_grant', 300
  FROM organization_billing b
 WHERE NOT EXISTS (SELECT 1 FROM ai_wallet_transactions t WHERE t.organization_id = b.organization_id AND t.kind = 'free_grant');

-- Exempt: the platform workspace, Magnetora AI Solutions and Consular Helpdesk (Twilio tenant)
UPDATE organization_billing SET billing_exempt = TRUE
 WHERE organization_id IN (
   SELECT id FROM organizations
    WHERE id IN ('303b7a2d-281c-403c-b794-54d1e195ca69', 'b2acf062-c379-49f2-8905-267413c9c394')
       OR name ILIKE '%consular%'
       OR slug ILIKE '%consular%'
       -- Workspaces that send WhatsApp through Twilio (Consular Helpdesk)
       OR (COALESCE(whatsapp_provider, 'twilio') = 'twilio' AND COALESCE(twilio_account_sid, '') <> '')
 );
