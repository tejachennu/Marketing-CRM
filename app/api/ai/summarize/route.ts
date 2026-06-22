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
        console.error('[Summarize] Error loading organization OpenAI key:', dbErr)
      }
    }

    if (!openAiKey) {
      return NextResponse.json({ error: 'OpenAI API key is not configured' }, { status: 400 })
    }

    // Fetch all messages for the conversation
    const { data: messages, error: msgErr } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })

    if (msgErr) {
      throw msgErr
    }

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: 'No message history available to summarize' }, { status: 400 })
    }

    // Format transcript
    const transcript = messages.map(m => {
      const sender = m.sender_type === 'user' ? 'Operator' : 'Client'
      return `${sender}: ${m.body || '[Media/Attachment]'}`
    }).join('\n')

    const systemPrompt = `You are a CRM sales analyst. Analyze the following WhatsApp chat transcript and extract lead details.
Format the output strictly as a JSON object with these keys:
1. "title": A short deal title (e.g. "US Visa Help" or "Passport Renewal")
2. "value": Estimated deal value as a number if mentioned (e.g. 150), else null
3. "priority": "high", "medium", or "low" (High/Hot for immediate intent, Medium/Warm for interest, Low/Cold for queries)
4. "product_service": Name of product/service they want (e.g. "Consular Consulting")
5. "notes": A brief bulleted list of notes (next steps, deadlines, client requests)
6. "status": 'active', 'won', 'lost', or 'on_hold' (default to 'active' unless chat clearly shows transaction is completed/won or abandoned/lost)
7. "summary": A brief 2-sentence executive summary of the chat

Return ONLY the JSON object.`

    const userPrompt = `Here is the chat history:\n${transcript}\n\nExtract the JSON lead profile.`

    // Call OpenAI API
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
        temperature: 0.3,
        max_tokens: 400
      })
    })

    const data = await response.json()
    if (response.status !== 200 || data.error) {
      console.error('[Summarize OpenAI Error]', data.error || data)
      return NextResponse.json({
        error: data.error?.message || 'OpenAI API call failed'
      }, { status: response.status || 500 })
    }
    const contentText = data.choices?.[0]?.message?.content || '{}'
    
    let leadProfile = {}
    try {
      leadProfile = JSON.parse(contentText)
    } catch (e) {
      console.error('[Summarize] Failed to parse GPT output:', e)
      return NextResponse.json({ error: 'Failed to generate profile structure' }, { status: 500 })
    }

    return NextResponse.json({ profile: leadProfile })
  } catch (error: any) {
    console.error('[Summarize API] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
