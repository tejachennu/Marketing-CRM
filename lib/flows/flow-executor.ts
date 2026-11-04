import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { WhatsAppWorkflow, WorkflowNode, FlowSession } from './flow-types'
import { getStartNode, getNextNode, resolveReply, matchesTrigger, readNodeField, interpolateVariables, validateWorkflow, normalizeTags } from './flow-graph'
import { runFlow, type FlowReply } from './flow-runner'
import { isReadOnly } from '@/lib/rbac'
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

/** Another request holds this customer's lease. The webhook answers 503 so Meta redelivers the message shortly. */
export class FlowLockBusyError extends Error {
  constructor() {
    super('Another message for this customer is being processed; retry shortly')
    this.name = 'FlowLockBusyError'
  }
}

const SESSION_IDLE_LIMIT_MS = 24 * 60 * 60 * 1000
const OPEN_STATUSES = ['IN_PROGRESS', 'PAUSED_RAG']
const EXIT_WORDS = ['stop', 'cancel', 'exit']
const UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype']
const FORM_RECEIVED: FlowReply = { type: 'text', body: 'Thanks, we received your form.' }
const CHOOSE_AGAIN: FlowReply = { type: 'text', body: 'Please choose one of the options above, or reply “cancel” to leave this flow.' }
const COMPLETE_FORM: FlowReply = { type: 'text', body: 'Please complete the form above, or reply “cancel” to leave this flow.' }
const CANCELLED: FlowReply = { type: 'text', body: 'This flow has been cancelled. Send a new message when you are ready.' }
const APOLOGY: FlowReply = { type: 'text', body: 'Sorry, something went wrong on our side. Our team has been notified and will get back to you here.' }
const ASK_QUESTION = 'Sure! Type your question and I’ll answer it right here.'

async function checked(query: any): Promise<any> {
  const result = await query
  if (result.error) throw new Error(result.error.message)
  return result.data
}
/** PostgREST's answer when the migration adding one of `columns` has not been applied yet. */
export function isMissingColumnError(error: any, ...columns: string[]): boolean {
  if (!error) return false
  const message = String(error.message || '')
  return error.code === '42703' || error.code === 'PGRST204' || columns.some(column => message.includes(column) && /column|schema cache/i.test(message))
}
const isMissingConstraintError = (error: any) => error?.code === '42P10' || /ON CONFLICT|unique or exclusion constraint/i.test(String(error?.message || ''))
const isMissingFunctionError = (error: any) => error?.code === 'PGRST202' || /could not find the function|function .* does not exist/i.test(String(error?.message || ''))
const warned = new Set<string>()
function warnOnce(key: string, message: string) {
  if (warned.has(key)) return
  warned.add(key)
  console.warn(message)
}
const safeAnswers = (answers: Record<string, any>) => Object.fromEntries(Object.entries(answers).filter(([key]) => !UNSAFE_KEYS.includes(key)))
const withProcessed = (state: Record<string, any>, messageId?: string) => ({ ...state, _processed_messages: [...(state._processed_messages || []), messageId].filter(Boolean).slice(-100) })
const client = (database?: any) => database || createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function executeFlowRuntime(input: FlowRuntimeInput, database?: any): Promise<FlowExecutionResult> {
  const supabase = client(database)
  // Most messages have nothing to do with flows: without an active flow or an open session there is
  // nothing to lock, and the message goes straight on to the assistants
  const [activeFlows, openSessions] = await Promise.all([
    checked(supabase.from('whatsapp_workflows').select('id').eq('organization_id', input.organizationId).eq('is_active', true).limit(1)),
    checked(supabase.from('flow_sessions').select('id').eq('organization_id', input.organizationId).eq('contact_phone', input.contactPhone).in('status', OPEN_STATUSES).limit(1)),
  ])
  if (!activeFlows?.length && !openSessions?.length) {
    if (input.flowSubmissionData) return saveUnownedSubmission(input, supabase)
    return { handled: false }
  }
  const owner = randomUUID()
  const lease = await supabase.rpc('acquire_flow_lock', { p_org: input.organizationId, p_phone: input.contactPhone, p_owner: owner })
  if (lease.error) {
    if (!isMissingFunctionError(lease.error)) throw new Error(lease.error.message)
    // Before the v32 migration there is no lease; still answer rather than leave the customer waiting
    warnOnce('acquire_flow_lock', '[Flow] acquire_flow_lock is missing: apply scripts/db-migration-v32-flow-reliability.sql to serialize messages per customer')
    return executeLocked(input, supabase)
  }
  if (!lease.data) throw new FlowLockBusyError()
  try { return await executeLocked(input, supabase) }
  finally {
    await supabase.from('flow_runtime_locks').delete().eq('organization_id', input.organizationId).eq('contact_phone', input.contactPhone).eq('owner', owner)
  }
}

