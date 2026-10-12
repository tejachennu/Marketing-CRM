import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOrgAccess } from '@/lib/api-auth-helper'
import { sanitizeSearchTerm } from '@/lib/utils'
import { buildOrderStatusMessage } from '@/lib/commerce/commerce-messages'

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

const ORDER_STATUSES = new Set([
  'cart_submitted', 'awaiting_address', 'payment_pending', 'paid',
  'cod_confirmed', 'shipped', 'delivered', 'canceled',
])
const PAYMENT_STATUSES = new Set(['pending', 'paid', 'failed', 'refunded'])

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

// PATCH: Update order status or details
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { orderId, organizationId, status, paymentStatus, customerNote, trackingNumber, notifyCustomer } = body

    if (!orderId || !organizationId) {
      return NextResponse.json({ error: 'Missing orderId or organizationId' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, organizationId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    if (status && !ORDER_STATUSES.has(status)) {
      return NextResponse.json({ error: `Unsupported order status: ${status}` }, { status: 400 })
    }
    if (paymentStatus && !PAYMENT_STATUSES.has(paymentStatus)) {
      return NextResponse.json({ error: `Unsupported payment status: ${paymentStatus}` }, { status: 400 })
    }

    const supabase = getSupabase()

    // Fetch existing order & org credentials
    const { data: order, error: fetchErr } = await supabase
      .from('commerce_orders')
      .select('*, contact:contacts(phone_number, first_name)')
      .eq('id', orderId)
      .eq('organization_id', organizationId)
      .single()

    if (fetchErr || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const updates: Record<string, any> = { updated_at: new Date().toISOString() }
    if (status) updates.status = status
    if (paymentStatus) updates.payment_status = paymentStatus
    if (customerNote !== undefined) updates.customer_note = customerNote

    const { data: updatedOrder, error: updateErr } = await supabase
      .from('commerce_orders')
      .update(updates)
      .eq('id', orderId)
      .eq('organization_id', organizationId)
      .select()
      .single()

    if (updateErr) throw updateErr

    // Optionally notify customer via WhatsApp if status changed
    if (notifyCustomer && status && order.contact?.phone_number) {
      const { data: org } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', organizationId)
        .single()

      if (org?.whatsapp_api_token && org?.whatsapp_phone_number_id) {
        let metaStatus: 'processing' | 'completed' | 'canceled' = 'processing'
        let description = `Order #${order.order_number} status updated to ${status}.`

        if (status === 'shipped') {
          description = `🚚 Great news! Order #${order.order_number} has shipped.${trackingNumber ? ` Tracking: ${trackingNumber}` : ''}`
        } else if (status === 'delivered') {
          metaStatus = 'completed'
          description = `✅ Order #${order.order_number} has been delivered. Thank you for shopping with us!`
        } else if (status === 'canceled') {
          metaStatus = 'canceled'
          description = `Order #${order.order_number} has been canceled.`
        }

        const statusMsg = buildOrderStatusMessage({
          phone: order.contact.phone_number,
          referenceId: order.id,
          status: metaStatus,
          description,
        })

        await fetch(
          `https://graph.facebook.com/${org.whatsapp_graph_api_version || 'v25.0'}/${org.whatsapp_phone_number_id}/messages`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${org.whatsapp_api_token}`,
            },
            body: JSON.stringify(statusMsg),
          }
        ).catch((err) => console.error('[Commerce Orders Notify] Send error:', err))
      }
    }

    return NextResponse.json({ order: updatedOrder })
  } catch (err: any) {
    console.error('[API Commerce Orders PATCH] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
