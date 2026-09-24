import { createClient } from '@supabase/supabase-js'
import {
  WhatsAppWorkflow,
  WorkflowNode,
  WorkflowEdge,
  FlowSession,
} from './flow-types'


function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Missing Supabase credentials')
  return createClient(url, key)
}

export interface FlowExecutionResult {
  handled: boolean
  executedWorkflowId?: string
  workflowName?: string
  currentNodeId?: string
  actionTaken?: string
  replyMessage?: {
    type: 'text' | 'interactive_buttons' | 'native_flow'
    body: string
    buttons?: Array<{ id: string; title: string }>
    flowPayload?: Record<string, any>
  }
  isRagFallback?: boolean
  dealCreatedId?: string
  ticketCreatedId?: string
}

/**
 * Finds the starting trigger node of a workflow
 */
export function getStartNode(workflow: WhatsAppWorkflow): WorkflowNode | undefined {
  return workflow.canvas_nodes.find((n) => n.type === 'trigger')
}

/**
 * Finds outgoing edges from a specific node
 */
export function getOutgoingEdges(edges: WorkflowEdge[], nodeId: string): WorkflowEdge[] {
  return edges.filter((e) => e.source === nodeId)
}

/**
 * Finds the target node connected via a specific edge or handle
 */
export function getNextNode(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  currentNodeId: string,
  sourceHandle?: string
): WorkflowNode | undefined {
  const matchingEdge = edges.find((e) => {
    if (e.source !== currentNodeId) return false
    if (sourceHandle && e.sourceHandle) {
      return e.sourceHandle === sourceHandle
    }
    return true
  })

  if (!matchingEdge) return undefined
  return nodes.find((n) => n.id === matchingEdge.target)
}

/**
 * Interpolates dynamic variables like {{name}}, {{phone}}, {{company}},
 * and also dotted paths like {{contact.name}}, {{contact.phone}}, {{org.name}}
 */
export function interpolateVariables(template: string, state: Record<string, any>): string {
  if (!template) return ''
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, key) => {
    // Support dotted paths like contact.name
    const parts = key.split('.')
    let value: any = state
    for (const part of parts) {
      if (value === undefined || value === null) return match
      value = value[part]
    }
    return value !== undefined && value !== null ? String(value) : match
  })
}

/**
 * Helper: reads a node data field by trying camelCase first, then snake_case fallback.
 * This is critical because the canvas builder saves snake_case keys (trigger_type, body, cta_text)
 * but the TypeScript interfaces define camelCase keys (triggerType, messageText, bodyText).
 */
function readNodeField(data: Record<string, any>, ...keys: string[]): any {
  for (const key of keys) {
    if (data[key] !== undefined && data[key] !== null && data[key] !== '') {
      return data[key]
    }
  }
  return undefined
}

/**
 * Main runtime execution entrypoint:
 * Evaluates an incoming WhatsApp message against active workflows and ongoing flow sessions.
 */
