import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { readStorefront, storeCategories, withStorefrontSchema, type StoreProduct } from '@/lib/commerce/storefront'

export const runtime = 'nodejs'

const appUrl = (request: NextRequest) => (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '')

/** The categories the store's products use, in the page's order (for the settings screen). */
async function categoriesFor(db: any, organizationId: string, settings: ReturnType<typeof readStorefront>) {
  const { data } = await db.from('commerce_products').select('category, image_url').eq('organization_id', organizationId).limit(1000)
  const products = (data || []).map((p: any) => ({ category: String(p.category || '').trim() || 'Other', image: p.image_url || '' })) as StoreProduct[]
  return storeCategories(settings, products).map((c) => ({ name: c.name, image: settings.categories.find((s) => s.name.toLowerCase() === c.name.toLowerCase())?.image || '', productImage: c.image }))
}

// GET: the online store page's settings, its address and the categories in use (any member may look)
export async function GET(request: NextRequest) {
  const organizationId = new URL(request.url).searchParams.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const db = getSupabaseAdminClient()
  const { data: org, error } = await withStorefrontSchema(() => db.from('organizations').select('id, slug, name, storefront, enable_commerce').eq('id', organizationId).maybeSingle())
  if (error || !org) return NextResponse.json({ error: error?.message || 'Workspace not found' }, { status: 500 })
  const settings = readStorefront(org.storefront)
  return NextResponse.json({ settings, slug: org.slug, link: org.slug ? `${appUrl(request)}/s/${org.slug}` : null, storeOn: org.enable_commerce !== false, categories: await categoriesFor(db, org.id, settings) })
}

// PUT { organizationId, settings }: save them (admins and managers)
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const organizationId = body?.organizationId || null
  const access = await verifyOrgAccess(request, organizationId, { permission: 'automation.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const settings = readStorefront(body?.settings)
  const db = getSupabaseAdminClient()
  const { data: org, error } = await withStorefrontSchema(() => db.from('organizations').update({ storefront: settings }).eq('id', organizationId).select('id, slug').maybeSingle())
  if (error || !org) return NextResponse.json({ error: error?.message || 'The settings could not be saved.' }, { status: 500 })
  return NextResponse.json({ success: true, settings, link: org.slug ? `${appUrl(request)}/s/${org.slug}` : null, categories: await categoriesFor(db, org.id, settings) })
}
