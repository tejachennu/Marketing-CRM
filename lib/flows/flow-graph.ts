import type { WhatsAppWorkflow, WorkflowNode, WorkflowEdge } from './flow-types'

const UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype']

export function readNodeField(data: Record<string, any> | null | undefined, ...keys: string[]): any {
  const source = data || {}
  return keys.map(key => source[key]).find(value => value !== undefined && value !== null && value !== '')
}
export function getStartNode(workflow: Pick<WhatsAppWorkflow, 'canvas_nodes'>) {
  return Array.isArray(workflow?.canvas_nodes) ? workflow.canvas_nodes.find(node => node?.type === 'trigger') : undefined
}
export function getOutgoingEdges(edges: WorkflowEdge[], nodeId: string) {
  return (Array.isArray(edges) ? edges : []).filter(edge => edge?.source === nodeId)
}
export function getNextNode(nodes: WorkflowNode[], edges: WorkflowEdge[], nodeId: string, handle?: string) {
  const outgoing = getOutgoingEdges(edges, nodeId)
  const edge = handle ? outgoing.find(edge => edge.sourceHandle === handle) || outgoing.find(edge => !edge.sourceHandle)
    : outgoing.find(edge => !edge.sourceHandle)
  return edge ? (Array.isArray(nodes) ? nodes : []).find(node => node?.id === edge.target) : undefined
}
export function getStateValue(state: Record<string, any>, path: string): any {
  return String(path || '').split('.').reduce((value, key) =>
    value && Object.hasOwn(value, key) && !UNSAFE_KEYS.includes(key) ? value[key] : undefined, state as any)
}
/** One state value as a customer reads it: lists separated by commas, objects as JSON, nothing as "". */
export function formatStateValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) return value.map(formatStateValue).filter(Boolean).join(', ')
  if (typeof value === 'object') {
    try { return JSON.stringify(value) } catch { return '' }
  }
  return String(value)
}
const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g
/** Fills in {{variables}}. A missing one renders as nothing: a customer never sees "undefined" or a raw placeholder. */
export function interpolateVariables(template: string, state: Record<string, any>): string {
  return String(template || '').replace(PLACEHOLDER, (_match, key) => formatStateValue(getStateValue(state || {}, key)))
}
/** The variable names a text refers to, as written between the braces. */
export function getPlaceholders(template: unknown): string[] {
  return Array.from(String(template ?? '').matchAll(PLACEHOLDER), match => match[1])
}
export interface Choice { id: string; title: string; description?: string; targetNodeId?: string }
export function getChoices(node: WorkflowNode): Choice[] {
  const data: Record<string, any> = node?.data || {}
  const choices: unknown[] = node?.type === 'list_menu'
    ? (Array.isArray(data.sections) ? data.sections : []).flatMap((section: any) => (Array.isArray(section?.rows) ? section.rows : []))
    : Array.isArray(data.buttons) ? data.buttons : []
  return choices.filter((choice): choice is Choice => Boolean(choice) && typeof choice === 'object')
}
/** The labelled outputs of a branching block (its choice IDs, or true/false), or null for a block with one "next" output. */
export function getOutputHandles(node: WorkflowNode): string[] | null {
  if (node?.type === 'interactive_buttons' || node?.type === 'list_menu') return getChoices(node).map(choice => String(choice.id ?? ''))
  if (node?.type === 'condition_branch') return ['true', 'false']
  return null
}
export function resolveReply(node: WorkflowNode, nodes: WorkflowNode[], edges: WorkflowEdge[], text: string, buttonId?: string) {
  const input = String(buttonId || text || '').trim().toLowerCase()
  const choice = input ? getChoices(node).find(choice => String(choice.id ?? '').toLowerCase() === input || (!buttonId && String(choice.title ?? '').toLowerCase() === input)) : undefined
  if (!choice) return { matched: false, next: undefined }
  return { matched: true, choice, next: choice.targetNodeId ? nodes.find(node => node.id === choice.targetNodeId) : getNextNode(nodes, edges, node.id, choice.id) }
}
/** A number when the value reads as one ("10", "10.0", 10); words and blanks compare as text instead. */
function asNumber(value: unknown): number | null {
  if (typeof value === 'boolean' || value === null || value === undefined) return null
  const text = String(value).trim()
  if (!text) return null
  const number = Number(text)
  return Number.isFinite(number) ? number : null
}
export function evaluateCondition(data: Record<string, any>, state: Record<string, any>) {
  const value = getStateValue(state, readNodeField(data, 'variableName', 'variable_name', 'variable') || '')
  const comparison = interpolateVariables(String(readNodeField(data, 'compareValue', 'compare_value', 'value') ?? ''), state)
  const left = asNumber(value), right = asNumber(comparison)
  // "10", 10 and "10.0" are the same amount; when either side is not a number both compare as text
  const numeric = left !== null && right !== null
  const text = formatStateValue(value)
  // "Pro" and " pro " are the same answer: a customer's typing or a button label never differ by case or spacing on purpose
  const same = text.trim().toLowerCase() === comparison.trim().toLowerCase()
  switch (data?.operator) {
    case 'is_set': return value !== undefined && value !== null && value !== ''
    case 'equals': return numeric ? left === right : same
    case 'not_equals': return numeric ? left !== right : !same
    case 'contains': return text.toLowerCase().includes(comparison.toLowerCase())
    case 'greater_than': return numeric && left! > right!
    case 'less_than': return numeric && left! < right!
    default: throw new Error('Select a supported condition operator')
  }
}
export function matchesTrigger(workflow: WhatsAppWorkflow, input: string, isFirstMessage = false) {
  const data: Record<string, any> = { ...(workflow?.trigger_config || {}), ...(getStartNode(workflow)?.data || {}) }
  const type = readNodeField(data, 'triggerType', 'trigger_type') || workflow?.trigger_type
  if (type === 'first_message') return isFirstMessage
  if (type !== 'keyword') return false
  const mode = readNodeField(data, 'matchType', 'match_mode') || 'contains'
  if (!['exact', 'contains', 'fuzzy'].includes(mode)) return false
  return (Array.isArray(data.keywords) ? data.keywords : []).some((keyword: unknown) => keywordMatches(input, String(keyword ?? ''), mode))
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const normalizeKeyword = (keyword: unknown) => String(keyword ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
/**
 * Whether a message matches one trigger keyword. "contains" matches whole words or phrases, so
 * "hi" fires on "Hi there" but not on "Which size?" or "Do you ship?"; "fuzzy" matches anywhere.
 */
export function keywordMatches(input: string, keyword: string, mode = 'contains'): boolean {
  const key = normalizeKeyword(keyword)
  const text = normalizeKeyword(input)
  if (!key || !text) return false
  if (mode === 'exact') return text === key
  if (mode === 'fuzzy') return text.includes(key)
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(key)}($|[^\\p{L}\\p{N}])`, 'u').test(text)
}

type TriggerSource = Pick<WhatsAppWorkflow, 'canvas_nodes'> & Partial<Pick<WhatsAppWorkflow, 'trigger_type' | 'trigger_config'>>
/** A workflow's trigger as the runtime reads it: the trigger node first, the summary columns as a fallback. */
export function getTriggerSettings(workflow: TriggerSource): { type: string; mode: string; keywords: string[] } {
  const data: Record<string, any> = { ...(workflow?.trigger_config || {}), ...(getStartNode(workflow)?.data || {}) }
  const type = readNodeField(data, 'triggerType', 'trigger_type') || workflow?.trigger_type || 'keyword'
  const mode = readNodeField(data, 'matchType', 'match_mode') || 'contains'
  const keywords = type === 'keyword' && Array.isArray(data.keywords) ? [...new Set(data.keywords.map(normalizeKeyword).filter(Boolean))] : []
  return { type, mode, keywords }
}
export interface TriggerConflict {
  /** The other flow that would take the same messages. */
  workflowId: string
  workflowName: string
  /** The keywords of the flow that loses them (this one, or the other); empty when both start on the first message. */
  keywords: string[]
  /** One sentence for the activation refusal. */
  message: string
  /** A short form for the list page. */
  note: string
}
type ConflictSource = TriggerSource & { id?: string; created_at?: string | null }
/**
 * Whether `older` is tried before `newer` for a message, as the runtime orders live flows (oldest
 * first). Null when that cannot be told (same or unknown time). A flow without a creation time
 * has not been saved yet, so it counts as the newest.
 */
function triedFirst(older: ConflictSource, newer: ConflictSource): boolean | null {
  const a = Date.parse(String(older.created_at ?? '')), b = Date.parse(String(newer.created_at ?? ''))
  if (Number.isNaN(a) && Number.isNaN(b)) return null
  if (Number.isNaN(b)) return true
  if (Number.isNaN(a)) return false
  return a === b ? null : a < b
}
/**
 * The keywords of `loser` that every message starting it would start `winner` instead, because
 * the winner is tried first. Approximated per keyword: the winner's keyword matches the loser's
 * keyword, under a winner mode at least as broad as the loser's (exact < contains < fuzzy).
 */
function shadowedKeywords(loser: { mode: string; keywords: string[] }, winner: { mode: string; keywords: string[] }): string[] {
  const breadth: Record<string, number> = { exact: 0, contains: 1, fuzzy: 2 }
  if (!(loser.mode in breadth) || !(winner.mode in breadth)) return []
  // An exact keyword is one message, so any winner that matches it takes all of it
  if (loser.mode !== 'exact' && breadth[winner.mode] < breadth[loser.mode]) return []
  return loser.keywords.filter(keyword => winner.keywords.some(theirs => keywordMatches(keyword, theirs, winner.mode)))
}
/**
 * Why this flow and another live flow would fight over the same message: a keyword of one that the
 * older flow (tried first) would always take, such as "order status" under an older "order", or
 * two first-message triggers. The oldest flow would silently win, so activation refuses these
 * instead. A newer, broader keyword next to an older, specific one is fine: each keeps its messages.
 */
export function getTriggerConflicts(workflow: ConflictSource, others: Array<ConflictSource & { id: string; name: string }>): TriggerConflict[] {
  const own = getTriggerSettings(workflow)
  const conflicts: TriggerConflict[] = []
  const quote = (keywords: string[]) => keywords.map(keyword => `"${keyword}"`).join(', ')
  for (const other of others) {
    if (!other || other.id === workflow.id) continue
    const theirs = getTriggerSettings(other)
    if (own.type === 'first_message' && theirs.type === 'first_message') {
      conflicts.push({ workflowId: other.id, workflowName: other.name, keywords: [],
        message: `"${other.name}" already starts on a customer's first message; pause it, or start this flow on a keyword instead`,
        note: `First-message trigger also used by "${other.name}"` })
      continue
    }
    if (own.type !== 'keyword' || theirs.type !== 'keyword') continue
    const otherFirst = triedFirst(other, workflow)
    // When the order cannot be told, either flow could be the one that wins
    const ownLoses = otherFirst !== false ? shadowedKeywords(own, theirs) : []
    const otherLoses = ownLoses.length || otherFirst === true ? [] : shadowedKeywords(theirs, own)
    const lost = ownLoses.length ? ownLoses : otherLoses
    if (!lost.length) continue
    const winner = ownLoses.length ? theirs : own
    const list = quote(lost)
    const plural = lost.length > 1
    if (lost.every(keyword => winner.keywords.includes(keyword))) {
      conflicts.push({ workflowId: other.id, workflowName: other.name, keywords: lost,
        message: `The keyword${plural ? 's' : ''} ${list} already start${plural ? '' : 's'} "${other.name}"; change the keywords in one of the two flows`,
        note: `Keyword${plural ? 's' : ''} ${list} also used by "${other.name}"` })
    } else if (ownLoses.length) {
      conflicts.push({ workflowId: other.id, workflowName: other.name, keywords: lost,
        message: `The older flow "${other.name}" starts on ${quote(theirs.keywords)} (${theirs.mode} match), so it would take every message for ${list}; change the keywords in one of the two flows`,
        note: `${list} would start the older "${other.name}" instead` })
    } else {
      conflicts.push({ workflowId: other.id, workflowName: other.name, keywords: lost,
        message: `This flow is older than "${other.name}" and starts on ${quote(own.keywords)} (${own.mode} match), so it would take every message for ${list} from it; change the keywords in one of the two flows`,
        note: `Would take ${list} from "${other.name}"` })
    }
  }
  return conflicts
}

