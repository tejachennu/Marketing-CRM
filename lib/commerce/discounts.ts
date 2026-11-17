/**
 * Offers and discount codes for the shop: percent off, flat ₹ off, free delivery, buy X get Y free.
 * Each can need a code (DIWALI10) or apply by itself, need a minimum order, be for a first order only,
 * be used once per phone number, have a start and end, and a limit on total uses.
 * Pure rules with no imports: the store page shows them, the server decides them (never the browser).
 */

export type DiscountKind = 'percent' | 'flat' | 'free_delivery' | 'buy_get'

export interface Discount {
  id?: string
  title: string
  /** Upper case; null = applies by itself (an automatic offer). */
  code: string | null
  kind: DiscountKind
  /** percent: 1–100; flat: rupees; others: unused */
  value: number
  buy_qty: number
  get_qty: number
  min_order: number
  max_uses: number | null
  uses?: number
  once_per_phone: boolean
  first_order_only: boolean
  starts_at: string | null
  ends_at: string | null
  active: boolean
}

export const KIND_LABELS: Record<DiscountKind, string> = {
  percent: '% off',
  flat: '₹ off',
  free_delivery: 'Free delivery',
  buy_get: 'Buy X get Y free',
}

const clean = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const num = (v: unknown) => (v === '' || v === null || v === undefined ? NaN : Number(v))

/** A code as customers type it: letters and digits, upper case, 3–20 long. */
export function cleanCode(v: unknown): string | null {
  const code = String(v ?? '').toUpperCase().replace(/[^A-Z0-9_-]/g, '')
  return code.length >= 3 && code.length <= 20 ? code : null
}

/** The offer as typed in the dashboard, checked; or what is wrong with it in plain words. */
export function parseDiscount(raw: any): { discount: Discount } | { error: string } {
  const kind = (['percent', 'flat', 'free_delivery', 'buy_get'] as const).find((k) => k === raw?.kind)
  if (!kind) return { error: 'Choose what the offer gives.' }
  const automatic = raw?.automatic === true || raw?.code === null
  const code = automatic ? null : cleanCode(raw?.code)
  if (!automatic && !code) return { error: 'The code needs 3 to 20 letters or numbers, like DIWALI10.' }
  let value = 0
  let buy = 0
  let get = 0
  if (kind === 'percent') {
    value = num(raw?.value)
    if (!(value >= 1 && value <= 100)) return { error: 'The percent off must be between 1 and 100.' }
  } else if (kind === 'flat') {
    value = num(raw?.value)
    if (!(value > 0 && value <= 1_000_000)) return { error: 'Type how many rupees off.' }
  } else if (kind === 'buy_get') {
    buy = Math.round(num(raw?.buy_qty))
    get = Math.round(num(raw?.get_qty))
    if (!(buy >= 1 && buy <= 20 && get >= 1 && get <= 20)) return { error: 'Type how many to buy and how many free (for example buy 2, get 1).' }
  }
  const minOrder = num(raw?.min_order)
  const maxUses = num(raw?.max_uses)
  const starts = raw?.starts_at ? new Date(raw.starts_at) : null
  const ends = raw?.ends_at ? new Date(raw.ends_at) : null
  if ((starts && isNaN(starts.getTime())) || (ends && isNaN(ends.getTime()))) return { error: 'Check the start and end dates.' }
  if (starts && ends && ends <= starts) return { error: 'The end must be after the start.' }
  const title = clean(raw?.title, 80) || defaultTitle({ kind, value, buy_qty: buy, get_qty: get, min_order: minOrder > 0 ? minOrder : 0 })
  return {
    discount: {
      ...(raw?.id ? { id: String(raw.id) } : {}),
      title, code, kind, value: Math.round(value * 100) / 100, buy_qty: buy, get_qty: get,
      min_order: minOrder > 0 ? Math.round(minOrder * 100) / 100 : 0,
      max_uses: maxUses >= 1 ? Math.round(maxUses) : null,
      once_per_phone: raw?.once_per_phone === true,
      first_order_only: raw?.first_order_only === true,
      starts_at: starts ? starts.toISOString() : null,
      ends_at: ends ? ends.toISOString() : null,
      active: raw?.active !== false,
    },
  }
}

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

