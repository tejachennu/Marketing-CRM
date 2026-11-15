import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { loadStore } from '@/lib/commerce/storefront'
import { trackOrder } from '@/lib/commerce/store-accounts'
import { checkRateLimit } from '@/lib/rate-limiter'

export const runtime = 'nodejs'

// POST { order, phone }: where a guest's order is, by its number and the phone it was placed with
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  // Few tries, so order numbers cannot be guessed
  if (!checkRateLimit(`store-track:${ip}`, 20, 60 * 60_000).allowed) return NextResponse.json({ error: 'Too many tries. Please wait a little, or call the shop.' }, { status: 429 })
  const { slug } = await params
  const db = getSupabaseAdminClient()
  const page = await loadStore(db, slug)
  if (!page) return NextResponse.json({ error: 'This store is not available.' }, { status: 404 })
  const body = await request.json().catch(() => ({}))
  const order = await trackOrder(db, page.organization.id, String(body?.order || ''), String(body?.phone || '')).catch(() => null)
  if (!order) return NextResponse.json({ error: 'We could not find that order. Check the order number and use the phone number you ordered with.' }, { status: 404 })
  return NextResponse.json({ order })
}
