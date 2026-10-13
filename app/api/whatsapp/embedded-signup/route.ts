import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthenticatedUser, verifyOrgAccess } from '@/lib/api-auth-helper'
import { inspectToken } from '@/lib/commerce/meta-catalog'
import { LEGACY_REGISTRATION_PIN, PIN_MISMATCH_ERROR_CODE, getPublicBaseUrl, getRegistrationPin, getWebhookOverride, parseSignupSession, type WebhookOverride } from '@/lib/whatsapp-onboarding'

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
    const { code, accessToken: directAccessToken, organizationId: requestedOrgId } = body
    // IDs reported by the signup window. They are only ever used with the customer's own token.
    const session = parseSignupSession(body)

    const targetOrgId = requestedOrgId || user.organization_id
    if (!targetOrgId) {
      return NextResponse.json({ success: false, error: 'Target organization ID is required' }, { status: 400 })
    }

    const accessCheck = await verifyOrgAccess(request, targetOrgId, { permission: 'settings.manage' })
    if (!accessCheck.authorized) {
      return NextResponse.json({ success: false, error: accessCheck.error }, { status: accessCheck.status })
    }

    const appId = process.env.NEXT_PUBLIC_META_APP_ID || '1747554262928162'
    // The app secret lives in the environment only. It must never be written into the source.
    const appSecret = process.env.META_APP_SECRET
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

    let wabaId = session.wabaId
    let phoneNumberId = session.phoneNumberId
    let displayPhoneNumber = ''
    let verifiedName = ''
    let sharedCatalogId = session.catalogIds[0] || ''

    // 1c. If the signup window did not report what was shared, ask Meta what the token was granted
    if (!wabaId || !sharedCatalogId) {
      const access = await inspectToken(finalAccessToken, { id: appId, secret: appSecret }, graphVersion)
      if (!wabaId) wabaId = access?.targets.whatsapp_business_management?.[0] || ''
      if (!sharedCatalogId) sharedCatalogId = access?.targets.catalog_management?.[0] || ''
    }

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

    // 4. Subscribe this app to the customer's WhatsApp Business account, and have Meta deliver its
    // events to this organization's own webhook address. A Meta app has one callback address, so
    // without this the customer could send but would never receive anything.
    const webhook: { routed: boolean; reason?: string } = { routed: false }
    if (wabaId) {
      const subscribe = async (body?: WebhookOverride) => {
        const subRes = await fetch(`https://graph.facebook.com/${graphVersion}/${wabaId}/subscribed_apps`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${finalAccessToken}`, 'Content-Type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        })
        return subRes.json()
      }
      try {
        console.log(`[Meta Embedded Signup] Subscribing app to WABA ${wabaId}...`)
        const override = getWebhookOverride(targetOrgId, getPublicBaseUrl(request))
        if (!override) {
          webhook.reason = 'This server has no public https address to give Meta. Set NEXT_PUBLIC_APP_URL to your live site address and reconnect.'
          await subscribe()
        } else {
          const subData = await subscribe(override)
          if (subData?.success === true) {
            webhook.routed = true
          } else {
            webhook.reason = subData?.error?.message || 'Meta did not accept this workspace’s webhook address.'
            // Stay subscribed on the app's default address rather than not at all
            await subscribe()
          }
        }
        console.log('[Meta Embedded Signup] Webhook subscription:', webhook)
      } catch (err) {
        webhook.reason = 'Meta could not be reached to set up incoming messages.'
        console.warn('[Meta Embedded Signup] Failed to subscribe app to WABA (non-fatal):', err)
      }
    } else {
      webhook.reason = 'Meta did not say which WhatsApp Business account was connected.'
    }

    // 4b. Register the phone number with Meta Cloud API for messaging.
    // The PIN becomes the number's two-step verification PIN, so each number gets its own.
    if (phoneNumberId) {
      const register = async (pin: string) => {
        const regRes = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/register`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${finalAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
        })
        return regRes.json()
      }
      try {
        console.log(`[Meta Embedded Signup] Registering phone number ${phoneNumberId} with Cloud API...`)
        const pin = getRegistrationPin(phoneNumberId)
        let regData = await register(pin)
        // A number registered before per-number PINs still carries the old one
        if (regData?.error?.code === PIN_MISMATCH_ERROR_CODE && pin !== LEGACY_REGISTRATION_PIN) {
          regData = await register(LEGACY_REGISTRATION_PIN)
        }
        console.log(`[Meta Embedded Signup] Phone registration response:`, regData?.error ? { error: regData.error.message } : regData)
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

    // A catalog the customer shared during signup becomes the store's catalog, unless one is already linked
    let linkedCatalogId = ''
    if (sharedCatalogId) {
      const { data: current } = await admin.from('organizations').select('meta_catalog_id').eq('id', targetOrgId).maybeSingle()
      if (!String(current?.meta_catalog_id || '').trim()) {
        updatePayload.meta_catalog_id = sharedCatalogId
        linkedCatalogId = sharedCatalogId
      }
    }

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
        catalogId: linkedCatalogId || undefined,
        // Whether Meta now delivers this account's incoming messages to this organization
        webhook,
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

    const accessCheck = await verifyOrgAccess(request, targetOrgId, { permission: 'settings.manage' })
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

