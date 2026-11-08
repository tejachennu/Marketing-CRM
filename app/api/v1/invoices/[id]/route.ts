import { NextResponse } from 'next/server'
import { apiAuth, apiError, frontDeskOff, jsonBody } from '@/lib/public-api/auth'
import { runCounterAction } from '@/lib/public-api/counter'
import { toApiInvoice } from '@/lib/public-api/front-desk'
import { messageOrigin } from '@/lib/salon/jobs'
import { isUuid } from '@/lib/salon/validate'

export const runtime = 'nodejs'
export const maxDuration = 30

type Params = { params: Promise<{ id: string }> }

async function find(db: any, organizationId: string, id: string) {
  if (!isUuid(id)) return null
  const { data } = await db.from('salon_invoices').select('*').eq('organization_id', organizationId).eq('id', id).maybeSingle()
  return data || null
}

// GET /api/v1/invoices/{id}
export async function GET(request: Request, { params }: Params) {
  const auth = await apiAuth(request, 'front_desk:read')
  if (!auth.ok) return auth.response
  const off = frontDeskOff(auth.ctx.organization)
  if (off) return off
  const invoice = await find(auth.ctx.db, auth.ctx.organizationId, (await params).id)
  return invoice ? NextResponse.json({ data: toApiInvoice(invoice, messageOrigin(new URL(request.url).origin)) }) : apiError(404, 'not_found', 'No invoice with that id.')
}

// PATCH /api/v1/invoices/{id} { status: "paid", payment_method } or { status: "void" }
export async function PATCH(request: Request, { params }: Params) {
  const auth = await apiAuth(request, 'front_desk:write')
  if (!auth.ok) return auth.response
  const off = frontDeskOff(auth.ctx.organization)
  if (off) return off
  const { id } = await params
  if (!(await find(auth.ctx.db, auth.ctx.organizationId, id))) return apiError(404, 'not_found', 'No invoice with that id.')
  const read = await jsonBody(request)
  if ('response' in read) return read.response
  const { status, payment_method } = read.body
  if (status !== 'paid' && status !== 'void') return apiError(400, 'invalid_request', 'status is "paid" (with payment_method cash, upi or card) or "void".', { field: 'status' })
  if (status === 'paid' && !['cash', 'upi', 'card'].includes(payment_method)) return apiError(400, 'invalid_request', 'payment_method is cash, upi or card.', { field: 'payment_method' })
  try {
    const origin = messageOrigin(new URL(request.url).origin)
    const result = await runCounterAction(auth.ctx, status === 'paid' ? { type: 'pay_invoice', invoice_id: id, payment_method } : { type: 'void_invoice', invoice_id: id }, origin)
    return NextResponse.json({ data: toApiInvoice(result.invoice, origin) })
  } catch (error: any) {
    return apiError(409, 'invalid_change', error?.message || 'That change could not be made.')
  }
}
