import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOrgAccess } from '@/lib/api-auth-helper'
import { getMetaCredentials, metaRequest, uploadNativeFlow, type MetaCredentials } from '@/lib/flows/meta-client'
import { compileMetaFlowJSON, NATIVE_FLOW_TEMPLATES } from '@/lib/flows/meta-flows-spec'
import { getExpressFee } from '@/lib/commerce/commerce-utils'
import {
  STANDARD_ADDRESS_FORM_NAME, expressOptionTitle, formCollectsAddress, getExpressOptionTitle, isStandardAddressForm, nextAddressFormName,
  type AddressFormReport,
} from '@/lib/commerce/go-live-checks'
import { describeCatalogError, explainCommerceError, flattenPaymentConfigurations, setCommerceSettings } from '@/lib/commerce/meta-catalog'

/**
 * The address form with this store's delivery options: the express choice shows what it costs,
 * so the customer knows before choosing it rather than after.
 */
function addressFormScreens(org: any) {
  const screens = structuredClone(NATIVE_FLOW_TEMPLATES.SHIPPING_ADDRESS.screens) as any[]
  const expressTitle = expressOptionTitle(getExpressFee(org), org.currency)
  for (const screen of screens) {
    for (const field of screen.layout?.children || []) {
      if (field.name !== 'delivery_speed') continue
      field.options = [
        { id: 'standard', title: 'Standard delivery' },
        { id: 'express', title: expressTitle },
      ]
    }
  }
  return screens
}

/**
 * What a form says for express delivery and whether it hands back a delivery address, read from
 * the form file Meta stores. A published form never changes, so this is what customers see
 * whatever fee the store charges today. Also used by PATCH /api/organization before a form is
 * chosen for the address step.
 */
export async function readAddressForm(credentials: MetaCredentials, flowId: string): Promise<AddressFormReport> {
  try {
    const assets = await metaRequest(credentials, `${flowId}/assets`)
    const asset = (assets?.data || []).find((item: any) => item.asset_type === 'FLOW_JSON') || assets?.data?.[0]
    const url = String(asset?.download_url || '')
    if (!url.startsWith('https://')) throw new Error('Meta did not return the form file')
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw new Error(`Meta returned HTTP ${response.status} for the form file`)
    const flowJson = await response.json()
    return { id: flowId, expressLabel: getExpressOptionTitle(flowJson), collectsAddress: formCollectsAddress(flowJson), error: null }
  } catch (error) {
    const described = describeCatalogError(error)
    // The catalog wording does not fit a form; for anything but the connection, Meta's own message does
    const connection = described.kind === 'token' || described.kind === 'timeout' || described.kind === 'rate_limit'
    return { id: flowId, expressLabel: null, collectsAddress: null, error: connection ? described.message : String((error as any)?.message || described.message) }
  }
}

/** Every form on the WhatsApp account, following Meta's paging. */
async function listFlows(credentials: MetaCredentials): Promise<Array<{ id: string; name: string; status: string }>> {
  const flows: Array<{ id: string; name: string; status: string }> = []
  let after = ''
  for (let page = 0; page < 10; page++) {
    const data = await metaRequest(credentials, `${credentials.businessAccountId}/flows?fields=id,name,status&limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`)
    for (const flow of data?.data || []) flows.push({ id: String(flow.id), name: String(flow.name || ''), status: String(flow.status || '').toUpperCase() })
    after = data?.paging?.next && data?.paging?.cursors?.after ? String(data.paging.cursors.after) : ''
    if (!after) break
  }
  return flows
}

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

