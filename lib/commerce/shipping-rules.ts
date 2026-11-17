/**
 * Delivery partners (Shiprocket, Delhivery): the rules with no network or database code, safe in the
 * browser and in tests. What a courier's status means for us and for the order, what the customer is told,
 * the parcel's weight and size, and how rate options are compared.
 *
 * Status codes and names come from the partners' official API docs (read 17 Nov 2026):
 * Shiprocket "Status Codes" (apidocs.shiprocket.in) and Delhivery "Package Lifecycle"
 * (delhivery-express-api-doc.readme.io).
 */

export type ShippingProvider = 'shiprocket' | 'delhivery'
export const SHIPPING_PROVIDERS: ShippingProvider[] = ['shiprocket', 'delhivery']
export const PROVIDER_NAMES: Record<ShippingProvider, string> = { shiprocket: 'Shiprocket', delhivery: 'Delhivery' }

/** Where a parcel is, in our own words (the same for every partner). */
export type ShipmentStatus =
  | 'booked'
  | 'pickup_scheduled'
  | 'picked_up'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'undelivered'
  | 'returning'
  | 'returned'
  | 'cancelled'
  | 'lost'

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  booked: 'Booked',
  pickup_scheduled: 'Pickup booked',
  picked_up: 'Picked up',
  in_transit: 'On the way',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  undelivered: 'Not delivered',
  returning: 'Coming back to you',
  returned: 'Returned to you',
  cancelled: 'Cancelled',
  lost: 'Lost or damaged',
}

/** No more updates will come for these. */
export const FINAL_SHIPMENT_STATUSES: ShipmentStatus[] = ['delivered', 'returned', 'cancelled', 'lost']
/** These need the shopkeeper to look (shown in red). */
export const ATTENTION_SHIPMENT_STATUSES: ShipmentStatus[] = ['undelivered', 'returning', 'returned', 'lost']

/** Shiprocket's status ids (current_status_id / shipment_status / "sr-status"). */
const SHIPROCKET_IDS: Record<number, ShipmentStatus> = {
  1: 'booked', 2: 'booked', 3: 'pickup_scheduled', 4: 'pickup_scheduled', 5: 'pickup_scheduled', 6: 'in_transit',
  7: 'delivered', 8: 'cancelled', 9: 'returning', 10: 'returned', 11: 'booked', 12: 'lost', 13: 'pickup_scheduled',
  14: 'returned', 15: 'pickup_scheduled', 16: 'cancelled', 17: 'out_for_delivery', 18: 'in_transit', 19: 'pickup_scheduled',
  20: 'pickup_scheduled', 21: 'undelivered', 22: 'in_transit', 23: 'delivered', 24: 'lost', 25: 'lost', 26: 'delivered',
  38: 'in_transit', 39: 'in_transit', 40: 'returning', 41: 'returning', 42: 'picked_up', 43: 'delivered', 44: 'lost',
  45: 'cancelled', 46: 'returning', 47: 'cancelled', 48: 'in_transit', 50: 'in_transit', 51: 'picked_up', 52: 'booked',
  54: 'in_transit', 59: 'booked',
}

/** A status by its words, when a partner sends no number (or one we do not know). */
export function statusFromWords(words: unknown): ShipmentStatus | null {
  const s = String(words ?? '').toLowerCase().replace(/[_-]+/g, ' ').trim()
  if (!s) return null
  if (/\brto\b|return/.test(s)) return /deliver|received|acknowledg/.test(s) ? 'returned' : 'returning'
  if (/cancel/.test(s)) return 'cancelled'
  if (/lost|damage|destroy|dispos/.test(s)) return 'lost'
  if (/undeliver|not delivered|failed|ndr/.test(s)) return 'undelivered'
  if (/out for delivery|\bofd\b|dispatched/.test(s)) return 'out_for_delivery'
  if (/delivered|fulfilled/.test(s)) return 'delivered'
  if (/picked up|pickup done|handover|shipped/.test(s)) return 'picked_up'
  if (/pickup|manifest|scheduled|queued|out for pickup/.test(s)) return 'pickup_scheduled'
  if (/transit|pending|reached|misrout|delayed|in flight/.test(s)) return 'in_transit'
  if (/awb|booked|label|new|open|packing/.test(s)) return 'booked'
  return null
}

export function shiprocketStatus(id: unknown, words?: unknown): ShipmentStatus | null {
  const n = Number(id)
  if (Number.isFinite(n) && SHIPROCKET_IDS[n]) return SHIPROCKET_IDS[n]
  return statusFromWords(words)
}

