/**
 * New bookings customers made themselves (on the website / booking page, on WhatsApp, or through the API), for the
 * "New bookings from customers" card on the counter and in the app. A booking for another day was easy to miss: the
 * counter shows one day at a time. Pure and browser-safe.
 */

import { formatIstDay, formatIstTime, istDate } from './spoken'

/** Where a booking came from when the customer made it themselves. */
export const SELF_BOOKED_SOURCES = ['online', 'chat', 'api'] as const

/** How long a new booking stays on the card (unless marked seen). */
export const FRESH_HOURS = 72

export function sourceLabel(source: unknown): string {
  return source === 'online' ? 'Website' : source === 'chat' ? 'WhatsApp' : source === 'api' ? 'Your app' : 'Counter'
}

export interface FreshBooking {
  id: string
  customer_name: string | null
  starts_at: string
  created_at: string
  source: string | null
  status: string
  services?: { name?: string }[] | null
}

/** "Sat, 28 Nov, 10:30 am" (or "Tomorrow, 10:30 am") */
export function bookingWhen(startsAt: string, now: Date | number = Date.now()): string {
  return `${formatIstDay(istDate(startsAt), istDate(now))}, ${formatIstTime(startsAt)}`
}

/**
 * The bookings to show: made by customers in the last FRESH_HOURS, still to come, booked (requests have their own
 * card), not already seen on this device; newest first.
 */
export function freshBookings<T extends FreshBooking>(rows: T[], now: Date | number = Date.now(), seen: string[] = []): T[] {
  const time = typeof now === 'number' ? now : now.getTime()
  const since = time - FRESH_HOURS * 3_600_000
  const today = istDate(time)
  const hidden = new Set(seen)
  return rows
    .filter((a) => (SELF_BOOKED_SOURCES as readonly string[]).includes(String(a.source)) && a.status === 'booked'
      && Date.parse(a.created_at) >= since && istDate(a.starts_at) >= today && !hidden.has(a.id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/** "Haircut, Beard trim" */
export function serviceNames(a: { services?: { name?: string }[] | null }): string {
  return (Array.isArray(a.services) ? a.services : []).map((s) => s?.name).filter(Boolean).join(', ')
}
