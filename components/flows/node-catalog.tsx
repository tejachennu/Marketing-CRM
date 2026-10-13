import {
  Bell,
  Briefcase,
  GitBranch,
  Globe,
  List,
  MessageSquare,
  MousePointerClick,
  Smartphone,
  Sparkles,
  Tag,
  Ticket,
  Timer,
  UserCheck,
  Variable,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { FlowNodeType, WorkflowNode } from '@/lib/flows/flow-types'
import { SUPPORTED_NODE_TYPES } from '@/lib/flows/flow-graph'

/**
 * One description of every block: how it looks, what the palette says about it and what a
 * new one starts with. The palette, the canvas cards and the inspector all read from here,
 * so they cannot drift apart.
 */

export type NodeTone = 'emerald' | 'teal' | 'indigo' | 'violet' | 'amber' | 'sky' | 'slate'

/** Full class names per tone (Tailwind only generates classes it can see written out). */
export const TONE_CLASSES: Record<NodeTone, { chip: string; header: string; port: string }> = {
  emerald: {
    chip: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    header: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200/70 dark:border-emerald-900/50',
    port: 'bg-emerald-500',
  },
  teal: {
    chip: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
    header: 'bg-teal-50 dark:bg-teal-950/40 border-teal-200/70 dark:border-teal-900/50',
    port: 'bg-teal-500',
  },
  indigo: {
    chip: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
    header: 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200/70 dark:border-indigo-900/50',
    port: 'bg-indigo-500',
  },
  violet: {
    chip: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    header: 'bg-violet-50 dark:bg-violet-950/40 border-violet-200/70 dark:border-violet-900/50',
    port: 'bg-violet-500',
  },
  amber: {
    chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    header: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200/70 dark:border-amber-900/50',
    port: 'bg-amber-500',
  },
  sky: {
    chip: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    header: 'bg-sky-50 dark:bg-sky-950/40 border-sky-200/70 dark:border-sky-900/50',
    port: 'bg-sky-500',
  },
  slate: {
    chip: 'bg-slate-500/10 text-slate-500 dark:text-slate-400',
    header: 'bg-slate-100 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/60',
    port: 'bg-slate-400',
  },
}

export type NodeGroup = 'Start' | 'Messages' | 'Logic' | 'CRM actions' | 'Handoff'
export const NODE_GROUPS: NodeGroup[] = ['Start', 'Messages', 'Logic', 'CRM actions', 'Handoff']

export interface NodeDefinition {
  type: FlowNodeType
  label: string
  description: string
  group: NodeGroup
  icon: LucideIcon
  tone: NodeTone
  /** False for block types the runtime cannot execute; they are never offered in the palette. */
  supported: boolean
  /** True when the flow stops at this block, so it has no output to connect. */
  terminal?: boolean
  createData: (context: { publishedFormId?: string }) => Record<string, any>
}

const isSupported = (type: FlowNodeType) => (SUPPORTED_NODE_TYPES as readonly string[]).includes(type)

const DEFINITIONS: NodeDefinition[] = [
  {
    type: 'trigger', label: 'Trigger', description: 'Starts the flow when a customer writes in',
    group: 'Start', icon: Zap, tone: 'emerald', supported: true,
    createData: () => ({ title: 'Customer message', trigger_type: 'keyword', keywords: ['hi', 'hello'], match_mode: 'contains' }),
  },
  {
    type: 'message', label: 'Text message', description: 'Send a WhatsApp message',
    group: 'Messages', icon: MessageSquare, tone: 'teal', supported: true,
    createData: () => ({ title: 'Send message', body: 'Hello {{contact.name}}! Thank you for contacting us.' }),
  },
  {
    type: 'interactive_buttons', label: 'Buttons', description: 'Ask a question with up to 3 buttons',
    group: 'Messages', icon: MousePointerClick, tone: 'teal', supported: true,
    createData: () => ({
      title: 'Ask with buttons', body: 'Please choose an option:',
      buttons: [{ id: `btn_${uid()}`, title: 'Option 1' }, { id: `btn_${uid()}`, title: 'Option 2' }],
    }),
  },
  {
    type: 'list_menu', label: 'List menu', description: 'Offer up to 10 choices in a menu',
    group: 'Messages', icon: List, tone: 'teal', supported: true,
    createData: () => ({
      title: 'List menu', body: 'How can we help?', button_text: 'Choose',
      sections: [{ title: 'Options', rows: [{ id: `row_${uid()}`, title: 'Sales enquiry' }, { id: `row_${uid()}`, title: 'Customer support' }] }],
    }),
  },
  {
    type: 'native_flow_trigger', label: 'WhatsApp form', description: 'Collect answers in a native form',
    group: 'Messages', icon: Smartphone, tone: 'indigo', supported: true,
    createData: ({ publishedFormId }) => ({
      title: 'WhatsApp form', description: 'Please complete the form below:', cta_text: 'Open form', native_flow_id: publishedFormId || '',
    }),
  },
  {
    type: 'condition_branch', label: 'Condition', description: 'Branch on an answer or variable',
    group: 'Logic', icon: GitBranch, tone: 'violet', supported: true,
    createData: () => ({ title: 'Check answer', variable_name: 'last_choice_title', operator: 'equals', compare_value: '' }),
  },
  {
    type: 'set_variable', label: 'Set variable', description: 'Remember a value for later steps',
    group: 'Logic', icon: Variable, tone: 'violet', supported: true,
    createData: () => ({ title: 'Set variable', variable_name: 'my_variable', value_expression: '', value_type: 'text' }),
  },
  {
    type: 'crm_deal_action', label: 'Create lead', description: 'Add a deal to your sales pipeline',
    group: 'CRM actions', icon: Briefcase, tone: 'amber', supported: true,
    createData: () => ({ title: 'Create lead', pipeline_stage: 'lead_in', deal_name: 'Lead from {{contact.name}}', monetary_value: 0 }),
  },
  {
    type: 'ticket_action', label: 'Create ticket', description: 'Open a support ticket',
    group: 'CRM actions', icon: Ticket, tone: 'amber', supported: true,
    createData: () => ({ title: 'Create ticket', subject: 'Support request from {{contact.name}}', priority: 'medium' }),
  },
  {
    type: 'tag_action', label: 'Tag contact', description: 'Add or remove contact tags',
    group: 'CRM actions', icon: Tag, tone: 'amber', supported: true,
    createData: () => ({ title: 'Tag contact', action: 'add', tags: ['interested'] }),
  },
  {
    type: 'assign_agent_action', label: 'Hand off to team', description: 'Pause automation for a person',
    group: 'Handoff', icon: UserCheck, tone: 'sky', supported: true, terminal: true,
    createData: () => ({ title: 'Hand off to team', assignmentType: 'team_queue' }),
  },
  {
    type: 'ai_rag_node', label: 'Knowledge assistant', description: 'Let the AI answer from your knowledge base',
    group: 'Handoff', icon: Sparkles, tone: 'sky', supported: true, terminal: true,
    createData: () => ({ title: 'Knowledge assistant' }),
  },
  // Not runnable yet. Kept so flows saved with these blocks still open and can be cleaned up.
  {
    type: 'delay_action', label: 'Wait / delay', description: 'Not available yet',
    group: 'Logic', icon: Timer, tone: 'slate', supported: false, createData: () => ({ title: 'Wait / delay' }),
  },
  {
    type: 'webhook_action', label: 'HTTP webhook', description: 'Not available yet',
    group: 'Logic', icon: Globe, tone: 'slate', supported: false, createData: () => ({ title: 'HTTP webhook' }),
  },
  {
    type: 'notification_action', label: 'Send notification', description: 'Not available yet',
    group: 'Handoff', icon: Bell, tone: 'slate', supported: false, createData: () => ({ title: 'Send notification' }),
  },
]

const BY_TYPE = new Map(DEFINITIONS.map((definition) => [definition.type, { ...definition, supported: definition.supported && isSupported(definition.type) }]))

export function getNodeDefinition(type: string): NodeDefinition {
  return BY_TYPE.get(type as FlowNodeType) || {
    type: type as FlowNodeType, label: type, description: 'Unknown block', group: 'Logic', icon: Globe, tone: 'slate', supported: false,
    createData: () => ({ title: type }),
  }
}

/** The blocks offered in the palette, grouped in display order. */
export const PALETTE: Array<{ group: NodeGroup; items: NodeDefinition[] }> = NODE_GROUPS.map((group) => ({
  group,
  items: [...BY_TYPE.values()].filter((definition) => definition.group === group && definition.supported),
}))

/** Short unique suffix for ids created in the browser. */
export function uid(): string {
  return Math.random().toString(36).slice(2, 8)
}

// ── Card geometry ─────────────────────────────────────────────────────────────
// Output rows have fixed sizes so a connection can be drawn to the exact row it
// belongs to without measuring the DOM.

export const NODE_WIDTH = 280
export const HEADER_HEIGHT = 44
export const BODY_PADDING = 12
export const PREVIEW_HEIGHT = 20
export const PREVIEW_GAP = 8
export const ROW_HEIGHT = 30
export const ROW_GAP = 6

export interface NodeOutput {
  id: string
  label: string
}

/** The labelled outputs of a branching block, or null for a block with a single "next" output. */
export function getNodeOutputs(node: WorkflowNode): NodeOutput[] | null {
  const data: Record<string, any> = node.data || {}
  if (node.type === 'interactive_buttons') {
    return (Array.isArray(data.buttons) ? data.buttons : []).map((button: any) => ({ id: String(button.id), label: String(button.title || 'Untitled') }))
  }
  if (node.type === 'list_menu') {
    return (Array.isArray(data.sections) ? data.sections : [])
      .flatMap((section: any) => (Array.isArray(section?.rows) ? section.rows : []))
      .map((row: any) => ({ id: String(row.id), label: String(row.title || 'Untitled') }))
  }
  if (node.type === 'condition_branch') {
    return [{ id: 'true', label: 'If it matches' }, { id: 'false', label: 'Otherwise' }]
  }
  return null
}

/** Where a connection arrives on a block, relative to the block's top-left corner. */
export const INPUT_ANCHOR = { x: 0, y: HEADER_HEIGHT / 2 }

/** Where a connection leaves a block, relative to the block's top-left corner. */
export function getOutputAnchor(node: WorkflowNode, handleId?: string): { x: number; y: number } {
  const outputs = getNodeOutputs(node)
  const index = outputs && handleId ? outputs.findIndex((output) => output.id === handleId) : -1
  if (!outputs || index < 0) return { x: NODE_WIDTH, y: HEADER_HEIGHT / 2 }
  return {
    x: NODE_WIDTH,
    y: HEADER_HEIGHT + BODY_PADDING + PREVIEW_HEIGHT + PREVIEW_GAP + index * (ROW_HEIGHT + ROW_GAP) + ROW_HEIGHT / 2,
  }
}

/** Approximate rendered height, used to frame the whole graph in the viewport. */
export function estimateNodeHeight(node: WorkflowNode): number {
  const outputs = getNodeOutputs(node)
  if (outputs) {
    return HEADER_HEIGHT + BODY_PADDING * 2 + PREVIEW_HEIGHT + PREVIEW_GAP + outputs.length * (ROW_HEIGHT + ROW_GAP)
  }
  return HEADER_HEIGHT + 76
}

/** One line describing what a block does, shown on its card. */
export function getNodeSummary(node: WorkflowNode, context: { formName?: (id: string) => string | undefined; stageName?: (id: string) => string | undefined } = {}): string {
  const data: Record<string, any> = node.data || {}
  const read = (...keys: string[]) => keys.map((key) => data[key]).find((value) => value !== undefined && value !== null && value !== '')
  switch (node.type) {
    case 'trigger': {
      if ((read('triggerType', 'trigger_type') || 'keyword') === 'first_message') return 'First message in a conversation'
      const keywords: string[] = Array.isArray(data.keywords) ? data.keywords : []
      const mode = read('matchType', 'match_mode') === 'exact' ? 'is exactly' : 'contains'
      return keywords.length ? `Message ${mode}: ${keywords.join(', ')}` : 'No keywords yet'
    }
    case 'message':
      return read('messageText', 'body', 'message_text') || 'No message yet'
    case 'interactive_buttons':
    case 'list_menu':
      return read('bodyText', 'body', 'body_text') || 'No message yet'
    case 'native_flow_trigger': {
      const id = read('flowId', 'native_flow_id', 'flow_id')
      return id ? `Form: ${context.formName?.(id) || 'unknown form'}` : 'No form selected'
    }
    case 'condition_branch': {
      const variable = read('variableName', 'variable_name', 'variable') || 'variable'
      const operator = String(data.operator || 'equals').replaceAll('_', ' ')
      return data.operator === 'is_set' ? `${variable} has a value` : `${variable} ${operator} ${read('compareValue', 'compare_value', 'value') ?? ''}`.trim()
    }
    case 'set_variable':
      return `${read('variableName', 'variable_name') || 'variable'} = ${read('valueExpression', 'value_expression') || '(empty)'}`
    case 'crm_deal_action': {
      const stage = read('stageId', 'pipeline_stage', 'stage_id')
      const stageLabel = !stage || stage === 'lead_in' ? 'first stage' : context.stageName?.(stage) || stage
      return `${read('dealTitle', 'deal_name', 'deal_title') || 'New lead'} → ${stageLabel}`
    }
    case 'ticket_action':
      return data.subject || 'Support request'
    case 'tag_action': {
      const tags: string[] = Array.isArray(data.tags) ? data.tags : []
      return `${read('action', 'tag_action_type') === 'remove' ? 'Remove' : 'Add'}: ${tags.join(', ') || 'no tags yet'}`
    }
    case 'assign_agent_action':
      return 'Pauses automation and hands the chat to your team'
    case 'ai_rag_node':
      return 'Ends the flow and lets the knowledge assistant reply'
    default:
      return 'This block is not available yet. Remove it to go live.'
  }
}
