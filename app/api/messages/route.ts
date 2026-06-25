import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyRecordAccess } from '@/lib/api-auth-helper'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseKey)
}

// GET: List messages for a conversation
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const conversationId = searchParams.get('conversationId')

    if (!conversationId) {
      return NextResponse.json(
        { error: 'Conversation ID is required' },
        { status: 400 }
      )
    }

    const authResult = await verifyRecordAccess(request, 'conversations', conversationId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseClient()

    const limitVal = searchParams.get('limit')
    const beforeVal = searchParams.get('before')

    let query = supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })

    if (limitVal) {
      const parsedLimit = parseInt(limitVal, 10)
      if (!isNaN(parsedLimit)) {
        query = query.limit(parsedLimit)
      }
    } else {
      query = query.limit(100)
    }

    if (beforeVal) {
      query = query.lt('created_at', beforeVal)
    }

    const { data: messages, error } = await query

    if (error) throw error

    const chronologicalMessages = messages ? [...messages].sort((a, b) => 
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    ) : []

    let hasMore = false
    if (chronologicalMessages.length > 0) {
      const oldestTimestamp = chronologicalMessages[0].created_at
      const { count, error: countError } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', conversationId)
        .lt('created_at', oldestTimestamp)
      
      if (!countError && count && count > 0) {
        hasMore = true
      }
    }

    return NextResponse.json({
      success: true,
      messages: chronologicalMessages,
      count: chronologicalMessages.length,
      hasMore,
    })
  } catch (error) {
    console.error('[API] List messages error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to list messages',
      },
      { status: 500 }
    )
  }
}
