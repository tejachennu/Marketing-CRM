-- Chatbot Analytics tracking table
-- Records every chatbot interaction for performance monitoring and optimization
CREATE TABLE IF NOT EXISTS chatbot_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id UUID,           -- NULL for playground sessions
  session_id UUID,                -- NULL for live WhatsApp chats
  query TEXT NOT NULL,
  condensed_query TEXT,
  confidence_level TEXT,          -- 'high', 'medium', 'low'
  best_similarity FLOAT,
  matched_faq_count INT DEFAULT 0,
  matched_faq_titles TEXT[],
  was_escalated BOOLEAN DEFAULT false,
  was_cached BOOLEAN DEFAULT false,
  was_greeting BOOLEAN DEFAULT false,
  response_time_ms INT,           -- end-to-end latency in milliseconds
  model_used TEXT DEFAULT 'gpt-4o-mini',
  source TEXT DEFAULT 'playground', -- 'playground', 'whatsapp', 'copilot'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_chatbot_analytics_org 
  ON chatbot_analytics(organization_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_analytics_created 
  ON chatbot_analytics(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chatbot_analytics_org_created 
  ON chatbot_analytics(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chatbot_analytics_source 
  ON chatbot_analytics(organization_id, source);

-- RLS policies
ALTER TABLE chatbot_analytics ENABLE ROW LEVEL SECURITY;

-- Service role full access (for API routes)
CREATE POLICY "Service role full access on chatbot_analytics"
  ON chatbot_analytics FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Organization members can view their org's analytics
CREATE POLICY "Org members can view chatbot analytics"
  ON chatbot_analytics FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );
