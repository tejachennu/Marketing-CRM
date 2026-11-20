/**
 * The public booking page (/b/<workspace slug>): a customer picks services, a person (or anyone), a day
 * and a free time, gives a name and phone number, and the booking lands on the Front Desk list. It uses
 * the same free times as the WhatsApp booking assistant, and the business's "accept on their own"
 * setting decides whether it is booked at once or waits as a request. A booked visit gets the usual
 * confirmation on WhatsApp (the business's own number, or WAMA's number on Starter).
 *
 * Links and QR codes can point at one person (?p=<id>) or one service (?s=<id>).
 */

import { isConnectorOn } from '../connectors'
import { resolveCustomer } from './actions'
import { type Busy, describeHours, freeTimes, holdsTime, isTimeFree, istWeekday, type OpeningHours } from './availability'
import { AWAITING_PAYMENT, HOLD_MINUTES, readBookingPay, type BookingPay } from './booking-pay'
import { gatewayMethods, onlineGateway, type Gateway } from '../payments/gateway'
import { busyOn as busyFor, loadChatSetup, staffFor, type ChatSetup } from './chat'
import { isSafeLogoUrl } from './logo'
import { withPaymentsSchema } from '../payments/schema'
import { formatIstDay, formatIstTime, fromIst, istDate, parsePhoneNumber } from './spoken'

/** How many days ahead a customer can book. */
export const BOOKING_DAYS_AHEAD = 30
/** At most this many services in one booking. */
export const MAX_SERVICES = 5

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface BookingPage {
  organization: { id: string; name: string; slug: string; currency?: string; domain?: string | null }
  setup: ChatSetup
  /** Paying while booking: the business's choice, and its connected online payment (if any) */
  pay?: { settings: BookingPay; gateway: Gateway | null }
}

/** The workspace behind a booking page, when Front Desk is on and there is something to book. */
export async function loadBookingPage(db: any, slug: string): Promise<BookingPage | null> {
  if (!/^[a-z0-9][a-z0-9-]{1,120}$/i.test(slug)) return null
  const { data: organization } = await db.from('organizations').select('*').eq('slug', slug).maybeSingle()
  if (!organization || !isConnectorOn(organization, 'salon')) return null
  const setup = await loadChatSetup(db, organization.id)
  if (setup.settings.booking_page_enabled === false || !setup.services.length) return null
  return {
    organization: { id: organization.id, name: organization.name, slug: organization.slug, currency: String(organization.currency || 'INR').toUpperCase(), domain: organization.store_domain || null },
    setup,
    pay: { settings: readBookingPay((setup.settings as any)?.website?.bookingPay), gateway: onlineGateway(organization) },
  }
}

/** What the page shows: safe to send to anyone (no costs, no internal notes). */
export function publicView(page: BookingPage) {
  const { settings, services, staff } = page.setup
  return {
    slug: page.organization.slug,
    business: settings.business_name || page.organization.name,
    logo: isSafeLogoUrl(settings.logo_url) ? settings.logo_url : null,
    address: settings.address || null,
    phone: settings.phone || null,
    hours: describeHours(settings as OpeningHours),
    approval: settings.auto_approve_bookings !== true,
    services: services.map((s) => ({ id: s.id, name: s.name, category: s.category || 'General', price: Number(s.price) || 0, minutes: Number(s.duration_minutes) || 30 })),
    staff: staff.map((m) => ({ id: m.id, name: m.name, service_ids: m.service_ids })),
    // How the customer can pay; the amount is worked out on the page for the services picked (bookingPayOptions)
    pay: {
      mode: page.pay?.settings.mode || 'shop',
      advance: page.pay?.settings.advance || 100,
      online: Boolean(page.pay?.gateway) && page.pay?.settings.mode !== 'shop',
      gateway: page.pay?.gateway || null,
      methods: gatewayMethods(page.pay?.gateway || null),
    },
  }
}

export type BookingPageView = ReturnType<typeof publicView>

