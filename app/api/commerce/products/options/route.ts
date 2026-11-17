import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { isUuid } from '@/lib/record-visibility'
import { readOptions, saveProductOptions, variantsFor, withVariantSchema } from '@/lib/commerce/variant-store'

export const runtime = 'nodejs'

// GET ?organizationId=&productId=: the product's options and the price / stock of each combination
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const organizationId = searchParams.get('organizationId')
  const productId = searchParams.get('productId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  if (!isUuid(productId)) return NextResponse.json({ error: 'Invalid product.' }, { status: 400 })
  const db = getSupabaseAdminClient()
  const { data: product, error } = await withVariantSchema(() => db.from('commerce_products').select('id, price, options').eq('organization_id', organizationId).eq('id', productId).maybeSingle())
  if (error || !product) return NextResponse.json({ error: error?.message || 'Product not found.' }, { status: 404 })
  const variants = (await variantsFor(db, organizationId!, [productId!])).get(productId!) || []
  return NextResponse.json({ options: readOptions(product.options), variants, productPrice: Number(product.price) || 0 })
}

// PUT { organizationId, productId, options: [{name, values}], variants: [{options, price, stock, sku, image_url, active}] }
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'automation.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  if (!isUuid(body?.productId)) return NextResponse.json({ error: 'Invalid product.' }, { status: 400 })
  const edits = Array.isArray(body?.variants) ? body.variants.slice(0, 200) : []
  const result = await saveProductOptions(getSupabaseAdminClient(), body.organizationId, body.productId, body?.options, edits)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ success: true, ...result })
}
