import { NextResponse } from 'next/server'
import { apiAuth, apiError, jsonBody } from '@/lib/public-api/auth'
import { apiActor, isLeadId, pipelineOff } from '@/lib/public-api/leads'
import { ACTIVITY_TYPES, parseLeadInput } from '@/lib/pipeline/rules'
import { addActivity, findLead, leadHistory } from '@/lib/pipeline/store'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

// POST /api/v1/leads/{id}/activities: note a call, WhatsApp, meeting, email or note on the deal,
// with the next follow-up if given
export async function POST(request: Request, { params }: Params) {
  const auth = await apiAuth(request, 'leads:write')
  if (!auth.ok) return auth.response
  const off = pipelineOff(auth.ctx.organization)
  if (off) return off
  const { id } = await params
  if (!isLeadId(id)) return apiError(404, 'not_found', 'No deal with that id.')
  const read = await jsonBody(request)
  if ('response' in read) return read.response
  const type = String(read.body.type || 'note')
  if (!(ACTIVITY_TYPES as readonly string[]).includes(type)) return apiError(400, 'invalid_request', `type is ${ACTIVITY_TYPES.join(', ')}.`, { field: 'type' })
  const content = String(read.body.content ?? '').trim()
  if (!content) return apiError(400, 'invalid_request', 'Send content: what happened.', { field: 'content' })
  const followUp = read.body.next_follow_up_at !== undefined ? parseLeadInput({ next_follow_up_at: read.body.next_follow_up_at }, true) : null
  if (followUp && 'error' in followUp) return apiError(400, 'invalid_request', followUp.error, { field: followUp.field })
  try {
    const actor = apiActor(auth.ctx)
    const lead = await findLead(actor, id)
    if (!lead) return apiError(404, 'not_found', 'No deal with that id.')
    await addActivity(actor, lead, { type, content, ...(followUp && 'value' in followUp ? { next_follow_up_at: followUp.value.next_follow_up_at ?? null } : {}) })
    const history = await leadHistory(actor, id)
    return NextResponse.json({ data: history.find((h: any) => h.type === type && h.content === content.slice(0, 4000)) || history[0] }, { status: 201 })
  } catch (error: any) {
    console.error('[API lead activity]', error?.message)
    return apiError(500, 'server_error', 'The activity could not be saved. Please try again.')
  }
}
