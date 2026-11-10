import { NextRequest, NextResponse } from 'next/server'
import { canSeeAll } from '@/lib/rbac'
import { isUuid } from '@/lib/record-visibility'
import { pipelineAccess } from '@/lib/pipeline/server'
import { parseLeadInput } from '@/lib/pipeline/rules'
import { createLead } from '@/lib/pipeline/store'

export const runtime = 'nodejs'

// POST { organizationId, ticketId, title, value?, priority?, pipeline_stage_id?, assigned_to?, resolve? }:
// move a ticket to the Sales Pipeline as a deal for the same customer, link the chat to the deal,
// and (by default) resolve the ticket. The same as "Convert to Pipeline Lead" on the Tickets page.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await pipelineAccess(request, body?.organizationId, 'records.write')
  if (!access.ok) return access.response
  const { db, organizationId, actor, user } = access.ctx
  if (!isUuid(body?.ticketId)) return NextResponse.json({ error: 'Choose a ticket.' }, { status: 400 })
  const { data: ticket } = await db.from('tickets').select('id, subject, contact_id, conversation_id, assigned_to, status').eq('id', body.ticketId).eq('organization_id', organizationId).maybeSingle()
  if (!ticket || (!canSeeAll(user) && ticket.assigned_to !== user?.id)) return NextResponse.json({ error: 'That ticket is not there any more.' }, { status: 404 })
  if (!ticket.contact_id) return NextResponse.json({ error: 'This ticket has no customer to make a deal for.' }, { status: 400 })
  const parsed = parseLeadInput({ title: body?.title, value: body?.value, priority: body?.priority || 'medium', pipeline_stage_id: body?.pipeline_stage_id || null, assigned_to: body?.assigned_to, source: 'whatsapp' })
  if ('error' in parsed) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 })
  try {
    const result = await createLead(actor, { ...parsed.value, description: `Moved from the ticket: ${ticket.subject}`, contactId: ticket.contact_id }, 'whatsapp')
    if (result.error) return NextResponse.json({ error: result.error, field: result.field }, { status: 400 })
    if (ticket.conversation_id) await db.from('conversations').update({ lead_id: result.lead.id }).eq('id', ticket.conversation_id).eq('organization_id', organizationId)
    if (body?.resolve !== false && ticket.status !== 'resolved') {
      await db.from('tickets').update({ status: 'resolved', updated_at: new Date().toISOString() }).eq('id', ticket.id)
    }
    return NextResponse.json({ success: true, lead: result.lead, resolved: body?.resolve !== false })
  } catch (error: any) {
    console.error('[Tickets] Move to pipeline failed:', error?.message || error)
    return NextResponse.json({ error: 'The deal could not be created. Try again.' }, { status: 500 })
  }
}
