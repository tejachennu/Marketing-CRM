/**
 * Chatbot sessions the customer stopped answering. The flow runtime expires such a session
 * only when that customer writes again (lib/flows/flow-executor.ts); this job expires the
 * rest, across every organization, so they do not stay "in progress" forever.
 */
import { isMissingTable } from './schema-errors'

type Database = any

const ACTIVE_STATUSES = ['IN_PROGRESS', 'PAUSED_RAG']
/** The same idle limit the flow runtime applies. */
export const IDLE_AFTER_MS = 24 * 60 * 60 * 1000
export const BATCH_SIZE = 500
/** Batches per run, so one tick never spends its whole time here. */
const MAX_BATCHES = 20
/** Ids per update: the list travels in the URL, and 100 UUIDs stay well under the 8 KB request-line limits in front of the database. */
export const IDS_PER_UPDATE = 100

export interface ExpiryRunResult {
  /** The flow tables do not exist yet: nothing to expire. */
  skipped?: true
  expired: number
  batches: number
  /** The run stopped early because its time was up. */
  out_of_time?: true
}

let missingTableWarned = false

/** Mark sessions idle for more than a day EXPIRED, `batchSize` ids at a time (select, then update by id). */
export async function expireIdleFlowSessions({
  supabase,
  now = new Date(),
  batchSize = BATCH_SIZE,
  deadline,
}: {
  supabase: Database
  now?: Date
  batchSize?: number
  deadline?: number
}): Promise<ExpiryRunResult> {
  const result: ExpiryRunResult = { expired: 0, batches: 0 }
  const idleBefore = new Date(now.getTime() - IDLE_AFTER_MS).toISOString()

  while (result.batches < MAX_BATCHES) {
    if (deadline && Date.now() >= deadline) {
      result.out_of_time = true
      break
    }

    const { data: rows, error: selectErr } = await supabase
      .from('flow_sessions')
      .select('id')
      .in('status', ACTIVE_STATUSES)
      .lt('last_interaction_at', idleBefore)
      .order('last_interaction_at', { ascending: true })
      .limit(batchSize)
    if (selectErr) {
      if (isMissingTable(selectErr)) {
        if (!missingTableWarned) {
          console.warn('[Flow Sessions] The flow_sessions table does not exist yet (scripts/db-migration-v31-flows.js); nothing to expire.')
          missingTableWarned = true
        }
        return { skipped: true, ...result }
      }
      throw new Error(selectErr.message || 'Could not read idle flow sessions')
    }

    const ids = (rows || []).map((row: any) => row.id)
    if (ids.length === 0) break
    result.batches++

    // Only rows still idle are touched: a session the customer just picked up again keeps going
    let changed = 0
    for (let start = 0; start < ids.length; start += IDS_PER_UPDATE) {
      const { data: expired, error: updateErr } = await supabase
        .from('flow_sessions')
        .update({ status: 'EXPIRED' })
        .in('id', ids.slice(start, start + IDS_PER_UPDATE))
        .in('status', ACTIVE_STATUSES)
        .lt('last_interaction_at', idleBefore)
        .select('id')
      if (updateErr) throw new Error(updateErr.message || 'Could not expire flow sessions')
      changed += expired?.length ?? 0
    }
    result.expired += changed
    // A batch that changed nothing would be read again and again; the next tick retries instead
    if (changed === 0 || ids.length < batchSize) break
  }

  if (result.expired > 0) {
    console.log(`[Flow Sessions] Expired ${result.expired} idle chatbot session(s) in ${result.batches} batch(es).`)
  }
  return result
}
