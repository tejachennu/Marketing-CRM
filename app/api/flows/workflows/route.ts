import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { verifyOrgAccess } from '@/lib/api-auth-helper'
import { validateWorkflow } from '@/lib/flows/flow-graph'
import { createStarterWorkflow, sanitizeWorkflowGraph, getTriggerSummary, suggestKeywords } from '@/lib/flows/flow-templates'

/** A conversation counts as in progress while its session is open and the customer answered within the day. */
const OPEN_STATUSES = ['IN_PROGRESS', 'PAUSED_RAG']
const IN_PROGRESS_WINDOW_MS = 24 * 60 * 60 * 1000

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

/** Open sessions per workflow, counted in the database rather than by reading every row (PostgREST caps a read at 1000). */
async function countConversationsInProgress(supabase: any, orgId: string, workflowIds: string[]): Promise<Record<string, number>> {
  const since = new Date(Date.now() - IN_PROGRESS_WINDOW_MS).toISOString()
  const counts = await Promise.all(workflowIds.map(async (workflowId): Promise<[string, number]> => {
    const { count, error } = await supabase.from('flow_sessions').select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId).eq('workflow_id', workflowId).in('status', OPEN_STATUSES).gte('last_interaction_at', since)
    if (error) {
      // The list is still useful without this number
      console.warn(`[Flows GET] Could not count the conversations of workflow ${workflowId}:`, error.message)
      return [workflowId, 0]
    }
    return [workflowId, count ?? 0]
  }))
  return Object.fromEntries(counts)
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

    const workflowIds = (workflows || []).map((w: any) => w.id)
    const sessionCounts = workflowIds.length ? await countConversationsInProgress(supabase, orgId, workflowIds) : {}

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

    const authResult = await verifyOrgAccess(request, organizationId, { permission: 'automation.manage' })
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Flow name is required' }, { status: 400 })
    }

    const supabase = getSupabaseClient()
    const flowName = String(name).trim().slice(0, 120)

    // Keywords of the caller's choosing, or else ones taken from the flow's name: two flows that both
    // start on "hi" would fight over every greeting, with the older one silently winning
    const chosenKeywords: string[] = Array.isArray(trigger_config?.keywords)
      ? [...new Set(trigger_config.keywords.map((keyword: unknown) => String(keyword ?? '').trim().slice(0, 50)).filter(Boolean))].slice(0, 20) as string[]
      : []
    const keywords = chosenKeywords.length ? chosenKeywords : suggestKeywords(flowName)
    // A blank flow starts from a complete, valid starter; a supplied graph is cleaned up first
    const supplied = Array.isArray(canvas_nodes) && canvas_nodes.length > 0
    const graph = supplied ? sanitizeWorkflowGraph(canvas_nodes, canvas_edges, { keywords }) : createStarterWorkflow(keywords)

    const insertPayload: Record<string, any> = {
      organization_id: organizationId,
      name: flowName,
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
