/**
 * Membership rules with no database code (safe in the browser): plans, card states, what a card does
 * to a bill, and the report numbers. lib/salon/memberships.ts adds the database set-up.
 */

const isUuid = (value: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? ''))

// ── Plans ────────────────────────────────────────────────────────────────────

export interface PlanSession { service_id: string; name: string; count: number }

export interface MembershipPlan {
  id?: string
  name: string
  price: number
  validity_days: number
  discount_percent: number
  credit: number
  sessions: PlanSession[]
  tax_rate: number
  colour: string
  terms: string
  active: boolean
}

export const PLAN_COLOURS = ['#0E1B3D', '#1D5BEA', '#B45309', '#6D28D9', '#BE185D', '#0F766E'] as const
const TAX_RATES = [0, 5, 12, 18, 28]

const money = (value: unknown) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0
}
const text = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** A plan as typed, checked: a name, a price, how long it lasts, and at least one benefit. */
export function readPlan(raw: any, services?: { id: string; name: string }[]): { plan: MembershipPlan } | { error: string } {
  const name = text(raw?.name, 60)
  if (name.length < 2) return { error: 'Give the plan a name, like Gold or Bridal.' }
  const price = money(raw?.price)
  const validity = Math.round(Number(raw?.validity_days))
  if (!(validity >= 1 && validity <= 3650)) return { error: 'How long is it valid? Choose between 1 day and 10 years.' }
  const discount = Math.min(100, money(raw?.discount_percent))
  const credit = money(raw?.credit)
  const known = new Map((services || []).map((s) => [s.id, s.name]))
  const seen = new Set<string>()
  const sessions: PlanSession[] = []
  for (const s of Array.isArray(raw?.sessions) ? raw.sessions : []) {
    if (!isUuid(s?.service_id) || seen.has(s.service_id)) continue
    if (services && !known.has(s.service_id)) continue
    const count = Math.round(Number(s?.count))
    if (!(count >= 1 && count <= 500)) continue
    seen.add(s.service_id)
    sessions.push({ service_id: s.service_id, name: known.get(s.service_id) || text(s?.name, 80) || 'Service', count })
    if (sessions.length >= 20) break
  }
  if (!discount && !credit && !sessions.length) return { error: 'Add at least one benefit: credit to spend, free sessions, or a discount.' }
  const colour = String(raw?.colour || '').toUpperCase()
  const tax = Number(raw?.tax_rate)
  return {
    plan: {
      ...(isUuid(raw?.id) ? { id: raw.id } : {}),
      name, price, validity_days: validity, discount_percent: discount, credit, sessions,
      tax_rate: TAX_RATES.includes(tax) ? tax : 18,
      colour: (PLAN_COLOURS as readonly string[]).includes(colour) ? colour : PLAN_COLOURS[0],
      terms: String(raw?.terms ?? '').trim().slice(0, 600),
      active: raw?.active !== false,
    },
  }
}

