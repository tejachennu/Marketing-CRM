import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOrgAccess } from '@/lib/api-auth-helper'
import { sanitizeSearchTerm } from '@/lib/utils'
import { parseProductInput, type ProductInput } from '@/lib/commerce/commerce-utils'
import { getCatalogState, getProductAttributes, isInCatalog, parseProductAttributes, type ProductAttributes } from '@/lib/commerce/catalog-items'
import { describeCatalogError, isGraphId } from '@/lib/commerce/meta-catalog'
import { pullCatalogToDatabase, pushProductsToCatalog, refreshCatalogStatus, removeFromCatalog } from '@/lib/commerce/catalog-sync'
import { isUuid } from '@/lib/record-visibility'

/** What a catalog call needs from the organization. */
const CATALOG_ORG_COLUMNS = 'id, name, meta_catalog_id, whatsapp_api_token, whatsapp_graph_api_version, whatsapp_default_phone, whatsapp_business_account_id, whatsapp_phone_number_id'
/** The most products one "send to catalog" request handles. */
const MAX_PUSH = 3000

const NOT_LINKED = 'Link your Meta catalog in Store settings and connect WhatsApp first.'

/** A catalog is linked and there is a WhatsApp connection to reach it with. */
function hasCatalog(org: Record<string, any> | null | undefined): org is Record<string, any> {
  return Boolean(org && isGraphId(String(org.meta_catalog_id || '').trim()) && org.whatsapp_api_token)
}

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

    // Where the product stands in the Meta catalog (see getCatalogState)
    const catalog = searchParams.get('catalog')
    if (catalog === 'attention') {
      query = query.or('metadata->catalog->>state.eq.error,metadata->catalog->>review_status.eq.rejected')
    } else if (catalog === 'not_sent') {
      query = query.is('metadata->catalog->>state', null).or('metadata->>source.is.null,metadata->>source.neq.meta')
    }

    if (search) {
      query = query.or(`title.ilike.%${search}%,retailer_id.ilike.%${search}%,description.ilike.%${search}%`)
    }

    const { data: products, count, error } = await query
      .order('title', { ascending: true })
      .order('id', { ascending: true })
      .range((page - 1) * limit, page * limit - 1)
    if (error) throw error

    // How many products are outside the catalog or need a look, for the whole store rather than this page
    let catalogCounts: { sending: number; attention: number; notSent: number } | undefined
    if (searchParams.get('counts') === '1') {
      const countWhere = async (apply: (q: any) => any): Promise<number> => {
        const { count: matching } = await apply(supabase.from('commerce_products').select('id', { count: 'exact', head: true }).eq('organization_id', orgId))
        return matching || 0
      }
      const [all, sending, errors, rejected, inCatalog] = await Promise.all([
        countWhere((q) => q),
        countWhere((q) => q.eq('metadata->catalog->>state', 'pending')),
        countWhere((q) => q.eq('metadata->catalog->>state', 'error')),
        countWhere((q) => q.eq('metadata->catalog->>review_status', 'rejected')),
        countWhere((q) => q.or('metadata->catalog->>state.eq.synced,and(metadata->catalog->>state.is.null,metadata->>source.eq.meta)')),
      ])
      catalogCounts = { sending, attention: errors + rejected, notSent: Math.max(0, all - sending - errors - inCatalog) }
    }

    return NextResponse.json({
      products: products || [],
      pagination: { page, limit, total: count || 0, pages: Math.max(1, Math.ceil((count || 0) / limit)) },
      ...(catalogCounts ? { catalog: catalogCounts } : {}),
    })
  } catch (err: any) {
    console.error('[API Commerce Products GET] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST: Create or edit a product, or exchange products with the Meta catalog
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

    const loadOrg = async () => {
      const { data } = await supabase.from('organizations').select(CATALOG_ORG_COLUMNS).eq('id', organizationId).single()
      return data as Record<string, any> | null
    }

    // Action 1: Bring the dashboard up to date with the Meta catalog
    if (action === 'sync_meta') {
      const org = await loadOrg()
      if (!hasCatalog(org)) return NextResponse.json({ error: NOT_LINKED }, { status: 400 })

      try {
        // First settle the changes Meta was still processing, so the copy does not overwrite them
        const refreshed = await refreshCatalogStatus(supabase, org).catch(() => null)
        const pulled = await pullCatalogToDatabase(supabase, org)
        if (pulled.error && pulled.synced === 0) {
          return NextResponse.json({ error: `The catalog could not be saved: ${pulled.error}` }, { status: 500 })
        }
        return NextResponse.json({ success: true, ...pulled, refreshed })
      } catch (catalogErr) {
        return NextResponse.json({ error: describeCatalogError(catalogErr).message }, { status: 502 })
      }
    }

    // Action 2: Ask Meta how the changes it was still processing went
    if (action === 'refresh_catalog') {
      const org = await loadOrg()
      if (!hasCatalog(org)) return NextResponse.json({ error: NOT_LINKED }, { status: 400 })
      try {
        return NextResponse.json({ success: true, ...(await refreshCatalogStatus(supabase, org)) })
      } catch (catalogErr) {
        return NextResponse.json({ error: describeCatalogError(catalogErr).message }, { status: 502 })
      }
    }

    // Action 3: Send products to the Meta catalog: the ones named, or every one that is not in it yet
    if (action === 'push_meta') {
      const org = await loadOrg()
      if (!hasCatalog(org)) return NextResponse.json({ error: NOT_LINKED }, { status: 400 })

      let toSend: any[] = []
      if (Array.isArray(body.productIds)) {
        const ids = body.productIds.filter(isUuid).slice(0, 500)
        if (ids.length === 0) return NextResponse.json({ error: 'Choose the products to send.' }, { status: 400 })
        const { data, error } = await supabase.from('commerce_products').select('*').eq('organization_id', organizationId).in('id', ids)
        if (error) throw error
        toSend = data || []
      } else {
        for (let from = 0; from < 50000 && toSend.length < MAX_PUSH; from += 1000) {
          const { data, error } = await supabase
            .from('commerce_products')
            .select('*')
            .eq('organization_id', organizationId)
            .order('id', { ascending: true })
            .range(from, from + 999)
          if (error) throw error
          toSend.push(...(data || []).filter((row) => ['not_sent', 'error'].includes(getCatalogState(row))))
          if (!data || data.length < 1000) break
        }
        toSend = toSend.slice(0, MAX_PUSH)
      }
      if (toSend.length === 0) return NextResponse.json({ success: true, sent: 0, rejected: 0, problems: [] })

      try {
        const summary = await pushProductsToCatalog(supabase, org, toSend)
        const problems = toSend
          .map((row) => ({ title: row.title as string, errors: summary.outcomes.get(row.id)?.state === 'error' ? summary.outcomes.get(row.id)!.errors : [] }))
          .filter((problem) => problem.errors.length > 0)
          .slice(0, 5)
        return NextResponse.json({ success: true, sent: summary.sent, rejected: summary.rejected, requestError: summary.requestError, problems })
      } catch (catalogErr) {
        return NextResponse.json({ error: describeCatalogError(catalogErr).message }, { status: 502 })
      }
    }

    // Action 4: Create a product, or edit one (when its id is sent)
    let input: ProductInput
    let attributes: ProductAttributes
    try {
      input = parseProductInput(product)
      attributes = parseProductAttributes(product)
    } catch (validationErr: any) {
      return NextResponse.json({ error: validationErr.message }, { status: 400 })
    }

    const productId = product?.id
    if (productId !== undefined && !isUuid(productId)) {
      return NextResponse.json({ error: 'Invalid product id' }, { status: 400 })
    }

    let existing: Record<string, any> | null = null
    if (productId) {
      const { data } = await supabase.from('commerce_products').select('*').eq('id', productId).eq('organization_id', organizationId).maybeSingle()
      if (!data) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
      existing = data
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

    // The catalog's full price is kept while the product stays below it; a price at or above it ends the sale
    const listPrice = Number(getProductAttributes(existing).list_price) || 0
    const stillOnSale = listPrice > input.price
    // The catalog knows an item by its SKU, so a product given a new SKU starts again as a new item
    const skuChanged = Boolean(existing && existing.retailer_id !== input.retailer_id)
    const { source: _source, catalog: _catalog, ...keptMetadata } = (existing?.metadata || {}) as Record<string, any>
    const metadata = {
      ...(skuChanged ? keptMetadata : existing?.metadata || {}),
      attributes: { ...attributes, ...(stillOnSale ? { list_price: listPrice } : {}) },
    }

    const values = { ...input, metadata, updated_at: new Date().toISOString() }
    const { data: saved, error } = productId
      ? await supabase.from('commerce_products').update(values).eq('id', productId).eq('organization_id', organizationId).select()
      : await supabase.from('commerce_products').insert({ organization_id: organizationId, ...values }).select()

    if (error) throw error
    if (!saved || saved.length === 0) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }
    const savedProduct = saved[0]

    // Send the product to the Meta catalog, so it can be shared and ordered in WhatsApp
    const org = await loadOrg()
    const catalog: { linked: boolean; state: 'pending' | 'error' | null; errors: string[]; warnings: string[] } = { linked: hasCatalog(org), state: null, errors: [], warnings: [] }
    if (hasCatalog(org)) {
      try {
        if (skuChanged && existing && isInCatalog(existing)) await removeFromCatalog(org, [existing.retailer_id])
        const summary = await pushProductsToCatalog(supabase, org, [savedProduct], {
          endSaleIds: listPrice > 0 && !stillOnSale ? new Set([savedProduct.id]) : undefined,
        })
        const outcome = summary.outcomes.get(savedProduct.id)
        if (outcome) Object.assign(catalog, { state: outcome.state, errors: outcome.errors, warnings: outcome.warnings })
      } catch (catalogErr) {
        Object.assign(catalog, { state: 'error', errors: [describeCatalogError(catalogErr).message] })
      }
    }

    return NextResponse.json({ product: savedProduct, catalog })
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
    const { data: product } = await supabase
      .from('commerce_products')
      .select('id, retailer_id, metadata')
      .eq('id', productId)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (!product) return NextResponse.json({ success: true, catalogRemoved: false })

    // An item that is in the Meta catalog is taken out of it too, or customers could still order it
    let catalog: { removed: boolean; error?: string } = { removed: false }
    if (isInCatalog(product)) {
      const { data: org } = await supabase.from('organizations').select(CATALOG_ORG_COLUMNS).eq('id', orgId).single()
      if (hasCatalog(org)) catalog = await removeFromCatalog(org, [product.retailer_id])
    }

    const { error } = await supabase
      .from('commerce_products')
      .delete()
      .eq('id', productId)
      .eq('organization_id', orgId)

    if (error) throw error

    return NextResponse.json({ success: true, inCatalog: isInCatalog(product), catalogRemoved: catalog.removed, catalogError: catalog.error })
  } catch (err: any) {
    console.error('[API Commerce Products DELETE] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
