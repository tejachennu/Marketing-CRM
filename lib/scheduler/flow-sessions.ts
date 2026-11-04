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
/** A session waiting on a WhatsApp form gets three days, as in the flow runtime (FORM_WAIT_LIMIT_MS). */
export const FORM_WAIT_AFTER_MS = 72 * 60 * 60 * 1000
export const BATCH_SIZE = 500
/** Sessions idle between one and three days are read with their flow's blocks, so fewer at a time. */
export const FORM_CHECK_BATCH_SIZE = 100
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

/** True when the session stands on a WhatsApp form block (the runtime's own rule for the longer wait). */
export function isWaitingOnForm(row: { current_node_id?: string | null; nodes?: unknown }): boolean {
  const nodes = Array.isArray(row.nodes) ? row.nodes : []
  const current = nodes.find((node: any) => node?.id === row.current_node_id)
  return current?.type === 'native_flow_trigger'
}

/**
 * Mark idle sessions EXPIRED: every session idle for more than three days, and those idle for more
 * than a day that are not waiting on a form. Ids are selected, then updated `IDS_PER_UPDATE` at a
 * time, and only while still idle.
 */
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
  const formIdleBefore = new Date(now.getTime() - FORM_WAIT_AFTER_MS).toISOString()

  const expire = async (ids: string[], before: string) => {
    let changed = 0
    for (let start = 0; start < ids.length; start += IDS_PER_UPDATE) {
      const { data: expired, error: updateErr } = await supabase
        .from('flow_sessions')
        .update({ status: 'EXPIRED' })
        .in('id', ids.slice(start, start + IDS_PER_UPDATE))
        .in('status', ACTIVE_STATUSES)
        .lt('last_interaction_at', before)
        .select('id')
      if (updateErr) throw new Error(updateErr.message || 'Could not expire flow sessions')
      changed += expired?.length ?? 0
    }
    return changed
  }
  const fail = (selectErr: any): ExpiryRunResult => {
    if (isMissingTable(selectErr)) {
      if (!missingTableWarned) {
        console.warn('[Flow Sessions] The flow_sessions table does not exist yet (scripts/db-migration-v31-flows.js); nothing to expire.')
        missingTableWarned = true
      }
      return { skipped: true, ...result }
    }
    throw new Error(selectErr.message || 'Could not read idle flow sessions')
  }
  const outOfTime = () => {
    if (deadline && Date.now() >= deadline) {
      result.out_of_time = true
      return true
    }
    return false
  }

  // 1. Idle for more than three days: expired whatever they wait on
  while (result.batches < MAX_BATCHES) {
    if (outOfTime()) break
    const { data: rows, error: selectErr } = await supabase
      .from('flow_sessions')
      .select('id')
      .in('status', ACTIVE_STATUSES)
      .lt('last_interaction_at', formIdleBefore)
      .order('last_interaction_at', { ascending: true })
      .limit(batchSize)
    if (selectErr) return fail(selectErr)

    const ids = (rows || []).map((row: any) => row.id)
    if (ids.length === 0) break
    result.batches++
    const changed = await expire(ids, formIdleBefore)
    result.expired += changed
    // A batch that changed nothing would be read again and again; the next tick retries instead
    if (changed === 0 || ids.length < batchSize) break
  }

  // 2. Idle for one to three days: expired unless the customer has a form open. Read oldest first,
  //    past a cursor, because the sessions kept waiting would otherwise come back in every batch.
  const formBatch = Math.min(batchSize, FORM_CHECK_BATCH_SIZE)
  let after = formIdleBefore
  while (result.batches < MAX_BATCHES && !result.out_of_time) {
    if (outOfTime()) break
    const { data: rows, error: selectErr } = await supabase
      .from('flow_sessions')
      .select('id, current_node_id, last_interaction_at, nodes:state_data->_workflow->canvas_nodes')
      .in('status', ACTIVE_STATUSES)
      .lt('last_interaction_at', idleBefore)
      .gte('last_interaction_at', after)
      .order('last_interaction_at', { ascending: true })
      .limit(formBatch)
    if (selectErr) return fail(selectErr)

    const list: any[] = rows || []
    if (list.length === 0) break
    result.batches++
    const ids = list.filter((row) => !isWaitingOnForm(row)).map((row) => row.id)
    if (ids.length > 0) result.expired += await expire(ids, idleBefore)
    if (list.length < formBatch) break
    const last = list[list.length - 1].last_interaction_at
    // Rows sharing the last timestamp are read again; a page of nothing else stops the run
    if (!last || last === after) break
    after = last
  }

  if (result.expired > 0) {
    console.log(`[Flow Sessions] Expired ${result.expired} idle chatbot session(s) in ${result.batches} batch(es).`)
  }
  return result
}
