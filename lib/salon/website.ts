/**
 * The Front Desk business website (salons, clinics, studios, service centres): its settings, "Open now", the
 * week's hours, and which site a business's own domain opens (website or online store). Pure (browser-safe); the
 * database side is in website-store.ts.
 */

import { DEFAULT_BOOKING_PAY, readBookingPay, type BookingPay } from './booking-pay'

export const SITE_COLOURS = ['#1D5BEA', '#0E1B3D', '#7A2E4D', '#0F6E6E', '#8A4B2A', '#111827'] as const
export const MAX_GALLERY = 12

/**
 * The call-to-action buttons the website shows, each switched on or off by the business (owner, 25 Nov 2026:
 * "website lo call to action button enable or disable"). All on by default, so existing sites do not change.
 */
export type SiteButton = 'call' | 'whatsapp' | 'book' | 'shop' | 'directions'
export const SITE_BUTTONS: { key: SiteButton; label: string; hint: string }[] = [
  { key: 'call', label: 'Call', hint: 'Call buttons and your phone number' },
  { key: 'whatsapp', label: 'WhatsApp', hint: '"WhatsApp us" buttons' },
  { key: 'book', label: 'Book now', hint: 'Book buttons and the booking form' },
  { key: 'shop', label: 'Shop online', hint: 'The link to your online store' },
  { key: 'directions', label: 'Directions and map', hint: '"Get directions" and the map' },
]
export const DEFAULT_BUTTONS: Record<SiteButton, boolean> = { call: true, whatsapp: true, book: true, shop: true, directions: true }

export interface SiteSettings {
  /** The website is on (it needs at least one service to show) */
  enabled: boolean
  /** One line under the name, like "Hair, skin and bridal studio in Banjara Hills" */
  tagline: string
  /** A few lines about the business */
  about: string
  /** The big photo at the top (https) */
  cover: string
  /** Photos of the place and the work (https, at most 12) */
  gallery: string[]
  colour: string
  /** Which parts to show */
  show: { prices: boolean; team: boolean; memberships: boolean; reviews: boolean }
  /** Instagram handle, shown as a link */
  instagram: string
  /** Show the connected Instagram account's latest posts (Settings → Instagram) */
  instagramLive: boolean
  /** The AI chat on the website (answers from the services, hours, team and Knowledge Base) */
  chat: boolean
  /** Paying while booking: at the shop, online, or the customer's choice; full or an advance */
  bookingPay: BookingPay
  /** When the business has both: the own domain opens the website or the online store */
  domainShows: 'website' | 'store'
  /** Which call-to-action buttons show (Call, WhatsApp, Book now, Shop online, Directions and map) */
  buttons: Record<SiteButton, boolean>
}

export const DEFAULT_SITE: SiteSettings = {
  enabled: true, tagline: '', about: '', cover: '', gallery: [], colour: SITE_COLOURS[0],
  show: { prices: true, team: true, memberships: true, reviews: true }, instagram: '', instagramLive: false, chat: true, bookingPay: DEFAULT_BOOKING_PAY, domainShows: 'website',
  buttons: DEFAULT_BUTTONS,
}

