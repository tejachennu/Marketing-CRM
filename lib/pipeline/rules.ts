/**
 * Sales Pipeline rules: what a deal may hold, how money reads, which follow-ups are due, the board
 * and the reports. Pure and browser-safe, so the screens, the API and the tests agree.
 */

import { addDays, istDate } from '../salon/spoken'

export const LEAD_STATUSES = ['active', 'won', 'lost', 'on_hold'] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]
export const STATUS_LABEL: Record<LeadStatus, string> = { active: 'Open', won: 'Won', lost: 'Lost', on_hold: 'On hold' }

export const PRIORITIES = ['high', 'medium', 'low'] as const
export type Priority = (typeof PRIORITIES)[number]
export const PRIORITY_LABEL: Record<Priority, string> = { high: 'Hot', medium: 'Warm', low: 'Cold' }

export const SOURCES: { value: string; label: string }[] = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'website', label: 'Website' },
  { value: 'referral', label: 'Referral' },
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'phone', label: 'Phone call' },
  { value: 'cold_call', label: 'Cold call' },
  { value: 'social_media', label: 'Social media' },
  { value: 'api', label: 'API' },
  { value: 'other', label: 'Other' },
]
export const sourceLabel = (value: string | null | undefined) => SOURCES.find((s) => s.value === value)?.label || (value ? value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'Not set')

export const LOST_REASONS = ['Price too high', 'Went with a competitor', 'No budget', 'Bad timing', 'No response', 'Not what they needed', 'Other']

export const ACTIVITY_TYPES = ['note', 'call', 'whatsapp', 'meeting', 'email'] as const
export type ActivityType = (typeof ACTIVITY_TYPES)[number]
export const ACTIVITY_LABEL: Record<string, string> = {
  note: 'Note', call: 'Call', whatsapp: 'WhatsApp', meeting: 'Meeting', email: 'Email',
  creation: 'Created', stage_change: 'Stage', status_change: 'Status', follow_up: 'Follow-up', assignment: 'Owner', ai_summary: 'AI summary',
}

export const DEFAULT_STAGES = ['New lead', 'Contacted', 'Qualified', 'Proposal sent', 'Negotiation']

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (value: unknown): value is string => UUID.test(String(value || ''))

// ── Money ───────────────────────────────────────────────────────────────────

/**
 * An amount in the workspace's currency. Rupees use Indian grouping (₹12,50,000), and in short
 * form lakh and crore (₹12.5 L, ₹3.3 Cr). Other currencies use the browser's own formatting.
 */
export function formatMoney(value: number | string | null | undefined, currency = 'INR', short = false): string {
  const amount = Number(value) || 0
  const code = (currency || 'INR').toUpperCase()
  if (code === 'INR') {
    if (short) {
      const abs = Math.abs(amount)
      const trim = (n: number) => String(Math.round(n * 10) / 10).replace(/\.0$/, '')
      if (abs >= 1e7) return `₹${trim(amount / 1e7)} Cr`
      if (abs >= 1e5) return `₹${trim(amount / 1e5)} L`
      if (abs >= 1e3) return `₹${trim(amount / 1e3)}K`
    }
    return `₹${Math.round(amount).toLocaleString('en-IN')}`
  }
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: code, maximumFractionDigits: 0, ...(short ? { notation: 'compact' } : {}) }).format(amount)
  } catch {
    return `${code} ${Math.round(amount).toLocaleString('en')}`
  }
}

// ── A deal sent to the server ───────────────────────────────────────────────