export async function executeFlowRuntime({
  organizationId,
  conversationId,
  contactPhone,
  messageText,
  userInput,
  buttonPayload,
  buttonId,
  contactData = {},
  flowSubmissionData,
}: {
  organizationId: string
  conversationId?: string
  contactPhone: string
  messageText?: string
  userInput?: string
  buttonPayload?: string
  buttonId?: string
  contactData?: Record<string, any>
  flowSubmissionData?: Record<string, any>
}): Promise<FlowExecutionResult> {
  const supabase = getSupabase()
  const textInput = (messageText || userInput || '')
  const buttonInput = (buttonPayload || buttonId || '')
  const cleanInput = (buttonInput || textInput).trim().toLowerCase()

  console.log(`[FlowRuntime] Evaluating message for org=${organizationId}, phone=${contactPhone}, input="${cleanInput}"`)

  // 1. Check for an active ongoing session
  const { data: activeSession } = await supabase
    .from('flow_sessions')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('contact_phone', contactPhone)
    .eq('status', 'IN_PROGRESS')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (activeSession) {
    console.log(`[FlowRuntime] Found active session ${activeSession.id} at node ${activeSession.current_node_id}`)
    // Load the active workflow
    const { data: workflow } = await supabase
      .from('whatsapp_workflows')
      .select('*')
      .eq('id', activeSession.workflow_id)
      .eq('is_active', true)
      .maybeSingle()

    if (workflow) {
      const nodes: WorkflowNode[] = workflow.canvas_nodes || []
      const edges: WorkflowEdge[] = workflow.canvas_edges || []
      const currentNode = nodes.find((n) => n.id === activeSession.current_node_id)

      if (currentNode) {
        // Advance from current node based on user input
        let nextNode: WorkflowNode | undefined

        // If current node had buttons, check matching button
        if (currentNode.type === 'interactive_buttons') {
          const btnData = currentNode.data as any
          const buttons = btnData.buttons || []
          const matchedBtn = buttons.find(
            (b: any) => b.id?.toLowerCase() === cleanInput || b.title?.toLowerCase() === cleanInput
          )
          if (matchedBtn?.targetNodeId) {
            nextNode = nodes.find((n) => n.id === matchedBtn.targetNodeId)
          } else {
            nextNode = getNextNode(nodes, edges, currentNode.id, matchedBtn?.id)
          }
        } else {
          // Standard next step transition
          nextNode = getNextNode(nodes, edges, currentNode.id)
        }

        if (nextNode) {
          return await processNodeTransition({
            supabase,
            workflow,
            session: activeSession,
            targetNode: nextNode,
            contactPhone,
            conversationId,
            userInput: textInput,
            stateData: { ...activeSession.state_data, ...contactData, last_input: textInput },
          })
        } else {
          console.log(`[FlowRuntime] No next node found from ${currentNode.id}, session may be at terminal node`)
        }
      }
    }
  }

  // 2. No active session: Check if any active workflow trigger matches the input
  const { data: activeWorkflows, error: wfError } = await supabase
    .from('whatsapp_workflows')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('is_active', true)

  if (wfError) {
    console.error('[FlowRuntime] Error loading workflows:', wfError)
  }

  if (!activeWorkflows || activeWorkflows.length === 0) {
    console.log(`[FlowRuntime] No active workflows found for org=${organizationId}`)
    return { handled: false }
  }

  console.log(`[FlowRuntime] Found ${activeWorkflows.length} active workflow(s), checking triggers...`)

  for (const wf of activeWorkflows) {
    const startNode = getStartNode(wf)
    if (!startNode) {
      console.log(`[FlowRuntime] Workflow "${wf.name}" (${wf.id}) has no trigger node, skipping`)
      continue
    }

    const triggerData = (startNode.data || {}) as any

    // CRITICAL FIX: Read both camelCase and snake_case keys
    // Canvas builder saves: trigger_type, match_mode
    // Type interfaces define: triggerType, matchType
    const triggerType = readNodeField(triggerData, 'triggerType', 'trigger_type') || 'keyword'
    const matchType = readNodeField(triggerData, 'matchType', 'match_mode') || 'contains'
    const keywords: string[] = triggerData.keywords || []

    let matched = false

    console.log(`[FlowRuntime] Workflow "${wf.name}": triggerType=${triggerType}, matchType=${matchType}, keywords=[${keywords.join(',')}], input="${cleanInput}"`)

    if (triggerType === 'keyword' && keywords.length > 0) {
      matched = keywords.some((kw) => {
        const cleanKw = kw.toLowerCase().trim()
        if (!cleanKw) return false
        if (matchType === 'exact') return cleanInput === cleanKw
        return cleanInput.includes(cleanKw)
      })
    } else if (triggerType === 'first_message') {
      matched = true
    }

    console.log(`[FlowRuntime] Workflow "${wf.name}" trigger matched: ${matched}`)

    if (matched) {
      // Find the first actionable node after trigger
      const firstActionNode = getNextNode(wf.canvas_nodes || [], wf.canvas_edges || [], startNode.id)
      if (!firstActionNode) {
        console.log(`[FlowRuntime] Workflow "${wf.name}": trigger matched but no connected action node found`)
        continue
      }

      console.log(`[FlowRuntime] Workflow "${wf.name}": advancing to node ${firstActionNode.id} (${firstActionNode.type})`)

      // Create new active session
      const { data: newSession, error: sessionError } = await supabase
        .from('flow_sessions')
        .insert([
          {
            organization_id: organizationId,
            workflow_id: wf.id,
            conversation_id: conversationId,
            contact_phone: contactPhone,
            current_node_id: firstActionNode.id,
            state_data: { ...contactData, trigger_text: textInput },
            status: 'IN_PROGRESS',
          },
        ])
        .select()
        .single()

      if (sessionError) {
        console.error(`[FlowRuntime] Error creating flow session:`, sessionError)
        continue
      }

      // Increment workflow execution counter
      await supabase
        .from('whatsapp_workflows')
        .update({ execution_count: (wf.execution_count || 0) + 1 })
        .eq('id', wf.id)

      return await processNodeTransition({
        supabase,
        workflow: wf,
        session: newSession,
        targetNode: firstActionNode,
        contactPhone,
        conversationId,
        userInput: textInput,
        stateData: { ...contactData, trigger_text: textInput },
      })
    }
  }

  console.log(`[FlowRuntime] No workflow trigger matched input="${cleanInput}"`)
  return { handled: false }
}

