import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { verifyRecordAccess, getAuthenticatedUser } from '@/lib/api-auth-helper'
import { expandQueryWithSynonyms, SynonymGroup, getActiveSynonymRelationships } from '@/lib/query-expander'

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
    const { conversationId, playground } = body

    if (playground === true) {
      return await handlePlayground(request, body)
    }

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
    let orgData: any = null
    if (conv.organization_id) {
      try {
        const { data } = await supabase
          .from('organizations')
          .select('openai_api_key, service_synonyms')
          .eq('id', conv.organization_id)
          .single()
        orgData = data
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
    let queryText = ''
    const synonyms: SynonymGroup[] = orgData?.service_synonyms || []

    if (lastMsg && lastMsg.sender_type === 'contact' && lastMsg.body) {
      // Rephrase follow-up query using history to preserve context
      queryText = await rephraseQuery(chatHistory, openAiKey)

      // Expand query with synonym dictionary for better matching
      const { vectorQuery, keywordQuery } = expandQueryWithSynonyms(queryText, synonyms)
      console.log(`[Copilot] Synonym expansion - Vector query: "${vectorQuery}", Keyword query: "${keywordQuery}"`)

      let vectorFaqs: any[] = []
      let keywordFaqs: any[] = []

      // Generate embedding for the expanded vector query
      const queryEmbedding = await generateQueryEmbedding(vectorQuery, openAiKey)

      if (queryEmbedding) {
        // Use pgvector similarity search via the match_faqs RPC function
        const embeddingStr = `[${queryEmbedding.join(',')}]`

        try {
          const { data: matchedFaqs, error: rpcError } = await supabase.rpc('match_faqs', {
            query_embedding: embeddingStr,
            match_threshold: 0.45, // Lowered threshold for text-embedding-3-small
            match_count: 3,
            org_id: conv.organization_id
          })

          if (rpcError) {
            console.error('[Copilot] RPC match_faqs error:', rpcError)
          } else {
            vectorFaqs = matchedFaqs || []
          }
        } catch (err) {
          console.error('[Copilot] Vector search failed:', err)
        }
      }

      // Always fetch keyword matches too for hybrid pool using keywordQuery
      try {
        keywordFaqs = await fallbackKeywordSearch(supabase, keywordQuery, conv.organization_id)
      } catch (kwErr) {
        console.error('[Copilot] Keyword fallback search failed:', kwErr)
      }

      // Combine and deduplicate
      const merged: any[] = []
      const seen = new Set<string>()

      for (const f of vectorFaqs) {
        const titleLower = f.title.toLowerCase().trim()
        if (!seen.has(titleLower)) {
          seen.add(titleLower)
          merged.push({
            title: f.title,
            content: f.content,
            similarity: f.similarity
          })
        }
      }

      for (const f of keywordFaqs) {
        const titleLower = f.title.toLowerCase().trim()
        if (!seen.has(titleLower)) {
          seen.add(titleLower)
          merged.push({
            title: f.title,
            content: f.content,
            similarity: null
          })
        }
      }
      kbArticles = merged.slice(0, 3)
      console.log(`[Copilot] Hybrid search returned ${kbArticles.length} articles (vector: ${vectorFaqs.length}, keyword: ${keywordFaqs.length})`)
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

    // Context-filter synonyms for terminology note
    const faqsText = kbArticles.map(f => `${f.title} ${f.content}`).join(' ')
    const activeRelationships = getActiveSynonymRelationships(queryText || '', faqsText, synonyms)
    
    let synonymContext = ''
    if (activeRelationships.length > 0) {
      synonymContext = `\n\nTERMINOLOGY EQUIVALENCE NOTE (Use this to match customer terms to FAQ terms):
${activeRelationships.map(r => `- ${r}`).join('\n')}`
    }

    const systemPrompt = `You are a helpful, professional customer service assistant that helps operators (agents) respond to clients.

MATCHED FAQ ARTICLES:
${formattedContext || '(No matching FAQs found in the knowledge base)'}${synonymContext}

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
// Fallback keyword search for when vector search is not yet available
async function fallbackKeywordSearch(
  supabase: any,
  queryText: string,
  orgId: string
): Promise<{ title: string; content: string; similarity: number }[]> {
  try {
    // 1. Search title column first (since it matches user question headers directly)
    const { data: titleMatches } = await supabase
      .from('knowledge_base')
      .select('title, content')
      .eq('organization_id', orgId)
      .textSearch('title', queryText, { config: 'english', type: 'websearch' })
      .limit(3)

    // 2. Search content column (for detail matches)
    const { data: contentMatches } = await supabase
      .from('knowledge_base')
      .select('title, content')
      .eq('organization_id', orgId)
      .textSearch('content', queryText, { config: 'english', type: 'websearch' })
      .limit(3)

    // 3. Combine and deduplicate, prioritizing title matches
    const merged: any[] = []
    const seen = new Set<string>()

    if (titleMatches) {
      for (const item of titleMatches) {
        const titleLower = item.title.toLowerCase().trim()
        if (!seen.has(titleLower)) {
          seen.add(titleLower)
          merged.push({ title: item.title, content: item.content, similarity: 0 })
        }
      }
    }

    if (contentMatches) {
      for (const item of contentMatches) {
        const titleLower = item.title.toLowerCase().trim()
        if (!seen.has(titleLower)) {
          seen.add(titleLower)
          merged.push({ title: item.title, content: item.content, similarity: 0 })
        }
      }
    }

    if (merged.length > 0) {
      return merged.slice(0, 3)
    }
  } catch (err) {
    console.error('[Keyword Search] Websearch failed, trying ILIKE:', err)
  }

  // 4. Final fallback: ILIKE on both title and content
  try {
    const rawWords = queryText
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

      return (fallbackKb || []).map((a: any) => ({ title: a.title, content: a.content, similarity: 0 }))
    }
  } catch (e) {
    console.error('[Keyword Search] ILIKE fallback search failed:', e)
  }

  return []
}

async function handlePlayground(request: NextRequest, body: any) {
  try {
    const user = await getAuthenticatedUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const orgId = user.organization_id
    if (!orgId) {
      return NextResponse.json({ error: 'Forbidden: No organization assigned' }, { status: 403 })
    }

    const { query } = body
    if (!query) {
      return NextResponse.json({ error: 'Missing query parameter' }, { status: 400 })
    }

    const supabase = getSupabaseClient()

    // Load organization settings
    const { data: orgData } = await supabase
      .from('organizations')
      .select('openai_api_key, chatbot_base_prompt, service_synonyms')
      .eq('id', orgId)
      .maybeSingle()

    const openAiKey = orgData?.openai_api_key || process.env.OPENAI_API_KEY
    if (!openAiKey) {
      return NextResponse.json({ error: 'OpenAI API Key is not configured.' }, { status: 400 })
    }

    // Step 0: Expand query with synonym dictionary
    const synonyms: SynonymGroup[] = orgData?.service_synonyms || []
    const { vectorQuery, keywordQuery, matchedSynonyms } = expandQueryWithSynonyms(query, synonyms)
    console.log(`[Playground API] Query expansion: "${query}" - Vector query: "${vectorQuery}", Keyword query: "${keywordQuery}" (${matchedSynonyms.length} synonyms matched)`)

    // Step 1: Generate Embedding (using expanded vector query)
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
      console.error('[Playground API] Embedding error:', e)
    }

    // Step 2: Query via RPC Vector Search
    let vectorResults: any[] = []
    let vectorError: string | null = null
    if (embedding) {
      try {
        const { data: matchedFaqs, error: rpcError } = await supabase.rpc('match_faqs', {
          query_embedding: `[${embedding.join(',')}]`,
          match_threshold: 0.45, // Lowered threshold for text-embedding-3-small
          match_count: 3,
          org_id: orgId
        })
        if (rpcError) {
          vectorError = rpcError.message
        } else {
          vectorResults = matchedFaqs || []
        }
      } catch (err: any) {
        vectorError = err.message || 'RPC execution failed'
      }
    } else {
      vectorError = 'Could not generate query embedding'
    }

    // Step 3: Query via Keyword Search (Fallback mechanism using keywordQuery)
    let keywordResults: any[] = []
    try {
      keywordResults = await fallbackKeywordSearch(supabase, keywordQuery, orgId)
    } catch (err: any) {
      console.error('[Playground API] Keyword search error:', err)
    }

    // Step 4: Combine, Deduplicate and Select FAQ articles
    const mergedFaqs: any[] = []
    const seenTitles = new Set<string>()

    for (const faq of vectorResults) {
      const normalizedTitle = faq.title.toLowerCase().trim()
      if (!seenTitles.has(normalizedTitle)) {
        seenTitles.add(normalizedTitle)
        mergedFaqs.push({
          title: faq.title,
          content: faq.content,
          similarity: faq.similarity,
          source: 'vector'
        })
      }
    }

    for (const faq of keywordResults) {
      const normalizedTitle = faq.title.toLowerCase().trim()
      if (!seenTitles.has(normalizedTitle)) {
        seenTitles.add(normalizedTitle)
        mergedFaqs.push({
          title: faq.title,
          content: faq.content,
          similarity: null,
          source: 'keyword'
        })
      }
    }

    const selectedFaqs = mergedFaqs.slice(0, 3)
    let retrievalMode: 'vector' | 'keyword' | 'hybrid' | 'none' = 'none'
    if (vectorResults.length > 0 && keywordResults.length > 0) {
      retrievalMode = 'hybrid'
    } else if (vectorResults.length > 0) {
      retrievalMode = 'vector'
    } else if (keywordResults.length > 0) {
      retrievalMode = 'keyword'
    }

    // Step 5: Format context and prompts
    const formattedContext = selectedFaqs.map((faq: any, i: number) => {
      const relevanceStr = faq.similarity ? ` (Similarity: ${(faq.similarity * 100).toFixed(0)}%)` : ''
      return `[FAQ ${i + 1}]${relevanceStr}\nQuestion: ${faq.title}\nAnswer: ${faq.content}`
    }).join('\n\n---\n\n')

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

    // Context-filter synonyms for terminology note
    const faqsText = selectedFaqs.map((f: any) => `${f.title} ${f.content}`).join(' ')
    const activeRelationships = getActiveSynonymRelationships(query || '', faqsText, synonyms)
    
    let synonymContext = ''
    if (activeRelationships.length > 0) {
      synonymContext = `\n\nTERMINOLOGY EQUIVALENCE NOTE (Use this to match customer terms to FAQ terms):
${activeRelationships.map(r => `- ${r}`).join('\n')}`
    }

    const basePrompt = orgData?.chatbot_base_prompt || DEFAULT_BASE_PROMPT
    const systemPrompt = `${basePrompt}

MATCHED FAQ ARTICLES FROM KNOWLEDGE BASE (Use this as your source of truth):
${formattedContext || '(No matching FAQs found in the knowledge base)'}${synonymContext}

CONVERSATION HISTORY:
The messages below are the recent conversation between you (assistant) and the customer (user).
Use this history to maintain context, avoid repeating information, and respond naturally as a continuation of the conversation.

CRITICAL INSTRUCTIONS:
You MUST respond in JSON format. The JSON object must contain two keys:
1. "reply": (string) Your natural conversational reply to the customer. If you cannot answer the query using the matched FAQ articles, or if the user asks to connect with support/a human, or if you need to hand off to a human agent, set "reply" to a friendly notice indicating that the support team will get in touch soon.
2. "isRiseTicket": (boolean) Set this to true ONLY if you cannot answer the user's question, if they explicitly ask for human/agent/support assistance, if they are reporting a bug or raising an issue that requires agent intervention, or if you are giving the fallback reply. Otherwise, set it to false.`

    // Step 6: Call OpenAI GPT
    let gptReply = ''
    let isRiseTicket = false
    let callError: string | null = null

    try {
      const gptResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openAiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: query }
          ],
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
          gptReply = parsed.reply || ''
          isRiseTicket = !!parsed.isRiseTicket
        } catch (parseErr) {
          gptReply = contentString
        }

        // Apply same text analysis fallback triggers
        const lowerReply = gptReply.toLowerCase()
        const lowerIncoming = query.toLowerCase()
        if (
          !isRiseTicket &&
          (lowerReply.includes('support team') ||
           lowerReply.includes('reply you soon') ||
           lowerReply.includes('reply soon') ||
           lowerReply.includes('contact you') ||
           lowerReply.includes('reach you') ||
           lowerReply.includes('human agent') ||
           lowerReply.includes('representative') ||
           lowerIncoming.includes('support team') ||
           lowerIncoming.includes('human') ||
           lowerIncoming.includes('agent') ||
           lowerIncoming.includes('connect to support') ||
           lowerIncoming.includes('talk to a person') ||
           lowerIncoming.includes('representative') ||
           lowerIncoming.includes('raise ticket') ||
           lowerIncoming.includes('create ticket'))
        ) {
          isRiseTicket = true
        }
      } else {
        callError = `GPT call failed: ${gptResponse.status} ${gptResponse.statusText}`
      }
    } catch (err: any) {
      callError = err.message || 'GPT call exception'
    }

    return NextResponse.json({
      query,
      expandedQuery: vectorQuery,
      matchedSynonyms,
      retrievalMode,
      vectorResults: vectorResults.map(r => ({ id: r.id, title: r.title, content: r.content, similarity: r.similarity })),
      vectorError,
      keywordResults: keywordResults.map(r => ({ title: r.title, content: r.content })),
      selectedFaqs,
      systemPrompt,
      gptReply,
      isRiseTicket,
      callError
    })

  } catch (err: any) {
    console.error('[Playground API] Critical route error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}

