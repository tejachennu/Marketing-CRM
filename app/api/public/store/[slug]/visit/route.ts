import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { countVisit } from '@/lib/commerce/shop-reports-store'
import { checkRateLimit } from '@/lib/rate-limiter'

export const runtime = 'nodejs'

const SLUG = /^[a-z0-9][a-z0-9-]{1,120}$/i
const DOMAIN = /^(?=.{4,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/

/** POST { product?: true }: the store page (or a product page) was opened. Counts only; nothing personal is kept. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  if (!checkRateLimit(`store-visit:${ip}`, 120, 60 * 60_000).allowed) return NextResponse.json({ ok: false }, { status: 429 })
  const slug = String((await params).slug || '')
  const domain = DOMAIN.test(slug.toLowerCase())
  if (!SLUG.test(slug) && !domain) return NextResponse.json({ ok: false }, { status: 404 })
  const db = getSupabaseAdminClient()
  const { data: org } = await db.from('organizations').select('id, enable_commerce').eq(domain ? 'store_domain' : 'slug', domain ? slug.toLowerCase() : slug).maybeSingle()
  if (!org || org.enable_commerce === false) return NextResponse.json({ ok: false }, { status: 404 })
  const body = await request.json().catch(() => ({}))
  await countVisit(db, org.id, body?.product ? 'product' : 'visit').catch((error: any) => console.error('[Store visit]', error?.message))
  return NextResponse.json({ ok: true })
}