export interface LeadInput {
  title?: string
  description?: string | null
  value?: number | null
  pipeline_stage_id?: string | null
  priority?: Priority
  source?: string | null
  assigned_to?: string | null
  expected_close_date?: string | null
  next_follow_up_at?: string | null
  product_service?: string | null
  notes?: string | null
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const text = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** Check a deal sent by the screens or the API. `partial`: only the fields sent are changed. */
export function parseLeadInput(body: any, partial = false): { value: LeadInput } | { error: string; field: string } {
  const value: LeadInput = {}
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body || {}, key) && body[key] !== undefined
  if (has('title') || !partial) {
    const title = text(body?.title, 120)
    if (!title) return { error: 'Give the deal a name, like "500 shirts for Mehta Exports".', field: 'title' }
    value.title = title
  }
  if (has('description')) value.description = String(body.description ?? '').trim().slice(0, 2000) || null
  if (has('notes')) value.notes = String(body.notes ?? '').trim().slice(0, 4000) || null
  if (has('product_service')) value.product_service = text(body.product_service, 120) || null
  if (has('value')) {
    if (body.value === null || body.value === '') value.value = null
    else {
      const amount = Number(String(body.value).replace(/[,₹\s]/g, ''))
      if (!Number.isFinite(amount) || amount < 0 || amount > 1e12) return { error: 'The deal value must be an amount, like 85000.', field: 'value' }
      value.value = Math.round(amount * 100) / 100
    }
  }
  if (has('pipeline_stage_id')) {
    if (body.pipeline_stage_id !== null && !isUuid(body.pipeline_stage_id)) return { error: 'Choose a stage.', field: 'pipeline_stage_id' }
    value.pipeline_stage_id = body.pipeline_stage_id
  }
  if (has('priority')) {
    if (!PRIORITIES.includes(body.priority)) return { error: 'Priority is hot, warm or cold.', field: 'priority' }
    value.priority = body.priority
  }
  if (has('source')) value.source = body.source ? text(body.source, 40).toLowerCase().replace(/\s+/g, '_') : null
  if (has('assigned_to')) {
    if (body.assigned_to !== null && body.assigned_to !== '' && !isUuid(body.assigned_to)) return { error: 'Choose who owns the deal.', field: 'assigned_to' }
    value.assigned_to = body.assigned_to || null
  }
  if (has('expected_close_date')) {
    const date = body.expected_close_date
    if (date && !DATE.test(String(date))) return { error: 'The expected close date is YYYY-MM-DD.', field: 'expected_close_date' }
    value.expected_close_date = date || null
  }
  if (has('next_follow_up_at')) {
    const at = body.next_follow_up_at
    if (at && !Number.isFinite(Date.parse(String(at)))) return { error: 'Choose a date and time for the follow-up.', field: 'next_follow_up_at' }
    value.next_follow_up_at = at ? new Date(String(at)).toISOString() : null
  }
  return { value }
}

// ── Follow-ups ──────────────────────────────────────────────────────────────

export type FollowUpState = 'overdue' | 'today' | 'tomorrow' | 'later' | 'none'

/** Where a deal's next follow-up stands, by India days: overdue, today, tomorrow, later, or none. */
export function followUpState(nextFollowUpAt: string | null | undefined, now = Date.now()): FollowUpState {
  if (!nextFollowUpAt) return 'none'
  const at = Date.parse(nextFollowUpAt)
  if (!Number.isFinite(at)) return 'none'
  const today = istDate(now)
  const day = istDate(at)
  if (at < now && day < today) return 'overdue'
  if (day === today) return at < now - 60 * 60_000 ? 'overdue' : 'today'
  if (day === addDays(today, 1)) return 'tomorrow'
  return day < today ? 'overdue' : 'later'
}

export const FOLLOW_UP_LABEL: Record<FollowUpState, string> = { overdue: 'Overdue', today: 'Today', tomorrow: 'Tomorrow', later: 'Later', none: 'No follow-up' }

/** Quick choices for the next follow-up: India time, 10:30 am on the day. */
export function followUpPreset(preset: 'today' | 'tomorrow' | '3days' | 'week', now = Date.now()): string {
  const today = istDate(now)
  const day = preset === 'today' ? today : addDays(today, preset === 'tomorrow' ? 1 : preset === '3days' ? 3 : 7)
  if (preset === 'today') {
    // Later today: in two hours, rounded to the half hour
    const at = Math.ceil((now + 2 * 3600_000) / 1800_000) * 1800_000
    return new Date(at).toISOString()
  }
  return new Date(`${day}T10:30:00+05:30`).toISOString()
}

// ── The board ───────────────────────────────────────────────────────────────

export interface StageRow { id: string; name: string; color?: string | null; position: number }
export interface LeadRow {
  id: string
  title: string | null
  value: number | string | null
  status: string
  priority?: string | null
  source?: string | null
  pipeline_stage_id: string | null
  assigned_to?: string | null
  created_at: string
  won_at?: string | null
  lost_at?: string | null
  won_lost_reason?: string | null
  next_follow_up_at?: string | null
  last_activity_at?: string | null
  expected_close_date?: string | null
}

/** Open deals by stage, in stage order; deals without a known stage go to the first column. */
export function boardColumns<T extends LeadRow>(leads: T[], stages: StageRow[]): { stage: StageRow; leads: T[]; total: number }[] {
  const ordered = [...stages].sort((a, b) => a.position - b.position)
  const columns = ordered.map((stage) => ({ stage, leads: [] as T[], total: 0 }))
  if (!columns.length) return []
  for (const lead of leads.filter((l) => l.status === 'active')) {
    const column = columns.find((c) => c.stage.id === lead.pipeline_stage_id) || columns[0]
    column.leads.push(lead)
    column.total += Number(lead.value) || 0
  }
  // Due follow-ups first, then the most valuable
  const rank = (l: T) => ({ overdue: 0, today: 1, tomorrow: 2, later: 3, none: 4 })[followUpState(l.next_follow_up_at)]
  for (const column of columns) column.leads.sort((a, b) => rank(a) - rank(b) || (Number(b.value) || 0) - (Number(a.value) || 0))
  return columns
}

// ── Reports ─────────────────────────────────────────────────────────────────

