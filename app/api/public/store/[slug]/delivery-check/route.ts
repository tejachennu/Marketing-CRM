import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { loadStore } from '@/lib/commerce/storefront'
import { SHIPPING_ORG_COLUMNS, deliveryCheck, withShippingSchema } from '@/lib/commerce/shipping'
import { cleanPin } from '@/lib/commerce/shipping-rules'
import { checkRateLimit } from '@/lib/rate-limiter'

export const runtime = 'nodejs'

// GET ?pin=500081: does this store deliver there (from its own courier partners), COD or not, in how many days
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  if (!checkRateLimit(`store-pin:${ip}`, 30, 60 * 60_000).allowed) return NextResponse.json({ error: 'Too many checks. Please try again later.' }, { status: 429 })
  const pin = cleanPin(new URL(request.url).searchParams.get('pin'))
  if (!pin) return NextResponse.json({ error: 'Type a 6-digit PIN code.' }, { status: 400 })
  const { slug } = await params
  const db = getSupabaseAdminClient()
  const page = await loadStore(db, slug)
  if (!page) return NextResponse.json({ error: 'This store is not available.' }, { status: 404 })
  const { data: org } = await withShippingSchema(() => db.from('organizations').select(SHIPPING_ORG_COLUMNS).eq('id', page.organization.id).maybeSingle())
  const result = org ? await deliveryCheck(db, org, pin).catch(() => null) : null
  if (!result) return NextResponse.json({ checked: false, pin }, { headers: { 'Cache-Control': 'no-store' } })
  return NextResponse.json({ checked: true, pin, served: result.served, cod: result.cod, days: result.days }, { headers: { 'Cache-Control': 'public, max-age=3600' } })
}
