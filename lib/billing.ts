/**
 * WAMA CRM billing: plans (lib/plans.ts), a free trial, an AI wallet and a message wallet.
 *
 * A workspace may use the app while it is exempt, in its trial, or paid up (with a few days of grace
 * when a renewal fails). The AI wallet is separate: AI features run while the wallet has credit.
 * Customers only ever see the wallet as a percentage left, never an amount spent.
 */

import { getPlan, limitsOf, PLAN_CURRENCY, PLAN_INTERVAL, UNLIMITED, type PlanLimits } from './plans'
import { plansSchemaSetup } from './plans-schema'

const GROWTH = getPlan('growth')

/** The plan the old single-plan code meant: Growth (it replaced the ₹3,000 plan). Prefer lib/plans.ts. */
export const PLAN = {
  id: GROWTH.id,
  name: `WAMA CRM ${GROWTH.name}`,
  amountPaise: GROWTH.amountPaise,
  currency: PLAN_CURRENCY,
  interval: PLAN_INTERVAL,
  features: GROWTH.features,
} as const

export const TRIAL_DAYS = 14
/** Days a workspace keeps working after a renewal payment fails, while Razorpay retries. */
export const GRACE_DAYS = 3
/** Free AI usage every new workspace starts with, in rupees. */
export const FREE_AI_CREDIT = 300
/** Top-up amounts offered, in rupees. */
export const AI_TOPUP_OPTIONS = [500, 1000, 2000, 5000]
export const MIN_AI_TOPUP = 200
export const MAX_AI_TOPUP = 50000

export type BillingStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired'

export interface BillingRow {
  organization_id: string
  billing_exempt: boolean
  plan: string
  status: BillingStatus
  trial_ends_at: string
  current_period_end: string | null
  cancel_at_period_end: boolean
  razorpay_subscription_id: string | null
  ai_balance: number | string
  ai_allowance: number | string
  /** Added by the plans migration; missing on databases that have not run it yet */
  plan_overrides?: Record<string, unknown> | null
  pending_plan?: string | null
  pending_subscription_id?: string | null
  whatsapp_mode?: 'own' | 'shared' | string | null
  message_balance?: number | string | null
}

/** A workspace's plan limits: its plan with Super Admin's changes; no limits when exempt or before billing. */
export function billingLimits(row: BillingRow | null | undefined): PlanLimits {
  if (!row || row.billing_exempt) return { ...UNLIMITED, connectorKeys: [] }
  return limitsOf(row.plan, row.plan_overrides)
}

export interface BillingState {
  exempt: boolean
  status: BillingStatus
  /** May the workspace use the app right now */
  hasAccess: boolean
  /** Whole days of trial left, when trialing */
  trialDaysLeft: number | null
  /** When access ends without another payment */
  accessUntil: string | null
  cancelAtPeriodEnd: boolean
  /** AI credit left, 0–100. Null for exempt workspaces (they use their own AI key). */
  aiPercentLeft: number | null
  aiPaused: boolean
  /** The workspace never paid: it is (or was) on the free trial */
  onTrial: boolean
}

const DAY = 86_400_000

/** What a billing row means right now. */
export function billingState(row: BillingRow | null, now = Date.now()): BillingState {
  if (!row || row.billing_exempt) {
    return { exempt: true, status: 'active', hasAccess: true, trialDaysLeft: null, accessUntil: null, cancelAtPeriodEnd: false, aiPercentLeft: null, aiPaused: false, onTrial: false }
  }
  const trialEnd = Date.parse(row.trial_ends_at)
  const periodEnd = row.current_period_end ? Date.parse(row.current_period_end) : NaN
  let hasAccess = false
  let accessUntil: number | null = null
  let status: BillingStatus = row.status
  if (row.status === 'active') {
    // Paid: access runs to the end of the paid period (plus grace in case the renewal is a little late)
    accessUntil = Number.isFinite(periodEnd) ? periodEnd : null
    hasAccess = !Number.isFinite(periodEnd) || now < periodEnd + GRACE_DAYS * DAY
  } else if (row.status === 'past_due') {
    accessUntil = Number.isFinite(periodEnd) ? periodEnd + GRACE_DAYS * DAY : null
    hasAccess = accessUntil !== null && now < accessUntil
  } else if (row.status === 'cancelled') {
    accessUntil = Number.isFinite(periodEnd) ? periodEnd : null
    hasAccess = accessUntil !== null && now < accessUntil
  } else {
    accessUntil = Number.isFinite(trialEnd) ? trialEnd : null
    hasAccess = accessUntil !== null && now < accessUntil
  }
  if (!hasAccess && (row.status === 'trialing' || row.status === 'cancelled' || row.status === 'past_due')) status = 'expired'
  const trialDaysLeft = row.status === 'trialing' && Number.isFinite(trialEnd) ? Math.max(0, Math.ceil((trialEnd - now) / DAY)) : null
  const balance = Number(row.ai_balance) || 0
  const allowance = Number(row.ai_allowance) || 0
  const aiPercentLeft = allowance > 0 ? Math.max(0, Math.min(100, Math.floor((balance / allowance) * 100))) : 0
  return {
    exempt: false,
    status,
    hasAccess,
    trialDaysLeft,
    accessUntil: accessUntil ? new Date(accessUntil).toISOString() : null,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    aiPercentLeft: balance > 0 && aiPercentLeft === 0 ? 1 : aiPercentLeft,
    aiPaused: balance <= 0,
    onTrial: row.status === 'trialing',
  }
}

