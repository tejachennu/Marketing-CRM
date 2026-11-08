import { NextResponse } from 'next/server'
import { apiAuth, apiError, frontDeskOff, jsonBody } from '@/lib/public-api/auth'
import { runCounterAction } from '@/lib/public-api/counter'
import { toApiAppointment } from '@/lib/public-api/front-desk'
import { STATUS_CHANGES } from '@/lib/salon/actions'
import { messageOrigin } from '@/lib/salon/jobs'
import { isUuid } from '@/lib/salon/validate'

export const runtime = 'nodejs'
export const maxDuration = 30

type Params = { params: Promise<{ id: string }> }

async function find(db: any, organizationId: string, id: string) {
  if (!isUuid(id)) return null
  const { data } = await db.from('salon_appointments').select('*').eq('organization_id', organizationId).eq('id', id).maybeSingle()
  return data || null
}

// GET /api/v1/appointments/{id}
export async function GET(request: Request, { params }: Params) {
  const auth = await apiAuth(request, 'front_desk:read')
  if (!auth.ok) return auth.response
  const off = frontDeskOff(auth.ctx.organization)
  if (off) return off
  const appointment = await find(auth.ctx.db, auth.ctx.organizationId, (await params).id)
  return appointment ? NextResponse.json({ data: toApiAppointment(appointment) }) : apiError(404, 'not_found', 'No appointment with that id.')
}

// PATCH /api/v1/appointments/{id} { status }: arrived, in_service, cancelled, no_show or booked (to book again)
export async function PATCH(request: Request, { params }: Params) {
  const auth = await apiAuth(request, 'front_desk:write')
  if (!auth.ok) return auth.response
  const off = frontDeskOff(auth.ctx.organization)
  if (off) return off
  const { id } = await params
  if (!(await find(auth.ctx.db, auth.ctx.organizationId, id))) return apiError(404, 'not_found', 'No appointment with that id.')
  const read = await jsonBody(request)
  if ('response' in read) return read.response
  const status = read.body.status
  if (!STATUS_CHANGES.includes(status)) return apiError(400, 'invalid_request', `status is one of: ${STATUS_CHANGES.join(', ')}. To complete a visit, create its bill: POST /api/v1/invoices with appointment_id.`, { field: 'status' })
  try {
    const result = await runCounterAction(auth.ctx, { type: 'set_status', appointment_id: id, status }, messageOrigin(new URL(request.url).origin))
    return NextResponse.json({ data: toApiAppointment(result.appointment) })
  } catch (error: any) {
    return apiError(409, 'invalid_change', error?.message || 'That change could not be made.')
  }
}
