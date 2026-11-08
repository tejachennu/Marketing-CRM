import { NextResponse } from 'next/server'
import { apiAuth, apiError, frontDeskOff, jsonBody, listResponse, paging } from '@/lib/public-api/auth'
import { runCounterAction } from '@/lib/public-api/counter'
import { dateWindow, toApiInvoice } from '@/lib/public-api/front-desk'
import { normalizePhone } from '@/lib/public-api/keys'
import { parseCounterAction } from '@/lib/salon/actions'
import { messageOrigin } from '@/lib/salon/jobs'
import { withSalonSchema } from '@/lib/salon/schema'

export const runtime = 'nodejs'
export const maxDuration = 30

// GET /api/v1/invoices?date= | from=&to= &status=paid|unpaid|void: bills in that window, newest first
export async function GET(request: Request) {
  const auth = await apiAuth(request, 'front_desk:read')
  if (!auth.ok) return auth.response
  const off = frontDeskOff(auth.ctx.organization)
  if (off) return off
  const params = new URL(request.url).searchParams
  const window = dateWindow(params)
  if ('error' in window) return apiError(400, 'invalid_request', window.error)
  const status = params.get('status')
  if (status && !['paid', 'unpaid', 'void'].includes(status)) return apiError(400, 'invalid_request', 'status is paid, unpaid or void.', { field: 'status' })
  const page = paging(params)
  let query = auth.ctx.db.from('salon_invoices').select('*').eq('organization_id', auth.ctx.organizationId).gte('issued_at', window.start).lt('issued_at', window.end)
  if (status) query = query.eq('status', status)
  const { data, error } = await withSalonSchema(() => query.order('issued_at', { ascending: false }).range(page.offset, page.offset + page.limit))
  if (error) return apiError(500, 'server_error', 'The invoices could not be read. Please try again.')
  const origin = messageOrigin(new URL(request.url).origin)
  return listResponse((data || []).map((row: any) => toApiInvoice(row, origin)), page)
}

// POST /api/v1/invoices: bill an appointment ({ appointment_id }) or a walk-in ({ customer, service_ids })
export async function POST(request: Request) {
  const auth = await apiAuth(request, 'front_desk:write')
  if (!auth.ok) return auth.response
  const off = frontDeskOff(auth.ctx.organization)
  if (off) return off
  const read = await jsonBody(request)
  if ('response' in read) return read.response
  const body = read.body
  const common = { staff_ids: body.staff_ids, discount: body.discount, payment_method: body.payment_method ?? null, send_whatsapp: body.send_whatsapp !== false }
  let parsed
  if (body.appointment_id) {
    parsed = parseCounterAction({ type: 'complete_and_bill', appointment_id: body.appointment_id, extra_service_ids: body.extra_service_ids, ...common })
  } else {
    const phone = body.customer?.phone ? normalizePhone(body.customer.phone) : null
    if (body.customer?.phone && !phone) return apiError(400, 'invalid_request', 'customer.phone needs its country code, like +919876543210.', { field: 'customer.phone' })
    parsed = parseCounterAction({ type: 'walk_in_bill', customer: { name: body.customer?.name || 'Walk-in customer', phone, contact_id: body.customer?.contact_id }, service_ids: body.service_ids, ...common })
  }
  if ('error' in parsed) return apiError(400, 'invalid_request', parsed.error)
  if (body.payment_method && !['cash', 'upi', 'card'].includes(body.payment_method)) return apiError(400, 'invalid_request', 'payment_method is cash, upi or card (or leave it out for not paid yet).', { field: 'payment_method' })
  try {
    const origin = messageOrigin(new URL(request.url).origin)
    const result = await runCounterAction(auth.ctx, parsed.action, origin)
    return NextResponse.json({ data: toApiInvoice(result.invoice, origin), whatsapp: result.whatsapp ?? null }, { status: 201 })
  } catch (error: any) {
    return apiError(400, 'invalid_request', error?.message || 'That bill could not be made.')
  }
}
