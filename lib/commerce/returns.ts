/**
 * Returns and refunds for shop orders. Pure and browser-safe; the database and Razorpay side is in
 * returns-store.ts.
 *
 * - A customer can ask to return a delivered order within the shop's return window (days after delivery).
 *   The ask is kept on the order (`shipping_address.return`): asked → accepted / declined → refunded.
 * - The shop refunds from the order page: all or part of what was paid. Paid online through the shop's own
 *   Razorpay → the money goes back through Razorpay; otherwise the shop pays back by hand and it is recorded.
 */

export const RETURN_REASONS = ['Wrong size or fit', 'Damaged or broken', 'Not as shown', 'Wrong item sent', 'Changed my mind', 'Something else'] as const

export interface ReturnSettings {
  /** Customers can ask for a return in My orders */
  on: boolean
  /** Days after delivery */
  days: number
}

export type ReturnStatus = 'asked' | 'accepted' | 'declined' | 'refunded'

export interface ReturnRequest {
  status: ReturnStatus
  reason: string
  note: string
  asked_at: string
  decided_at?: string | null
  decline_note?: string | null
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const text = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

export function readReturnSettings(raw: unknown): ReturnSettings {
  const s = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const days = Math.round(Number(s.days))
  return { on: s.on === true, days: Number.isFinite(days) && days >= 1 && days <= 60 ? days : 7 }
}

export function readReturn(order: any): ReturnRequest | null {
  const r = order?.shipping_address?.return
  return r && typeof r === 'object' && ['asked', 'accepted', 'declined', 'refunded'].includes(r.status) ? r : null
}

/** When the order was delivered (null when it was not). */
export function deliveredAt(order: any): string | null {
  if (order?.status !== 'delivered') return null
  return order.shipping_address?.delivered_at || order.updated_at || order.created_at || null
}

/** Can the customer ask to return this order now? Says why not, in plain words. */
export function returnChance(order: any, settings: ReturnSettings, now: Date = new Date()): { ok: true; until: string } | { ok: false; reason: string } {
  if (!settings.on) return { ok: false, reason: 'This shop does not take returns online. Please call or message the shop.' }
  if (readReturn(order)) return { ok: false, reason: 'A return was already asked for this order.' }
  const at = deliveredAt(order)
  if (!at) return { ok: false, reason: 'You can ask for a return once the order is delivered.' }
  const until = new Date(new Date(at).getTime() + settings.days * 86_400_000)
  if (now > until) return { ok: false, reason: `Returns are taken within ${settings.days} days of delivery.` }
  return { ok: true, until: until.toISOString() }
}

export function cleanReturnRequest(body: any, now: Date = new Date()): ReturnRequest | { error: string } {
  const reason = text(body?.reason, 60)
  if (!(RETURN_REASONS as readonly string[]).includes(reason)) return { error: 'Choose why you are returning it.' }
  const note = text(body?.note, 500)
  if (reason === 'Something else' && !note) return { error: 'Tell the shop a few words about the problem.' }
  return { status: 'asked', reason, note, asked_at: now.toISOString() }
}

/** What has been paid and can still go back. */
export function refundable(order: any, refunds: { amount: unknown; status?: string }[] = []): { paid: number; refunded: number; left: number } {
  const paid = order?.payment_status === 'paid' || order?.payment_status === 'refunded' ? round2(Number(order.total_amount) || 0) : 0
  const refunded = round2(refunds.filter((r) => r.status !== 'failed').reduce((sum, r) => sum + (Number(r.amount) || 0), 0))
  return { paid, refunded, left: round2(Math.max(0, paid - refunded)) }
}

export function parseRefund(body: any, left: number): { amount: number; reason: string; restock: boolean } | { error: string } {
  if (left <= 0) return { error: 'Nothing is left to refund on this order.' }
  const amount = round2(Number(body?.amount))
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Type the amount to refund.' }
  if (amount > left) return { error: `At most ${left} can be refunded on this order.` }
  return { amount, reason: text(body?.reason, 200), restock: body?.restock === true }
}

export const RETURN_LABELS: Record<ReturnStatus, string> = {
  asked: 'Return asked',
  accepted: 'Return accepted',
  declined: 'Return declined',
  refunded: 'Returned and refunded',
}
