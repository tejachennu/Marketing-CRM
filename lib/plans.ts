/**
 * WAMA CRM plans: what each one costs and what it switches on. Safe for the browser (no server imports).
 *
 * - Starter: WAMA's own WhatsApp number sends booking messages for the business (no inbox), Front Desk only.
 * - Growth and Pro: the business's own WhatsApp number, the inbox, AI replies, campaigns and connectors.
 * Exempt workspaces (the platform's own, Consular Helpdesk) have everything and no limits.
 * Super Admin can change any limit for one workspace (`plan_overrides`) without a deploy.
 */

import type { ConnectorKey } from './connectors'

export type PlanId = 'starter' | 'growth' | 'pro_1' | 'pro_2' | 'pro_3'

export interface PlanLimits {
  /** Inbox, AI replies, tickets, campaigns, templates, flow builder and the public API */
  messaging: boolean
  /** How many connectors may be on at once; Starter has Front Desk only */
  connectors: number
  /** Only these connectors (Starter: Front Desk). Empty = any. */
  connectorKeys: ConnectorKey[]
  /** Team members, null = no limit */
  team: number | null
  /** AI credit added with each monthly payment, in rupees */
  aiMonthly: number
  /** Magnetora's team runs the business's Google and Meta ads */
  ads: boolean
  /** Video campaigns made by Magnetora's team each month */
  videos: number
}

export interface Plan {
  id: PlanId
  name: string
  /** Short line under the name */
  tagline: string
  amountPaise: number
  /** shared = WAMA's number sends booking messages; own = the business connects its WhatsApp */
  whatsapp: 'shared' | 'own'
  limits: PlanLimits
  /** What the plan includes, in plain words, for the pricing and billing pages */
  features: string[]
}

export const PLAN_CURRENCY = 'INR'
export const PLAN_INTERVAL = 'monthly'
export const GST_PERCENT = 18

const MESSAGING_FEATURES = [
  'Your own WhatsApp number',
  'Team inbox with AI replies in English, Telugu and Hindi',
  'Campaigns with every Meta template type',
  'Tickets, flow builder and WhatsApp forms',
]

export const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'Bookings and bills, with WhatsApp messages from our number',
    amountPaise: 99_900,
    whatsapp: 'shared',
    limits: { messaging: false, connectors: 1, connectorKeys: ['salon'], team: 3, aiMonthly: 0, ads: false, videos: 0 },
    features: [
      'Front Desk: bookings, walk-ins and GST bills',
      'Your own booking page with a link and QR code',
      'Booking confirmations and reminders on WhatsApp from WAMA\'s number',
      'WhatsApp messages at Meta\'s price, no extra charge',
      'Up to 3 team members',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    tagline: 'Your own WhatsApp with AI, campaigns and one connector',
    amountPaise: 250_000,
    whatsapp: 'own',
    limits: { messaging: true, connectors: 1, connectorKeys: [], team: 5, aiMonthly: 300, ads: true, videos: 0 },
    features: [
      ...MESSAGING_FEATURES,
      'One connector: Front Desk, E-commerce or Sales Pipeline',
      '₹300 of AI credit every month',
      'Ads support from our team (Google and Meta)',
      'Up to 5 team members',
    ],
  },
  {
    id: 'pro_1',
    name: 'Pro 1',
    tagline: 'Everything, with ads and 2 video campaigns a month',
    amountPaise: 600_000,
    whatsapp: 'own',
    limits: { messaging: true, connectors: 3, connectorKeys: [], team: 10, aiMonthly: 500, ads: true, videos: 2 },
    features: [...MESSAGING_FEATURES, 'All connectors', '₹500 of AI credit every month', 'Ads support from our team', '2 video campaigns a month made by our team', 'Up to 10 team members'],
  },
  {
    id: 'pro_2',
    name: 'Pro 2',
    tagline: 'Everything, with ads and 4 video campaigns a month',
    amountPaise: 900_000,
    whatsapp: 'own',
    limits: { messaging: true, connectors: 3, connectorKeys: [], team: 20, aiMonthly: 1000, ads: true, videos: 4 },
    features: [...MESSAGING_FEATURES, 'All connectors', '₹1,000 of AI credit every month', 'Ads support from our team', '4 video campaigns a month made by our team', 'Up to 20 team members'],
  },
  {
    id: 'pro_3',
    name: 'Pro 3',
    tagline: 'Everything, with ads and 8 video campaigns a month',
    amountPaise: 1_200_000,
    whatsapp: 'own',
    limits: { messaging: true, connectors: 3, connectorKeys: [], team: null, aiMonthly: 1500, ads: true, videos: 8 },
    features: [...MESSAGING_FEATURES, 'All connectors', '₹1,500 of AI credit every month', 'Ads support from our team', '8 video campaigns a month made by our team', 'Unlimited team members'],
  },
]

