import { NextRequest, NextResponse } from 'next/server'
import { badRequest, salonAccess, serverError } from '@/lib/salon/server'
import { isUuid, parseStaff } from '@/lib/salon/validate'
import { withSalonSchema } from '@/lib/salon/schema'

import { changedFields, logChange } from '@/lib/salon/change-log'

export const runtime = 'nodejs'

// POST { organizationId, ...member }: add a team member (managers and up)
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  const parsed = parseStaff(body)
  if ('error' in parsed) return badRequest(parsed.error)
  const { db, organizationId } = access.ctx
  const { data, error } = await withSalonSchema(() => db.from('salon_staff').insert({ ...parsed.value, organization_id: organizationId }).select('*').single())
  if (error) return serverError('staff', error)
  await logChange(access.ctx, { area: 'team', action: 'added', target: data.name, details: { commission_percent: data.commission_percent } })
  return NextResponse.json({ success: true, member: data })
}

// PATCH { organizationId, id, ...changes }: change a team member
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  if (!isUuid(body?.id)) return badRequest('Choose a team member.')
  const parsed = parseStaff(body, true)
  if ('error' in parsed) return badRequest(parsed.error)
  const { db, organizationId } = access.ctx
  const { data: previous } = await db.from('salon_staff').select('*').eq('id', body.id).eq('organization_id', organizationId).maybeSingle()
  const { data, error } = await withSalonSchema(() => db.from('salon_staff').update({ ...parsed.value, updated_at: new Date().toISOString() }).eq('id', body.id).eq('organization_id', organizationId).select('*').single())
  if (error) return serverError('staff', error)
  const changes = changedFields(previous, data, ['name', 'phone', 'service_ids', 'active', 'commission_percent'])
  if (Object.keys(changes).length) await logChange(access.ctx, { area: 'team', action: 'changed', target: data.name, details: changes })
  return NextResponse.json({ success: true, member: data })
}

// DELETE ?organizationId&id: remove a team member. Their past appointments stay, without a name.
export async function DELETE(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const access = await salonAccess(request, params.get('organizationId'), 'automation.manage')
  if (!access.ok) return access.response
  const id = params.get('id')
  if (!isUuid(id)) return badRequest('Choose a team member.')
  const { db, organizationId } = access.ctx
  const { data: previous } = await db.from('salon_staff').select('name').eq('id', id).eq('organization_id', organizationId).maybeSingle()
  const { error } = await db.from('salon_staff').delete().eq('id', id).eq('organization_id', organizationId)
  if (error) return serverError('staff', error)
  await logChange(access.ctx, { area: 'team', action: 'removed', target: previous?.name || 'A team member' })
  return NextResponse.json({ success: true })
}
