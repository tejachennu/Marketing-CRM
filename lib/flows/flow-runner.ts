import type { WorkflowNode, WorkflowEdge } from './flow-types'
import { readNodeField, interpolateVariables, evaluateCondition, getNextNode, getChoices } from './flow-graph'

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
/** Both the simulator and live delivery use this bounded transition loop. */
export async function runFlow(nodes: WorkflowNode[], edges: WorkflowEdge[], first: WorkflowNode, initialState: Record<string, any>, adapter: RunAdapter): Promise<RunResult> {
  let node: WorkflowNode | undefined = first
  let state = { ...initialState }
  const replies: FlowReply[] = []
  let currentNodeId = first.id
  const deadline = Date.now() + 90000
  for (let steps = 0; node && steps < 50; steps++) {
    if (Date.now() > deadline) throw new Error('Workflow exceeded its execution time limit')
    currentNodeId = node.id
    await adapter.checkpoint?.(node.id, state, 'IN_PROGRESS')
    const data: Record<string, any> = node.data || {}
    const text = (value: string) => interpolateVariables(value, state)
    let reply: FlowReply | undefined
    let wait = false
    if (node.type === 'message') reply = { type: 'text', body: text(readNodeField(data, 'messageText', 'body', 'message_text')) }
    else if (node.type === 'interactive_buttons') {
      reply = { type: 'interactive_buttons', body: text(readNodeField(data, 'bodyText', 'body', 'body_text')), buttons: getChoices(node).map(choice => ({ id: choice.id, title: text(choice.title) })) }
      wait = true
    } else if (node.type === 'list_menu') {
      reply = { type: 'list_menu', body: text(readNodeField(data, 'bodyText', 'body', 'body_text')), buttonText: readNodeField(data, 'buttonText', 'button_text') || 'Choose', sections: data.sections }
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
    } else if (node.type !== 'trigger') throw new Error(`Unsupported workflow action: ${node.type}`)
    if (reply) {
      await adapter.send(reply) // A failed send must stop the graph before any later action.
      replies.push(reply)
    }
    if (wait) return { currentNodeId, state, status: 'IN_PROGRESS', replies }
    node = getNextNode(nodes, edges, node.id)
  }
  if (node) throw new Error('Workflow exceeded 50 automatic steps; check for a loop')
  await adapter.checkpoint?.(currentNodeId, state, 'COMPLETED')
  return { currentNodeId, state, status: 'COMPLETED', replies }
}
