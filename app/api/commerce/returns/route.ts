import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { parseRefund, readReturn, readReturnSettings, refundable } from '@/lib/commerce/returns'
import { decideReturn, loadReturnSettings, refundOrder, refundsFor, saveReturnSettings } from '@/lib/commerce/returns-store'
import { storeRazorpayKeys } from '@/lib/commerce/store-payments'

export const runtime = 'nodejs'

/**
 * GET ?organizationId=                 return settings { on, days }
 * GET ?organizationId=&orderId=        the order's return ask, refunds, what is left, and how a refund would go
 */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const organizationId = params.get('organizationId')
  const orderId = params.get('orderId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const db = getSupabaseAdminClient()
  if (!orderId) return NextResponse.json({ settings: await loadReturnSettings(db, organizationId!) })
  const { data: order } = await db.from('commerce_orders').select('*').eq('id', orderId).eq('organization_id', organizationId).maybeSingle()
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  const refunds = await refundsFor(db, organizationId!, orderId)
  const { data: org } = await db.from('organizations').select('id, store_razorpay_key_id, store_razorpay_key_secret').eq('id', organizationId).maybeSingle()
  const viaRazorpay = order.payment_method === 'razorpay' && Boolean(order.shipping_address?.payment?.payment_id) && Boolean(storeRazorpayKeys(org))
  return NextResponse.json({
    return: readReturn(order),
    refunds: refunds.map((r) => ({ id: r.id, amount: Number(r.amount), reason: r.reason, method: r.method, status: r.status, restocked: r.restocked, createdAt: r.created_at })),
    ...refundable(order, refunds),
    viaRazorpay,
  })
}

/**
 * POST { organizationId, orderId, action: 'accept' | 'decline', note? }   answer the customer's return ask
 * POST { organizationId, orderId, action: 'refund', amount, reason?, restock? }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'records.write' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  if (typeof body.orderId !== 'string' || !body.orderId) return NextResponse.json({ error: 'Which order?' }, { status: 400 })
  const db = getSupabaseAdminClient()
  try {
    if (body.action === 'accept' || body.action === 'decline') {
      const result = await decideReturn(db, body.organizationId, body.orderId, body.action === 'accept' ? 'accepted' : 'declined', String(body.note || ''))
      if ('error' in result) return NextResponse.json({ error: result.error }, { status: 409 })
      return NextResponse.json({ success: true, ...result })
    }
    if (body.action === 'refund') {
      const { data: order } = await db.from('commerce_orders').select('*').eq('id', body.orderId).eq('organization_id', body.organizationId).maybeSingle()
      if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
      const { left } = refundable(order, await refundsFor(db, body.organizationId, body.orderId))
      const parsed = parseRefund(body, left)
      if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
      const { data: org } = await db.from('organizations').select('*').eq('id', body.organizationId).maybeSingle()
      const result = await refundOrder(db, org, order, { ...parsed, byUserId: access.user?.id || null })
      if ('error' in result) return NextResponse.json({ error: result.error }, { status: 409 })
      return NextResponse.json({ success: true, method: result.method, left: result.left })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error: any) {
    console.error('[Shop returns]', error?.message)
    return NextResponse.json({ error: 'That did not work. Please try again.' }, { status: 500 })
  }
}

/** PUT { organizationId, settings: { on, days } } */
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'automation.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const settings = readReturnSettings(body?.settings)
  const { error } = await saveReturnSettings(getSupabaseAdminClient(), body.organizationId, settings)
  if (error) return NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 })
  return NextResponse.json({ success: true, settings })
}
