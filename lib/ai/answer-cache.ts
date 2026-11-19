/**
 * Saved AI answers, so a question asked again (the most common ones: timings, price list, location) costs no AI.
 * Only standalone questions (not follow-ups like 'how much is it?') with a real answer are saved; never hand-offs.
 * The key holds the question's words, the channel, the reply style and a fingerprint of the business details,
 * instructions and synonyms (knowledge-rules `answerCacheKey`), so a change to any of those asks the AI again.
 * Knowledge changes (FAQs, sources) clear the business's saved answers. Server only; never throws.
 */

import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'

/** supabase/migrations/20261208_ai_answer_cache.sql word for word. */
export const ANSWER_CACHE_SQL = `-- Saved AI answers: the same standalone question (same words, same channel and reply style, same business details
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
`

export const ANSWER_CACHE_LOCK = 724519034
export const answerCacheSetup = createAutoSetup('Saved AI answers', (connectionString) => runMigrationSql(connectionString, ANSWER_CACHE_SQL, ANSWER_CACHE_LOCK))
const MISSING = /ai_answer_cache/

/** Saved answers are used for a day at most (prices and offers change). */
export const ANSWER_CACHE_MS = 24 * 60 * 60 * 1000

export async function getCachedAnswer<T = any>(db: any, organizationId: string, key: string, now = Date.now()): Promise<T | null> {
  try {
    const { data, error } = await db.from('ai_answer_cache').select('answer, uses, created_at').eq('organization_id', organizationId).eq('cache_key', key).maybeSingle()
    if (error || !data) return null
    if (now - Date.parse(data.created_at) > ANSWER_CACHE_MS) return null
    // Counting is best effort (how much the saved answers save)
    db.from('ai_answer_cache').update({ uses: (Number(data.uses) || 0) + 1 }).eq('organization_id', organizationId).eq('cache_key', key).then(() => null, () => null)
    return data.answer as T
  } catch {
    return null
  }
}

export async function saveCachedAnswer(db: any, organizationId: string, key: string, answer: unknown): Promise<void> {
  try {
    const row = { organization_id: organizationId, cache_key: key, answer, uses: 0, created_at: new Date().toISOString() }
    const first = await db.from('ai_answer_cache').upsert(row, { onConflict: 'organization_id,cache_key' })
    if (first.error && isMissingSchemaError(first.error, MISSING) && (await answerCacheSetup.ensure())) {
      await db.from('ai_answer_cache').upsert(row, { onConflict: 'organization_id,cache_key' })
    }
  } catch {}
}

/** The business's knowledge changed: forget every saved answer. */
export async function clearAnswerCache(db: any, organizationId: string): Promise<void> {
  try {
    await db.from('ai_answer_cache').delete().eq('organization_id', organizationId)
  } catch {}
}
