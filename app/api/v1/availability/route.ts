import { NextResponse } from 'next/server'
import { apiAuth, apiError, frontDeskOff } from '@/lib/public-api/auth'
import { availableTimes } from '@/lib/public-api/front-desk'
import { isUuid } from '@/lib/salon/validate'
import { fromIst, istDate } from '@/lib/salon/spoken'

export const runtime = 'nodejs'

// GET /api/v1/availability?date=YYYY-MM-DD&service_ids=a,b&staff_id=: free start times that day (India time)
export async function GET(request: Request) {
  const auth = await apiAuth(request, 'front_desk:read')
  if (!auth.ok) return auth.response
  const off = frontDeskOff(auth.ctx.organization)
  if (off) return off
  const params = new URL(request.url).searchParams
  const date = params.get('date') || istDate()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !fromIst(date)) return apiError(400, 'invalid_request', 'date is YYYY-MM-DD (India time), like 2026-11-08.', { field: 'date' })
  const serviceIds = [...new Set(String(params.get('service_ids') || '').split(',').map((s) => s.trim()).filter(Boolean))]
  if (!serviceIds.length || serviceIds.some((id) => !isUuid(id))) return apiError(400, 'invalid_request', 'Give service_ids: one or more service ids from GET /api/v1/services, separated by commas.', { field: 'service_ids' })
  const staffId = params.get('staff_id')
  if (staffId && !isUuid(staffId)) return apiError(400, 'invalid_request', 'staff_id must be an id from GET /api/v1/staff.', { field: 'staff_id' })
  const result = await availableTimes(auth.ctx.db, auth.ctx.organizationId, { date, serviceIds, staffId })
  if ('error' in result) return apiError(400, 'invalid_request', result.error!)
  return NextResponse.json({ data: { date, duration_minutes: result.minutes, times: result.times, slots: result.times.map((time: string) => ({ time, starts_at: fromIst(date, time)!.toISOString() })) } })
}
