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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'Missing workflow ID' }, { status: 400 })
    }

    const authResult = await verifyRecordAccess(request, 'whatsapp_workflows', id)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseClient()
    const { data: workflow, error } = await supabase
      .from('whatsapp_workflows')
      .select('*')
      .eq('id', id)
      .single()

    if (error) throw error

    // Fetch related active sessions & submissions count
    const [sessionsRes, submissionsRes] = await Promise.all([
      supabase.from('flow_sessions').select('id, status, created_at, updated_at, contact_phone').eq('workflow_id', id).order('updated_at', { ascending: false }).limit(20),
      supabase.from('flow_submissions').select('id, created_at, contact_phone, submission_data').eq('workflow_id', id).order('created_at', { ascending: false }).limit(20),
    ])

    return NextResponse.json({
      workflow,
      recentSessions: sessionsRes.data || [],
      recentSubmissions: submissionsRes.data || [],
    })
  } catch (error: any) {
    console.error('[Flows GET ID] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'Missing workflow ID' }, { status: 400 })
    }

    const authResult = await verifyRecordAccess(request, 'whatsapp_workflows', id)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const body = await request.json()
    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    }

    if (body.name !== undefined) updatePayload.name = body.name.trim()
    if (body.description !== undefined) updatePayload.description = body.description
    if (body.is_active !== undefined) updatePayload.is_active = Boolean(body.is_active)
    if (body.trigger_type !== undefined) updatePayload.trigger_type = body.trigger_type
    if (body.trigger_config !== undefined) updatePayload.trigger_config = body.trigger_config
    if (body.canvas_nodes !== undefined) updatePayload.canvas_nodes = body.canvas_nodes
    if (body.canvas_edges !== undefined) updatePayload.canvas_edges = body.canvas_edges
    if (body.fallback_settings !== undefined) updatePayload.fallback_settings = body.fallback_settings

    const supabase = getSupabaseClient()
    const { data: updated, error } = await supabase
      .from('whatsapp_workflows')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ workflow: updated })
  } catch (error: any) {
    console.error('[Flows PUT ID] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'Missing workflow ID' }, { status: 400 })
    }

    const authResult = await verifyRecordAccess(request, 'whatsapp_workflows', id)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseClient()
    const { error } = await supabase
      .from('whatsapp_workflows')
      .delete()
      .eq('id', id)

    if (error) throw error

    return NextResponse.json({ success: true, deletedId: id })
  } catch (error: any) {
    console.error('[Flows DELETE ID] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
