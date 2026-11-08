import { NextResponse } from 'next/server'
import { apiAuth, apiError, frontDeskOff, jsonBody, listResponse, paging } from '@/lib/public-api/auth'
import { runCounterAction } from '@/lib/public-api/counter'
import { availableTimes, dateWindow, toApiAppointment } from '@/lib/public-api/front-desk'
import { normalizePhone } from '@/lib/public-api/keys'
import { parseCounterAction } from '@/lib/salon/actions'
import { messageOrigin } from '@/lib/salon/jobs'
import { withSalonSchema } from '@/lib/salon/schema'
import { istDate, istTime } from '@/lib/salon/spoken'

export const runtime = 'nodejs'
export const maxDuration = 30

const STATUSES = ['requested', 'booked', 'arrived', 'in_service', 'completed', 'cancelled', 'no_show']

// GET /api/v1/appointments?date= | from=&to= &status=: appointments in that window (India dates), earliest first
export async function GET(request: Request) {
  const auth = await apiAuth(request, 'front_desk:read')
  if (!auth.ok) return auth.response
  const off = frontDeskOff(auth.ctx.organization)
  if (off) return off
  const params = new URL(request.url).searchParams
  const window = dateWindow(params)
  if ('error' in window) return apiError(400, 'invalid_request', window.error)
  const status = params.get('status')
  if (status && !STATUSES.includes(status)) return apiError(400, 'invalid_request', `status is one of: ${STATUSES.join(', ')}.`, { field: 'status' })
  const page = paging(params)
  let query = auth.ctx.db.from('salon_appointments').select('*').eq('organization_id', auth.ctx.organizationId).gte('starts_at', window.start).lt('starts_at', window.end)
  if (status) query = query.eq('status', status)
  const { data, error } = await withSalonSchema(() => query.order('starts_at').range(page.offset, page.offset + page.limit))
  if (error) return apiError(500, 'server_error', 'The appointments could not be read. Please try again.')
  return listResponse((data || []).map(toApiAppointment), page)
}

// POST /api/v1/appointments: book an appointment (checked against free times unless check_availability is false)
export async function POST(request: Request) {
  const auth = await apiAuth(request, 'front_desk:write')
  if (!auth.ok) return auth.response
  const off = frontDeskOff(auth.ctx.organization)
  if (off) return off
  const read = await jsonBody(request)
  if ('response' in read) return read.response
  const body = read.body
  const phone = body.customer?.phone ? normalizePhone(body.customer.phone) : null
  if (body.customer?.phone && !phone) return apiError(400, 'invalid_request', 'customer.phone needs its country code, like +919876543210.', { field: 'customer.phone' })
  const starts = Date.parse(String(body.starts_at || ''))
  if (!Number.isFinite(starts)) return apiError(400, 'invalid_request', 'starts_at is the start time in ISO 8601, like 2026-11-08T17:00:00+05:30.', { field: 'starts_at' })
  if (starts < Date.now() - 5 * 60_000) return apiError(400, 'invalid_request', 'starts_at is in the past.', { field: 'starts_at' })
  const parsed = parseCounterAction({
    type: 'create_appointment', customer: { name: body.customer?.name, phone, contact_id: body.customer?.contact_id },
    service_ids: body.service_ids, staff_id: body.staff_id, staff_ids: body.staff_ids, starts_at: new Date(starts).toISOString(),
    notes: body.notes, send_whatsapp: body.send_whatsapp !== false,
  })
  if ('error' in parsed) return apiError(400, 'invalid_request', parsed.error)
  if (parsed.action.type !== 'create_appointment') return apiError(400, 'invalid_request', 'That could not be booked.')
  if (body.check_availability !== false) {
    const date = istDate(starts)
    const times = await availableTimes(auth.ctx.db, auth.ctx.organizationId, { date, serviceIds: parsed.action.service_ids, staffId: parsed.action.staff_id || null })
    if ('error' in times) return apiError(400, 'invalid_request', times.error!)
    if (!times.check(istTime(starts))) return apiError(409, 'slot_taken', 'That time is not free. GET /api/v1/availability shows the free times, or send "check_availability": false to book it anyway.')
  }
  try {
    const result = await runCounterAction(auth.ctx, parsed.action, messageOrigin(new URL(request.url).origin))
    // The counter shows where a booking came from
    await auth.ctx.db.from('salon_appointments').update({ source: 'api' }).eq('id', result.appointment.id).eq('organization_id', auth.ctx.organizationId)
    return NextResponse.json({ data: toApiAppointment({ ...result.appointment, source: 'api' }), whatsapp: result.whatsapp ?? null, warning: result.warning || null }, { status: 201 })
  } catch (error: any) {
    return apiError(400, 'invalid_request', error?.message || 'That could not be booked.')
  }
}
