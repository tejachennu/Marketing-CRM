import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { CONNECTORS, isConnectorOn, withConnector, type ConnectorKey } from '@/lib/connectors'
import { withSalonSchema } from '@/lib/salon/schema'
import { isConsularHelpdesk } from '@/lib/workspace-modules'

export const runtime = 'nodejs'
export const maxDuration = 60

async function loadOrganization(db: any, organizationId: string) {
  // enabled_connectors is added by the Spa & Salon migration; set it up when it is missing
  return withSalonSchema(() => db.from('organizations').select('id, name, slug, whatsapp_provider, twilio_account_sid, twilio_auth_token, enable_commerce, enabled_connectors').eq('id', organizationId).maybeSingle())
}

// GET: which connectors the workspace has switched on (every member may see this)
export async function GET(request: NextRequest) {
  const organizationId = new URL(request.url).searchParams.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const { data: organization, error } = await loadOrganization(getSupabaseAdminClient(), organizationId!)
  if (error || !organization) return NextResponse.json({ error: error?.message || 'Workspace not found' }, { status: 500 })
  if (isConsularHelpdesk(organization)) return NextResponse.json({ connectors: [] })
  return NextResponse.json({ connectors: CONNECTORS.map((connector) => ({ key: connector.key, enabled: isConnectorOn(organization, connector.key) })) })
}

// POST { organizationId, key, enabled }: switch a connector on or off (organization admins)
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const organizationId = String(body?.organizationId || '')
  const key = String(body?.key || '') as ConnectorKey
  const enabled = body?.enabled === true
  const access = await verifyOrgAccess(request, organizationId, { permission: 'settings.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  if (!CONNECTORS.some((connector) => connector.key === key)) return NextResponse.json({ error: 'Unknown connector.' }, { status: 400 })

  const db = getSupabaseAdminClient()
  const { data: organization, error } = await loadOrganization(db, organizationId)
  if (error || !organization) return NextResponse.json({ error: error?.message || 'Workspace not found' }, { status: 500 })
  if (isConsularHelpdesk(organization)) return NextResponse.json({ error: 'Connectors are not available for this workspace.' }, { status: 403 })

  const update = key === 'ecommerce' ? { enable_commerce: enabled } : { enabled_connectors: withConnector(organization.enabled_connectors, key, enabled) }
  const { data: saved, error: saveError } = await withSalonSchema(() =>
    db.from('organizations').update(update).eq('id', organizationId).select('enable_commerce, enabled_connectors').single()
  )
  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 })
  return NextResponse.json({ success: true, connectors: CONNECTORS.map((connector) => ({ key: connector.key, enabled: isConnectorOn({ ...organization, ...saved }, connector.key) })) })
}