const rupees = (n: number) => `₹${Math.round(n * 100) / 100 === Math.round(n) ? Math.round(n).toLocaleString('en-IN') : (Math.round(n * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** "₹6,000 to spend · 4 × Haircut · 10% off services · valid 1 year" */
export function planBenefits(plan: Pick<MembershipPlan, 'credit' | 'sessions' | 'discount_percent'> & { validity_days?: number }): string[] {
  const out: string[] = []
  if (plan.credit > 0) out.push(`${rupees(plan.credit)} to spend`)
  for (const s of plan.sessions || []) out.push(`${s.count} × ${s.name}`)
  if (plan.discount_percent > 0) out.push(`${plan.discount_percent}% off services`)
  if (plan.validity_days) out.push(`valid ${validityWords(plan.validity_days)}`)
  return out
}

export function validityWords(days: number): string {
  if (days % 365 === 0) return days === 365 ? '1 year' : `${days / 365} years`
  if (days % 30 === 0) return days === 30 ? '1 month' : `${days / 30} months`
  return days === 1 ? '1 day' : `${days} days`
}

// ── Cards ────────────────────────────────────────────────────────────────────

export interface CardSession { service_id: string; name: string; total: number; used: number }

export interface Membership {
  id: string
  organization_id: string
  card_number: string
  plan: Partial<MembershipPlan>
  customer_name: string
  customer_phone: string | null
  contact_id: string | null
  starts_at: string
  expires_at: string
  credit_balance: number | string
  sessions: CardSession[]
  status: string
  public_token: string
  updated_at?: string
}

/** MB-0007 */
export const formatCardNumber = (seq: number) => `MB-${String(seq).padStart(4, '0')}`

/** A new card's starting values from its plan. */
export function cardFromPlan(plan: MembershipPlan, startsAt: Date) {
  const start = new Date(startsAt)
  return {
    starts_at: start.toISOString(),
    expires_at: new Date(start.getTime() + plan.validity_days * 86_400_000).toISOString(),
    credit_balance: plan.credit,
    sessions: plan.sessions.map((s) => ({ service_id: s.service_id, name: s.name, total: s.count, used: 0 })) as CardSession[],
    plan: { name: plan.name, price: plan.price, validity_days: plan.validity_days, discount_percent: plan.discount_percent, credit: plan.credit, sessions: plan.sessions, colour: plan.colour, terms: plan.terms },
  }
}

export type CardState = 'active' | 'expiring' | 'expired' | 'cancelled' | 'upcoming'

/** Where a card stands. "Expiring" = active with 14 days or less left. */
export function cardState(card: Pick<Membership, 'status' | 'starts_at' | 'expires_at'>, now = new Date()): CardState {
  if (card.status === 'cancelled') return 'cancelled'
  const t = now.getTime()
  if (Date.parse(card.expires_at) <= t) return 'expired'
  if (Date.parse(card.starts_at) > t) return 'upcoming'
  return Date.parse(card.expires_at) - t <= 14 * 86_400_000 ? 'expiring' : 'active'
}

export const CARD_STATE_WORDS: Record<CardState, string> = { active: 'Active', expiring: 'Ending soon', expired: 'Expired', cancelled: 'Cancelled', upcoming: 'Starts later' }

/** Can it be used on a bill right now? */
export function usableCard(card: Pick<Membership, 'status' | 'starts_at' | 'expires_at'>, now = new Date()): boolean {
  const state = cardState(card, now)
  return state === 'active' || state === 'expiring'
}

export const sessionsLeft = (card: Pick<Membership, 'sessions'>) => (card.sessions || []).reduce((sum, s) => sum + Math.max(0, s.total - s.used), 0)

export interface BillLine { service_id: string | null; name: string; price: number; tax_rate: number; sac_code: string | null; [key: string]: any }

export interface CardUse {
  lines: BillLine[]
  sessions: { service_id: string; name: string; count: number }[]
  discountSaved: number
  sessionsSaved: number
}

/**
 * What a card does to a bill's lines (before tax): services it has free sessions for cost nothing, then
 * its discount comes off the rest. Credit is used later, on the bill's total (creditToUse).
 */
export function applyCard(card: Pick<Membership, 'sessions' | 'plan'>, lines: BillLine[]): CardUse {
  const left = new Map((card.sessions || []).map((s) => [s.service_id, Math.max(0, s.total - s.used)]))
  const pct = Math.min(100, Math.max(0, Number(card.plan?.discount_percent) || 0))
  const used = new Map<string, { service_id: string; name: string; count: number }>()
  let discountSaved = 0
  let sessionsSaved = 0
  const out = lines.map((line) => {
    const free = line.service_id ? left.get(line.service_id) || 0 : 0
    if (line.service_id && free > 0 && line.price > 0) {
      left.set(line.service_id, free - 1)
      const entry = used.get(line.service_id) || { service_id: line.service_id, name: line.name, count: 0 }
      entry.count++
      used.set(line.service_id, entry)
      sessionsSaved += line.price
      return { ...line, name: `${line.name} (membership)`, price: 0 }
    }
    if (pct > 0 && line.service_id && line.price > 0) {
      const price = Math.round(line.price * (1 - pct / 100) * 100) / 100
      discountSaved += line.price - price
      return { ...line, price }
    }
    return line
  })
  return { lines: out, sessions: [...used.values()], discountSaved: Math.round(discountSaved * 100) / 100, sessionsSaved: Math.round(sessionsSaved * 100) / 100 }
}

/** How much of a bill's total the card's credit pays. */
export function creditToUse(card: Pick<Membership, 'credit_balance'>, total: number): number {
  return Math.round(Math.max(0, Math.min(Number(card.credit_balance) || 0, total)) * 100) / 100
}

/** The card after a use: sessions counted, credit taken (never below zero). */
export function cardAfterUse(card: Pick<Membership, 'sessions' | 'credit_balance'>, use: { sessions: { service_id: string; count: number }[]; credit: number }) {
  const sessions = (card.sessions || []).map((s) => {
    const taken = use.sessions.find((u) => u.service_id === s.service_id)?.count || 0
    return { ...s, used: Math.min(s.total, s.used + taken) }
  })
  return { sessions, credit_balance: Math.max(0, Math.round(((Number(card.credit_balance) || 0) - use.credit) * 100) / 100) }
}

/** The card after a bill is cancelled: its sessions and credit go back. */
export function cardAfterRefund(card: Pick<Membership, 'sessions' | 'credit_balance'>, back: { sessions: { service_id: string; count: number }[]; credit: number }) {
  const sessions = (card.sessions || []).map((s) => {
    const returned = back.sessions.find((u) => u.service_id === s.service_id)?.count || 0
    return { ...s, used: Math.max(0, s.used - returned) }
  })
  return { sessions, credit_balance: Math.round(((Number(card.credit_balance) || 0) + back.credit) * 100) / 100 }
}

/** The card as a customer sees it on its page: no ids, no staff names. */
export function publicCard(card: Membership, business: { name?: string | null; logo_url?: string | null; phone?: string | null }, usage: any[] = [], now = new Date()) {
  const state = cardState(card, now)
  return {
    business: { name: business.name || 'Our salon', logo: /^https:\/\//.test(String(business.logo_url || '')) ? business.logo_url : '', phone: business.phone || '' },
    cardNumber: card.card_number,
    name: card.customer_name,
    plan: String(card.plan?.name || 'Membership'),
    colour: String(card.plan?.colour || PLAN_COLOURS[0]),
    state,
    stateWords: CARD_STATE_WORDS[state],
    startsAt: card.starts_at,
    expiresAt: card.expires_at,
    credit: Number(card.credit_balance) || 0,
    discount: Number(card.plan?.discount_percent) || 0,
    sessions: (card.sessions || []).map((s) => ({ name: s.name, total: s.total, left: Math.max(0, s.total - s.used) })),
    terms: String(card.plan?.terms || ''),
    history: usage.slice(0, 20).map((u) => ({ at: u.created_at, kind: u.kind, detail: u.detail || '', amount: Number(u.amount) || 0, sessions: Number(u.sessions) || 0 })),
  }
}

/** Words for one line of a card's history. */
export function usageWords(u: { kind: string; detail?: string | null; amount?: number | string; sessions?: number }): string {
  const amount = Number(u.amount) || 0
  switch (u.kind) {
    case 'sale': return `Card bought${amount ? ` · ${rupees(amount)}` : ''}`
    case 'session': return `Used ${u.sessions || 1} × ${u.detail || 'session'}`
    case 'discount': return `Saved ${rupees(amount)} with the discount`
    case 'credit': return `Paid ${rupees(amount)} from credit`
    case 'refund': return `Given back: ${u.detail || 'bill cancelled'}`
    case 'adjust': return u.detail || 'Changed by the shop'
    case 'cancel': return 'Card cancelled'
    default: return u.detail || u.kind
  }
}

// ── Reports ──────────────────────────────────────────────────────────────────

/** Numbers for the Members tab: cards, money taken, what was used, what is still owed. */
export function membershipReport(cards: Membership[], usage: { kind: string; amount: number | string; sessions?: number; membership_id: string; created_at: string }[], plans: { id: string; name: string }[], now = new Date()) {
  const byState = { active: 0, expiring: 0, expired: 0, cancelled: 0, upcoming: 0 } as Record<CardState, number>
  let creditOwed = 0
  let sessionsOwed = 0
  for (const card of cards) {
    const state = cardState(card, now)
    byState[state]++
    if (state === 'active' || state === 'expiring' || state === 'upcoming') {
      creditOwed += Number(card.credit_balance) || 0
      sessionsOwed += sessionsLeft(card)
    }
  }
  const sum = (kind: string) => usage.filter((u) => u.kind === kind).reduce((s, u) => s + (Number(u.amount) || 0), 0)
  const sessionsUsed = usage.filter((u) => u.kind === 'session').reduce((s, u) => s + (Number(u.sessions) || 0), 0)
  const cardPlan = new Map(cards.map((c) => [c.id, String(c.plan?.name || 'Membership')]))
  const perPlan = new Map<string, { plan: string; sold: number; revenue: number; credit: number; sessions: number; saved: number }>()
  for (const u of usage) {
    const plan = cardPlan.get(u.membership_id) || 'Membership'
    const row = perPlan.get(plan) || { plan, sold: 0, revenue: 0, credit: 0, sessions: 0, saved: 0 }
    if (u.kind === 'sale') { row.sold++; row.revenue += Number(u.amount) || 0 }
    if (u.kind === 'credit') row.credit += Number(u.amount) || 0
    if (u.kind === 'session') row.sessions += Number(u.sessions) || 0
    if (u.kind === 'discount') row.saved += Number(u.amount) || 0
    perPlan.set(plan, row)
  }
  const round = (n: number) => Math.round(n * 100) / 100
  return {
    cards: { total: cards.length, ...byState },
    sold: usage.filter((u) => u.kind === 'sale').length,
    revenue: round(sum('sale')),
    creditUsed: round(sum('credit')),
    discountGiven: round(sum('discount')),
    sessionsUsed,
    creditOwed: round(creditOwed),
    sessionsOwed,
    plans: plans.length,
    perPlan: [...perPlan.values()].map((r) => ({ ...r, revenue: round(r.revenue), credit: round(r.credit), saved: round(r.saved) })).sort((a, b) => b.revenue - a.revenue),
  }
}
