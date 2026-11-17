import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { cartForDiscount, loadStore } from '@/lib/commerce/storefront'
import { decideDiscount } from '@/lib/commerce/discount-store'
import { normalizePhone } from '@/lib/public-api/keys'
import { checkRateLimit } from '@/lib/rate-limiter'

export const runtime = 'nodejs'

/**
 * POST { code?, items: [{productId, variantId?, quantity}], phone?, handover }: what a code (or the best offer
 * that applies by itself) takes off this cart. Only a preview: the order route decides again when ordering.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  if (!checkRateLimit(`store-code:${ip}`, 40, 60 * 60_000).allowed) return NextResponse.json({ ok: false, reason: 'Too many tries. Please wait a little.' }, { status: 429 })
  const { slug } = await params
  const db = getSupabaseAdminClient()
  const page = await loadStore(db, slug)
  if (!page) return NextResponse.json({ ok: false, reason: 'This store is not available.' }, { status: 404 })
  const body = await request.json().catch(() => ({}))
  const byId = new Map(page.products.map((p) => [p.id, p]))
  const items = (Array.isArray(body?.items) ? body.items : []).slice(0, 60).map((line: any) => {
    const product = byId.get(String(line?.productId))
    if (!product) return null
    const variant = product.variants?.find((v) => v.id === line?.variantId)
    const quantity = Math.max(1, Math.min(99, Math.round(Number(line?.quantity) || 1)))
    return { productId: product.id, price: variant ? variant.price : product.price, quantity }
  }).filter(Boolean)
  if (!items.length) return NextResponse.json({ ok: false, reason: 'Your cart is empty.' })
  const subtotal = items.reduce((sum: number, i: any) => sum + i.price * i.quantity, 0)
  const delivery = body?.handover === 'delivery' ? (page.fees.freeFrom > 0 && subtotal >= page.fees.freeFrom ? 0 : page.fees.fee) : 0
  const decided = await decideDiscount(db, page.organization.id, body?.code, cartForDiscount(page, items, delivery), normalizePhone(body?.phone) || null)
  if (!decided) return NextResponse.json({ ok: false, reason: '' })
  if (!decided.ok) return NextResponse.json({ ok: false, reason: decided.reason })
  return NextResponse.json({ ok: true, title: decided.title, code: decided.code, amount: decided.amount, freeDelivery: decided.freeDelivery })
}