/**
 * Delhivery: StatusType (UD moving / undelivered, DL delivered, RT returned, CN cancelled, PP/PU pickups)
 * with Status ("Manifested", "In Transit", "Pending", "Dispatched", "Delivered", "RTO"…).
 */
export function delhiveryStatus(statusType: unknown, status: unknown): ShipmentStatus | null {
  const type = String(statusType ?? '').toUpperCase().trim()
  const s = String(status ?? '').toLowerCase().trim()
  if (type === 'DL') return /rto|return|dto/.test(s) ? 'returned' : 'delivered'
  if (type === 'RT') return /deliver|dto/.test(s) ? 'returned' : 'returning'
  if (type === 'CN') return 'cancelled'
  if (type === 'UD' || !type) {
    if (/manifest|not picked|open/.test(s)) return 'booked'
    if (/scheduled/.test(s)) return 'pickup_scheduled'
    if (/dispatched/.test(s)) return 'out_for_delivery'
    if (/in transit|pending|reached/.test(s)) return 'in_transit'
  }
  return statusFromWords(status)
}

/** How far along each status is: an older, lower update never moves a parcel back. */
const RANK: Record<ShipmentStatus, number> = {
  booked: 1, pickup_scheduled: 2, picked_up: 3, in_transit: 4, out_for_delivery: 5, undelivered: 5,
  returning: 6, delivered: 9, returned: 9, cancelled: 9, lost: 9,
}

/** Should `next` replace `current`? Final statuses never change; otherwise only forward (or sideways). */
export function shouldMoveTo(current: ShipmentStatus | null | undefined, next: ShipmentStatus): boolean {
  if (!current) return true
  if (current === next) return false
  if (FINAL_SHIPMENT_STATUSES.includes(current)) return false
  // Out for delivery and not delivered take turns while the courier tries again
  if ((current === 'undelivered' && next === 'out_for_delivery') || (current === 'out_for_delivery' && next === 'undelivered')) return true
  return RANK[next] >= RANK[current]
}

/** What the order becomes when its parcel reaches this status (null = leave the order as it is). */
export function orderStatusFor(status: ShipmentStatus, orderStatus: string): 'shipped' | 'delivered' | null {
  if (status === 'delivered') return orderStatus === 'delivered' || orderStatus === 'canceled' ? null : 'delivered'
  if (['picked_up', 'in_transit', 'out_for_delivery', 'undelivered'].includes(status)) {
    return orderStatus === 'paid' || orderStatus === 'cod_confirmed' ? 'shipped' : null
  }
  return null
}

/** The courier's own page where anyone can follow the parcel. */
export function trackingLink(provider: ShippingProvider, awb: string | null | undefined): string | null {
  const code = String(awb || '').trim()
  if (!/^[A-Za-z0-9-]{4,40}$/.test(code)) return null
  return provider === 'shiprocket'
    ? `https://shiprocket.co/tracking/${code}`
    : `https://www.delhivery.com/track/package/${code}`
}

/** Which message the customer gets for this status (each one is sent once per parcel). */
export type CustomerNotice = 'on_the_way' | 'out_for_delivery' | 'delivered' | 'undelivered'
export function noticeFor(status: ShipmentStatus): CustomerNotice | null {
  if (status === 'picked_up' || status === 'in_transit') return 'on_the_way'
  if (status === 'out_for_delivery') return 'out_for_delivery'
  if (status === 'delivered') return 'delivered'
  if (status === 'undelivered') return 'undelivered'
  return null
}

/** The WhatsApp words for each notice, in plain English. */
export function noticeText(notice: CustomerNotice, info: { orderNumber: string; courier?: string | null; link?: string | null; expected?: string | null }): string {
  const order = `#${info.orderNumber}`
  const via = info.courier ? ` with ${info.courier}` : ''
  const track = info.link ? `\nTrack it here: ${info.link}` : ''
  switch (notice) {
    case 'on_the_way':
      return `Your order ${order} is on the way${via}.${info.expected ? ` Expected by ${info.expected}.` : ''}${track}`
    case 'out_for_delivery':
      return `Your order ${order} is out for delivery today. Please keep your phone close.${track}`
    case 'delivered':
      return `Your order ${order} has been delivered. Thank you for shopping with us! Reply here if anything is not right.`
    case 'undelivered':
      return `The courier could not deliver your order ${order} today. Reply here with a good time or a correct address and we will sort it out.${track}`
  }
}

/** A 6-digit Indian PIN code, or null. */
export function cleanPin(value: unknown): string | null {
  const s = String(value ?? '').replace(/\s+/g, '')
  return /^[1-9]\d{5}$/.test(s) ? s : null
}

