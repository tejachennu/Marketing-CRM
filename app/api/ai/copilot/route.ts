import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { verifyRecordAccess } from '@/lib/api-auth-helper'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

// Generate embedding for a query using OpenAI text-embedding-3-small
async function generateQueryEmbedding(text: string, apiKey: string): Promise<number[] | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text.substring(0, 8000)
      })
    })

    if (!res.ok) {
      console.error('[Copilot] Embedding API error:', res.status)
      return null
    }

    const data = await res.json()
    return data.data?.[0]?.embedding || null
  } catch (err) {
    console.error('[Copilot] Error generating query embedding:', err)
    return null
  }
}

// Rewrites follow-up messages using chat history to restore context for semantic search
async function rephraseQuery(chatHistory: any[], apiKey: string): Promise<string> {
  const lastMsg = chatHistory[chatHistory.length - 1]
  if (!lastMsg || !lastMsg.body) return ''

  // If there's only one message, it's a standalone question. No rephrasing needed.
  if (chatHistory.length <= 1) {
    return lastMsg.body
  }

  try {
    // Take only the previous 4 chats for context + the current message
    const recentHistory = chatHistory.slice(-5)
    
    const formattedHistory = recentHistory.slice(0, -1).map(m => {
      const sender = m.sender_type === 'user' ? 'Operator' : 'Client'
      return `${sender}: ${m.body}`
    }).join('\n')

    const prompt = `You are an expert AI assistant. Your task is to rewrite the client's latest message into a standalone, self-contained search query. 
The standalone query should contain all the necessary context from the conversation history (such as topic, entity, location, etc.) so it can be used for semantic search (vector database lookup).
Crucially, you must CORRECT ANY SPELLING ERRORS or typos in the client's latest message while rewriting it.

CONVERSATION HISTORY:
${formattedHistory}

CLIENT'S LATEST MESSAGE:
"${lastMsg.body}"

INSTRUCTIONS:
1. Output ONLY the standalone query.
2. Do not include any intro, explanation, quotes, or conversational filler.
3. If the latest message is already a standalone question and doesn't depend on history, correct its spelling and output it as-is.
4. If the latest message is just small talk or doesn't refer to the conversation topic (e.g. "thanks", "ok"), you can keep it simple or output it as-is.
5. ALWAYS correct spelling mistakes.

Standalone search query:`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 100
      })
    })

    if (!response.ok) {
      console.error('[Copilot] Rephrase API error:', response.status)
      return lastMsg.body
    }

    const data = await response.json()
    const rewritten = data.choices?.[0]?.message?.content?.trim() || lastMsg.body
    console.log(`[Copilot] Rephrased "${lastMsg.body}" -> "${rewritten}"`)
    return rewritten
  } catch (err) {
    console.error('[Copilot] Error rephrasing query:', err)
    return lastMsg.body
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { conversationId } = body
    if (!conversationId) {
      return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 })
    }

    const authResult = await verifyRecordAccess(request, 'conversations', conversationId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseClient()

    // 1. Fetch conversation details to get organization_id
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('organization_id')
      .eq('id', conversationId)
      .single()

    if (convErr || !conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    // Load custom credentials per organization
    let openAiKey = process.env.OPENAI_API_KEY || ''
    if (conv.organization_id) {
      try {
        const { data: orgData } = await supabase
          .from('organizations')
          .select('openai_api_key')
          .eq('id', conv.organization_id)
          .single()
        if (orgData && orgData.openai_api_key) {
          openAiKey = orgData.openai_api_key
        }
      } catch (dbErr) {
        console.error('[Copilot] Error loading organization OpenAI key:', dbErr)
      }
    }

    if (!openAiKey) {
      return NextResponse.json({ suggestions: [], error: 'OpenAI API key is not configured' }, { status: 200 })
    }

    // 2. Fetch last 15 messages
    const { data: messages, error: msgErr } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(15)

    if (msgErr) {
      throw msgErr
    }

    const chatHistory = (messages || []).reverse()
    if (chatHistory.length === 0) {
      return NextResponse.json({ suggestions: [] })
    }

    // 3. Semantic search — generate embedding for the customer's last message
    const lastMsg = chatHistory[chatHistory.length - 1]
    let kbArticles: { title: string; content: string; similarity: number }[] = []

    if (lastMsg && lastMsg.sender_type === 'contact' && lastMsg.body) {
      // Rephrase follow-up query using history to preserve context
      const queryText = await rephraseQuery(chatHistory, openAiKey)

      // Generate embedding for the rephrased query
      const queryEmbedding = await generateQueryEmbedding(queryText, openAiKey)

      if (queryEmbedding) {
        // Use pgvector similarity search via the match_faqs RPC function
        const embeddingStr = `[${queryEmbedding.join(',')}]`

        try {
          const { data: matchedFaqs, error: rpcError } = await supabase.rpc('match_faqs', {
            query_embedding: embeddingStr,
            match_threshold: 0.65,
            match_count: 3,
            org_id: conv.organization_id
          })

          if (rpcError) {
            console.error('[Copilot] RPC match_faqs error:', rpcError)
            // Fallback to keyword search if vector search is not available yet
            kbArticles = await fallbackKeywordSearch(supabase, queryText, conv.organization_id)
          } else if (matchedFaqs && matchedFaqs.length > 0) {
            kbArticles = matchedFaqs.map((faq: any) => ({
              title: faq.title,
              content: faq.content,
              similarity: faq.similarity
            }))
            console.log(`[Copilot] Vector search found ${kbArticles.length} matching FAQs (best similarity: ${kbArticles[0]?.similarity?.toFixed(3)})`)
          }
        } catch (err) {
          console.error('[Copilot] Vector search failed, falling back to keyword search:', err)
          kbArticles = await fallbackKeywordSearch(supabase, queryText, conv.organization_id)
        }
      } else {
        // Embedding generation failed — fall back to keyword search
        console.warn('[Copilot] Embedding generation failed, using keyword fallback')
        kbArticles = await fallbackKeywordSearch(supabase, queryText, conv.organization_id)
      }
    }

    // 4. Format prompt
    const formattedHistory = chatHistory.map(m => {
      const sender = m.sender_type === 'user' ? 'Operator' : 'Client'
      return `${sender}: ${m.body}`
    }).join('\n')

    const hasKBArticles = kbArticles.length > 0

    // Build the FAQ context
    const formattedContext = kbArticles.map((faq, i) => {
      const parts = [`[FAQ ${i + 1}]`]
      parts.push(`Question: ${faq.title}`)
      parts.push(`Answer: ${faq.content.substring(0, 2000)}`)
      if (faq.similarity) {
        parts.push(`Relevance: ${(faq.similarity * 100).toFixed(0)}%`)
      }
      return parts.join('\n')
    }).join('\n\n---\n\n')

    const systemPrompt = `You are a helpful, professional customer service assistant that helps operators (agents) respond to clients.

MATCHED FAQ ARTICLES:
${formattedContext || '(No matching FAQs found in the knowledge base)'}

INSTRUCTIONS:
You must return a JSON object with a "suggestions" array containing exactly 3 suggestion objects.

Each suggestion object MUST have:
- "text": The full reply text the operator should send to the client
- "article_title": The title/question of the FAQ used (or null if none)

RULES FOR GENERATING SUGGESTIONS:
${hasKBArticles ? `
1. DIRECTLY ANSWER the client's question using the matched FAQ content. Do NOT say "let me check" or "I'll get back to you" — the answer is right here in the FAQ.
2. Each reply should be helpful, specific, and actionable (30-80 words). Extract the key facts, steps, fees, or instructions directly from the FAQ answer.
3. Make replies professional and warm. Start with a brief acknowledgment, then provide the specific answer from the FAQ.
4. Each of the 3 suggestions should present the FAQ information in a slightly different tone or level of detail:
   - Suggestion 1: Concise and direct answer
   - Suggestion 2: Detailed answer with all relevant specifics from the FAQ
   - Suggestion 3: Friendly, conversational version of the answer
5. NEVER make up information that isn't in the FAQ. Only use facts from the matched FAQ content.
` : `
1. You have NO matching FAQs for this query. Do NOT make up facts, steps, procedures, or information.
2. Suggestion 1: A warm, helpful acknowledgment that you'll look into their query and someone from the team will assist them shortly.
3. Suggestion 2: A polite request asking the client to provide more details so you can help them better, while assuring them the team is here to help.
4. Suggestion 3: A professional response confirming their query has been noted and a team member will get back with the relevant information shortly.
5. Keep replies between 15-40 words. Be honest — NEVER hallucinate or invent information.
`}

RESPONSE FORMAT (strict JSON):
{
  "suggestions": [
    { "text": "...", "article_title": "..." or null },
    { "text": "...", "article_title": "..." or null },
    { "text": "...", "article_title": "..." or null }
  ]
}`

    const userPrompt = `Here is the conversation history:\n${formattedHistory}\n\nGenerate 3 structured suggestion objects in the JSON format specified.`

    // 5. Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openAiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.4,
        max_tokens: 600
      })
    })

    const data = await response.json()
    if (response.status !== 200 || data.error) {
      console.error('[Copilot OpenAI Error]', data.error || data)
      return NextResponse.json({
        suggestions: [],
        error: data.error?.message || 'OpenAI API call failed'
      }, { status: response.status || 500 })
    }
    const contentText = data.choices?.[0]?.message?.content || '{}'
    
    let suggestions: { text: string; article_title?: string | null; source_url?: string | null }[] = []
    try {
      const parsed = JSON.parse(contentText)
      if (Array.isArray(parsed.suggestions)) {
        suggestions = parsed.suggestions.map((s: any) => {
          if (typeof s === 'string') {
            return { text: s, article_title: null, source_url: null }
          }
          return {
            text: s.text || s.message || '',
            article_title: s.article_title || null,
            source_url: null
          }
        })
      } else if (Array.isArray(parsed)) {
        suggestions = parsed.map((s: any) => {
          if (typeof s === 'string') return { text: s, article_title: null, source_url: null }
          return {
            text: s.text || s.message || '',
            article_title: s.article_title || null,
            source_url: null
          }
        })
      }
    } catch (e) {
      console.error('[Copilot] Failed to parse GPT completion:', e)
    }

    return NextResponse.json({
      suggestions,
      articles_found: kbArticles.length
    })
  } catch (error: any) {
    console.error('[Copilot API] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}

// Fallback keyword search for when vector search is not yet available
async function fallbackKeywordSearch(
  supabase: any,
  queryText: string,
  orgId: string
): Promise<{ title: string; content: string; similarity: number }[]> {
  const stopWords = new Set([
    'the', 'a', 'is', 'for', 'to', 'in', 'on', 'at', 'how', 'what', 'why', 'who', 'where', 'when',
    'i', 'you', 'he', 'she', 'they', 'we', 'it', 'my', 'your', 'and', 'or', 'but', 'of', 'with',
    'from', 'by', 'an', 'this', 'that', 'these', 'those', 'are', 'was', 'were', 'be', 'been',
    'have', 'has', 'had', 'do', 'does', 'did', 'please', 'hi', 'hello', 'hey', 'can', 'get',
    'any', 'me', 'need', 'want', 'will', 'would', 'could', 'should', 'may', 'might',
    'also', 'just', 'more', 'some', 'about', 'there', 'so', 'not', 'no', 'yes', 'ok'
  ])

  const words = queryText
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((w: string) => w.length > 2 && !stopWords.has(w))

  if (words.length === 0) return []

  const tsQuery = words.join(' | ')

  const { data: kbData } = await supabase
    .from('knowledge_base')
    .select('title, content')
    .eq('organization_id', orgId)
    .textSearch('content', tsQuery, { config: 'english', type: 'plain' })
    .limit(3)

  if (kbData && kbData.length > 0) {
    return kbData.map((a: any) => ({ title: a.title, content: a.content, similarity: 0 }))
  }

  // Final fallback: ILIKE
  const ilikeFilters = words.flatMap((w: string) => [
    `content.ilike.%${w}%`,
    `title.ilike.%${w}%`
  ])
  const { data: fallbackKb } = await supabase
    .from('knowledge_base')
    .select('title, content')
    .eq('organization_id', orgId)
    .or(ilikeFilters.join(','))
    .limit(3)

  return (fallbackKb || []).map((a: any) => ({ title: a.title, content: a.content, similarity: 0 }))
}
