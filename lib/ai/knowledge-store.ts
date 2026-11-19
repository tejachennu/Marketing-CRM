/**
 * The AI chatbot in the database: the shared knowledge search (by meaning + by words, ranked together),
 * hand-off of a chat to the team (one open ticket per chat, AI paused, back on when resolved) and the
 * questions the AI could not answer. Rules in knowledge-rules.ts. Server only.
 */

import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'
import { aiFetch, type AiAccess } from '../ai-access'
import { fallbackKeywordSearch } from '../ai-shared'
import { expandQueryWithSynonyms, type SynonymGroup } from '../query-expander'
import { cleanMedia } from './knowledge-text'
import { readReplyStyle, type ReplyStyle } from './reply-format'
import {
  confidenceOf, fuseResults, gapKey, isRealQuestion, joinPassage, mergeByMeaning, pausesAi, rankHits, readHandoffSettings, sameMeaningText, searchWords, ticketSubject,
  type Confidence, type HandoffReason, type HandoffSettings, type KnowledgeHit, type SearchRow,
} from './knowledge-rules'

/** supabase/migrations/20261206_ai_knowledge_handoff.sql word for word. */
export const KNOWLEDGE_SQL = `-- AI chatbot: knowledge search, hand-off to the team (tickets) and questions the AI could not answer.
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
`

export const KNOWLEDGE_LOCK = 724519032
export const knowledgeSchemaSetup = createAutoSetup('AI knowledge and hand-off', (connectionString) => runMigrationSql(connectionString, KNOWLEDGE_SQL, KNOWLEDGE_LOCK))
const KNOWLEDGE_SCHEMA = /search_knowledge|knowledge_gaps|ai_handoff|ai_paused|first_reply_at|resolved_at/

/** A missing table, column or search function (the set-up has not run yet). */
export function isMissingKnowledgeSchema(error: any): boolean {
  if (!error) return false
  const code = String(error.code || '')
  return code === 'PGRST202' || code === '42883' || isMissingSchemaError(error, KNOWLEDGE_SCHEMA)
}

export async function withKnowledgeSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = knowledgeSchemaSetup): Promise<any> {
  const first = await step()
  if (!isMissingKnowledgeSchema(first.error)) return first
  if (!(await setup.ensure())) return first
  let result = await step()
  for (let attempt = 1; attempt < 4 && isMissingKnowledgeSchema(result.error); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
    result = await step()
  }
  return result
}

// ── Search ──────────────────────────────────────────────────────────────────

export interface KnowledgeSearch {
  hits: KnowledgeHit[]
  confidence: Confidence
}

// Search vectors of recent questions, kept for 10 minutes on this server (the same question often comes again)
const vectorCache = new Map<string, { at: number; vector: number[] }>()
const CACHE_MS = 10 * 60_000