async function executeLocked(input: FlowRuntimeInput, supabase: any): Promise<FlowExecutionResult> {
  const { organizationId, contactPhone, conversationId } = input
  const text = input.messageText || input.userInput || ''
  const button = input.buttonPayload || input.buttonId
  const form = input.flowSubmissionData && typeof input.flowSubmissionData === 'object' && !Array.isArray(input.flowSubmissionData) ? input.flowSubmissionData : undefined
  const now = () => new Date().toISOString()
  const sessions: FlowSession[] = await checked(supabase.from('flow_sessions').select('*').eq('organization_id', organizationId).eq('contact_phone', contactPhone).order('created_at', { ascending: false }).limit(20))
  // Webhook retries must not repeat a completed CRM action or outbound message.
  const duplicate = input.messageId && sessions.find(session => session.state_data?._processed_messages?.includes(input.messageId) || session.state_data?._failed_message === input.messageId)
  if (duplicate) return { handled: true, actionTaken: 'duplicate_message' }
  let session = sessions.find(session => OPEN_STATUSES.includes(session.status) && (!conversationId || session.conversation_id === conversationId))
  const superseded = sessions.filter(candidate => OPEN_STATUSES.includes(candidate.status) && candidate.id !== session?.id)
  const expire = (ids: string[]) => checked(supabase.from('flow_sessions').update({ status: 'EXPIRED' }).eq('organization_id', organizationId).in('id', ids))
  if (superseded.length) await expire(superseded.map(candidate => candidate.id))
  if (session && Date.now() - Date.parse(session.last_interaction_at) > SESSION_IDLE_LIMIT_MS) {
    await expire([session.id])
    session = undefined
  }
  let workflow: WhatsAppWorkflow | undefined
  let target: WorkflowNode | undefined
  let state: Record<string, any> = { ...input.contactData, last_input: text }
  let answeredChoice = false
  const updateSession = (run: FlowSession, values: Record<string, any>) => checked(supabase.from('flow_sessions').update(values).eq('id', run.id).eq('organization_id', organizationId))
  // Once the session and its flow are known, a problem with the data ends this run as FAILED and tells the
  // customer. The webhook must not fail over it: Meta would retry the same message for days.
  const fail = async (run: FlowSession, flow: WhatsAppWorkflow, nodeId: string, error: any): Promise<FlowExecutionResult> => {
    console.error(`[Flow] ${flow.name}: ${error.message}`)
    await updateSession(run, { current_node_id: nodeId, state_data: { ...state, _last_error: error.message, _failed_message: input.messageId }, status: 'FAILED', last_interaction_at: now() })
    try { await input.sendReply?.(APOLOGY) } catch {}
    return { handled: true, executedWorkflowId: flow.id, workflowName: flow.name, currentNodeId: nodeId, actionTaken: 'failed' }
  }
  if (session) {
    const active = await checked(supabase.from('whatsapp_workflows').select('*').eq('id', session.workflow_id).eq('organization_id', organizationId).eq('is_active', true).maybeSingle())
    // Sessions keep the flow they started with, so later edits do not change a path midway
    const flow: WhatsAppWorkflow | undefined = active ? session.state_data?._workflow || active : undefined
    const current = flow && Array.isArray(flow.canvas_nodes) ? flow.canvas_nodes.find(node => node?.id === session!.current_node_id) : undefined
    if (!flow || !current) {
      // Paused, deleted, or the step no longer exists: nothing can continue, so this message starts afresh
      await expire([session.id])
      session = undefined
    } else {
      const run = session
      workflow = flow
      state = { ...run.state_data, ...input.contactData, last_input: text }
      const stay = async (reply: FlowReply, actionTaken: string): Promise<FlowExecutionResult> => {
        await input.sendReply?.(reply)
        await updateSession(run, { state_data: withProcessed(state, input.messageId), last_interaction_at: now() })
        return { handled: true, executedWorkflowId: flow.id, workflowName: flow.name, currentNodeId: current.id, actionTaken, replyMessages: [reply], replyMessage: reply }
      }
      try {
        const ownsForm = Boolean(form) && current.type === 'native_flow_trigger' && form!.flow_token === state._flow_token
        if (form && !ownsForm) {
          // A form from a template button, an earlier step or a replay: keep the answers, and keep the flow where it is
          const saved = await saveUnownedSubmission(input, supabase)
          return await stay(FORM_RECEIVED, saved.actionTaken || 'saved_submission')
        }
        // The flow asked the customer to type their question: this message is it, for the AI to answer
        if (run.status === 'PAUSED_RAG' && current.type === 'ai_rag_node') {
          await updateSession(run, { status: 'COMPLETED', last_interaction_at: now(), state_data: withProcessed(state, input.messageId) })
          return { handled: false, isRagFallback: true, executedWorkflowId: flow.id, workflowName: flow.name, currentNodeId: current.id, actionTaken: 'ai_answers_question' }
        }
        const choiceNode = current.type === 'interactive_buttons' || current.type === 'list_menu'
        const resolution = choiceNode ? resolveReply(current, flow.canvas_nodes, flow.canvas_edges, text, button) : undefined
        // A button the customer tapped wins over the exit words, so a "Cancel" choice follows its own branch
        if (!resolution?.matched && EXIT_WORDS.includes(text.trim().toLowerCase())) {
          await updateSession(run, { status: 'COMPLETED', state_data: withProcessed(state, input.messageId) })
          await input.sendReply?.(CANCELLED)
          return { handled: true, executedWorkflowId: flow.id, workflowName: flow.name, replyMessages: [CANCELLED], replyMessage: CANCELLED, actionTaken: 'cancelled' }
        }
        if (choiceNode) {
          if (!resolution?.matched) return await stay(CHOOSE_AGAIN, 'waiting_for_choice')
          answeredChoice = true
          const choice = resolution.choice!
          state.last_choice = choice.id
          state.last_choice_title = choice.title
          const variable = readNodeField(current.data, 'variableName', 'variable_name')
          if (variable && !UNSAFE_KEYS.includes(String(variable))) state[String(variable)] = choice.id
          target = resolution.next
        } else if (current.type === 'native_flow_trigger') {
          if (!ownsForm) return await stay(COMPLETE_FORM, 'waiting_for_form')
          const { flow_token, ...answers } = form!
          const clean = safeAnswers(answers)
          const submission = await storeSubmission(supabase, { organization_id: organizationId, flow_id: state._native_flow_id, workflow_id: flow.id, session_id: run.id, flow_token,
            conversation_id: conversationId, contact_phone: contactPhone, response_payload: { ...clean, flow_token } })
          state = { ...state, form: clean, submission: clean, submission_id: submission?.id || state.submission_id }
          const successId = current.data?.onSuccessNodeId
          target = successId ? flow.canvas_nodes.find(node => node.id === successId) : getNextNode(flow.canvas_nodes, flow.canvas_edges, current.id)
        } else {
          target = getNextNode(flow.canvas_nodes, flow.canvas_edges, current.id)
        }
      } catch (error: any) {
        return fail(run, flow, current.id, error)
      }
    }
  }
  if (!session) {
    // Old, cancelled or replayed forms must never trigger another workflow.
    if (form) return saveUnownedSubmission(input, supabase)
    const workflows: WhatsAppWorkflow[] = await checked(supabase.from('whatsapp_workflows').select('*').eq('organization_id', organizationId).eq('is_active', true).order('created_at', { ascending: true }))
    // Explicit keywords take precedence over the welcome catch-all.
    const isWelcome = (candidate: WhatsAppWorkflow) => (readNodeField(getStartNode(candidate)?.data, 'triggerType', 'trigger_type') || candidate.trigger_type) === 'first_message'
    workflows.sort((a, b) => Number(isWelcome(a)) - Number(isWelcome(b)))
    for (const candidate of workflows) {
      if (!matchesTrigger(candidate, button || text, input.isFirstMessage)) continue
      const errors = validateWorkflow(candidate.canvas_nodes, candidate.canvas_edges)
      if (!errors.length) { workflow = candidate; break }
      // Activated before today's checks existed: take it out of service so the assistants answer, instead of Meta retrying for days
      await pauseWorkflow(supabase, candidate, errors)
    }
    if (!workflow) return { handled: false }
    target = getNextNode(workflow.canvas_nodes, workflow.canvas_edges, getStartNode(workflow)!.id)
    state = { ...state, trigger_text: text, _workflow: workflow }
    session = await checked(supabase.from('flow_sessions').insert({ organization_id: organizationId, workflow_id: workflow.id, conversation_id: conversationId,
      contact_phone: contactPhone, current_node_id: target!.id, state_data: state, status: 'IN_PROGRESS' }).select().single())
    await countExecution(supabase, workflow)
  }
  const activeSession = session!
  const activeWorkflow = workflow!
  let checkpointNode = activeSession.current_node_id
  const checkpoint = async (nodeId: string, data: Record<string, any>, status: string) => {
    state = data
    checkpointNode = nodeId
    await updateSession(activeSession, { current_node_id: nodeId, state_data: data, status, last_interaction_at: now() })
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
        return { type: 'native_flow', body: interpolateVariables(node.data?.description || 'Please complete the form below:', data) || 'Please complete the form below:', flowPayload: {
          flow_id: native.flow_id_meta, flow_cta: readNodeField(node.data, 'flowCtaText', 'cta_text', 'flow_cta_text') || 'Open Form',
          flow_token: data._flow_token, flow_action: 'navigate', flow_action_payload: { screen },
        } }
      },
      action: async (node, data) => {
        const contact = data.contact
        if (!contact?.id) throw new Error('A CRM contact is required for workflow actions')
        const text = (value: unknown) => interpolateVariables(String(value ?? ''), data)
        if (node.type === 'crm_deal_action') {
          if (data._actions?.[node.id]) return { deal_id: data._actions[node.id] }
          // Leads land in the configured stage, or else in the organization's first stage by position
          const stages: any[] = await checked(supabase.from('pipeline_stages').select('id,name,position').eq('organization_id', organizationId).order('position', { ascending: true }))
          const configured = readNodeField(node.data, 'stageId', 'pipeline_stage', 'stage_id')
          const normalize = (value: string) => String(value).toLowerCase().replace(/[^a-z0-9]/g, '')
          const stage = !configured || configured === 'lead_in' ? stages[0] : stages.find(stage => stage.id === configured || normalize(stage.name) === normalize(configured))
          if (configured && configured !== 'lead_in' && !stage) throw new Error('The selected pipeline stage does not exist in this organization')
          const amount = Number(text(readNodeField(node.data, 'dealValue', 'monetary_value', 'deal_value') ?? 0))
          const deal = await checked(supabase.from('leads').insert({ organization_id: organizationId, contact_id: contact.id,
            title: text(readNodeField(node.data, 'dealTitle', 'deal_name', 'deal_title')) || `Lead from ${contactPhone}`,
            value: Number.isFinite(amount) ? amount : 0, status: 'active',
            source: node.data?.source || 'WhatsApp Flow', pipeline_stage_id: stage?.id || null,
            notes: data.form ? JSON.stringify(data.form, null, 2) : null }).select().single())
          if (conversationId) await checked(supabase.from('conversations').update({ lead_id: deal.id }).eq('id', conversationId).eq('organization_id', organizationId))
          if (data.submission_id) await checked(supabase.from('flow_submissions').update({ lead_id: deal.id }).eq('id', data.submission_id).eq('organization_id', organizationId))
          return { deal_id: deal.id, _actions: { ...data._actions, [node.id]: deal.id } }
        }
        if (node.type === 'ticket_action') {
          if (data._actions?.[node.id]) return { ticket_id: data._actions[node.id] }
          // tickets.conversation_id is NOT NULL: a ticket is always raised inside the chat it came from
          if (!conversationId) throw new Error('A conversation is required to create a ticket')
          const ticket = await checked(supabase.from('tickets').insert({ organization_id: organizationId, contact_id: contact.id, conversation_id: conversationId,
            subject: text(node.data?.subject) || 'WhatsApp support request', status: 'open' }).select().single())
          return { ticket_id: ticket.id, _actions: { ...data._actions, [node.id]: ticket.id } }
        }
        if (node.type === 'tag_action') {
          const requested = normalizeTags((Array.isArray(node.data?.tags) ? node.data.tags : []).map((tag: unknown) => text(tag)))
          const current = await checked(supabase.from('contacts').select('tags').eq('id', contact.id).eq('organization_id', organizationId).maybeSingle())
          if (!current) throw new Error('The contact no longer exists in this organization')
          // Existing tags are kept as spelled; a tag that only differs in case is the same tag
          const stored: unknown[] = Array.isArray(current.tags) ? current.tags : []
          const existing = [...new Set(stored.map(tag => String(tag ?? '').trim()).filter(Boolean))]
          const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
          const remove = readNodeField(node.data, 'action', 'tag_action_type') === 'remove'
          const tags = remove ? existing.filter(tag => !requested.some(wanted => same(wanted, tag)))
            : [...existing, ...requested.filter(wanted => !existing.some(tag => same(tag, wanted)))]
          await checked(supabase.from('contacts').update({ tags }).eq('id', contact.id).eq('organization_id', organizationId))
          return { contact_tags: tags }
        }
        // Every action type is handled explicitly: an unknown one must never fall through to a handoff.
        if (node.type !== 'assign_agent_action') throw new Error(`Unsupported workflow action: ${node.type}`)
        if (!conversationId) throw new Error('A conversation is required for agent handoff')
        const chosenUser = readNodeField(node.data, 'assignedUserId', 'assigned_user_id')
        const assignment = readNodeField(node.data, 'assignmentType', 'assignment_type') || (chosenUser ? 'specific_user' : 'team_queue')
        let userId: string | null = null
        if (assignment === 'round_robin') userId = await nextRoundRobinUser(supabase, organizationId, activeWorkflow.id)
        else if (assignment === 'specific_user') {
          const user = chosenUser ? await checked(supabase.from('users').select('id').eq('id', chosenUser).eq('organization_id', organizationId).maybeSingle()) : null
          if (!user) throw new Error('Select an agent in this organization')
          userId = user.id
        }
        await checked(supabase.from('conversations').update({ assigned_to: userId, auto_reply_enabled: false }).eq('id', conversationId).eq('organization_id', organizationId))
        // The round-robin pointer lives in this session's state, where the next hand-off looks for it
        return { handed_off: true, assigned_user_id: userId, ...(assignment === 'round_robin' && userId ? { _round_robin_user: userId } : {}) }
      },
    }) : { currentNodeId: activeSession.current_node_id, state, status: 'COMPLETED' as const, replies: [], isRagFallback: false }
    const finalState = withProcessed(result.state, input.messageId)
    if (result.isRagFallback && answeredChoice) {
      // "Ask a question" was a menu choice, not the question: ask for it, and let the AI answer the next message
      const node = activeWorkflow.canvas_nodes.find(item => item.id === result.currentNodeId)
      const prompt: FlowReply = { type: 'text', body: interpolateVariables(readNodeField(node?.data, 'promptText', 'prompt', 'description') || ASK_QUESTION, finalState).trim() || ASK_QUESTION }
      await input.sendReply?.(prompt)
      await checkpoint(result.currentNodeId, finalState, 'PAUSED_RAG')
      return { handled: true, executedWorkflowId: activeWorkflow.id, workflowName: activeWorkflow.name, currentNodeId: result.currentNodeId,
        replyMessages: [...result.replies, prompt], replyMessage: prompt, actionTaken: 'waiting_for_question' }
    }
    // AI nodes delegate to the existing real knowledge assistant and finish this graph.
    await checkpoint(result.currentNodeId, finalState, result.isRagFallback ? 'COMPLETED' : result.status)
    return { handled: !result.isRagFallback, isRagFallback: result.isRagFallback, executedWorkflowId: activeWorkflow.id, workflowName: activeWorkflow.name,
      currentNodeId: result.currentNodeId, replyMessages: result.replies, replyMessage: result.replies.at(-1), dealCreatedId: state.deal_id, ticketCreatedId: state.ticket_id }
  } catch (error: any) {
    return fail(activeSession, activeWorkflow, checkpointNode, error)
  }
}

