import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOrgAccess } from '@/lib/api-auth-helper'
import { sanitizeSearchTerm } from '@/lib/utils'
import { canSeeAll } from '@/lib/rbac'
import { getAssignedConversationScope, isHandOffColumnMissing, isUuid, onlyHandedOff, warnMissingHandOffColumn } from '@/lib/record-visibility'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseKey)
}

/** The columns of a listed conversation; `legacy` leaves out the hand-off column a migration may not have added yet. */
const conversationColumns = (legacy: boolean) => `
        id,
        organization_id,
        contact_id,
        lead_id,
        is_active,
        last_message_at,
        unread_count,
        auto_reply_enabled,
        assigned_to,
        ${legacy ? '' : 'handed_off_at,'}
        created_at,
        updated_at,
        contact:contact_id (
          id,
          first_name,
          last_name,
          phone_number,
          whatsapp_number,
          email,
          company
        )
      `

interface Listing {
  conversations: any[]
  count: number
  unreadMessagesCount: number
  needsAgentCount: number
}

// GET: List conversations with their contacts
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('organizationId')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10) || 20))
    const unreadOnly = searchParams.get('unread') === 'true'
    // The hand-off queue: chats the chatbot handed to the team that nobody has taken yet
    const needsAgentOnly = searchParams.get('filter') === 'needs_agent'
    const search = sanitizeSearchTerm(searchParams.get('search'))
    const specificId = searchParams.get('id')
    const requestedAssignee = searchParams.get('assignedTo') || null
    const offset = (page - 1) * limit

    if (!orgId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, orgId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    if (requestedAssignee && !isUuid(requestedAssignee)) {
      return NextResponse.json({ error: 'Invalid assignedTo' }, { status: 400 })
    }

    // Who the list is limited to is decided here, from the caller's role, never from the request alone:
    // someone who only sees their own work is always limited to themselves; anyone else may filter by a teammate.
    const seeAll = canSeeAll(authResult.user)
    const assignedTo: string | null = seeAll ? requestedAssignee : authResult.user.id

    const supabase = getSupabaseClient()

    // ── Role-based filtering: assigned conversations plus those of the user's active leads and open tickets ──
    // Applied to a single-conversation lookup too, so an id cannot be used to open someone else's chat.
    // Someone limited to their own work also sees the chats the chatbot handed to the team, so they can
    // be picked up; a manager filtering by a teammate wants that teammate's chats only.
    const scope = assignedTo ? await getAssignedConversationScope(supabase, assignedTo, orgId) : null

    // A search finds matching contacts first, then scopes conversations
    let matchedContactIds: string[] | null = null
    if (search && !specificId) {
      const { data: matchedContacts } = await supabase
        .from('contacts')
        .select('id')
        .eq('organization_id', orgId)
        .or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone_number.ilike.%${search}%`)
      matchedContactIds = (matchedContacts || []).map((c: any) => c.id)
    }

    // `legacy` reads the queue the old way, for a database the hand-off migration has not reached yet.
    // That inferred queue (nobody assigned, chatbot off) also holds every chat a manager answered
    // without taking, so it is only a manager's view: it never widens what an assigned-only user sees.
    const list = async (legacy: boolean): Promise<Listing> => {
      const visibleFilter = scope ? (seeAll || legacy ? scope.orFilter : scope.visibleFilter) : null

      let query = supabase
        .from('conversations')
        .select(conversationColumns(legacy), { count: 'exact' })
        .eq('organization_id', orgId)

      if (specificId) {
        query = query.eq('id', specificId)
      }
      if (visibleFilter) {
        query = query.or(visibleFilter)
      }

      // ── Unread messages (over the visible conversations) and the size of the hand-off queue (whole organization) ──
      let sumQuery = supabase
        .from('conversations')
        .select('unread_count')
        .eq('organization_id', orgId)
        .gt('unread_count', 0)

      if (visibleFilter) {
        sumQuery = sumQuery.or(visibleFilter)
      }

      // Every list answer carries the queue size, so the inbox shows its badge without another request.
      // An assigned-only user counts only the queued chats they can open (with the column, the whole queue).
      let needsAgentQuery = onlyHandedOff(supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('organization_id', orgId), legacy)
      if (visibleFilter && !seeAll) {
        needsAgentQuery = needsAgentQuery.or(visibleFilter)
      }
      const [{ data: sumData, error: sumError }, { count: waiting, error: waitingError }] = await Promise.all([sumQuery, needsAgentQuery])
      if (!legacy && (isHandOffColumnMissing(sumError) || isHandOffColumnMissing(waitingError))) throw sumError || waitingError
      const unreadMessagesCount = (sumData || []).reduce((sum: number, c: any) => sum + (c.unread_count || 0), 0)
      // A badge must never take the inbox down with it
      if (waitingError) console.warn('[API] Needs-agent count unavailable:', waitingError.message)
      const needsAgentCount = waitingError ? 0 : waiting || 0

      if (matchedContactIds && matchedContactIds.length === 0) {
        return { conversations: [], count: 0, unreadMessagesCount, needsAgentCount }
      }

      if (unreadOnly && !specificId) {
        query = query.gt('unread_count', 0)
      }

      if (needsAgentOnly && !specificId) {
        query = onlyHandedOff(query, legacy)
      }

      if (matchedContactIds) {
        query = query.in('contact_id', matchedContactIds)
      }

      const { data: conversations, count, error } = await query
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .range(offset, offset + limit - 1)

      if (error) throw error

      // Normalize contact (Supabase may return it as array)
      const formatted = (conversations || []).map((conv: any) => ({
        ...conv,
        contact: Array.isArray(conv.contact) ? conv.contact[0] : conv.contact,
      }))

      // Fetch the latest message of each conversation. One small query per conversation: a single
      // query over all of them returns every message and is cut off at the row limit on busy chats.
      const lastMessagesMap: Record<string, any> = {}
      await Promise.all(
        formatted.map(async (conv: any) => {
          const { data: latest } = await supabase
            .from('messages')
            .select('id, conversation_id, body, media_url, sender_type, created_at, read_at')
            .eq('conversation_id', conv.id)
            .order('created_at', { ascending: false })
            .limit(1)
          if (latest && latest.length > 0) lastMessagesMap[conv.id] = latest[0]
        })
      )

      return {
        conversations: formatted.map((conv: any) => ({ ...conv, last_message: lastMessagesMap[conv.id] || null })),
        count: count || 0,
        unreadMessagesCount,
        needsAgentCount,
      }
    }

    let listing: Listing
    try {
      listing = await list(false)
    } catch (error: any) {
      if (!isHandOffColumnMissing(error)) throw error
      warnMissingHandOffColumn()
      listing = await list(true)
    }

    return NextResponse.json({
      success: true,
      ...listing,
      page,
      limit,
      hasMore: listing.count > offset + listing.conversations.length,
    })
  } catch (error: any) {
    console.error('[API] List conversations error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to list conversations',
      },
      { status: 500 }
    )
  }
}
