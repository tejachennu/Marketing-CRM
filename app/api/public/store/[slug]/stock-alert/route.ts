import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { loadStore } from '@/lib/commerce/storefront'
import { addStockAlert } from '@/lib/commerce/stock-alerts'
import { normalizePhone } from '@/lib/public-api/keys'
import { checkRateLimit } from '@/lib/rate-limiter'

export const runtime = 'nodejs'

// POST { productId, variantId?, phone }: "Tell me on WhatsApp when it's back"
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  if (!checkRateLimit(`store-alert:${ip}`, 20, 60 * 60_000).allowed) return NextResponse.json({ ok: false, reason: 'Too many tries. Please wait a little.' }, { status: 429 })
  const { slug } = await params
  const db = getSupabaseAdminClient()
  const page = await loadStore(db, slug)
  if (!page) return NextResponse.json({ ok: false, reason: 'This store is not available.' }, { status: 404 })
  const body = await request.json().catch(() => ({}))
  const product = page.products.find((p) => p.id === body?.productId)
  if (!product) return NextResponse.json({ ok: false, reason: 'This product is not sold here any more.' }, { status: 404 })
  const variantId = product.variants?.some((v) => v.id === body?.variantId) ? String(body.variantId) : null
  const phone = normalizePhone(body?.phone)
  if (!phone) return NextResponse.json({ ok: false, reason: 'Type your WhatsApp number with the country code, like +91 98765 43210.' })
  const result = await addStockAlert(db, page.organization.id, { productId: product.id, variantId, phone })
  return NextResponse.json(result)
}
