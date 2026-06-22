import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

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
    const { conversationId } = await request.json()
    if (!conversationId) {
      return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 })
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

    // 3. Extract keywords from client's last message to fetch relevant articles
    const lastMsg = chatHistory[chatHistory.length - 1]
    let kbArticles: { title: string; content: string; source_url: string | null; description: string | null }[] = []

    if (lastMsg && lastMsg.sender_type === 'contact' && lastMsg.body) {
      const text = lastMsg.body.toLowerCase()
      const stopWords = new Set([
        'the', 'a', 'is', 'for', 'to', 'in', 'on', 'at', 'how', 'what', 'why', 'who', 'where', 'when',
        'i', 'you', 'he', 'she', 'they', 'we', 'it', 'my', 'your', 'and', 'or', 'but', 'of', 'with',
        'from', 'by', 'an', 'this', 'that', 'these', 'those', 'are', 'was', 'were', 'be', 'been',
        'have', 'has', 'had', 'do', 'does', 'did', 'please', 'hi', 'hello', 'hey', 'can', 'get',
        'any', 'me', 'need', 'want', 'will', 'would', 'could', 'should', 'may', 'might',
        'also', 'just', 'more', 'some', 'about', 'there', 'so', 'not', 'no', 'yes', 'ok'
      ])
      const words = text
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter((w: string) => w.length > 2 && !stopWords.has(w))

      if (words.length > 0) {
        // Try Postgres full-text search with title + content
        const tsQuery = words.join(' | ')

        // Search in both title and content columns
        const { data: kbData } = await supabase
          .from('knowledge_base')
          .select('title, content, source_url, description')
          .eq('organization_id', conv.organization_id)
          .textSearch('content', tsQuery, {
            config: 'english',
            type: 'plain'
          })
          .limit(5)

        if (!kbData || kbData.length === 0) {
          // Fallback: ILIKE OR matching on both title and content
          const ilikeFilters = words.flatMap((w: string) => [
            `content.ilike.%${w}%`,
            `title.ilike.%${w}%`
          ])
          const { data: fallbackKb } = await supabase
            .from('knowledge_base')
            .select('title, content, source_url, description')
            .eq('organization_id', conv.organization_id)
            .or(ilikeFilters.join(','))
            .limit(5)
          kbArticles = fallbackKb || []
        } else {
          kbArticles = kbData
        }
      }
    }

    // 4. Format prompt
    const formattedHistory = chatHistory.map(m => {
      const sender = m.sender_type === 'user' ? 'Operator' : 'Client'
      return `${sender}: ${m.body}`
    }).join('\n')

    const hasKBArticles = kbArticles.length > 0

    // Build the knowledge base context with full metadata
    const formattedContext = kbArticles.map((art, i) => {
      const parts = [`[ARTICLE ${i + 1}]`]
      parts.push(`Title: ${art.title}`)
      if (art.description) parts.push(`Summary: ${art.description}`)
      if (art.source_url) parts.push(`Link: ${art.source_url}`)
      parts.push(`Content Preview: ${art.content.substring(0, 1500)}`)
      return parts.join('\n')
    }).join('\n\n---\n\n')

    const systemPrompt = `You are a helpful, professional customer service assistant that helps operators (agents) respond to clients.

KNOWLEDGE BASE ARTICLES:
${formattedContext || '(No matching articles found in the knowledge base)'}

INSTRUCTIONS:
You must return a JSON object with a "suggestions" array containing exactly 3 suggestion objects.

Each suggestion object MUST have:
- "text": The full reply text the operator should send to the client
- "article_title": The title of the knowledge base article used (or null if none)
- "source_url": The link/URL from the knowledge base article (or null if none)

RULES FOR GENERATING SUGGESTIONS:
${hasKBArticles ? `
1. PRIORITIZE knowledge base articles. Extract specific steps, instructions, or facts from the articles.
2. Each reply should be helpful, detailed, and actionable (30-80 words). Include specific steps or key points from the article.
3. If an article has a link/URL, ALWAYS mention it in your reply text naturally, e.g. "You can find the complete guide here: [URL]" or "For detailed steps, please refer to: [URL]".
4. Make replies professional and warm. Start with acknowledgment, then provide the key information.
5. Each of the 3 suggestions should take a slightly different angle or highlight different parts of the article.
` : `
1. You have NO knowledge base articles for this query. Do NOT make up facts, steps, procedures, or documentation links.
2. Suggestion 1: A warm, helpful acknowledgment that you'll look into their query and someone from the team will assist them shortly.
3. Suggestion 2: A polite request asking the client to provide more details so you can help them better, while assuring them the team is here to help.
4. Suggestion 3: A professional response confirming their query has been noted and a team member will get back with the relevant information shortly.
5. Keep replies between 15-40 words. Be honest — NEVER hallucinate or invent information.
`}

RESPONSE FORMAT (strict JSON):
{
  "suggestions": [
    { "text": "...", "article_title": "..." or null, "source_url": "..." or null },
    { "text": "...", "article_title": "..." or null, "source_url": "..." or null },
    { "text": "...", "article_title": "..." or null, "source_url": "..." or null }
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
            // Backward compat: if GPT returns plain strings
            return { text: s, article_title: null, source_url: null }
          }
          return {
            text: s.text || s.message || '',
            article_title: s.article_title || null,
            source_url: s.source_url || null
          }
        })
      } else if (Array.isArray(parsed)) {
        suggestions = parsed.map((s: any) => {
          if (typeof s === 'string') return { text: s, article_title: null, source_url: null }
          return {
            text: s.text || s.message || '',
            article_title: s.article_title || null,
            source_url: s.source_url || null
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
