import { NextRequest, NextResponse } from 'next/server'
import { LEAD_STATUSES, parseLeadInput, type LeadStatus } from '@/lib/pipeline/rules'
import { pipelineAccess, serverError, teamOf } from '@/lib/pipeline/server'
import { findLead, leadHistory, loadStages, updateLead, withContacts } from '@/lib/pipeline/store'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

const NOT_FOUND = 'This deal was not found, or it belongs to someone else.'

// GET ?organizationId: one deal with its contact, its history and the contact's WhatsApp chat
export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params
  const access = await pipelineAccess(request, new URL(request.url).searchParams.get('organizationId'))
  if (!access.ok) return access.response
  const { db, organizationId, actor } = access.ctx
  try {
    const lead = await findLead(actor, id)
    if (!lead) return NextResponse.json({ error: NOT_FOUND }, { status: 404 })
    const [[withContact], history, chat] = await Promise.all([
      withContacts(db, organizationId, [lead]),
      leadHistory(actor, lead.id),
      lead.contact_id
        ? db.from('conversations').select('id').eq('organization_id', organizationId).eq('contact_id', lead.contact_id).order('last_message_at', { ascending: false, nullsFirst: false }).limit(1)
        : Promise.resolve({ data: [] }),
    ])
    return NextResponse.json({ success: true, lead: withContact, history, conversationId: chat?.data?.[0]?.id || null })
  } catch (error) {
    return serverError('deal', error)
  }
}

// PATCH { organizationId, ...fields, status?, reason? }: change a deal, move it, give it to someone,
// set the follow-up, or mark it won / lost / on hold / reopened
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const access = await pipelineAccess(request, body?.organizationId, 'records.write')
  if (!access.ok) return access.response
  const parsed = parseLeadInput(body, true)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 })
  if (body?.status !== undefined && !LEAD_STATUSES.includes(body.status)) return NextResponse.json({ error: 'Status is active, won, lost or on_hold.', field: 'status' }, { status: 400 })
  const { db, organizationId, actor } = access.ctx
  try {
    const current = await findLead(actor, id)
    if (!current) return NextResponse.json({ error: NOT_FOUND }, { status: 404 })
    const [stages, team] = await Promise.all([loadStages(db, organizationId, false), teamOf(db, organizationId)])
    const result = await updateLead(actor, current, { ...parsed.value, status: body?.status as LeadStatus | undefined, reason: body?.reason ?? null },
      new Map(stages.map((s: any) => [s.id, s.name])), new Map(team.map((u: any) => [u.id, u.full_name || u.email || 'Teammate'])))
    if (result.error) return NextResponse.json({ error: result.error, field: result.field }, { status: 400 })
    return NextResponse.json({ success: true, lead: result.lead })
  } catch (error) {
    return serverError('update', error)
  }
}

// DELETE ?organizationId: remove a deal for good (managers and admins; others mark it lost)
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params
  const access = await pipelineAccess(request, new URL(request.url).searchParams.get('organizationId'), 'records.assign')
  if (!access.ok) return access.response
  const { db, organizationId, actor } = access.ctx
  try {
    const lead = await findLead(actor, id)
    if (!lead) return NextResponse.json({ error: NOT_FOUND }, { status: 404 })
    await db.from('lead_activities').delete().eq('organization_id', organizationId).eq('lead_id', lead.id)
    const { error } = await db.from('leads').delete().eq('organization_id', organizationId).eq('id', lead.id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true })
  } catch (error) {
    return serverError('delete', error)
  }
}
