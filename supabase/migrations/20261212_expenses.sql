-- Expenses (salaries, rent, stock…) and the once-a-month AI review of sales. Safe to run more than once.
-- The app runs it on its own when first needed.
CREATE TABLE IF NOT EXISTS business_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  spent_on DATE NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  note TEXT,
  paid_to TEXT,
  method TEXT,
  repeat_monthly BOOLEAN NOT NULL DEFAULT FALSE,
  repeat_key UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_business_expenses_org ON business_expenses(organization_id, spent_on DESC);
-- A repeating expense is copied into a month once
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_expenses_repeat ON business_expenses(organization_id, repeat_key, spent_on) WHERE repeat_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS business_insights (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'full',
  insight JSONB,
  facts JSONB,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, month, kind)
);

ALTER TABLE business_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_insights ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
