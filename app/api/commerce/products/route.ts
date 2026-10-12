import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOrgAccess } from '@/lib/api-auth-helper'
import { sanitizeSearchTerm } from '@/lib/utils'
import { syncMetaCatalogToDatabase } from '@/lib/commerce/meta-commerce'

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

// GET: List commerce products
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('organizationId')
    const search = sanitizeSearchTerm(searchParams.get('search'))
    const category = searchParams.get('category')

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
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })

    if (category && category !== 'all') {
      query = query.eq('category', category)
    }

    if (search) {
      query = query.or(`title.ilike.%${search}%,retailer_id.ilike.%${search}%,description.ilike.%${search}%`)
    }

    const { data: products, error } = await query
    if (error) throw error

    return NextResponse.json({ products: products || [] })
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

    const authResult = await verifyOrgAccess(request, organizationId)
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

      return NextResponse.json({ success: true, ...syncResult })
    }

    // Action 2: Create / Add product manually
    if (!product || !product.title || !product.retailer_id || product.price === undefined) {
      return NextResponse.json(
        { error: 'Product requires title, retailer_id (SKU), and price' },
        { status: 400 }
      )
    }

    const { data: newProduct, error } = await supabase
      .from('commerce_products')
      .upsert(
        {
          organization_id: organizationId,
          retailer_id: product.retailer_id,
          title: product.title,
          description: product.description || '',
          price: Number(product.price),
          currency: product.currency || 'INR',
          image_url: product.image_url || null,
          website_url: product.website_url || null,
          category: product.category || 'General',
          is_available: product.is_available !== false,
          inventory_count: Number(product.inventory_count) || 100,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id,retailer_id' }
      )
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ product: newProduct })
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

    const authResult = await verifyOrgAccess(request, orgId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
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
