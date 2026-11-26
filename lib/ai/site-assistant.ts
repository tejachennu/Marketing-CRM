/**
 * The website AI assistants (the online store's chat and the Front Desk website's chat): what the business's own data
 * says, written as facts for the AI; questions that are answered straight from the data with no AI at all ("where is
 * my order", "my booking"); and a check that every amount the AI writes is one the data really has.
 * Pure, no database (browser-safe); the chat routes do the reading.
 */

import type { KnowledgeHit } from './knowledge-rules'

const rupees = (n: number, currency = 'INR') => (currency === 'INR' ? `₹${(Math.round(Number(n) * 100) / 100).toLocaleString('en-IN')}` : `${currency} ${n}`)
const oneLine = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

// ── Questions answered from the data ────────────────────────────────────────

/** "Where is my order?", "order status", "naa order ekkada", "mera order kab aayega" … */
export function asksAboutOrder(text: string): boolean {
  const t = ` ${String(text || '').toLowerCase()} `
  return /\b(where('?s| is)? (is )?my (order|parcel|package|delivery)|order status|status of (my )?order|track(ing)? (my |the )?(order|parcel|package)|track order|my order|order (no|number|id)|when will (my |the )?(order|parcel|package|it) (arrive|come|reach|be delivered)|not (yet )?(received|delivered|got)|delivery status|did you (ship|send)|has it (been )?shipped|naa order|order ekkada|order eppudu|mera order|order kab|order kaha|order kidhar)\b/.test(t)
    || /\bORD-?\d{6}-?[A-Z2-9]{4}\b/i.test(t)
}

/** "my booking", "my appointment", "when is my slot" … */
export function asksAboutBooking(text: string): boolean {
  const t = ` ${String(text || '').toLowerCase()} `
  return /\b(my (booking|appointment|slot|visit|reservation)s?|booking status|appointment (status|time)|when is my (booking|appointment|slot|visit)|did (my|the) booking|is my booking|check (my )?(booking|appointment)|naa booking|naa appointment|meri booking|mera appointment)\b/.test(t)
}

/** The store's order number in a text: ORD-261118-ABCD (dashes optional), upper-cased with dashes. */
export function findOrderNumber(text: string): string | null {
  const m = String(text || '').toUpperCase().match(/\bORD-?(\d{6})-?([A-HJ-NP-Z2-9]{4})\b/)
  return m ? `ORD-${m[1]}-${m[2]}` : null
}

/** A phone number in a text (10 to 13 digits, spaces / dashes / + allowed); the digits. Order numbers are skipped. */
export function findPhone(text: string): string | null {
  const cleaned = String(text || '').toUpperCase().replace(/\bORD-?\d{6}-?[A-Z2-9]{4}\b/g, ' ')
  for (const m of cleaned.matchAll(/\+?\d[\d\s-]{8,16}\d/g)) {
    const digits = m[0].replace(/\D/g, '')
    if (digits.length >= 10 && digits.length <= 13) return digits
  }
  return null
}

/** A first name given in a text like "name Priya", "I am Priya", "Priya, 9876543210". */
export function findName(text: string): string | null {
  const t = String(text || '').trim()
  const said = t.match(/\b(?:name(?: is)?|i am|i'm|this is|naa peru|mera naam)\s*[:\-]?\s*([A-Za-z][A-Za-z.' ]{1,40})/i)
  if (said) return said[1].trim().split(/\s+/)[0]
  // "Priya 98765 43210" or "Priya, +91 98765 43210"
  const before = t.replace(/\+?\d[\d\s-]{8,16}\d/g, ' ').replace(/[,;]/g, ' ').trim()
  return /^[A-Za-z][A-Za-z.']{1,30}(\s+[A-Za-z.']{1,30})?$/.test(before) ? before.split(/\s+/)[0] : null
}

/** The order number, phone and name the customer gave, newest first, in this message or earlier ones. */
export function detailsGiven(message: string, history: { role: string; content: string }[]): { orderNumber: string | null; phone: string | null; name: string | null } {
  const theirs = [message, ...history.filter((m) => m.role === 'user').map((m) => m.content).reverse()].slice(0, 6)
  const first = <T>(read: (t: string) => T | null) => { for (const t of theirs) { const v = read(t); if (v) return v } return null }
  return { orderNumber: first(findOrderNumber), phone: first(findPhone), name: first(findName) }
}

