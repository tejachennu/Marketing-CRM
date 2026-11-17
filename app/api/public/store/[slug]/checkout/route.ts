import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { loadStore } from '@/lib/commerce/storefront'
import { cartByToken, readCart, saveCheckout } from '@/lib/commerce/cart-reminders'
import { normalizePhone } from '@/lib/public-api/keys'
import { checkRateLimit } from '@/lib/rate-limiter'

export const runtime = 'nodejs'

// POST { phone, name?, cart }: keep the cart of a shopper at checkout (for one WhatsApp reminder if they do not order)
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  if (!checkRateLimit(`store-checkout:${ip}`, 30, 60 * 60_000).allowed) return NextResponse.json({ ok: false }, { status: 429 })
  const { slug } = await params
  const db = getSupabaseAdminClient()
  const page = await loadStore(db, slug)
  if (!page) return NextResponse.json({ ok: false }, { status: 404 })
  const body = await request.json().catch(() => ({}))
  const phone = normalizePhone(body?.phone)
  if (!phone) return NextResponse.json({ ok: false })
  const token = await saveCheckout(db, page.organization.id, page, { phone, name: body?.name, cart: body?.cart }).catch(() => null)
  return NextResponse.json({ ok: Boolean(token) })
}

// GET ?token=: the cart behind a reminder link (only lines the store still sells)
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const db = getSupabaseAdminClient()
  const page = await loadStore(db, slug)
  if (!page) return NextResponse.json({ cart: {} }, { status: 404 })
  const row = await cartByToken(db, page.organization.id, String(new URL(request.url).searchParams.get('token') || '')).catch(() => null)
  if (!row) return NextResponse.json({ cart: {} })
  return NextResponse.json({ cart: readCart(page, row.cart).cart, name: row.name || '', phone: row.phone || '' }, { headers: { 'Cache-Control': 'no-store' } })
}
