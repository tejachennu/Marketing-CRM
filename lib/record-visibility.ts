/**
 * Server-side "who may see this conversation" rules.
 *
 * Admins, managers and employees granted "see all" see every conversation. Everyone else
 * sees the conversations they work on: assigned to them directly, or belonging to one of
 * their active leads or open tickets. They also see the chats the chatbot handed to the team
 * (the hand-off queue, see lib/handoff.ts), so a customer waiting for a person can be picked up.
 */

import type { NextRequest } from 'next/server'
import { verifyRecordAccess, type AccessOptions } from './api-auth-helper'
import { HANDED_OFF_FILTER, LEGACY_HANDED_OFF_FILTER, isHandedOff } from './handoff'
import { canSeeAll, describeDenied, isSuperAdmin, type RoleSubject } from './rbac'
import { isMissingColumn } from './scheduler/schema-errors'

export { HANDED_OFF_FILTER, LEGACY_HANDED_OFF_FILTER, isHandedOff } from './handoff'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

// ── The hand-off column, and a database that does not have it yet ──

/** True when PostgREST says `conversations.handed_off_at` does not exist: the hand-off migration has not run. */
export function isHandOffColumnMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  return isMissingColumn(error) && String(error?.message || '').includes('handed_off_at')
}

let warnedMissingColumn = false
/** Said once per process: the code keeps working on the old inferred rule until the migration runs. */
export function warnMissingHandOffColumn() {
  if (warnedMissingColumn) return
  warnedMissingColumn = true
  console.warn('[hand-off] conversations.handed_off_at does not exist: apply supabase/migrations/20261104_handoff_state.sql. Until then the hand-off queue is inferred from the chatbot being off.')
}

/** Narrow a `conversations` query to the chats in the hand-off queue; `legacy` for a database without the column. */
export function onlyHandedOff(query: any, legacy = false) {
  return legacy
    ? query.is('assigned_to', null).eq('auto_reply_enabled', false)
    : query.is('assigned_to', null).not('handed_off_at', 'is', null)
}

export interface ConversationScope {
  contactIds: string[]
  conversationIds: string[]
  /** PostgREST `or` filter selecting the conversations assigned to the user. */
  orFilter: string
  /** `orFilter` plus the chats handed to the team: everything an assigned-only user may see. */
  visibleFilter: string
  /** `visibleFilter` for a database without the hand-off column. */
  legacyVisibleFilter: string
}

/** The conversations `userId` works on in an organization. */
export async function getAssignedConversationScope(supabase: any, userId: string, organizationId: string): Promise<ConversationScope> {
  if (!isUuid(userId)) throw new Error('Invalid user id')

  const [leads, tickets] = await Promise.all([
    supabase.from('leads').select('contact_id').eq('organization_id', organizationId).eq('assigned_to', userId).eq('status', 'active'),
    supabase.from('tickets').select('conversation_id').eq('organization_id', organizationId).eq('assigned_to', userId).eq('status', 'open'),
  ])

  // Ids come from uuid columns, but they are checked anyway because they are placed in a filter string
  const contactIds = [...new Set<string>((leads.data || []).map((lead: any) => lead.contact_id).filter(isUuid))]
  const conversationIds = [...new Set<string>((tickets.data || []).map((ticket: any) => ticket.conversation_id).filter(isUuid))]

  const parts = [`assigned_to.eq.${userId}`]
  if (contactIds.length > 0) parts.push(`contact_id.in.(${contactIds.join(',')})`)
  if (conversationIds.length > 0) parts.push(`id.in.(${conversationIds.join(',')})`)

  const orFilter = parts.join(',')
  return { contactIds, conversationIds, orFilter, visibleFilter: `${orFilter},${HANDED_OFF_FILTER}`, legacyVisibleFilter: `${orFilter},${LEGACY_HANDED_OFF_FILTER}` }
}

export interface ConversationRef {
  id: string
  organization_id: string
  contact_id?: string | null
  assigned_to?: string | null
  auto_reply_enabled?: boolean | null
  handed_off_at?: string | null
}

const REF_COLUMNS = 'id, organization_id, contact_id, assigned_to, auto_reply_enabled'

/** One conversation's access-relevant columns, or null when there is no such chat. Works without the hand-off column. */
export async function loadConversationRef(supabase: any, conversationId: string): Promise<ConversationRef | null> {
  const load = (columns: string) => supabase.from('conversations').select(columns).eq('id', conversationId).maybeSingle()
  let { data, error } = await load(`${REF_COLUMNS}, handed_off_at`)
  if (isHandOffColumnMissing(error)) {
    warnMissingHandOffColumn()
    ;({ data, error } = await load(REF_COLUMNS))
  }
  if (error) throw new Error(error.message)
  return data || null
}

