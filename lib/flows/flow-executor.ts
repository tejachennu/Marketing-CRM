import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { WhatsAppWorkflow, WorkflowNode, FlowSession } from './flow-types'
import { getStartNode, getNextNode, resolveReply, matchesTrigger, readNodeField, interpolateVariables, validateWorkflow } from './flow-graph'
import { runFlow, type FlowReply } from './flow-runner'
export { getStartNode, getNextNode, getOutgoingEdges, interpolateVariables } from './flow-graph'

export interface FlowExecutionResult {
  handled: boolean
  executedWorkflowId?: string
  workflowName?: string
  currentNodeId?: string
  actionTaken?: string
  replyMessage?: FlowReply
  replyMessages?: FlowReply[]
  isRagFallback?: boolean
  dealCreatedId?: string
  ticketCreatedId?: string
}
export interface FlowRuntimeInput {
  organizationId: string
  conversationId?: string
  contactPhone: string
  messageText?: string
  userInput?: string
  buttonPayload?: string
  buttonId?: string
  messageId?: string
  isFirstMessage?: boolean
  contactData?: Record<string, any>
  flowSubmissionData?: Record<string, any>
  sendReply?: (reply: FlowReply) => Promise<void>
}
async function checked(query: any): Promise<any> {
  const result = await query
  if (result.error) throw new Error(result.error.message)
  return result.data
}

export async function executeFlowRuntime(input: FlowRuntimeInput, database?: any): Promise<FlowExecutionResult> {
  const supabase = database || createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const owner = randomUUID()
  const acquired = await checked(supabase.rpc('acquire_flow_lock', { p_org: input.organizationId, p_phone: input.contactPhone, p_owner: owner }))
  if (!acquired) throw new Error('Another message for this customer is being processed; retry shortly')
  try { return await executeLocked(input, supabase) }
  finally {
    await supabase.from('flow_runtime_locks').delete().eq('organization_id', input.organizationId).eq('contact_phone', input.contactPhone).eq('owner', owner)
  }
}

