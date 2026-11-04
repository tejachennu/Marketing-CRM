import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { isMissingColumnError, planOrganizationUpdate, toSafeOrganization } from '@/lib/organization-access'
import { can, describeDenied } from '@/lib/rbac'
import { ADDRESS_FORM_ERROR } from '@/lib/commerce/go-live-checks'
import { getMetaCredentials } from '@/lib/flows/meta-client'
import { readAddressForm } from '@/app/api/commerce/meta-detect/route'

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

    const safe = toSafeOrganization(organization)
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
 * Why a form cannot be the address step, or null when it can. The checkout reads the delivery
 * address from the form's `address_line_1` field, so the form is read from Meta first. When Meta
 * cannot be read (or WhatsApp is not connected) the choice is accepted, and the Order flow tab's
 * check reports the form once Meta answers.
 */
async function addressFormProblem(organization: Record<string, any>, flowId: string): Promise<string | null> {
  let credentials
  try {
    credentials = getMetaCredentials(organization)
  } catch {
    return null
  }
  const form = await readAddressForm(credentials, flowId)
  if (form.error) {
    console.warn(`[API] Address form ${flowId} accepted without being checked: ${form.error}`)
    return null
  }
  return form.collectsAddress === false ? ADDRESS_FORM_ERROR : null
}

/**
 * PATCH /api/organization  { organizationId, updates }
 * Each setting needs the permission listed in lib/organization-access.ts. A form chosen for the
 * address step has to collect an address (400 otherwise).
 *
 * Switching the store off only stops new carts from becoming orders. Orders already in checkout
 * keep their payment cards and buttons: the webhook still records their payments and answers
 * their taps, so withdrawing the cards here would tell customers the opposite of what happens.
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

    const supabase = getSupabaseAdminClient()

    // The address form is checked against Meta, and only when it changes from what is stored
    const flowId = typeof plan.values.commerce_address_flow_id === 'string' ? plan.values.commerce_address_flow_id.trim() : ''
    let current: Record<string, any> | null = null
    if (flowId) {
      const { data, error } = await supabase.from('organizations').select('*').eq('id', organizationId).maybeSingle()
      if (error) throw error
      if (!data) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
      current = data
    }

    if (current && flowId && flowId !== String(current.commerce_address_flow_id || '').trim()) {
      const problem = await addressFormProblem(current, flowId)
      if (problem) return NextResponse.json({ error: problem }, { status: 400 })
    }

    const { data: organization, error } = await supabase
      .from('organizations')
      .update(plan.values)
      .eq('id', organizationId)
      .select('*')
      .maybeSingle()

    if (error) {
      // A setting whose column the team has not added yet is a known state, not a server fault
      if (isMissingColumnError(error)) {
        return NextResponse.json({ error: 'The database migration for this setting has not been applied yet.' }, { status: 400 })
      }
      throw error
    }
    if (!organization) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, organization: toSafeOrganization(organization) }, { headers: NO_STORE })
  } catch (error: any) {
    console.error('[API] Update organization error:', error)
    return NextResponse.json({ error: error.message || 'Failed to save settings' }, { status: 500 })
  }
}
