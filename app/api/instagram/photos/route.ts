import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { removePostPhotos, savePostPhoto } from '@/lib/instagram/store'
import { POST_PHOTO_MAX_BYTES } from '@/lib/instagram/rules'
import { checkRateLimit } from '@/lib/rate-limiter'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST multipart { organizationId, file }: a photo picked on the device for a new Instagram post. Saved as a
 * JPEG Instagram accepts; the link goes to POST /api/instagram/posts, which deletes it once the post is up.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null)
  const organizationId = String(form?.get('organizationId') || '')
  const access = await verifyOrgAccess(request, organizationId, { permission: 'automation.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  if (!checkRateLimit(`ig-photo:${organizationId}`, 60, 60 * 60_000).allowed) return NextResponse.json({ error: 'Many photos in a short time. Please wait a little.' }, { status: 429 })
  const file = form?.get('file')
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'Pick a photo to upload.' }, { status: 400 })
  if (file.size > POST_PHOTO_MAX_BYTES) return NextResponse.json({ error: 'This photo is too big (15 MB). Please pick a smaller one.' }, { status: 400 })
  if (file.type && !file.type.startsWith('image/')) return NextResponse.json({ error: 'Only photos can be posted here.' }, { status: 400 })
  const saved = await savePostPhoto(getSupabaseAdminClient(), organizationId, Buffer.from(await file.arrayBuffer()))
  if ('error' in saved) return NextResponse.json({ error: saved.error }, { status: 400 })
  return NextResponse.json({ success: true, url: saved.url })
}

/** DELETE { organizationId, urls }: photos taken off the new post (or Cancel) before posting. */
export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'automation.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const removed = await removePostPhotos(getSupabaseAdminClient(), body.organizationId, Array.isArray(body.urls) ? body.urls.slice(0, 10) : [])
  return NextResponse.json({ success: true, removed })
}
