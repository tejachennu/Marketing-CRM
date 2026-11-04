import type { WorkflowNode, WorkflowEdge, FlowNodeType } from './flow-types'
import { SUPPORTED_NODE_TYPES, getOutputHandles } from './flow-graph'

export interface WorkflowGraph {
  canvas_nodes: WorkflowNode[]
  canvas_edges: WorkflowEdge[]
}

const COLUMN = 340
const column = (index: number) => 80 + index * COLUMN
const DEFAULT_KEYWORDS = ['hi', 'hello', 'start']

// Words that say nothing about what a flow is for, so they make poor trigger keywords
const KEYWORD_STOP_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'with', 'from', 'by', 'my', 'our', 'your', 'new', 'flow', 'flows', 'workflow', 'form', 'bot', 'chatbot', 'automation', 'whatsapp', 'test', 'untitled'])
const WORD_CHARACTERS = new RegExp('[^\\p{L}\\p{N}\\s]', 'gu')

/**
 * Default trigger keywords for a flow called `name`: the name itself and its first distinctive
 * word, so two new flows do not both start on "hi" (the oldest would silently win). A name
 * without a usable word falls back to "start".
 */
export function suggestKeywords(name: string): string[] {
  const words = String(name || '').toLowerCase().replace(WORD_CHARACTERS, ' ').split(/\s+/)
    .filter(word => word.length > 1 && !/^\d+$/.test(word) && !KEYWORD_STOP_WORDS.has(word))
  const phrase = words.slice(0, 4).join(' ')
  const keywords = [...new Set([phrase, words[0]].filter(keyword => keyword && keyword.length <= 50))]
  return keywords.length ? keywords : ['start']
}

/**
 * The canvas a new workflow starts with. Every branch is connected, so it passes
 * validation and can be activated as-is, then edited.
 */
export function createStarterWorkflow(keywords: string[] = DEFAULT_KEYWORDS): WorkflowGraph {
  return {
    canvas_nodes: [
      { id: 'node-trigger', type: 'trigger', position: { x: column(0), y: 260 },
        data: { title: 'Customer message', trigger_type: 'keyword', keywords, match_mode: 'contains' } },
      { id: 'node-welcome', type: 'message', position: { x: column(1), y: 260 },
        data: { title: 'Welcome', body: 'Hello {{contact.name}}! 👋 Welcome. How can we help you today?' } },
      { id: 'node-menu', type: 'interactive_buttons', position: { x: column(2), y: 220 },
        data: { title: 'Main menu', body: 'Please choose an option:', buttons: [
          { id: 'btn_quote', title: 'Get a quote' },
          { id: 'btn_support', title: 'Talk to support' },
          { id: 'btn_question', title: 'Ask a question' },
        ] } },
      { id: 'node-lead', type: 'crm_deal_action', position: { x: column(3), y: 40 },
        data: { title: 'Create lead', pipeline_stage: 'lead_in', deal_name: 'Quote request from {{contact.name}}', monetary_value: 0 } },
      { id: 'node-lead-reply', type: 'message', position: { x: column(4), y: 40 },
        data: { title: 'Confirm quote request', body: 'Thanks! Our sales team will contact you shortly with a quote.' } },
      { id: 'node-ticket', type: 'ticket_action', position: { x: column(3), y: 300 },
        data: { title: 'Create ticket', subject: 'Support request from {{contact.name}}' } },
      { id: 'node-handoff-reply', type: 'message', position: { x: column(4), y: 300 },
        data: { title: 'Confirm handoff', body: 'We are connecting you with a teammate. They will reply here soon.' } },
      { id: 'node-handoff', type: 'assign_agent_action', position: { x: column(5), y: 300 },
        data: { title: 'Hand off to team', assignmentType: 'team_queue' } },
      { id: 'node-assistant', type: 'ai_rag_node', position: { x: column(3), y: 560 },
        data: { title: 'Knowledge assistant', promptText: 'Sure! Type your question and I’ll answer it right here.' } },
    ],
    canvas_edges: [
      { id: 'edge-trigger-welcome', source: 'node-trigger', target: 'node-welcome' },
      { id: 'edge-welcome-menu', source: 'node-welcome', target: 'node-menu' },
      { id: 'edge-menu-lead', source: 'node-menu', target: 'node-lead', sourceHandle: 'btn_quote' },
      { id: 'edge-lead-reply', source: 'node-lead', target: 'node-lead-reply' },
      { id: 'edge-menu-ticket', source: 'node-menu', target: 'node-ticket', sourceHandle: 'btn_support' },
      { id: 'edge-ticket-reply', source: 'node-ticket', target: 'node-handoff-reply' },
      { id: 'edge-reply-handoff', source: 'node-handoff-reply', target: 'node-handoff' },
      { id: 'edge-menu-assistant', source: 'node-menu', target: 'node-assistant', sourceHandle: 'btn_question' },
    ],
  }
}