export interface OrderSummary {
  number: string
  status: string
  placedAt: string | null
  payment: string
  handover: string
  total: number
  currency: string
  items: { title: string; quantity: number }[]
  tracking: { number: string; carrier: string } | null
  timeline: { key: string; label: string; state: string; at: string | null }[]
}

const dayWords = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(Date.parse(iso) + 330 * 60_000)
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`
}

/** The answer to "where is my order", written from the order itself (no AI, so it is always right). */
export function orderReply(order: OrderSummary): string {
  const items = order.items.slice(0, 3).map((i) => `${i.quantity} × ${i.title}`).join(', ') + (order.items.length > 3 ? ` and ${order.items.length - 3} more` : '')
  const lines = [
    `Order ${order.number}: *${order.status}*.`,
    `${order.placedAt ? `Placed on ${dayWords(order.placedAt)}. ` : ''}${items ? `${items}. ` : ''}Total ${rupees(order.total, order.currency)} (${order.payment.toLowerCase()}).`,
    order.tracking ? `Courier: ${order.tracking.carrier || 'courier'}, tracking number ${order.tracking.number}.` : '',
    order.status === 'Cancelled' || /cancel/i.test(order.status) ? 'If you have a question about it, message the shop on WhatsApp.' : '',
  ]
  return lines.filter(Boolean).join('\n')
}

// ── Facts for the AI ────────────────────────────────────────────────────────

export interface StoreFactsInput {
  name: string
  currency: string
  pickup: boolean
  delivery: boolean
  deliveryNote?: string
  fee: number
  freeFrom: number
  minOrder: number
  payOnline: boolean
  payLater: boolean
  payMethods?: string
  returns?: { on: boolean; days: number }
  loyalty?: { on: boolean; percent: number }
  offers?: { title: string; min_order?: number }[]
  hasCodes?: boolean
  categories: string[]
  productCount: number
  phone?: string
  whatsapp?: string
  address?: string
  about?: string
  /** The store's own info pages (shipping, returns, terms …) */
  pages?: Partial<Record<string, string>>
  pinCheck?: boolean
}

/** Everything the store's own settings say, as true facts for the AI. */
export function storeFacts(s: StoreFactsInput): string {
  const money = (n: number) => rupees(n, s.currency)
  const lines = [
    `- Online store of ${s.name}. ${s.productCount} products in: ${s.categories.slice(0, 30).join(', ') || 'one list'}.`,
    `- Getting the order: ${[s.delivery && 'home delivery', s.pickup && 'pick up from the shop'].filter(Boolean).join(' or ') || 'ask the shop'}.`,
    s.delivery ? `- Delivery charge: ${s.fee > 0 ? money(s.fee) : 'free'}${s.fee > 0 && s.freeFrom > 0 ? `; free delivery on orders of ${money(s.freeFrom)} or more` : ''}.` : '',
    s.deliveryNote ? `- Delivery note from the shop: ${oneLine(s.deliveryNote, 300)}` : '',
    s.pinCheck ? '- Customers can check delivery to their PIN code on any product page.' : '',
    s.minOrder > 0 ? `- Minimum order: ${money(s.minOrder)}.` : '- No minimum order.',
    `- Paying: ${[s.payOnline && `pay online now (${s.payMethods || 'online'})`, s.payLater && (s.delivery ? 'cash on delivery' : 'pay at pick up')].filter(Boolean).join(' or ')}.`,
    s.returns ? (s.returns.on ? `- Returns: customers can ask for a return within ${s.returns.days} days of delivery, from My orders on this website.` : '- Returns: not taken online; ask the shop.') : '',
    s.loyalty?.on ? `- Loyalty points: ${s.loyalty.percent}% of what you pay comes back as points for signed-in customers, usable on later orders.` : '',
    s.offers?.length ? `- Offers that apply by themselves: ${s.offers.slice(0, 6).map((o) => `${o.title}${o.min_order ? ` (orders of ${money(o.min_order)} or more)` : ''}`).join('; ')}.` : '',
    s.hasCodes ? '- Discount codes are entered at checkout ("Have a code?"). Never make up a code.' : '',
    '- Order status: customers can track an order here with the order number (like ORD-261118-ABCD) and the phone number used, or in My orders when signed in.',
    s.phone ? `- Shop phone: ${s.phone}` : '',
    s.whatsapp ? `- Shop WhatsApp: ${s.whatsapp}` : '',
    s.address ? `- Shop address: ${oneLine(s.address, 200)}` : '',
    s.about ? `- About the shop: ${oneLine(s.about, 500)}` : '',
    ...Object.entries(s.pages || {}).filter(([, text]) => text && String(text).trim()).slice(0, 6)
      .map(([key, text]) => `- The shop's ${key} page says: ${oneLine(text, 700)}`),
  ]
  return lines.filter(Boolean).join('\n')
}

