import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { SHOP_PURPOSES, readShopMessages } from '@/lib/commerce/shop-messages'
import { withSalesSchema } from '@/lib/commerce/shop-sales-store'

export const runtime = 'nodejs'

// GET ?organizationId=: which shop WhatsApp messages are on, and their templates
export async function GET(request: NextRequest) {
  const organizationId = new URL(request.url).searchParams.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId, { permission: 'automation.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const { data } = await withSalesSchema(() => getSupabaseAdminClient().from('organizations').select('id, shop_messages').eq('id', organizationId).maybeSingle())
  return NextResponse.json({ messages: readShopMessages(data?.shop_messages) })
}

// PUT { organizationId, messages: { <purpose>: { on, template, language } } }
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'automation.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const messages = readShopMessages(body?.messages)
  const clean = Object.fromEntries(SHOP_PURPOSES.map((p) => [p, messages[p]]))
  const { error } = await withSalesSchema(() => getSupabaseAdminClient().from('organizations').update({ shop_messages: clean }).eq('id', body.organizationId))
  if (error) return NextResponse.json({ error: error.message || 'Could not save.' }, { status: 500 })
  return NextResponse.json({ success: true, messages })
}