/**
 * Handles action execution and reply preparation for a node.
 * Uses readNodeField() to handle both camelCase and snake_case data keys
 * since the canvas builder and TypeScript interfaces use different conventions.
 */
async function processNodeTransition({
  supabase,
  workflow,
  session,
  targetNode,
  contactPhone,
  conversationId,
  userInput = '',
  stateData,
}: {
  supabase: any
  workflow: WhatsAppWorkflow
  session?: FlowSession
  targetNode: WorkflowNode
  contactPhone: string
  conversationId?: string
  userInput?: string
  stateData: Record<string, any>
}): Promise<FlowExecutionResult> {
  let result: FlowExecutionResult = {
    handled: true,
    executedWorkflowId: workflow.id,
    workflowName: workflow.name,
    currentNodeId: targetNode.id,
  }

  // Update session current node
  if (session?.id) {
    await supabase
      .from('flow_sessions')
      .update({
        current_node_id: targetNode.id,
        state_data: stateData,
        last_interaction_at: new Date().toISOString(),
      })
      .eq('id', session.id)
  }

  const data = (targetNode.data || {}) as any

  // 1. Message Node
  // Canvas saves: body / Type interface expects: messageText
  if (targetNode.type === 'message') {
    const messageText = readNodeField(data, 'messageText', 'body', 'message_text') || ''
    const interpolated = interpolateVariables(messageText, stateData)
    console.log(`[FlowRuntime] Message node ${targetNode.id}: "${interpolated.slice(0, 80)}..."`)
    result.replyMessage = {
      type: 'text',
      body: interpolated,
    }
    result.actionTaken = 'sent_text_message'
  }

  // 2. Interactive Buttons Node
  // Canvas saves: body / Type interface expects: bodyText
  else if (targetNode.type === 'interactive_buttons') {
    const bodyText = readNodeField(data, 'bodyText', 'body', 'body_text') || ''
    const interpolated = interpolateVariables(bodyText, stateData)
    console.log(`[FlowRuntime] Buttons node ${targetNode.id}: "${interpolated.slice(0, 80)}..."`)
    result.replyMessage = {
      type: 'interactive_buttons',
      body: interpolated,
      buttons: (data.buttons || []).map((b: any) => ({ id: b.id, title: b.title })),
    }
    result.actionTaken = 'sent_interactive_buttons'
  }

  // 3. Meta WhatsApp Native Flow Node
  // Canvas saves: native_flow_id, cta_text / Type expects: flowId, flowCtaText
  else if (targetNode.type === 'native_flow_trigger') {
    const flowId = readNodeField(data, 'flowId', 'native_flow_id', 'flow_id')
    const flowCtaText = readNodeField(data, 'flowCtaText', 'cta_text', 'flow_cta_text') || 'Open Form'
    const flowToken = readNodeField(data, 'flowToken', 'flow_token') || `flow_${Date.now()}`
    const screenId = readNodeField(data, 'screenId', 'screen_id') || 'DETAILS'
    const description = readNodeField(data, 'description') || 'Please complete the in-chat form below:'

    let nativeFlow = null
    if (flowId) {
      const { data: nf } = await supabase
        .from('whatsapp_native_flows')
        .select('*')
        .eq('id', flowId)
        .maybeSingle()
      nativeFlow = nf
    }

    console.log(`[FlowRuntime] Native flow node ${targetNode.id}: flowId=${flowId}, cta="${flowCtaText}"`)
    result.replyMessage = {
      type: 'native_flow',
      body: interpolateVariables(description, stateData),
      flowPayload: {
        flow_id: nativeFlow?.flow_id_meta || nativeFlow?.id || flowId,
        flow_cta: flowCtaText,
        flow_token: flowToken,
        flow_action: 'navigate',
        screen: screenId,
      },
    }
    result.actionTaken = 'triggered_whatsapp_native_flow'
  }

  // 4. CRM Deal Creation Action Node
  // Canvas saves: deal_name, monetary_value, pipeline_stage / Type expects: dealTitle, dealValue, stageId
  else if (targetNode.type === 'crm_deal_action') {
    const dealTitle = readNodeField(data, 'dealTitle', 'deal_name', 'deal_title') || `Deal from ${contactPhone}`
    const dealValue = readNodeField(data, 'dealValue', 'monetary_value', 'deal_value') || 0
    const currency = readNodeField(data, 'currency') || 'INR'
    const source = readNodeField(data, 'source') || 'WhatsApp Flow'
    const stageId = readNodeField(data, 'stageId', 'pipeline_stage', 'stage_id') || null

    const interpolatedTitle = interpolateVariables(dealTitle, stateData)
    console.log(`[FlowRuntime] CRM deal node ${targetNode.id}: "${interpolatedTitle}", value=${dealValue}`)

    const { data: newDeal } = await supabase
      .from('leads')
      .insert([
        {
          organization_id: workflow.organization_id,
          title: interpolatedTitle,
          value: dealValue,
          currency,
          status: 'active',
          source,
          pipeline_stage_id: stageId,
        },
      ])
      .select()
      .maybeSingle()

    result.dealCreatedId = newDeal?.id
    result.actionTaken = `created_crm_deal:${interpolatedTitle}`

    // Automatically advance to the next node if one exists
    const nextNode = getNextNode(workflow.canvas_nodes || [], workflow.canvas_edges || [], targetNode.id)
    if (nextNode) {
      return await processNodeTransition({
        supabase,
        workflow,
        session,
        targetNode: nextNode,
        contactPhone,
        conversationId,
        userInput,
        stateData: { ...stateData, deal_id: newDeal?.id },
      })
    }
  }

  // 5. Customer Support Ticket Action Node
  else if (targetNode.type === 'ticket_action') {
    const subject = readNodeField(data, 'subject') || `Support inquiry from ${contactPhone}`
    const priority = readNodeField(data, 'priority') || 'medium'

    const interpolatedSubject = interpolateVariables(subject, stateData)
    console.log(`[FlowRuntime] Ticket node ${targetNode.id}: "${interpolatedSubject}", priority=${priority}`)

    const { data: newTicket } = await supabase
      .from('tickets')
      .insert([
        {
          organization_id: workflow.organization_id,
          conversation_id: conversationId,
          subject: interpolatedSubject,
          priority,
          status: 'open',
          tags: ['whatsapp_flow'],
        },
      ])
      .select()
      .maybeSingle()

    result.ticketCreatedId = newTicket?.id
    result.actionTaken = `created_support_ticket:${interpolatedSubject}`

    const nextNode = getNextNode(workflow.canvas_nodes || [], workflow.canvas_edges || [], targetNode.id)
    if (nextNode) {
      return await processNodeTransition({
        supabase,
        workflow,
        session,
        targetNode: nextNode,
        contactPhone,
        conversationId,
        userInput,
        stateData: { ...stateData, ticket_id: newTicket?.id },
      })
    }
  }

  return result
}
