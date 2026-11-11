/**
 * The Super Admin console's view of every workspace (plan, AI credit, team size) and the actions
 * WAMA CRM staff take on one: extend a trial, record an offline payment, exempt a workspace, add AI
 * credit, change the seat limit or end access. Pure apart from the database client passed in.
 */

import { billingState, getBilling, type BillingRow } from './billing'
import { getPlan, isPlanId, type PlanId } from './plans'
import { creditMessages } from './message-wallet'
import { withPlansSchema } from './plans-schema'

const DAY = 86_400_000

export type WorkspaceAction =
  | { action: 'extend_trial'; days: number }
  | { action: 'paid_until'; date: string }
  | { action: 'set_exempt'; exempt: boolean }
  | { action: 'add_ai_credit'; amount: number }
  | { action: 'set_seat_limit'; limit: number | null }
  | { action: 'end_access' }
  | { action: 'set_plan'; plan: PlanId }
  | { action: 'set_overrides'; overrides: Record<string, number | boolean | null> }
  | { action: 'add_message_credit'; amount: number }
  | { action: 'set_whatsapp_mode'; mode: 'own' | 'shared' }

async function checked(query: any) {
  const result = await query
  if (result.error) throw new Error(result.error.message)
  return result.data
}

/** Check an action from the console. Returns the action, or the reason it was refused. */
export function parseWorkspaceAction(body: any): { action: WorkspaceAction } | { error: string } {
  switch (body?.action) {
    case 'extend_trial': {
      const days = Math.round(Number(body.days))
      if (!(days >= 1 && days <= 365)) return { error: 'Choose between 1 and 365 days.' }
      return { action: { action: 'extend_trial', days } }
    }
    case 'paid_until': {
      const date = Date.parse(String(body.date || ''))
      if (!Number.isFinite(date)) return { error: 'Choose a date.' }
      if (date < Date.now() - DAY) return { error: 'Choose a date in the future.' }
      if (date > Date.now() + 3 * 366 * DAY) return { error: 'Choose a date within three years.' }
      return { action: { action: 'paid_until', date: new Date(date).toISOString() } }
    }
    case 'set_exempt':
      return { action: { action: 'set_exempt', exempt: body.exempt === true } }
    case 'add_ai_credit': {
      const amount = Math.round(Number(body.amount) * 100) / 100
      if (!(amount > 0 && amount <= 100000)) return { error: 'Enter an amount between ₹1 and ₹1,00,000.' }
      return { action: { action: 'add_ai_credit', amount } }
    }
    case 'set_seat_limit': {
      if (body.limit === null || body.limit === '' || Number(body.limit) === 0) return { action: { action: 'set_seat_limit', limit: null } }
      const limit = Math.round(Number(body.limit))
      if (!(limit >= 1 && limit <= 1000)) return { error: 'Enter a number of people between 1 and 1,000, or leave it empty for no limit.' }
      return { action: { action: 'set_seat_limit', limit } }
    }
    case 'end_access':
      return { action: { action: 'end_access' } }
    case 'set_plan':
      return isPlanId(body.plan) ? { action: { action: 'set_plan', plan: body.plan } } : { error: 'Choose a plan.' }
    case 'set_overrides': {
      // Empty or missing = use the plan's own number; team null = no limit
      const source = body.overrides && typeof body.overrides === 'object' ? body.overrides : {}
      const overrides: Record<string, number | boolean | null> = {}
      for (const key of ['connectors', 'team', 'aiMonthly', 'videos']) {
        const value = source[key]
        if (value === undefined || value === '') continue
        if (key === 'team' && value === null) { overrides.team = null; continue }
        const number = Math.round(Number(value))
        if (!(number >= 0 && number <= 100000)) return { error: `Enter a whole number for ${key}.` }
        overrides[key] = key === 'connectors' ? Math.min(3, number) : number
      }
      for (const key of ['messaging', 'ads']) if (typeof source[key] === 'boolean') overrides[key] = source[key]
      return { action: { action: 'set_overrides', overrides } }
    }
    case 'add_message_credit': {
      const amount = Math.round(Number(body.amount) * 100) / 100
      if (!(amount > 0 && amount <= 100000)) return { error: 'Enter an amount between ₹1 and ₹1,00,000.' }
      return { action: { action: 'add_message_credit', amount } }
    }
    case 'set_whatsapp_mode':
      return body.mode === 'shared' || body.mode === 'own' ? { action: { action: 'set_whatsapp_mode', mode: body.mode } } : { error: 'Choose own or shared.' }
    default:
      return { error: 'Unknown action.' }
  }
}

