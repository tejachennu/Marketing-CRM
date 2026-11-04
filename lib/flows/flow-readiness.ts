import type { WhatsAppWorkflow } from './flow-types'
import { readNodeField, validateWorkflow } from './flow-graph'
import { getMetaCredentials } from './meta-client'
import { isReadOnly } from '@/lib/rbac'

/**
 * Everything that must hold before a workflow goes live: a valid graph (no unsupported blocks,
 * unconnected choices or branches), WhatsApp credentials, published forms, existing pipeline
 * stages and teammates. Activation is refused while any of these fail.
 */
export async function getWorkflowReadiness(supabase: any, workflow: WhatsAppWorkflow): Promise<string[]> {
  const errors = validateWorkflow(workflow.canvas_nodes, workflow.canvas_edges)
  const { data: organization, error } = await supabase.from('organizations').select('whatsapp_provider,whatsapp_api_token,whatsapp_phone_number_id,whatsapp_business_account_id,whatsapp_graph_api_version').eq('id', workflow.organization_id).single()
  if (error) throw new Error(error.message)
  try { getMetaCredentials(organization || {}) } catch (error: any) { errors.push(error.message) }
  for (const node of Array.isArray(workflow.canvas_nodes) ? workflow.canvas_nodes : []) {
    const label = node?.data?.title || node?.id
    if (node.type === 'crm_deal_action') {
      const stage = readNodeField(node.data, 'stageId', 'pipeline_stage', 'stage_id')
      if (stage && stage !== 'lead_in') {
        const { data: stages, error } = await supabase.from('pipeline_stages').select('id,name').eq('organization_id', workflow.organization_id)
        if (error) throw new Error(error.message)
        const normalize = (value: string) => String(value).toLowerCase().replace(/[^a-z0-9]/g, '')
        if (!stages?.some((item: any) => item.id === stage || normalize(item.name) === normalize(stage))) errors.push(`${label}: select a pipeline stage in this organization`)
      }
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
    if (node.type !== 'native_flow_trigger') continue
    const id = readNodeField(node.data, 'flowId', 'native_flow_id', 'flow_id')
    if (!id) continue
    const { data: form, error: formError } = await supabase.from('whatsapp_native_flows').select('id,name,status,flow_id_meta,flow_json').eq('id', id).eq('organization_id', workflow.organization_id).maybeSingle()
    if (formError) throw new Error(formError.message)
    if (!form) errors.push(`${label}: select a form that belongs to this organization`)
    else if (form.status !== 'PUBLISHED' || !form.flow_id_meta) errors.push(`${label}: publish the selected form to Meta first`)
    // The runtime sends this ID to Meta; a local UUID or placeholder would fail at send time
    else if (!/^\d+$/.test(String(form.flow_id_meta))) errors.push(`${label}: the selected form has no valid Meta Flow ID; publish it again`)
    else {
      const screenId = readNodeField(node.data, 'screenId', 'screen_id')
      if (screenId && !form.flow_json?.screens?.some((screen: any) => screen.id === screenId)) errors.push(`${label}: the selected starting screen is missing`)
    }
  }
  return [...new Set(errors)]
}
