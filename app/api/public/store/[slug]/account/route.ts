import { NextRequest, NextResponse } from 'next/server'
import { loadLoyaltySettings, pointsBalance } from '@/lib/commerce/loyalty-store'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { loadStore } from '@/lib/commerce/storefront'
import { cleanAddress, cleanCart, loadShopper, saveShopper, shopperFrom, shopperOrders } from '@/lib/commerce/store-accounts'
import { checkRateLimit } from '@/lib/rate-limiter'

export const runtime = 'nodejs'

async function context(request: NextRequest, slug: string) {
  const db = getSupabaseAdminClient()
  const page = await loadStore(db, slug)
  if (!page || !page.settings.accounts) return { error: NextResponse.json({ error: 'Signing in is not available in this store.' }, { status: 404 }) }
  const shopper = await shopperFrom(request, db)
  if (!shopper) return { error: NextResponse.json({ error: 'Please sign in again.' }, { status: 401 }) }
  if (!checkRateLimit(`store-account:${shopper.id}`, 120, 60 * 60_000).allowed) return { error: NextResponse.json({ error: 'Too many tries. Please wait a little.' }, { status: 429 }) }
  return { db, page, shopper }
}

// GET (signed in): the shopper's details in this store, their saved cart and their orders
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const c = await context(request, slug)
  if ('error' in c) return c.error
  const { db, page, shopper } = c
  try {
    const [row, orders] = await Promise.all([loadShopper(db, page.organization.id, shopper.id), shopperOrders(db, page.organization.id, shopper.id)])
    const productIds = new Set(page.products.filter((p) => p.inStock).map((p) => p.id))
    // Loyalty points for the shopper's saved phone (shown in My orders and at checkout)
    const loyalty = await loadLoyaltySettings(db, page.organization.id).catch(() => null)
    const points = loyalty?.on && row?.phone ? await pointsBalance(db, page.organization.id, row.phone).catch(() => 0) : 0
    return NextResponse.json({
      shopper: { name: row?.name || shopper.name, email: shopper.email, picture: shopper.picture, phone: row?.phone || '', address: cleanAddress(row?.address) },
      cart: cleanCart(row?.cart, productIds),
      orders,
      points,
    })
  } catch (error: any) {
    console.error('[Store account]', error?.message)
    return NextResponse.json({ error: 'Your orders could not be loaded. Please try again.' }, { status: 500 })
  }
}

// PUT { cart?, name?, phone?, address? } (signed in): keep the cart and details for next time
export async function PUT(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const c = await context(request, slug)
  if ('error' in c) return c.error
  const { db, page, shopper } = c
  const body = await request.json().catch(() => ({}))
  const changes: Parameters<typeof saveShopper>[3] = {}
  if (body?.cart !== undefined) changes.cart = cleanCart(body.cart, new Set(page.products.map((p) => p.id)))
  if (typeof body?.name === 'string') changes.name = body.name
  if (typeof body?.phone === 'string') changes.phone = body.phone
  if (body?.address !== undefined) changes.address = cleanAddress(body.address)
  try {
    await saveShopper(db, page.organization.id, shopper, changes)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[Store account save]', error?.message)
    return NextResponse.json({ error: 'That could not be saved. Please try again.' }, { status: 500 })
  }
}
