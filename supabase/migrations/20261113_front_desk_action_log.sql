-- Front Desk: counter actions sent with a client reference (the mobile app's offline queue) are
-- remembered, so an action sent twice (a lost reply, a retry after the network came back) is done once.
-- Safe to run more than once. The app runs it on its own the first time it is needed.
CREATE TABLE IF NOT EXISTS salon_action_log (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_ref TEXT NOT NULL,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, client_ref)
);
ALTER TABLE salon_action_log ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
