import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { CONNECTORS, isConnectorOn, withConnector, type ConnectorKey } from '@/lib/connectors'
import { withPipelineSchema } from '@/lib/pipeline/schema'
import { withSalonSchema } from '@/lib/salon/schema'
import { isConsularHelpdesk } from '@/lib/workspace-modules'
import { billingLimits, getBilling } from '@/lib/billing'
import { activeConnectors, connectorSwitch, type PlanLimits } from '@/lib/plans'

export const runtime = 'nodejs'
export const maxDuration = 60

/** Each connector: switched on, and whether the plan lets it be used (`active`). */
function describe(organization: any, limits: PlanLimits) {
  const on = CONNECTORS.map((connector) => connector.key).filter((key) => isConnectorOn(organization, key))
  const active = activeConnectors(limits, on)
  return CONNECTORS.map((connector) => ({ key: connector.key, enabled: on.includes(connector.key), active: active.includes(connector.key) }))
}

function planInfo(billing: any, limits: PlanLimits) {
  if (!billing || billing.billing_exempt) return null
  return { connectors: limits.connectors, only: limits.connectorKeys }
}

async function loadOrganization(db: any, organizationId: string) {
  // Every column, so a switch whose column is not there yet (enable_pipeline before its migration)
  // reads as on; enabled_connectors comes with the Front Desk migration, set up when missing
  return withSalonSchema(() => db.from('organizations').select('*').eq('id', organizationId).maybeSingle())
}

// GET: which connectors the workspace has switched on (every member may see this)
export async function GET(request: NextRequest) {
  const organizationId = new URL(request.url).searchParams.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const { data: organization, error } = await loadOrganization(getSupabaseAdminClient(), organizationId!)
  if (error || !organization) return NextResponse.json({ error: error?.message || 'Workspace not found' }, { status: 500 })
  if (isConsularHelpdesk(organization)) return NextResponse.json({ connectors: [] })
  const billing = await getBilling(getSupabaseAdminClient(), organizationId!).catch(() => null)
  const limits = billingLimits(billing)
  return NextResponse.json({ connectors: describe(organization, limits), plan: planInfo(billing, limits) })
}

// POST { organizationId, key, enabled, swap? }: switch a connector on or off (organization admins). On a
// plan with room for fewer connectors, `swap: true` switches the others off to make room.
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

  // The plan decides how many connectors may be used (switching off is always allowed)
  const billing = await getBilling(db, organizationId).catch(() => null)
  const limits = billingLimits(billing)
  let switchOff: ConnectorKey[] = []
  if (enabled) {
    const on = CONNECTORS.map((connector) => connector.key).filter((k) => isConnectorOn(organization, k))
    const decision = connectorSwitch(limits, on, key, body?.swap === true)
    if (!decision.ok) return NextResponse.json({ error: decision.reason, upgrade: true, canSwap: decision.canSwap }, { status: 402 })
    switchOff = decision.switchOff
  }
  if (switchOff.length) {
    const off: Record<string, any> = {}
    if (switchOff.includes('ecommerce')) off.enable_commerce = false
    if (switchOff.includes('pipeline')) off.enable_pipeline = false
    if (switchOff.includes('salon')) off.enabled_connectors = withConnector(organization.enabled_connectors, 'salon', false)
    const { error: offError } = await withPipelineSchema(() => withSalonSchema(() => db.from('organizations').update(off).eq('id', organizationId)))
    if (offError) return NextResponse.json({ error: offError.message }, { status: 500 })
    Object.assign(organization, off)
  }

  const update = key === 'ecommerce' ? { enable_commerce: enabled } : key === 'pipeline' ? { enable_pipeline: enabled } : { enabled_connectors: withConnector(organization.enabled_connectors, key, enabled) }
  const save = () => db.from('organizations').update(update).eq('id', organizationId).select('*').single()
  const { data: saved, error: saveError } = key === 'pipeline' ? await withPipelineSchema(save) : await withSalonSchema(save)
  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 })
  return NextResponse.json({ success: true, switchedOff: switchOff, connectors: describe({ ...organization, ...saved }, limits), plan: planInfo(billing, limits) })
}
