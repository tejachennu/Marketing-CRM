import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOrgAccess } from '@/lib/api-auth-helper'
import { sanitizeSearchTerm } from '@/lib/utils'
import { isUuid } from '@/lib/record-visibility'
import { getCommerceSummary, invalidateCommerceSummary } from '@/lib/commerce/commerce-stats'
import { adjustOrderStock, notifyOrderStatus, resendCheckoutStep, voidPaymentRequest } from '@/lib/commerce/commerce-webhook-handler'
import {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  ORDER_VIEWS,
  PAYMENT_STATUSES,
  canTransitionOrder,
  formatMoney,
  hasPaymentRequest,
  isCashCollection,
  parseTrackingUrl,
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
// The whole row: the handlers read the WhatsApp connection, the catalog connection and the
// order-update template, and a column a migration has not added yet must not fail the request.
// The organization never leaves the server.
const ORGANIZATION_COLUMNS = '*'

// GET: List commerce orders, one page at a time, with totals for the whole store
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('organizationId')
    const view = (searchParams.get('view') || 'all') as OrderView
    const search = sanitizeSearchTerm(searchParams.get('search'))
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10) || 25))
    // The totals cost several queries: they come with the first page (and the refresh after a
    // change, which asks for them), not with every page turn
    const withSummary = page === 1 || searchParams.get('withSummary') === '1'

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
      withSummary ? getCommerceSummary(supabase, orgId) : Promise.resolve(null),
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
function describeStatusChange(
  order: { order_number: string; total_amount: number; currency: string },
  status: OrderStatus,
  tracking: { number: string; carrier: string; url: string },
  cashCollected: boolean
): string {
  const orderNumber = order.order_number
  const via = tracking.carrier ? ` with ${tracking.carrier}` : ''
  const number = tracking.number ? ` Tracking number: ${tracking.number}.` : ''
  const link = tracking.url ? ` Track it here: ${tracking.url}` : ''
  switch (status) {
    case 'paid':
      return cashCollected
        ? `Payment of ${formatMoney(order.total_amount, order.currency)} received in cash for order #${orderNumber}. Thank you!`
        : `Payment received for order #${orderNumber}. We are preparing it now.`
    case 'cod_confirmed':
      return `Order #${orderNumber} is confirmed for Cash on Delivery. We are preparing your shipment.`
    case 'shipped':
      return `Good news! Order #${orderNumber} has shipped${via}.${number}${link}`
    case 'delivered':
      return `Order #${orderNumber} has been delivered${via}.${number}${link} Thank you for shopping with us!`
    case 'canceled':
      return `Order #${orderNumber} has been canceled. Reply here if you have any questions.`
    default:
      return `Order #${orderNumber} was updated: ${ORDER_STATUS_LABELS[status] || status}.`
  }
}

/** "paid", "paid (cash collected)", "confirmed for Cash on Delivery", ...: the status as the line noted in the chat reads it. */
function describeAuditStatus(status: OrderStatus, cashCollected: boolean): string {
  if (status === 'cod_confirmed') return 'confirmed for Cash on Delivery'
  if (status === 'paid' && cashCollected) return 'paid (cash collected)'
  return (ORDER_STATUS_LABELS[status] || status).toLowerCase()
}

