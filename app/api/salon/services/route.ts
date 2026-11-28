import { NextRequest, NextResponse } from 'next/server'
import { badRequest, salonAccess, serverError } from '@/lib/salon/server'
import { isUuid, parseService } from '@/lib/salon/validate'

import { changedFields, logChange } from '@/lib/salon/change-log'
import { saveWithServiceTime } from '@/lib/salon/service-time'

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
  const { data, error } = await saveWithServiceTime({ ...parsed.value, organization_id: organizationId, position: count || 0 }, (values) => db.from('salon_services').insert(values).select('*').single())
  if (error) return serverError('services', error)
  await logChange(access.ctx, { area: 'service', action: 'added', target: data.name, details: { price: data.price, category: data.category, billable: data.billable, ...(data.takes_time === false ? { takes_time: false } : {}) } })
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
  const { data: previous } = await db.from('salon_services').select('*').eq('id', body.id).eq('organization_id', organizationId).maybeSingle()
  const { data, error } = await saveWithServiceTime({ ...parsed.value, updated_at: new Date().toISOString() }, (values) => db.from('salon_services').update(values).eq('id', body.id).eq('organization_id', organizationId).select('*').single())
  if (error) return serverError('services', error)
  const changes = changedFields(previous, data, ['name', 'category', 'price', 'duration_minutes', 'tax_rate', 'sac_code', 'active', 'billable', 'takes_time'])
  if (Object.keys(changes).length) {
    // Billing on/off and time on/off get their own line in the history, so they are easy to find
    const only = Object.keys(changes).length === 1
    const action = only && changes.billable ? (data.billable ? 'billing on' : 'billing off') : only && changes.takes_time ? (data.takes_time === false ? 'time off' : 'time on') : 'changed'
    await logChange(access.ctx, { area: 'service', action, target: data.name, details: changes })
  }
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
  const { data: previous } = await db.from('salon_services').select('name, price').eq('id', id).eq('organization_id', organizationId).maybeSingle()
  const { error } = await db.from('salon_services').delete().eq('id', id).eq('organization_id', organizationId)
  if (error) return serverError('services', error)
  await logChange(access.ctx, { area: 'service', action: 'removed', target: previous?.name || 'A service', details: { price: previous?.price } })
  return NextResponse.json({ success: true })
}
