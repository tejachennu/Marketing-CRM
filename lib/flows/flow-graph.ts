import type { WhatsAppWorkflow, WorkflowNode, WorkflowEdge } from './flow-types'

export function readNodeField(data: Record<string, any>, ...keys: string[]): any {
  return keys.map(key => data[key]).find(value => value !== undefined && value !== null && value !== '')
}
export function getStartNode(workflow: Pick<WhatsAppWorkflow, 'canvas_nodes'>) {
  return workflow.canvas_nodes.find(node => node.type === 'trigger')
}
export function getOutgoingEdges(edges: WorkflowEdge[], nodeId: string) {
  return edges.filter(edge => edge.source === nodeId)
}
export function getNextNode(nodes: WorkflowNode[], edges: WorkflowEdge[], nodeId: string, handle?: string) {
  const outgoing = getOutgoingEdges(edges, nodeId)
  const edge = handle ? outgoing.find(edge => edge.sourceHandle === handle) || outgoing.find(edge => !edge.sourceHandle)
    : outgoing.find(edge => !edge.sourceHandle)
  return nodes.find(node => node.id === edge?.target)
}
export function getStateValue(state: Record<string, any>, path: string): any {
  return path.split('.').reduce((value, key) =>
    value && Object.hasOwn(value, key) && !['__proto__', 'constructor', 'prototype'].includes(key) ? value[key] : undefined, state as any)
}
export function interpolateVariables(template: string, state: Record<string, any>): string {
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, key) => {
    const value = getStateValue(state, key)
    return value === undefined || value === null ? match : String(value)
  })
}
export function getChoices(node: WorkflowNode): Array<{ id: string; title: string; targetNodeId?: string }> {
  return node.type === 'list_menu' ? (node.data.sections || []).flatMap((section: any) => section.rows || []) : node.data.buttons || []
}
export function resolveReply(node: WorkflowNode, nodes: WorkflowNode[], edges: WorkflowEdge[], text: string, buttonId?: string) {
  const input = (buttonId || text).trim().toLowerCase()
  const choice = getChoices(node).find(choice => choice.id.toLowerCase() === input || (!buttonId && choice.title.toLowerCase() === input))
  if (!choice) return { matched: false, next: undefined }
  return { matched: true, choice, next: choice.targetNodeId ? nodes.find(node => node.id === choice.targetNodeId) : getNextNode(nodes, edges, node.id, choice.id) }
}
export function evaluateCondition(data: Record<string, any>, state: Record<string, any>) {
  const value = getStateValue(state, readNodeField(data, 'variableName', 'variable_name', 'variable') || '')
  const comparison = interpolateVariables(String(readNodeField(data, 'compareValue', 'compare_value', 'value') ?? ''), state)
  switch (data.operator) {
    case 'is_set': return value !== undefined && value !== null && value !== ''
    case 'equals': return String(value ?? '') === comparison
    case 'not_equals': return String(value ?? '') !== comparison
    case 'contains': return String(value ?? '').toLowerCase().includes(comparison.toLowerCase())
    case 'greater_than': return value !== '' && value != null && Number(value) > Number(comparison)
    case 'less_than': return value !== '' && value != null && Number(value) < Number(comparison)
    default: throw new Error('Select a supported condition operator')
  }
}
export function matchesTrigger(workflow: WhatsAppWorkflow, input: string, isFirstMessage = false) {
  const data: Record<string, any> = { ...workflow.trigger_config, ...getStartNode(workflow)?.data }
  const type = readNodeField(data, 'triggerType', 'trigger_type') || workflow.trigger_type
  if (type === 'first_message') return isFirstMessage
  if (type !== 'keyword') return false
  const mode = readNodeField(data, 'matchType', 'match_mode') || 'contains'
  if (!['exact', 'contains', 'fuzzy'].includes(mode)) return false
  return (data.keywords || []).some((keyword: string) => {
    const key = keyword.trim().toLowerCase()
    return key && (mode === 'exact' ? input.trim().toLowerCase() === key : input.toLowerCase().includes(key))
  })
}

