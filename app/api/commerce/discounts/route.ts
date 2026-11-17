import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { isUuid } from '@/lib/record-visibility'
import { listDiscounts, rowToDiscount, withDiscountSchema } from '@/lib/commerce/discount-store'
import { parseDiscount } from '@/lib/commerce/discounts'

export const runtime = 'nodejs'

// GET ?organizationId=: every offer and code, with how often each was used
export async function GET(request: NextRequest) {
  const organizationId = new URL(request.url).searchParams.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  return NextResponse.json({ discounts: await listDiscounts(getSupabaseAdminClient(), organizationId!) })
}

// POST { organizationId, discount }: add an offer, or change one (with its id)
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'automation.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const parsed = parseDiscount(body?.discount)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { id, uses: _uses, ...values } = parsed.discount as any
  const db = getSupabaseAdminClient()
  const row = { ...values, organization_id: body.organizationId, updated_at: new Date().toISOString() }
  const result = id && isUuid(id)
    ? await withDiscountSchema(() => db.from('commerce_discounts').update(row).eq('id', id).eq('organization_id', body.organizationId).select('*').maybeSingle())
    : await withDiscountSchema(() => db.from('commerce_discounts').insert(row).select('*').single())
  if (result.error) {
    if (String(result.error.code) === '23505') return NextResponse.json({ error: `The code ${values.code} is already used by another offer.` }, { status: 409 })
    return NextResponse.json({ error: result.error.message || 'Could not save the offer.' }, { status: 500 })
  }
  if (!result.data) return NextResponse.json({ error: 'Offer not found.' }, { status: 404 })
  return NextResponse.json({ success: true, discount: rowToDiscount(result.data) })
}

// DELETE ?organizationId=&id=: remove an offer (orders that used it keep their discount)
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const organizationId = searchParams.get('organizationId')
  const id = searchParams.get('id')
  const access = await verifyOrgAccess(request, organizationId, { permission: 'automation.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid offer.' }, { status: 400 })
  await getSupabaseAdminClient().from('commerce_discounts').delete().eq('id', id).eq('organization_id', organizationId)
  return NextResponse.json({ success: true })
}
