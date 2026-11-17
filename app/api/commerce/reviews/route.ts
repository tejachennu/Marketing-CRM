import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { isUuid } from '@/lib/record-visibility'

export const runtime = 'nodejs'

// GET ?organizationId=: the newest reviews of the shop's products (no table yet = none)
export async function GET(request: NextRequest) {
  const organizationId = new URL(request.url).searchParams.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const { data, error } = await getSupabaseAdminClient().from('commerce_reviews').select('*, product:commerce_products(title, image_url), order:commerce_orders(order_number)').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(200)
  return NextResponse.json({ reviews: error ? [] : data || [] })
}

// PATCH { organizationId, id, published }: show or hide a review on the store page
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'automation.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  if (!isUuid(body?.id)) return NextResponse.json({ error: 'Invalid review.' }, { status: 400 })
  await getSupabaseAdminClient().from('commerce_reviews').update({ published: body.published === true }).eq('id', body.id).eq('organization_id', body.organizationId)
  return NextResponse.json({ success: true })
}
