import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthenticatedUser, verifyOrgAccess } from '@/lib/api-auth-helper'

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing Supabase admin environment variables')
  }
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request)
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Please log in' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const {
      code,
      accessToken: directAccessToken,
      wabaId: incomingWabaId,
      phoneNumberId: incomingPhoneNumberId,
      organizationId: requestedOrgId,
    } = body

    const targetOrgId = requestedOrgId || user.organization_id
    if (!targetOrgId) {
      return NextResponse.json({ success: false, error: 'Target organization ID is required' }, { status: 400 })
    }

    const accessCheck = await verifyOrgAccess(request, targetOrgId)
    if (!accessCheck.authorized) {
      return NextResponse.json({ success: false, error: accessCheck.error }, { status: accessCheck.status })
    }

    const appId = process.env.NEXT_PUBLIC_META_APP_ID || '1747554262928162'
    const appSecret = process.env.META_APP_SECRET || '7265702af260e098afcd8328559e5b9a'
    const graphVersion = 'v22.0'

    let finalAccessToken = directAccessToken || ''

    // 1. If an authorization code was returned, exchange it with Meta OAuth for the access token
    if (code && !finalAccessToken) {
      if (!appSecret) {
        return NextResponse.json(
          {
            success: false,
            error:
              'META_APP_SECRET is not configured on the server. Please add META_APP_SECRET to your environment variables to complete the code exchange.',
            codeReceived: true,
          },
          { status: 500 }
        )
      }

      console.log(`[Meta Embedded Signup] Exchanging authorization code for access token (App ID: ${appId})...`)

      const tokenUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`)
      tokenUrl.searchParams.set('client_id', appId)
      tokenUrl.searchParams.set('client_secret', appSecret)
      tokenUrl.searchParams.set('code', code)

      const tokenRes = await fetch(tokenUrl.toString(), { method: 'GET' })
      const tokenData = await tokenRes.json()

      if (!tokenRes.ok || tokenData.error) {
        const errorMsg = tokenData.error?.message || 'Failed to exchange authorization code with Meta'
        console.error('[Meta Embedded Signup] Code exchange error:', tokenData)
        return NextResponse.json({ success: false, error: errorMsg, details: tokenData.error }, { status: 400 })
      }

      finalAccessToken = tokenData.access_token

      // 1b. Automatically exchange for a long-lived/permanent business access token
      try {
        console.log(`[Meta Embedded Signup] Upgrading to long-lived access token...`)
        const longLivedUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`)
        longLivedUrl.searchParams.set('grant_type', 'fb_exchange_token')
        longLivedUrl.searchParams.set('client_id', appId)
        longLivedUrl.searchParams.set('client_secret', appSecret)
        longLivedUrl.searchParams.set('fb_exchange_token', finalAccessToken)

        const longLivedRes = await fetch(longLivedUrl.toString(), { method: 'GET' })
        const longLivedData = await longLivedRes.json()
        if (longLivedData.access_token) {
          finalAccessToken = longLivedData.access_token
          console.log('[Meta Embedded Signup] Successfully upgraded to long-lived business token!')
        }
      } catch (upgradeErr) {
        console.warn('[Meta Embedded Signup] Long-lived upgrade notice (continuing with base token):', upgradeErr)
      }
    }

    if (!finalAccessToken) {
      return NextResponse.json(
        { success: false, error: 'No valid authorization code or access token provided.' },
        { status: 400 }
      )
    }

    let wabaId = incomingWabaId || ''
    let phoneNumberId = incomingPhoneNumberId || ''
    let displayPhoneNumber = ''
    let verifiedName = ''

    // 2. If phone_number_id is provided, fetch its phone number details from Meta Graph API
    if (phoneNumberId) {
      try {
        const phoneRes = await fetch(
          `https://graph.facebook.com/${graphVersion}/${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status`,
          {
            headers: { Authorization: `Bearer ${finalAccessToken}` },
          }
        )
        const phoneData = await phoneRes.json()
        if (phoneRes.ok && phoneData && !phoneData.error) {
          displayPhoneNumber = phoneData.display_phone_number || ''
          verifiedName = phoneData.verified_name || ''
        } else {
          console.warn('[Meta Embedded Signup] Could not fetch phone details:', phoneData?.error?.message)
        }
      } catch (err) {
        console.warn('[Meta Embedded Signup] Fetch phone error:', err)
      }
    }

    // 3. If wabaId is provided but phoneNumberId wasn't, attempt to query the WABA phone numbers list
    if (wabaId && (!phoneNumberId || !displayPhoneNumber)) {
      try {
        const listRes = await fetch(
          `https://graph.facebook.com/${graphVersion}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`,
          {
            headers: { Authorization: `Bearer ${finalAccessToken}` },
          }
        )
        const listData = await listRes.json()
        if (listRes.ok && Array.isArray(listData?.data) && listData.data.length > 0) {
          const firstPhone = listData.data[0]
          if (!phoneNumberId) phoneNumberId = firstPhone.id
          if (!displayPhoneNumber) displayPhoneNumber = firstPhone.display_phone_number
          if (!verifiedName) verifiedName = firstPhone.verified_name
        }
      } catch (err) {
        console.warn('[Meta Embedded Signup] Fetch WABA phone numbers error:', err)
      }
    }

    // 4. Subscribe the WABA to this app's webhooks so incoming messages, flow responses & statuses are received
    if (wabaId) {
      try {
        console.log(`[Meta Embedded Signup] Subscribing app to WABA ${wabaId}...`)
        const subRes = await fetch(`https://graph.facebook.com/${graphVersion}/${wabaId}/subscribed_apps`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${finalAccessToken}`,
            'Content-Type': 'application/json',
          },
        })
        const subData = await subRes.json()
        console.log(`[Meta Embedded Signup] Subscribed apps response:`, subData)
      } catch (err) {
        console.warn('[Meta Embedded Signup] Failed to subscribe app to WABA (non-fatal):', err)
      }
    }

    // 4b. Register the phone number with Meta Cloud API for messaging
    if (phoneNumberId) {
      try {
        console.log(`[Meta Embedded Signup] Registering phone number ${phoneNumberId} with Cloud API...`)
        const regRes = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/register`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${finalAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            pin: '123456',
          }),
        })
        const regData = await regRes.json()
        console.log(`[Meta Embedded Signup] Phone registration response:`, regData)
      } catch (err) {
        console.warn('[Meta Embedded Signup] Phone registration call warning (non-fatal):', err)
      }
    }

    // 5. Save credentials to Supabase organization settings
    const admin = getSupabaseAdmin()
    const updatePayload: Record<string, any> = {
      whatsapp_provider: 'facebook',
      whatsapp_api_token: finalAccessToken,
      whatsapp_graph_api_version: graphVersion,
    }

    if (wabaId) updatePayload.whatsapp_business_account_id = wabaId
    if (phoneNumberId) updatePayload.whatsapp_phone_number_id = phoneNumberId
    if (displayPhoneNumber) updatePayload.whatsapp_default_phone = displayPhoneNumber

    const { error: updateError } = await admin
      .from('organizations')
      .update(updatePayload)
      .eq('id', targetOrgId)

    if (updateError) {
      console.error('[Meta Embedded Signup] Database update error:', updateError)
      return NextResponse.json(
        { success: false, error: `Failed to save credentials: ${updateError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'WhatsApp Business Account successfully connected via Meta Embedded Signup!',
      data: {
        provider: 'facebook',
        wabaId,
        phoneNumberId,
        displayPhoneNumber,
        verifiedName,
        graphVersion,
      },
    })
  } catch (error: any) {
    console.error('[Meta Embedded Signup] Unexpected error:', error)
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request)
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Please log in' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const targetOrgId = searchParams.get('organizationId') || user.organization_id
    if (!targetOrgId) {
      return NextResponse.json({ success: false, error: 'Target organization ID is required' }, { status: 400 })
    }

    const accessCheck = await verifyOrgAccess(request, targetOrgId)
    if (!accessCheck.authorized) {
      return NextResponse.json({ success: false, error: accessCheck.error }, { status: accessCheck.status })
    }

    const admin = getSupabaseAdmin()
    const { error: updateError } = await admin
      .from('organizations')
      .update({
        whatsapp_phone_number_id: null,
        whatsapp_business_account_id: null,
        whatsapp_default_phone: null,
        whatsapp_api_token: null,
      })
      .eq('id', targetOrgId)

    if (updateError) {
      console.error('[Meta Embedded Signup] Database disconnect error:', updateError)
      return NextResponse.json(
        { success: false, error: `Failed to disconnect WhatsApp: ${updateError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'WhatsApp Business Account disconnected successfully',
    })
  } catch (error: any) {
    console.error('[Meta Embedded Signup] Disconnect error:', error)
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}

