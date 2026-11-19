import { createClient } from '@supabase/supabase-js'
import { answerFromKnowledge } from '@/lib/ai/faq-answer'
import { HANDOFF_REASON_LABELS } from '@/lib/ai/knowledge-rules'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/api-auth-helper'
import { isSuperAdmin } from '@/lib/rbac'
import { getAiAccess } from '@/lib/ai-access'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized: Please log in' }, { status: 401 })
    }

    const body = await request.json()
    const { action } = body

    // Support superadmins testing different organizations or fallback to user.organization_id
    const requestedOrgId = body.organizationId
    // Only a super admin may name another organization; everyone else always gets their own
    const orgId = (isSuperAdmin(user) && requestedOrgId)
      ? requestedOrgId
      : user.organization_id

    if (!orgId) {
      return NextResponse.json({ error: 'Forbidden: No organization assigned' }, { status: 403 })
    }

    const supabase = getSupabaseClient()

    // ========== SESSION CRUD ==========
    if (action === 'list_sessions') {
      let query = supabase
        .from('playground_sessions')
        .select('id, title, updated_at, created_at')
        .eq('organization_id', orgId)
        .order('updated_at', { ascending: false })
        .limit(50)

      if (!isSuperAdmin(user)) {
        query = query.eq('user_id', user.id)
      }

      const { data, error } = await query
      if (error) throw error
      return NextResponse.json({ sessions: data || [] })
    }

    if (action === 'get_session') {
      const { sessionId } = body
      if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })

      let query = supabase
        .from('playground_sessions')
        .select('*')
        .eq('id', sessionId)
        .eq('organization_id', orgId)

      if (!isSuperAdmin(user)) {
        query = query.eq('user_id', user.id)
      }

      const { data, error } = await query.maybeSingle()
      if (error || !data) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
      return NextResponse.json({ session: data })
    }

    if (action === 'create_session') {
      const { title } = body
      const { data, error } = await supabase
        .from('playground_sessions')
        .insert({
          organization_id: orgId,
          user_id: user.id,
          title: title || 'New Chat',
          messages: []
        })
        .select()
        .single()

      if (error) throw error
      return NextResponse.json({ session: data })
    }

    if (action === 'delete_session') {
      const { sessionId } = body
      if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })

      let query = supabase
        .from('playground_sessions')
        .delete()
        .eq('id', sessionId)
        .eq('organization_id', orgId)

      if (!isSuperAdmin(user)) {
        query = query.eq('user_id', user.id)
      }

      const { error } = await query
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    if (action === 'clear_session') {
      const { sessionId } = body
      if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })

      let query = supabase
        .from('playground_sessions')
        .update({ messages: [], updated_at: new Date().toISOString() })
        .eq('id', sessionId)
        .eq('organization_id', orgId)

      if (!isSuperAdmin(user)) {
        query = query.eq('user_id', user.id)
      }

      const { error } = await query
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    if (action === 'rename_session') {
      const { sessionId, title } = body
      if (!sessionId || !title) return NextResponse.json({ error: 'Missing sessionId or title' }, { status: 400 })

      let query = supabase
        .from('playground_sessions')
        .update({ title, updated_at: new Date().toISOString() })
        .eq('id', sessionId)
        .eq('organization_id', orgId)

      if (!isSuperAdmin(user)) {
        query = query.eq('user_id', user.id)
      }

      const { error } = await query
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    // ========== CHAT MESSAGE ==========
    if (action === 'send_message') {
      const { message, chatHistory } = body
      let sessionId = body.sessionId

      if (!message || !message.trim()) {
        return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 })
      }

      const cleanMessage = message.trim()

      // Load organization settings
      const { data: orgData } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', orgId)
        .maybeSingle()

      const ai = await getAiAccess(supabase, orgId, orgData)
      if (!ai.allowed) {
        return NextResponse.json({ error: ai.reason, aiPaused: true }, { status: 402 })
      }

      // Ensure session exists or auto-create if new/missing
      let sessionTitle = 'New Chat'
      let existingMessages: any[] = []

      if (sessionId && sessionId !== 'new') {
        const { data: currentSession } = await supabase
          .from('playground_sessions')
          .select('id, title, messages')
          .eq('id', sessionId)
          .maybeSingle()

        if (currentSession) {
          sessionTitle = currentSession.title
          existingMessages = currentSession.messages || []
        } else {
          // Session was deleted or not found, re-create it
          sessionId = null
        }
      }

      if (!sessionId || sessionId === 'new') {
        sessionTitle = cleanMessage.length > 50 ? cleanMessage.substring(0, 47) + '...' : cleanMessage
        const { data: newSession, error: createErr } = await supabase
          .from('playground_sessions')
          .insert({
            organization_id: orgId,
            user_id: user.id,
            title: sessionTitle,
            messages: []
          })
          .select()
          .single()

        if (createErr || !newSession) {
          console.error('[Playground Chat] Failed to auto-create session:', createErr)
          throw createErr || new Error('Failed to create session')
        }
        sessionId = newSession.id
      }

      // Sanitize chat history from client or session
      const rawHistory = Array.isArray(chatHistory) && chatHistory.length > 0 
        ? chatHistory 
        : existingMessages

      const previousMessages = rawHistory
        .filter((m: any) => m && m.content && typeof m.content === 'string' && m.content.trim())

      // The same answer customers get on WhatsApp (lib/ai/faq-answer.ts): search, answer, hand-off
      const validRoles = new Set(['user', 'assistant'])
      const historyForAi = previousMessages.slice(-10).map((m: any) => ({
        role: (validRoles.has(m.role) ? m.role : 'user') as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content.trim() : JSON.stringify(m.content),
      }))
      let botReply = ''
      let isRiseTicket = false
      let searchQuery = cleanMessage
      let faqs: { title: string; content: string; similarity: number | null; wordScore: number | null }[] = []
      let confidence = 'none'
      let status = ''
      let handoffReason: string | null = null
      try {
        const answer = await answerFromKnowledge({ db: supabase, ai, org: orgData || { id: orgId }, message: cleanMessage, history: historyForAi, feature: 'playground', channel: 'playground' })
        if (answer) {
          botReply = answer.reply || '(nothing is sent: the chat goes to your team)'
          isRiseTicket = answer.handoff
          searchQuery = answer.searchQuery
          faqs = answer.hits.map((h) => ({ title: h.title, content: h.content, similarity: h.similarity, wordScore: h.wordScore }))
          confidence = answer.confidence
          status = answer.status
          handoffReason = answer.reason ? HANDOFF_REASON_LABELS[answer.reason] : null
        } else {
          botReply = 'Chatbot error: the AI could not be reached. Check the AI wallet and try again.'
        }
      } catch (err: any) {
        botReply = `Chatbot exception: ${err.message || 'Error communicating with AI service'}`
        console.error('[Playground Chat] AI error:', err)
      }

      // Step 6: Save messages to session
      const userMsg = { role: 'user', content: cleanMessage, timestamp: new Date().toISOString() }
      const botMsg = { 
        role: 'assistant', 
        content: botReply, 
        timestamp: new Date().toISOString(),
        isRiseTicket,
        handoffReason,
        matchedFaqs: faqs.length,
        condensedQuery: searchQuery !== cleanMessage ? searchQuery : undefined 
      }

      const updatedMessages = [...existingMessages, userMsg, botMsg]

      // Auto-title from first message if still "New Chat"
      let newTitle = sessionTitle
      if (sessionTitle === 'New Chat' && existingMessages.length === 0) {
        newTitle = cleanMessage.length > 50 ? cleanMessage.substring(0, 47) + '...' : cleanMessage
      }

      await supabase
        .from('playground_sessions')
        .update({ 
          messages: updatedMessages, 
          title: newTitle,
          updated_at: new Date().toISOString() 
        })
        .eq('id', sessionId)

      return NextResponse.json({
        sessionId,
        title: newTitle,
        reply: botReply,
        isRiseTicket,
        handoffReason,
        status,
        confidence,
        matchedFaqs: faqs,
        condensedQuery: searchQuery !== cleanMessage ? searchQuery : null
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  } catch (err: any) {
    console.error('[Playground Chat API] Critical Error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
