import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { checkRateLimit } from '@/lib/rate-limiter'
import { loadBookingPage, servicesTotal } from '@/lib/salon/booking-page'
import { bookingPayOptions } from '@/lib/salon/booking-pay'
import { checkBookingPayment, findBooking, payAtShopInstead } from '@/lib/salon/booking-payments'
import { formatIstDay, formatIstTime, istDate } from '@/lib/salon/spoken'

export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * After paying for a booking:
 *   { bookingId, razorpayOrderId, paymentId, signature }   Razorpay's window says paid: check it and confirm
 *   { bookingId, razorpayOrderId | sessionId, action: 'check' }  back from Stripe, or the page lost track: ask the gateway
 *   { bookingId, razorpayOrderId | sessionId, action: 'shop' }   pay at the shop instead (when the business allows it)
 * The Razorpay order id or Stripe session id is the proof the caller made this booking.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  if (!checkRateLimit(`booking-pay:${ip}`, 30, 60 * 60_000).allowed) return NextResponse.json({ error: 'Too many tries. Please wait a little.' }, { status: 429 })
  const { slug } = await params
  const body = await request.json().catch(() => ({}))
  const db = getSupabaseAdminClient()
  const page = await loadBookingPage(db, slug)
  if (!page) return NextResponse.json({ error: 'This booking page is not available.' }, { status: 404 })
  const ref = String(body?.sessionId || body?.razorpayOrderId || '')
  const appointment = await findBooking(db, page.organization.id, { id: String(body?.bookingId || '') })
  if (!appointment || !ref || appointment.payment_ref !== ref) return NextResponse.json({ error: 'That booking could not be found.' }, { status: 404 })

  const view = (a: any, paid: boolean) => ({
    success: true, paid,
    status: a.status, when: `${formatIstDay(istDate(Date.parse(a.starts_at)), istDate())}, ${formatIstTime(new Date(a.starts_at))}`,
    staff: a.staff_id ? page.setup.staff.find((m) => m.id === a.staff_id)?.name || null : null,
    services: (a.services || []).map((s: any) => s.name),
    paidAmount: Number(a.payment_paid) || 0,
  })

  if (body?.action === 'shop') {
    const options = bookingPayOptions(page.pay!.settings, Boolean(page.pay?.gateway), servicesTotal(page, (appointment.services || []).map((s: any) => s.service_id)))
    if (!options.atShop) return NextResponse.json({ error: `${page.setup.settings.business_name || page.organization.name} asks for payment online to book.` }, { status: 400 })
    const booked = await payAtShopInstead(db, page, appointment)
    if (!booked) return NextResponse.json({ error: 'This booking can no longer be changed. Please book again.' }, { status: 409 })
    return NextResponse.json(view(booked, false))
  }

  try {
    const { data: org } = await db.from('organizations').select('*').eq('id', page.organization.id).maybeSingle()
    const { paid } = await checkBookingPayment(db, page, org, appointment, {
      sessionId: body?.sessionId ? String(body.sessionId) : undefined,
      razorpayOrderId: body?.razorpayOrderId ? String(body.razorpayOrderId) : undefined,
      paymentId: body?.paymentId ? String(body.paymentId) : undefined,
      signature: body?.signature,
    })
    const fresh = (await findBooking(db, page.organization.id, { id: appointment.id })) || appointment
    return NextResponse.json(view(fresh, paid))
  } catch (error: any) {
    console.error('[Booking pay]', error?.message)
    return NextResponse.json({ error: 'The payment could not be checked right now. If money was taken, the business will see it shortly.' }, { status: 502 })
  }
}
