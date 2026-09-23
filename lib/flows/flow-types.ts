// Types for WAMACRM WhatsApp Visual Flows & Meta Native Flows Engine

export type FlowNodeType =
  | 'trigger'
  | 'message'
  | 'interactive_buttons'
  | 'list_menu'
  | 'native_flow_trigger'
  | 'ai_rag_node'
  | 'condition_branch'
  | 'crm_deal_action'
  | 'ticket_action'
  | 'assign_agent_action'
  | 'delay_action'
  | 'webhook_action'

export type NodeType = FlowNodeType

export interface CanvasPosition {
  x: number
  y: number
}

export interface BaseNodeData {
  title?: string
  description?: string
  nodeType?: FlowNodeType
  [key: string]: any
}

export interface TriggerNodeData extends BaseNodeData {
  nodeType?: 'trigger'
  triggerType?: 'keyword' | 'campaign_reply' | 'first_message' | 'lead_stage' | 'webhook'
  trigger_type?: string
  keywords?: string[]
  matchType?: 'exact' | 'contains' | 'semantic_ai'
  match_mode?: string
}

export interface MessageNodeData extends BaseNodeData {
  nodeType: 'message'
  messageText: string
  mediaUrl?: string
  mediaType?: 'image' | 'video' | 'document' | 'audio'
}

export interface InteractiveButtonsNodeData extends BaseNodeData {
  nodeType: 'interactive_buttons'
  bodyText: string
  headerText?: string
  footerText?: string
  buttons: Array<{
    id: string
    title: string
    targetNodeId?: string
  }>
}

export interface ListMenuNodeData extends BaseNodeData {
  nodeType: 'list_menu'
  bodyText: string
  buttonText: string
  title?: string
  sections: Array<{
    title: string
    rows: Array<{
      id: string
      title: string
      description?: string
      targetNodeId?: string
    }>
  }>
}

export interface NativeFlowNodeData extends BaseNodeData {
  nodeType: 'native_flow_trigger'
  flowId: string // references whatsapp_native_flows.id
  flowName?: string
  flowCtaText: string // e.g. "Book Service Appointment"
  flowToken?: string
  screenId?: string // initial screen e.g. "DETAILS"
  onSuccessNodeId?: string
  onCancelNodeId?: string
}

export interface AiRagNodeData extends BaseNodeData {
  nodeType: 'ai_rag_node'
  systemPrompt?: string
  matchThreshold?: number
  allowFlowInterruptionRecovery: boolean
  maxTokens?: number
  temperature?: number
  fallbackTargetNodeId?: string
}

export interface ConditionBranchNodeData extends BaseNodeData {
  nodeType: 'condition_branch'
  variableName: string
  operator: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than' | 'is_set'
  compareValue: string
  trueTargetNodeId?: string
  falseTargetNodeId?: string
}

export interface CrmDealActionNodeData extends BaseNodeData {
  nodeType: 'crm_deal_action'
  dealTitle: string
  dealValue: number
  currency: string
  stageId?: string
  source?: string
}

export interface TicketActionNodeData extends BaseNodeData {
  nodeType: 'ticket_action'
  subject: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  department?: string
  slaMinutes?: number
}

export interface AssignAgentActionNodeData extends BaseNodeData {
  nodeType: 'assign_agent_action'
  assignmentType: 'round_robin' | 'specific_user' | 'team_queue'
  assignedUserId?: string
  teamName?: string
}

export type AnyNodeData =
  | TriggerNodeData
  | MessageNodeData
  | InteractiveButtonsNodeData
  | ListMenuNodeData
  | NativeFlowNodeData
  | AiRagNodeData
  | ConditionBranchNodeData
  | CrmDealActionNodeData
  | TicketActionNodeData
  | AssignAgentActionNodeData
  | BaseNodeData
  | Record<string, any>

export interface WorkflowNode {
  id: string
  type: FlowNodeType
  position: CanvasPosition
  data: AnyNodeData
}

export interface WorkflowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  label?: string
}

export interface WhatsAppWorkflow {
  id: string
  organization_id: string
  name: string
  description?: string
  trigger_type: string
  trigger_config: Record<string, any>
  canvas_nodes: WorkflowNode[]
  canvas_edges: WorkflowEdge[]
  is_active: boolean
  execution_count: number
  created_at: string
  updated_at: string
}

// Meta Flow Specification v3.1 Primitives
export type MetaFormComponentType =
  | 'TextCaption'
  | 'TextSubheading'
  | 'TextBody'
  | 'TextInput'
  | 'TextArea'
  | 'Dropdown'
  | 'RadioGroup'
  | 'CheckboxGroup'
  | 'DatePicker'
  | 'TimePicker'
  | 'OptIn'
  | 'Footer'

export interface MetaFormField {
  id: string
  type: MetaFormComponentType
  label: string
  name: string
  required?: boolean
  helperText?: string
  helper_text?: string
  placeholder?: string
  input_type?: string
  options?: Array<{ id: string; title: string; description?: string }>
  minDate?: string
  maxDate?: string
  [key: string]: any
}

export interface MetaFlowScreen {
  id: string
  title: string
  terminal?: boolean
  layout: {
    type: 'SingleColumnLayout'
    children: MetaFormField[]
  }
}

export interface MetaFlowJSON {
  version: '3.1'
  screens: MetaFlowScreen[]
}

export interface WhatsAppNativeFlowRecord {
  id: string
  organization_id: string
  flow_id_meta?: string
  name: string
  categories: string[]
  flow_json: MetaFlowJSON
  screens: MetaFlowScreen[]
  status: 'DRAFT' | 'PUBLISHED' | 'DEPRECATED'
  created_at: string
  updated_at: string
}

export interface FlowSession {
  id: string
  organization_id: string
  workflow_id: string
  conversation_id?: string
  contact_phone: string
  current_node_id: string
  state_data: Record<string, any>
  status: 'IN_PROGRESS' | 'PAUSED_RAG' | 'COMPLETED' | 'EXPIRED'
  last_interaction_at: string
  created_at: string
}

export const MAGNETORA_ORG_ID = 'b2acf062-c379-49f2-8905-267413c9c394'

export function isFlowBetaAllowed(
  orgId?: string | null,
  orgSlug?: string | null,
  orgName?: string | null
): boolean {
  if (!orgId && !orgSlug && !orgName) return false
  if (orgId === MAGNETORA_ORG_ID) return true
  if (orgSlug?.toLowerCase().includes('magnetora')) return true
  if (orgName?.toLowerCase().includes('magnetora')) return true
  return false
}
