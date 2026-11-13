-- Phones that get pop-up notifications (Firebase Cloud Messaging): one row per phone a person is
-- signed in on. Safe to run more than once. The app runs it on its own when first needed.
CREATE TABLE IF NOT EXISTS device_tokens (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- android | ios
  platform TEXT NOT NULL DEFAULT 'android',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_org ON device_tokens (organization_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens (user_id);
ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;
-- No policies: only the server (service role) reads and writes it.

NOTIFY pgrst, 'reload schema';
