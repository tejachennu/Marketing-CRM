import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { loadStore } from '@/lib/commerce/storefront'
import { orderByReviewToken, saveReviews, withReviewSchema } from '@/lib/commerce/review-store'
import { cleanReview } from '@/lib/commerce/reviews'
import { checkRateLimit } from '@/lib/rate-limiter'

export const runtime = 'nodejs'

async function load(request: NextRequest, slug: string, token: string) {
  const db = getSupabaseAdminClient()
  const page = await loadStore(db, slug)
  if (!page) return null
  const order = await orderByReviewToken(db, page.organization.id, token)
  return order ? { db, page, order } : null
}

// GET ?token=: the order behind a review link: its products, and which are already reviewed
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const found = await load(request, slug, String(new URL(request.url).searchParams.get('token') || ''))
  if (!found) return NextResponse.json({ error: 'This review link is not valid.' }, { status: 404 })
  const { data: done } = await withReviewSchema(() => found.db.from('commerce_reviews').select('product_id').eq('order_id', found.order.id))
  const reviewed = new Set((done || []).map((d: any) => d.product_id))
  const seen = new Set<string>()
  const items = (found.order.items || []).filter((i: any) => i.product_id && !seen.has(i.product_id) && seen.add(i.product_id)).map((i: any) => ({
    productId: i.product_id, title: String(i.title || '').split(' · ')[0], image: /^https:\/\//.test(String(i.image_url || '')) ? i.image_url : '', reviewed: reviewed.has(i.product_id),
  }))
  return NextResponse.json({ orderNumber: found.order.order_number, name: String(found.order.shipping_address?.full_name || '').split(' ')[0], items })
}

// POST { token, reviews: [{ productId, rating, text, photos }] }
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  if (!checkRateLimit(`store-review:${ip}`, 20, 60 * 60_000).allowed) return NextResponse.json({ error: 'Too many tries. Please wait a little.' }, { status: 429 })
  const { slug } = await params
  const body = await request.json().catch(() => ({}))
  const found = await load(request, slug, String(body?.token || ''))
  if (!found) return NextResponse.json({ error: 'This review link is not valid.' }, { status: 404 })
  const reviews = (Array.isArray(body?.reviews) ? body.reviews : []).slice(0, 30).map(cleanReview).filter(Boolean) as any[]
  if (!reviews.length) return NextResponse.json({ error: 'Tap the stars to rate at least one product.' }, { status: 400 })
  const result = await saveReviews(found.db, found.page.organization.id, found.order, reviews)
  return NextResponse.json({ success: true, ...result })
}
