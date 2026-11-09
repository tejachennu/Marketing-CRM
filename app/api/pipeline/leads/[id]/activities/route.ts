import { NextRequest, NextResponse } from 'next/server'
import { ACTIVITY_TYPES, parseLeadInput } from '@/lib/pipeline/rules'
import { pipelineAccess, serverError } from '@/lib/pipeline/server'
import { addActivity, findLead, leadHistory, withContacts } from '@/lib/pipeline/store'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

// POST { organizationId, type: note|call|whatsapp|meeting|email, content, next_follow_up_at? }:
// note what was done with the deal, and when to follow up next
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const access = await pipelineAccess(request, body?.organizationId, 'records.write')
  if (!access.ok) return access.response
  const type = String(body?.type || 'note')
  if (!(ACTIVITY_TYPES as readonly string[]).includes(type)) return NextResponse.json({ error: 'Choose what you did: a note, call, WhatsApp, meeting or email.', field: 'type' }, { status: 400 })
  const content = String(body?.content ?? '').trim()
  if (!content) return NextResponse.json({ error: 'Write what happened.', field: 'content' }, { status: 400 })
  const followUp = body?.next_follow_up_at !== undefined ? parseLeadInput({ next_follow_up_at: body.next_follow_up_at }, true) : null
  if (followUp && 'error' in followUp) return NextResponse.json({ error: followUp.error, field: followUp.field }, { status: 400 })
  const { db, organizationId, actor } = access.ctx
  try {
    const lead = await findLead(actor, id)
    if (!lead) return NextResponse.json({ error: 'This deal was not found, or it belongs to someone else.' }, { status: 404 })
    const saved = await addActivity(actor, lead, { type, content, ...(followUp && 'value' in followUp ? { next_follow_up_at: followUp.value.next_follow_up_at ?? null } : {}) })
    const [[withContact], history] = await Promise.all([withContacts(db, organizationId, [saved]), leadHistory(actor, lead.id)])
    return NextResponse.json({ success: true, lead: withContact, history }, { status: 201 })
  } catch (error) {
    return serverError('activity', error)
  }
}
