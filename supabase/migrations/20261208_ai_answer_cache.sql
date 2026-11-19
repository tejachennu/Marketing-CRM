-- Saved AI answers: the same standalone question (same words, same channel and reply style, same business details
-- and instructions) is answered from here with no AI call. Cleared whenever the business's knowledge changes.
-- Safe to run more than once. The app runs it on its own when first needed.
CREATE TABLE IF NOT EXISTS ai_answer_cache (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cache_key TEXT NOT NULL,
  answer JSONB NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, cache_key)
);
ALTER TABLE ai_answer_cache ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
