import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { sendPush } from '@/lib/push'
import { checkRateLimit } from '@/lib/rate-limiter'
import { createOnlineBooking, loadBookingPage, parseOnlineBooking, servicesTotal } from '@/lib/salon/booking-page'
import { bookingPayOptions } from '@/lib/salon/booking-pay'
import { expireUnpaidBookings, startBookingPayment } from '@/lib/salon/booking-payments'
import { bookingMessage, bookingTemplate, sendCustomerText } from '@/lib/salon/whatsapp'
import { returnBase } from '@/lib/payments/return-url'

export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * POST { service_ids, staff_id?, date, time, name, phone, note?, pay?: 'online' | 'shop', returnPath? }: book from
 * the website or the booking page. No sign-in; limited per address and per phone so the list cannot be flooded.
 *   pay 'shop' (or no online payment): booked visits get the WhatsApp confirmation; a request waits for the business.
 *   pay 'online': the visit waits for its payment (holding the time), and the answer carries what the page needs to
 *   open Razorpay's window or go to Stripe's page. It becomes a booking once paid (see /pay and the webhooks).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  if (!checkRateLimit(`booking:${ip}`, 8, 60 * 60_000).allowed) return NextResponse.json({ error: 'Too many bookings from here. Please call the business instead.' }, { status: 429 })
  const { slug } = await params
  const body = await request.json().catch(() => null)
  const parsed = parseOnlineBooking(body)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  if (!checkRateLimit(`booking-phone:${parsed.phone}`, 4, 24 * 60 * 60_000).allowed) return NextResponse.json({ error: 'You have made several bookings today. Please call the business to book more.' }, { status: 429 })

  const db = getSupabaseAdminClient()
  const page = await loadBookingPage(db, slug)
  if (!page) return NextResponse.json({ error: 'This booking page is not available.' }, { status: 404 })

  // How this booking is paid: decided here from the business's settings, never by the page
  const total = servicesTotal(page, parsed.serviceIds)
  const options = bookingPayOptions(page.pay!.settings, Boolean(page.pay?.gateway), total)
  const online = body?.pay === 'online' ? options.online : !options.atShop
  if (body?.pay === 'online' && !options.online) return NextResponse.json({ error: 'Online payment is not available just now. Please choose to pay at the shop.' }, { status: 400 })

  try {
    await expireUnpaidBookings(db, page.organization.id)
    const result = await createOnlineBooking(db, page, parsed, Date.now(), online ? { awaitingPayment: { amount: options.amount } } : {})
    if ('error' in result) return NextResponse.json({ error: result.error, taken: (result as any).taken === true }, { status: 409 })

    if (online) {
      try {
        const { data: org } = await db.from('organizations').select('*').eq('id', page.organization.id).maybeSingle()
        const base = returnBase({ origin: request.headers.get('origin'), appUrl: process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin, domain: page.organization.domain, path: body?.returnPath, fallback: `/b/${page.organization.slug}` })
        const started = await startBookingPayment(db, page, org, result.appointment, { amount: options.amount, base })
        return NextResponse.json({ success: true, status: 'awaiting_payment', bookingId: result.appointment.id, when: result.when, staff: result.staffName, amount: options.amount, full: options.full, ...started })
      } catch (error: any) {
        console.error('[Booking payment]', error?.message)
        await db.from('salon_appointments').delete().eq('id', result.appointment.id).eq('organization_id', page.organization.id)
        return NextResponse.json({ error: options.atShop ? 'Online payment is not working just now. Please choose to pay at the shop, or try again in a minute.' : 'Online payment is not working just now. Please try again in a minute or call the business.' }, { status: 502 })
      }
    }

    await sendPush(db, { organizationId: page.organization.id }, { kind: 'booking', title: result.status === 'booked' ? 'New booking' : 'New booking request', body: `${parsed.name} · ${result.when} · booked online`, open: 'bookings' })
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