export interface DeskService { id: string; name: string; category: string; price: number; minutes: number }

export interface DeskFactsInput {
  business: string
  address?: string | null
  phone?: string | null
  /** "Open 10 am to 9 pm, closed Tuesday" */
  hours: string
  /** "Open now · closes 9 pm" */
  openNow?: string
  week?: { day: string; time: string }[]
  services: DeskService[]
  staff: { name: string; service_ids: string[] }[]
  approval: boolean
  pay?: { mode: string; advance: number; online: boolean; methods: string }
  plans?: { name: string; price: number; validity_days?: number; discount_percent?: number; credit?: number; sessions?: { name: string; count: number }[] }[]
  about?: string
  rating?: { average: number; count: number }
  showPrices?: boolean
  /** The business takes appointments (Front Desk → Setup → Appointments); false: walk-in only, no booking */
  bookings?: boolean
  /** The website shows its Book buttons and booking form (false: bookings by WhatsApp or phone only) */
  bookOnSite?: boolean
  /** The shop's coming holidays (closed): "Diwali 8 to 10 Nov" */
  holidays?: { name: string; when: string }[]
}

function planLine(p: NonNullable<DeskFactsInput['plans']>[number]): string {
  const gets = [p.credit ? `${rupees(p.credit)} to spend` : '', ...(p.sessions || []).map((x) => `${x.count} × ${x.name}`), p.discount_percent ? `${p.discount_percent}% off services` : '', p.validity_days ? `valid ${p.validity_days} days` : ''].filter(Boolean)
  return `${p.name} ${rupees(p.price)}${gets.length ? ` (${gets.join(', ')})` : ''}`
}

