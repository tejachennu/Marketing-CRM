import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOrgAccess } from '@/lib/api-auth-helper'
import { sanitizeSearchTerm } from '@/lib/utils'
import { isUuid } from '@/lib/record-visibility'
import { getCommerceSummary } from '@/lib/commerce/commerce-stats'
import { notifyOrderStatus, resendCheckoutStep, voidPaymentRequest } from '@/lib/commerce/commerce-webhook-handler'
import {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  ORDER_VIEWS,
  PAYMENT_STATUSES,
  canTransitionOrder,
  type OrderStatus,
  type OrderView,
} from '@/lib/commerce/commerce-utils'

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

const ORDER_COLUMNS = '*, items:commerce_order_items(*), contact:contacts(id, first_name, last_name, phone_number)'
const WHATSAPP_COLUMNS = 'id, currency, whatsapp_api_token, whatsapp_phone_number_id, whatsapp_graph_api_version, commerce_address_flow_id, commerce_payment_gateway, commerce_gateway_config_name, commerce_enable_cod'

// GET: List commerce orders, one page at a time, with totals for the whole store
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('organizationId')
    const view = (searchParams.get('view') || 'all') as OrderView
    const search = sanitizeSearchTerm(searchParams.get('search'))
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10) || 25))

    if (!orgId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }
    if (!(view in ORDER_VIEWS)) {
      return NextResponse.json({ error: 'Unknown order view' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, orgId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabase()
    let query = supabase
      .from('commerce_orders')
      .select(ORDER_COLUMNS, { count: 'exact' })
      .eq('organization_id', orgId)

    const statuses = ORDER_VIEWS[view]
    if (statuses) query = query.in('status', statuses as unknown as string[])

    if (search) {
      // An order is found by its number or by the customer's name or phone number
      const digits = search.replace(/\D/g, '')
      const contactFilters = [`first_name.ilike.%${search}%`, `last_name.ilike.%${search}%`]
      if (digits.length >= 3) contactFilters.push(`phone_number.ilike.%${digits}%`)
      const { data: contacts } = await supabase
        .from('contacts')
        .select('id')
        .eq('organization_id', orgId)
        .or(contactFilters.join(','))
        .limit(200)
      const contactIds = (contacts || []).map((contact: any) => contact.id).filter(isUuid)
      const orderNumber = search.replace(/^#/, '')
      query = contactIds.length > 0
        ? query.or(`order_number.ilike.%${orderNumber}%,contact_id.in.(${contactIds.join(',')})`)
        : query.ilike('order_number', `%${orderNumber}%`)
    }

    const [{ data: orders, count, error }, summary] = await Promise.all([
      query.order('created_at', { ascending: false }).order('id', { ascending: true }).range((page - 1) * limit, page * limit - 1),
      getCommerceSummary(supabase, orgId),
    ])
    if (error) throw error

    return NextResponse.json({
      orders: orders || [],
      summary,
      pagination: { page, limit, total: count || 0, pages: Math.max(1, Math.ceil((count || 0) / limit)) },
    })
  } catch (err: any) {
    console.error('[API Commerce Orders GET] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/** What to tell the customer about each status the team can set. */
function describeStatusChange(orderNumber: string, status: OrderStatus, tracking: { number: string; carrier: string }): string {
  switch (status) {
    case 'paid':
      return `Payment received for order #${orderNumber}. We are preparing it now.`
    case 'cod_confirmed':
      return `Order #${orderNumber} is confirmed for Cash on Delivery. We are preparing your shipment.`
    case 'shipped': {
      const via = tracking.carrier ? ` with ${tracking.carrier}` : ''
      const number = tracking.number ? ` Tracking number: ${tracking.number}.` : ''
      return `Good news! Order #${orderNumber} has shipped${via}.${number}`
    }
    case 'delivered':
      return `Order #${orderNumber} has been delivered. Thank you for shopping with us!`
    case 'canceled':
      return `Order #${orderNumber} has been canceled. Reply here if you have any questions.`
    default:
      return `Order #${orderNumber} was updated: ${ORDER_STATUS_LABELS[status] || status}.`
  }
}

// PATCH: Update order status or details
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const { orderId, organizationId, status, paymentStatus, customerNote, notifyCustomer } = body || {}
    const text = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : undefined)
    const trackingNumber = text(body?.trackingNumber, 80)
    const carrier = text(body?.carrier, 60)

    if (!orderId || !organizationId) {
      return NextResponse.json({ error: 'Missing orderId or organizationId' }, { status: 400 })
    }
    if (!isUuid(orderId)) {
      return NextResponse.json({ error: 'Invalid orderId' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, organizationId, { permission: 'records.write' })
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    if (status && !ORDER_STATUSES.includes(status)) {
      return NextResponse.json({ error: `Unsupported order status: ${status}` }, { status: 400 })
    }
    if (paymentStatus && !PAYMENT_STATUSES.includes(paymentStatus)) {
      return NextResponse.json({ error: `Unsupported payment status: ${paymentStatus}` }, { status: 400 })
    }

    const supabase = getSupabase()

    const { data: order, error: fetchErr } = await supabase
      .from('commerce_orders')
      .select('*, contact:contacts(phone_number, first_name)')
      .eq('id', orderId)
      .eq('organization_id', organizationId)
      .single()

    if (fetchErr || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const statusChanged = Boolean(status) && status !== order.status
    if (statusChanged && !canTransitionOrder(order.status, status)) {
      return NextResponse.json(
        {
          error: `An order that is "${ORDER_STATUS_LABELS[order.status as OrderStatus] || order.status}" cannot be changed to "${ORDER_STATUS_LABELS[status as OrderStatus]}".`,
        },
        { status: 409 }
      )
    }

    const updates: Record<string, any> = { updated_at: new Date().toISOString() }
    if (statusChanged) {
      updates.status = status
      // Keep the payment fields consistent with the status instead of trusting the client to send both
      if (status === 'paid') {
        updates.payment_status = 'paid'
        // Marked by hand: the money came in outside the chat (bank transfer, cash, a payment link)
        if (!order.payment_method || order.payment_method === 'cod') updates.payment_method = 'manual'
      }
      if (status === 'cod_confirmed') updates.payment_method = 'cod'
      if (status === 'delivered' && order.payment_method === 'cod') updates.payment_status = 'paid' // cash is collected on delivery
    }
    if (paymentStatus) updates.payment_status = paymentStatus
    if (customerNote !== undefined) updates.customer_note = String(customerNote ?? '').slice(0, 1000)

    // Tracking details are kept with the delivery address
    const shipping = { ...(order.shipping_address || {}) }
    let shippingChanged = false
    if (trackingNumber !== undefined) { shipping.tracking_number = trackingNumber; shippingChanged = true }
    if (carrier !== undefined) { shipping.carrier = carrier; shippingChanged = true }
    if (statusChanged && status === 'shipped') { shipping.shipped_at = new Date().toISOString(); shippingChanged = true }
    if (statusChanged && status === 'delivered') { shipping.delivered_at = new Date().toISOString(); shippingChanged = true }
    if (shippingChanged) updates.shipping_address = shipping

    // The status condition stops two people (or two clicks) from applying the same change twice
    let updateQuery = supabase.from('commerce_orders').update(updates).eq('id', orderId).eq('organization_id', organizationId)
    if (statusChanged) updateQuery = updateQuery.eq('status', order.status)
    const { data: updatedRows, error: updateErr } = await updateQuery.select(ORDER_COLUMNS)

    if (updateErr) throw updateErr
    const updatedOrder = updatedRows?.[0]
    if (!updatedOrder) {
      return NextResponse.json({ error: 'This order was just changed by someone else. Refresh to see its current status.' }, { status: 409 })
    }

    let notified = false
    let notifyError: string | null = null
    let paymentRequestCanceled = false

    if (statusChanged) {
      const { data: org } = await supabase.from('organizations').select(WHATSAPP_COLUMNS).eq('id', organizationId).single()
      const customerText = describeStatusChange(order.order_number, status, {
        number: String(shipping.tracking_number || ''),
        carrier: String(shipping.carrier || ''),
      })

      if (notifyCustomer) {
        // The result is reported back: WhatsApp refuses free-form messages outside the 24-hour
        // window, and the team needs to know when that happens.
        const result = await notifyOrderStatus({ organization: org, order, status, text: customerText, database: supabase })
        notified = result.notified
        notifyError = result.error
        // Updating WhatsApp's order card to "canceled" withdraws the payment request as well
        paymentRequestCanceled = status === 'canceled' && result.viaCard
      }

      // Canceling without a message must still withdraw "Review and pay", or the customer
      // could pay for an order the store has already canceled.
      if (status === 'canceled' && !paymentRequestCanceled) {
        paymentRequestCanceled = await voidPaymentRequest({ organization: org, order, database: supabase })
      }
    }

    return NextResponse.json({ order: updatedOrder, notified, notifyError, paymentRequestCanceled })
  } catch (err: any) {
    console.error('[API Commerce Orders PATCH] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST: Actions on an order. `remind` sends the customer the step their order is waiting on again.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const { orderId, organizationId, action } = body || {}

    if (!orderId || !organizationId) {
      return NextResponse.json({ error: 'Missing orderId or organizationId' }, { status: 400 })
    }
    if (!isUuid(orderId)) {
      return NextResponse.json({ error: 'Invalid orderId' }, { status: 400 })
    }
    if (action !== 'remind') {
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, organizationId, { permission: 'records.write' })
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabase()
    const [{ data: order }, { data: org }] = await Promise.all([
      supabase.from('commerce_orders').select(ORDER_COLUMNS).eq('id', orderId).eq('organization_id', organizationId).maybeSingle(),
      supabase.from('organizations').select(WHATSAPP_COLUMNS).eq('id', organizationId).maybeSingle(),
    ])
    if (!order || !org) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const result = await resendCheckoutStep({ organization: org, order, database: supabase })
    if (result.step === 'not_sent') {
      return NextResponse.json({ error: result.error || 'The reminder could not be sent.' }, { status: 422 })
    }

    const { data: refreshed } = await supabase.from('commerce_orders').select(ORDER_COLUMNS).eq('id', orderId).maybeSingle()
    return NextResponse.json({ success: true, step: result.step, order: refreshed || order })
  } catch (err: any) {
    console.error('[API Commerce Orders POST] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
