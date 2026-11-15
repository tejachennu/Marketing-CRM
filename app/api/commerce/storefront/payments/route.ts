import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { withStorefrontSchema } from '@/lib/commerce/storefront'
import { checkStoreKeys, isKeyId } from '@/lib/commerce/store-payments'

export const runtime = 'nodejs'

const appUrl = (request: NextRequest) => (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '')

async function load(db: any, organizationId: string) {
  return withStorefrontSchema(() => db.from('organizations').select('id, slug, store_razorpay_key_id, store_razorpay_key_secret, store_razorpay_webhook_secret').eq('id', organizationId).maybeSingle())
}

function view(org: any, request: NextRequest) {
  const keyId = String(org?.store_razorpay_key_id || '')
  return {
    connected: Boolean(keyId && org?.store_razorpay_key_secret),
    keyId: keyId || null,
    live: keyId.startsWith('rzp_live_'),
    webhook: Boolean(org?.store_razorpay_webhook_secret),
    webhookUrl: org?.slug ? `${appUrl(request)}/api/public/store/${org.slug}/razorpay-webhook` : null,
  }
}

// GET: is the business's Razorpay connected for the store page (never the secrets)
export async function GET(request: NextRequest) {
  const organizationId = new URL(request.url).searchParams.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId, { permission: 'automation.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const { data: org, error } = await load(getSupabaseAdminClient(), organizationId!)
  if (error || !org) return NextResponse.json({ error: error?.message || 'Workspace not found' }, { status: 500 })
  return NextResponse.json(view(org, request))
}

// PUT { organizationId, keyId, keySecret?, webhookSecret? }: check the keys with Razorpay, then save them (admins)
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'settings.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const db = getSupabaseAdminClient()
  const { data: org } = await load(db, body.organizationId)
  if (!org) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  const keyId = String(body?.keyId || '').trim()
  if (!isKeyId(keyId)) return NextResponse.json({ error: 'The Key ID starts with rzp_live_ or rzp_test_. Copy it from Razorpay → Account & Settings → API Keys.' }, { status: 400 })
  // A blank secret keeps the saved one, but only for the same Key ID
  const keySecret = String(body?.keySecret || '').trim() || (keyId === org.store_razorpay_key_id ? String(org.store_razorpay_key_secret || '') : '')
  if (!keySecret) return NextResponse.json({ error: 'Enter the Key Secret too.' }, { status: 400 })
  const checked = await checkStoreKeys({ keyId, keySecret })
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })
  const webhookSecret = body?.webhookSecret === undefined ? org.store_razorpay_webhook_secret : String(body.webhookSecret || '').trim().slice(0, 200) || null
  const { data: saved, error } = await db.from('organizations').update({ store_razorpay_key_id: keyId, store_razorpay_key_secret: keySecret, store_razorpay_webhook_secret: webhookSecret }).eq('id', org.id).select('id, slug, store_razorpay_key_id, store_razorpay_key_secret, store_razorpay_webhook_secret').maybeSingle()
  if (error || !saved) return NextResponse.json({ error: error?.message || 'The keys could not be saved.' }, { status: 500 })
  return NextResponse.json({ success: true, ...view(saved, request) })
}

// DELETE ?organizationId=: disconnect Razorpay (admins). The store page goes back to pay on delivery / pick up.
export async function DELETE(request: NextRequest) {
  const organizationId = new URL(request.url).searchParams.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId, { permission: 'settings.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const db = getSupabaseAdminClient()
  await db.from('organizations').update({ store_razorpay_key_id: null, store_razorpay_key_secret: null, store_razorpay_webhook_secret: null }).eq('id', organizationId)
  const { data: org } = await load(db, organizationId!)
  return NextResponse.json({ success: true, ...view(org, request) })
}