/** Node types the runtime can execute. The builder only offers these; anything else fails validation. */
export const SUPPORTED_NODE_TYPES = ['trigger', 'message', 'interactive_buttons', 'list_menu', 'native_flow_trigger', 'condition_branch', 'crm_deal_action', 'ticket_action', 'assign_agent_action', 'ai_rag_node', 'set_variable', 'tag_action'] as const
const supported = new Set<string>(SUPPORTED_NODE_TYPES)
/** How a hand-off picks the person: the shared queue, teammates in turn, or one chosen agent. */
export const ASSIGNMENT_TYPES = ['team_queue', 'round_robin', 'specific_user'] as const
/** The longest text WhatsApp shows above an interactive message, a form included. */
export const INTERACTIVE_BODY_LIMIT = 1024

/** State written by the engine itself; a workflow must not be able to overwrite it. */
const RESERVED_VARIABLE_ROOTS = ['contact', 'org']
/** A variable path such as `score` or `lead.tier`, or the reason it cannot be used. */
export function getVariableNameError(name: string): string | null {
  if (!name) return 'enter a variable name'
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/.test(name)) return 'variable names use letters, numbers and underscores, with dots for nesting'
  const parts = name.split('.')
  if (parts.some(part => UNSAFE_KEYS.includes(part))) return 'choose a different variable name'
  if (RESERVED_VARIABLE_ROOTS.includes(parts[0])) return `"${parts[0]}" is filled in automatically; choose a different variable name`
  return null
}
/** Returns a copy of `state` with `path` set, never touching prototypes or the caller's nested objects. */
export function setStateValue(state: Record<string, any>, path: string, value: any): Record<string, any> {
  const [head, ...rest] = path.split('.')
  if (UNSAFE_KEYS.includes(head)) throw new Error('Unsafe variable name')
  if (!rest.length) return { ...state, [head]: value }
  const existing = Object.hasOwn(state, head) && state[head] && typeof state[head] === 'object' && !Array.isArray(state[head]) ? state[head] : {}
  return { ...state, [head]: setStateValue(existing, rest.join('.'), value) }
}
/** Tags as stored on a contact: trimmed, de-duplicated, at most 20. */
export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  return [...new Set(tags.map(tag => String(tag ?? '').trim()).filter(Boolean))].slice(0, 20)
}

