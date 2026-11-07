import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { perSessionLimiter } from '@/lib/rate-limiter'
import { parseFeedbackForm } from '@/lib/salon/feedback'
import { saveFeedback } from '@/lib/salon/feedback-store'
import { isSafeLogoUrl } from '@/lib/salon/logo'
import { withSalonSchema } from '@/lib/salon/schema'

export const runtime = 'nodejs'

// POST { token, rating, staff_ratings, tags, comment }: the customer's feedback form (no login; the bill's link is the key)
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const token = String(body?.token || '')
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return NextResponse.json({ error: 'This feedback link is not valid.' }, { status: 404 })
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  if (!perSessionLimiter.checkRateLimit(`salon-feedback:${ip}`, 20, 60 * 60 * 1000).allowed || !perSessionLimiter.checkRateLimit(`salon-feedback-token:${token}`, 6, 60 * 60 * 1000).allowed) {
    return NextResponse.json({ error: 'Too many tries. Please try again a little later.' }, { status: 429 })
  }
  const db = getSupabaseAdminClient()
  const { data: invoice } = await db.from('salon_invoices').select('*').eq('public_token', token).maybeSingle()
  if (!invoice) return NextResponse.json({ error: 'This feedback link is not valid.' }, { status: 404 })
  if (invoice.status === 'void') return NextResponse.json({ error: 'This bill was cancelled, so feedback is closed.' }, { status: 400 })
  const parsed = parseFeedbackForm(body, invoice)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  try {
    await saveFeedback(db, invoice, parsed.value, 'form')
    const { data: settings } = await withSalonSchema(() => db.from('salon_settings').select('*').eq('organization_id', invoice.organization_id).maybeSingle())
    const reviewLink = parsed.value.rating >= 4 && isSafeLogoUrl(settings?.review_link) ? settings.review_link : null
    return NextResponse.json({ success: true, rating: parsed.value.rating, reviewLink })
  } catch (error: any) {
    console.error('[Salon feedback form]', error?.message || error)
    return NextResponse.json({ error: 'Your feedback could not be saved. Please try again.' }, { status: 500 })
  }
}
