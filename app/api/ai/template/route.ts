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
    const { orgId, prompt, templateHtml } = await request.json()
    
    if (!prompt) {
      return NextResponse.json({ error: 'Missing prompt' }, { status: 400 })
    }

    const supabase = getSupabaseClient()

    // Load custom credentials per organization
    let openAiKey = process.env.OPENAI_API_KEY || ''
    if (orgId) {
      try {
        const { data: orgData } = await supabase
          .from('organizations')
          .select('openai_api_key')
          .eq('id', orgId)
          .single()
        if (orgData && orgData.openai_api_key) {
          openAiKey = orgData.openai_api_key
        }
      } catch (dbErr) {
        console.error('[Template Gen] Error loading organization OpenAI key:', dbErr)
      }
    }

    if (!openAiKey) {
      return NextResponse.json({ error: 'OpenAI API key is not configured for this workspace. Please add it in Settings.' }, { status: 400 })
    }

    const systemPrompt = `You are an expert email template designer and Tailwind CSS developer.
Your task is to generate or customize a responsive HTML email template styled with Tailwind CSS classes based on the user's instructions (prompt).

RULES:
1. Return the COMPLETE, valid, and fully-formed HTML document. Do not truncate it, do not include markdown block syntax like \`\`\`html or conversational text before/after. Return ONLY the HTML code.
2. The template MUST be responsive, clean, and styled beautifully using modern CSS (Tailwind classes).
3. If an existing template is provided as context, customize and rewrite it based on the user's instructions.
4. If no existing template is provided, design a fresh template from scratch matching the prompt.
5. Keep placeholders (like {{first_name}}, {{company}}, etc.) where appropriate.
6. Return only the valid HTML document.`

    const userPrompt = templateHtml 
      ? `ORIGINAL TEMPLATE TO CUSTOMIZE:\n${templateHtml}\n\nUSER INSTRUCTIONS:\n${prompt}\n\nReturn the customized HTML document code.`
      : `USER INSTRUCTIONS FOR NEW TEMPLATE:\n${prompt}\n\nGenerate the complete HTML template code from scratch.`

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
        temperature: 0.3,
        max_tokens: 3000
      })
    })

    const data = await response.json()
    if (response.status !== 200 || data.error) {
      console.error('[Template Gen OpenAI Error]', data.error || data)
      return NextResponse.json({
        error: data.error?.message || 'OpenAI API call failed'
      }, { status: response.status || 500 })
    }

    let customizedHtml = data.choices?.[0]?.message?.content || ''
    
    // Clean up any markdown code block wraps if the AI ignored instructions
    if (customizedHtml.includes('```html')) {
      customizedHtml = customizedHtml.split('```html')[1].split('```')[0].trim()
    } else if (customizedHtml.includes('```')) {
      customizedHtml = customizedHtml.split('```')[1].split('```')[0].trim()
    }

    return NextResponse.json({ customizedHtml })
  } catch (error: any) {
    console.error('[Template Gen API] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