export const DEFAULT_PLAN: PlanId = 'growth'

/** No limits: exempt workspaces, and before billing is set up. */
export const UNLIMITED: PlanLimits = { messaging: true, connectors: 3, connectorKeys: [], team: null, aiMonthly: 0, ads: false, videos: 0 }

export function isPlanId(value: unknown): value is PlanId {
  return PLANS.some((plan) => plan.id === value)
}

/** The plan a billing row is on. The old single plan (`pro_monthly`, ₹3,000) is now Growth. */
export function planIdOf(value: unknown): PlanId {
  return isPlanId(value) ? value : DEFAULT_PLAN
}

export function getPlan(value: unknown): Plan {
  const id = planIdOf(value)
  return PLANS.find((plan) => plan.id === id)!
}

/** A plan's limits with Super Admin's changes for one workspace on top. Unknown or invalid overrides are ignored. */
export function limitsOf(planId: unknown, overrides?: Record<string, unknown> | null): PlanLimits {
  const limits: PlanLimits = { ...getPlan(planId).limits, connectorKeys: [...getPlan(planId).limits.connectorKeys] }
  const o = overrides && typeof overrides === 'object' ? overrides : {}
  if (typeof o.messaging === 'boolean') limits.messaging = o.messaging
  if (typeof o.ads === 'boolean') limits.ads = o.ads
  const whole = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null)
  if (whole(o.connectors) !== null) {
    limits.connectors = Math.min(3, whole(o.connectors)!)
    // A connector number from Super Admin opens every connector up to it
    limits.connectorKeys = []
  }
  if (o.team === null) limits.team = null
  else if (whole(o.team) !== null) limits.team = whole(o.team)
  if (whole(o.aiMonthly) !== null) limits.aiMonthly = whole(o.aiMonthly)!
  if (whole(o.videos) !== null) limits.videos = whole(o.videos)!
  return limits
}

/** Features a plan may leave out. */
export type PlanFeature = 'inbox' | 'ai_replies' | 'tickets' | 'campaigns' | 'templates' | 'flows' | 'api'

export const FEATURE_NAMES: Record<PlanFeature, string> = {
  inbox: 'the WhatsApp inbox',
  ai_replies: 'AI replies',
  tickets: 'tickets',
  campaigns: 'campaigns',
  templates: 'WhatsApp templates',
  flows: 'the flow builder',
  api: 'the developer API',
}

export function planAllows(limits: PlanLimits, feature: PlanFeature): boolean {
  // Every feature that can be left out today comes with your own WhatsApp number
  return feature in FEATURE_NAMES ? limits.messaging : true
}

/** Every feature and whether the plan has it, for the pages and the app. */
export function allowsMap(limits: PlanLimits): Record<PlanFeature, boolean> {
  return Object.fromEntries((Object.keys(FEATURE_NAMES) as PlanFeature[]).map((feature) => [feature, planAllows(limits, feature)])) as Record<PlanFeature, boolean>
}

/** Words for a refusal: "Your plan does not include campaigns. Upgrade to Growth to use them." */
export function upgradeMessage(feature: PlanFeature): string {
  return `Your plan does not include ${FEATURE_NAMES[feature]}. Upgrade to Growth or Pro in Billing to use it.`
}

/**
 * May this connector be switched on, given the ones already on? Switching off is always allowed.
 * Returns null when it may, or the reason in plain words.
 */
