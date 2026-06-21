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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('organizationId')
    const type = searchParams.get('type') || 'calls' // 'calls' or 'settings'

    if (!orgId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    const supabase = getSupabaseClient()

    if (type === 'settings') {
      const { data, error } = await supabase
        .from('organizations')
        .select('ai_realtime_prompt, ai_realtime_variables')
        .eq('id', orgId)
        .single()

      if (error) throw error
      return NextResponse.json({ settings: data })
    } else {
      // List calls
      const { data, error } = await supabase
        .from('live_stream_calls')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return NextResponse.json({ calls: data || [] })
    }
  } catch (error: any) {
    console.error('[AI Realtime GET] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseClient()
    const body = await request.json()
    const { organizationId, customPrompt, variables } = body

    if (!organizationId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    // Process variables
    let varArray: string[] = []
    if (Array.isArray(variables)) {
      varArray = variables.map(v => v.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')).filter(Boolean)
    } else if (typeof variables === 'string') {
      varArray = variables.split(',').map(v => v.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')).filter(Boolean)
    }

    // Update organizations table settings
    const { data, error } = await supabase
      .from('organizations')
      .update({
        ai_realtime_prompt: customPrompt,
        ai_realtime_variables: varArray
      })
      .eq('id', organizationId)
      .select()

    if (error) throw error
    return NextResponse.json({ success: true, organization: data[0] })
  } catch (error: any) {
    console.error('[AI Realtime POST] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
