import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/api-auth-helper'
import { expandQueryWithSynonyms, SynonymGroup, getActiveSynonymRelationships } from '@/lib/query-expander'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

const DEFAULT_BASE_PROMPT = `You are a strict automated customer service chatbot. Your task is to respond to the customer's message.

CLASSIFICATION AND RESPONSE RULES:
1. NORMAL COMMUNICATION MESSAGES (Greetings, thanks, simple politeness, acknowledgments):
   - If the customer's message is a standard greeting, thank you, or simple polite acknowledgment (e.g., "Hi", "Hello", "Hey", "Good morning", "Thanks", "Thank you", "Ok", "Great", "Awesome", "How are you"), reply with a brief, friendly, and natural response (e.g., greeting them back and asking how you can help, or saying you're welcome).
2. ALL OTHER CONTEXTS (Questions, topic queries, specific inquiries, or any other statements):
   - You must answer using ONLY the facts directly mentioned in the MATCHED FAQ ARTICLES. Do not assume, extrapolate, or refer to outside knowledge.
   - If you do not have the knowledge (i.e., the answer is not explicitly written in the matched FAQs, or no matched FAQs are provided), you MUST respond with EXACTLY this text: "Our support team will reply you soon."

ADDITIONAL CONSTRAINTS:
- Do not make up any facts, procedures, URLs, phone numbers, or fees. Only state what is explicitly written in the matched FAQs.
- Keep the reply helpful, direct, professional, and under 80 words. Do not add conversational filler to topic answers.`;

