import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { verifyOrgAccess } from '@/lib/api-auth-helper'
import { validateWorkflow } from '@/lib/flows/flow-graph'
import { createStarterWorkflow, sanitizeWorkflowGraph, getTriggerSummary } from '@/lib/flows/flow-templates'

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

    const authResult = await verifyOrgAccess(request, orgId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseClient()
    const { data: workflows, error } = await supabase
      .from('whatsapp_workflows')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })

    if (error) throw error

    // Fetch active session counts for each workflow
    const workflowIds = (workflows || []).map((w: any) => w.id)
    let sessionCounts: Record<string, number> = {}
    
    if (workflowIds.length > 0) {
      const { data: sessions } = await supabase
        .from('flow_sessions')
        .select('workflow_id')
        .in('workflow_id', workflowIds)
        .eq('status', 'IN_PROGRESS')

      if (sessions) {
        sessions.forEach((s: any) => {
          sessionCounts[s.workflow_id] = (sessionCounts[s.workflow_id] || 0) + 1
        })
      }
    }

    const enrichedWorkflows = (workflows || []).map((w: any) => ({
      ...w,
      active_sessions_count: sessionCounts[w.id] || 0,
    }))

    return NextResponse.json({ workflows: enrichedWorkflows })
  } catch (error: any) {
    console.error('[Flows GET] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { organizationId, name, description, trigger_config, canvas_nodes, canvas_edges } = body

    if (!organizationId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, organizationId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Flow name is required' }, { status: 400 })
    }

    const supabase = getSupabaseClient()

    // A blank flow starts from a complete, valid starter; a supplied graph is cleaned up first
    const supplied = Array.isArray(canvas_nodes) && canvas_nodes.length > 0
    const graph = supplied
      ? sanitizeWorkflowGraph(canvas_nodes, canvas_edges)
      : createStarterWorkflow(Array.isArray(trigger_config?.keywords) && trigger_config.keywords.length ? trigger_config.keywords : undefined)

    const insertPayload: Record<string, any> = {
      organization_id: organizationId,
      name: String(name).trim().slice(0, 120),
      description: typeof description === 'string' && description.trim() ? description.trim().slice(0, 500) : null,
      is_active: false,
      ...getTriggerSummary(graph.canvas_nodes),
      canvas_nodes: graph.canvas_nodes,
      canvas_edges: graph.canvas_edges,
      execution_count: 0,
      fallback_settings: {
        rag_enabled: true,
        max_ai_turns: 3,
        auto_resume_prompt: true,
      },
    }

    let { data: newWorkflow, error } = await supabase
      .from('whatsapp_workflows')
      .insert([insertPayload])
      .select()
      .single()

    // If cache error on fallback_settings, retry without it
    if (error && error.message?.includes('fallback_settings')) {
      delete insertPayload.fallback_settings
      const retry = await supabase
        .from('whatsapp_workflows')
        .insert([insertPayload])
        .select()
        .single()
      newWorkflow = retry.data
      error = retry.error
    }

    if (error) throw error

    return NextResponse.json({
      workflow: newWorkflow,
      // What still has to be fixed in the builder before this flow can go live
      validationErrors: validateWorkflow(graph.canvas_nodes, graph.canvas_edges),
    }, { status: 201 })
  } catch (error: any) {
    console.error('[Flows POST] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
