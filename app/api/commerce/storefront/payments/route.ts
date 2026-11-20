import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { withStorefrontSchema } from '@/lib/commerce/storefront'
import { checkStoreKeys, isKeyId } from '@/lib/commerce/store-payments'
import { checkStripeKey, isStripeKey, isStripeWebhookSecret, stripeLive } from '@/lib/payments/stripe'
import { connectedGateways, onlineGateway, type Gateway } from '@/lib/payments/gateway'
import { withPaymentsSchema } from '@/lib/payments/schema'

export const runtime = 'nodejs'

/**
 * The business's own online payment accounts, used by the store page and by bookings (website and booking page):
 * Razorpay (UPI, cards, net banking) and Stripe (cards, Apple Pay, Google Pay). Keys are checked with the
 * gateway, then saved; secrets are never sent back.
 */

const appUrl = (request: NextRequest) => (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '')

async function load(db: any, organizationId: string) {
  // '*' never fails on a column that is not there yet
  return db.from('organizations').select('*').eq('id', organizationId).maybeSingle()
}

function view(org: any, request: NextRequest) {
  const keyId = String(org?.store_razorpay_key_id || '')
  const stripeKey = String(org?.stripe_secret_key || '')
  const base = org?.slug ? `${appUrl(request)}/api/public/store/${org.slug}` : null
  return {
    // Razorpay (kept at the top level for the app's older screens)
    connected: Boolean(keyId && org?.store_razorpay_key_secret),
    keyId: keyId || null,
    live: keyId.startsWith('rzp_live_'),
    webhook: Boolean(org?.store_razorpay_webhook_secret),
    webhookUrl: base ? `${base}/razorpay-webhook` : null,
    stripe: {
      connected: Boolean(stripeKey),
      // Only the start and the last 4 characters, so the owner can tell which key it is
      key: stripeKey ? `${stripeKey.slice(0, 8)}…${stripeKey.slice(-4)}` : null,
      live: stripeLive(stripeKey),
      webhook: Boolean(org?.stripe_webhook_secret),
      webhookUrl: base ? `${base}/stripe-webhook` : null,
    },
    gateways: connectedGateways(org),
    use: onlineGateway(org),
  }
}

// GET: which online payments are connected (never the secrets)
export async function GET(request: NextRequest) {
  const organizationId = new URL(request.url).searchParams.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId, { permission: 'automation.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const { data: org, error } = await load(getSupabaseAdminClient(), organizationId!)
  if (error || !org) return NextResponse.json({ error: error?.message || 'Workspace not found' }, { status: 500 })
  return NextResponse.json(view(org, request))
}

/**
 * PUT (admins):
 *   { organizationId, keyId, keySecret?, webhookSecret? }                     Razorpay keys
 *   { organizationId, gateway: 'stripe', secretKey?, webhookSecret? }          Stripe keys
 *   { organizationId, use: 'razorpay' | 'stripe' }                             which one customers pay through
 */
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'settings.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const db = getSupabaseAdminClient()
  const { data: org } = await load(db, body.organizationId)
  if (!org) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  const save = async (patch: Record<string, unknown>, schema: 'store' | 'payments') => {
    const step = () => db.from('organizations').update(patch).eq('id', org.id).select('id').maybeSingle()
    const { data, error } = schema === 'store' ? await withStorefrontSchema(step) : await withPaymentsSchema(step)
    if (error || !data) throw new Error(error?.message || 'The keys could not be saved.')
    const { data: fresh } = await load(db, org.id)
    return NextResponse.json({ success: true, ...view(fresh, request) })
  }

  try {
    if (body?.use !== undefined) {
      const use = body.use as Gateway
      if (!connectedGateways(org).includes(use)) return NextResponse.json({ error: 'Connect it first.' }, { status: 400 })
      return await save({ pay_gateway: use }, 'payments')
    }

    if (body?.gateway === 'stripe') {
      const typed = String(body?.secretKey || '').trim()
      const secretKey = typed || String(org.stripe_secret_key || '')
      if (!secretKey) return NextResponse.json({ error: 'Paste your Stripe Secret key (it starts with sk_live_ or sk_test_).' }, { status: 400 })
      if (typed && !isStripeKey(typed)) return NextResponse.json({ error: 'The Secret key starts with sk_live_ or sk_test_. Copy it from Stripe → Developers → API keys.' }, { status: 400 })
      if (typed) {
        const checked = await checkStripeKey(typed)
        if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })
      }
      let webhookSecret = org.stripe_webhook_secret || null
      if (body?.webhookSecret !== undefined) {
        const w = String(body.webhookSecret || '').trim()
        if (w && !isStripeWebhookSecret(w)) return NextResponse.json({ error: 'The signing secret starts with whsec_. Copy it from the webhook in Stripe.' }, { status: 400 })
        webhookSecret = w || null
      }
      return await save({ stripe_secret_key: secretKey, stripe_webhook_secret: webhookSecret, ...(connectedGateways(org).length ? {} : { pay_gateway: 'stripe' }) }, 'payments')
    }

    const keyId = String(body?.keyId || '').trim()
    if (!isKeyId(keyId)) return NextResponse.json({ error: 'The Key ID starts with rzp_live_ or rzp_test_. Copy it from Razorpay → Account & Settings → API Keys.' }, { status: 400 })
    // A blank secret keeps the saved one, but only for the same Key ID
    const keySecret = String(body?.keySecret || '').trim() || (keyId === org.store_razorpay_key_id ? String(org.store_razorpay_key_secret || '') : '')
    if (!keySecret) return NextResponse.json({ error: 'Enter the Key Secret too.' }, { status: 400 })
    const checked = await checkStoreKeys({ keyId, keySecret })
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })
    const webhookSecret = body?.webhookSecret === undefined ? org.store_razorpay_webhook_secret : String(body.webhookSecret || '').trim().slice(0, 200) || null
    return await save({ store_razorpay_key_id: keyId, store_razorpay_key_secret: keySecret, store_razorpay_webhook_secret: webhookSecret }, 'store')
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'The keys could not be saved.' }, { status: 500 })
  }
}

// DELETE ?organizationId=&gateway=razorpay|stripe: disconnect one (admins). Without any, customers pay at the shop / on delivery.
export async function DELETE(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const organizationId = params.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId, { permission: 'settings.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const db = getSupabaseAdminClient()
  if (params.get('gateway') === 'stripe') {
    await withPaymentsSchema(() => db.from('organizations').update({ stripe_secret_key: null, stripe_webhook_secret: null }).eq('id', organizationId))
  } else {
    await db.from('organizations').update({ store_razorpay_key_id: null, store_razorpay_key_secret: null, store_razorpay_webhook_secret: null }).eq('id', organizationId)
  }
  const { data: org } = await load(db, organizationId!)
  return NextResponse.json({ success: true, ...view(org, request) })
}