// ── Which variables exist at each block ───────────────────────────────────────
/** The variables every block can use, in the order the builder offers them. */
export const BUILT_IN_VARIABLES = ['contact.name', 'contact.phone', 'contact.first_name', 'contact.last_name', 'contact.email', 'contact.company', 'org.name', 'last_input']
// The engine also passes the rest of the contact row, the customer as {{name}} / {{phone}} and the first message as
// {{trigger_text}}; older flows use these, and a live flow must never be paused over a column that really exists
const OTHER_BUILT_INS = ['contact.id', 'contact.organization_id', 'contact.phone_number', 'contact.whatsapp_number', 'contact.tags', 'contact.created_by', 'contact.created_at', 'contact.updated_at', 'name', 'phone', 'trigger_text']
const CONTACT_FIELDS_HINT = 'contact.name, contact.phone, contact.first_name, contact.last_name, contact.email or contact.company'
export interface NodeVariables {
  /** The exact variable paths a placeholder can name at this block. */
  paths: string[]
  /** Roots whose every field is available, such as "form" once a form has been answered. */
  roots: string[]
}
/** What a block adds to the state for the blocks after it. */
function getProvidedVariables(node: WorkflowNode): NodeVariables {
  const data: Record<string, any> = node.data || {}
  switch (node.type) {
    case 'interactive_buttons': case 'list_menu': {
      const variable = String(readNodeField(data, 'variableName', 'variable_name') || '').trim()
      return { paths: ['last_choice', 'last_choice_title', ...(variable ? [variable] : [])], roots: [] }
    }
    case 'native_flow_trigger': return { paths: ['submission_id'], roots: ['form', 'submission'] }
    case 'set_variable': {
      const name = String(readNodeField(data, 'variableName', 'variable_name') || '').trim()
      return { paths: name ? [name] : [], roots: [] }
    }
    case 'crm_deal_action': return { paths: ['deal_id'], roots: [] }
    case 'ticket_action': return { paths: ['ticket_id'], roots: [] }
    case 'tag_action': return { paths: ['contact_tags'], roots: [] }
    default: return { paths: [], roots: [] }
  }
}
/** Every block one step can lead to: its connections, branch targets and choice targets. */
function getSuccessorIds(node: WorkflowNode, edges: WorkflowEdge[]): string[] {
  const data: Record<string, any> = node.data || {}
  const targets: unknown[] = [...getOutgoingEdges(edges, node.id).map(edge => edge.target), data.trueTargetNodeId, data.falseTargetNodeId, data.onSuccessNodeId, ...getChoices(node).map(choice => choice.targetNodeId)]
  return targets.filter((id): id is string => typeof id === 'string' && Boolean(id))
}
/**
 * The variables available at each block: the built-ins everywhere, plus whatever the blocks before
 * it set (a choice, a form's answers, a variable, a created lead). A value set on any path into a
 * block counts, so a step after a menu is not refused an answer that one of the branches collects.
 */
