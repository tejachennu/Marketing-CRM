import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { verifyRecordAccess } from '@/lib/api-auth-helper'
import { getMetaCredentials, metaRequest, uploadNativeFlow, MetaFlowError } from '@/lib/flows/meta-client'
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
    const { data: submissions, error: submissionsError } = await supabase
      .from('flow_submissions')
      .select('*')
      .eq('flow_id', id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (submissionsError) throw submissionsError
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
    const supabase = getSupabaseClient()
    const { data: existing, error: loadError } = await supabase.from('whatsapp_native_flows').select('*').eq('id', id).single()
    if (loadError) throw loadError
    if (body.meta_flow_id !== undefined || body.flow_id_meta !== undefined) return NextResponse.json({ error: 'Meta Flow IDs are assigned by the WhatsApp connection' }, { status: 400 })
    if (body.status && body.status !== existing.status) return NextResponse.json({ error: 'Use Validate or Publish to change a form status' }, { status: 400 })
    if (body.action && !['validate', 'publish'].includes(body.action)) return NextResponse.json({ error: 'Unknown form action' }, { status: 400 })
    const published = existing.status === 'PUBLISHED' && existing.flow_id_meta
    if (published && (body.screens || body.name || body.categories)) return NextResponse.json({ error: 'Published forms are immutable. Create a new form to make changes.' }, { status: 409 })
    if (published) return NextResponse.json({ flow: existing })
    const screens = body.screens ?? existing.screens
    let flowJson
    try { flowJson = compileMetaFlowJSON(screens) }
    catch (error: any) { return NextResponse.json({ error: error.message }, { status: 400 }) }
    const categories = body.categories ?? existing.categories
    const allowed = ['SIGN_UP', 'SIGN_IN', 'APPOINTMENT_BOOKING', 'LEAD_GENERATION', 'CONTACT_US', 'CUSTOMER_SUPPORT', 'SURVEY', 'OTHER']
    if (!Array.isArray(categories) || !categories.length || categories.some(category => !allowed.includes(category))) return NextResponse.json({ error: 'Select a valid form category' }, { status: 400 })
    const update: Record<string, any> = { name: (body.name ?? existing.name).trim(), categories, screens, flow_json: flowJson, status: 'DRAFT', updated_at: new Date().toISOString() }
    if (!update.name) return NextResponse.json({ error: 'Form name is required' }, { status: 400 })
    let credentials
    if (body.action || existing.flow_id_meta) {
      const { data: organization, error } = await supabase.from('organizations').select('*').eq('id', existing.organization_id).single()
      if (error) throw error
      credentials = getMetaCredentials(organization)
      // Reconcile an interrupted publish before allowing any local content edits.
      if (existing.flow_id_meta) {
        const remote = await metaRequest(credentials, `${existing.flow_id_meta}?fields=id,status`)
        if (remote.status === 'PUBLISHED') {
          const result = await supabase.from('whatsapp_native_flows').update({ status: 'PUBLISHED' }).eq('id', id).select().single()
          if (result.error) throw result.error
          return NextResponse.json({ flow: result.data, validated: true })
        }
        if (remote.status !== 'DRAFT') return NextResponse.json({ error: 'This form is no longer editable on Meta. Create a new form.' }, { status: 409 })
      }
    }
    // Save the draft before calling Meta so rejected fields remain editable.
    const saved = await supabase.from('whatsapp_native_flows').update(update).eq('id', id).select().single()
    if (saved.error) throw saved.error
    let flow = saved.data
    if (body.action) {
      const metaId = await uploadNativeFlow(credentials!, flow, flowJson, async metaId => {
        const result = await supabase.from('whatsapp_native_flows').update({ flow_id_meta: metaId }).eq('id', id)
        if (result.error) throw result.error
        flow.flow_id_meta = metaId
      })
      if (body.action === 'publish') {
        const result = await metaRequest(credentials!, `${metaId}/publish`, { method: 'POST' })
        if (result.success !== true) throw new MetaFlowError('Meta did not confirm publication')
      }
      const status = body.action === 'publish' ? 'PUBLISHED' : 'DRAFT'
      const result = await supabase.from('whatsapp_native_flows').update({ status, updated_at: new Date().toISOString() }).eq('id', id).select().single()
      if (result.error) throw result.error
      flow = result.data
    }
    return NextResponse.json({ flow, validated: Boolean(body.action) })
  } catch (error: any) {
    console.error('[Native Flow PUT ID] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error', validationErrors: error instanceof MetaFlowError ? error.details : [] }, { status: error instanceof MetaFlowError ? 422 : 500 })
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
    const { data: existing, error: loadError } = await supabase.from('whatsapp_native_flows').select('*').eq('id', id).single()
    if (loadError) throw loadError
    if (existing.status === 'PUBLISHED' && existing.flow_id_meta) return NextResponse.json({ error: 'Published forms cannot be deleted. Pause the workflows that use this form instead.' }, { status: 409 })
    const { data: linked, error: linkedError } = await supabase.from('whatsapp_workflows').select('canvas_nodes').eq('organization_id', existing.organization_id).eq('is_active', true)
    if (linkedError) throw linkedError
    if (linked?.some(workflow => workflow.canvas_nodes.some((node: any) => [node.data?.native_flow_id, node.data?.flowId, node.data?.flow_id].includes(id)))) return NextResponse.json({ error: 'Pause the workflows using this form before deleting it.' }, { status: 409 })
    if (existing.flow_id_meta) {
      const { data: organization, error } = await supabase.from('organizations').select('*').eq('id', existing.organization_id).single()
      if (error) throw error
      const result = await metaRequest(getMetaCredentials(organization), existing.flow_id_meta, { method: 'DELETE' })
      if (result.success !== true) throw new MetaFlowError('Meta did not confirm deletion')
    }
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
