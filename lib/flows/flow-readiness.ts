import type { WhatsAppWorkflow } from './flow-types'
import { readNodeField, validateWorkflow, getTriggerConflicts } from './flow-graph'
import { getMetaCredentials } from './meta-client'
import { isReadOnly } from '@/lib/rbac'
import { isMissingColumn } from '@/lib/scheduler/schema-errors'

/** What the knowledge assistant block needs: the organization's AI switched on, with a key of its own or the platform's. */
export const AI_REQUIRED_MESSAGE = 'The knowledge assistant needs AI enabled in Settings'
const WHATSAPP_COLUMNS = 'whatsapp_provider,whatsapp_api_token,whatsapp_phone_number_id,whatsapp_business_account_id,whatsapp_graph_api_version'
const AI_COLUMNS = ['openai_api_key', 'enable_ai']
let aiColumnsWarned = false

/** Whether the knowledge assistant can answer for this organization, by the same rule the webhook applies. */
export function hasAiEnabled(organization: Record<string, any> | null | undefined): boolean {
  return organization?.enable_ai !== false && Boolean(organization?.openai_api_key || process.env.OPENAI_API_KEY)
}

/** The organization's WhatsApp and AI settings. Before the AI columns exist the AI check is skipped, rather than failing every flow. */
async function loadOrganization(supabase: any, organizationId: string): Promise<{ organization: Record<string, any>; aiKnown: boolean }> {
  const full = await supabase.from('organizations').select(`${WHATSAPP_COLUMNS},${AI_COLUMNS.join(',')}`).eq('id', organizationId).single()
  if (!full.error) return { organization: full.data || {}, aiKnown: true }
  if (!isMissingColumn(full.error, AI_COLUMNS)) throw new Error(full.error.message)
  if (!aiColumnsWarned) {
    console.warn('[Flow Readiness] organizations.openai_api_key / enable_ai are missing; the knowledge assistant check is skipped')
    aiColumnsWarned = true
  }
  const base = await supabase.from('organizations').select(WHATSAPP_COLUMNS).eq('id', organizationId).single()
  if (base.error) throw new Error(base.error.message)
  return { organization: base.data || {}, aiKnown: false }
}

/**
 * Everything that must hold before a workflow goes live: a valid graph (no unsupported blocks,
 * unconnected choices or branches), WhatsApp credentials, AI for a knowledge assistant block,
 * published forms, pipeline stages, teammates, and no other live flow starting on the same
 * keyword or first message. Activation is refused while any of these fail.
 */
export async function getWorkflowReadiness(supabase: any, workflow: WhatsAppWorkflow): Promise<string[]> {
  const errors = validateWorkflow(workflow.canvas_nodes, workflow.canvas_edges)
  const nodes = Array.isArray(workflow.canvas_nodes) ? workflow.canvas_nodes : []
  const { organization, aiKnown } = await loadOrganization(supabase, workflow.organization_id)
  try { getMetaCredentials(organization) } catch (error: any) { errors.push(error.message) }
  if (aiKnown && nodes.some(node => node?.type === 'ai_rag_node') && !hasAiEnabled(organization)) errors.push(AI_REQUIRED_MESSAGE)

  // Two live flows on the same messages: the oldest would silently win and the other never fire.
  // created_at tells which one the runtime tries first.
  const { data: others, error: othersError } = await supabase.from('whatsapp_workflows').select('id,name,canvas_nodes,trigger_type,trigger_config,created_at')
    .eq('organization_id', workflow.organization_id).eq('is_active', true).neq('id', workflow.id)
  if (othersError) throw new Error(othersError.message)
  for (const conflict of getTriggerConflicts(workflow, others || [])) errors.push(conflict.message)

  // Leads need somewhere to land: a stage of this organization, or at least its first one
  let stages: any[] | undefined
  if (nodes.some(node => node?.type === 'crm_deal_action')) {
    const { data, error } = await supabase.from('pipeline_stages').select('id,name').eq('organization_id', workflow.organization_id)
    if (error) throw new Error(error.message)
    stages = data || []
  }
  for (const node of nodes) {
    const label = node?.data?.title || node?.id
    if (node.type === 'crm_deal_action') {
      const stage = readNodeField(node.data, 'stageId', 'pipeline_stage', 'stage_id')
      const normalize = (value: string) => String(value).toLowerCase().replace(/[^a-z0-9]/g, '')
      if (!stages?.length) errors.push(`${label}: add a pipeline stage under Leads before this flow can create leads`)
      else if (stage && stage !== 'lead_in' && !stages.some((item: any) => item.id === stage || normalize(item.name) === normalize(stage))) errors.push(`${label}: select a pipeline stage in this organization`)
    }
    if (node.type === 'assign_agent_action') {
      const type = readNodeField(node.data, 'assignmentType', 'assignment_type') || 'team_queue'
      const id = readNodeField(node.data, 'assignedUserId', 'assigned_user_id')
      if (id) {
        const { data: user, error } = await supabase.from('users').select('id').eq('id', id).eq('organization_id', workflow.organization_id).maybeSingle()
        if (error) throw new Error(error.message)
        if (!user) errors.push(`${label}: select an agent in this organization`)
      }
      if (type === 'round_robin') {
        const { data: users, error } = await supabase.from('users').select('id,role,read_only').eq('organization_id', workflow.organization_id)
        if (error) throw new Error(error.message)
        if (!(users || []).some((user: any) => !isReadOnly(user))) errors.push(`${label}: add a teammate who can take conversations before using round-robin`)
      }
    }
  }
  errors.push(...await getNativeFormProblems(supabase, workflow))
  return [...new Set(errors)]
}

/**
 * Why the WhatsApp forms this workflow sends cannot be sent: deleted, retired, not published, or
 * without the starting screen. Activation refuses these, and the runtime pauses a live flow over
 * them (a form can be retired in WhatsApp Manager too), since every customer would only get an apology.
 */
export async function getNativeFormProblems(supabase: any, workflow: Pick<WhatsAppWorkflow, 'organization_id' | 'canvas_nodes'>): Promise<string[]> {
  const problems: string[] = []
  for (const node of Array.isArray(workflow.canvas_nodes) ? workflow.canvas_nodes : []) {
    if (node?.type !== 'native_flow_trigger') continue
    const label = node.data?.title || node.id
    const id = readNodeField(node.data, 'flowId', 'native_flow_id', 'flow_id')
    if (!id) continue
    const { data: form, error: formError } = await supabase.from('whatsapp_native_flows').select('id,name,status,flow_id_meta,flow_json').eq('id', id).eq('organization_id', workflow.organization_id).maybeSingle()
    if (formError) throw new Error(formError.message)
    // The lookup is scoped to the organization, so a deleted form and another tenant's form look the same
    if (!form) problems.push(`${label}: the selected form no longer exists (it was deleted, or belongs to another organization); select another form`)
    else if (form.status === 'DEPRECATED') problems.push(`${label}: the selected form was retired on WhatsApp; select another form`)
    else if (form.status !== 'PUBLISHED' || !form.flow_id_meta) problems.push(`${label}: publish the selected form to Meta first`)
    // The runtime sends this ID to Meta; a local UUID or placeholder would fail at send time
    else if (!/^\d+$/.test(String(form.flow_id_meta))) problems.push(`${label}: the selected form has no valid Meta Flow ID; publish it again`)
    else {
      const screenId = readNodeField(node.data, 'screenId', 'screen_id')
      if (screenId && !form.flow_json?.screens?.some((screen: any) => screen.id === screenId)) problems.push(`${label}: the selected starting screen is missing`)
    }
  }
  return problems
}
