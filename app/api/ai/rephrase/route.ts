import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthenticatedUser } from '@/lib/api-auth-helper'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

const TONE_PROMPTS: Record<string, string> = {
  professional: `Rewrite the following message to sound professional and polite. 
Keep the same meaning but use formal business language. 
Do NOT add any greetings or sign-offs unless the original has them.
Output ONLY the rewritten message text, nothing else.`,

  friendly: `Rewrite the following message to sound warm, friendly, and approachable. 
Keep the same meaning but make it feel personal and caring.
Do NOT add any greetings or sign-offs unless the original has them.
Output ONLY the rewritten message text, nothing else.`,

  short: `Rewrite the following message to be short and concise. 
Keep the core meaning but remove any unnecessary words. Make it clear and easy to understand.
Do NOT add any greetings or sign-offs unless the original has them.
Output ONLY the rewritten message text, nothing else.`,

  grammar: `Fix the grammar, spelling, and punctuation of the following message. 
Keep the tone and meaning exactly the same, only correct errors.
Output ONLY the corrected message text, nothing else.`
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { text, tone } = body

    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'Missing or empty text' }, { status: 400 })
    }

    if (!tone || !TONE_PROMPTS[tone]) {
      return NextResponse.json({ error: 'Invalid tone. Must be one of: professional, friendly, short, grammar' }, { status: 400 })
    }

    // Load org-level OpenAI key if available
    let openAiKey = process.env.OPENAI_API_KEY || ''
    if (user.organization_id) {
      try {
        const supabase = getSupabaseClient()
        const { data: orgData } = await supabase
          .from('organizations')
          .select('openai_api_key')
          .eq('id', user.organization_id)
          .single()
        if (orgData?.openai_api_key) {
          openAiKey = orgData.openai_api_key
        }
      } catch (err) {
        console.error('[Rephrase] Error loading org OpenAI key:', err)
      }
    }

    if (!openAiKey) {
      return NextResponse.json({ error: 'OpenAI API key is not configured' }, { status: 400 })
    }

    const systemPrompt = TONE_PROMPTS[tone]

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
          { role: 'user', content: text.trim() }
        ],
        temperature: 0.4,
        max_tokens: 500
      })
    })

    const data = await response.json()

    if (!response.ok || data.error) {
      console.error('[Rephrase] OpenAI error:', data.error || data)
      return NextResponse.json({
        error: data.error?.message || 'OpenAI API call failed'
      }, { status: response.status || 500 })
    }

    const rephrased = data.choices?.[0]?.message?.content?.trim() || text.trim()

    return NextResponse.json({ rephrased, tone })
  } catch (error: any) {
    console.error('[Rephrase API] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
