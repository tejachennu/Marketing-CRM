import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOrgAccess } from '@/lib/api-auth-helper'
import { getMetaCredentials, metaRequest, uploadNativeFlow } from '@/lib/flows/meta-client'
import { compileMetaFlowJSON, NATIVE_FLOW_TEMPLATES } from '@/lib/flows/meta-flows-spec'
import { formatMoney, getExpressFee } from '@/lib/commerce/commerce-utils'
import { describeCatalogError, flattenPaymentConfigurations, getCatalogCredentials, setCommerceSettings } from '@/lib/commerce/meta-catalog'

/**
 * The address form with this store's delivery options: the express choice shows what it costs,
 * so the customer knows before choosing it rather than after.
 */
function addressFormScreens(org: any) {
  const screens = structuredClone(NATIVE_FLOW_TEMPLATES.SHIPPING_ADDRESS.screens) as any[]
  const fee = getExpressFee(org)
  const expressTitle = (fee > 0 ? `Express delivery (+${formatMoney(fee, org.currency)})` : 'Express delivery').slice(0, 30)
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

    const [catalogs, payments, flows, settings] = await Promise.all([
      // Listing the account's catalog needs catalog access: the catalog connection when the store made one
      attempt(async () => (await metaRequest(getCatalogCredentials(org), `${wabaId}/product_catalogs?fields=id,name,vertical,product_count`))?.data || []),
      attempt(async () => flattenPaymentConfigurations(await metaRequest(credentials, `${wabaId}/payment_configurations`))),
      attempt(async () => (await metaRequest(credentials, `${wabaId}/flows?fields=id,name,status,categories`))?.data || []),
      phoneNumberId
        ? attempt(async () => (await metaRequest(credentials, `${phoneNumberId}/whatsapp_commerce_settings`))?.data?.[0] || null)
        : Promise.resolve({ value: null, error: 'No WhatsApp number is connected.' }),
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

    // Action A: 1-Click Deploy & Publish Standard Delivery Address Flow
    if (action === 'deploy_address_flow') {
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

      // Deploying twice must not create a second flow: Meta rejects duplicate flow names,
      // which used to leave a half-created draft that could never be published.
      let existingId: string | null = org.commerce_address_flow_id || null
      if (existingId) {
        try {
          const remote = await metaRequest(credentials, `${existingId}?fields=id,status`)
          if (remote.status === 'PUBLISHED') {
            return NextResponse.json({
              success: true,
              flowId: existingId,
              message: 'The WhatsApp Delivery Address Flow is already published on Meta.',
            })
          }
          if (remote.status !== 'DRAFT') existingId = null // deprecated or blocked: start a new one
        } catch {
          existingId = null // the saved ID no longer exists on this WhatsApp account
        }
      }

      console.log('[Meta Deploy Flow] Compiling SHIPPING_ADDRESS template...')
      const compiledJson = compileMetaFlowJSON(addressFormScreens(org))

      const uploadId = await uploadNativeFlow(
        credentials,
        {
          name: 'WhatsApp Store Delivery Address',
          categories: [template.category],
          flow_id_meta: existingId,
        },
        compiledJson,
        // Save the draft ID as soon as Meta returns it, so a failed publish can be retried
        saveFlowId
      )

      console.log(`[Meta Deploy Flow] Publishing flow ID: ${uploadId}...`)
      const published = await metaRequest(credentials, `${uploadId}/publish`, { method: 'POST' })
      if (published.success !== true) throw new Error('Meta did not confirm that the flow was published')

      await saveFlowId(uploadId)

      return NextResponse.json({
        success: true,
        flowId: uploadId,
        message: 'Successfully created, uploaded, and published WhatsApp Delivery Address Flow on Meta!',
      })
    }

    // Action B: 1-Click Enable Native Cart and Catalog Visibility
    if (action === 'enable_cart') {
      if (!credentials.phoneNumberId) {
        throw new Error('Phone Number ID is missing in organization settings')
      }

      await setCommerceSettings(credentials, { is_cart_enabled: true, is_catalog_visible: true })

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