/** Whether `user` may open one conversation. */
export async function canAccessConversation(supabase: any, user: RoleSubject, conversation: ConversationRef): Promise<boolean> {
  if (!user?.id) return false
  if (canSeeAll(user)) return true
  if (conversation.assigned_to === user.id) return true
  // Handed to the team by the chatbot: whichever agent opens it may take it
  if (isHandedOff(conversation)) return true

  if (conversation.contact_id) {
    const { data: leads } = await supabase
      .from('leads')
      .select('id')
      .eq('organization_id', conversation.organization_id)
      .eq('contact_id', conversation.contact_id)
      .eq('assigned_to', user.id)
      .eq('status', 'active')
      .limit(1)
    if (leads && leads.length > 0) return true
  }

  const { data: tickets } = await supabase
    .from('tickets')
    .select('id')
    .eq('organization_id', conversation.organization_id)
    .eq('conversation_id', conversation.id)
    .eq('assigned_to', user.id)
    .eq('status', 'open')
    .limit(1)
  return Boolean(tickets && tickets.length > 0)
}

/**
 * Authenticate the caller, check the conversation is in their organization, and check they
 * are allowed to see it. Pass `permission: 'records.write'` for anything that changes it.
 */
export async function verifyConversationAccess(
  request: NextRequest,
  supabase: any,
  conversationId: string | null,
  options: Pick<AccessOptions, 'permission'> = {}
) {
  const result = await verifyRecordAccess(request, 'conversations', conversationId, options)
  if (!result.authorized) return result
  if (isSuperAdmin(result.user) || canSeeAll(result.user)) return result

  const conversation = conversationId ? await loadConversationRef(supabase, conversationId).catch(() => null) : null
  if (!conversation || !(await canAccessConversation(supabase, result.user, conversation))) {
    return { authorized: false as const, error: describeDenied('records.view_all'), status: 403, user: result.user }
  }
  return result
}

/**
 * The name of a teammate other than `userId` who holds an active lead for the contact or an open
 * ticket on the chat (the same records that let them see the chat). Null when nobody does, or
 * when `userId` holds one as well and so works this customer too.
 */
export async function findOtherHandler(supabase: any, organizationId: string, userId: string, contactId: string, conversationId: string | null): Promise<string | null> {
  const [leads, tickets] = await Promise.all([
    supabase.from('leads').select('assigned_to').eq('organization_id', organizationId).eq('contact_id', contactId).eq('status', 'active'),
    conversationId
      ? supabase.from('tickets').select('assigned_to').eq('organization_id', organizationId).eq('conversation_id', conversationId).eq('status', 'open')
      : Promise.resolve({ data: [] }),
  ])
  const holders: string[] = [...(leads.data || []), ...(tickets.data || [])].map((row: any) => row.assigned_to).filter(isUuid)
  if (holders.length === 0 || holders.includes(userId)) return null

  const { data: teammate } = await supabase
    .from('users')
    .select('full_name, email')
    .eq('id', holders[0])
    .eq('organization_id', organizationId)
    .maybeSingle()
  return String(teammate?.full_name || teammate?.email || '').trim() || 'a teammate'
}

/**
 * Give a chat to `userId` (null: to nobody) and take it out of the hand-off queue, in one
 * statement. With `onlyUnassigned` the row changes only while nobody has it, so two agents taking
 * the same chat at once cannot both win. Resolves to whether the row changed.
 */
export async function assignConversation(
  supabase: any,
  input: { conversationId: string; organizationId: string; userId: string | null; onlyUnassigned?: boolean }
): Promise<boolean> {
  const update = (values: Record<string, unknown>) => {
    let query = supabase.from('conversations').update(values).eq('id', input.conversationId).eq('organization_id', input.organizationId)
    if (input.onlyUnassigned) query = query.is('assigned_to', null)
    return query.select('id')
  }
  let result = await update({ assigned_to: input.userId, handed_off_at: null })
  if (isHandOffColumnMissing(result.error)) {
    warnMissingHandOffColumn()
    result = await update({ assigned_to: input.userId })
  }
  if (result.error) throw new Error(result.error.message)
  return (result.data || []).length > 0
}

/** A person answered the chat without taking it: it leaves the hand-off queue. */
export async function clearHandOff(supabase: any, input: { conversationId: string; organizationId: string }): Promise<void> {
  const { error } = await supabase
    .from('conversations')
    .update({ handed_off_at: null })
    .eq('id', input.conversationId)
    .eq('organization_id', input.organizationId)
    .not('handed_off_at', 'is', null)
  if (!error) return
  if (isHandOffColumnMissing(error)) return warnMissingHandOffColumn()
  throw new Error(error.message)
}
