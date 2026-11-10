import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser, getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { isConnectorOn } from '@/lib/connectors'
import { can, canSeeAll, getRoleDisplay, isReadOnly } from '@/lib/rbac'

export const runtime = 'nodejs'

// GET: who is signed in to the mobile app, their workspace, and what they may do there
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
  if (!user.organization_id) return NextResponse.json({ error: 'Your account is not part of a workspace.' }, { status: 403 })
  const { data: organization, error } = await getSupabaseAdminClient().from('organizations').select('*').eq('id', user.organization_id).maybeSingle()
  if (error || !organization) return NextResponse.json({ error: 'Your workspace could not be found.' }, { status: 404 })
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
    },
    connectors: { frontDesk: isConnectorOn(organization, 'salon') },
  })
}
