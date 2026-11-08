-- Public API: keys a workspace creates in Settings → API to connect its own systems.
-- Only a SHA-256 hash of each key is stored; the key itself is shown once, when it is created.
-- Safe to run more than once. The app runs it on its own when the first key is created.
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys(organization_id, created_at DESC);
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
