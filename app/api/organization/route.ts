import { connectsWhatsApp } from '@/lib/plan-gate'
import { platformAiKey } from '@/lib/ai-access'
import { NextRequest, NextResponse } from 'next/server'
import { denyByPlan, getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { planOrganizationUpdate, toSafeOrganization } from '@/lib/organization-access'
import { can, describeDenied } from '@/lib/rbac'

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * GET /api/organization?organizationId=...
 * Any member gets the organization without its credentials (which channels are configured
 * comes back as yes/no). `&full=1` returns the stored credentials too and needs settings access.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')
    const wantsCredentials = searchParams.get('full') === '1'

    const auth = await verifyOrgAccess(request, organizationId)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    if (wantsCredentials && !can(auth.user, 'settings.manage')) {
      return NextResponse.json({ error: describeDenied('settings.manage') }, { status: 403 })
    }

    const { data: organization, error } = await getSupabaseAdminClient()
      .from('organizations')
      .select('*')
      .eq('id', organizationId)
      .maybeSingle()

    if (error) throw error
    if (!organization) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    const safe = toSafeOrganization(organization, Boolean(await platformAiKey(getSupabaseAdminClient())))
    return NextResponse.json(
      { organization: wantsCredentials ? { ...organization, credentials: safe.credentials, whatsapp_connected: safe.whatsapp_connected } : safe },
      { headers: NO_STORE }
    )
  } catch (error: any) {
    console.error('[API] Get organization error:', error)
    return NextResponse.json({ error: error.message || 'Failed to load organization' }, { status: 500 })
  }
}

/**
 * PATCH /api/organization  { organizationId, updates }
 * Each setting needs the permission listed in lib/organization-access.ts.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const organizationId = body?.organizationId || null

    const auth = await verifyOrgAccess(request, organizationId)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const plan = planOrganizationUpdate(auth.user, body?.updates)
    if (!plan.ok) {
      return NextResponse.json({ error: plan.error }, { status: plan.status })
    }
    // Connecting a WhatsApp number by hand (keys typed in Settings) needs Business or bigger, like Meta's sign-up
    if (connectsWhatsApp(plan.values)) {
      const refused = await denyByPlan(auth.user, organizationId, 'inbox')
      if (refused) return NextResponse.json({ error: 'Connecting your own WhatsApp comes with the Business plan or bigger. Choose a plan in Billing, then connect it.' }, { status: 402 })
    }

    const { data: organization, error } = await getSupabaseAdminClient()
      .from('organizations')
      .update(plan.values)
      .eq('id', organizationId)
      .select('*')
      .maybeSingle()

    if (error) throw error
    if (!organization) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, organization: toSafeOrganization(organization, Boolean(await platformAiKey(getSupabaseAdminClient()))) }, { headers: NO_STORE })
  } catch (error: any) {
    console.error('[API] Update organization error:', error)
    return NextResponse.json({ error: error.message || 'Failed to save settings' }, { status: 500 })
  }
}
