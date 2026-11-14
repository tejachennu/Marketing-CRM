/**
 * Reading and changing deals (leads), their stages and their history. Used by the Sales Pipeline
 * screens' API and the public API, so both follow the same rules: a salesperson who only sees
 * their own work sees and changes only deals they own.
 */

import { notifyDealAssigned } from '../push-events'
import { contactByPhone } from '../public-api/contacts'
import { normalizePhone } from '../public-api/keys'
import { sanitizeSearchTerm } from '../utils'
import { DEFAULT_STAGES, followUpState, isUuid, LEAD_STATUSES, type LeadInput, type LeadStatus } from './rules'
import { withPipelineSchema } from './schema'

/** Who is asking: the workspace, the person (null for an API key), and what they may see and do. */
export interface PipelineActor {
  db: any
  organizationId: string
  userId: string | null
  seeAll: boolean
  canAssign: boolean
}

export interface DealContact { id: string; name: string; phone: string | null; whatsapp: string | null; email: string | null; company: string | null }

const CONTACT_COLUMNS = 'id, first_name, last_name, phone_number, whatsapp_number, email, company'

const contactOf = (row: any): DealContact => {
  const whatsapp = String(row?.whatsapp_number || '').replace(/^whatsapp:/, '') || null
  return {
    id: row.id,
    name: [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.phone_number || whatsapp || 'Contact',
    phone: row.phone_number || whatsapp,
    whatsapp,
    email: row.email || null,
    company: row.company || null,
  }
}

/** Only the deals this person may see. */
export function scoped(query: any, actor: PipelineActor) {
  return actor.seeAll || !actor.userId ? query : query.eq('assigned_to', actor.userId)
}

async function checked<T = any>(query: PromiseLike<{ data: T; error: any }>): Promise<T> {
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data
}

/** Each deal with its contact. */
export async function withContacts<T extends { contact_id?: string | null }>(db: any, organizationId: string, leads: T[]): Promise<(T & { contact: DealContact | null })[]> {
  const ids = [...new Set(leads.map((l) => l.contact_id).filter(Boolean))] as string[]
  const contacts = new Map<string, DealContact>()
  for (let i = 0; i < ids.length; i += 150) {
    const rows = await checked(db.from('contacts').select(CONTACT_COLUMNS).eq('organization_id', organizationId).in('id', ids.slice(i, i + 150)))
    for (const row of rows || []) contacts.set(row.id, contactOf(row))
  }
  return leads.map((lead) => ({ ...lead, contact: (lead.contact_id && contacts.get(lead.contact_id)) || null }))
}

export interface LeadFilters {
  status?: string | null
  stage?: string | null
  priority?: string | null
  owner?: string | null
  source?: string | null
  q?: string | null
  follow?: string | null
  sort?: string | null
  dir?: string | null
}

const SORTS = ['created_at', 'value', 'next_follow_up_at', 'last_activity_at', 'expected_close_date', 'updated_at']

/** Deals matching the filters, a page at a time (one extra row says whether there are more). */
export async function listLeads(actor: PipelineActor, filters: LeadFilters, page: { limit: number; offset: number }) {
  const { db, organizationId } = actor
  let query = scoped(db.from('leads').select('*').eq('organization_id', organizationId), actor)
  const status = filters.status || 'active'
  if (status !== 'all') {
    if (!LEAD_STATUSES.includes(status as LeadStatus)) throw new Error('Unknown status.')
    query = query.eq('status', status)
  }
  if (filters.stage && isUuid(filters.stage)) query = query.eq('pipeline_stage_id', filters.stage)
  if (filters.priority && ['high', 'medium', 'low'].includes(filters.priority)) query = query.eq('priority', filters.priority)
  if (filters.source) query = query.eq('source', sanitizeSearchTerm(filters.source))
  if (filters.owner === 'none') query = query.is('assigned_to', null)
  else if (filters.owner === 'me' && actor.userId) query = query.eq('assigned_to', actor.userId)
  else if (filters.owner && isUuid(filters.owner)) query = query.eq('assigned_to', filters.owner)

  // Follow-ups: due (overdue and today), or upcoming, by India days
  if (filters.follow) {
    const endOfToday = new Date(`${new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)}T23:59:59.999+05:30`).toISOString()
    if (filters.follow === 'due') query = query.lte('next_follow_up_at', endOfToday)
    else if (filters.follow === 'upcoming') query = query.gt('next_follow_up_at', endOfToday)
    else if (filters.follow === 'none') query = query.is('next_follow_up_at', null)
  }

  const term = sanitizeSearchTerm(filters.q)
  if (term) {
    const digits = term.replace(/\D/g, '')
    const word = term.replace(/[.']/g, ' ').trim().split(/\s+/)[0]
    const contactFilter = digits.length >= 4 ? `phone_number.ilike.*${digits}*,whatsapp_number.ilike.*${digits}*` : `first_name.ilike.${word}*,last_name.ilike.${word}*,company.ilike.*${word}*`
    const matched = await checked(db.from('contacts').select('id').eq('organization_id', organizationId).or(contactFilter).limit(100))
    const ors = [`title.ilike.*${term}*`, `product_service.ilike.*${term}*`]
    if (matched?.length) ors.push(`contact_id.in.(${matched.map((c: any) => c.id).join(',')})`)
    query = query.or(ors.join(','))
  }

  const sort = SORTS.includes(String(filters.sort)) ? String(filters.sort) : (filters.follow ? 'next_follow_up_at' : 'created_at')
  const ascending = filters.dir ? filters.dir === 'asc' : sort === 'next_follow_up_at' || sort === 'expected_close_date'
  const rows = await checked(withPipelineSchema(() => query.order(sort, { ascending, nullsFirst: false }).range(page.offset, page.offset + page.limit)))
  return withContacts(db, organizationId, rows || [])
}

/** One deal this person may see, or null. */
export async function findLead(actor: PipelineActor, id: string) {
  if (!isUuid(id)) return null
  const { data } = await scoped(actor.db.from('leads').select('*').eq('organization_id', actor.organizationId).eq('id', id), actor).maybeSingle()
  return data || null
}

export async function logActivity(actor: PipelineActor, leadId: string, type: string, content: string) {
  const { error } = await actor.db.from('lead_activities').insert({ organization_id: actor.organizationId, lead_id: leadId, user_id: actor.userId, activity_type: type, content: content.slice(0, 4000) })
  if (error) console.warn('[Pipeline] History not saved:', error.message)
}

/** The deal's contact: the one named, or found by phone, or saved now. */
export async function resolveContact(actor: PipelineActor, input: { contact_id?: unknown; contact?: { name?: unknown; phone?: unknown; email?: unknown; company?: unknown } | null }): Promise<{ id: string } | { error: string; field: string }> {
  const { db, organizationId } = actor
  if (input.contact_id) {
    if (!isUuid(input.contact_id)) return { error: 'Choose a contact.', field: 'contact_id' }
    const { data } = await db.from('contacts').select('id').eq('organization_id', organizationId).eq('id', input.contact_id).maybeSingle()
    return data ? { id: data.id } : { error: 'That contact is not in this workspace.', field: 'contact_id' }
  }
  const given = input.contact || {}
  const name = String(given.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  const rawPhone = String(given.phone ?? '').trim()
  const phone = rawPhone ? normalizePhone(rawPhone) : null
  if (rawPhone && !phone) return { error: 'Give the phone number with its country code, like +919876543210 (a 10-digit Indian number also works).', field: 'contact.phone' }
  if (!name && !phone) return { error: 'Who is the deal with? Give a name or a phone number.', field: 'contact' }
  if (phone) {
    const existing = await contactByPhone(db, organizationId, phone)
    if (existing) return { id: existing.id }
  }
  const [first, ...rest] = (name || 'Customer').split(' ')
  const { data, error } = await db.from('contacts').insert({
    organization_id: organizationId, first_name: first, last_name: rest.join(' ') || null,
    phone_number: phone, whatsapp_number: phone ? `whatsapp:${phone}` : null,
    email: String(given.email ?? '').trim().toLowerCase().slice(0, 120) || null, company: String(given.company ?? '').trim().slice(0, 120) || null, tags: ['Sales'],
  }).select('id').single()
  if (error) throw new Error(error.message)
  return { id: data.id }
}

async function checkStage(actor: PipelineActor, stageId: string | null | undefined) {
  if (!stageId) return true
  const { data } = await actor.db.from('pipeline_stages').select('id').eq('organization_id', actor.organizationId).eq('id', stageId).maybeSingle()
  return Boolean(data)
}

async function checkOwner(actor: PipelineActor, userId: string | null | undefined) {
  if (!userId) return true
  const { data } = await actor.db.from('users').select('id').eq('organization_id', actor.organizationId).eq('id', userId).maybeSingle()
  return Boolean(data)
}

/** Create a deal. Someone who cannot assign work owns the deals they create. */
export async function createLead(actor: PipelineActor, input: LeadInput & { contactId: string }, source?: string): Promise<{ lead?: any; error?: string; field?: string }> {
  const { db, organizationId } = actor
  let stageId = input.pipeline_stage_id || null
  if (!stageId) {
    const { data: first } = await db.from('pipeline_stages').select('id').eq('organization_id', organizationId).order('position').limit(1)
    stageId = first?.[0]?.id || null
  } else if (!(await checkStage(actor, stageId))) return { error: 'That stage is not in this workspace.', field: 'pipeline_stage_id' }
  let owner = input.assigned_to === undefined ? actor.userId : input.assigned_to
  if (!actor.canAssign && actor.userId) owner = actor.userId
  if (owner && !(await checkOwner(actor, owner))) return { error: 'That person is not in this workspace.', field: 'assigned_to' }
  const now = new Date().toISOString()
  const row = {
    organization_id: organizationId, contact_id: input.contactId, title: input.title, description: input.description ?? null, value: input.value ?? null,
    pipeline_stage_id: stageId, priority: input.priority || 'medium', status: 'active', source: input.source || source || 'other', assigned_to: owner || null,
    expected_close_date: input.expected_close_date ?? null, next_follow_up_at: input.next_follow_up_at ?? null, product_service: input.product_service ?? null, notes: input.notes ?? null,
    created_by: actor.userId, last_activity_at: now,
  }
  const { data, error } = await withPipelineSchema(() => db.from('leads').insert(row).select('*').single())
  if (error) throw new Error(error.message)
  await logActivity(actor, data.id, 'creation', 'Deal created')
  await notifyDealAssigned(db, { organizationId, dealId: data.id, title: data.title, ownerId: data.assigned_to, byUserId: actor.userId })
  return { lead: (await withContacts(db, organizationId, [data]))[0] }
}

/** The same time, however the database wrote it (or both empty). */
export function sameMoment(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return !a && !b
  return Date.parse(a) === Date.parse(b)
}

/** How a new follow-up reads in the deal's history (India time). */
export function followUpNote(at: string | null | undefined) {
  return at ? `Follow up ${new Date(at).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}` : 'Follow-up cleared'
}

export interface LeadChange extends LeadInput { status?: LeadStatus; reason?: string | null }

/** Change a deal: fields, stage, owner, follow-up, or won / lost / reopened. Each change is noted in its history. */
export async function updateLead(actor: PipelineActor, current: any, change: LeadChange, stageNames: Map<string, string>, userNames: Map<string, string>): Promise<{ lead?: any; error?: string; field?: string }> {
  const { db, organizationId } = actor
  const patch: Record<string, unknown> = {}
  const notes: [string, string][] = []
  for (const key of ['title', 'description', 'value', 'priority', 'source', 'expected_close_date', 'product_service', 'notes'] as const) {
    if (change[key] !== undefined) patch[key] = change[key]
  }
  if (change.pipeline_stage_id !== undefined && change.pipeline_stage_id !== current.pipeline_stage_id) {
    if (!(await checkStage(actor, change.pipeline_stage_id))) return { error: 'That stage is not in this workspace.', field: 'pipeline_stage_id' }
    patch.pipeline_stage_id = change.pipeline_stage_id
    notes.push(['stage_change', `Moved to ${stageNames.get(String(change.pipeline_stage_id)) || 'another stage'}`])
  }
  if (change.assigned_to !== undefined && change.assigned_to !== current.assigned_to) {
    if (!actor.canAssign) return { error: 'Only managers and admins can give a deal to someone else.', field: 'assigned_to' }
    if (!(await checkOwner(actor, change.assigned_to))) return { error: 'That person is not in this workspace.', field: 'assigned_to' }
    patch.assigned_to = change.assigned_to
    notes.push(['assignment', change.assigned_to ? `Given to ${userNames.get(change.assigned_to) || 'a teammate'}` : 'No owner now'])
  }
  if (change.next_follow_up_at !== undefined && !sameMoment(change.next_follow_up_at, current.next_follow_up_at)) {
    patch.next_follow_up_at = change.next_follow_up_at
    notes.push(['follow_up', followUpNote(change.next_follow_up_at)])
  }
  if (change.status && change.status !== current.status) {
    const now = new Date().toISOString()
    const reason = String(change.reason || '').trim().slice(0, 300)
    if (change.status === 'won') Object.assign(patch, { status: 'won', won_at: now, lost_at: null, won_lost_reason: reason || null, next_follow_up_at: null })
    else if (change.status === 'lost') {
      if (!reason) return { error: 'Say why the deal was lost, so the reports can show it.', field: 'reason' }
      Object.assign(patch, { status: 'lost', lost_at: now, won_at: null, won_lost_reason: reason, next_follow_up_at: null })
    } else Object.assign(patch, { status: change.status, won_at: null, lost_at: null, won_lost_reason: null })
    notes.push(['status_change', change.status === 'won' ? `Won${reason ? `: ${reason}` : ''}` : change.status === 'lost' ? `Lost: ${reason}` : change.status === 'on_hold' ? 'Put on hold' : 'Reopened'])
  }
  if (!Object.keys(patch).length) return { lead: (await withContacts(db, organizationId, [current]))[0] }
  patch.updated_at = new Date().toISOString()
  patch.last_activity_at = patch.updated_at
  const { data, error } = await withPipelineSchema(() => db.from('leads').update(patch).eq('id', current.id).eq('organization_id', organizationId).select('*').single())
  if (error) throw new Error(error.message)
  for (const [type, content] of notes) await logActivity(actor, current.id, type, content)
  if (patch.assigned_to) await notifyDealAssigned(db, { organizationId, dealId: current.id, title: data.title, ownerId: String(patch.assigned_to), byUserId: actor.userId })
  return { lead: (await withContacts(db, organizationId, [data]))[0] }
}

/** Something done with the deal (a note, call, WhatsApp, meeting), with the next follow-up if given. */
export async function addActivity(actor: PipelineActor, lead: any, input: { type: string; content: string; next_follow_up_at?: string | null }) {
  const now = new Date().toISOString()
  await logActivity(actor, lead.id, input.type, input.content)
  const patch: Record<string, unknown> = { last_activity_at: now, updated_at: now }
  if (input.next_follow_up_at !== undefined) {
    patch.next_follow_up_at = input.next_follow_up_at
    if (!sameMoment(input.next_follow_up_at, lead.next_follow_up_at)) await logActivity(actor, lead.id, 'follow_up', followUpNote(input.next_follow_up_at))
  }
  const { data, error } = await withPipelineSchema(() => actor.db.from('leads').update(patch).eq('id', lead.id).eq('organization_id', actor.organizationId).select('*').single())
  if (error) throw new Error(error.message)
  return data
}

/** The deal's history, newest first, with who did each thing. */
export async function leadHistory(actor: PipelineActor, leadId: string) {
  const { data } = await actor.db.from('lead_activities').select('*').eq('organization_id', actor.organizationId).eq('lead_id', leadId).order('created_at', { ascending: false }).limit(200)
  const rows = data || []
  const ids = [...new Set(rows.map((r: any) => r.user_id).filter(Boolean))] as string[]
  const names = new Map<string, string>()
  if (ids.length) {
    const { data: users } = await actor.db.from('users').select('id, full_name, email').in('id', ids)
    for (const u of users || []) names.set(u.id, u.full_name || u.email || 'Teammate')
  }
  return rows.map((r: any) => ({ id: r.id, type: r.activity_type, content: r.content, created_at: r.created_at, by: r.user_id ? names.get(r.user_id) || 'Teammate' : 'System' }))
}

/** The stages, in order; the default ones are made the first time a workspace has none. */
export async function loadStages(db: any, organizationId: string, createDefaults = true) {
  const { data } = await db.from('pipeline_stages').select('*').eq('organization_id', organizationId).order('position')
  if ((data || []).length || !createDefaults) return data || []
  const { data: made, error } = await db.from('pipeline_stages').insert(DEFAULT_STAGES.map((name, i) => ({ organization_id: organizationId, name, color: '#1D5BEA', position: i + 1 }))).select('*')
  if (error) throw new Error(error.message)
  return (made || []).sort((a: any, b: any) => a.position - b.position)
}

/** Counts for the menu and the header: open deals, follow-ups overdue and due today. */
export async function pipelineCounts(actor: PipelineActor) {
  const { data } = await withPipelineSchema(() => scoped(actor.db.from('leads').select('id, next_follow_up_at').eq('organization_id', actor.organizationId).eq('status', 'active'), actor).limit(5000))
  const rows = data || []
  const states = rows.map((r: any) => followUpState(r.next_follow_up_at))
  return { open: rows.length, overdue: states.filter((s: string) => s === 'overdue').length, today: states.filter((s: string) => s === 'today').length }
}