/** Takes a live flow the runtime cannot execute out of service, leaving the reason for the builder page. */
async function pauseWorkflow(supabase: any, workflow: WhatsAppWorkflow, errors: string[]) {
  const reason = errors.join('; ').slice(0, 2000)
  console.error(`[Flow] ${workflow.name} (${workflow.id}) paused: ${reason}`)
  const update = (values: Record<string, any>) => supabase.from('whatsapp_workflows').update(values).eq('id', workflow.id).eq('organization_id', workflow.organization_id)
  const result = await update({ is_active: false, paused_reason: reason, paused_at: new Date().toISOString() })
  if (!result.error) return
  // Before migration 20261104_workflows_pause_reason the flow is still paused, only without the note
  if (!isMissingColumnError(result.error, 'paused_reason', 'paused_at')) throw new Error(result.error.message)
  await checked(update({ is_active: false }))
}

/** Counts a start atomically; before the v32 function exists, with a plain update. */
async function countExecution(supabase: any, workflow: WhatsAppWorkflow) {
  const result = await supabase.rpc('increment_flow_execution', { p_workflow: workflow.id, p_org: workflow.organization_id })
  if (!result.error) return
  if (!isMissingFunctionError(result.error)) throw new Error(result.error.message)
  warnOnce('increment_flow_execution', '[Flow] increment_flow_execution is missing: apply scripts/db-migration-v32-flow-reliability.sql')
  await checked(supabase.from('whatsapp_workflows').update({ execution_count: (workflow.execution_count || 0) + 1 }).eq('id', workflow.id).eq('organization_id', workflow.organization_id))
}