export interface ParcelDefaults {
  weight_grams: number
  length_cm: number
  breadth_cm: number
  height_cm: number
}
export const DEFAULT_PARCEL: ParcelDefaults = { weight_grams: 500, length_cm: 20, breadth_cm: 15, height_cm: 10 }

export function cleanParcel(raw: any): ParcelDefaults {
  const num = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 10) / 10 : fallback
  }
  return {
    weight_grams: Math.round(num(raw?.weight_grams, 10, 100000, DEFAULT_PARCEL.weight_grams)),
    length_cm: num(raw?.length_cm, 1, 300, DEFAULT_PARCEL.length_cm),
    breadth_cm: num(raw?.breadth_cm, 1, 300, DEFAULT_PARCEL.breadth_cm),
    height_cm: num(raw?.height_cm, 1, 300, DEFAULT_PARCEL.height_cm),
  }
}

/**
 * The parcel for an order: each line's product weight × quantity (products without a weight count as the
 * default parcel weight once, not per piece), at least 50 g; the box is the default box.
 */
export function parcelFor(items: { quantity?: unknown; weight_grams?: unknown }[], defaults: ParcelDefaults): ParcelDefaults {
  let grams = 0
  let unknown = false
  for (const item of items) {
    const qty = Math.max(1, Math.round(Number(item.quantity) || 1))
    const w = Number(item.weight_grams)
    if (Number.isFinite(w) && w > 0) grams += w * qty
    else unknown = true
  }
  if (unknown) grams += defaults.weight_grams
  return { ...defaults, weight_grams: Math.max(50, Math.round(grams)) }
}

/** One way to send a parcel, from any partner, in the same shape. */
export interface RateOption {
  provider: ShippingProvider
  /** Shiprocket's courier_company_id; Delhivery's mode (S surface / E express). */
  courierId: string
  courierName: string
  price: number
  codCharge: number
  days: number | null
  etd: string | null
  rating: number | null
  cod: boolean
  recommended?: boolean
}

/** Cheapest first; then mark the cheapest and the fastest. */
export function sortRates(options: RateOption[]): (RateOption & { cheapest?: boolean; fastest?: boolean })[] {
  const list = options
    .filter((o) => Number.isFinite(o.price) && o.price >= 0 && o.courierName)
    .sort((a, b) => a.price - b.price || (a.days ?? 99) - (b.days ?? 99))
    .map((o) => ({ ...o }))
  if (!list.length) return list
  ;(list[0] as any).cheapest = true
  const withDays = list.filter((o) => o.days !== null)
  if (withDays.length) {
    const fastest = withDays.reduce((best, o) => ((o.days as number) < (best.days as number) || ((o.days === best.days) && o.price < best.price) ? o : best))
    ;(fastest as any).fastest = true
  }
  return list
}

/** "Ravi Kumar" → { first: "Ravi", last: "Kumar" } (partners ask for both). */
export function splitName(name: unknown): { first: string; last: string } {
  const parts = String(name ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  if (!parts.length) return { first: 'Customer', last: '' }
  return { first: parts[0].slice(0, 50), last: parts.slice(1).join(' ').slice(0, 50) }
}

/** Last 10 digits of an Indian phone number (what the partners want). */
export function tenDigits(phone: unknown): string | null {
  const digits = String(phone ?? '').replace(/\D/g, '')
  const last = digits.slice(-10)
  return /^[6-9]\d{9}$/.test(last) ? last : null
}

/** Delhivery refuses & # % ; and backslash in its shipment data. */
export function delhiverySafe(value: unknown, max = 200): string {
  return String(value ?? '').replace(/[&#%;\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

/** Is the order ready to hand to a courier? (A reason in plain words when it is not.) */
export function shipBlocker(order: { status?: string; shipping_address?: any; payment_method?: string | null }): string | null {
  if (!['paid', 'cod_confirmed', 'shipped'].includes(String(order.status))) return 'Only paid or Cash on Delivery orders can be sent with a courier.'
  const a = order.shipping_address || {}
  if (a.handover === 'pickup' || a.handover === 'now') return 'This order is picked up from the shop, so there is nothing to send.'
  if (!String(a.address_line_1 || '').trim() || !String(a.city || '').trim()) return 'This order has no delivery address yet.'
  if (!cleanPin(a.pincode)) return 'The delivery address needs a 6-digit PIN code.'
  if (!tenDigits(a.phone_number)) return 'The delivery address needs the customer\'s 10-digit mobile number.'
  return null
}
