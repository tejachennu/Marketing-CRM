import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { verifyOrgAccess } from '@/lib/api-auth-helper'
import { WorkflowNode, WorkflowEdge } from '@/lib/flows/flow-types'

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
    const { organizationId, name, description, trigger_type, trigger_config, canvas_nodes, canvas_edges, template_id } = body

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

    // Default starter canvas nodes & edges if not provided
    let nodes: WorkflowNode[] = canvas_nodes
    let edges: WorkflowEdge[] = canvas_edges

    if (!nodes || nodes.length === 0) {
      nodes = [
        {
          id: 'node-trigger-1',
          type: 'trigger',
          position: { x: 100, y: 180 },
          data: {
            title: 'Customer Message Trigger',
            trigger_type: trigger_type || 'keyword',
            keywords: trigger_config?.keywords || ['hi', 'hello', 'start', 'pricing'],
            match_mode: 'fuzzy',
          },
        },
        {
          id: 'node-msg-welcome',
          type: 'message',
          position: { x: 420, y: 180 },
          data: {
            title: 'Welcome Message',
            body: 'Hello {{contact.name}}! 👋 Welcome to our interactive assistant. How can we help you today?',
          },
        },
        {
          id: 'node-btn-menu',
          type: 'interactive_buttons',
          position: { x: 740, y: 180 },
          data: {
            title: 'Action Menu',
            body: 'Please choose an option below to proceed immediately:',
            buttons: [
              { id: 'btn_qualify', title: '📋 Get Quote' },
              { id: 'btn_support', title: '🛠️ Talk to Support' },
              { id: 'btn_faq', title: '❓ Ask a Question' },
            ],
          },
        },
      ]

      edges = [
        {
          id: 'edge-1-2',
          source: 'node-trigger-1',
          target: 'node-msg-welcome',
        },
        {
          id: 'edge-2-3',
          source: 'node-msg-welcome',
          target: 'node-btn-menu',
        },
      ]
    }

    const insertPayload: Record<string, any> = {
      organization_id: organizationId,
      name: name.trim(),
      description: description?.trim() || null,
      is_active: false,
      trigger_type: trigger_type || 'keyword',
      trigger_config: trigger_config || { keywords: ['hi', 'hello', 'start'] },
      canvas_nodes: nodes,
      canvas_edges: edges,
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

    return NextResponse.json({ workflow: newWorkflow }, { status: 201 })
  } catch (error: any) {
    console.error('[Flows POST] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
