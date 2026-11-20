/**
 * Paying online while booking (website and booking page), through the business's own Razorpay or Stripe. Starts
 * the payment for a booking that waits for it, and marks it paid once (from the page, a check, or the gateway's
 * webhook, whichever comes first): the visit becomes booked (or a request when the business confirms each one),
 * the customer gets the WhatsApp confirmation and the team a pop-up. Rules in booking-pay.ts. Server only.
 */

import { createRazorpayOrder, storeRazorpayKeys, verifyStoreSignature, paidPayment } from '../commerce/store-payments'
import { createCheckout, getCheckout, majorUnits, minorUnits, SESSION_PLACEHOLDER, stripeKeys } from '../payments/stripe'
import { withQuery } from '../payments/return-url'
import { withPaymentsSchema } from '../payments/schema'
import { sendPush } from '../push'
import { busyFrom, isTimeFree, type OpeningHours } from './availability'
import { AWAITING_PAYMENT } from './booking-pay'
import type { BookingPage } from './booking-page'
import { staffFor } from './chat'
import { formatIstDay, formatIstTime, istDate, istDayRange } from './spoken'
import { bookingMessage, bookingTemplate, sendCustomerText } from './whatsapp'

const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

export type StartedPayment =
  | { gateway: 'razorpay'; razorpay: { keyId: string; orderId: string; amount: number; currency: string; name: string; description: string; customer: { name: string; contact: string } } }
  | { gateway: 'stripe'; stripe: { sessionId: string; url: string } }

/** Open the payment for a booking that waits for it, and keep its reference on the booking. */
export async function startBookingPayment(db: any, page: BookingPage, org: any, appointment: any, input: { amount: number; base: string }): Promise<StartedPayment> {
  const business = page.setup.settings.business_name || page.organization.name
  const currency = page.organization.currency || 'INR'
  const what = (appointment.services || []).map((s: any) => s.name).join(', ')
  const when = `${formatIstDay(istDate(Date.parse(appointment.starts_at)), istDate())}, ${formatIstTime(new Date(appointment.starts_at))}`
  const title = `${business} · ${what}`.slice(0, 200)
  const notes = { wama_kind: 'booking', wama_booking_id: String(appointment.id) }
  const save = (patch: Record<string, unknown>) => withPaymentsSchema(() => db.from('salon_appointments').update(patch).eq('id', appointment.id).eq('organization_id', page.organization.id))

  if (page.pay?.gateway === 'stripe') {
    const keys = stripeKeys(org)
    if (!keys) throw new Error('Stripe is not connected.')
    const session = await createCheckout(keys.secretKey, {
      amount: input.amount, currency, title, description: when,
      metadata: notes, reference: `booking-${appointment.id}`,
      successUrl: withQuery(input.base, { booked: String(appointment.id), session: SESSION_PLACEHOLDER }),
      cancelUrl: withQuery(input.base, { unpaid: String(appointment.id) }),
      minutes: 30,
    })
    await save({ payment_gateway: 'stripe', payment_ref: session.id })
    return { gateway: 'stripe', stripe: { sessionId: session.id, url: session.url } }
  }
  const keys = storeRazorpayKeys(org)
  if (!keys) throw new Error('Razorpay is not connected.')
  const order = await createRazorpayOrder(keys, { amount: input.amount, currency, receipt: `bk-${String(appointment.id).slice(0, 30)}`, notes })
  await save({ payment_gateway: 'razorpay', payment_ref: order.id })
  return {
    gateway: 'razorpay',
    razorpay: { keyId: keys.keyId, orderId: order.id, amount: order.amount, currency: order.currency, name: business, description: `${what} · ${when}`.slice(0, 250), customer: { name: appointment.customer_name, contact: appointment.customer_phone || '' } },
  }
}

/** A booking by its id or its payment reference (Razorpay order id / Stripe session id). */
export async function findBooking(db: any, organizationId: string, by: { id?: string | null; ref?: string | null }) {
  const base = () => db.from('salon_appointments').select('*').eq('organization_id', organizationId)
  if (by.id && /^[0-9a-f-]{36}$/i.test(by.id)) {
    const { data } = await base().eq('id', by.id).maybeSingle()
    if (data) return data
  }
  if (by.ref) {
    const { data } = await withPaymentsSchema(() => base().eq('payment_ref', by.ref).limit(1))
    return data?.[0] || null
  }
  return null
}