export function getVariablesByNode(nodes: WorkflowNode[], edges: WorkflowEdge[]): Map<string, NodeVariables> {
  const list = Array.isArray(nodes) ? nodes.filter(node => node && typeof node.id === 'string') : []
  const available = new Map<string, { paths: Set<string>; roots: Set<string> }>()
  for (const node of list) available.set(node.id, { paths: new Set([...BUILT_IN_VARIABLES, ...OTHER_BUILT_INS]), roots: new Set() })
  // Propagate until nothing changes: the graph may loop back through blocks that wait for the customer
  let changed = true
  for (let round = 0; changed && round <= list.length; round++) {
    changed = false
    for (const node of list) {
      const own = available.get(node.id)!
      const provided = getProvidedVariables(node)
      for (const id of getSuccessorIds(node, edges)) {
        const next = available.get(id)
        if (!next || id === node.id) continue
        for (const path of [...own.paths, ...provided.paths]) if (!next.paths.has(path)) { next.paths.add(path); changed = true }
        for (const root of [...own.roots, ...provided.roots]) if (!next.roots.has(root)) { next.roots.add(root); changed = true }
      }
    }
  }
  return new Map([...available].map(([id, value]) => [id, { paths: [...value.paths], roots: [...value.roots] }]))
}
/** The variables worth offering in the builder at a block: without the older spellings the engine only keeps for existing flows. */
export function listOfferedVariables(variables: NodeVariables | undefined): string[] {
  return (variables?.paths || BUILT_IN_VARIABLES).filter(path => !OTHER_BUILT_INS.includes(path))
}
/** Why a variable cannot be used at a block, or null when it can. */
function getVariableProblem(path: string, variables: NodeVariables): string | null {
  if (variables.paths.includes(path)) return null
  const [root] = path.split('.')
  const nested = path.includes('.')
  if (variables.roots.includes(root)) return nested ? null : `needs the answer's name, for example {{${root}.full_name}}`
  if (root === 'form' || root === 'submission') return 'is only available after a WhatsApp form block'
  if (root === 'contact' || root === 'org') return nested ? `is not a known field; use ${root === 'org' ? 'org.name' : CONTACT_FIELDS_HINT}` : `needs a field name, for example {{${root}.name}}`
  if (root === 'last_choice' || root === 'last_choice_title') return 'is only available after a buttons or list block'
  if (root === 'deal_id') return 'is only available after a "Create lead" block'
  if (root === 'ticket_id') return 'is only available after a "Create ticket" block'
  return 'is not set by any block before this one'
}
/** The texts of a block that are filled in with {{variables}} before they reach the customer or the CRM. */
function getTemplateTexts(node: WorkflowNode): string[] {
  const data: Record<string, any> = node.data || {}
  const texts: unknown[] = []
  switch (node.type) {
    case 'message': texts.push(readNodeField(data, 'messageText', 'body', 'message_text')); break
    case 'interactive_buttons': case 'list_menu': texts.push(readNodeField(data, 'bodyText', 'body', 'body_text')); break
    case 'native_flow_trigger': texts.push(data.description); break
    case 'ai_rag_node': texts.push(readNodeField(data, 'promptText', 'prompt', 'description')); break
    case 'condition_branch': texts.push(readNodeField(data, 'compareValue', 'compare_value', 'value')); break
    case 'set_variable': texts.push(readNodeField(data, 'valueExpression', 'value_expression')); break
    case 'crm_deal_action': texts.push(readNodeField(data, 'dealTitle', 'deal_name', 'deal_title'), readNodeField(data, 'dealValue', 'monetary_value', 'deal_value')); break
    case 'ticket_action': texts.push(data.subject); break
    case 'tag_action': texts.push(...(Array.isArray(data.tags) ? data.tags : [])); break
  }
  return texts.filter((text): text is string => typeof text === 'string')
}

