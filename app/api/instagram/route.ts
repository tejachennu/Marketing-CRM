import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { accountFor, connectInstagram, disconnectInstagram, instagramChecks, publicAccount, subscribeWebhooks } from '@/lib/instagram/store'
import { IG_PERMISSIONS } from '@/lib/instagram/rules'

export const runtime = 'nodejs'

/** GET ?organizationId=&checks=1: the connected Instagram account (no token), what the login window needs, and what still blocks DMs / comments. */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const organizationId = params.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const db = getSupabaseAdminClient()
  const account = await accountFor(db, organizationId!).catch(() => null)
  const checks = account && params.get('checks') === '1' ? await instagramChecks(db, organizationId!).catch(() => null) : null
  return NextResponse.json({
    account: publicAccount(account),
    checks,
    login: { appId: process.env.NEXT_PUBLIC_META_APP_ID || process.env.META_APP_ID || '', configId: process.env.NEXT_PUBLIC_META_INSTAGRAM_CONFIG_ID || '', permissions: IG_PERMISSIONS },
  })
}

/**
 * POST { organizationId, code, redirectUri? }   finish the Instagram login (Unified Login) and connect
 * POST { organizationId, action: 'resubscribe' } ask Meta again to send DMs and comments here
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'settings.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const db = getSupabaseAdminClient()
  try {
    if (body.action === 'resubscribe') {
      const account = await accountFor(db, body.organizationId)
      if (!account) return NextResponse.json({ error: 'Instagram is not connected.' }, { status: 404 })
      const ok = await subscribeWebhooks(db, account)
      return NextResponse.json({ success: ok, account: publicAccount({ ...(await accountFor(db, body.organizationId)) }) })
    }
    if (typeof body.code !== 'string' || body.code.length < 10) return NextResponse.json({ error: 'The login did not finish. Please try again.' }, { status: 400 })
    const result = await connectInstagram(db, body.organizationId, { code: body.code, redirectUri: typeof body.redirectUri === 'string' ? body.redirectUri : undefined, userId: access.user?.id || null })
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ success: true, account: result.account })
  } catch (error: any) {
    console.error('[Instagram connect]', error?.message)
    return NextResponse.json({ error: `Instagram could not be connected: ${error?.message || 'please try again'}` }, { status: 502 })
  }
}

/** DELETE ?organizationId=: disconnect (stops webhooks; chats and comments already saved stay). */
export async function DELETE(request: NextRequest) {
  const organizationId = new URL(request.url).searchParams.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId, { permission: 'settings.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  await disconnectInstagram(getSupabaseAdminClient(), organizationId!)
  return NextResponse.json({ success: true })
}
