import { NextRequest, NextResponse } from 'next/server'
import { badRequest, salonAccess, serverError } from '@/lib/salon/server'
import { isUuid, parseService } from '@/lib/salon/validate'

export const runtime = 'nodejs'

// POST { organizationId, ...service }: add a service (managers and up)
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  const parsed = parseService(body)
  if ('error' in parsed) return badRequest(parsed.error)
  const { db, organizationId } = access.ctx
  // New services go to the end of the list
  const { count } = await db.from('salon_services').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId)
  const { data, error } = await db.from('salon_services').insert({ ...parsed.value, organization_id: organizationId, position: count || 0 }).select('*').single()
  if (error) return serverError('services', error)
  return NextResponse.json({ success: true, service: data })
}

// PATCH { organizationId, id, ...changes }: change a service
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  if (!isUuid(body?.id)) return badRequest('Choose a service.')
  const parsed = parseService(body, true)
  if ('error' in parsed) return badRequest(parsed.error)
  const { db, organizationId } = access.ctx
  const { data, error } = await db.from('salon_services').update({ ...parsed.value, updated_at: new Date().toISOString() }).eq('id', body.id).eq('organization_id', organizationId).select('*').single()
  if (error) return serverError('services', error)
  return NextResponse.json({ success: true, service: data })
}

// DELETE ?organizationId&id: remove a service. Past appointments and invoices keep their own copy.
export async function DELETE(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const access = await salonAccess(request, params.get('organizationId'), 'automation.manage')
  if (!access.ok) return access.response
  const id = params.get('id')
  if (!isUuid(id)) return badRequest('Choose a service.')
  const { db, organizationId } = access.ctx
  const { error } = await db.from('salon_services').delete().eq('id', id).eq('organization_id', organizationId)
  if (error) return serverError('services', error)
  return NextResponse.json({ success: true })
}
