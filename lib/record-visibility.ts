/**
 * Server-side "who may see this conversation" rules.
 *
 * Admins, managers and employees granted "see all" see every conversation. Everyone else
 * sees the conversations they work on: assigned to them directly, or belonging to one of
 * their active leads or open tickets. They also see the chats the chatbot handed to the team
 * (nobody assigned, chatbot off), so a customer waiting for a person can be picked up.
 */

import type { NextRequest } from 'next/server'
import { verifyRecordAccess, type AccessOptions } from './api-auth-helper'
import { canSeeAll, describeDenied, isSuperAdmin, type RoleSubject } from './rbac'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

/**
 * PostgREST filter for the chats the chatbot handed to the team: the Flow Builder's "Hand off to
 * team" step clears `assigned_to` and switches the chatbot off, and nobody has taken the chat yet.
 */
export const HANDED_OFF_FILTER = 'and(assigned_to.is.null,auto_reply_enabled.eq.false)'

/** True for a chat waiting for any agent to pick it up (the same rule as HANDED_OFF_FILTER). */
export function isHandedOff(conversation: { assigned_to?: string | null; auto_reply_enabled?: boolean | null }): boolean {
  return conversation.assigned_to == null && conversation.auto_reply_enabled === false
}

/** Narrow a `conversations` query to the chats handed to the team. */
export function onlyHandedOff(query: any) {
  return query.is('assigned_to', null).eq('auto_reply_enabled', false)
}

export interface ConversationScope {
  contactIds: string[]
  conversationIds: string[]
  /** PostgREST `or` filter selecting the conversations assigned to the user. */
  orFilter: string
  /** `orFilter` plus the chats handed to the team: everything an assigned-only user may see. */
  visibleFilter: string
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
  return { contactIds, conversationIds, orFilter, visibleFilter: `${orFilter},${HANDED_OFF_FILTER}` }
}

export interface ConversationRef {
  id: string
  organization_id: string
  contact_id?: string | null
  assigned_to?: string | null
  auto_reply_enabled?: boolean | null
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

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, organization_id, contact_id, assigned_to, auto_reply_enabled')
    .eq('id', conversationId)
    .maybeSingle()

  if (!conversation || !(await canAccessConversation(supabase, result.user, conversation))) {
    return { authorized: false as const, error: describeDenied('records.view_all'), status: 403, user: result.user }
  }
  return result
}
