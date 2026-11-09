import { NextResponse } from 'next/server'
import { apiAuth, apiError, jsonBody } from '@/lib/public-api/auth'
import { apiActor, isLeadId, parseApiLead, pipelineOff, toApiLead } from '@/lib/public-api/leads'
import { teamOf } from '@/lib/pipeline/server'
import { findLead, leadHistory, loadStages, updateLead, withContacts } from '@/lib/pipeline/store'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }
const NOT_FOUND = 'No deal with that id.'

// GET /api/v1/leads/{id}: the deal, with its history (newest first)
export async function GET(request: Request, { params }: Params) {
  const auth = await apiAuth(request, 'leads:read')
  if (!auth.ok) return auth.response
  const off = pipelineOff(auth.ctx.organization)
  if (off) return off
  const { id } = await params
  if (!isLeadId(id)) return apiError(404, 'not_found', NOT_FOUND)
  const { db, organizationId, organization } = auth.ctx
  try {
    const actor = apiActor(auth.ctx)
    const lead = await findLead(actor, id)
    if (!lead) return apiError(404, 'not_found', NOT_FOUND)
    const [[withContact], stages, team, history] = await Promise.all([withContacts(db, organizationId, [lead]), loadStages(db, organizationId), teamOf(db, organizationId), leadHistory(actor, id)])
    return NextResponse.json({ data: { ...toApiLead(withContact, stages, team, String(organization.currency || 'INR').toUpperCase()), history } })
  } catch (error: any) {
    console.error('[API lead]', error?.message)
    return apiError(500, 'server_error', 'The deal could not be read. Please try again.')
  }
}

// PATCH /api/v1/leads/{id}: change the fields sent; move it (stage_id or stage); close it (status, reason)
export async function PATCH(request: Request, { params }: Params) {
  const auth = await apiAuth(request, 'leads:write')
  if (!auth.ok) return auth.response
  const off = pipelineOff(auth.ctx.organization)
  if (off) return off
  const { id } = await params
  if (!isLeadId(id)) return apiError(404, 'not_found', NOT_FOUND)
  const read = await jsonBody(request)
  if ('response' in read) return read.response
  const { db, organizationId, organization } = auth.ctx
  try {
    const actor = apiActor(auth.ctx)
    const current = await findLead(actor, id)
    if (!current) return apiError(404, 'not_found', NOT_FOUND)
    const [stages, team] = await Promise.all([loadStages(db, organizationId), teamOf(db, organizationId)])
    const parsed = parseApiLead(read.body, stages, true)
    if ('error' in parsed) return apiError(400, 'invalid_request', parsed.error, { field: parsed.field })
    const result = await updateLead(actor, current, parsed.value, new Map(stages.map((s: any) => [s.id, s.name])), new Map(team.map((u: any) => [u.id, u.full_name || u.email || 'Teammate'])))
    if (result.error) return apiError(400, 'invalid_request', result.error, { field: result.field === 'pipeline_stage_id' ? 'stage_id' : result.field === 'assigned_to' ? 'owner_id' : result.field })
    return NextResponse.json({ data: toApiLead(result.lead, stages, team, String(organization.currency || 'INR').toUpperCase()) })
  } catch (error: any) {
    console.error('[API lead]', error?.message)
    return apiError(500, 'server_error', 'The deal could not be saved. Please try again.')
  }
}
