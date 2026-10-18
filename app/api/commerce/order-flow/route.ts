import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { isUuid } from '@/lib/record-visibility'

const RECENT_ORDERS = 8

export interface OrderTrailEntry {
  body: string
  status: string | null
  error_message: string | null
  sender_type: string
  created_at: string
}

// GET: the store's latest orders, each with the checkout messages its chat shows, so the Order
// flow tab can show how far each customer got and where a checkout stopped
export async function GET(request: NextRequest) {
  try {
    const orgId = new URL(request.url).searchParams.get('organizationId')
    if (!orgId || !isUuid(orgId)) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }
    const access = await verifyOrgAccess(request, orgId, { permission: 'automation.manage' })
    if (!access.authorized) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    const supabase = getSupabaseAdminClient()
    const { data: orders, error } = await supabase
      .from('commerce_orders')
      .select('id, order_number, status, payment_status, payment_method, total_amount, currency, conversation_id, meta_order_id, shipping_address, created_at, contact:contacts(first_name, last_name, phone_number)')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(RECENT_ORDERS)
    if (error) throw error

    const withTrail = await Promise.all((orders || []).map(async (order: any) => {
      if (!order.conversation_id) return { ...order, trail: [] }
      // Every checkout line names its order ("Order #ORD-…"); the cart itself is matched by its WhatsApp id
      const filters = [`body.ilike.%#${order.order_number}%`]
      if (order.meta_order_id) filters.push(`twilio_message_sid.eq.FB_${order.meta_order_id}`)
      const { data: trail } = await supabase
        .from('messages')
        .select('body, status, error_message, sender_type, created_at')
        .eq('conversation_id', order.conversation_id)
        .or(filters.join(','))
        .order('created_at', { ascending: true })
        .limit(20)
      return { ...order, total_amount: Number(order.total_amount) || 0, trail: (trail || []) as OrderTrailEntry[] }
    }))

    return NextResponse.json({ orders: withTrail })
  } catch (err) {
    console.error('[API Commerce Order Flow] Error:', err)
    return NextResponse.json({ error: 'Recent orders could not be loaded' }, { status: 500 })
  }
}