// GET: Auto-detect available Catalogs, Payment Gateways, and Flows from Meta Graph API
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('organizationId')

    if (!orgId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, orgId, { permission: 'automation.manage' })
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabase()
    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .single()

    if (orgErr || !org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    if (!org.whatsapp_api_token || !org.whatsapp_business_account_id) {
      return NextResponse.json(
        {
          error:
            'Please configure your WhatsApp API Token and WhatsApp Business Account ID (WABA ID) in Settings first.',
        },
        { status: 400 }
      )
    }

    const credentials = getMetaCredentials(org)
    const wabaId = credentials.businessAccountId
    const phoneNumberId = credentials.phoneNumberId
    const addressFlowId = String(org.commerce_address_flow_id || '').trim()

    // The connection first: an expired token would otherwise show up as empty lists everywhere below
    let account: any
    try {
      account = await metaRequest(credentials, `${wabaId}?fields=id,name,owner_business_info`)
    } catch (error) {
      const described = describeCatalogError(error)
      return NextResponse.json({
        success: false,
        connectionError: described.kind === 'token' ? described.message : `Meta did not answer for your WhatsApp account: ${described.message}`,
      })
    }

    /** Each lookup on its own, so one Meta refusal does not hide the others. */
    const attempt = async <T,>(run: () => Promise<T>): Promise<{ value: T | null; error: string | null }> => {
      try {
        return { value: await run(), error: null }
      } catch (error) {
        return { value: null, error: describeCatalogError(error).message }
      }
    }

    const [catalogs, payments, flows, settings, addressForm] = await Promise.all([
      // The catalog connected to the WhatsApp account, read with the WhatsApp connection (a catalog
      // connection is granted catalogs only, not the account)
      attempt(async () => (await metaRequest(credentials, `${wabaId}/product_catalogs?fields=id,name,vertical,product_count`))?.data || []),
      attempt(async () => flattenPaymentConfigurations(await metaRequest(credentials, `${wabaId}/payment_configurations`))),
      attempt(async () => (await metaRequest(credentials, `${wabaId}/flows?fields=id,name,status,categories`))?.data || []),
      phoneNumberId
        ? attempt(async () => (await metaRequest(credentials, `${phoneNumberId}/whatsapp_commerce_settings`))?.data?.[0] || null)
        : Promise.resolve({ value: null, error: 'No WhatsApp number is connected.' }),
      // What the address form in use says, so the Order flow tab can compare it with the fee charged
      addressFlowId ? readAddressForm(credentials, addressFlowId) : Promise.resolve(null),
    ])

    return NextResponse.json({
      success: true,
      wabaId,
      phoneNumberId,
      // The business portfolio that owns the WhatsApp account: where a new catalog is created
      businessId: account?.owner_business_info?.id ? String(account.owner_business_info.id) : null,
      businessName: account?.owner_business_info?.name || null,
      catalogs: catalogs.value || [],
      catalogsError: catalogs.error,
      paymentConfigs: payments.value || [],
      paymentConfigsError: payments.error,
      flows: flows.value || [],
      flowsError: flows.error,
      commerceSettings: settings.value,
      commerceSettingsError: settings.error,
      addressForm,
    })
  } catch (err: any) {
    console.error('[API Commerce Meta Detect GET] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST: 1-Click Deploy Address Flow or Toggle Native Cart
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { organizationId, action } = body

    if (!organizationId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, organizationId, { permission: 'automation.manage' })
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabase()
    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', organizationId)
      .single()

    if (orgErr || !org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    const credentials = getMetaCredentials(org)

    // Action A: publish the standard delivery address form, or a new version of it when the one in
    // use no longer shows the express charge the store applies ("republish" asks for that outright)
    if (action === 'deploy_address_flow' || action === 'republish_address_flow') {
      const template = NATIVE_FLOW_TEMPLATES.SHIPPING_ADDRESS
      if (!template) {
        throw new Error('SHIPPING_ADDRESS template not found')
      }

      const saveFlowId = async (flowId: string) => {
        const { error } = await supabase
          .from('organizations')
          .update({ commerce_address_flow_id: flowId, updated_at: new Date().toISOString() })
          .eq('id', organizationId)
        if (error) throw error
      }

      const expectedLabel = expressOptionTitle(getExpressFee(org), org.currency)
      const linkedId: string | null = org.commerce_address_flow_id || null
      // The draft to finish, when the linked form is one. A published form is immutable on Meta: it
      // stays in use until the new version is published, and the store is only then pointed at it.
      let draftId: string | null = null
      let name = STANDARD_ADDRESS_FORM_NAME
      let replacing = false
      if (linkedId) {
        try {
          const remote = await metaRequest(credentials, `${linkedId}?fields=id,name,status`)
          const standard = isStandardAddressForm(remote.name)
          if (remote.status === 'PUBLISHED') {
            const current = standard ? await readAddressForm(credentials, linkedId) : null
            const upToDate = Boolean(current && !current.error && current.expressLabel === expectedLabel)
            // "Create the standard form" leaves a form it could not read alone; a republish does not
            if (upToDate || (standard && current?.error && action === 'deploy_address_flow')) {
              return NextResponse.json({
                success: true,
                flowId: linkedId,
                unchanged: true,
                message: 'The WhatsApp Delivery Address Flow is already published on Meta and shows the current express delivery charge.',
              })
            }
            replacing = true
          } else if (remote.status === 'DRAFT' && standard) {
            draftId = linkedId
            name = String(remote.name)
          }
          // Deprecated, blocked or someone else's form: a new standard one takes its place
        } catch {
          // The saved ID no longer exists on this WhatsApp account
        }
      }

      if (!draftId) {
        // Meta refuses a name already used on the account, so a new version gets the next free one.
        // A draft left by an attempt that did not publish is finished rather than duplicated.
        const flows = await listFlows(credentials)
        const leftover = flows.find((flow) => flow.status === 'DRAFT' && flow.id !== linkedId && isStandardAddressForm(flow.name))
        if (leftover) {
          draftId = leftover.id
          name = leftover.name
        } else {
          name = nextAddressFormName(flows.map((flow) => flow.name))
        }
      }

      console.log('[Meta Deploy Flow] Compiling SHIPPING_ADDRESS template...')
      const compiledJson = compileMetaFlowJSON(addressFormScreens(org))

      const uploadId = await uploadNativeFlow(
        credentials,
        {
          name,
          categories: [template.category],
          flow_id_meta: draftId,
        },
        compiledJson,
        // Without a published form, the draft ID is saved as soon as Meta returns it, so a failed
        // publish can be retried. A store with one keeps sending it until the new version is live.
        replacing ? async () => {} : saveFlowId
      )

      console.log(`[Meta Deploy Flow] Publishing flow ID: ${uploadId}...`)
      const published = await metaRequest(credentials, `${uploadId}/publish`, { method: 'POST' })
      if (published.success !== true) throw new Error('Meta did not confirm that the flow was published')

      await saveFlowId(uploadId)

      return NextResponse.json({
        success: true,
        flowId: uploadId,
        replaced: replacing ? linkedId : null,
        message: replacing
          ? `“${name}” is published with the current express delivery charge and is sent from now on.`
          : 'Successfully created, uploaded, and published WhatsApp Delivery Address Flow on Meta!',
      })
    }

    // Action B: 1-Click Enable Native Cart and Catalog Visibility
    if (action === 'enable_cart') {
      if (!credentials.phoneNumberId) {
        throw new Error('Phone Number ID is missing in organization settings')
      }

      try {
        await setCommerceSettings(credentials, { is_cart_enabled: true, is_catalog_visible: true })
      } catch (error: any) {
        return NextResponse.json({ error: explainCommerceError(error?.message) }, { status: 422 })
      }

      return NextResponse.json({
        success: true,
        message: 'Successfully enabled native Cart and Catalog visibility in WhatsApp!',
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err: any) {
    console.error('[API Commerce Meta Detect POST] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