const text = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const longText = (v: unknown, max: number) => String(v ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
const https = (v: unknown) => (/^https:\/\/[^\s"'<>]{4,1000}$/i.test(String(v || '').trim()) ? String(v).trim() : '')

/** The website settings as saved or as typed, cleaned. */
export function readSite(raw: unknown): SiteSettings {
  const v: any = raw && typeof raw === 'object' ? raw : {}
  const colour = String(v.colour || '').toUpperCase()
  const show = v.show && typeof v.show === 'object' ? v.show : {}
  const buttons = v.buttons && typeof v.buttons === 'object' ? v.buttons : {}
  return {
    enabled: v.enabled !== false,
    tagline: text(v.tagline, 140),
    about: longText(v.about, 1500),
    cover: https(v.cover),
    gallery: [...new Set((Array.isArray(v.gallery) ? v.gallery : []).map(https).filter(Boolean))].slice(0, MAX_GALLERY) as string[],
    colour: /^#[0-9A-F]{6}$/.test(colour) ? colour : DEFAULT_SITE.colour,
    show: { prices: show.prices !== false, team: show.team !== false, memberships: show.memberships !== false, reviews: show.reviews !== false },
    instagram: String(v.instagram || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '').replace(/[^a-zA-Z0-9._]/g, '').slice(0, 30),
    instagramLive: v.instagramLive === true,
    chat: v.chat !== false,
    bookingPay: readBookingPay(v.bookingPay),
    domainShows: v.domainShows === 'store' ? 'store' : 'website',
    buttons: Object.fromEntries(SITE_BUTTONS.map(({ key }) => [key, buttons[key] !== false])) as Record<SiteButton, boolean>,
  }
}

/** What the website can offer at all: appointments taken, the online store on, a phone number, an address. */
export interface SiteReach { bookings: boolean; store: boolean; phone: boolean; address: boolean }

/** Why a button cannot show even when it is switched on (for the settings screen); null when it can. */
export function buttonBlocker(key: SiteButton, reach: SiteReach): string | null {
  if (key === 'book' && !reach.bookings) return 'Appointments are off (Setup → Appointments), so there is nothing to book.'
  if (key === 'shop' && !reach.store) return 'Your online store is off.'
  if ((key === 'call' || key === 'whatsapp') && !reach.phone) return 'Add a phone number in Business details first.'
  if (key === 'directions' && !reach.address) return 'Add an address in Business details first.'
  return null
}

/** The buttons the page shows: switched on by the business and possible (Book now also needs appointments on). */
export function siteButtons(site: Pick<SiteSettings, 'buttons'>, reach: SiteReach): Record<SiteButton, boolean> {
  const on = site.buttons || DEFAULT_BUTTONS
  return Object.fromEntries(SITE_BUTTONS.map(({ key }) => [key, on[key] !== false && !buttonBlocker(key, reach)])) as Record<SiteButton, boolean>
}

/**
 * The phone bar at the bottom of the website (phones): Call and WhatsApp, and one big button: Book now, else Shop
 * online. Empty when every one of them is off (then there is no bar at all).
 */
export function phoneBar(buttons: Record<SiteButton, boolean>): { small: ('call' | 'whatsapp')[]; main: 'book' | 'shop' | null } {
  const small = (['call', 'whatsapp'] as const).filter((key) => buttons[key])
  return { small, main: buttons.book ? 'book' : buttons.shop ? 'shop' : null }
}

/**
 * Which site the business's own domain opens: the website when only it is on, the online store when only the
 * store is on, the business's choice when both are on; null when neither.
 */
export function domainOpens(input: { website: boolean; store: boolean; choice: 'website' | 'store' }): 'website' | 'store' | null {
  if (input.website && input.store) return input.choice
  if (input.website) return 'website'
  if (input.store) return 'store'
  return null
}

// ── Hours ───────────────────────────────────────────────────────────────────

export interface Hours { opens_at?: string | null; closes_at?: string | null; closed_weekdays?: number[] | null }

const clock = (value: string | null | undefined, fallback: string) => (/^\d{1,2}:\d{2}$/.test(String(value || '')) ? String(value).padStart(5, '0') : fallback)
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "9 am", "9:30 pm" */
export function niceTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h >= 12 ? 'pm' : 'am'}`
}

/** India's day of week and minutes since midnight for a moment. */
function istNow(now: number): { day: number; minutes: number } {
  const ist = new Date(now + 330 * 60_000)
  return { day: ist.getUTCDay(), minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes() }
}

/** "Open now · closes 9 pm", "Opens at 10 am", "Closed today · opens Monday 10 am". */
export function openStatus(hours: Hours, now = Date.now()): { open: boolean; text: string } {
  const opens = clock(hours.opens_at, '10:00')
  const closes = clock(hours.closes_at, '21:00')
  const closed = new Set((hours.closed_weekdays || []).filter((d) => d >= 0 && d <= 6))
  const { day, minutes } = istNow(now)
  if (closed.size === 7) return { open: false, text: 'Closed' }
  if (!closed.has(day) && minutes >= minutesOf(opens) && minutes < minutesOf(closes)) return { open: true, text: `Open now · closes ${niceTime(closes)}` }
  if (!closed.has(day) && minutes < minutesOf(opens)) return { open: false, text: `Opens today at ${niceTime(opens)}` }
  for (let i = 1; i <= 7; i++) {
    const next = (day + i) % 7
    if (!closed.has(next)) return { open: false, text: `${closed.has(day) ? 'Closed today' : 'Closed now'} · opens ${i === 1 ? 'tomorrow' : DAY_NAMES[next]} ${niceTime(opens)}` }
  }
  return { open: false, text: 'Closed' }
}

/** The week, Monday first: "Monday · 10 am – 9 pm" or "Closed"; today is marked. */
export function weekRows(hours: Hours, now = Date.now()): { day: string; time: string; today: boolean; closed: boolean }[] {
  const opens = clock(hours.opens_at, '10:00')
  const closes = clock(hours.closes_at, '21:00')
  const closed = new Set(hours.closed_weekdays || [])
  const today = istNow(now).day
  return [1, 2, 3, 4, 5, 6, 0].map((d) => ({ day: DAY_NAMES[d], time: closed.has(d) ? 'Closed' : `${niceTime(opens)} – ${niceTime(closes)}`, today: d === today, closed: closed.has(d) }))
}

/** "From ₹300" for a group of prices; "" when none are above zero. */
export function fromPrice(prices: number[]): number {
  const list = prices.filter((n) => n > 0)
  return list.length ? Math.min(...list) : 0
}

/** "45 min", "1 h 30 min" */
export function duration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
}
