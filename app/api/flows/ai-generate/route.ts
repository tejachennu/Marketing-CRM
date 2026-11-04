import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { verifyOrgAccess } from '@/lib/api-auth-helper'
import { checkRateLimit } from '@/lib/rate-limiter'
import { validateWorkflow } from '@/lib/flows/flow-graph'
import { createStarterWorkflow, sanitizeWorkflowGraph } from '@/lib/flows/flow-templates'

/** Enough to describe a flow step by step; longer prompts mostly cost tokens without improving the graph. */
const MAX_PROMPT_LENGTH = 2000
const OPENAI_TIMEOUT_MS = 45_000
const MAX_COMPLETION_TOKENS = 4000
// Each generation is a paid AI call: a few per person, and a bounded total per organization
const PER_USER = { limit: 10, windowMs: 10 * 60 * 1000 }
const PER_ORGANIZATION = { limit: 60, windowMs: 60 * 60 * 1000 }

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
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const { organizationId } = body
    const prompt: string = typeof body.prompt === 'string' ? body.prompt : ''

    if (!organizationId || !prompt.trim()) {
      return NextResponse.json({ error: 'Missing organizationId or prompt' }, { status: 400 })
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return NextResponse.json({ error: `Describe the flow in at most ${MAX_PROMPT_LENGTH} characters` }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, organizationId, { permission: 'automation.manage' })
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const perUser = checkRateLimit(`flows:ai-generate:user:${authResult.user?.id || 'anonymous'}`, PER_USER.limit, PER_USER.windowMs)
    const perOrganization = perUser.allowed ? checkRateLimit(`flows:ai-generate:org:${organizationId}`, PER_ORGANIZATION.limit, PER_ORGANIZATION.windowMs) : perUser
    if (!perUser.allowed || !perOrganization.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil((perUser.allowed ? perOrganization : perUser).retryAfterMs / 1000))
      return NextResponse.json({ error: 'Too many flow generations right now. Please wait a few minutes and try again.' }, { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } })
    }

    const supabase = getSupabaseClient()
    const { data: orgData } = await supabase
      .from('organizations')
      .select('name, openai_api_key')
      .eq('id', organizationId)
      .single()

    const apiKey = orgData?.openai_api_key || process.env.OPENAI_API_KEY

    // Without an AI key there is nothing to generate from; hand back the standard starter flow
    // and say so, instead of presenting a canned graph as if it were written for the prompt.
    if (!apiKey) {
      const starter = createStarterWorkflow()
      return NextResponse.json({
        flow: {
          name: prompt.trim().slice(0, 60),
          description: `Starter flow for: ${prompt.trim().slice(0, 200)}`,
          ...starter,
        },
        generatedByAi: false,
        notice: 'No AI key is configured in Settings, so this is the standard starter flow. Edit it in the builder.',
        validationErrors: validateWorkflow(starter.canvas_nodes, starter.canvas_edges),
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
      "type": "trigger" | "message" | "interactive_buttons" | "list_menu" | "native_flow_trigger" | "ai_rag_node" | "crm_deal_action" | "ticket_action" | "assign_agent_action" | "condition_branch" | "set_variable" | "tag_action",
      "position": { "x": number, "y": number },
      "data": { ...properties matching the type }
    }
  ],
  "canvas_edges": [
    { "id": "edge_1", "source": "node_1", "target": "node_2", "sourceHandle": "optional button id" }
  ]
}

Available Node Types:
1. "trigger": data: { title, trigger_type: 'keyword', keywords: string[], match_mode: 'contains' | 'exact' }. Use exactly one trigger.
2. "message": data: { title, body: string }
3. "interactive_buttons": data: { title, body: string, buttons: [{ id: string, title: string }] }
4. "native_flow_trigger": data: { title, cta_text: string }
5. "ai_rag_node": data: { title, system_prompt: string, enable_auto_resume: true, max_turns: 3 }
6. "crm_deal_action": data: { title, pipeline_stage: string, deal_name: string, monetary_value?: number }
7. "ticket_action": data: { title, subject: string, priority: 'low'|'medium'|'high' }
8. "assign_agent_action": data: { title, assignmentType: 'team_queue' | 'round_robin' }. Hands the chat to a person (the shared queue, or teammates in turn) and ends the workflow.
9. "list_menu": data: { title, body: string, button_text: string, sections: [{ title, rows: [{ id, title }] }] }. Up to 10 rows, titles of at most 24 characters, one edge per row using sourceHandle equal to the row id.
10. "set_variable": data: { title, variable_name: string, value_expression: string, value_type: 'text'|'number'|'boolean' }
11. "tag_action": data: { title, action: 'add'|'remove', tags: string[] }

Position nodes cleanly in horizontal left-to-right columns (x: 100, 420, 740, 1060, etc.) with y spaced 100-300 apart.
Every button must have a connected edge using sourceHandle equal to its ID. Use at most 3 buttons, each with a title of at most 20 characters.
An ai_rag_node ends the workflow and delegates the current message to the real knowledge assistant. It cannot resume another step.
For condition_branch use data { title, variable_name, operator, compare_value }, with operator equals, not_equals, contains, greater_than, less_than, or is_set and edges with sourceHandle "true" and "false".
Use {{form.field_name}} to reference native form answers. A native_flow_trigger needs an existing native_flow_id selected by the user; never invent a form ID.
Do not generate delay, webhook or notification actions: they are not supported. Avoid automatic loops.
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
        max_tokens: MAX_COMPLETION_TOKENS,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    })

    if (!openAiRes.ok) {
      const errText = await openAiRes.text()
      console.warn('[AI Generate Flow] OpenAI error:', errText)
      throw new Error(openAiRes.status === 401 ? 'The AI key in Settings was rejected. Check it and try again.' : 'The AI service is unavailable right now. Please try again.')
    }

    const aiData = await openAiRes.json()
    const content = aiData.choices?.[0]?.message?.content || '{}'
    let parsed: Record<string, any>
    try {
      parsed = JSON.parse(content)
    } catch {
      throw new Error('The AI returned an unreadable flow. Please try again.')
    }

    // Never trust the model's graph as-is: drop unknown blocks and dangling connections
    const graph = sanitizeWorkflowGraph(parsed.canvas_nodes, parsed.canvas_edges)
    if (graph.canvas_nodes.length < 2) {
      throw new Error('The AI could not build a flow from that description. Try describing the steps in more detail.')
    }

    return NextResponse.json({
      flow: {
        name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim().slice(0, 120) : `Generated flow: ${prompt.slice(0, 30)}`,
        description: typeof parsed.description === 'string' && parsed.description.trim() ? parsed.description.trim().slice(0, 500) : prompt.trim().slice(0, 500),
        ...graph,
      },
      generatedByAi: true,
      validationErrors: validateWorkflow(graph.canvas_nodes, graph.canvas_edges),
    })
  } catch (error: any) {
    // The timeout signal rejects with a TimeoutError (an AbortError on older runtimes)
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      console.error('[AI Flow Generator] OpenAI did not answer within the time limit')
      return NextResponse.json({ error: 'The AI took too long to answer. Please try again.' }, { status: 504 })
    }
    console.error('[AI Flow Generator] Error:', error)
    return NextResponse.json({ error: error.message || 'Failed to generate flow' }, { status: 500 })
  }
}
