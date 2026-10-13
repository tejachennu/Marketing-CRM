import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOrgAccess } from '@/lib/api-auth-helper'
import { sanitizeSearchTerm } from '@/lib/utils'
import { buildOrderStatusMessage } from '@/lib/commerce/commerce-messages'
import {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUSES,
  canTransitionOrder,
  type OrderStatus,
} from '@/lib/commerce/commerce-utils'
import { cleanWhatsAppRecipient } from '@/lib/whatsapp-bsuid'

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

// GET: List commerce orders
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('organizationId')
    const status = searchParams.get('status')
    const search = sanitizeSearchTerm(searchParams.get('search'))

    if (!orgId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, orgId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabase()
    let query = supabase
      .from('commerce_orders')
      .select('*, items:commerce_order_items(*), contact:contacts(id, first_name, last_name, phone_number)')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    if (search) {
      query = query.or(`order_number.ilike.%${search}%,customer_note.ilike.%${search}%`)
    }

    const { data: orders, error } = await query
    if (error) throw error

    return NextResponse.json({ orders: orders || [] })
  } catch (err: any) {
    console.error('[API Commerce Orders GET] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/** What to tell the customer about each status the team can set. */
function describeStatusChange(orderNumber: string, status: OrderStatus, trackingNumber?: string) {
  switch (status) {
    case 'paid':
      return { metaStatus: 'processing' as const, text: `✅ Payment received for Order #${orderNumber}. We are preparing it now.` }
    case 'cod_confirmed':
      return { metaStatus: 'processing' as const, text: `🎉 Order #${orderNumber} is confirmed for Cash on Delivery. We are preparing your shipment.` }
    case 'shipped':
      return { metaStatus: 'shipped' as const, text: `🚚 Great news! Order #${orderNumber} has shipped.${trackingNumber ? ` Tracking: ${trackingNumber}` : ''}` }
    case 'delivered':
      return { metaStatus: 'completed' as const, text: `✅ Order #${orderNumber} has been delivered. Thank you for shopping with us!` }
    case 'canceled':
      return { metaStatus: 'canceled' as const, text: `Order #${orderNumber} has been canceled. Reply here if you have any questions.` }
    default:
      return { metaStatus: 'processing' as const, text: `Order #${orderNumber} was updated: ${ORDER_STATUS_LABELS[status] || status}.` }
  }
}

async function postWhatsAppMessage(org: any, payload: unknown): Promise<string | null> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${org.whatsapp_graph_api_version || 'v25.0'}/${org.whatsapp_phone_number_id}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${org.whatsapp_api_token}`,
        },
        body: JSON.stringify(payload),
      }
    )
    if (res.ok) return null
    const detail = await res.json().catch(() => null)
    return detail?.error?.message || `WhatsApp returned HTTP ${res.status}`
  } catch (err: any) {
    return err?.message || 'Could not reach WhatsApp'
  }
}

// PATCH: Update order status or details
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { orderId, organizationId, status, paymentStatus, customerNote, notifyCustomer } = body
    const trackingNumber = typeof body.trackingNumber === 'string' ? body.trackingNumber.trim().slice(0, 80) : ''

    if (!orderId || !organizationId) {
      return NextResponse.json({ error: 'Missing orderId or organizationId' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, organizationId)
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
      if (status === 'paid') updates.payment_status = 'paid'
      if (status === 'cod_confirmed') updates.payment_method = 'cod'
      if (status === 'delivered' && order.payment_method === 'cod') updates.payment_status = 'paid' // cash is collected on delivery
    }
    if (paymentStatus) updates.payment_status = paymentStatus
    if (customerNote !== undefined) updates.customer_note = customerNote

    const { data: updatedOrder, error: updateErr } = await supabase
      .from('commerce_orders')
      .update(updates)
      .eq('id', orderId)
      .eq('organization_id', organizationId)
      .select('*, items:commerce_order_items(*), contact:contacts(id, first_name, last_name, phone_number)')
      .single()

    if (updateErr) throw updateErr

    // Optionally tell the customer. The result is reported back: WhatsApp refuses free-form
    // messages outside the 24-hour window, and the team needs to know when that happens.
    let notified = false
    let notifyError: string | null = null

    if (notifyCustomer && statusChanged) {
      const phone = order.contact?.phone_number
      const { data: org } = await supabase
        .from('organizations')
        .select('whatsapp_api_token, whatsapp_phone_number_id, whatsapp_graph_api_version')
        .eq('id', organizationId)
        .single()

      if (!phone) {
        notifyError = 'This order has no customer phone number.'
      } else if (!org?.whatsapp_api_token || !org?.whatsapp_phone_number_id) {
        notifyError = 'WhatsApp is not connected in Settings.'
      } else {
        const { metaStatus, text } = describeStatusChange(order.order_number, status, trackingNumber)

        // The native order-status card only exists for orders that had an in-chat payment
        // request, and Meta does not allow canceling a paid order through it.
        if (order.payment_method === 'whatsapp_pay' && status !== 'canceled') {
          notifyError = await postWhatsAppMessage(org, buildOrderStatusMessage({
            phone,
            referenceId: order.id,
            status: metaStatus,
            description: text,
          }))
          notified = !notifyError
        }

        if (!notified) {
          notifyError = await postWhatsAppMessage(org, {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: cleanWhatsAppRecipient(phone),
            type: 'text',
            text: { body: text },
          })
          notified = !notifyError
        }

        if (notified && order.conversation_id) {
          await supabase.from('messages').insert({
            organization_id: organizationId,
            conversation_id: order.conversation_id,
            sender_type: 'user',
            body: text,
            status: 'sent',
          })
        } else if (notifyError) {
          console.error('[Commerce Orders Notify] Send failed:', notifyError)
        }
      }
    }

    return NextResponse.json({ order: updatedOrder, notified, notifyError })
  } catch (err: any) {
    console.error('[API Commerce Orders PATCH] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
