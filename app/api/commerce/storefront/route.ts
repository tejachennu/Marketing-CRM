import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { readStorefront, storeCategories, storeChatProblem, suggestStorefront, withStorefrontSchema, type StoreProduct } from '@/lib/commerce/storefront'

export const runtime = 'nodejs'

const appUrl = (request: NextRequest) => (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '')

/** The categories the store's products use, in the page's order (for the settings screen). */
async function categoriesFor(db: any, organizationId: string, settings: ReturnType<typeof readStorefront>) {
  const { data } = await db.from('commerce_products').select('category, image_url').eq('organization_id', organizationId).limit(1000)
  const products = (data || []).map((p: any) => ({ category: String(p.category || '').trim() || 'Other', image: p.image_url || '' })) as StoreProduct[]
  return storeCategories(settings, products).map((c) => ({ name: c.name, image: settings.categories.find((s) => s.name.toLowerCase() === c.name.toLowerCase())?.image || '', productImage: c.image }))
}

/** A full store page made from the business's details, products and photos (see suggestStorefront). */
async function suggestionFor(db: any, org: any, appBase: string, colour?: string) {
  const [{ data: products }, salon] = await Promise.all([
    db.from('commerce_products').select('title, category, image_url').eq('organization_id', org.id).limit(1000),
    // Front Desk details when it is set up; a missing table just means none (no set-up is started here)
    Promise.resolve(db.from('salon_settings').select('business_name, address, phone, logo_url').eq('organization_id', org.id).maybeSingle()).catch(() => ({ data: null })),
  ])
  return suggestStorefront({ appUrl: appBase, organization: org, salon: salon?.data || null, products: products || [], colour })
}

async function productCount(db: any, organizationId: string): Promise<number> {
  const { data } = await db.from('commerce_products').select('id').eq('organization_id', organizationId).limit(1)
  return data?.length || 0
}

// GET: the online store page's settings, its address and the categories in use (any member may look).
// A store never saved comes back filled from the business's details (prefilled: true), ready to check and save;
// `suggested` is always sent so blank parts can be filled later.
export async function GET(request: NextRequest) {
  const organizationId = new URL(request.url).searchParams.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const db = getSupabaseAdminClient()
  const { data: org, error } = await withStorefrontSchema(() => db.from('organizations').select('*').eq('id', organizationId).maybeSingle())
  if (error || !org) return NextResponse.json({ error: error?.message || 'Workspace not found' }, { status: 500 })
  const saved = org.storefront && typeof org.storefront === 'object' && Object.keys(org.storefront).length > 0
  const current = readStorefront(org.storefront)
  const suggested = await suggestionFor(db, org, appUrl(request), saved ? current.colour : undefined)
  const settings = saved ? current : suggested
  return NextResponse.json({
    settings,
    suggested,
    prefilled: !saved,
    slug: org.slug,
    link: org.slug ? `${appUrl(request)}/s/${org.slug}` : null,
    storeOn: org.enable_commerce !== false,
    categories: await categoriesFor(db, org.id, settings),
    // Why the AI chat would not show on the website right now (null when it works)
    chatProblem: await storeChatProblem(db, org, await productCount(db, org.id)),
  })
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
