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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { organizationId, prompt } = body

    if (!organizationId || !prompt?.trim()) {
      return NextResponse.json({ error: 'Missing organizationId or prompt' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, organizationId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseClient()
    const { data: orgData } = await supabase
      .from('organizations')
      .select('name, openai_api_key')
      .eq('id', organizationId)
      .single()

    const apiKey = orgData?.openai_api_key || process.env.OPENAI_API_KEY

    // Pre-computed dynamic layout fallback if OpenAI key is not configured
    if (!apiKey) {
      const fallbackNodes: WorkflowNode[] = [
        {
          id: 'ai-node-1',
          type: 'trigger',
          position: { x: 100, y: 200 },
          data: {
            title: 'Keyword Trigger',
            trigger_type: 'keyword',
            keywords: ['start', 'inquire', 'info', 'book', 'demo'],
            match_mode: 'fuzzy',
          },
        },
        {
          id: 'ai-node-2',
          type: 'message',
          position: { x: 420, y: 200 },
          data: {
            title: 'AI Welcome Greeting',
            body: `Hi there! 👋 Welcome to ${orgData?.name || 'our service'}. We generated this custom flow for: "${prompt.slice(0, 40)}..."`,
          },
        },
        {
          id: 'ai-node-3',
          type: 'interactive_buttons',
          position: { x: 740, y: 200 },
          data: {
            title: 'Choose Next Action',
            body: 'How would you like to proceed?',
            buttons: [
              { id: 'btn_schedule', title: '📅 Schedule Now' },
              { id: 'btn_advisor', title: '💬 Chat with Advisor' },
              { id: 'btn_faq', title: '❓ Ask a Question' },
            ],
          },
        },
        {
          id: 'ai-node-4',
          type: 'ai_rag_node',
          position: { x: 1060, y: 320 },
          data: {
            title: 'AI RAG Knowledge Fallback',
            system_prompt: 'Answer inquiries using company knowledge base FAQs, then prompt the user to continue.',
            faq_collections: ['general', 'pricing', 'support'],
            enable_auto_resume: true,
            max_turns: 3,
          },
        },
        {
          id: 'ai-node-5',
          type: 'crm_deal_action',
          position: { x: 1060, y: 120 },
          data: {
            title: 'Create Deal in Pipeline',
            pipeline_stage: 'lead_in',
            deal_name: 'Inquiry from {{contact.name}}',
            monetary_value: 500,
          },
        },
      ]

      const fallbackEdges: WorkflowEdge[] = [
        { id: 'e-1-2', source: 'ai-node-1', target: 'ai-node-2' },
        { id: 'e-2-3', source: 'ai-node-2', target: 'ai-node-3' },
        { id: 'e-3-4', source: 'ai-node-3', target: 'ai-node-4', sourceHandle: 'btn_faq' },
        { id: 'e-3-5', source: 'ai-node-3', target: 'ai-node-5', sourceHandle: 'btn_schedule' },
        { id: 'e-3-advisor', source: 'ai-node-3', target: 'ai-node-4', sourceHandle: 'btn_advisor' },
      ]

      return NextResponse.json({
        flow: {
          name: `AI Flow: ${prompt.slice(0, 32)}`,
          description: `Auto-generated conversational graph for: ${prompt}`,
          canvas_nodes: fallbackNodes,
          canvas_edges: fallbackEdges,
        },
      })
    }

    // Call OpenAI to generate custom graph
    const systemPrompt = `You are an expert conversational UI architect designing WhatsApp Workflows.
A user will describe a business use case. You must return a JSON object with:
{
  "name": "Short descriptive name",
  "description": "One sentence summary",
  "canvas_nodes": [
    {
      "id": "node_1",
      "type": "trigger" | "message" | "interactive_buttons" | "native_flow_trigger" | "ai_rag_node" | "crm_deal_action" | "ticket_action" | "condition_branch",
      "position": { "x": number, "y": number },
      "data": { ...properties matching the type }
    }
  ],
  "canvas_edges": [
    { "id": "edge_1", "source": "node_1", "target": "node_2", "sourceHandle": "optional button id" }
  ]
}

Available Node Types:
1. "trigger": data: { title, trigger_type: 'keyword', keywords: string[], match_mode: 'fuzzy' }
2. "message": data: { title, body: string }
3. "interactive_buttons": data: { title, body: string, buttons: [{ id: string, title: string }] }
4. "native_flow_trigger": data: { title, cta_text: string, flow_token: string }
5. "ai_rag_node": data: { title, system_prompt: string, enable_auto_resume: true, max_turns: 3 }
6. "crm_deal_action": data: { title, pipeline_stage: string, deal_name: string, monetary_value?: number }
7. "ticket_action": data: { title, subject: string, priority: 'low'|'medium'|'high' }

Position nodes cleanly in horizontal left-to-right columns (x: 100, 420, 740, 1060, etc.) with y spaced 100-300 apart.
Every button must have a connected edge using sourceHandle equal to its ID. Use at most 3 buttons, each with a title of at most 20 characters.
An ai_rag_node ends the workflow and delegates the current message to the real knowledge assistant. It cannot resume another step.
For condition_branch use data { title, variable_name, operator, compare_value }, with operator equals, not_equals, contains, greater_than, less_than, or is_set and edges with sourceHandle "true" and "false".
Use {{form.field_name}} to reference native form answers. A native_flow_trigger needs an existing native_flow_id selected by the user; never invent a form ID.
Do not generate unsupported delay or webhook actions. Avoid automatic loops.
Return ONLY valid JSON without markdown fences.`

    const openAiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    })

    if (!openAiRes.ok) {
      const errText = await openAiRes.text()
      console.warn('[AI Generate Flow] OpenAI error:', errText)
      throw new Error(`OpenAI error: ${openAiRes.statusText}`)
    }

    const aiData = await openAiRes.json()
    const content = aiData.choices?.[0]?.message?.content || '{}'
    const parsed = JSON.parse(content)

    return NextResponse.json({
      flow: {
        name: parsed.name || `Generated Flow: ${prompt.slice(0, 30)}`,
        description: parsed.description || prompt,
        canvas_nodes: parsed.canvas_nodes || [],
        canvas_edges: parsed.canvas_edges || [],
      },
    })
  } catch (error: any) {
    console.error('[AI Flow Generator] Error:', error)
    return NextResponse.json({ error: error.message || 'Failed to generate flow' }, { status: 500 })
  }
}
