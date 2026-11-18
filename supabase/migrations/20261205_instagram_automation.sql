-- Instagram: keeping in step without webhooks, and automatic replies. Safe to run more than once.
ALTER TABLE instagram_accounts ADD COLUMN IF NOT EXISTS sync_state JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE instagram_accounts ADD COLUMN IF NOT EXISTS automation JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE instagram_comments ADD COLUMN IF NOT EXISTS auto_replied BOOLEAN NOT NULL DEFAULT FALSE;
NOTIFY pgrst, 'reload schema';
