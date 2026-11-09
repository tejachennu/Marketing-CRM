/**
 * Deals (leads) in the Sales Pipeline through the public API. The same rules as the screens
 * (lib/pipeline/store.ts); a key acts for the whole workspace, like a manager.
 */

import { isConnectorOn } from '../connectors'
import { isUuid, parseLeadInput, type LeadInput, type LeadStatus } from '../pipeline/rules'
import type { DealContact, LeadChange, PipelineActor } from '../pipeline/store'
import { apiError } from './auth'

/** What the API calls each status and priority. */
export const API_STATUS: Record<string, LeadStatus> = { open: 'active', won: 'won', lost: 'lost', on_hold: 'on_hold' }
const STATUS_NAME: Record<LeadStatus, string> = { active: 'open', won: 'won', lost: 'lost', on_hold: 'on_hold' }
const API_PRIORITY: Record<string, 'high' | 'medium' | 'low'> = { hot: 'high', warm: 'medium', cold: 'low', high: 'high', medium: 'medium', low: 'low' }
const PRIORITY_NAME: Record<string, string> = { high: 'hot', medium: 'warm', low: 'cold' }

export function apiActor(ctx: { db: any; organizationId: string }): PipelineActor {
  return { db: ctx.db, organizationId: ctx.organizationId, userId: null, seeAll: true, canAssign: true }
}

/** Sales Pipeline endpoints need the connector on (it is, unless switched off). */
export function pipelineOff(organization: Record<string, any>) {
  if (isConnectorOn(organization, 'pipeline')) return null
  return apiError(403, 'pipeline_off', 'Sales Pipeline is switched off for this workspace. An admin can switch it on in Connectors.')
}

export interface ApiStage { id: string; name: string; position: number }
export const toApiStage = (row: any): ApiStage => ({ id: row.id, name: row.name, position: Number(row.position) || 0 })

export function toApiLead(row: any & { contact?: DealContact | null }, stages: any[], users: { id: string; full_name?: string | null; email?: string | null }[], currency: string) {
  const stage = stages.find((s) => s.id === row.pipeline_stage_id)
  const owner = row.assigned_to ? users.find((u) => u.id === row.assigned_to) : null
  return {
    id: row.id,
    title: row.title || null,
    value: row.value == null ? null : Number(row.value),
    currency,
    status: STATUS_NAME[row.status as LeadStatus] || row.status,
    stage: stage ? { id: stage.id, name: stage.name } : null,
    priority: PRIORITY_NAME[row.priority] || null,
    source: row.source || null,
    owner: row.assigned_to ? { id: row.assigned_to, name: owner?.full_name || owner?.email || null } : null,
    contact: row.contact ? { id: row.contact.id, name: row.contact.name, phone: row.contact.phone, email: row.contact.email, company: row.contact.company } : null,
    product_service: row.product_service || null,
    description: row.description || null,
    expected_close_date: row.expected_close_date || null,
    next_follow_up_at: row.next_follow_up_at || null,
    won_lost_reason: row.won_lost_reason || null,
    won_at: row.won_at || null,
    lost_at: row.lost_at || null,
    last_activity_at: row.last_activity_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  }
}

/**
 * A deal sent to the API, in the API's words (stage_id or stage name, owner_id, hot/warm/cold,
 * open/won/lost/on_hold), checked with the screens' rules.
 */
export function parseApiLead(body: Record<string, any>, stages: any[], partial: boolean): { value: LeadChange } | { error: string; field: string } {
  const mapped: Record<string, unknown> = { ...body }
  for (const key of ['pipeline_stage_id', 'assigned_to', 'status', 'reason']) delete mapped[key]
  if (body.stage_id !== undefined || body.stage !== undefined) {
    let id = body.stage_id ?? null
    if (body.stage !== undefined && body.stage_id === undefined) {
      const found = stages.find((s) => s.name.toLowerCase() === String(body.stage ?? '').trim().toLowerCase())
      if (!found) return { error: `No stage called "${body.stage}". GET /pipeline-stages lists them.`, field: 'stage' }
      id = found.id
    } else if (id !== null && !stages.some((s) => s.id === id)) return { error: 'No stage with that id. GET /pipeline-stages lists them.', field: 'stage_id' }
    mapped.pipeline_stage_id = id
  }
  if (body.owner_id !== undefined) mapped.assigned_to = body.owner_id
  if (body.priority !== undefined) {
    const priority = API_PRIORITY[String(body.priority).toLowerCase()]
    if (!priority) return { error: 'priority is hot, warm or cold.', field: 'priority' }
    mapped.priority = priority
  }
  const parsed = parseLeadInput(mapped, partial)
  if ('error' in parsed) {
    const field = parsed.field === 'pipeline_stage_id' ? 'stage_id' : parsed.field === 'assigned_to' ? 'owner_id' : parsed.field
    return { error: parsed.error, field }
  }
  const value: LeadChange = { ...(parsed.value as LeadInput) }
  if (body.status !== undefined) {
    const status = API_STATUS[String(body.status)]
    if (!status) return { error: 'status is open, won, lost or on_hold.', field: 'status' }
    value.status = status
    value.reason = body.reason == null ? null : String(body.reason)
  }
  return { value }
}

export const isLeadId = isUuid
