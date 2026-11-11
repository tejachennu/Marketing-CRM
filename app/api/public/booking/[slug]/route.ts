import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { checkRateLimit } from '@/lib/rate-limiter'
import { createOnlineBooking, loadBookingPage, parseOnlineBooking } from '@/lib/salon/booking-page'
import { bookingMessage, bookingTemplate, sendCustomerText } from '@/lib/salon/whatsapp'

export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * POST { service_ids, staff_id?, date, time, name, phone, note? }: book from the public page. No sign-in;
 * limited per address and per phone so the list cannot be flooded. A booked visit gets the WhatsApp
 * confirmation; a request waits for the business to accept it on the Front Desk list.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  if (!checkRateLimit(`booking:${ip}`, 8, 60 * 60_000).allowed) return NextResponse.json({ error: 'Too many bookings from here. Please call the business instead.' }, { status: 429 })
  const { slug } = await params
  const parsed = parseOnlineBooking(await request.json().catch(() => null))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  if (!checkRateLimit(`booking-phone:${parsed.phone}`, 4, 24 * 60 * 60_000).allowed) return NextResponse.json({ error: 'You have made several bookings today. Please call the business to book more.' }, { status: 429 })

  const db = getSupabaseAdminClient()
  const page = await loadBookingPage(db, slug)
  if (!page) return NextResponse.json({ error: 'This booking page is not available.' }, { status: 404 })
  try {
    const result = await createOnlineBooking(db, page, parsed)
    if ('error' in result) return NextResponse.json({ error: result.error, taken: (result as any).taken === true }, { status: 409 })
    let confirmation = false
    if (result.status === 'booked') {
      const business = page.setup.settings.business_name || page.organization.name
      const sent = await sendCustomerText(db, page.organization.id, parsed.phone, bookingMessage(result.appointment, business, result.staffName), bookingTemplate(result.appointment, business, result.staffName)).catch(() => null)
      confirmation = Boolean(sent?.sent)
    }
    return NextResponse.json({ success: true, status: result.status, when: result.when, staff: result.staffName, confirmation })
  } catch (error: any) {
    console.error('[Booking page]', error?.message)
    return NextResponse.json({ error: 'The booking could not be saved. Please try again or call the business.' }, { status: 500 })
  }
}
