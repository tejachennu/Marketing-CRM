import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { latestPosts, publishPost } from '@/lib/instagram/store'
import { checkRateLimit } from '@/lib/rate-limiter'

export const runtime = 'nodejs'
export const maxDuration = 60

/** GET ?organizationId=&fresh=1: the latest Instagram posts (cached 30 minutes unless fresh). */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const organizationId = params.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  return NextResponse.json(await latestPosts(getSupabaseAdminClient(), organizationId!, { fresh: params.get('fresh') === '1' }))
}

/** POST { organizationId, images: [https…], caption }: post on Instagram (one photo or a carousel of up to 10). */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'automation.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  if (!checkRateLimit(`ig-publish:${body.organizationId}`, 20, 60 * 60_000).allowed) return NextResponse.json({ error: 'Many posts in a short time. Please wait a little.' }, { status: 429 })
  const result = await publishPost(getSupabaseAdminClient(), body.organizationId, { images: Array.isArray(body.images) ? body.images.map(String) : [], caption: String(body.caption || '') })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ success: true, mediaId: result.mediaId })
}
