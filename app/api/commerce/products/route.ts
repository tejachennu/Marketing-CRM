import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOrgAccess } from '@/lib/api-auth-helper'
import { sanitizeSearchTerm } from '@/lib/utils'
import { syncMetaCatalogToDatabase } from '@/lib/commerce/meta-commerce'
import { parseProductInput, type ProductInput } from '@/lib/commerce/commerce-utils'
import { isUuid } from '@/lib/record-visibility'

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

// GET: List commerce products, one page at a time
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('organizationId')
    const search = sanitizeSearchTerm(searchParams.get('search'))
    const category = searchParams.get('category')
    const availability = searchParams.get('availability') || 'all'
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '24', 10) || 24))

    if (!orgId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, orgId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabase()
    let query = supabase
      .from('commerce_products')
      .select('*', { count: 'exact' })
      .eq('organization_id', orgId)

    if (category && category !== 'all') {
      query = query.eq('category', category)
    }
    if (availability === 'available') query = query.eq('is_available', true)
    if (availability === 'unavailable') query = query.eq('is_available', false)

    if (search) {
      query = query.or(`title.ilike.%${search}%,retailer_id.ilike.%${search}%,description.ilike.%${search}%`)
    }

    const { data: products, count, error } = await query
      .order('title', { ascending: true })
      .order('id', { ascending: true })
      .range((page - 1) * limit, page * limit - 1)
    if (error) throw error

    return NextResponse.json({
      products: products || [],
      pagination: { page, limit, total: count || 0, pages: Math.max(1, Math.ceil((count || 0) / limit)) },
    })
  } catch (err: any) {
    console.error('[API Commerce Products GET] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST: Create product OR Sync from Meta Catalog
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { organizationId, action, product } = body

    if (!organizationId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, organizationId, { permission: 'automation.manage' })
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabase()

    // Action 1: Sync from Meta Catalog
    if (action === 'sync_meta') {
      const { data: org } = await supabase
        .from('organizations')
        .select('meta_catalog_id, whatsapp_api_token, whatsapp_graph_api_version')
        .eq('id', organizationId)
        .single()

      if (!org?.meta_catalog_id || !org?.whatsapp_api_token) {
        return NextResponse.json(
          { error: 'Meta Catalog ID and WhatsApp API Token must be configured in Commerce Settings' },
          { status: 400 }
        )
      }

      const syncResult = await syncMetaCatalogToDatabase(
        organizationId,
        org.meta_catalog_id,
        org.whatsapp_api_token,
        org.whatsapp_graph_api_version || 'v25.0'
      )

      if (syncResult.error && syncResult.synced === 0) {
        return NextResponse.json({ error: `The catalog could not be saved: ${syncResult.error}` }, { status: 500 })
      }
      return NextResponse.json({ success: true, ...syncResult })
    }

    // Action 2: Create a product, or edit one (when its id is sent)
    let input: ProductInput
    try {
      input = parseProductInput(product)
    } catch (validationErr: any) {
      return NextResponse.json({ error: validationErr.message }, { status: 400 })
    }

    const productId = product?.id
    if (productId !== undefined && !isUuid(productId)) {
      return NextResponse.json({ error: 'Invalid product id' }, { status: 400 })
    }

    // Another product must not already use this SKU: carts identify products by it
    let skuQuery = supabase
      .from('commerce_products')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('retailer_id', input.retailer_id)
    if (productId) skuQuery = skuQuery.neq('id', productId)
    const { data: sameSku } = await skuQuery.limit(1)
    if (sameSku && sameSku.length > 0) {
      return NextResponse.json({ error: `Another product already uses the SKU "${input.retailer_id}". Edit that product, or choose a different SKU.` }, { status: 409 })
    }

    const values = { ...input, updated_at: new Date().toISOString() }
    const { data: saved, error } = productId
      ? await supabase.from('commerce_products').update(values).eq('id', productId).eq('organization_id', organizationId).select()
      : await supabase.from('commerce_products').insert({ organization_id: organizationId, ...values }).select()

    if (error) throw error
    if (!saved || saved.length === 0) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    return NextResponse.json({ product: saved[0] })
  } catch (err: any) {
    console.error('[API Commerce Products POST] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE: Remove product
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('organizationId')
    const productId = searchParams.get('id')

    if (!orgId || !productId) {
      return NextResponse.json({ error: 'Missing organizationId or id' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, orgId, { permission: 'automation.manage' })
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    if (!isUuid(productId)) {
      return NextResponse.json({ error: 'Invalid product id' }, { status: 400 })
    }

    const supabase = getSupabase()
    const { error } = await supabase
      .from('commerce_products')
      .delete()
      .eq('id', productId)
      .eq('organization_id', orgId)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[API Commerce Products DELETE] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
