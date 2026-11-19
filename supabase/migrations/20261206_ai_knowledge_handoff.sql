-- AI chatbot: knowledge search, hand-off to the team (tickets) and questions the AI could not answer.
-- Safe to run more than once. The app runs it on its own when first needed.

-- Spelling-tolerant word matching (best effort: the search still works without it)
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_trgm; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS vector; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS embedding vector(1536); EXCEPTION WHEN others THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_knowledge_base_org ON knowledge_base(organization_id);
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_knowledge_base_title_trgm ON knowledge_base USING gin (lower(title) gin_trgm_ops); EXCEPTION WHEN others THEN NULL; END $$;

-- Search by meaning: exact (no approximate index), so a small business never misses its own answers
CREATE OR REPLACE FUNCTION search_knowledge(org_id UUID, query_embedding TEXT, match_count INTEGER DEFAULT 8, min_similarity DOUBLE PRECISION DEFAULT 0.25)
RETURNS TABLE (id UUID, title TEXT, content TEXT, similarity DOUBLE PRECISION)
LANGUAGE plpgsql STABLE SET search_path = public, extensions AS $f$
BEGIN
  RETURN QUERY
  SELECT kb.id, kb.title::TEXT, kb.content::TEXT, (1 - (kb.embedding <=> query_embedding::vector))::DOUBLE PRECISION
  FROM knowledge_base kb
  WHERE kb.organization_id = org_id AND kb.embedding IS NOT NULL
    AND 1 - (kb.embedding <=> query_embedding::vector) >= min_similarity
  ORDER BY kb.embedding <=> query_embedding::vector
  LIMIT match_count;
END $f$;

-- Search by words: any of the words (in any language), plus close spellings of the question's title
CREATE OR REPLACE FUNCTION search_knowledge_words(org_id UUID, words TEXT, question TEXT, match_count INTEGER DEFAULT 8)
RETURNS TABLE (id UUID, title TEXT, content TEXT, score DOUBLE PRECISION)
LANGUAGE plpgsql STABLE SET search_path = public, extensions AS $f$
DECLARE s tsquery := websearch_to_tsquery('simple', coalesce(words, ''));
  e tsquery := websearch_to_tsquery('english', coalesce(words, ''));
BEGIN
  RETURN QUERY
  SELECT kb.id, kb.title::TEXT, kb.content::TEXT,
    LEAST(1.0, ts_rank(setweight(to_tsvector('simple', coalesce(kb.title, '')), 'A') || setweight(to_tsvector('simple', coalesce(kb.content, '')), 'B'), s)
      + ts_rank(setweight(to_tsvector('english', coalesce(kb.title, '')), 'A') || setweight(to_tsvector('english', coalesce(kb.content, '')), 'B'), e)
      + word_similarity(lower(coalesce(question, '')), lower(kb.title)) * 0.6)::DOUBLE PRECISION AS score
  FROM knowledge_base kb
  WHERE kb.organization_id = org_id
    AND (to_tsvector('simple', coalesce(kb.title, '') || ' ' || coalesce(kb.content, '')) @@ s
      OR to_tsvector('english', coalesce(kb.title, '') || ' ' || coalesce(kb.content, '')) @@ e
      OR word_similarity(lower(coalesce(question, '')), lower(kb.title)) >= 0.4)
  ORDER BY score DESC
  LIMIT match_count;
END $f$;

REVOKE ALL ON FUNCTION search_knowledge(UUID, TEXT, INTEGER, DOUBLE PRECISION) FROM PUBLIC;
REVOKE ALL ON FUNCTION search_knowledge_words(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC;
DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION search_knowledge(UUID, TEXT, INTEGER, DOUBLE PRECISION) TO service_role;
  GRANT EXECUTE ON FUNCTION search_knowledge_words(UUID, TEXT, TEXT, INTEGER) TO service_role;
EXCEPTION WHEN others THEN NULL; END $$;

-- Tickets: why the chat came to the team, a one-line summary, urgency, and whether the AI was paused
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS channel TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ai_paused BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS first_reply_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_tickets_conversation_status ON tickets(conversation_id, status);

-- Hand-off settings: {pauseAi, resumeOnResolve, keepAiWhenUnsure, message}
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ai_handoff JSONB;

-- Questions the AI could not answer, counted once per question, for the business to add answers
CREATE TABLE IF NOT EXISTS knowledge_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  question_key TEXT NOT NULL,
  question TEXT NOT NULL,
  asked_count INTEGER NOT NULL DEFAULT 1,
  last_conversation_id UUID,
  status TEXT NOT NULL DEFAULT 'open',
  faq_id UUID,
  first_asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_gaps_key ON knowledge_gaps(organization_id, question_key);
ALTER TABLE knowledge_gaps ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