/** The next days a customer may pick, from today, skipping closed days. */
export function bookableDays(hours: OpeningHours, now = Date.now(), days = BOOKING_DAYS_AHEAD): string[] {
  const today = istDate(now)
  const list: string[] = []
  for (let i = 0; i < days; i++) {
    const date = istDate(Date.parse(`${today}T12:00:00+05:30`) + i * 86_400_000)
    if (!(hours.closed_weekdays || []).includes(istWeekday(date))) list.push(date)
  }
  return list
}

export interface TimesQuery { serviceIds: string[]; staffId: string | null; date: string }

/** Check what the page asks times for. */
export function parseTimesQuery(params: { services?: string | null; staff?: string | null; date?: string | null }): TimesQuery | { error: string } {
  const serviceIds = [...new Set(String(params.services || '').split(',').filter((id) => UUID.test(id)))].slice(0, MAX_SERVICES)
  if (!serviceIds.length) return { error: 'Choose a service.' }
  const date = String(params.date || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Choose a day.' }
  const staffId = params.staff && UUID.test(params.staff) ? params.staff : null
  return { serviceIds, staffId, date }
}

function chosen(setup: ChatSetup, query: TimesQuery) {
  const services = setup.services.filter((s) => query.serviceIds.includes(s.id))
  if (services.length !== query.serviceIds.length) return { error: 'One of those services is no longer offered. Please choose again.' } as const
  const eligible = staffFor(setup.staff, query.serviceIds)
  if (query.staffId && !eligible.includes(query.staffId)) return { error: 'That person does not do all of these services. Choose someone else or Anyone.' } as const
  const minutes = services.reduce((sum, s) => sum + (Number(s.duration_minutes) || 30), 0)
  return { services, eligible, minutes } as const
}

/** The price of these services (what is paid online, in full or as an advance). */
export function servicesTotal(page: BookingPage, serviceIds: string[]): number {
  return Math.round(page.setup.services.filter((s) => serviceIds.includes(s.id)).reduce((sum, s) => sum + (Number(s.price) || 0), 0) * 100) / 100
}

/** Free start times on a day for these services and person. */
export async function bookingTimes(db: any, page: BookingPage, query: TimesQuery, now = Date.now()): Promise<{ times: string[] } | { error: string }> {
  const pick = chosen(page.setup, query)
  if ('error' in pick) return { error: pick.error as string }
  const today = istDate(now)
  const last = bookableDays(page.setup.settings as OpeningHours, now).at(-1) || today
  if (query.date < today || query.date > last) return { times: [] }
  const busy: Busy[] = await busyFor(db, page.organization.id, query.date)
  const times = freeTimes({ date: query.date, now, hours: page.setup.settings as OpeningHours, minutes: pick.minutes, eligibleStaff: pick.eligible, staffId: query.staffId, busy, limit: 60 })
  return { times }
}

export interface OnlineBooking extends TimesQuery { time: string; name: string; phone: string; note: string | null }

/** Check a booking sent from the page. */
export function parseOnlineBooking(body: any): OnlineBooking | { error: string } {
  const query = parseTimesQuery({ services: Array.isArray(body?.service_ids) ? body.service_ids.join(',') : '', staff: body?.staff_id || null, date: body?.date })
  if ('error' in query) return query
  const time = String(body?.time || '')
  if (!/^\d{2}:\d{2}$/.test(time)) return { error: 'Choose a time.' }
  const name = String(body?.name || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (name.length < 2) return { error: 'Please type your name.' }
  const phone = parsePhoneNumber(String(body?.phone || ''))
  if (!phone) return { error: 'Please type your mobile number with the country code, like +91 98765 43210.' }
  const note = String(body?.note || '').replace(/\s+/g, ' ').trim().slice(0, 300) || null
  return { ...query, time, name, phone, note }
}

/**
 * Save a booking from the page. Refuses a time that was taken meanwhile, and a second booking for the
 * same phone and time. Returns the appointment and whether it is booked or waits as a request.
 */
export async function createOnlineBooking(db: any, page: BookingPage, booking: OnlineBooking, now = Date.now(), options: { awaitingPayment?: { amount: number } } = {}) {
  const pick = chosen(page.setup, booking)
  if ('error' in pick) return { error: pick.error as string }
  const startsAt = fromIst(booking.date, booking.time)
  if (!startsAt) return { error: 'Choose a time.' }
  const hours = page.setup.settings as OpeningHours
  // The same phone at the same time again (a cancelled one, or an unpaid one whose hold ran out, does not count)
  const { data: same } = await db.from('salon_appointments').select('*').eq('organization_id', page.organization.id).eq('customer_phone', booking.phone).eq('starts_at', startsAt.toISOString()).limit(5)
  if ((same || []).some((a: any) => holdsTime(a, now) && a.status !== AWAITING_PAYMENT)) return { error: 'You already have this booking. See you then!' }
  // Their own unpaid try at this time (closed the payment, booking again): let it go so they can try again
  const retry = (same || []).filter((a: any) => a.status === AWAITING_PAYMENT && a.payment_status === 'pending').map((a: any) => a.id)
  if (retry.length) await db.from('salon_appointments').update({ status: 'cancelled', payment_status: 'expired', updated_at: new Date(now).toISOString() }).eq('organization_id', page.organization.id).in('id', retry).eq('payment_status', 'pending')
  const busy = await busyFor(db, page.organization.id, booking.date)
  if (!isTimeFree({ date: booking.date, now, hours, minutes: pick.minutes, eligibleStaff: pick.eligible, staffId: booking.staffId, busy, time: booking.time })) {
    return { error: 'Sorry, that time was just taken. Please pick another one.', taken: true }
  }

  // The person: the one chosen, else whoever can do it and is free (the counter can change it)
  let staffId = booking.staffId
  if (!staffId && pick.eligible.length && page.setup.staff.length) {
    const ends = startsAt.getTime() + pick.minutes * 60_000
    const taken = new Set(busy.filter((b) => Date.parse(b.starts_at) < ends && Date.parse(b.ends_at) > startsAt.getTime()).flatMap((b) => b.staff_ids))
    staffId = pick.eligible.find((id) => !taken.has(id)) || null
  }
  const staffName = staffId ? page.setup.staff.find((m) => m.id === staffId)?.name || null : null

  // The customer: matched to a contact by phone, or saved as a new one
  const customer = await resolveCustomer(db, page.organization.id, { contact_id: null, name: booking.name, phone: booking.phone })
  const autoApprove = page.setup.settings.auto_approve_bookings === true
  const services = pick.services.map((s) => ({
    service_id: s.id, name: s.name, price: Number(s.price) || 0, duration_minutes: Number(s.duration_minutes) || 30, tax_rate: Number(s.tax_rate) || 0,
    sac_code: (s as any).sac_code || null, staff_id: staffId, staff_name: staffName,
  }))
  // Paying online: the visit waits for its payment and holds the time meanwhile (booking-pay.ts)
  const awaiting = options.awaitingPayment
  const row = {
    organization_id: page.organization.id, contact_id: customer.contact_id, customer_name: customer.name, customer_phone: customer.phone,
    staff_id: staffId, starts_at: startsAt.toISOString(), ends_at: new Date(startsAt.getTime() + pick.minutes * 60_000).toISOString(),
    status: awaiting ? AWAITING_PAYMENT : autoApprove ? 'booked' : 'requested', services, notes: booking.note ? `Booked online · ${booking.note}` : 'Booked online', source: 'online',
    ...(awaiting ? { payment_status: 'pending', payment_amount: awaiting.amount, payment_hold_until: new Date(now + HOLD_MINUTES * 60_000).toISOString() } : {}),
  }
  const { data: appointment, error } = await withPaymentsSchema(() => db.from('salon_appointments').insert(row).select('*').single())
  if (error) throw new Error(error.message)
  return {
    appointment,
    status: awaiting ? AWAITING_PAYMENT : autoApprove ? 'booked' as const : 'requested' as const,
    staffName,
    when: `${formatIstDay(booking.date, istDate(now))}, ${formatIstTime(startsAt)}`,
  }
}
