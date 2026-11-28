/**
 * Paying while booking (the website and the booking page): at the shop, online, or the customer's choice; online
 * in full or an advance (a share of the total). Kept in salon_settings.website.bookingPay. Pure (only the pure money helpers)
 * (browser-safe).
 *
 * A booking paid online is saved as 'awaiting_payment' and holds its time for HOLD_MINUTES; once paid it becomes
 * booked (or a request when the business confirms each booking). Unpaid, it lets the time go by itself.
 */

import { moneyText, screenCurrency } from '../money'

export interface BookingPay {
  /** shop = pay at the shop (no online payment), online = must pay online, choice = the customer picks */
  mode: 'shop' | 'online' | 'choice'
  /** Share paid online, in percent: 100 = the full amount, less = an advance */
  advance: number
}

export const DEFAULT_BOOKING_PAY: BookingPay = { mode: 'shop', advance: 100 }
export const ADVANCE_CHOICES = [10, 20, 25, 30, 50, 100]
/** How long an unpaid online booking holds its time (Stripe's payment page lasts at least 30 minutes). */
export const HOLD_MINUTES = 30
export const AWAITING_PAYMENT = 'awaiting_payment'

export function readBookingPay(raw: unknown): BookingPay {
  const v: any = raw && typeof raw === 'object' ? raw : {}
  const advance = Math.round(Number(v.advance))
  return {
    mode: v.mode === 'online' || v.mode === 'choice' ? v.mode : 'shop',
    advance: advance >= 5 && advance <= 100 ? advance : 100,
  }
}

/** What is paid online for a booking of this total: the full total, or the advance rounded up to whole rupees. */
export function amountOnline(total: number, advance: number): number {
  const sum = Math.max(0, Number(total) || 0)
  if (advance >= 100) return Math.round(sum * 100) / 100
  return Math.min(Math.round(sum * 100) / 100, Math.ceil((sum * advance) / 100))
}

/**
 * The ways a customer can pay for a booking of this total. Online needs a connected gateway and something to pay
 * (at least ₹1); the shop is always offered when online is not possible, so there is never no way to book.
 */
export function bookingPayOptions(pay: BookingPay, gatewayOn: boolean, total: number): { online: boolean; atShop: boolean; amount: number; full: boolean } {
  const amount = amountOnline(total, pay.advance)
  const online = gatewayOn && pay.mode !== 'shop' && amount >= 1
  return { online, atShop: !online || pay.mode !== 'online', amount: online ? amount : 0, full: online && amount >= Math.round(total * 100) / 100 }
}

export interface PaidBooking {
  status?: string | null
  payment_status?: string | null
  payment_amount?: number | string | null
  payment_paid?: number | string | null
  services?: { price?: number | string | null }[] | null
}

const rupees = (n: number, currency?: string) => moneyText(n, currency || screenCurrency())

/** The visit's price from its services. */
export function bookingTotal(b: PaidBooking): number {
  return Math.round((b.services || []).reduce((s, x) => s + (Number(x?.price) || 0), 0) * 100) / 100
}

/** "Paid ₹800 online", "₹200 paid online · ₹600 at the shop", "Waiting for payment", "" (nothing paid online). */
export function paymentNote(b: PaidBooking, currency?: string): string {
  const paid = Number(b.payment_paid) || 0
  if (b.status === AWAITING_PAYMENT || b.payment_status === 'pending') return 'Waiting for online payment'
  if (b.payment_status !== 'paid' || paid <= 0) return ''
  const rest = Math.round((bookingTotal(b) - paid) * 100) / 100
  return rest > 0 ? `${rupees(paid, currency)} paid online · ${rupees(rest, currency)} at the shop` : `Paid ${rupees(paid, currency)} online`
}

/** The advance a bill takes off: what was paid online for the visit, never more than the bill. */
export function advanceForBill(paid: unknown, billTotal: number): number {
  return Math.max(0, Math.min(Number(paid) || 0, Number(billTotal) || 0))
}
