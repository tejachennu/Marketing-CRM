import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { verifyConversationAccess } from '@/lib/record-visibility'
import type { ChatOrderCard, ChatProductCard } from '@/lib/chat-commerce'

const MAX_REFS = 50

// GET: the orders placed in a chat and the products sent in it, so the inbox can show them as cards
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const conversationId = searchParams.get('conversationId')
    const supabase = getSupabaseAdminClient()

    // The same check as reading the chat's messages
    const access = await verifyConversationAccess(request, supabase, conversationId)
    if (!access.authorized) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    const { data: conversation } = await supabase
      .from('conversations')
      .select('organization_id')
      .eq('id', conversationId)
      .maybeSingle()
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    const organizationId = conversation.organization_id

    const clean = (values: string[]) => [...new Set(values.map((value) => value.trim().slice(0, 200)).filter(Boolean))].slice(0, MAX_REFS)
    const skus = clean(searchParams.getAll('sku'))
    const titles = clean(searchParams.getAll('title'))

    const productColumns = 'retailer_id, title, price, currency, image_url'
    const [ordersResult, bySku, byTitle] = await Promise.all([
      supabase
        .from('commerce_orders')
        .select('id, order_number, status, payment_status, total_amount, currency, meta_order_id, created_at, items:commerce_order_items(title, quantity, unit_price, image_url)')
        .eq('organization_id', organizationId)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(MAX_REFS),
      skus.length
        ? supabase.from('commerce_products').select(productColumns).eq('organization_id', organizationId).in('retailer_id', skus)
        : Promise.resolve({ data: [] as any[] }),
      titles.length
        ? supabase.from('commerce_products').select(productColumns).eq('organization_id', organizationId).in('title', titles)
        : Promise.resolve({ data: [] as any[] }),
    ])

    const orders: ChatOrderCard[] = (ordersResult.data || []).map((order: any) => ({
      ...order,
      total_amount: Number(order.total_amount) || 0,
      items: (order.items || []).map((item: any) => ({ ...item, quantity: Number(item.quantity) || 1, unit_price: Number(item.unit_price) || 0 })),
    }))
    const products: ChatProductCard[] = [...(bySku.data || []), ...(byTitle.data || [])].map((product: any) => ({
      ...product,
      price: Number(product.price) || 0,
    }))

    return NextResponse.json({ orders, products })
  } catch (error) {
    console.error('[API Commerce Chat Cards] Error:', error)
    return NextResponse.json({ error: 'Could not load the products and orders for this chat' }, { status: 500 })
  }
}