/** Stores a submission once per token. Before the v32 columns and index exist it is stored without the correlation fields. */
async function storeSubmission(supabase: any, row: Record<string, any>): Promise<any> {
  const result = await supabase.from('flow_submissions').upsert(row, { onConflict: 'organization_id,flow_token', ignoreDuplicates: true }).select().maybeSingle()
  if (!result.error) return result.data
  if (isMissingConstraintError(result.error)) {
    const existing = await checked(supabase.from('flow_submissions').select('id').eq('organization_id', row.organization_id).eq('flow_token', row.flow_token).maybeSingle())
    return existing || checked(supabase.from('flow_submissions').insert(row).select().maybeSingle())
  }
  if (isMissingColumnError(result.error, 'workflow_id', 'session_id', 'flow_token')) {
    const legacy = Object.fromEntries(Object.entries(row).filter(([key]) => !['workflow_id', 'session_id', 'flow_token'].includes(key)))
    return checked(supabase.from('flow_submissions').insert(legacy).select().maybeSingle())
  }
  throw new Error(result.error.message)
}

/** The teammate after the one this flow handed off to last. Everyone in the organization who can work conversations takes a turn. */
async function nextRoundRobinUser(supabase: any, organizationId: string, workflowId: string): Promise<string | null> {
  const users: any[] = await checked(supabase.from('users').select('id,role,read_only,created_at').eq('organization_id', organizationId).order('created_at', { ascending: true }))
  const eligible = (users || []).filter(user => !isReadOnly(user)).map(user => String(user.id))
  if (!eligible.length) return null
  // The pointer is the previous hand-off's session, so it survives edits to the flow
  const previous = await checked(supabase.from('flow_sessions').select('state_data').eq('organization_id', organizationId).eq('workflow_id', workflowId)
    .not('state_data->>_round_robin_user', 'is', null).order('last_interaction_at', { ascending: false }).limit(1).maybeSingle())
  const index = eligible.indexOf(String(previous?.state_data?._round_robin_user ?? ''))
  return eligible[(index + 1) % eligible.length]
}

/**
 * A form answered outside a running flow: sent from a template's flow button, after a hand-off to an
 * agent, or after the flow ended. The answers are still saved, so they show up under Form submissions.
 */
export async function saveUnownedSubmission(input: FlowRuntimeInput, database?: any): Promise<FlowExecutionResult> {
  const supabase = client(database)
  const { flow_token, ...answers } = input.flowSubmissionData || {}
  const token = String(flow_token || '')
  if (!token) return { handled: true, actionTaken: 'ignored_submission_without_token' }
  // Campaign flow buttons name the form: campaign:<campaign>:<recipient>:<Meta flow id>
  const metaFlowId = token.startsWith('campaign:') ? token.split(':')[3] : undefined
  const form = metaFlowId ? await checked(supabase.from('whatsapp_native_flows').select('id').eq('organization_id', input.organizationId).eq('flow_id_meta', metaFlowId).maybeSingle()) : null
  await storeSubmission(supabase, { organization_id: input.organizationId, flow_id: form?.id || null, flow_token: token,
    conversation_id: input.conversationId, contact_phone: input.contactPhone, response_payload: { ...safeAnswers(answers), flow_token: token } })
  return { handled: true, actionTaken: 'saved_submission' }
}
