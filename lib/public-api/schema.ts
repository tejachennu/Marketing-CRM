/** The api_keys table, set up by the app itself the first time it is needed. */

import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'

/** supabase/migrations/20261110_api_keys.sql word for word. */
export const API_KEYS_SQL = `-- Public API: keys a workspace creates in Settings → API to connect its own systems.
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
`

const API_KEYS_LOCK = 724519010

export const apiKeysSetup = createAutoSetup('API keys', (connectionString) => runMigrationSql(connectionString, API_KEYS_SQL, API_KEYS_LOCK))

export function isMissingApiKeys(error: any): boolean {
  return isMissingSchemaError(error, /api_keys/)
}

/** Run a database step; if the api_keys table is missing, set it up and try again. */
export async function withApiKeys(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = apiKeysSetup): Promise<any> {
  const first = await step()
  if (!isMissingApiKeys(first.error)) return first
  if (!(await setup.ensure())) return first
  let result = await step()
  for (let attempt = 1; attempt < 4 && isMissingApiKeys(result.error); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
    result = await step()
  }
  return result
}