/** Search vectors for several texts in one call; ones asked in the last 10 minutes come from memory. */
async function embedTexts(db: any, ai: AiAccess, feature: string, texts: string[], now = Date.now()): Promise<(number[] | null)[]> {
  const keys = texts.map((t) => t.trim().toLowerCase().slice(0, 2000))
  const out: (number[] | null)[] = keys.map((k) => {
    const hit = vectorCache.get(k)
    return hit && now - hit.at < CACHE_MS ? hit.vector : null
  })
  const missing = keys.map((k, i) => (out[i] ? -1 : i)).filter((i) => i >= 0)
  if (!missing.length) return out
  try {
    const res = await aiFetch(db, ai, feature, 'https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: missing.map((i) => texts[i].slice(0, 8000)) }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return out
    const rows: any[] = (await res.json())?.data || []
    missing.forEach((i, j) => {
      const vector = rows.find((r) => r.index === j)?.embedding
      if (!Array.isArray(vector)) return
      out[i] = vector
      vectorCache.set(keys[i], { at: now, vector })
    })
    // Keep the memory small
    if (vectorCache.size > 500) for (const key of [...vectorCache.keys()].slice(0, vectorCache.size - 400)) vectorCache.delete(key)
  } catch {}
  return out
}

async function byMeaning(db: any, orgId: string, embedding: number[]): Promise<SearchRow[]> {
  const vector = `[${embedding.join(',')}]`
  const { data, error } = await withKnowledgeSchema(() => db.rpc('search_knowledge', { org_id: orgId, query_embedding: vector, match_count: 8, min_similarity: 0.3 }))
  if (!error) return data || []
  // The older search function, when the new one cannot be set up
  const old = await db.rpc('match_faqs', { query_embedding: vector, match_threshold: 0.4, match_count: 5, org_id: orgId })
  return old.error ? [] : (old.data || [])
}

async function byWords(db: any, orgId: string, words: string, question: string, keywordQuery: string): Promise<SearchRow[]> {
  if (words) {
    const { data, error } = await withKnowledgeSchema(() => db.rpc('search_knowledge_words', { org_id: orgId, words, question: question.slice(0, 300), match_count: 8 }))
    if (!error) return data || []
  }
  const rows = await fallbackKeywordSearch(db, keywordQuery, orgId).catch(() => [])
  return rows.map((r) => ({ title: r.title, content: r.content, score: 0.3 }))
}

/**
 * The business's knowledge-base entries for a customer's question: searched by meaning (the English
 * search text) and by words (the customer's own words and the English search text), ranked together.
 */
export async function searchKnowledge(
  db: any,
  ai: AiAccess | null,
  orgId: string,
  input: { question: string; searchQuery?: string; synonyms?: SynonymGroup[]; feature?: string; limit?: number; embedding?: number[] | null },
): Promise<KnowledgeSearch> {
  const query = (input.searchQuery || input.question || '').trim()
  if (!query) return { hits: [], confidence: 'none' }
  const { vectorQuery, keywordQuery } = expandQueryWithSynonyms(query, input.synonyms || [])
  const words = searchWords(`${input.question} ${vectorQuery}`)
  // By meaning in two ways when they differ: the English search text, and the customer's own words
  const own = String(input.question || '').trim()
  const texts = [vectorQuery, ...(own && sameMeaningText(own, vectorQuery) ? [] : [own])]
  const meaningSearch = async (): Promise<SearchRow[]> => {
    const vectors = input.embedding ? [input.embedding] : ai ? await embedTexts(db, ai, input.feature || 'chatbot', texts) : []
    const lists = await Promise.all(vectors.filter(Boolean).map((v) => byMeaning(db, orgId, v!)))
    return mergeByMeaning(lists)
  }
  const [meaning, wordRows] = await Promise.all([
    meaningSearch().catch(() => [] as SearchRow[]),
    byWords(db, orgId, words, own || query, keywordQuery).catch(() => [] as SearchRow[]),
  ])
  // A few more than needed, so the ranking below can bring the right one up
  const fused = fuseResults(meaning, wordRows, (input.limit ?? 5) + 3)
  const detailed = await withDetails(db, orgId, fused)
  const hits = await withNeighbours(db, orgId, rankHits(detailed, own || query).slice(0, input.limit ?? 5))
  return { hits, confidence: confidenceOf(hits) }
}

/**
 * Parts of a document get the part just before and after them (same source), so the AI reads the whole
 * passage, not a cut piece. At most the top three parts, at most about 3,000 characters each.
 */
export async function withNeighbours(db: any, orgId: string, hits: KnowledgeHit[]): Promise<KnowledgeHit[]> {
  const parts = hits.filter((h) => h.kind === 'part' && h.id).slice(0, 3)
  if (!parts.length) return hits
  try {
    const { data: rows } = await db.from('knowledge_base').select('id, source_id, chunk_index').eq('organization_id', orgId).in('id', parts.map((p) => p.id))
    const wanted: { source_id: string; index: number }[] = []
    for (const r of rows || []) if (r.source_id && Number.isInteger(r.chunk_index)) wanted.push({ source_id: r.source_id, index: r.chunk_index - 1 }, { source_id: r.source_id, index: r.chunk_index + 1 })
    if (!wanted.length) return hits
    const sourceIds = [...new Set(wanted.map((w) => w.source_id))]
    const indexes = [...new Set(wanted.map((w) => w.index))].filter((i) => i >= 0)
    const { data: around } = await db.from('knowledge_base').select('id, source_id, chunk_index, content').eq('organization_id', orgId).in('source_id', sourceIds).in('chunk_index', indexes)
    const taken = new Set(hits.map((h) => h.id))
    return hits.map((h) => {
      const row = (rows || []).find((r: any) => r.id === h.id)
      if (!row || h.kind !== 'part') return h
      const near = (i: number) => (around || []).find((a: any) => a.source_id === row.source_id && a.chunk_index === i && !taken.has(a.id))
      const before = near(row.chunk_index - 1)
      const after = near(row.chunk_index + 1)
      if (!before && !after) return h
      return { ...h, content: joinPassage(before?.content, h.content, after?.content) }
    })
  } catch {
    return hits
  }
}

/** Each hit's kind (FAQ or part of a source), the FAQ's attachments, and the part's source name and page. */
async function withDetails(db: any, orgId: string, hits: KnowledgeHit[]): Promise<KnowledgeHit[]> {
  const ids = hits.map((h) => h.id).filter(Boolean) as string[]
  if (!ids.length) return hits
  try {
    const { data, error } = await db.from('knowledge_base').select('id, kind, media, source_id, source_url').eq('organization_id', orgId).in('id', ids)
    if (error || !data) return hits
    const sourceIds = [...new Set(data.map((r: any) => r.source_id).filter(Boolean))]
    const { data: sources } = sourceIds.length ? await db.from('knowledge_sources').select('id, title').in('id', sourceIds) : { data: [] }
    return hits.map((h) => {
      const row = data.find((r: any) => r.id === h.id)
      if (!row) return h
      const kind = row.kind === 'part' ? 'part' as const : 'faq' as const
      return {
        ...h,
        kind,
        ...(kind === 'part' ? { sourceTitle: (sources || []).find((s: any) => s.id === row.source_id)?.title || null, url: row.source_url || null } : {}),
        ...(Array.isArray(row.media) && row.media.length ? { media: cleanMedia(row.media) } : {}),
      }
    })
  } catch {
    return hits
  }
}

// ── Hand-off settings ───────────────────────────────────────────────────────

export async function loadHandoffSettings(db: any, orgId: string, org?: any): Promise<HandoffSettings> {
  if (org && 'ai_handoff' in org) return readHandoffSettings(org.ai_handoff)
  const { data, error } = await db.from('organizations').select('ai_handoff').eq('id', orgId).maybeSingle()
  return readHandoffSettings(error ? null : data?.ai_handoff)
}

export async function saveHandoffSettings(db: any, orgId: string, settings: HandoffSettings, style?: ReplyStyle): Promise<void> {
  // Tone, emoji, buttons and typing live with the hand-off settings (one column)
  const { data: current } = await db.from('organizations').select('ai_handoff').eq('id', orgId).maybeSingle()
  const value = { ...settings, style: style || readReplyStyle(current?.ai_handoff?.style) }
  const { error } = await withKnowledgeSchema(() => db.from('organizations').update({ ai_handoff: value }).eq('id', orgId))
  if (error) throw new Error('The settings could not be saved. Try again.')
}

/** How the AI replies (tone, emoji, quick buttons, typing). */
export async function loadReplyStyle(db: any, orgId: string): Promise<ReplyStyle> {
  const { data, error } = await db.from('organizations').select('ai_handoff').eq('id', orgId).maybeSingle()
  return readReplyStyle(error ? null : data?.ai_handoff?.style)
}

// ── Hand-off to the team ────────────────────────────────────────────────────

export interface HandoffInput {
  organizationId: string
  conversationId: string
  contactId: string
  /** The customer's message (the ticket's subject) */
  message: string
  reason: HandoffReason
  summary?: string
  urgent?: boolean
  channel?: string
  settings: HandoffSettings
  contactName?: string | null
  contactPhone?: string | null
}

/**
 * The chat goes to the team: one open ticket per chat (a second hand-off adds nothing), the AI stops in this
 * chat (when the business wants that), and the team gets a pop-up and the ticket email. Never throws.
 */
export async function handOffToTeam(db: any, input: HandoffInput): Promise<{ ticketId: string | null; created: boolean; paused: boolean }> {
  let ticketId: string | null = null
  let created = false
  const pause = pausesAi(input.reason, input.settings)
  try {
    const { data: open } = await db.from('tickets').select('id').eq('conversation_id', input.conversationId).eq('status', 'open').limit(1).maybeSingle()
    if (open?.id) {
      ticketId = open.id
    } else {
      const base = { organization_id: input.organizationId, conversation_id: input.conversationId, contact_id: input.contactId, subject: ticketSubject(input.message), status: 'open' }
      const full = { ...base, reason: input.reason, summary: input.summary ? input.summary.slice(0, 200) : null, priority: input.urgent ? 'urgent' : 'normal', channel: input.channel || null, ai_paused: pause }
      let result = await withKnowledgeSchema(() => db.from('tickets').insert([full]).select('id').maybeSingle())
      // The new columns could not be added: the ticket is still made
      if (result.error && isMissingKnowledgeSchema(result.error)) result = await db.from('tickets').insert([base]).select('id').maybeSingle()
      if (result.error) throw result.error
      ticketId = result.data?.id || null
      created = Boolean(ticketId)
    }
  } catch (error: any) {
    console.error('[AI hand-off] The ticket could not be made:', error?.message || error)
  }
  let paused = false
  if (pause) {
    const { error } = await db.from('conversations').update({ auto_reply_enabled: false }).eq('id', input.conversationId)
    paused = !error
  }
  if (created && ticketId) {
    try {
      const { notifyTicketRaised } = await import('../push-events')
      const subject = input.summary || ticketSubject(input.message)
      await notifyTicketRaised(db, { organizationId: input.organizationId, ticketId, subject, contactName: input.contactName, contactPhone: input.contactPhone, conversationId: input.conversationId })
    } catch (error: any) {
      console.error('[AI hand-off] Pop-up failed:', error?.message || error)
    }
  }
  return { ticketId, created, paused }
}

/** A ticket was resolved: when the AI was paused for it, it answers this chat again (if the business wants). */
export async function afterTicketResolved(db: any, ticket: { organization_id?: string; conversation_id?: string | null; ai_paused?: boolean | null }): Promise<boolean> {
  if (!ticket?.conversation_id || !ticket.organization_id || ticket.ai_paused !== true) return false
  const settings = await loadHandoffSettings(db, ticket.organization_id)
  if (!settings.resumeOnResolve) return false
  // Another open ticket on the same chat keeps the AI paused
  const { data: other } = await db.from('tickets').select('id').eq('conversation_id', ticket.conversation_id).eq('status', 'open').limit(1)
  if (other?.length) return false
  const { error } = await db.from('conversations').update({ auto_reply_enabled: true }).eq('id', ticket.conversation_id)
  return !error
}

/**
 * The team wrote in a chat (which turns the AI off there): its open ticket gets its first reply time (for
 * "Waiting for us" / "Replied") and is marked as pausing the AI, so resolving it turns the AI back on. Never throws.
 */
export async function markTeamReplied(db: any, conversationId: string): Promise<void> {
  try {
    const now = new Date().toISOString()
    await db.from('tickets').update({ first_reply_at: now }).eq('conversation_id', conversationId).eq('status', 'open').is('first_reply_at', null)
    await db.from('tickets').update({ ai_paused: true }).eq('conversation_id', conversationId).eq('status', 'open').eq('ai_paused', false)
  } catch {}
}

// ── Questions the AI could not answer ───────────────────────────────────────

/** Count a question the AI could not answer (the same question in other words counts once). Never throws. */
export async function recordKnowledgeGap(db: any, orgId: string, question: string, conversationId?: string | null): Promise<void> {
  try {
    if (!isRealQuestion(question)) return
    const key = gapKey(question)
    const now = new Date().toISOString()
    const { data: row, error } = await withKnowledgeSchema(() => db.from('knowledge_gaps').select('id, asked_count, status').eq('organization_id', orgId).eq('question_key', key).maybeSingle())
    if (error) return
    if (row) {
      await db.from('knowledge_gaps').update({ asked_count: (Number(row.asked_count) || 0) + 1, last_asked_at: now, last_conversation_id: conversationId || null, question: question.slice(0, 500), ...(row.status === 'ignored' ? {} : { status: 'open' }) }).eq('id', row.id)
    } else {
      await db.from('knowledge_gaps').insert({ organization_id: orgId, question_key: key, question: question.slice(0, 500), asked_count: 1, status: 'open', last_conversation_id: conversationId || null, last_asked_at: now })
    }
  } catch {}
}

export interface KnowledgeGap {
  id: string
  question: string
  asked_count: number
  status: string
  last_asked_at: string
  last_conversation_id: string | null
}

export async function listKnowledgeGaps(db: any, orgId: string, status: 'open' | 'answered' | 'ignored' = 'open'): Promise<KnowledgeGap[]> {
  const { data, error } = await withKnowledgeSchema(() => db.from('knowledge_gaps').select('id, question, asked_count, status, last_asked_at, last_conversation_id').eq('organization_id', orgId).eq('status', status).order('last_asked_at', { ascending: false }).limit(100))
  if (error) return []
  return (data || []).sort((a: any, b: any) => (b.asked_count - a.asked_count) || String(b.last_asked_at).localeCompare(String(a.last_asked_at)))
}

export async function setKnowledgeGapStatus(db: any, orgId: string, id: string, status: 'open' | 'answered' | 'ignored', faqId?: string | null): Promise<boolean> {
  const { data, error } = await db.from('knowledge_gaps').update({ status, ...(faqId ? { faq_id: faqId } : {}) }).eq('id', id).eq('organization_id', orgId).select('id')
  return !error && Boolean(data?.length)
}
