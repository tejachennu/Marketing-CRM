import { createClient } from '@supabase/supabase-js'
import {
  WhatsAppWorkflow,
  WorkflowNode,
  WorkflowEdge,
  FlowSession,
  MessageNodeData,
  InteractiveButtonsNodeData,
  NativeFlowNodeData,
  CrmDealActionNodeData,
  TicketActionNodeData,
  AssignAgentActionNodeData,
  ConditionBranchNodeData,
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
 * Interpolates dynamic variables like {{name}}, {{phone}}, {{company}}
 */
export function interpolateVariables(template: string, state: Record<string, any>): string {
  if (!template) return ''
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    return state[key] !== undefined && state[key] !== null ? String(state[key]) : match
  })
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
          const btnData = currentNode.data as InteractiveButtonsNodeData
          const matchedBtn = btnData.buttons?.find(
            (b) => b.id.toLowerCase() === cleanInput || b.title.toLowerCase() === cleanInput
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
        }
      }
    }
  }

  // 2. No active session: Check if any active workflow trigger matches the input
  const { data: activeWorkflows } = await supabase
    .from('whatsapp_workflows')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('is_active', true)

  if (!activeWorkflows || activeWorkflows.length === 0) {
    return { handled: false }
  }

  for (const wf of activeWorkflows) {
    const startNode = getStartNode(wf)
    if (!startNode) continue

    const triggerData = (startNode.data || {}) as any
    const keywords: string[] = triggerData.keywords || []
    let matched = false

    if (triggerData.triggerType === 'keyword' && keywords.length > 0) {
      matched = keywords.some((kw) => {
        const cleanKw = kw.toLowerCase().trim()
        if (triggerData.matchType === 'exact') return cleanInput === cleanKw
        return cleanInput.includes(cleanKw)
      })
    } else if (triggerData.triggerType === 'first_message') {
      matched = true
    }

    if (matched) {
      // Find the first actionable node after trigger
      const firstActionNode = getNextNode(wf.canvas_nodes || [], wf.canvas_edges || [], startNode.id)
      if (firstActionNode) {
        // Create new active session
        const { data: newSession } = await supabase
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
  }

  return { handled: false }
}

/**
 * Handles action execution and reply preparation for a node
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

  // 1. Message Node
  if (targetNode.type === 'message') {
    const data = targetNode.data as MessageNodeData
    const interpolated = interpolateVariables(data.messageText, stateData)
    result.replyMessage = {
      type: 'text',
      body: interpolated,
    }
    result.actionTaken = 'sent_text_message'
  }

  // 2. Interactive Buttons Node
  else if (targetNode.type === 'interactive_buttons') {
    const data = targetNode.data as InteractiveButtonsNodeData
    const interpolated = interpolateVariables(data.bodyText, stateData)
    result.replyMessage = {
      type: 'interactive_buttons',
      body: interpolated,
      buttons: (data.buttons || []).map((b) => ({ id: b.id, title: b.title })),
    }
    result.actionTaken = 'sent_interactive_buttons'
  }

  // 3. Meta WhatsApp Native Flow Node
  else if (targetNode.type === 'native_flow_trigger') {
    const data = targetNode.data as NativeFlowNodeData
    const { data: nativeFlow } = await supabase
      .from('whatsapp_native_flows')
      .select('*')
      .eq('id', data.flowId)
      .maybeSingle()

    result.replyMessage = {
      type: 'native_flow',
      body: interpolateVariables(data.description || 'Please complete the in-chat form below:', stateData),
      flowPayload: {
        flow_id: nativeFlow?.flow_id_meta || nativeFlow?.id,
        flow_cta: data.flowCtaText || 'Open Form',
        flow_token: data.flowToken || `flow_${Date.now()}`,
        flow_action: 'navigate',
        screen: data.screenId || 'DETAILS',
      },
    }
    result.actionTaken = 'triggered_whatsapp_native_flow'
  }

  // 4. CRM Deal Creation Action Node
  else if (targetNode.type === 'crm_deal_action') {
    const data = targetNode.data as CrmDealActionNodeData
    const dealTitle = interpolateVariables(data.dealTitle || `Deal from ${contactPhone}`, stateData)

    const { data: newDeal } = await supabase
      .from('leads')
      .insert([
        {
          organization_id: workflow.organization_id,
          title: dealTitle,
          value: data.dealValue || 0,
          currency: data.currency || 'INR',
          status: 'active',
          source: data.source || 'WhatsApp Flow',
          pipeline_stage_id: data.stageId || null,
        },
      ])
      .select()
      .maybeSingle()

    result.dealCreatedId = newDeal?.id
    result.actionTaken = `created_crm_deal:${dealTitle}`

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
    const data = targetNode.data as TicketActionNodeData
    const subject = interpolateVariables(data.subject || `Support inquiry from ${contactPhone}`, stateData)

    const { data: newTicket } = await supabase
      .from('tickets')
      .insert([
        {
          organization_id: workflow.organization_id,
          conversation_id: conversationId,
          subject,
          priority: data.priority || 'medium',
          status: 'open',
          tags: ['whatsapp_flow'],
        },
      ])
      .select()
      .maybeSingle()

    result.ticketCreatedId = newTicket?.id
    result.actionTaken = `created_support_ticket:${subject}`

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
