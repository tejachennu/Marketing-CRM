import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser, getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { CONNECTORS, isConnectorOn } from '@/lib/connectors'
import { billingLimits, billingState, getBilling } from '@/lib/billing'
import { activeConnectors, getPlan, planIdOf } from '@/lib/plans'
import { isConsularHelpdesk } from '@/lib/workspace-modules'
import { can, canSeeAll, getRoleDisplay, isReadOnly, isSuperAdmin } from '@/lib/rbac'
import { accountFor } from '@/lib/instagram/store'
import { igReplyHours } from '@/lib/instagram/rules'
import { getOrganizationCredentials } from '@/lib/organization-access'
import { takesAppointments } from '@/lib/salon/appointments-switch'

export const runtime = 'nodejs'

// GET: who is signed in to the mobile app, their workspace, and what they may do there
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
  if (!user.organization_id) return NextResponse.json({ error: 'Your account is not part of a workspace.' }, { status: 403 })
  const { data: organization, error } = await getSupabaseAdminClient().from('organizations').select('*').eq('id', user.organization_id).maybeSingle()
  if (error || !organization) return NextResponse.json({ error: 'Your workspace could not be found.' }, { status: 404 })
  // Connectors that are on and inside the plan (as the web menu shows them)
  const on = CONNECTORS.map((connector) => connector.key).filter((key) => isConnectorOn(organization, key))
  const billing = await getBilling(getSupabaseAdminClient(), organization.id).catch(() => null)
  const active = isConsularHelpdesk(organization) ? on.filter((key) => key === 'pipeline') : activeConnectors(billingLimits(billing), on)
  // Instagram has its own section in the app (never mixed with WhatsApp chats)
  const instagram = isConsularHelpdesk(organization) ? null : await accountFor(getSupabaseAdminClient(), organization.id).catch(() => null)
  // Front Desk: does the business take appointments? (Setup → Appointments; the app hides bookings when it does not)
  const deskSettings = active.includes('salon')
    ? await getSupabaseAdminClient().from('salon_settings').select('*').eq('organization_id', organization.id).maybeSingle().then((r: any) => r?.data || null, () => null)
    : null
  return NextResponse.json({
    success: true,
    user: { id: user.id, name: user.full_name || null, email: user.email || null, role: getRoleDisplay(user.role).label },
    organization: { id: organization.id, name: organization.name || 'Workspace', currency: String(organization.currency || 'INR').toUpperCase() },
    can: {
      write: !isReadOnly(user),
      manage: can(user, 'automation.manage'),
      campaigns: can(user, 'campaigns.manage'),
      seeAll: canSeeAll(user),
      billing: can(user, 'billing.manage'),
      settings: can(user, 'settings.manage'),
    },
    connectors: { frontDesk: active.includes('salon'), ecommerce: active.includes('ecommerce'), pipeline: active.includes('pipeline') },
    frontDesk: { appointments: takesAppointments(deskSettings) },
    instagram: { connected: Boolean(instagram), username: instagram?.username || null, replyHours: igReplyHours() },
    // WhatsApp sender connected (Meta or Twilio): until then the app locks chats, campaigns, templates and tickets
    whatsapp: { connected: getOrganizationCredentials(organization).messaging, mode: billing?.whatsapp_mode || 'own' },
    // The free trial or plan: the app shows days left, and a "Choose a plan" page once it has ended (the server
    // refuses everything but Billing then: lib/billing-gate.ts). No billing set up = never paused.
    billing: billingFor(billing, isSuperAdmin(user)),
  })
}

function billingFor(row: Awaited<ReturnType<typeof getBilling>>, superAdmin: boolean) {
  if (!row || superAdmin) return { exempt: true, hasAccess: true, status: 'active', onTrial: false, trialDaysLeft: null, accessUntil: null, plan: null }
  const state = billingState(row)
  const plan = state.exempt ? null : getPlan(planIdOf(row.plan))
  return {
    exempt: state.exempt,
    hasAccess: state.hasAccess,
    status: state.status,
    onTrial: state.onTrial,
    trialDaysLeft: state.trialDaysLeft,
    accessUntil: state.accessUntil,
    plan: plan ? { id: plan.id, name: plan.name, price: plan.amountPaise / 100 } : null,
  }
}
