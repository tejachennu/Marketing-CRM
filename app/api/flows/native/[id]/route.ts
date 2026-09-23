import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { verifyRecordAccess } from '@/lib/api-auth-helper'
import { compileMetaFlowJSON } from '@/lib/flows/meta-flows-spec'

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
      return NextResponse.json({ error: 'Missing flow ID' }, { status: 400 })
    }

    const authResult = await verifyRecordAccess(request, 'whatsapp_native_flows', id)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseClient()
    const { data: flow, error } = await supabase
      .from('whatsapp_native_flows')
      .select('*')
      .eq('id', id)
      .single()

    if (error) throw error

    // Fetch submissions for this native flow
    const { data: submissions } = await supabase
      .from('flow_submissions')
      .select('*')
      .eq('native_flow_id', id)
      .order('created_at', { ascending: false })
      .limit(50)

    return NextResponse.json({
      flow,
      submissions: submissions || [],
    })
  } catch (error: any) {
    console.error('[Native Flow GET ID] Error:', error)
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
      return NextResponse.json({ error: 'Missing flow ID' }, { status: 400 })
    }

    const authResult = await verifyRecordAccess(request, 'whatsapp_native_flows', id)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const body = await request.json()
    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    }

    if (body.name !== undefined) updatePayload.name = body.name.trim()
    if (body.status !== undefined) updatePayload.status = body.status
    if (body.categories !== undefined) updatePayload.categories = body.categories
    if (body.meta_flow_id !== undefined) updatePayload.meta_flow_id = body.meta_flow_id

    if (body.screens !== undefined) {
      updatePayload.screens = body.screens
      try {
        updatePayload.flow_json = compileMetaFlowJSON(body.screens)
      } catch (compileErr: any) {
        return NextResponse.json({ error: `Schema compilation error: ${compileErr.message}` }, { status: 400 })
      }
    }

    const supabase = getSupabaseClient()
    const { data: updated, error } = await supabase
      .from('whatsapp_native_flows')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ flow: updated })
  } catch (error: any) {
    console.error('[Native Flow PUT ID] Error:', error)
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
      return NextResponse.json({ error: 'Missing flow ID' }, { status: 400 })
    }

    const authResult = await verifyRecordAccess(request, 'whatsapp_native_flows', id)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseClient()
    const { error } = await supabase
      .from('whatsapp_native_flows')
      .delete()
      .eq('id', id)

    if (error) throw error

    return NextResponse.json({ success: true, deletedId: id })
  } catch (error: any) {
    console.error('[Native Flow DELETE ID] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