export function connectorBlockReason(limits: PlanLimits, alreadyOn: ConnectorKey[], key: ConnectorKey): string | null {
  if (limits.connectorKeys.length && !limits.connectorKeys.includes(key)) {
    return 'Your plan includes Front Desk only. Upgrade to Growth or Pro in Billing to add this connector.'
  }
  // Connectors that start switched on but the plan has no room for do not count
  const others = activeConnectors(limits, alreadyOn).filter((on) => on !== key)
  if (others.length >= limits.connectors) {
    return limits.connectors === 1
      ? 'Your plan includes one connector. Switch the other one off first, or upgrade to Pro in Billing for all of them.'
      : `Your plan includes ${limits.connectors} connectors. Upgrade in Billing to add more.`
  }
  return null
}

/** Can one more person join the team? `current` counts everyone already in the workspace (and pending invites). */
export function teamBlockReason(limits: PlanLimits, current: number): string | null {
  if (limits.team === null || current < limits.team) return null
  return `Your plan includes up to ${limits.team} team members. Upgrade in Billing to add more people.`
}

/** Moving from one plan to another: up, down or the same. */
export function planDirection(from: unknown, to: unknown): 'up' | 'down' | 'same' {
  const a = getPlan(from).amountPaise
  const b = getPlan(to).amountPaise
  return b > a ? 'up' : b < a ? 'down' : 'same'
}

/**
 * What an upgrade costs now: the difference in monthly price for the days left in the paid month,
 * rounded to whole rupees (in paise). Nothing when the month is over or the plan is not bigger.
 */
export function upgradeDifferencePaise(from: unknown, to: unknown, periodEnd: string | null | undefined, now = Date.now(), periodDays = 30): number {
  const difference = getPlan(to).amountPaise - getPlan(from).amountPaise
  const end = periodEnd ? Date.parse(periodEnd) : NaN
  if (!(difference > 0) || !Number.isFinite(end) || end <= now) return 0
  const daysLeft = Math.min(periodDays, Math.ceil((end - now) / 86_400_000))
  return Math.round((difference * daysLeft) / periodDays / 100) * 100
}

/** "₹2,500" */
export function planPrice(plan: Plan): string {
  return `₹${(plan.amountPaise / 100).toLocaleString('en-IN')}`
}

/** The order connectors keep their place in when a plan allows fewer than are switched on. */
const CONNECTOR_PRIORITY: ConnectorKey[] = ['salon', 'ecommerce', 'pipeline']

/**
 * The connectors a workspace can use now: the ones switched on that its plan allows, up to the plan's
 * number (E-commerce and Sales Pipeline start switched on, so a one-connector plan keeps the first by
 * Front Desk, E-commerce, Sales Pipeline until the business picks).
 */
export function activeConnectors(limits: PlanLimits, on: ConnectorKey[]): ConnectorKey[] {
  const allowed = CONNECTOR_PRIORITY.filter((key) => on.includes(key) && (!limits.connectorKeys.length || limits.connectorKeys.includes(key)))
  return allowed.slice(0, Math.max(0, limits.connectors))
}

/**
 * Switching a connector on under the plan's limit. With room: just on. On a plan with fewer connectors
 * than are on: the others that are on are switched off to make room (`switchOff`), when the person
 * agreed to swap. A connector the plan does not include at all (Starter: Front Desk only) is refused.
 */
export function connectorSwitch(limits: PlanLimits, alreadyOn: ConnectorKey[], key: ConnectorKey, swap: boolean): { ok: true; switchOff: ConnectorKey[] } | { ok: false; reason: string; canSwap: boolean } {
  if (limits.connectorKeys.length && !limits.connectorKeys.includes(key)) {
    return { ok: false, reason: 'Your plan includes Front Desk only. Upgrade to Growth or Pro in Billing to add this connector.', canSwap: false }
  }
  const blocked = connectorBlockReason(limits, alreadyOn, key)
  if (!blocked) return { ok: true, switchOff: [] }
  if (!swap) return { ok: false, reason: blocked, canSwap: limits.connectors >= 1 }
  // Keep the newest choice, plus as many of the others as the plan allows (in their usual order)
  const keep = activeConnectors({ ...limits, connectors: Math.max(0, limits.connectors - 1) }, alreadyOn.filter((on) => on !== key))
  return { ok: true, switchOff: alreadyOn.filter((on) => on !== key && !keep.includes(on)) }
}