async function checked(query: any) {
  const result = await query
  if (result.error) throw new Error(result.error.message)
  return result.data
}

/** WAMA CRM's own workspaces, Magnetora's and Consular Helpdesk (WhatsApp through Twilio) are never billed. */
export const EXEMPT_ORGANIZATION_IDS = ['303b7a2d-281c-403c-b794-54d1e195ca69', 'b2acf062-c379-49f2-8905-267413c9c394']

export function isExemptOrganization(organization: { id?: string | null; name?: string | null; slug?: string | null; whatsapp_provider?: string | null; twilio_account_sid?: string | null } | null | undefined): boolean {
  if (!organization) return false
  if (EXEMPT_ORGANIZATION_IDS.includes(String(organization.id || ''))) return true
  if (/consular/i.test(`${organization.name || ''} ${organization.slug || ''}`)) return true
  return (organization.whatsapp_provider || 'twilio') === 'twilio' && Boolean(String(organization.twilio_account_sid || '').trim())
}

/**
 * The workspace's billing row, created on first use with a trial and the free AI credit. Returns
 * null when billing has not been set up in the database yet (the migration has not run), in which
 * case the app behaves as before.
 */
export async function getBilling(db: any, organizationId: string): Promise<BillingRow | null> {
  const found = await db.from('organization_billing').select('*').eq('organization_id', organizationId).maybeSingle()
  if (found.error) {
    if (/organization_billing/.test(found.error.message || '') || found.error.code === '42P01') return null
    throw new Error(found.error.message)
  }
  if (found.data) {
    // Billing from before the plans: add the plan columns once, then read again
    if (!('whatsapp_mode' in found.data) && await plansSchemaSetup.ensure()) {
      const again = await db.from('organization_billing').select('*').eq('organization_id', organizationId).maybeSingle()
      if (!again.error && again.data) return again.data
    }
    return found.data
  }
  const { data: organization } = await db.from('organizations').select('id, name, slug, whatsapp_provider, twilio_account_sid').eq('id', organizationId).maybeSingle()
  const created = await db.from('organization_billing').insert({ organization_id: organizationId, billing_exempt: isExemptOrganization(organization) }).select('*').single()
  if (created.error) {
    // Created by a request running at the same time
    const again = await checked(db.from('organization_billing').select('*').eq('organization_id', organizationId).maybeSingle())
    return again
  }
  await db.from('ai_wallet_transactions').insert({ organization_id: organizationId, kind: 'free_grant', amount: FREE_AI_CREDIT })
  return created.data
}

// ── AI pricing ────────────────────────────────────────────────────────────────

/** OpenAI's prices in US dollars per million tokens: [input, output]. */
const MODEL_PRICES: Array<[RegExp, number, number]> = [
  [/^text-embedding-3-small/, 0.02, 0],
  [/^text-embedding-3-large/, 0.13, 0],
  [/^text-embedding-ada/, 0.10, 0],
  // Speech to text: audio input is the larger part, so it is charged at the audio rate
  [/^gpt-4o-mini-transcribe/, 3.00, 5.00],
  [/^gpt-4o-transcribe/, 6.00, 10.00],
  [/^gpt-4o-mini/, 0.15, 0.60],
  [/^gpt-4\.1-nano/, 0.10, 0.40],
  [/^gpt-4\.1-mini/, 0.40, 1.60],
  [/^gpt-4\.1/, 2.00, 8.00],
  [/^gpt-4o/, 2.50, 10.00],
  [/^gpt-3\.5/, 0.50, 1.50],
  [/^o\d-mini|^o4-mini|^o3-mini/, 1.10, 4.40],
]
/** Unknown models are charged at the higher gpt-4o rate rather than for free. */
const FALLBACK_PRICE: [number, number] = [2.50, 10.00]

/** Rupees per US dollar, and the margin on AI cost (1 = at cost). Both can be set in the environment. */
function rates() {
  const usdInr = Number(process.env.AI_USD_INR_RATE) || 88
  const markup = Number(process.env.AI_PRICE_MARKUP) || 1.5
  return { usdInr, markup }
}

/** What one AI request costs the workspace, in rupees. */
export function aiCostInr(model: string, inputTokens: number, outputTokens: number): number {
  const match = MODEL_PRICES.find(([pattern]) => pattern.test(String(model || '').toLowerCase()))
  const [inputPrice, outputPrice] = match ? [match[1], match[2]] : FALLBACK_PRICE
  const usd = ((Number(inputTokens) || 0) * inputPrice + (Number(outputTokens) || 0) * outputPrice) / 1_000_000
  const { usdInr, markup } = rates()
  return Math.round(usd * usdInr * markup * 10_000) / 10_000
}
