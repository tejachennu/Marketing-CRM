import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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
    const supabase = getSupabaseClient()

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = parseInt(searchParams.get('limit') || '20', 10)
    const unreadOnly = searchParams.get('unread') === 'true'
    const search = searchParams.get('search') || ''
    const offset = (page - 1) * limit

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
        assigned_to,
        created_at,
        updated_at,
        contact:contact_id (
          id,
          first_name,
          last_name,
          phone_number,
          email,
          company
        )
      `,
        { count: 'exact' }
      )

    if (unreadOnly) {
      query = query.gt('unread_count', 0)
    }

    if (search) {
      // Find matching contacts first, then scope conversations
      const { data: matchedContacts } = await supabase
        .from('contacts')
        .select('id')
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
      page,
      limit,
      hasMore: (count || 0) > offset + formatted.length,
    })
  } catch (error) {
    console.error('[API] List conversations error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to list conversations',
      },
      { status: 500 }
    )
  }
}