const supported = new Set(['trigger', 'message', 'interactive_buttons', 'list_menu', 'native_flow_trigger', 'condition_branch', 'crm_deal_action', 'ticket_action', 'assign_agent_action', 'ai_rag_node'])
export function validateWorkflow(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[] {
  const errors: string[] = []
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return ['Nodes and connections must be arrays']
  if (nodes.length > 100 || edges.length > 300) return ['Use at most 100 nodes and 300 connections']
  if (nodes.filter(node => node.type === 'trigger').length !== 1) errors.push('Add exactly one trigger')
  const ids = new Set(nodes.map(node => node.id))
  if (ids.size !== nodes.length) errors.push('Node IDs must be unique')
  for (const edge of edges) if (!ids.has(edge.source) || !ids.has(edge.target)) errors.push('A connection points to a missing node')
  for (const node of nodes) {
    const data = node.data || {}
    const label = data.title || node.id
    const fail = (message: string) => errors.push(`${label}: ${message}`)
    if (!supported.has(node.type)) fail('this action is not supported yet')
    const outgoing = getOutgoingEdges(edges, node.id)
    const handles = outgoing.map(edge => edge.sourceHandle || '')
    if (new Set(handles).size !== handles.length) fail('each output must have only one connection')
    if (node.type === 'trigger') {
      if (!getNextNode(nodes, edges, node.id)) fail('connect the trigger to an action')
      const type = readNodeField(data, 'triggerType', 'trigger_type') || 'keyword'
      if (!['keyword', 'first_message'].includes(type)) fail('only keyword and first-message triggers are available')
      if (type === 'keyword' && (!Array.isArray(data.keywords) || !data.keywords.some((key: string) => key.trim()))) fail('add at least one keyword')
      const mode = readNodeField(data, 'matchType', 'match_mode')
      if (mode && !['exact', 'contains', 'fuzzy'].includes(mode)) fail('use exact or contains keyword matching')
    }
    if (['message', 'interactive_buttons', 'list_menu'].includes(node.type)) {
      const body = readNodeField(data, 'messageText', 'bodyText', 'body', 'message_text', 'body_text')
      if (!body?.trim()) fail('enter a message')
      if (body?.length > (node.type === 'message' ? 4096 : 1024)) fail('message is too long for WhatsApp')
    }
    if (['interactive_buttons', 'list_menu'].includes(node.type)) {
      const choices = getChoices(node)
      const max = node.type === 'interactive_buttons' ? 3 : 10
      if (!choices.length || choices.length > max) fail(`provide between 1 and ${max} choices`)
      if (new Set(choices.map(choice => choice.id)).size !== choices.length) fail('choice IDs must be unique')
      for (const choice of choices) {
        if (!choice.id || !choice.title || choice.title.length > (max === 3 ? 20 : 24)) fail('a choice has an empty ID or an invalid title length')
        if (choice.targetNodeId ? !ids.has(choice.targetNodeId) : !getNextNode(nodes, edges, node.id, choice.id)) fail(`connect the "${choice.title}" choice`)
      }
      if (node.type === 'list_menu' && (readNodeField(data, 'buttonText', 'button_text') || 'Choose').length > 20) fail('list button label must be at most 20 characters')
    }
    if (node.type === 'native_flow_trigger') {
      if (!readNodeField(data, 'flowId', 'native_flow_id', 'flow_id')) fail('select a published native form')
      if ((readNodeField(data, 'flowCtaText', 'cta_text', 'flow_cta_text') || 'Open Form').length > 30) fail('form button must be at most 30 characters')
    }
    if (node.type === 'condition_branch') {
      if (!readNodeField(data, 'variableName', 'variable_name', 'variable')) fail('select a variable')
      if (!['equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'is_set'].includes(data.operator)) fail('select a condition operator')
      for (const branch of ['true', 'false']) {
        const target = data[`${branch}TargetNodeId`]
        if (target ? !ids.has(target) : !getNextNode(nodes, edges, node.id, branch)) fail(`connect the ${branch} branch`)
      }
    }
    if (node.type === 'assign_agent_action' && !['specific_user', 'team_queue', undefined].includes(data.assignmentType || data.assignment_type)) fail('select a specific agent or the shared team queue')
    if (node.type === 'assign_agent_action' && (data.assignmentType || data.assignment_type) === 'specific_user' && !readNodeField(data, 'assignedUserId', 'assigned_user_id')) fail('select an agent')
  }
  // Refuse automatic cycles; reply nodes provide a safe boundary between turns.
  const visiting = new Set<string>(), visited = new Set<string>()
  const walk = (node: WorkflowNode): boolean => {
    if (visiting.has(node.id)) return true
    if (visited.has(node.id) || ['interactive_buttons', 'list_menu', 'native_flow_trigger', 'ai_rag_node', 'assign_agent_action'].includes(node.type)) return false
    visiting.add(node.id)
    const targets = [...getOutgoingEdges(edges, node.id).map(edge => edge.target), node.data.trueTargetNodeId, node.data.falseTargetNodeId].filter(Boolean)
    if (targets.some(id => { const next = nodes.find(node => node.id === id); return next ? walk(next) : false })) return true
    visiting.delete(node.id); visited.add(node.id); return false
  }
  if (nodes.some(walk)) errors.push('Remove the automatic loop; it would run without waiting for a customer')
  return [...new Set(errors)]
}
