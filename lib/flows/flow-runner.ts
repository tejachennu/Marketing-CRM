import type { WorkflowNode, WorkflowEdge } from './flow-types'
import { readNodeField, interpolateVariables, evaluateCondition, getNextNode, getChoices, getVariableNameError, setStateValue } from './flow-graph'

export interface FlowReply {
  type: 'text' | 'interactive_buttons' | 'list_menu' | 'native_flow'
  body: string
  buttons?: Array<{ id: string; title: string }>
  sections?: any[]
  buttonText?: string
  flowPayload?: Record<string, any>
}
export interface RunResult {
  currentNodeId: string
  state: Record<string, any>
  status: 'IN_PROGRESS' | 'COMPLETED' | 'PAUSED_RAG'
  replies: FlowReply[]
  isRagFallback?: boolean
}
export interface RunAdapter {
  send: (reply: FlowReply) => Promise<void>
  nativeFlow: (node: WorkflowNode, state: Record<string, any>) => Promise<FlowReply>
  action: (node: WorkflowNode, state: Record<string, any>) => Promise<Record<string, any>>
  checkpoint?: (nodeId: string, state: Record<string, any>, status: RunResult['status']) => Promise<void>
}
/** What WhatsApp accepts in one message. A flow that goes live is validated against the same numbers. */
export const WHATSAPP_LIMITS = { text: 4096, interactiveBody: 1024, buttons: 3, buttonTitle: 20, listButton: 20, rows: 10, sections: 10, rowTitle: 24, rowDescription: 72, sectionTitle: 24, formButton: 30 } as const
/** Automatic steps one incoming message may run before the graph is considered looping. */
export const MAX_AUTOMATIC_STEPS = 50
/** Wall-clock budget for one incoming message, below the webhook's own timeout. */
export const EXECUTION_TIME_LIMIT_MS = 90000
const DEFAULT_PROMPT = 'Please choose an option:'
const DEFAULT_LIST_BUTTON = 'Choose'

/** Shortens by characters rather than UTF-16 units, so an emoji at the cut is dropped whole instead of split. */
const cut = (value: unknown, max: number) => Array.from(String(value ?? '')).slice(0, max).join('')

/**
 * Fits a reply to WhatsApp's limits. Validation keeps live flows within them, but a session may
 * still carry an older copy of its flow and interpolated text can grow, so the runtime trims
 * instead of failing the conversation. Rows past the tenth and empty sections are dropped.
 */
export function fitReply(reply: FlowReply): FlowReply {
  const body = cut(reply.body, reply.type === 'text' ? WHATSAPP_LIMITS.text : WHATSAPP_LIMITS.interactiveBody)
  if (reply.type === 'interactive_buttons') {
    const buttons = (Array.isArray(reply.buttons) ? reply.buttons : []).filter(button => button && button.id).slice(0, WHATSAPP_LIMITS.buttons)
      .map(button => ({ id: String(button.id), title: cut(button.title || button.id, WHATSAPP_LIMITS.buttonTitle) }))
    return { ...reply, body, buttons }
  }
  if (reply.type === 'list_menu') {
    let remaining: number = WHATSAPP_LIMITS.rows
    const sections: any[] = []
    for (const section of (Array.isArray(reply.sections) ? reply.sections : []).slice(0, WHATSAPP_LIMITS.sections)) {
      if (!remaining) break
      const rows = (Array.isArray(section?.rows) ? section.rows : []).filter((row: any) => row && row.id).slice(0, remaining)
        .map((row: any) => ({ id: String(row.id), title: cut(row.title || row.id, WHATSAPP_LIMITS.rowTitle), ...(row.description ? { description: cut(row.description, WHATSAPP_LIMITS.rowDescription) } : {}) }))
      if (!rows.length) continue // Meta rejects a section without rows
      remaining -= rows.length
      const title = cut(section.title, WHATSAPP_LIMITS.sectionTitle)
      sections.push({ ...(title ? { title } : {}), rows })
    }
    return { ...reply, body, buttonText: cut(reply.buttonText || DEFAULT_LIST_BUTTON, WHATSAPP_LIMITS.listButton), sections }
  }
  if (reply.type === 'native_flow' && reply.flowPayload) {
    return { ...reply, body, flowPayload: { ...reply.flowPayload, flow_cta: cut(reply.flowPayload.flow_cta || 'Open Form', WHATSAPP_LIMITS.formButton) } }
  }
  return { ...reply, body }
}

