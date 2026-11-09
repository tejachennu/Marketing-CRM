import { NextRequest, NextResponse } from 'next/server'
import { parseLeadInput } from '@/lib/pipeline/rules'
import { pipelineAccess, serverError } from '@/lib/pipeline/server'
import { createLead, listLeads, resolveContact } from '@/lib/pipeline/store'

export const runtime = 'nodejs'

// GET ?organizationId&status&stage&priority&owner&source&q&follow&sort&dir&limit&offset: deals,
// a page at a time (a salesperson who only sees their own work gets only their deals)
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const access = await pipelineAccess(request, params.get('organizationId'))
  if (!access.ok) return access.response
  const limit = Math.min(Math.max(Number(params.get('limit')) || 50, 1), 500)
  const offset = Math.max(Number(params.get('offset')) || 0, 0)
  try {
    const rows = await listLeads(access.ctx.actor, {
      status: params.get('status'), stage: params.get('stage'), priority: params.get('priority'), owner: params.get('owner'),
      source: params.get('source'), q: params.get('q'), follow: params.get('follow'), sort: params.get('sort'), dir: params.get('dir'),
    }, { limit, offset })
    return NextResponse.json({ success: true, leads: rows.slice(0, limit), hasMore: rows.length > limit })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unknown status.') return NextResponse.json({ error: error.message }, { status: 400 })
    return serverError('list', error)
  }
}

// POST { organizationId, title, value, contact_id | contact {name, phone, email, company}, ... }: a new deal
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await pipelineAccess(request, body?.organizationId, 'records.write')
  if (!access.ok) return access.response
  const parsed = parseLeadInput(body)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 })
  try {
    const contact = await resolveContact(access.ctx.actor, { contact_id: body?.contact_id, contact: body?.contact })
    if ('error' in contact) return NextResponse.json({ error: contact.error, field: contact.field }, { status: 400 })
    const result = await createLead(access.ctx.actor, { ...parsed.value, contactId: contact.id })
    if (result.error) return NextResponse.json({ error: result.error, field: result.field }, { status: 400 })
    return NextResponse.json({ success: true, lead: result.lead }, { status: 201 })
  } catch (error) {
    return serverError('create', error)
  }
}
