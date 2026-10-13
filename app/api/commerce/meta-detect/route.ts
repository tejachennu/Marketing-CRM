import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOrgAccess } from '@/lib/api-auth-helper'
import { getMetaCredentials, metaRequest, uploadNativeFlow } from '@/lib/flows/meta-client'
import { compileMetaFlowJSON, NATIVE_FLOW_TEMPLATES } from '@/lib/flows/meta-flows-spec'

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

    const authResult = await verifyOrgAccess(request, orgId)
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

    // 1. Auto-fetch Payment Configurations from Meta
    let paymentConfigs: any[] = []
    try {
      const payRes = await metaRequest(credentials, `${wabaId}/payment_configurations`)
      paymentConfigs = payRes?.data || []
    } catch (payErr: any) {
      console.warn('[Meta Detect] Payment configs fetch note:', payErr.message)
    }

    // 2. Auto-fetch Product Catalogs from Meta
    let catalogs: any[] = []
    try {
      // Try product_catalogs first
      const catRes = await metaRequest(
        credentials,
        `${wabaId}/product_catalogs?fields=id,name,vertical,product_count`
      )
      catalogs = catRes?.data || []
    } catch (catErr: any) {
      try {
        // Fallback to assigned_product_catalogs
        const catRes2 = await metaRequest(
          credentials,
          `${wabaId}/assigned_product_catalogs?fields=id,name,vertical,product_count`
        )
        catalogs = catRes2?.data || []
      } catch (catErr2: any) {
        console.warn('[Meta Detect] Catalogs fetch note:', catErr2.message)
      }
    }

    // 3. Auto-fetch Existing Flows from Meta
    let flows: any[] = []
    try {
      const flowRes = await metaRequest(credentials, `${wabaId}/flows?fields=id,name,status,categories`)
      flows = flowRes?.data || []
    } catch (flowErr: any) {
      console.warn('[Meta Detect] Flows fetch note:', flowErr.message)
    }

    // 4. Auto-fetch Current WhatsApp Commerce Settings
    let commerceSettings: any = null
    if (phoneNumberId) {
      try {
        const commRes = await metaRequest(credentials, `${phoneNumberId}/whatsapp_commerce_settings`)
        commerceSettings = commRes?.data?.[0] || null
      } catch (commErr: any) {
        console.warn('[Meta Detect] Commerce settings note:', commErr.message)
      }
    }

    return NextResponse.json({
      success: true,
      wabaId,
      phoneNumberId,
      paymentConfigs,
      catalogs,
      flows,
      commerceSettings,
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

    const authResult = await verifyOrgAccess(request, organizationId)
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
      const compiledJson = compileMetaFlowJSON(template.screens)

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

      await metaRequest(credentials, `${credentials.phoneNumberId}/whatsapp_commerce_settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_cart_enabled: true,
          is_catalog_visible: true,
        }),
      })

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