/** Both the simulator and live delivery use this bounded transition loop. */
export async function runFlow(nodes: WorkflowNode[], edges: WorkflowEdge[], first: WorkflowNode, initialState: Record<string, any>, adapter: RunAdapter): Promise<RunResult> {
  let node: WorkflowNode | undefined = first
  let state = { ...initialState }
  const replies: FlowReply[] = []
  let currentNodeId = first.id
  const deadline = Date.now() + EXECUTION_TIME_LIMIT_MS
  for (let steps = 0; node && steps < MAX_AUTOMATIC_STEPS; steps++) {
    if (Date.now() > deadline) throw new Error('Workflow exceeded its execution time limit')
    currentNodeId = node.id
    await adapter.checkpoint?.(node.id, state, 'IN_PROGRESS')
    const data: Record<string, any> = node.data || {}
    const text = (value: unknown) => interpolateVariables(String(value ?? ''), state)
    let reply: FlowReply | undefined
    let wait = false
    if (node.type === 'message') reply = { type: 'text', body: text(readNodeField(data, 'messageText', 'body', 'message_text')) }
    else if (node.type === 'interactive_buttons') {
      reply = { type: 'interactive_buttons', body: text(readNodeField(data, 'bodyText', 'body', 'body_text')) || DEFAULT_PROMPT, buttons: getChoices(node).map(choice => ({ id: choice.id, title: text(choice.title) })) }
      wait = true
    } else if (node.type === 'list_menu') {
      reply = { type: 'list_menu', body: text(readNodeField(data, 'bodyText', 'body', 'body_text')) || DEFAULT_PROMPT, buttonText: readNodeField(data, 'buttonText', 'button_text') || DEFAULT_LIST_BUTTON, sections: Array.isArray(data.sections) ? data.sections : [] }
      wait = true
    } else if (node.type === 'native_flow_trigger') {
      reply = await adapter.nativeFlow(node, state)
      // Persist the correlation token before WhatsApp can return a submission.
      await adapter.checkpoint?.(node.id, state, 'IN_PROGRESS')
      wait = true
    } else if (node.type === 'condition_branch') {
      const outcome = evaluateCondition(data, state)
      const targetId: string | undefined = outcome ? data.trueTargetNodeId : data.falseTargetNodeId
      node = targetId ? nodes.find(candidate => candidate.id === targetId) : getNextNode(nodes, edges, node.id, String(outcome))
      if (!node) throw new Error(`Missing ${outcome} condition branch`)
      continue
    } else if (node.type === 'ai_rag_node') {
      await adapter.checkpoint?.(node.id, state, 'PAUSED_RAG')
      return { currentNodeId, state, status: 'PAUSED_RAG', replies, isRagFallback: true }
    } else if (['crm_deal_action', 'ticket_action', 'assign_agent_action'].includes(node.type)) {
      state = { ...state, ...await adapter.action(node, state) }
      await adapter.checkpoint?.(node.id, state, 'IN_PROGRESS')
      if (node.type === 'assign_agent_action') {
        await adapter.checkpoint?.(node.id, state, 'COMPLETED')
        return { currentNodeId, state, status: 'COMPLETED', replies }
      }
    } else if (node.type === 'set_variable') {
      const name = String(readNodeField(data, 'variableName', 'variable_name') || '').trim()
      const problem = getVariableNameError(name)
      if (problem) throw new Error(`Set Variable: ${problem}`)
      const raw = text(readNodeField(data, 'valueExpression', 'value_expression') ?? '')
      const type = readNodeField(data, 'valueType', 'value_type') || 'text'
      let value: any = raw
      if (type === 'number') {
        value = Number(raw)
        if (raw.trim() === '' || Number.isNaN(value)) throw new Error(`Set Variable: "${raw}" is not a number`)
      } else if (type === 'boolean') value = ['true', '1', 'yes'].includes(raw.trim().toLowerCase())
      else if (type === 'json') {
        try { value = JSON.parse(raw) } catch { throw new Error('Set Variable: the value is not valid JSON') }
      }
      state = setStateValue(state, name, value)
      await adapter.checkpoint?.(node.id, state, 'IN_PROGRESS')
    } else if (node.type === 'tag_action') {
      state = { ...state, ...await adapter.action(node, state) }
      await adapter.checkpoint?.(node.id, state, 'IN_PROGRESS')
    } else if (node.type !== 'trigger') {
      // Delays, webhooks and notifications have no runtime yet: fail loudly rather than pretend they ran.
      throw new Error(`Unsupported workflow action: ${node.type}`)
    }
    if (reply) {
      const fitted = fitReply(reply)
      // A message made only of missing variables has nothing to say; the flow carries on
      if (fitted.type !== 'text' || fitted.body.trim()) {
        await adapter.send(fitted) // A failed send must stop the graph before any later action.
        replies.push(fitted)
      }
    }
    if (wait) return { currentNodeId, state, status: 'IN_PROGRESS', replies }
    node = getNextNode(nodes, edges, node.id)
  }
  if (node) throw new Error(`Workflow exceeded ${MAX_AUTOMATIC_STEPS} automatic steps; check for a loop`)
  await adapter.checkpoint?.(currentNodeId, state, 'COMPLETED')
  return { currentNodeId, state, status: 'COMPLETED', replies }
}
