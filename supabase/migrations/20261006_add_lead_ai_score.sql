-- Add AI scoring columns to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_score INTEGER DEFAULT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_score_updated_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_score_reasons TEXT[] DEFAULT NULL;

-- Index for quick filtering on score
CREATE INDEX IF NOT EXISTS idx_leads_ai_score ON leads (ai_score DESC NULLS LAST) WHERE ai_score IS NOT NULL;

COMMENT ON COLUMN leads.ai_score IS 'ML-generated lead score 0-100 based on engagement signals, deal attributes, and conversation analysis';
COMMENT ON COLUMN leads.ai_score_updated_at IS 'Timestamp of the last AI score calculation';
COMMENT ON COLUMN leads.ai_score_reasons IS 'Array of human-readable reasons for the current score';