/** "10% off", "₹200 off on ₹999 or more", "Free delivery on ₹999 or more", "Buy 2 get 1 free". */
export function defaultTitle(d: Pick<Discount, 'kind' | 'value' | 'buy_qty' | 'get_qty' | 'min_order'>): string {
  const above = d.min_order > 0 ? ` on ${rupees(d.min_order)} or more` : ''
  if (d.kind === 'percent') return `${d.value}% off${above}`
  if (d.kind === 'flat') return `${rupees(d.value)} off${above}`
  if (d.kind === 'free_delivery') return `Free delivery${above}`
  return `Buy ${d.buy_qty} get ${d.get_qty} free${above}`
}

export interface CartForDiscount {
  /** unit price and quantity of each line */
  lines: { price: number; quantity: number }[]
  subtotal: number
  delivery: number
}

export interface DiscountContext {
  now?: number
  /** This phone already used this offer. */
  usedByPhone?: boolean
  /** This phone has ordered here before. */
  orderedBefore?: boolean
}

export type DiscountResult =
  | { ok: true; amount: number; freeDelivery: boolean; title: string; code: string | null }
  | { ok: false; reason: string }

/** Is the offer open right now (on, dated, uses left)? */
export function isOpen(d: Discount, now = Date.now()): boolean {
  if (!d.active) return false
  if (d.starts_at && Date.parse(d.starts_at) > now) return false
  if (d.ends_at && Date.parse(d.ends_at) <= now) return false
  if (d.max_uses !== null && (d.uses ?? 0) >= d.max_uses) return false
  return true
}

/** What this offer takes off this cart, or why it does not apply (in words for the shopper). */
export function applyDiscount(d: Discount, cart: CartForDiscount, ctx: DiscountContext = {}): DiscountResult {
  const now = ctx.now ?? Date.now()
  if (!d.active) return { ok: false, reason: 'This code is not active.' }
  if (d.starts_at && Date.parse(d.starts_at) > now) return { ok: false, reason: 'This offer has not started yet.' }
  if (d.ends_at && Date.parse(d.ends_at) <= now) return { ok: false, reason: 'This offer has ended.' }
  if (d.max_uses !== null && (d.uses ?? 0) >= d.max_uses) return { ok: false, reason: 'This offer has been used up.' }
  if (d.first_order_only && ctx.orderedBefore) return { ok: false, reason: 'This offer is for your first order only.' }
  if (d.once_per_phone && ctx.usedByPhone) return { ok: false, reason: 'You have already used this offer.' }
  if (d.min_order > 0 && cart.subtotal < d.min_order) return { ok: false, reason: `Add ${rupees(d.min_order - cart.subtotal)} more to use this offer (orders of ${rupees(d.min_order)} or more).` }
  let amount = 0
  let freeDelivery = false
  if (d.kind === 'percent') amount = (cart.subtotal * d.value) / 100
  else if (d.kind === 'flat') amount = Math.min(d.value, cart.subtotal)
  else if (d.kind === 'free_delivery') {
    freeDelivery = true
    if (cart.delivery <= 0) return { ok: true, amount: 0, freeDelivery, title: d.title, code: d.code }
  } else {
    // Buy X get Y: for every X + Y pieces, the Y cheapest are free
    const units = cart.lines.flatMap((l) => Array.from({ length: Math.max(0, Math.round(l.quantity)) }, () => l.price)).sort((a, b) => a - b)
    const groups = Math.floor(units.length / (d.buy_qty + d.get_qty))
    if (groups < 1) return { ok: false, reason: `Add ${d.buy_qty + d.get_qty - units.length} more item${d.buy_qty + d.get_qty - units.length === 1 ? '' : 's'} to get ${d.get_qty} free.` }
    amount = units.slice(0, groups * d.get_qty).reduce((sum, p) => sum + p, 0)
  }
  return { ok: true, amount: Math.round(Math.min(amount, cart.subtotal) * 100) / 100, freeDelivery, title: d.title, code: d.code }
}

/** What the shopper saves with this result (the discount plus a delivery charge waived). */
export function saving(result: DiscountResult, delivery: number): number {
  return result.ok ? result.amount + (result.freeDelivery ? delivery : 0) : 0
}

/** The best offer that applies by itself (no code) to this cart, if any. */
export function bestAutomatic(discounts: Discount[], cart: CartForDiscount, ctx: DiscountContext = {}): (DiscountResult & { ok: true; discount: Discount }) | null {
  let best: (DiscountResult & { ok: true; discount: Discount }) | null = null
  for (const d of discounts) {
    if (d.code !== null) continue
    const r = applyDiscount(d, cart, ctx)
    if (!r.ok) continue
    if (!best || saving(r, cart.delivery) > saving(best, cart.delivery)) best = { ...r, discount: d }
  }
  return best && saving(best, cart.delivery) > 0 ? best : null
}
