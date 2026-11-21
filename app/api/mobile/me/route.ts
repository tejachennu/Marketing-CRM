import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser, getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { CONNECTORS, isConnectorOn } from '@/lib/connectors'
import { billingLimits, getBilling } from '@/lib/billing'
import { activeConnectors } from '@/lib/plans'
import { isConsularHelpdesk } from '@/lib/workspace-modules'
import { can, canSeeAll, getRoleDisplay, isReadOnly } from '@/lib/rbac'
import { accountFor } from '@/lib/instagram/store'

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
    instagram: { connected: Boolean(instagram), username: instagram?.username || null },
  })
}