// PATCH: Update order status or details
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const { orderId, organizationId, status, paymentStatus, customerNote, notifyCustomer } = body || {}
    const text = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : undefined)
    const trackingNumber = text(body?.trackingNumber, 80)
    const carrier = text(body?.carrier, 60)
    let trackingUrl: string | undefined
    if (typeof body?.trackingUrl === 'string') {
      try {
        trackingUrl = parseTrackingUrl(body.trackingUrl)
      } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 400 })
      }
    }

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

    if (status && status !== order.status && !canTransitionOrder(order.status, status)) {
      return NextResponse.json(
        {
          error: `An order that is "${ORDER_STATUS_LABELS[order.status as OrderStatus] || order.status}" cannot be changed to "${ORDER_STATUS_LABELS[status as OrderStatus]}".`,
        },
        { status: 409 }
      )
    }

    // "Paid" on a Cash on Delivery order records the cash collected. A shipped order keeps its
    // status (the money is noted on it), so it does not land back in "To ship".
    const cashCollected = status === 'paid' && isCashCollection(order)
    const paymentRecorded = status === 'paid' && order.payment_status !== 'paid'
    const keepsStatus = status === 'paid' && order.status === 'shipped'
    const statusChanged = Boolean(status) && status !== order.status && !keepsStatus

    const updates: Record<string, any> = { updated_at: new Date().toISOString() }
    if (statusChanged) {
      updates.status = status
      if (status === 'cod_confirmed') updates.payment_method = 'cod'
      if (status === 'delivered' && order.payment_method === 'cod') updates.payment_status = 'paid' // cash is collected on delivery
    }
    // Keep the payment fields consistent with the status instead of trusting the client to send both
    if (paymentRecorded) {
      updates.payment_status = 'paid'
      // Cash collected keeps "Cash on Delivery"; otherwise the money came in outside the chat
      // (bank transfer, a payment link) and the order says so
      if (!cashCollected && (!order.payment_method || order.payment_method === 'cod')) updates.payment_method = 'manual'
    }
    // A payment status set by hand, beyond what the new status already implies
    const paymentStatusChanged = Boolean(paymentStatus) && paymentStatus !== order.payment_status && paymentStatus !== updates.payment_status
    if (paymentStatus) updates.payment_status = paymentStatus
    if (customerNote !== undefined) updates.customer_note = String(customerNote ?? '').slice(0, 1000)

    // Tracking details are kept with the delivery address
    const shipping = { ...(order.shipping_address || {}) }
    let shippingChanged = false
    if (trackingNumber !== undefined) { shipping.tracking_number = trackingNumber; shippingChanged = true }
    if (carrier !== undefined) { shipping.carrier = carrier; shippingChanged = true }
    if (trackingUrl !== undefined) { shipping.tracking_url = trackingUrl; shippingChanged = true }
    if (statusChanged && status === 'shipped') { shipping.shipped_at = new Date().toISOString(); shippingChanged = true }
    if (statusChanged && status === 'delivered') { shipping.delivered_at = new Date().toISOString(); shippingChanged = true }
    if (shippingChanged) updates.shipping_address = shipping

    // The handlers need the store's WhatsApp connection (and, for stock, its catalog connection)
    const settles = statusChanged || paymentRecorded
    const { data: org } = settles
      ? await supabase.from('organizations').select(ORGANIZATION_COLUMNS).eq('id', organizationId).single()
      : { data: null }

    // A "Review and pay" card still open in the chat must not outlive the decision: once the
    // order is confirmed for cash or marked paid by hand, paying it from the chat would charge
    // the customer twice (or have the team ask for cash after an online payment)
    let paymentRequestCanceled = false
    if (statusChanged && (status === 'paid' || status === 'cod_confirmed') && hasPaymentRequest(order) && order.payment_status !== 'paid') {
      paymentRequestCanceled = await voidPaymentRequest({
        organization: org,
        order,
        database: supabase,
        description: status === 'cod_confirmed'
          ? `Online payment withdrawn: your order #${order.order_number} is confirmed for Cash on Delivery.`
          : `Online payment withdrawn: order #${order.order_number} is already paid.`,
      })
    }

    // The status condition stops two people (or two clicks) from applying the same change twice
    let updateQuery = supabase.from('commerce_orders').update(updates).eq('id', orderId).eq('organization_id', organizationId)
    if (statusChanged) updateQuery = updateQuery.eq('status', order.status)
    const { data: updatedRows, error: updateErr } = await updateQuery.select(ORDER_COLUMNS)

    if (updateErr) throw updateErr
    const updatedOrder = updatedRows?.[0]
    if (!updatedOrder) {
      return NextResponse.json({ error: 'This order was just changed by someone else. Refresh to see its current status.' }, { status: 409 })
    }
    invalidateCommerceSummary(organizationId)

    // Who changed what is noted in the order's chat, next to the messages the customer got
    const who = String(authResult.user?.full_name || authResult.user?.email || '').trim() || 'a team member'
    const auditLines: string[] = []
    if (statusChanged || (keepsStatus && paymentRecorded)) auditLines.push(`[Order #${order.order_number} marked ${describeAuditStatus(status, cashCollected)} by ${who}]`)
    if (paymentStatusChanged) auditLines.push(`[Order #${order.order_number} payment marked ${paymentStatus} by ${who}]`)
    if (auditLines.length > 0 && order.conversation_id) {
      const { error: auditErr } = await supabase.from('messages').insert(
        auditLines.map((body) => ({ organization_id: organizationId, conversation_id: order.conversation_id, sender_type: 'user', body, status: 'sent' }))
      )
      if (auditErr) console.error('[API Commerce Orders PATCH] The change could not be noted in the chat:', auditErr)
    }

    // Stock leaves when the order is settled and comes back when it is canceled; both are
    // recorded on the order, so a second click changes nothing
    if (statusChanged && (status === 'paid' || status === 'cod_confirmed')) {
      await adjustOrderStock({ organization: org, order: updatedOrder, action: 'take', database: supabase })
    } else if (statusChanged && status === 'canceled') {
      await adjustOrderStock({ organization: org, order: updatedOrder, action: 'restore', database: supabase })
    }

    let notified = false
    let notifyError: string | null = null

    if (settles) {
      const customerText = describeStatusChange(order, status, {
        number: String(shipping.tracking_number || ''),
        carrier: String(shipping.carrier || ''),
        url: String(shipping.tracking_url || ''),
      }, cashCollected)

      if (notifyCustomer) {
        // The result is reported back: WhatsApp refuses free-form messages outside the 24-hour
        // window, and the team needs to know when that happens. The updated order carries the
        // tracking details and the customer's number. The order card is left alone once it was
        // withdrawn, and when the money is noted on an order that has already shipped.
        const result = await notifyOrderStatus({
          organization: org,
          order: updatedOrder,
          status,
          text: customerText,
          card: !paymentRequestCanceled && !cashCollected,
          database: supabase,
        })
        notified = result.notified
        notifyError = result.error
        // Updating WhatsApp's order card to "canceled" withdraws the payment request as well
        if (status === 'canceled' && result.viaCard) paymentRequestCanceled = true
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
      supabase.from('organizations').select(ORGANIZATION_COLUMNS).eq('id', organizationId).maybeSingle(),
    ])
    if (!order || !org) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const result = await resendCheckoutStep({ organization: org, order, database: supabase })
    if (result.step === 'not_sent') {
      return NextResponse.json({ error: result.error || 'The reminder could not be sent.' }, { status: 422 })
    }
    // The reminder may have moved the order on (say, from "awaiting address" to "payment pending")
    invalidateCommerceSummary(organizationId)

    const { data: refreshed } = await supabase.from('commerce_orders').select(ORDER_COLUMNS).eq('id', orderId).maybeSingle()
    return NextResponse.json({ success: true, step: result.step, order: refreshed || order })
  } catch (err: any) {
    console.error('[API Commerce Orders POST] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