export interface WorkflowIssue {
  /** The block the problem belongs to; absent for problems with the flow as a whole. */
  nodeId?: string
  message: string
  /** The same text validateWorkflow reports: "<block title>: <message>". */
  text: string
  /** Worth fixing, but the flow still runs: a warning never blocks activation. */
  warning?: true
  /**
   * Blocks activation, but a flow that is already live keeps running with it: the runtime survives
   * it (a placeholder renders blank, a stale connection is never followed). Flows activated before
   * these checks existed must not be paused over them.
   */
  activationOnly?: true
}

/** Everything that stops a workflow from running, attached to the block it concerns, plus warnings about what it could do better. */
export function getWorkflowIssues(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowIssue[] {
  const issues: WorkflowIssue[] = []
  const errors = { push: (message: string) => issues.push({ message, text: message }) }
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return [{ message: 'Nodes and connections must be arrays', text: 'Nodes and connections must be arrays' }]
  if (nodes.length > 100 || edges.length > 300) return [{ message: 'Use at most 100 nodes and 300 connections', text: 'Use at most 100 nodes and 300 connections' }]
  // Graphs also arrive from the API and the AI generator, not only from the builder
  if (nodes.some(node => !node || typeof node !== 'object' || typeof node.id !== 'string' || !node.id || typeof node.type !== 'string')) return [{ message: 'Every block needs an ID and a type', text: 'Every block needs an ID and a type' }]
  if (edges.some(edge => !edge || typeof edge !== 'object')) return [{ message: 'A connection is malformed', text: 'A connection is malformed' }]
  if (nodes.filter(node => node.type === 'trigger').length !== 1) errors.push('Add exactly one trigger')
  const ids = new Set(nodes.map(node => node.id))
  if (ids.size !== nodes.length) errors.push('Node IDs must be unique')
  for (const edge of edges) if (!ids.has(edge.source) || !ids.has(edge.target)) errors.push('A connection points to a missing node')
  const variablesByNode = getVariablesByNode(nodes, edges)
  for (const node of nodes) {
    const data = node.data || {}
    const label = data.title || node.id
    const fail = (message: string) => issues.push({ nodeId: node.id, message, text: `${label}: ${message}` })
    const warn = (message: string) => issues.push({ nodeId: node.id, message, text: `${label}: ${message}`, warning: true })
    const gate = (message: string) => issues.push({ nodeId: node.id, message, text: `${label}: ${message}`, activationOnly: true })
    if (!supported.has(node.type)) fail('this action is not supported yet')
    const outgoing = getOutgoingEdges(edges, node.id)
    const handles = outgoing.map(edge => edge.sourceHandle || '')
    if (new Set(handles).size !== handles.length) fail('each output must have only one connection')
    // The runtime follows a handle only when it names a real output; any other connection would never be taken
    const outputs = getOutputHandles(node)
    for (const edge of outgoing) {
      if (edge.sourceHandle && (!outputs || !outputs.includes(edge.sourceHandle))) gate(`a connection leaves an output this block does not have ("${edge.sourceHandle}"); remove it and connect the block again`)
    }
    // A placeholder nothing fills in reaches the customer as a blank
    const variables = variablesByNode.get(node.id) || { paths: BUILT_IN_VARIABLES, roots: [] }
    const seenPlaceholders = new Set<string>()
    for (const text of getTemplateTexts(node)) {
      for (const placeholder of getPlaceholders(text)) {
        if (seenPlaceholders.has(placeholder)) continue
        seenPlaceholders.add(placeholder)
        const problem = getVariableProblem(placeholder, variables)
        if (problem) gate(`{{${placeholder}}} ${problem}`)
      }
    }
    if (node.type === 'trigger') {
      if (!getNextNode(nodes, edges, node.id)) fail('connect the trigger to an action')
      const type = readNodeField(data, 'triggerType', 'trigger_type') || 'keyword'
      if (!['keyword', 'first_message'].includes(type)) fail('only keyword and first-message triggers are available')
      if (type === 'keyword' && (!Array.isArray(data.keywords) || !data.keywords.some((key: unknown) => String(key ?? '').trim()))) fail('add at least one keyword')
      const mode = readNodeField(data, 'matchType', 'match_mode')
      if (mode && !['exact', 'contains', 'fuzzy'].includes(mode)) fail('use exact or contains keyword matching')
    }
    if (['message', 'interactive_buttons', 'list_menu'].includes(node.type)) {
      const body = String(readNodeField(data, 'messageText', 'bodyText', 'body', 'message_text', 'body_text') ?? '')
      if (!body.trim()) fail('enter a message')
      if (body.length > (node.type === 'message' ? 4096 : INTERACTIVE_BODY_LIMIT)) fail('message is too long for WhatsApp')
    }
    if (['interactive_buttons', 'list_menu'].includes(node.type)) {
      const choices = getChoices(node)
      const max = node.type === 'interactive_buttons' ? 3 : 10
      if (!choices.length || choices.length > max) fail(`provide between 1 and ${max} choices`)
      if (new Set(choices.map(choice => choice.id)).size !== choices.length) fail('choice IDs must be unique')
      if (new Set(choices.map(choice => String(choice.title || '').trim().toLowerCase())).size !== choices.length) fail('choice titles must be different from each other')
      for (const choice of choices) {
        if (!choice.id || !choice.title || String(choice.title).length > (max === 3 ? 20 : 24)) fail('a choice has an empty ID or an invalid title length')
        // Titles are sent as written: a {{variable}} could push one past WhatsApp's limit at send time
        if (/\{\{/.test(String(choice.title || ''))) fail(`"${choice.title}": choice titles can't contain {{variables}}`)
        if (node.type === 'list_menu' && String(choice.description || '').length > 72) fail(`"${choice.title}": descriptions must be at most 72 characters`)
        if (choice.targetNodeId ? !ids.has(choice.targetNodeId) : !getNextNode(nodes, edges, node.id, choice.id)) fail(`connect the "${choice.title}" choice`)
      }
      if (node.type === 'list_menu' && String(readNodeField(data, 'buttonText', 'button_text') || 'Choose').length > 20) fail('list button label must be at most 20 characters')
      if (node.type === 'list_menu') {
        const sections = Array.isArray(data.sections) ? data.sections : []
        if (sections.length > 10) fail('use at most 10 sections')
        if (sections.some((section: any) => String(section?.title || '').length > 24)) fail('section titles must be at most 24 characters')
        if (sections.length > 1 && sections.some((section: any) => !String(section?.title || '').trim())) fail('give every section a title when there is more than one')
        if (sections.some((section: any) => !Array.isArray(section?.rows) || !section.rows.length)) fail('every section needs at least one option')
      }
    }
    if (node.type === 'native_flow_trigger') {
      if (!readNodeField(data, 'flowId', 'native_flow_id', 'flow_id')) fail('select a published native form')
      if (String(readNodeField(data, 'flowCtaText', 'cta_text', 'flow_cta_text') || 'Open Form').length > 30) fail('form button must be at most 30 characters')
      // The text above the form travels in the same interactive message as a question would
      if (String(data.description || '').length > INTERACTIVE_BODY_LIMIT) fail(`the message above the form must be at most ${INTERACTIVE_BODY_LIMIT} characters`)
      if (!data.onSuccessNodeId && !getNextNode(nodes, edges, node.id)) warn('nothing follows this form, so the customer only gets a short "Thanks, we received your form." after submitting it')
    }
    if (node.type === 'condition_branch') {
      const variable = readNodeField(data, 'variableName', 'variable_name', 'variable')
      if (!variable) fail('select a variable')
      else {
        const problem = getVariableProblem(String(variable), variables)
        if (problem) gate(`the value "${variable}" ${problem}`)
      }
      if (!['equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'is_set'].includes(data.operator)) fail('select a condition operator')
      // Each outcome needs its own connection; one plain connection would send both outcomes to the same block
      for (const branch of ['true', 'false']) {
        const target = data[`${branch}TargetNodeId`]
        if (target ? !ids.has(target) : !getOutgoingEdges(edges, node.id).some(edge => edge.sourceHandle === branch)) fail(`connect the "${branch === 'true' ? 'If it matches' : 'Otherwise'}" branch`)
      }
    }
    if (node.type === 'set_variable') {
      const problem = getVariableNameError(String(readNodeField(data, 'variableName', 'variable_name') || '').trim())
      if (problem) fail(problem)
      if (!['text', 'number', 'boolean', 'json', undefined].includes(readNodeField(data, 'valueType', 'value_type'))) fail('select a value type')
    }
    if (node.type === 'tag_action') {
      const tags = normalizeTags(data.tags)
      if (!tags.length) fail('add at least one tag')
      if (tags.some(tag => tag.length > 50)) fail('tags must be at most 50 characters')
      if (!['add', 'remove', undefined].includes(readNodeField(data, 'action', 'tag_action_type'))) fail('choose whether to add or remove tags')
    }
    if (node.type === 'assign_agent_action') {
      const type = readNodeField(data, 'assignmentType', 'assignment_type') || 'team_queue'
      if (!(ASSIGNMENT_TYPES as readonly string[]).includes(type)) fail('choose the team queue, round-robin or a specific agent')
      if (type === 'specific_user' && !readNodeField(data, 'assignedUserId', 'assigned_user_id')) fail('select an agent')
    }
  }
  // Refuse automatic cycles; reply nodes provide a safe boundary between turns.
  const visiting = new Set<string>(), visited = new Set<string>()
  const walk = (node: WorkflowNode): boolean => {
    if (visiting.has(node.id)) return true
    if (visited.has(node.id) || ['interactive_buttons', 'list_menu', 'native_flow_trigger', 'ai_rag_node', 'assign_agent_action'].includes(node.type)) return false
    visiting.add(node.id)
    const targets = [...getOutgoingEdges(edges, node.id).map(edge => edge.target), node.data?.trueTargetNodeId, node.data?.falseTargetNodeId].filter(Boolean)
    if (targets.some(id => { const next = nodes.find(node => node.id === id); return next ? walk(next) : false })) return true
    visiting.delete(node.id); visited.add(node.id); return false
  }
  if (nodes.some(walk)) errors.push('Remove the automatic loop; it would run without waiting for a customer')
  // A block nothing leads to never runs; say so instead of silently skipping it
  const trigger = nodes.find(node => node.type === 'trigger')
  if (trigger) {
    const reached = new Set<string>([trigger.id])
    const queue = [trigger]
    while (queue.length) {
      const node = queue.shift()!
      for (const id of getSuccessorIds(node, edges)) {
        const next = nodes.find(item => item.id === id)
        if (next && !reached.has(next.id)) { reached.add(next.id); queue.push(next) }
      }
    }
    for (const node of nodes) {
      // The runtime never reaches it, so it is no reason to pause a live flow
      if (!reached.has(node.id)) issues.push({ nodeId: node.id, message: 'connect this block to the flow, or delete it', text: `${node.data?.title || node.id}: connect this block to the flow, or delete it`, activationOnly: true })
    }
  }
  const seen = new Set<string>()
  return issues.filter(issue => !seen.has(issue.text) && Boolean(seen.add(issue.text)))
}

/**
 * The problems that keep a workflow from going live; warnings are left out. With `runtime`, only
 * those a live flow cannot run with (a missing trigger or connection, an unsupported block, an
 * unconnected choice or branch, a loop): the rest stay activation gates and never pause it.
 */
export function validateWorkflow(nodes: WorkflowNode[], edges: WorkflowEdge[], options: { runtime?: boolean } = {}): string[] {
  return getWorkflowIssues(nodes, edges).filter(issue => !issue.warning && !(options.runtime && issue.activationOnly)).map(issue => issue.text)
}
