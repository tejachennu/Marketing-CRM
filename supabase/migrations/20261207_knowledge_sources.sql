-- Knowledge from many kinds of sources (websites, PDFs, Word and text files, pasted text), split into parts the
-- AI searches, and the photos, videos, files and links an FAQ carries (sent with the answer).
-- Safe to run more than once. The app runs it on its own when first needed.
CREATE TABLE IF NOT EXISTS knowledge_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  file_path TEXT,
  file_name TEXT,
  options JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'processing',
  error TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  page_count INTEGER NOT NULL DEFAULT 0,
  char_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_org ON knowledge_sources(organization_id, created_at DESC);
ALTER TABLE knowledge_sources ENABLE ROW LEVEL SECURITY;

-- kind: faq (typed by the business) or part (a piece of a source; deleted with it)
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES knowledge_sources(id) ON DELETE CASCADE;
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'faq';
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS chunk_index INTEGER;
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS media JSONB;
CREATE INDEX IF NOT EXISTS idx_knowledge_base_source ON knowledge_base(source_id);
-- The word search's own expressions, so long documents stay fast
CREATE INDEX IF NOT EXISTS idx_knowledge_base_words_simple ON knowledge_base USING gin (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, '')));
CREATE INDEX IF NOT EXISTS idx_knowledge_base_words_english ON knowledge_base USING gin (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, '')));

-- Search vectors for many parts in one call: items = [{"id": "...", "e": "[0.1, ...]"}]
CREATE OR REPLACE FUNCTION set_knowledge_embeddings(org_id UUID, items JSONB)
RETURNS INTEGER
LANGUAGE plpgsql SET search_path = public, extensions AS $f$
DECLARE n INTEGER;
BEGIN
  UPDATE knowledge_base kb SET embedding = (x->>'e')::vector
  FROM jsonb_array_elements(items) x
  WHERE kb.id = (x->>'id')::UUID AND kb.organization_id = org_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $f$;
REVOKE ALL ON FUNCTION set_knowledge_embeddings(UUID, JSONB) FROM PUBLIC;
DO $$ BEGIN GRANT EXECUTE ON FUNCTION set_knowledge_embeddings(UUID, JSONB) TO service_role; EXCEPTION WHEN others THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';