async function executeLocked(input: FlowRuntimeInput, supabase: any): Promise<FlowExecutionResult> {
  const { organizationId, contactPhone, conversationId, flowSubmissionData } = input
  const text = input.messageText || input.userInput || ''
  const button = input.buttonPayload || input.buttonId
  const sessions: FlowSession[] = await checked(supabase.from('flow_sessions').select('*').eq('organization_id', organizationId).eq('contact_phone', contactPhone).order('created_at', { ascending: false }).limit(20))
  // Webhook retries must not repeat a completed CRM action or outbound message.
  const duplicate = input.messageId && sessions.find(session => (session.state_data?._processed_messages?.includes(input.messageId) || session.state_data?._failed_message === input.messageId))
  if (duplicate) return { handled: true, actionTaken: 'duplicate_message' }
  let session = sessions.find(session => ['IN_PROGRESS', 'PAUSED_RAG'].includes(session.status) && (!conversationId || session.conversation_id === conversationId))
  const superseded = sessions.filter(candidate => ['IN_PROGRESS', 'PAUSED_RAG'].includes(candidate.status) && candidate.id !== session?.id)
  if (superseded.length) {
    await checked(supabase.from('flow_sessions').update({ status: 'EXPIRED' }).eq('organization_id', organizationId).in('id', superseded.map(candidate => candidate.id)))
  }
  if (session && Date.now() - Date.parse(session.last_interaction_at) > 24 * 60 * 60 * 1000) {
    await checked(supabase.from('flow_sessions').update({ status: 'EXPIRED' }).eq('id', session.id).eq('organization_id', organizationId))
    session = undefined
  }
  let workflow: WhatsAppWorkflow | undefined
  let target: WorkflowNode | undefined
  let state: Record<string, any> = { ...input.contactData, last_input: text }
  const waitForReply = async (reply: FlowReply, nodeId: string, actionTaken = 'waiting_for_choice'): Promise<FlowExecutionResult> => {
    await input.sendReply?.(reply)
    if (session) await checked(supabase.from('flow_sessions').update({
      state_data: { ...state, _processed_messages: [...(state._processed_messages || []), input.messageId].filter(Boolean).slice(-100) },
      last_interaction_at: new Date().toISOString(),
    }).eq('id', session.id).eq('organization_id', organizationId))
    return { handled: true, replyMessages: [reply], replyMessage: reply, currentNodeId: nodeId, actionTaken }
  }
  if (session) {
    const active = await checked(supabase.from('whatsapp_workflows').select('*').eq('id', session.workflow_id).eq('organization_id', organizationId).eq('is_active', true).maybeSingle())
    if (!active) {
      await checked(supabase.from('flow_sessions').update({ status: 'EXPIRED' }).eq('id', session.id).eq('organization_id', organizationId))
      session = undefined
    } else {
      workflow = session.state_data._workflow || active
      state = { ...session.state_data, ...input.contactData, last_input: text }
      const current = workflow!.canvas_nodes.find(node => node.id === session!.current_node_id)
      if (!current) throw new Error('The active workflow step is missing')
      if (['stop', 'cancel', 'exit'].includes(text.trim().toLowerCase())) {
        await checked(supabase.from('flow_sessions').update({ status: 'COMPLETED', state_data: { ...state, _processed_messages: [...(state._processed_messages || []), input.messageId].filter(Boolean) } }).eq('id', session.id).eq('organization_id', organizationId))
        const reply: FlowReply = { type: 'text', body: 'This flow has been cancelled. Send a new message when you are ready.' }
        await input.sendReply?.(reply)
        return { handled: true, replyMessages: [reply], replyMessage: reply }
      }
      if (current.type === 'interactive_buttons' || current.type === 'list_menu') {
        const resolution = resolveReply(current, workflow!.canvas_nodes, workflow!.canvas_edges, text, button)
        if (!resolution.matched) {
          const reply: FlowReply = { type: 'text', body: 'Please choose one of the options above, or reply “cancel” to leave this flow.' }
          return waitForReply(reply, current.id)
        }
        state.last_choice = resolution.choice!.id
        state.last_choice_title = resolution.choice!.title
        if (current.data.variableName || current.data.variable_name) state[current.data.variableName || current.data.variable_name] = resolution.choice!.id
        target = resolution.next
      } else if (current.type === 'native_flow_trigger') {
        if (!flowSubmissionData || typeof flowSubmissionData !== 'object' || flowSubmissionData.flow_token !== state._flow_token) {
          const reply: FlowReply = { type: 'text', body: 'Please complete the form above, or reply “cancel” to leave this flow.' }
          return waitForReply(reply, current.id, 'waiting_for_form')
        }
        const { flow_token, ...answers } = flowSubmissionData
        const safeAnswers = Object.fromEntries(Object.entries(answers).filter(([key]) => !['__proto__', 'constructor', 'prototype'].includes(key)))
        const submission = await checked(supabase.from('flow_submissions').upsert({ organization_id: organizationId, flow_id: state._native_flow_id,
          workflow_id: workflow!.id, session_id: session.id, flow_token, conversation_id: conversationId, contact_phone: contactPhone,
          response_payload: { ...safeAnswers, flow_token } }, { onConflict: 'organization_id,flow_token', ignoreDuplicates: true }).select().maybeSingle())
        state = { ...state, form: safeAnswers, submission: safeAnswers, submission_id: submission?.id || state.submission_id }
        const successId = current.data.onSuccessNodeId
        target = successId ? workflow!.canvas_nodes.find(node => node.id === successId) : getNextNode(workflow!.canvas_nodes, workflow!.canvas_edges, current.id)
      } else {
        target = getNextNode(workflow!.canvas_nodes, workflow!.canvas_edges, current.id)
      }
    }
  }
  if (!session) {
    // Old, cancelled or replayed forms must never trigger another workflow.
    if (flowSubmissionData) return { handled: true, actionTaken: 'ignored_stale_submission' }
    const workflows: WhatsAppWorkflow[] = await checked(supabase.from('whatsapp_workflows').select('*').eq('organization_id', organizationId).eq('is_active', true).order('created_at', { ascending: true }))
    // Explicit keywords take precedence over the welcome catch-all.
    workflows.sort((a, b) => Number((getStartNode(a)?.data.trigger_type || a.trigger_type) === 'first_message') - Number((getStartNode(b)?.data.trigger_type || b.trigger_type) === 'first_message'))
    workflow = workflows.find(workflow => matchesTrigger(workflow, button || text, input.isFirstMessage))
    if (!workflow) return { handled: false }
    const errors = validateWorkflow(workflow.canvas_nodes, workflow.canvas_edges)
    if (errors.length) throw new Error(errors.join('; '))
    target = getNextNode(workflow.canvas_nodes, workflow.canvas_edges, getStartNode(workflow)!.id)
    state = { ...state, trigger_text: text, _workflow: workflow }
    session = await checked(supabase.from('flow_sessions').insert({ organization_id: organizationId, workflow_id: workflow.id, conversation_id: conversationId,
      contact_phone: contactPhone, current_node_id: target!.id, state_data: state, status: 'IN_PROGRESS' }).select().single())
    await checked(supabase.rpc('increment_flow_execution', { p_workflow: workflow.id, p_org: organizationId }))
  }
  const activeSession = session!
  const activeWorkflow = workflow!
  let checkpointNode = activeSession.current_node_id
  const checkpoint = async (nodeId: string, data: Record<string, any>, status: string) => {
    state = data
    checkpointNode = nodeId
    await checked(supabase.from('flow_sessions').update({ current_node_id: nodeId, state_data: data, status, last_interaction_at: new Date().toISOString() }).eq('id', activeSession.id).eq('organization_id', organizationId))
  }
  try {
    const result = target ? await runFlow(activeWorkflow.canvas_nodes, activeWorkflow.canvas_edges, target, state, {
      send: input.sendReply || (async () => {}), checkpoint,
      nativeFlow: async (node, data) => {
        const id = readNodeField(node.data, 'flowId', 'native_flow_id', 'flow_id')
        const native = await checked(supabase.from('whatsapp_native_flows').select('*').eq('id', id).eq('organization_id', organizationId).maybeSingle())
        if (!native?.flow_id_meta || native.status !== 'PUBLISHED') throw new Error('Publish the selected form to Meta before activating this workflow')
        const screen = readNodeField(node.data, 'screenId', 'screen_id') || native.flow_json?.screens?.[0]?.id
        if (!native.flow_json?.screens?.some((item: any) => item.id === screen)) throw new Error('Native form starting screen does not exist')
        data._flow_token = randomUUID(); data._native_flow_id = native.id
        return { type: 'native_flow', body: interpolateVariables(node.data.description || 'Please complete the form below:', data), flowPayload: {
          flow_id: native.flow_id_meta, flow_cta: readNodeField(node.data, 'flowCtaText', 'cta_text', 'flow_cta_text') || 'Open Form',
          flow_token: data._flow_token, flow_action: 'navigate', flow_action_payload: { screen },
        } }
      },
      action: async (node, data) => {
        const contact = data.contact
        if (!contact?.id) throw new Error('A CRM contact is required for workflow actions')
        const text = (value: string) => interpolateVariables(value, data)
        if (node.type === 'crm_deal_action') {
          if (data._actions?.[node.id]) return { deal_id: data._actions[node.id] }
          const stages: any[] = await checked(supabase.from('pipeline_stages').select('id,name').eq('organization_id', organizationId).order('position'))
          const configured = readNodeField(node.data, 'stageId', 'pipeline_stage', 'stage_id')
          const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
          const stage = !configured || configured === 'lead_in' ? stages[0] : stages.find(stage => stage.id === configured || normalize(stage.name) === normalize(configured))
          if (configured && !stage) throw new Error('The selected pipeline stage does not exist in this organization')
          const deal = await checked(supabase.from('leads').insert({ organization_id: organizationId, contact_id: contact.id,
            title: text(readNodeField(node.data, 'dealTitle', 'deal_name', 'deal_title') || `Lead from ${contactPhone}`),
            value: Number(readNodeField(node.data, 'dealValue', 'monetary_value', 'deal_value') || 0), status: 'active',
            source: node.data.source || 'WhatsApp Flow', pipeline_stage_id: stage?.id || null,
            notes: data.form ? JSON.stringify(data.form, null, 2) : null }).select().single())
          if (conversationId) await checked(supabase.from('conversations').update({ lead_id: deal.id }).eq('id', conversationId).eq('organization_id', organizationId))
          if (data.submission_id) await checked(supabase.from('flow_submissions').update({ lead_id: deal.id }).eq('id', data.submission_id).eq('organization_id', organizationId))
          return { deal_id: deal.id, _actions: { ...data._actions, [node.id]: deal.id } }
        }
        if (node.type === 'ticket_action') {
          if (data._actions?.[node.id]) return { ticket_id: data._actions[node.id] }
          const ticket = await checked(supabase.from('tickets').insert({ organization_id: organizationId, contact_id: contact.id, conversation_id: conversationId,
            subject: text(node.data.subject || 'WhatsApp support request'), status: 'open' }).select().single())
          return { ticket_id: ticket.id, _actions: { ...data._actions, [node.id]: ticket.id } }
        }
        const userId = readNodeField(node.data, 'assignedUserId', 'assigned_user_id')
        if (userId) {
          const user = await checked(supabase.from('users').select('id').eq('id', userId).eq('organization_id', organizationId).maybeSingle())
          if (!user) throw new Error('Select an agent in this organization')
        }
        if (!conversationId) throw new Error('A conversation is required for agent handoff')
        await checked(supabase.from('conversations').update({ assigned_to: userId || null, auto_reply_enabled: false }).eq('id', conversationId).eq('organization_id', organizationId))
        return { handed_off: true }
      },
    }) : { currentNodeId: activeSession.current_node_id, state, status: 'COMPLETED' as const, replies: [], isRagFallback: false }
    const finalState = { ...result.state, _processed_messages: [...(state._processed_messages || []), input.messageId].filter(Boolean).slice(-100) }
    // AI nodes delegate to the existing real knowledge assistant and finish this graph.
    await checkpoint(result.currentNodeId, finalState, result.isRagFallback ? 'COMPLETED' : result.status)
    return { handled: !result.isRagFallback, isRagFallback: result.isRagFallback, executedWorkflowId: activeWorkflow.id, workflowName: activeWorkflow.name,
      currentNodeId: result.currentNodeId, replyMessages: result.replies, replyMessage: result.replies.at(-1), dealCreatedId: state.deal_id, ticketCreatedId: state.ticket_id }
  } catch (error: any) {
    await checkpoint(checkpointNode, { ...state, _last_error: error.message, _failed_message: input.messageId }, 'FAILED')
    throw error
  }
}
