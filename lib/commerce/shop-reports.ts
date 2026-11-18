/**
 * Shop reports: simple numbers for a period (7, 30 or 90 days). Pure; the rows come from shop-reports-store.ts.
 *
 * - Visits: store page opens (one per browser tab session), counted per day.
 * - Orders and sales: every order except cancelled ones and ones still waiting for online payment.
 * - What sells: products by pieces sold and money.
 * - Carts left: people who typed their phone at checkout but did not order; "came back" = ordered later.
 * - Best customers: by money spent (same phone = same customer).
 */

export const REPORT_PERIODS = [7, 30, 90] as const
export type ReportPeriod = (typeof REPORT_PERIODS)[number]

export function readPeriod(value: unknown): ReportPeriod {
  const days = Number(value)
  return (REPORT_PERIODS as readonly number[]).includes(days) ? (days as ReportPeriod) : 30
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

/** "2026-11-18" in India time. */
export function istDay(at: Date | string | number): string {
  const time = new Date(at).getTime()
  return new Date(time + 330 * 60_000).toISOString().slice(0, 10)
}

/** The days of the period, oldest first, ending today (India time). */
export function periodDays(days: number, now: Date = new Date()): string[] {
  const today = new Date(`${istDay(now)}T00:00:00Z`).getTime()
  return Array.from({ length: days }, (_, i) => new Date(today - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10))
}

/** When the period starts, as a time for database filters. */
export function periodStart(days: number, now: Date = new Date()): string {
  return new Date(new Date(`${periodDays(days, now)[0]}T00:00:00Z`).getTime() - 330 * 60_000).toISOString()
}

export const CHANNEL_LABELS: Record<string, string> = { website: 'Website', in_chat: 'WhatsApp', in_store: 'In the shop', phone: 'Phone call' }

const COUNTED = (order: any) => !['canceled', 'payment_pending'].includes(String(order.status || ''))
const phoneKey = (value: unknown) => String(value ?? '').replace(/\D/g, '').slice(-10)

export interface ShopReport {
  days: number
  visits: number
  productViews: number
  orders: number
  sales: number
  averageOrder: number
  /** Orders ÷ visits, as a percent (website orders only); null without visits */
  conversion: number | null
  cancelled: number
  daily: { day: string; visits: number; orders: number; sales: number }[]
  channels: { channel: string; label: string; orders: number; sales: number }[]
  topProducts: { productId: string | null; title: string; quantity: number; sales: number }[]
  carts: { left: number; reminded: number; cameBack: number; value: number }
  customers: { name: string; phone: string; orders: number; spent: number; last: string }[]
  newCustomers: number
  returningCustomers: number
}

export function buildShopReport(input: {
  days: number
  now?: Date
  orders: any[]
  items: any[]
  checkouts: any[]
  visits: { day: string; visits: number; product_views?: number }[]
  /** Phones that ordered before the period (to tell new from returning customers) */
  earlierPhones?: string[]
}): ShopReport {
  const dayList = periodDays(input.days, input.now)
  const start = dayList[0]
  const inPeriod = (at: unknown) => Boolean(at) && istDay(at as string) >= start
  const all = input.orders.filter((o) => inPeriod(o.created_at))
  const counted = all.filter(COUNTED)
  const countedIds = new Set(counted.map((o) => o.id))

  const daily = new Map(dayList.map((day) => [day, { day, visits: 0, orders: 0, sales: 0 }]))
  let visits = 0
  let productViews = 0
  for (const v of input.visits) {
    const row = daily.get(String(v.day).slice(0, 10))
    if (!row) continue
    row.visits += Number(v.visits) || 0
    visits += Number(v.visits) || 0
    productViews += Number(v.product_views) || 0
  }
  const channels = new Map<string, { channel: string; label: string; orders: number; sales: number }>()
  for (const o of counted) {
    const total = Number(o.total_amount) || 0
    const row = daily.get(istDay(o.created_at))
    if (row) { row.orders++; row.sales = round2(row.sales + total) }
    const channel = String(o.checkout_type || 'in_chat')
    const c = channels.get(channel) || { channel, label: CHANNEL_LABELS[channel] || channel, orders: 0, sales: 0 }
    c.orders++
    c.sales = round2(c.sales + total)
    channels.set(channel, c)
  }
  const sales = round2(counted.reduce((s, o) => s + (Number(o.total_amount) || 0), 0))

  const products = new Map<string, { productId: string | null; title: string; quantity: number; sales: number }>()
  for (const item of input.items) {
    if (!countedIds.has(item.order_id)) continue
    const key = item.product_id || `title:${item.title}`
    const p = products.get(key) || { productId: item.product_id || null, title: String(item.title || 'Item'), quantity: 0, sales: 0 }
    p.quantity += Number(item.quantity) || 0
    p.sales = round2(p.sales + (Number(item.total_price) || (Number(item.unit_price) || 0) * (Number(item.quantity) || 0)))
    products.set(key, p)
  }

  const people = new Map<string, { name: string; phone: string; orders: number; spent: number; last: string }>()
  for (const o of counted) {
    const ship = o.shipping_address || {}
    const phone = String(ship.phone_number || o.contact?.phone_number || '')
    const key = phoneKey(phone) || (o.contact_id ? `contact:${o.contact_id}` : '')
    if (!key) continue
    const name = String(ship.full_name || [o.contact?.first_name, o.contact?.last_name].filter(Boolean).join(' ') || 'Customer')
    const p = people.get(key) || { name, phone, orders: 0, spent: 0, last: '' }
    p.orders++
    p.spent = round2(p.spent + (Number(o.total_amount) || 0))
    if (String(o.created_at) > p.last) p.last = String(o.created_at)
    people.set(key, p)
  }
  const earlier = new Set((input.earlierPhones || []).map(phoneKey).filter(Boolean))
  let returning = 0
  for (const [key, p] of people) if (earlier.has(key) || p.orders > 1) returning++

  const carts = input.checkouts.filter((c) => inPeriod(c.created_at))
  const websiteOrders = counted.filter((o) => o.checkout_type === 'website').length

  return {
    days: input.days,
    visits,
    productViews,
    orders: counted.length,
    sales,
    averageOrder: counted.length ? round2(sales / counted.length) : 0,
    conversion: visits > 0 ? round2((websiteOrders / visits) * 100) : null,
    cancelled: all.filter((o) => o.status === 'canceled').length,
    daily: [...daily.values()],
    channels: [...channels.values()].sort((a, b) => b.sales - a.sales),
    topProducts: [...products.values()].sort((a, b) => b.quantity - a.quantity || b.sales - a.sales).slice(0, 10),
    carts: {
      left: carts.filter((c) => !c.recovered_order_id).length,
      reminded: carts.filter((c) => c.reminded_at).length,
      cameBack: carts.filter((c) => c.recovered_order_id).length,
      value: round2(carts.filter((c) => !c.recovered_order_id).reduce((s, c) => s + (Number(c.total) || 0), 0)),
    },
    customers: [...people.values()].sort((a, b) => b.spent - a.spent || b.orders - a.orders).slice(0, 10),
    newCustomers: people.size - returning,
    returningCustomers: returning,
  }
}