const round1 = (n: number) => Math.round(n * 10) / 10
const inRange = (at: string | null | undefined, range: { start: string; end: string }) => Boolean(at && at >= range.start && at < range.end)

export interface PipelineReport {
  open: { count: number; value: number }
  byStage: { id: string; name: string; count: number; value: number }[]
  created: number
  won: { count: number; value: number }
  lost: number
  winRate: number | null
  averageDeal: number | null
  averageDaysToClose: number | null
  followUps: { overdue: number; today: number }
  bySource: { source: string; label: string; created: number; won: number; wonValue: number }[]
  byOwner: { id: string | null; name: string; open: number; openValue: number; won: number; wonValue: number; lost: number; winRate: number | null }[]
  lostReasons: { reason: string; count: number }[]
}

/**
 * The numbers for a date range: open deals now, and what was created, won and lost in the range,
 * by source and by owner.
 */
export function pipelineReport(leads: LeadRow[], stages: StageRow[], users: { id: string; full_name?: string | null; email?: string | null }[], range: { start: string; end: string }, now = Date.now()): PipelineReport {
  const open = leads.filter((l) => l.status === 'active')
  const won = leads.filter((l) => l.status === 'won' && inRange(l.won_at, range))
  const lost = leads.filter((l) => l.status === 'lost' && inRange(l.lost_at, range))
  const created = leads.filter((l) => inRange(l.created_at, range))
  const sum = (list: LeadRow[]) => Math.round(list.reduce((total, l) => total + (Number(l.value) || 0), 0) * 100) / 100
  const nameOf = (id: string | null | undefined) => {
    if (!id) return 'No owner'
    const user = users.find((u) => u.id === id)
    return user?.full_name || user?.email || 'Former teammate'
  }

  const byStage = boardColumns(open, stages).map((column) => ({ id: column.stage.id, name: column.stage.name, count: column.leads.length, value: Math.round(column.total * 100) / 100 }))

  const sources = new Map<string, { created: number; won: number; wonValue: number }>()
  for (const lead of created) { const key = lead.source || 'other'; const row = sources.get(key) || { created: 0, won: 0, wonValue: 0 }; row.created++; sources.set(key, row) }
  for (const lead of won) { const key = lead.source || 'other'; const row = sources.get(key) || { created: 0, won: 0, wonValue: 0 }; row.won++; row.wonValue += Number(lead.value) || 0; sources.set(key, row) }

  const owners = new Map<string, { id: string | null; open: number; openValue: number; won: number; wonValue: number; lost: number }>()
  const ownerRow = (id: string | null | undefined) => {
    const key = id || 'none'
    let row = owners.get(key)
    if (!row) { row = { id: id || null, open: 0, openValue: 0, won: 0, wonValue: 0, lost: 0 }; owners.set(key, row) }
    return row
  }
  for (const lead of open) { const row = ownerRow(lead.assigned_to); row.open++; row.openValue += Number(lead.value) || 0 }
  for (const lead of won) { const row = ownerRow(lead.assigned_to); row.won++; row.wonValue += Number(lead.value) || 0 }
  for (const lead of lost) ownerRow(lead.assigned_to).lost++

  const reasons = new Map<string, number>()
  for (const lead of lost) { const reason = String(lead.won_lost_reason || 'Not given').split(':')[0].trim() || 'Not given'; reasons.set(reason, (reasons.get(reason) || 0) + 1) }

  const closeDays = won.map((l) => (Date.parse(l.won_at!) - Date.parse(l.created_at)) / 86_400_000).filter((d) => Number.isFinite(d) && d >= 0)
  const states = open.map((l) => followUpState(l.next_follow_up_at, now))

  return {
    open: { count: open.length, value: sum(open) },
    byStage,
    created: created.length,
    won: { count: won.length, value: sum(won) },
    lost: lost.length,
    winRate: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null,
    averageDeal: won.length ? Math.round(sum(won) / won.length) : null,
    averageDaysToClose: closeDays.length ? round1(closeDays.reduce((a, b) => a + b, 0) / closeDays.length) : null,
    followUps: { overdue: states.filter((s) => s === 'overdue').length, today: states.filter((s) => s === 'today').length },
    bySource: [...sources.entries()].map(([source, row]) => ({ source, label: sourceLabel(source), ...row, wonValue: Math.round(row.wonValue * 100) / 100 }))
      .sort((a, b) => b.created - a.created || b.won - a.won || a.label.localeCompare(b.label)),
    byOwner: [...owners.values()].map((row) => ({ ...row, name: nameOf(row.id), openValue: Math.round(row.openValue * 100) / 100, wonValue: Math.round(row.wonValue * 100) / 100, winRate: row.won + row.lost ? Math.round((row.won / (row.won + row.lost)) * 100) : null }))
      .sort((a, b) => b.wonValue - a.wonValue || b.openValue - a.openValue || a.name.localeCompare(b.name)),
    lostReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
  }
}
