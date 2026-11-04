-- Playground Chat Sessions table
-- Stores persistent chat playground conversations per user/organization
CREATE TABLE IF NOT EXISTS playground_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New Chat',
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_playground_sessions_org_user 
  ON playground_sessions(organization_id, user_id);
CREATE INDEX IF NOT EXISTS idx_playground_sessions_updated 
  ON playground_sessions(updated_at DESC);

-- RLS policies
ALTER TABLE playground_sessions ENABLE ROW LEVEL SECURITY;

-- Users can only access their own playground sessions
DROP POLICY IF EXISTS "Users can view own playground sessions" ON playground_sessions;
CREATE POLICY "Users can view own playground sessions"
  ON playground_sessions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own playground sessions" ON playground_sessions;
CREATE POLICY "Users can insert own playground sessions"
  ON playground_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own playground sessions" ON playground_sessions;
CREATE POLICY "Users can update own playground sessions"
  ON playground_sessions FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own playground sessions" ON playground_sessions;
CREATE POLICY "Users can delete own playground sessions"
  ON playground_sessions FOR DELETE
  USING (auth.uid() = user_id);

-- Service role bypass for API routes
DROP POLICY IF EXISTS "Service role full access on playground_sessions" ON playground_sessions;
CREATE POLICY "Service role full access on playground_sessions"
  ON playground_sessions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
