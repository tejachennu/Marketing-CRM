-- Sales Pipeline as a connector: a workspace can switch it off (it is on unless switched off),
-- and each deal can carry its next follow-up, so the team sees what is due and overdue.
-- Safe to run more than once. The app runs it on its own when these are first needed.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS enable_pipeline BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_follow_up_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_leads_follow_up ON leads(organization_id, next_follow_up_at) WHERE next_follow_up_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
