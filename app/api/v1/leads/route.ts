import { NextResponse } from 'next/server'
import { apiAuth, apiError, jsonBody, listResponse, paging } from '@/lib/public-api/auth'
import { API_STATUS, apiActor, parseApiLead, pipelineOff, toApiLead } from '@/lib/public-api/leads'
import { teamOf } from '@/lib/pipeline/server'
import { createLead, listLeads, loadStages, resolveContact } from '@/lib/pipeline/store'

export const runtime = 'nodejs'

// GET /api/v1/leads?status=&stage_id=&owner_id=&source=&search=&follow_up=&limit=&offset=: deals, newest first
export async function GET(request: Request) {
  const auth = await apiAuth(request, 'leads:read')
  if (!auth.ok) return auth.response
  const off = pipelineOff(auth.ctx.organization)
  if (off) return off
  const params = new URL(request.url).searchParams
  const page = paging(params)
  const statusParam = params.get('status') || 'open'
  const status = statusParam === 'all' ? 'all' : API_STATUS[statusParam]
  if (!status) return apiError(400, 'invalid_request', 'status is open, won, lost, on_hold or all.', { field: 'status' })
  const followUp = params.get('follow_up')
  if (followUp && !['due', 'upcoming', 'none'].includes(followUp)) return apiError(400, 'invalid_request', 'follow_up is due, upcoming or none.', { field: 'follow_up' })
  const { db, organizationId, organization } = auth.ctx
  try {
    const [rows, stages, team] = await Promise.all([
      listLeads(apiActor(auth.ctx), { status, stage: params.get('stage_id'), owner: params.get('owner_id'), source: params.get('source'), q: params.get('search'), follow: followUp }, page),
      loadStages(db, organizationId),
      teamOf(db, organizationId),
    ])
    const currency = String(organization.currency || 'INR').toUpperCase()
    return listResponse(rows.map((row) => toApiLead(row, stages, team, currency)), page)
  } catch (error: any) {
    console.error('[API leads]', error?.message)
    return apiError(500, 'server_error', 'The deals could not be read. Please try again.')
  }
}

// POST /api/v1/leads: a new deal for a contact (by contact_id, or contact { name, phone, email, company })
export async function POST(request: Request) {
  const auth = await apiAuth(request, 'leads:write')
  if (!auth.ok) return auth.response
  const off = pipelineOff(auth.ctx.organization)
  if (off) return off
  const read = await jsonBody(request)
  if ('response' in read) return read.response
  const { db, organizationId, organization } = auth.ctx
  try {
    const stages = await loadStages(db, organizationId)
    const parsed = parseApiLead(read.body, stages, false)
    if ('error' in parsed) return apiError(400, 'invalid_request', parsed.error, { field: parsed.field })
    if (parsed.value.status) return apiError(400, 'invalid_request', 'A new deal is open. Send status in a PATCH to close it.', { field: 'status' })
    const actor = apiActor(auth.ctx)
    const contact = await resolveContact(actor, { contact_id: read.body.contact_id, contact: read.body.contact })
    if ('error' in contact) return apiError(400, 'invalid_request', contact.error, { field: contact.field })
    const result = await createLead(actor, { ...parsed.value, assigned_to: parsed.value.assigned_to ?? null, contactId: contact.id }, 'api')
    if (result.error) return apiError(400, 'invalid_request', result.error, { field: result.field === 'pipeline_stage_id' ? 'stage_id' : result.field === 'assigned_to' ? 'owner_id' : result.field })
    return NextResponse.json({ data: toApiLead(result.lead, stages, await teamOf(db, organizationId), String(organization.currency || 'INR').toUpperCase()) }, { status: 201 })
  } catch (error: any) {
    console.error('[API leads]', error?.message)
    return apiError(500, 'server_error', 'The deal could not be saved. Please try again.')
  }
}
