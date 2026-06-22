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

// Generate embedding for a text using OpenAI text-embedding-3-small
async function generateEmbedding(text: string, apiKey: string): Promise<number[] | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text.substring(0, 8000) // Limit input to avoid token overflow
      })
    })

    if (!res.ok) {
      console.error('[Knowledge] Embedding API error:', res.status, await res.text())
      return null
    }

    const data = await res.json()
    return data.data?.[0]?.embedding || null
  } catch (err) {
    console.error('[Knowledge] Error generating embedding:', err)
    return null
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('organizationId')

    if (!orgId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    const supabase = getSupabaseClient()
    const { data, error } = await supabase
      .from('knowledge_base')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return NextResponse.json({ articles: data || [] })
  } catch (error: any) {
    console.error('[Knowledge GET] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }

    const supabase = getSupabaseClient()
    const { error } = await supabase
      .from('knowledge_base')
      .delete()
      .eq('id', id)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[Knowledge DELETE] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseClient()
    const body = await request.json()
    const { organizationId, type, title, content } = body

    if (!organizationId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    if (type !== 'manual') {
      return NextResponse.json({ error: 'Invalid type. Only "manual" FAQ entries are supported.' }, { status: 400 })
    }

    if (!title || !content) {
      return NextResponse.json({ error: 'Missing title or content' }, { status: 400 })
    }

    // Resolve OpenAI API key (organization-level or global)
    let openAiKey = process.env.OPENAI_API_KEY || ''
    try {
      const { data: orgData } = await supabase
        .from('organizations')
        .select('openai_api_key')
        .eq('id', organizationId)
        .single()
      if (orgData?.openai_api_key) {
        openAiKey = orgData.openai_api_key
      }
    } catch (e) {
      // Ignore — fall back to global key
    }

    // Generate vector embedding for the FAQ content
    let embedding: number[] | null = null
    if (openAiKey) {
      const textToEmbed = `${title}\n${content}`
      embedding = await generateEmbedding(textToEmbed, openAiKey)
      if (embedding) {
        console.log(`[Knowledge] Embedding generated for FAQ: "${title}" (${embedding.length} dimensions)`)
      } else {
        console.warn(`[Knowledge] Failed to generate embedding for FAQ: "${title}". Article will be stored without vector.`)
      }
    } else {
      console.warn('[Knowledge] No OpenAI API key available. FAQ stored without embedding.')
    }

    // Insert the FAQ article with its embedding
    const insertData: any = {
      organization_id: organizationId,
      title,
      content,
      source_url: null
    }

    // Supabase JS client doesn't natively handle vector types,
    // so we insert without embedding first, then update with raw SQL if we have one
    const { data, error } = await supabase
      .from('knowledge_base')
      .insert([insertData])
      .select()

    if (error) throw error

    // If we generated an embedding, update the row with it via RPC
    if (embedding && data && data[0]) {
      const embeddingStr = `[${embedding.join(',')}]`
      try {
        const { error: embedError } = await supabase.rpc('update_faq_embedding', {
          faq_id: data[0].id,
          new_embedding: embeddingStr
        })
        if (embedError) {
          console.warn('[Knowledge] RPC update_faq_embedding error:', embedError.message)
        }
      } catch (rpcErr) {
        console.warn('[Knowledge] RPC update_faq_embedding not available yet. Run db-migration-v13.js to enable vector embeddings.')
      }
    }

    return NextResponse.json({ article: data?.[0] || null })
  } catch (error: any) {
    console.error('[Knowledge POST] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