// Keyword search fallback querying knowledge_base table
async function fallbackKeywordSearch(supabase: any, query: string, orgId: string): Promise<{ title: string; content: string }[]> {
  try {
    // 1. Search title column first (since it matches user question headers directly)
    const { data: titleMatches } = await supabase
      .from('knowledge_base')
      .select('title, content')
      .eq('organization_id', orgId)
      .textSearch('title', query, { config: 'english', type: 'websearch' })
      .limit(3)

    // 2. Search content column (for detail matches)
    const { data: contentMatches } = await supabase
      .from('knowledge_base')
      .select('title, content')
      .eq('organization_id', orgId)
      .textSearch('content', query, { config: 'english', type: 'websearch' })
      .limit(3)

    // 3. Combine and deduplicate, prioritizing title matches
    const merged: any[] = []
    const seen = new Set<string>()

    if (titleMatches) {
      for (const item of titleMatches) {
        const titleLower = item.title.toLowerCase().trim()
        if (!seen.has(titleLower)) {
          seen.add(titleLower)
          merged.push({ title: item.title, content: item.content })
        }
      }
    }

    if (contentMatches) {
      for (const item of contentMatches) {
        const titleLower = item.title.toLowerCase().trim()
        if (!seen.has(titleLower)) {
          seen.add(titleLower)
          merged.push({ title: item.title, content: item.content })
        }
      }
    }

    if (merged.length > 0) {
      return merged.slice(0, 3)
    }
  } catch (err) {
    console.error('[Playground Chat] Websearch failed, trying ILIKE fallback:', err)
  }

  // 4. Final fallback: ILIKE on title & content
  try {
    const rawWords = query
      .replace(/OR/g, ' ')
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w: string) => w.length > 2)

    if (rawWords.length > 0) {
      const ilikeFilters = rawWords.flatMap((w: string) => [
        `content.ilike.%${w}%`,
        `title.ilike.%${w}%`
      ])
      const { data: fallbackKb } = await supabase
        .from('knowledge_base')
        .select('title, content')
        .eq('organization_id', orgId)
        .or(ilikeFilters.join(','))
        .limit(3)

      return fallbackKb || []
    }
  } catch (fallbackErr) {
    console.error('[Playground Chat] ILIKE search error:', fallbackErr)
  }

  return []
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
    const orgId = (user.role === 'superadmin' && requestedOrgId) 
      ? requestedOrgId 
      : (user.organization_id || requestedOrgId)

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

      if (user.role !== 'superadmin') {
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

      if (user.role !== 'superadmin') {
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

      if (user.role !== 'superadmin') {
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

      if (user.role !== 'superadmin') {
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

      if (user.role !== 'superadmin') {
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
        .select('openai_api_key, chatbot_base_prompt, service_synonyms')
        .eq('id', orgId)
        .maybeSingle()

      const openAiKey = (orgData?.openai_api_key || process.env.OPENAI_API_KEY || '').trim()
      if (!openAiKey) {
        return NextResponse.json({ 
          error: 'OpenAI API Key is not configured for this organization. Please add it in Settings.' 
        }, { status: 400 })
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

      // Step 0: Contextual query condensation for follow-up messages
      let searchQuery = cleanMessage

      if (previousMessages.length > 0) {
        try {
          const historyText = previousMessages.slice(-8).map((m: any) =>
            `${m.role === 'user' ? 'Customer' : 'Bot'}: ${m.content}`
          ).join('\n')

          const condensationPrompt = `You are a query rewriter. Given the conversation history and the user's latest message, rewrite the latest message as a single standalone search query that captures the full intent including any context from previous messages.

Rules:
- Output ONLY the rewritten query, nothing else
- If the latest message is already self-contained (e.g., a greeting like "hi" or "hello", or a complete question), return it as-is
- Resolve pronouns and references (e.g., "it", "that", "this") using conversation history
- Keep the query concise (under 30 words)
- Do NOT add information not implied by the conversation

Conversation history:
${historyText}

Latest customer message: ${cleanMessage}

Rewritten standalone query:`

          const condensationRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${openAiKey}`
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [{ role: 'user', content: condensationPrompt }],
              temperature: 0,
              max_tokens: 80
            })
          })

          if (condensationRes.ok) {
            const data = await condensationRes.json()
            const condensed = data.choices?.[0]?.message?.content?.trim()
            if (condensed && condensed.length > 0) {
              searchQuery = condensed
              console.log(`[Playground Chat] Query condensed: "${cleanMessage}" → "${searchQuery}"`)
            }
          }
        } catch (err) {
          console.warn('[Playground Chat] Query condensation failed, using raw message:', err)
        }
      }

      // Step 1: Expand query with synonym dictionary
      const synonyms: SynonymGroup[] = orgData?.service_synonyms || []
      const { vectorQuery, keywordQuery } = expandQueryWithSynonyms(searchQuery, synonyms)

      // Step 2: Generate embedding
      let embedding: number[] | null = null
      try {
        const embedRes = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openAiKey}`
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: vectorQuery.substring(0, 8000)
          })
        })
        if (embedRes.ok) {
          const embedData = await embedRes.json()
          embedding = embedData.data?.[0]?.embedding || null
        }
      } catch (e) {
        console.error('[Playground Chat] Embedding error:', e)
      }

      // Step 3: Vector + keyword search
      let vectorFaqs: any[] = []
      let keywordFaqs: any[] = []

      if (embedding) {
        try {
          const { data: matchedFaqs, error: rpcError } = await supabase.rpc('match_faqs', {
            query_embedding: `[${embedding.join(',')}]`,
            match_threshold: 0.45,
            match_count: 3,
            org_id: orgId
          })
          if (!rpcError) vectorFaqs = matchedFaqs || []
        } catch (err) {
          console.error('[Playground Chat] Vector search error:', err)
        }
      }

      try {
        keywordFaqs = await fallbackKeywordSearch(supabase, keywordQuery, orgId)
      } catch (err) {
        console.error('[Playground Chat] Keyword search error:', err)
      }

      // Merge and deduplicate
      const merged: any[] = []
      const seen = new Set<string>()
      for (const f of vectorFaqs) {
        const key = f.title.toLowerCase().trim()
        if (!seen.has(key)) { seen.add(key); merged.push({ title: f.title, content: f.content }) }
      }
      for (const f of keywordFaqs) {
        const key = f.title.toLowerCase().trim()
        if (!seen.has(key)) { seen.add(key); merged.push({ title: f.title, content: f.content }) }
      }
      const faqs = merged.slice(0, 3)

      // Step 4: Format context
      const formattedContext = faqs.map((faq: any, i: number) =>
        `[FAQ ${i + 1}]\nQuestion: ${faq.title}\nAnswer: ${faq.content}`
      ).join('\n\n---\n\n')

      // Synonym context
      const faqsText = faqs.map((f: any) => `${f.title} ${f.content}`).join(' ')
      const activeRelationships = getActiveSynonymRelationships(searchQuery + ' ' + cleanMessage, faqsText, synonyms)
      let synonymContext = ''
      if (activeRelationships.length > 0) {
        synonymContext = `\n\nTERMINOLOGY EQUIVALENCE NOTE:\n${activeRelationships.map(r => `- ${r}`).join('\n')}`
      }

      // Step 5: Build system prompt & call GPT
      const basePrompt = orgData?.chatbot_base_prompt || DEFAULT_BASE_PROMPT
      const systemPrompt = `${basePrompt}

MATCHED FAQ ARTICLES FROM KNOWLEDGE BASE (Use this as your source of truth):
${formattedContext || '(No matching FAQs found in the knowledge base)'}${synonymContext}

CONVERSATION HISTORY:
The messages below are the recent conversation between you (assistant) and the customer (user).
Use this history to maintain context, avoid repeating information, and respond naturally as a continuation of the conversation.

CRITICAL INSTRUCTIONS:
You MUST respond in JSON format. The JSON object must contain two keys:
1. "reply": (string) Your natural conversational reply to the customer.
2. "isRiseTicket": (boolean) Set this to true ONLY if you cannot answer the user's question, if they explicitly ask for human/agent/support assistance, if they are reporting a bug or raising an issue that requires agent intervention, or if you are giving the fallback reply. Otherwise, set it to false.`

      let botReply = ''
      let isRiseTicket = false

      try {
        const validRoles = new Set(['user', 'assistant', 'system'])
        const historyForGpt = previousMessages
          .slice(-10)
          .map((m: any) => ({
            role: validRoles.has(m.role) ? m.role : (m.role === 'assistant' ? 'assistant' : 'user'),
            content: typeof m.content === 'string' ? m.content.trim() : JSON.stringify(m.content)
          }))

        const gptMessages: any[] = [
          { role: 'system', content: systemPrompt },
          ...historyForGpt,
          { role: 'user', content: cleanMessage }
        ]

        const gptResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openAiKey}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: gptMessages,
            response_format: { type: 'json_object' },
            temperature: 0.3,
            max_tokens: 300
          })
        })

        if (gptResponse.ok) {
          const gptData = await gptResponse.json()
          const contentString = gptData.choices?.[0]?.message?.content?.trim() || '{}'
          try {
            const parsed = JSON.parse(contentString)
            botReply = parsed.reply || parsed.message || parsed.answer || contentString
            isRiseTicket = !!parsed.isRiseTicket
          } catch {
            botReply = contentString
          }

          // Safety check for escalation
          const lowerReply = botReply.toLowerCase()
          const lowerMsg = cleanMessage.toLowerCase()
          if (!isRiseTicket && (
            lowerReply.includes('support team') || lowerReply.includes('reply you soon') ||
            lowerReply.includes('human agent') || lowerReply.includes('representative') ||
            lowerMsg.includes('human') || lowerMsg.includes('agent') ||
            lowerMsg.includes('raise ticket') || lowerMsg.includes('talk to a person')
          )) {
            isRiseTicket = true
          }
        } else {
          const errData = await gptResponse.json().catch(() => null)
          const errMsg = errData?.error?.message || `OpenAI error (${gptResponse.status}): ${gptResponse.statusText}`
          console.error('[Playground Chat] OpenAI API error:', gptResponse.status, errData)
          botReply = `Chatbot error: ${errMsg}`
        }
      } catch (err: any) {
        botReply = `Chatbot exception: ${err.message || 'Error communicating with AI service'}`
        console.error('[Playground Chat] GPT error:', err)
      }

      // Step 6: Save messages to session
      const userMsg = { role: 'user', content: cleanMessage, timestamp: new Date().toISOString() }
      const botMsg = { 
        role: 'assistant', 
        content: botReply, 
        timestamp: new Date().toISOString(), 
        isRiseTicket, 
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