const duration = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`)

/** Everything the business's Front Desk data says, as true facts for the AI: hours, every service with its price and length, team, memberships, booking and paying. */
export function deskFacts(d: DeskFactsInput): string {
  const showPrices = d.showPrices !== false
  const byCategory = new Map<string, DeskService[]>()
  for (const s of d.services) byCategory.set(s.category || 'General', [...(byCategory.get(s.category || 'General') || []), s])
  const menu = [...byCategory.entries()].map(([cat, list]) => `  ${cat}: ${list.slice(0, 60).map((s) => `${s.name} (${showPrices && s.price > 0 ? `${rupees(s.price)}, ` : ''}${duration(s.minutes)})`).join('; ')}`)
  const serviceName = new Map(d.services.map((s) => [s.id, s.name]))
  const pay = d.pay
  const bookings = d.bookings !== false
  const lines = [
    `- Business: ${d.business}.`,
    `- Opening hours: ${d.hours}.`,
    d.week?.length ? `- Each day: ${d.week.map((w) => `${w.day} ${w.time}`).join('; ')}.` : '',
    d.openNow ? `- Right now: ${d.openNow}.` : '',
    d.holidays?.length ? `- Closed for holidays (no bookings, the shop is shut): ${d.holidays.map((h) => `${h.name} (${h.when})`).join('; ')}.` : '',
    d.address ? `- Address: ${oneLine(d.address, 200)}` : '',
    d.phone ? `- Phone: ${d.phone}` : '',
    `- Services${showPrices ? ' and prices' : ''} (the full list; nothing else is offered):\n${menu.join('\n')}`,
    showPrices ? '' : '- Prices are not shown online: say the shop will tell the price, or the customer can call.',
    d.staff.length ? `- Team: ${d.staff.map((m) => `${m.name}${m.service_ids.length ? ` (does ${m.service_ids.map((id) => serviceName.get(id)).filter(Boolean).slice(0, 6).join(', ')})` : ' (does every service)'}`).join('; ')}.` : '',
    bookings && d.bookOnSite === false
      ? `- Booking: not on this website. Customers book by ${d.phone ? 'calling or messaging the business on WhatsApp' : 'messaging the business'}. Never promise a time.`
      : bookings
      ? `- Booking: customers book on this website (tap Book, pick services, a person or anyone, a day and a free time). ${d.approval ? 'The business confirms each booking on WhatsApp.' : 'Bookings are confirmed at once on WhatsApp.'} Free times change all the time: never promise a time; ask them to tap Book to see free times.`
      : `- No appointments: this business does not take bookings. Customers just walk in during the opening hours${d.phone ? ' or call' : ''}. Never offer to book a time.`,
    pay && bookings && d.bookOnSite !== false ? `- Paying for a booking: ${!pay.online ? 'at the shop after the visit (cash, UPI or card).' : pay.mode === 'online' ? `online when booking (${pay.advance >= 100 ? 'the full amount' : `a ${pay.advance}% advance, the rest at the shop`}; ${pay.methods}).` : `online when booking (${pay.advance >= 100 ? 'full amount' : `${pay.advance}% advance`}, ${pay.methods}) or at the shop, the customer chooses.`}` : '',
    d.plans?.length ? `- Memberships (bought at the shop): ${d.plans.slice(0, 8).map(planLine).join('; ')}.` : '',
    d.rating && d.rating.count > 0 ? `- Customers rate it ${d.rating.average} out of 5 (${d.rating.count} reviews).` : '',
    d.about ? `- About: ${oneLine(d.about, 600)}` : '',
    bookings ? '- To check their own booking, customers can give the phone number and first name they booked with.' : '',
  ]
  return lines.filter(Boolean).join('\n')
}

// ── Services as knowledge (for cards under the answer) ──────────────────────

const wordsOf = (t: string) => String(t || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1)

/** The services matching a text, best first, as knowledge items (kind 'service'). */
export function serviceHits(services: DeskService[], text: string, max = 4, showPrices = true, bookable = true): KnowledgeHit[] {
  const typed = [...new Set(wordsOf(text))]
  if (!typed.length) return []
  const scored = services.map((s, i) => {
    const name = wordsOf(s.name)
    const cat = wordsOf(s.category)
    let score = 0
    for (const t of typed) {
      if (name.some((w) => w === t)) score += 3
      else if (name.some((w) => (w.length > 3 && t.length > 3) && (w.startsWith(t) || t.startsWith(w)))) score += 2
      else if (cat.includes(t)) score += 1
    }
    return { s, score, i }
  }).filter((x) => x.score >= 2)
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).slice(0, max).map(({ s }) => ({
    id: s.id, title: s.name, kind: 'service' as const, score: 1, similarity: null, wordScore: null,
    content: [`Service in the ${s.category} menu`, showPrices && s.price > 0 ? `Price: ${rupees(s.price)}` : 'Price: ask the shop', `Takes about ${duration(s.minutes)}`, bookable ? 'Book it on this website (Book button).' : 'No booking needed: walk in during opening hours.'].join('\n'),
  }))
}

// ── Amount check ────────────────────────────────────────────────────────────

/** The money amounts written in a text: "₹1,500", "Rs. 300", "INR 99.50", "300 rupees". */
export function amountsIn(text: string): number[] {
  const out: number[] = []
  const re = /(?:₹|rs\.?|inr)\s*(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s*(?:rupees|rs\b|\/-)/gi
  for (const m of String(text || '').matchAll(re)) {
    const n = Number(String(m[1] || m[2]).replace(/,/g, ''))
    if (Number.isFinite(n)) out.push(Math.round(n * 100) / 100)
  }
  return out
}

/**
 * Every amount in the reply must be in the sources (or the sum of two of them, like two services together). The
 * amounts that are not: an empty list means the reply is safe.
 */
export function unknownAmounts(reply: string, sources: string[]): number[] {
  const known = new Set<number>()
  for (const src of sources) {
    for (const n of amountsIn(src)) known.add(n)
    // Plain numbers too (a price written as "Price: 300" in a document)
    for (const m of String(src || '').matchAll(/\d[\d,]*(?:\.\d{1,2})?/g)) known.add(Math.round(Number(m[0].replace(/,/g, '')) * 100) / 100)
  }
  const list = [...known].filter((n) => n > 0).slice(0, 400)
  const sums = new Set<number>()
  for (let i = 0; i < list.length; i++) for (let j = i; j < Math.min(list.length, 200); j++) sums.add(Math.round((list[i] + list[j]) * 100) / 100)
  return [...new Set(amountsIn(reply))].filter((n) => n > 0 && !known.has(n) && !sums.has(n))
}
