import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { SHIPPING_ORG_COLUMNS, newWebhookKey, readShippingSettings, shippingView, withShippingSchema } from '@/lib/commerce/shipping'
import { shiprocketClient } from '@/lib/commerce/shiprocket'
import { delhiveryClient } from '@/lib/commerce/delhivery'
import { cleanParcel, cleanPin } from '@/lib/commerce/shipping-rules'

export const runtime = 'nodejs'

const appUrl = (request: NextRequest) => (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '')

async function load(db: any, organizationId: string) {
  return withShippingSchema(() => db.from('organizations').select(SHIPPING_ORG_COLUMNS).eq('id', organizationId).maybeSingle())
}

// GET ?organizationId=: the delivery partner settings (never the password or tokens)
export async function GET(request: NextRequest) {
  const organizationId = new URL(request.url).searchParams.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId, { permission: 'automation.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const { data: org, error } = await load(getSupabaseAdminClient(), organizationId!)
  if (error || !org) return NextResponse.json({ error: error?.message || 'Workspace not found' }, { status: 500 })
  return NextResponse.json(shippingView(org, appUrl(request)))
}

/**
 * PUT (admins):
 *   { provider: 'shiprocket', email, password?, pickupLocation? }  logs in with the API user, lists pickup places
 *   { provider: 'delhivery', token?, warehouse, pickupPin, live, sellerName, sellerAddress, gstin }  checks the token
 *   { provider: 'parcel', parcel, notify }   default box and weight, WhatsApp updates on/off
 *   { provider: 'webhook-key' }              makes (or replaces) the key couriers send with tracking updates
 */
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'settings.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const db = getSupabaseAdminClient()
  const { data: org } = await load(db, body.organizationId)
  if (!org) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  const settings = readShippingSettings(org.shipping_settings)
  const raw: any = { ...(org.shipping_settings || {}) }
  const updates: Record<string, unknown> = {}
  let locations: { name: string; pin: string; city: string; primary: boolean }[] | undefined

  if (body.provider === 'shiprocket') {
    const email = String(body.email || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Type the API user\'s email (Shiprocket → Settings → API → Configure).' }, { status: 400 })
    // A blank password keeps the saved one, but only for the same email
    const password = String(body.password || '') || (settings.shiprocket?.email === email ? String(org.shiprocket_api_password || '') : '')
    if (!password) return NextResponse.json({ error: 'Type the API user\'s password too.' }, { status: 400 })
    let token = ''
    try {
      const client = shiprocketClient({ email, password }, { onToken: (t) => { token = t } })
      locations = await client.pickupLocations()
    } catch (error: any) {
      return NextResponse.json({ error: error?.message || 'Shiprocket could not be reached.' }, { status: 400 })
    }
    if (!locations.length) return NextResponse.json({ error: 'Your Shiprocket account has no pickup address yet. Add one in Shiprocket (Settings → Pickup Addresses), then connect again.' }, { status: 400 })
    const wanted = String(body.pickupLocation || settings.shiprocket?.pickup_location || '')
    const pick = locations.find((l) => l.name === wanted) || locations.find((l) => l.primary) || locations[0]
    raw.shiprocket = { email, pickup_location: pick.name, pickup_pin: cleanPin(pick.pin) || '' }
    Object.assign(updates, { shiprocket_api_password: password, shiprocket_api_token: token || null, shiprocket_token_at: token ? new Date().toISOString() : null })
  } else if (body.provider === 'delhivery') {
    const warehouse = String(body.warehouse || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    const pickupPin = cleanPin(body.pickupPin)
    if (!warehouse) return NextResponse.json({ error: 'Type the warehouse name exactly as registered with Delhivery (capital letters matter).' }, { status: 400 })
    if (!pickupPin) return NextResponse.json({ error: 'Type the 6-digit PIN code of that warehouse.' }, { status: 400 })
    const live = body.live !== false
    const token = String(body.token || '').trim() || (settings.delhivery && settings.delhivery.live === live ? String(org.delhivery_api_token || '') : '')
    if (!token) return NextResponse.json({ error: 'Type the API token Delhivery\'s onboarding team gave you.' }, { status: 400 })
    try {
      // A PIN code check with the token: Delhivery answers 401 when the token is wrong
      await delhiveryClient({ token, warehouse, live }).pin(pickupPin)
    } catch (error: any) {
      return NextResponse.json({ error: error?.message || 'Delhivery could not be reached.' }, { status: 400 })
    }
    raw.delhivery = {
      warehouse, pickup_pin: pickupPin, live,
      seller_name: String(body.sellerName || '').trim().slice(0, 100), seller_address: String(body.sellerAddress || '').trim().slice(0, 200), gstin: String(body.gstin || '').trim().toUpperCase().slice(0, 20),
    }
    updates.delhivery_api_token = token
  } else if (body.provider === 'parcel') {
    raw.parcel = cleanParcel(body.parcel)
    raw.notify = body.notify !== false
  } else if (body.provider === 'webhook-key') {
    updates.shipping_webhook_token = newWebhookKey()
  } else {
    return NextResponse.json({ error: 'Unknown setting.' }, { status: 400 })
  }
  if (body.provider !== 'webhook-key') updates.shipping_settings = raw
  // The first partner also gets a key for tracking updates
  if (!org.shipping_webhook_token && !updates.shipping_webhook_token && (body.provider === 'shiprocket' || body.provider === 'delhivery')) updates.shipping_webhook_token = newWebhookKey()
  const { data: saved, error } = await withShippingSchema(() => db.from('organizations').update(updates).eq('id', org.id).select(SHIPPING_ORG_COLUMNS).maybeSingle())
  if (error || !saved) return NextResponse.json({ error: error?.message || 'Could not save.' }, { status: 500 })
  return NextResponse.json({ success: true, ...shippingView(saved, appUrl(request)), ...(locations ? { locations } : {}) })
}

// DELETE ?organizationId=&provider=shiprocket|delhivery: disconnect a partner (admins). Booked parcels stay as they are.
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const organizationId = searchParams.get('organizationId')
  const provider = searchParams.get('provider')
  const access = await verifyOrgAccess(request, organizationId, { permission: 'settings.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  if (provider !== 'shiprocket' && provider !== 'delhivery') return NextResponse.json({ error: 'Unknown partner.' }, { status: 400 })
  const db = getSupabaseAdminClient()
  const { data: org } = await load(db, organizationId!)
  if (!org) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  const raw: any = { ...(org.shipping_settings || {}) }
  delete raw[provider]
  const updates: Record<string, unknown> = provider === 'shiprocket'
    ? { shipping_settings: raw, shiprocket_api_password: null, shiprocket_api_token: null, shiprocket_token_at: null }
    : { shipping_settings: raw, delhivery_api_token: null }
  const { data: saved } = await withShippingSchema(() => db.from('organizations').update(updates).eq('id', org.id).select(SHIPPING_ORG_COLUMNS).maybeSingle())
  return NextResponse.json({ success: true, ...shippingView(saved || org, appUrl(request)) })
}
