import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOrgAccess } from '@/lib/api-auth-helper'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseKey)
}

// GET: List conversations with their contacts
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('organizationId')
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = parseInt(searchParams.get('limit') || '20', 10)
    const unreadOnly = searchParams.get('unread') === 'true'
    const search = searchParams.get('search') || ''
    const specificId = searchParams.get('id')
    // assignedTo: when set, restrict conversations to ones assigned to this userId
    // Used for sales_employee role — they only see their own conversations unless see_all is granted
    const assignedTo = searchParams.get('assignedTo') || null
    const offset = (page - 1) * limit

    if (!orgId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, orgId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseClient()

    let query = supabase
      .from('conversations')
      .select(
        `
        id,
        organization_id,
        contact_id,
        lead_id,
        is_active,
        last_message_at,
        unread_count,
        auto_reply_enabled,
        assigned_to,
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
      `,
        { count: 'exact' }
      )
      .eq('organization_id', orgId)

    if (specificId) {
      query = query.eq('id', specificId)
    }

    // ── Role-based filtering: only show assigned conversations, active leads, and open tickets for restricted users ──
    let contactIds: string[] = []
    let ticketConvIds: string[] = []

    if (assignedTo && !specificId) {
      // 1. Fetch active leads assigned to the user (map by contact_id!)
      const { data: activeLeads } = await supabase
        .from('leads')
        .select('contact_id')
        .eq('assigned_to', assignedTo)
        .eq('status', 'active')
      contactIds = (activeLeads || []).map((l: any) => l.contact_id).filter(Boolean)

      // 2. Fetch open tickets assigned to the user
      const { data: openTickets } = await supabase
        .from('tickets')
        .select('conversation_id')
        .eq('assigned_to', assignedTo)
        .eq('status', 'open')
      ticketConvIds = (openTickets || []).map((t: any) => t.conversation_id).filter(Boolean)

      let orConditions = `assigned_to.eq.${assignedTo}`
      if (contactIds.length > 0) {
        orConditions += `,contact_id.in.(${contactIds.join(',')})`
      }
      if (ticketConvIds.length > 0) {
        orConditions += `,id.in.(${ticketConvIds.join(',')})`
      }
      query = query.or(orConditions)
    }

    // ── Calculate unread messages count (total unread messages for matching conversations) ──
    let unreadMessagesCount = 0
    let sumQuery = supabase
      .from('conversations')
      .select('unread_count')
      .eq('organization_id', orgId)
      .gt('unread_count', 0)

    if (assignedTo && !specificId) {
      let orConditions = `assigned_to.eq.${assignedTo}`
      if (contactIds.length > 0) {
        orConditions += `,contact_id.in.(${contactIds.map((id: string) => `"${id}"`).join(',')})`
      }
      if (ticketConvIds.length > 0) {
        orConditions += `,id.in.(${ticketConvIds.map((id: string) => `"${id}"`).join(',')})`
      }
      sumQuery = sumQuery.or(orConditions)
    }

    const { data: sumData } = await sumQuery
    unreadMessagesCount = (sumData || []).reduce((sum: number, c: any) => sum + (c.unread_count || 0), 0)

    if (unreadOnly && !specificId) {
      query = query.gt('unread_count', 0)
    }

    if (search && !specificId) {
      // Find matching contacts first, then scope conversations
      const { data: matchedContacts } = await supabase
        .from('contacts')
        .select('id')
        .eq('organization_id', orgId)
        .or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone_number.ilike.%${search}%`)

      const contactIds = (matchedContacts || []).map((c: any) => c.id)
      if (contactIds.length > 0) {
        query = query.in('contact_id', contactIds)
      } else {
        return NextResponse.json({
          success: true,
          conversations: [],
          count: 0,
          page,
          limit,
          hasMore: false,
        })
      }
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

    // Fetch latest message for each conversation
    const conversationIds = formatted.map((c: any) => c.id)
    const lastMessagesMap: Record<string, any> = {}

    if (conversationIds.length > 0) {
      const { data: latestMessages, error: msgError } = await supabase
        .from('messages')
        .select('id, conversation_id, body, media_url, sender_type, created_at, read_at')
        .in('conversation_id', conversationIds)
        .order('created_at', { ascending: false })

      if (!msgError && latestMessages) {
        // Since messages are ordered by created_at DESC, the first occurrence is the latest
        latestMessages.forEach((msg: any) => {
          if (!lastMessagesMap[msg.conversation_id]) {
            lastMessagesMap[msg.conversation_id] = msg
          }
        })
      }
    }

    const conversationsWithLastMsg = formatted.map((conv: any) => ({
      ...conv,
      last_message: lastMessagesMap[conv.id] || null,
    }))

    return NextResponse.json({
      success: true,
      conversations: conversationsWithLastMsg,
      count: count || 0,
      unreadMessagesCount,
      page,
      limit,
      hasMore: (count || 0) > offset + formatted.length,
    })
  } catch (error: any) {
    console.error('[API] List conversations error:', error)
    try {
      require('fs').appendFileSync('d:/new-chat/scratch/api-error.log', new Date().toISOString() + ': ' + (error.message || error) + '\n' + (error.stack || '') + '\n\n')
    } catch(e) {}
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to list conversations',
      },
      { status: 500 }
    )
  }
}
