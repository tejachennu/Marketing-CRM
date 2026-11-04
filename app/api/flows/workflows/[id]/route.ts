import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getWorkflowReadiness } from '@/lib/flows/flow-readiness'
import { verifyRecordAccess } from '@/lib/api-auth-helper'
import { can } from '@/lib/rbac'
import { getTriggerSummary } from '@/lib/flows/flow-templates'
import { validateWorkflow } from '@/lib/flows/flow-graph'
import { isMissingColumnError } from '@/lib/flows/flow-executor'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

/**
 * Readiness problems the builder cannot work out for itself: WhatsApp credentials, forms not
 * yet published, missing pipeline stages. Problems with the graph are validated live in the browser.
 */
function withoutGraphErrors(readinessErrors: string[], workflow: { canvas_nodes: any; canvas_edges: any }): string[] {
  const graphErrors = new Set(validateWorkflow(workflow.canvas_nodes, workflow.canvas_edges))
  return readinessErrors.filter(error => !graphErrors.has(error))
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

    // Fetch related active sessions & submissions count. Customers' phones and answers need the
    // same permission as /api/flows/submissions; without it only run failures are shown.
    const canViewResponses = can(authResult.user, 'records.view_all')
    const [sessionsRes, submissionsRes, stagesRes, organizationRes] = await Promise.all([
      supabase.from('flow_sessions').select('id, status, created_at, last_interaction_at, contact_phone, current_node_id, state_data').eq('workflow_id', id).order('last_interaction_at', { ascending: false }).limit(20),
      canViewResponses ? supabase.from('flow_submissions').select('id, created_at, contact_phone, response_payload').eq('workflow_id', id).order('created_at', { ascending: false }).limit(20) : { data: [], error: null },
      supabase.from('pipeline_stages').select('id,name').eq('organization_id', workflow.organization_id).order('position'),
      // The test panel fills in {{org.name}} with it
      supabase.from('organizations').select('name').eq('id', workflow.organization_id).maybeSingle(),
    ])

    if (sessionsRes.error) throw sessionsRes.error
    if (submissionsRes.error) throw submissionsRes.error
    if (stagesRes.error) throw stagesRes.error
    if (organizationRes.error) throw organizationRes.error
    const readinessErrors = await getWorkflowReadiness(supabase, workflow)
    return NextResponse.json({
      workflow,
      organizationName: organizationRes.data?.name || null,
      readinessErrors,
      environmentErrors: withoutGraphErrors(readinessErrors, workflow),
      pipelineStages: stagesRes.data || [],
      recentSessions: canViewResponses ? sessionsRes.data || [] : (sessionsRes.data || []).map(({ contact_phone, state_data, ...session }) => ({ ...session, state_data: { _last_error: state_data?._last_error } })),
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

    const authResult = await verifyRecordAccess(request, 'whatsapp_workflows', id, { permission: 'automation.manage' })
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const body = await request.json()
    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    }

    if (body.name !== undefined) {
      const name = String(body.name).trim()
      if (!name) return NextResponse.json({ error: 'Flow name is required' }, { status: 400 })
      updatePayload.name = name.slice(0, 120)
    }
    if (body.description !== undefined) updatePayload.description = body.description
    if (body.is_active !== undefined) updatePayload.is_active = Boolean(body.is_active)
    if (body.canvas_nodes !== undefined) updatePayload.canvas_nodes = body.canvas_nodes
    if (body.canvas_edges !== undefined) updatePayload.canvas_edges = body.canvas_edges
    if (body.fallback_settings !== undefined) updatePayload.fallback_settings = body.fallback_settings
    // The trigger node is the source of truth; the summary columns only mirror it for list views
    if (Array.isArray(body.canvas_nodes)) Object.assign(updatePayload, getTriggerSummary(body.canvas_nodes))
    // Going live again clears the note the runtime left when it paused the flow
    if (updatePayload.is_active === true) Object.assign(updatePayload, { paused_reason: null, paused_at: null })

    const supabase = getSupabaseClient()
    const { data: existing, error: loadError } = await supabase.from('whatsapp_workflows').select('*').eq('id', id).single()
    if (loadError) throw loadError
    const candidate = { ...existing, ...updatePayload }
    if (!Array.isArray(candidate.canvas_nodes) || !Array.isArray(candidate.canvas_edges)) return NextResponse.json({ error: 'Nodes and connections must be arrays' }, { status: 400 })
    const readinessErrors = await getWorkflowReadiness(supabase, candidate)
    if (candidate.is_active && readinessErrors.length) return NextResponse.json({ error: 'Fix the following issues before activating this flow', validationErrors: readinessErrors, environmentErrors: withoutGraphErrors(readinessErrors, candidate) }, { status: 422 })
    const save = () => supabase.from('whatsapp_workflows').update(updatePayload).eq('id', id).select().single()
    let { data: updated, error } = await save()
    // Before migration 20261104_workflows_pause_reason those columns do not exist; the activation itself still goes through
    if (error && 'paused_reason' in updatePayload && isMissingColumnError(error, 'paused_reason', 'paused_at')) {
      delete updatePayload.paused_reason
      delete updatePayload.paused_at
      ;({ data: updated, error } = await save())
    }

    if (error) throw error

    return NextResponse.json({ workflow: updated, readinessErrors, environmentErrors: withoutGraphErrors(readinessErrors, candidate) })
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

    const authResult = await verifyRecordAccess(request, 'whatsapp_workflows', id, { permission: 'automation.manage' })
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