/** Is the paid visit's time still free (its hold ran out before the payment came)? */
async function stillFree(db: any, page: BookingPage, appointment: any): Promise<boolean> {
  if (appointment.payment_hold_until && Date.parse(appointment.payment_hold_until) > Date.now()) return true
  const date = istDate(Date.parse(appointment.starts_at))
  const { start, end } = istDayRange(date)
  const { data } = await db.from('salon_appointments').select('*').eq('organization_id', page.organization.id).gte('starts_at', start).lt('starts_at', end)
  const busy = busyFrom((data || []).filter((a: any) => a.id !== appointment.id))
  const serviceIds = (appointment.services || []).map((s: any) => s.service_id).filter(Boolean)
  const minutes = Math.max(5, Math.round((Date.parse(appointment.ends_at) - Date.parse(appointment.starts_at)) / 60_000))
  const time = formatClock(appointment.starts_at)
  return isTimeFree({ date, now: Date.parse(appointment.starts_at) - 60_000, hours: page.setup.settings as OpeningHours, minutes, eligibleStaff: staffFor(page.setup.staff, serviceIds), staffId: appointment.staff_id || null, busy, time })
}

/** "14:30" in India time */
function formatClock(iso: string): string {
  const d = new Date(Date.parse(iso) + 330 * 60_000)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/**
 * Mark a booking paid (once): the amount must be at least what was asked. Then it is booked (or a request), the
 * customer gets the confirmation and the team a pop-up. A payment that came after the hold ran out and the time
 * was taken meanwhile waits as a request for the team. Returns the booking when this call marked it.
 */
export async function markBookingPaid(db: any, page: BookingPage, appointment: any, payment: { id: string; amount: number; gateway: 'razorpay' | 'stripe' }) {
  const currency = page.organization.currency || 'INR'
  const asked = minorUnits(Number(appointment.payment_amount) || 0, currency)
  if (payment.amount < asked) {
    console.warn(`[Booking payment] ${appointment.id}: paid ${payment.amount}, asked ${asked}`)
    return null
  }
  if (appointment.payment_status === 'paid') return null
  // Waiting for this payment, or let go when its hold ran out: it becomes a booking now. Anything else
  // (paying the rest at the shop chosen meanwhile, a cancelled visit) keeps its status; the payment is recorded.
  const waiting = appointment.status === AWAITING_PAYMENT || (appointment.status === 'cancelled' && appointment.payment_status === 'expired')
  const free = waiting ? await stillFree(db, page, appointment) : true
  const autoApprove = page.setup.settings.auto_approve_bookings === true
  const status = waiting ? (autoApprove && free ? 'booked' : 'requested') : appointment.status
  const paid = majorUnits(payment.amount, currency)
  // The payment itself shows from payment_paid; a note only when the team must look at the time
  const note = free ? '' : `Paid ${rupees(paid)} online after the hold ran out: please check the time`
  const { data: marked } = await withPaymentsSchema(() => db.from('salon_appointments')
    .update({ status, payment_status: 'paid', payment_paid: paid, payment_id: payment.id, payment_gateway: payment.gateway, notes: [appointment.notes, note].filter(Boolean).join(' · '), updated_at: new Date().toISOString() })
    .eq('id', appointment.id).eq('organization_id', page.organization.id).neq('payment_status', 'paid')
    .select('*'))
  const booked = marked?.[0]
  if (!booked) return null

  const when = `${formatIstDay(istDate(Date.parse(booked.starts_at)), istDate())}, ${formatIstTime(new Date(booked.starts_at))}`
  await sendPush(db, { organizationId: page.organization.id }, { kind: 'booking', title: status === 'booked' ? `New booking · paid ${rupees(paid)}` : `New booking request · paid ${rupees(paid)}`, body: `${booked.customer_name} · ${when} · booked online`, open: 'bookings' }).catch(() => null)
  if (status === 'booked' && booked.customer_phone) {
    const business = page.setup.settings.business_name || page.organization.name
    const staffName = booked.staff_id ? page.setup.staff.find((m) => m.id === booked.staff_id)?.name || null : null
    await sendCustomerText(db, page.organization.id, booked.customer_phone, bookingMessage(booked, business, staffName), bookingTemplate(booked, business, staffName)).catch(() => null)
  }
  return booked
}

/** Ask the gateway whether a booking's payment went through; mark it when it did. */
export async function checkBookingPayment(db: any, page: BookingPage, org: any, appointment: any, proof: { sessionId?: string; razorpayOrderId?: string; paymentId?: string; signature?: unknown }): Promise<{ paid: boolean }> {
  if (appointment.payment_status === 'paid') return { paid: true }
  if (appointment.payment_gateway === 'stripe') {
    const keys = stripeKeys(org)
    if (!keys || !proof.sessionId || proof.sessionId !== appointment.payment_ref) return { paid: false }
    const session = await getCheckout(keys.secretKey, proof.sessionId)
    if (session.paid) await markBookingPaid(db, page, appointment, { id: session.paymentIntent || session.id, amount: session.amount, gateway: 'stripe' })
    return { paid: session.paid }
  }
  const keys = storeRazorpayKeys(org)
  if (!keys || !proof.razorpayOrderId || proof.razorpayOrderId !== appointment.payment_ref) return { paid: false }
  // From the payment window: the signature must match before we even ask
  if (proof.paymentId && !verifyStoreSignature(keys.keySecret, proof.razorpayOrderId, proof.paymentId, proof.signature)) return { paid: false }
  const payment = await paidPayment(keys, proof.razorpayOrderId)
  if (payment) await markBookingPaid(db, page, appointment, { id: payment.id, amount: payment.amount, gateway: 'razorpay' })
  return { paid: Boolean(payment) }
}

/** The customer gave up paying online and will pay at the shop (when the business allows it). */
export async function payAtShopInstead(db: any, page: BookingPage, appointment: any) {
  if (appointment.status !== AWAITING_PAYMENT || appointment.payment_status !== 'pending') return null
  const autoApprove = page.setup.settings.auto_approve_bookings === true
  const free = await stillFree(db, page, appointment)
  const status = autoApprove && free ? 'booked' : 'requested'
  const { data } = await withPaymentsSchema(() => db.from('salon_appointments').update({ status, payment_status: 'at_shop', payment_hold_until: null, updated_at: new Date().toISOString() })
    .eq('id', appointment.id).eq('organization_id', page.organization.id).eq('payment_status', 'pending').select('*'))
  const booked = data?.[0]
  if (!booked) return null
  const when = `${formatIstDay(istDate(Date.parse(booked.starts_at)), istDate())}, ${formatIstTime(new Date(booked.starts_at))}`
  await sendPush(db, { organizationId: page.organization.id }, { kind: 'booking', title: status === 'booked' ? 'New booking' : 'New booking request', body: `${booked.customer_name} · ${when} · pays at the shop`, open: 'bookings' }).catch(() => null)
  if (status === 'booked' && booked.customer_phone) {
    const business = page.setup.settings.business_name || page.organization.name
    const staffName = booked.staff_id ? page.setup.staff.find((m) => m.id === booked.staff_id)?.name || null : null
    await sendCustomerText(db, page.organization.id, booked.customer_phone, bookingMessage(booked, business, staffName), bookingTemplate(booked, business, staffName)).catch(() => null)
  }
  return booked
}

/** Booking ids waiting for a payment that ran out more than a day ago: let them go (cancelled, expired). */
export async function expireUnpaidBookings(db: any, organizationId: string, now = Date.now()) {
  await withPaymentsSchema(() => db.from('salon_appointments').update({ status: 'cancelled', payment_status: 'expired', updated_at: new Date(now).toISOString() })
    .eq('organization_id', organizationId).eq('status', AWAITING_PAYMENT).lt('payment_hold_until', new Date(now - 24 * 60 * 60_000).toISOString())).catch(() => null)
}