/** A workflow that greets the customer, sends one native form and saves the answers as a lead. It starts on keywords taken from the form's name. */
export function createFormWorkflow(form: { id: string; name: string }): WorkflowGraph {
  return {
    canvas_nodes: [
      { id: 'node-trigger', type: 'trigger', position: { x: column(0), y: 180 },
        data: { title: 'Customer message', trigger_type: 'keyword', keywords: suggestKeywords(form.name), match_mode: 'contains' } },
      { id: 'node-intro', type: 'message', position: { x: column(1), y: 180 },
        data: { title: 'Introduce the form', body: 'Hello {{contact.name}}! 👋 Please complete the short form below.' } },
      { id: 'node-form', type: 'native_flow_trigger', position: { x: column(2), y: 180 },
        data: { title: form.name, native_flow_id: form.id, cta_text: 'Open form' } },
      { id: 'node-lead', type: 'crm_deal_action', position: { x: column(3), y: 180 },
        data: { title: 'Save as lead', pipeline_stage: 'lead_in', deal_name: `${form.name}: {{contact.name}}`, monetary_value: 0 } },
      { id: 'node-thanks', type: 'message', position: { x: column(4), y: 180 },
        data: { title: 'Thank the customer', body: 'Thank you! We have received your details and will be in touch.' } },
    ],
    canvas_edges: [
      { id: 'edge-trigger-intro', source: 'node-trigger', target: 'node-intro' },
      { id: 'edge-intro-form', source: 'node-intro', target: 'node-form' },
      { id: 'edge-form-lead', source: 'node-form', target: 'node-lead' },
      { id: 'edge-lead-thanks', source: 'node-lead', target: 'node-thanks' },
    ],
  }
}

/**
 * Clean up a graph produced outside the builder (the AI generator) so it can be opened
 * and edited: unknown node types, malformed nodes and dangling connections are dropped,
 * exactly one trigger is kept, and connections only leave outputs the runtime follows.
 * `keywords` seed a trigger that has none. Remaining problems are left for validation to report.
 */
export function sanitizeWorkflowGraph(rawNodes: unknown, rawEdges: unknown, options: { keywords?: string[] } = {}): WorkflowGraph {
  const supported = new Set<string>(SUPPORTED_NODE_TYPES)
  const keywords = options.keywords?.length ? options.keywords : DEFAULT_KEYWORDS
  const seen = new Map<string, WorkflowNode>()
  const nodes: WorkflowNode[] = []
  let hasTrigger = false

  for (const [index, raw] of (Array.isArray(rawNodes) ? rawNodes : []).slice(0, 100).entries()) {
    if (!raw || typeof raw !== 'object') continue
    const candidate = raw as Record<string, any>
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
    if (!id || seen.has(id) || !supported.has(candidate.type)) continue
    if (candidate.type === 'trigger') {
      if (hasTrigger) continue
      hasTrigger = true
    }
    const data = candidate.data && typeof candidate.data === 'object' && !Array.isArray(candidate.data) ? { ...candidate.data } : {}
    // A keyword trigger without keywords could never fire; give it the flow's own
    if (candidate.type === 'trigger' && (data.triggerType || data.trigger_type || 'keyword') === 'keyword' && !(Array.isArray(data.keywords) && data.keywords.some((keyword: unknown) => String(keyword ?? '').trim()))) data.keywords = keywords
    const x = Number(candidate.position?.x)
    const y = Number(candidate.position?.y)
    const node: WorkflowNode = {
      id,
      type: candidate.type as FlowNodeType,
      // Fall back to a simple left-to-right layout when positions are missing
      position: { x: Number.isFinite(x) ? x : column(index), y: Number.isFinite(y) ? y : 200 },
      data,
    }
    seen.set(id, node)
    nodes.push(node)
  }

  if (!hasTrigger) {
    const first = nodes[0]
    const trigger: WorkflowNode = { id: 'node-trigger', type: 'trigger', position: { x: (first?.position.x ?? column(1)) - COLUMN, y: first?.position.y ?? 200 },
      data: { title: 'Customer message', trigger_type: 'keyword', keywords, match_mode: 'contains' } }
    nodes.unshift(trigger)
    seen.set('node-trigger', trigger)
  }

  const edges: WorkflowEdge[] = []
  const usedOutputs = new Set<string>()
  for (const [index, raw] of (Array.isArray(rawEdges) ? rawEdges : []).slice(0, 300).entries()) {
    if (!raw || typeof raw !== 'object') continue
    const candidate = raw as Record<string, any>
    const source = seen.get(candidate.source)
    if (!source || !seen.has(candidate.target) || candidate.source === candidate.target) continue
    let sourceHandle = typeof candidate.sourceHandle === 'string' && candidate.sourceHandle ? candidate.sourceHandle : undefined
    // The runtime only follows a handle that names a real output: on a single-output block the
    // handle is dropped, and a connection from a choice that does not exist is discarded
    const outputs = getOutputHandles(source)
    if (sourceHandle && !outputs) sourceHandle = undefined
    else if (sourceHandle && outputs && !outputs.includes(sourceHandle)) continue
    const output = `${candidate.source}::${sourceHandle || ''}`
    if (usedOutputs.has(output)) continue // one connection per output
    usedOutputs.add(output)
    edges.push({ id: `edge-${index}-${candidate.source}-${candidate.target}`, source: candidate.source, target: candidate.target, ...(sourceHandle ? { sourceHandle } : {}) })
  }

  // A freshly added trigger needs something to start
  if (!hasTrigger && nodes.length > 1 && !edges.some(edge => edge.source === 'node-trigger')) {
    edges.unshift({ id: 'edge-trigger-start', source: 'node-trigger', target: nodes[1].id })
  }

  return { canvas_nodes: nodes, canvas_edges: edges }
}

/** The trigger settings stored on the workflow row, derived from its trigger node. */
export function getTriggerSummary(nodes: WorkflowNode[]): { trigger_type: string; trigger_config: { keywords: string[]; match_mode: string } } {
  const data: Record<string, any> = nodes.find(node => node.type === 'trigger')?.data || {}
  const type = data.triggerType || data.trigger_type || 'keyword'
  const mode = data.matchType || data.match_mode
  return {
    trigger_type: type,
    trigger_config: {
      keywords: type === 'keyword' && Array.isArray(data.keywords) ? data.keywords.map((keyword: unknown) => String(keyword).trim()).filter(Boolean) : [],
      match_mode: mode === 'exact' ? 'exact' : 'contains',
    },
  }
}
