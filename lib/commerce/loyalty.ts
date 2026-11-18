/**
 * Loyalty points for the shop. Pure and browser-safe; the database side is in loyalty-store.ts.
 *
 * - Customers get points back on delivered orders: `percent` of what they paid (₹1,000 at 5% = 50 points).
 * - 1 point = ₹1 off a later order. They can use them once they have `minUse` points, for at most
 *   `maxPercent`% of an order (after any offer). Points are kept by phone number (last 10 digits).
 * - Using points needs a signed-in shopper whose saved phone is the order's phone, so nobody spends
 *   someone else's points by typing their number.
 */

export interface LoyaltySettings {
  on: boolean
  /** Points back as a percent of what the customer paid */
  percent: number
  /** Points needed before they can be used */
  minUse: number
  /** At most this percent of an order can be paid with points */
  maxPercent: number
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(value))
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback
}

export function readLoyaltySettings(raw: unknown): LoyaltySettings {
  const s = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const percent = Number(s.percent)
  return {
    on: s.on === true,
    percent: Number.isFinite(percent) && percent > 0 && percent <= 50 ? round2(percent) : 2,
    minUse: clampInt(s.minUse, 0, 100000, 50),
    maxPercent: clampInt(s.maxPercent, 1, 100, 50),
  }
}

export const phoneKey = (phone: unknown) => String(phone ?? '').replace(/\D/g, '').slice(-10)

/** Points earned on an order (whole points, rounded down). */
export function pointsEarned(paid: number, settings: LoyaltySettings): number {
  if (!settings.on) return 0
  return Math.max(0, Math.floor((Math.max(0, Number(paid) || 0) * settings.percent) / 100))
}

/** How many points this order can use (0 when not allowed), given the balance and the amount after offers. */
export function pointsUsable(balance: number, orderAmount: number, settings: LoyaltySettings): number {
  if (!settings.on || balance < Math.max(1, settings.minUse)) return 0
  const cap = Math.floor((Math.max(0, orderAmount) * settings.maxPercent) / 100)
  return Math.max(0, Math.min(Math.floor(balance), cap))
}

/** "Get 2% back as points. 1 point = ₹1." for the store page. */
export function loyaltyLine(settings: LoyaltySettings): string {
  return settings.on ? `Get ${settings.percent}% back as points on every order. 1 point = ₹1 off your next order.` : ''
}
