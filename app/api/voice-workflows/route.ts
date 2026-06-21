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

    if (!orgId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    const supabase = getSupabaseClient()
    const { data, error } = await supabase
      .from('voice_workflows')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return NextResponse.json({ workflows: data || [] })
  } catch (error: any) {
    console.error('[Voice Workflows GET] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseClient()
    const body = await request.json()
    const { organizationId, name, description, steps } = body

    if (!organizationId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }
    if (!name) {
      return NextResponse.json({ error: 'Missing name' }, { status: 400 })
    }

    // Default template step if none provided
    const initialSteps = steps || [
      {
        id: 'start',
        type: 'say',
        text: 'Welcome to our company voice directory.',
        next_step: 'menu'
      },
      {
        id: 'menu',
        type: 'gather',
        prompt: 'Press 1 to transfer to support. Press 2 to leave a voicemail.',
        numDigits: 1,
        timeout: 5,
        routes: {
          '1': { type: 'dial', phoneNumber: '+1234567890' },
          '2': { type: 'record', text: 'Please speak after the tone. Press pound when finished.', next_step: 'goodbye' }
        }
      },
      {
        id: 'goodbye',
        type: 'say',
        text: 'Thank you for your message. Goodbye.',
        next_step: null
      }
    ]

    const { data, error } = await supabase
      .from('voice_workflows')
      .insert([{
        organization_id: organizationId,
        name,
        description: description || '',
        steps: initialSteps,
        is_active: false
      }])
      .select()

    if (error) throw error
    return NextResponse.json({ workflow: data[0] })
  } catch (error: any) {
    console.error('[Voice Workflows POST] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = getSupabaseClient()
    const body = await request.json()
    const { id, name, description, steps, isActive } = body

    if (!id) {
      return NextResponse.json({ error: 'Missing workflow ID' }, { status: 400 })
    }

    // 1. Fetch current workflow to know the organization_id if we need to toggle active
    const { data: current, error: getErr } = await supabase
      .from('voice_workflows')
      .select('organization_id')
      .eq('id', id)
      .single()

    if (getErr || !current) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Update object
    const updateData: any = {}
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (steps !== undefined) updateData.steps = steps
    if (isActive !== undefined) updateData.is_active = isActive

    updateData.updated_at = new Date().toISOString()

    // If setting active, reset all other workflows for this organization
    if (isActive === true) {
      const { error: resetError } = await supabase
        .from('voice_workflows')
        .update({ is_active: false })
        .eq('organization_id', current.organization_id)

      if (resetError) throw resetError
    }

    const { data, error } = await supabase
      .from('voice_workflows')
      .update(updateData)
      .eq('id', id)
      .select()

    if (error) throw error
    return NextResponse.json({ workflow: data[0] })
  } catch (error: any) {
    console.error('[Voice Workflows PUT] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing workflow ID' }, { status: 400 })
    }

    const supabase = getSupabaseClient()
    const { error } = await supabase
      .from('voice_workflows')
      .delete()
      .eq('id', id)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[Voice Workflows DELETE] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
