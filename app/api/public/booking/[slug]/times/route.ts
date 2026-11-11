import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { checkRateLimit } from '@/lib/rate-limiter'
import { bookingTimes, loadBookingPage, parseTimesQuery } from '@/lib/salon/booking-page'

export const runtime = 'nodejs'

/** GET ?services=a,b&staff=&date=YYYY-MM-DD: free start times on the public booking page. No sign-in. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  if (!checkRateLimit(`booking-times:${ip}`, 120, 60_000).allowed) return NextResponse.json({ error: 'Too many requests. Please wait a minute.' }, { status: 429 })
  const { slug } = await params
  const url = new URL(request.url)
  const query = parseTimesQuery({ services: url.searchParams.get('services'), staff: url.searchParams.get('staff'), date: url.searchParams.get('date') })
  if ('error' in query) return NextResponse.json({ error: query.error }, { status: 400 })
  const db = getSupabaseAdminClient()
  const page = await loadBookingPage(db, slug)
  if (!page) return NextResponse.json({ error: 'This booking page is not available.' }, { status: 404 })
  const result = await bookingTimes(db, page, query)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