/** Apply a console action to a workspace. `actorId` is recorded on AI credit added by hand. */
export async function applyWorkspaceAction(db: any, organizationId: string, change: WorkspaceAction, actorId: string | null, now = Date.now()): Promise<void> {
  if (change.action === 'set_seat_limit') {
    await checked(db.from('organizations').update({ max_teammates: change.limit }).eq('id', organizationId))
    return
  }
  const billing = await getBilling(db, organizationId)
  if (!billing) throw new Error('Billing is not set up in the database yet. Run the billing migration first.')
  const update = async (values: Partial<BillingRow> & Record<string, unknown>) => {
    const result = await withPlansSchema(() => db.from('organization_billing').update({ ...values, updated_at: new Date(now).toISOString() }).eq('organization_id', organizationId))
    if (result.error) throw new Error(result.error.message)
  }

  switch (change.action) {
    case 'extend_trial': {
      // From today if the trial is already over, otherwise from its current end
      const from = Math.max(now, Date.parse(billing.trial_ends_at) || now)
      const values: Record<string, unknown> = { trial_ends_at: new Date(from + change.days * DAY).toISOString() }
      // A paying workspace keeps its plan; anyone else goes back on the trial
      if (billing.status !== 'active') values.status = 'trialing'
      await update(values)
      return
    }
    case 'paid_until':
      // A payment taken outside Razorpay (bank transfer, UPI to the company): access until that date
      await update({ status: 'active', current_period_end: change.date, cancel_at_period_end: true })
      return
    case 'set_exempt':
      await update({ billing_exempt: change.exempt })
      return
    case 'add_ai_credit':
      await checked(db.rpc('ai_wallet_credit', { p_org: organizationId, p_amount: change.amount, p_kind: 'adjustment', p_payment_id: null, p_created_by: actorId }))
      return
    case 'end_access': {
      const ended = new Date(now - 1000).toISOString()
      await update({ status: 'cancelled', current_period_end: ended, trial_ends_at: ended, cancel_at_period_end: true })
      return
    }
    case 'set_plan':
      // By hand (an offline arrangement): the plan changes now; Razorpay auto-pay is not touched
      await update({ plan: change.plan, whatsapp_mode: getPlan(change.plan).whatsapp })
      // Starter is Front Desk only: switch it on so the workspace lands there
      if (getPlan(change.plan).whatsapp === 'shared') {
        const { data: org } = await db.from('organizations').select('enabled_connectors').eq('id', organizationId).maybeSingle()
        const list = Array.isArray(org?.enabled_connectors) ? org.enabled_connectors : []
        if (!list.includes('salon')) await db.from('organizations').update({ enabled_connectors: [...list, 'salon'] }).eq('id', organizationId)
      }
      return
    case 'set_overrides':
      await update({ plan_overrides: change.overrides })
      return
    case 'add_message_credit':
      await creditMessages(db, organizationId, change.amount, 'adjustment', null, actorId)
      return
    case 'set_whatsapp_mode':
      await update({ whatsapp_mode: change.mode })
      return
  }
}

export interface WorkspaceSummary {
  id: string
  name: string
  slug: string
  created_at: string
  contact_email: string | null
  whatsapp: 'meta' | 'twilio' | null
  members: number
  max_teammates: number | null
  enable_ai: boolean
  billing: ReturnType<typeof billingState> & { configured: boolean; aiBalance: number | null; hasSubscription: boolean; plan: string; planName: string; price: number; pendingPlan: string | null; whatsappMode: 'own' | 'shared'; messageBalance: number; overrides: Record<string, unknown> }
}

/** One row per workspace for the console list. */
export function summarizeWorkspace(organization: any, billing: BillingRow | null, members: number, now = Date.now()): WorkspaceSummary {
  const state = billingState(billing, now)
  const metaConnected = Boolean(organization.whatsapp_phone_number_id) && organization.whatsapp_provider === 'facebook'
  const twilioConnected = Boolean(organization.twilio_account_sid) && (organization.whatsapp_provider || 'twilio') === 'twilio'
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    created_at: organization.created_at,
    contact_email: organization.contact_email || null,
    whatsapp: metaConnected ? 'meta' : twilioConnected ? 'twilio' : null,
    members,
    max_teammates: organization.max_teammates > 0 ? organization.max_teammates : null,
    enable_ai: organization.enable_ai !== false,
    billing: {
      ...state,
      configured: billing !== null,
      aiBalance: billing && !billing.billing_exempt ? Math.round(Number(billing.ai_balance) * 100) / 100 : null,
      hasSubscription: Boolean(billing?.razorpay_subscription_id) && ['active', 'past_due'].includes(String(billing?.status)),
      plan: getPlan(billing?.plan).id,
      planName: getPlan(billing?.plan).name,
      price: getPlan(billing?.plan).amountPaise / 100,
      pendingPlan: billing?.pending_plan || null,
      whatsappMode: billing?.whatsapp_mode === 'shared' ? 'shared' : 'own',
      messageBalance: Math.round((Number(billing?.message_balance) || 0) * 100) / 100,
      overrides: billing?.plan_overrides && typeof billing.plan_overrides === 'object' ? billing.plan_overrides : {},
    },
  }
}

/** Totals for the console's overview. Monthly revenue adds up the plan price of every paying workspace. */
export function workspaceTotals(workspaces: WorkspaceSummary[]) {
  const billed = workspaces.filter((w) => w.billing.configured && !w.billing.exempt)
  const paying = billed.filter((w) => w.billing.status === 'active' || w.billing.status === 'past_due')
  return {
    workspaces: workspaces.length,
    paying: paying.length,
    trialing: billed.filter((w) => w.billing.status === 'trialing').length,
    expired: billed.filter((w) => !w.billing.hasAccess).length,
    // Before billing is switched on nobody is exempt: there is simply no billing yet
    exempt: workspaces.filter((w) => w.billing.configured && w.billing.exempt).length,
    pastDue: billed.filter((w) => w.billing.status === 'past_due').length,
    aiPaused: billed.filter((w) => w.billing.aiPaused).length,
    monthlyRevenue: paying.reduce((sum, w) => sum + w.billing.price, 0),
    people: workspaces.reduce((sum, w) => sum + w.members, 0),
  }
}
