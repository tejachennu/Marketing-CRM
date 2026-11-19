import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { MAX_SOURCE_BYTES, MEDIA_MAX_BYTES, SOURCE_FILES, fileEnding, mediaTypeOf } from '@/lib/ai/knowledge-text'
import { KNOWLEDGE_BUCKET } from '@/lib/ai/knowledge-sources'

export const runtime = 'nodejs'

/**
 * POST { organizationId, fileName, size, purpose: 'source' | 'attachment' }: a one-time address the browser
 * uploads the file to (straight to storage, so big PDFs and videos work). Returns { path, token, publicUrl }.
 *  - source: a PDF, Word or text file the AI reads (up to 25 MB)
 *  - attachment: a photo, video or file sent with an FAQ's answer (WhatsApp's limits)
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const organizationId = body?.organizationId
  const access = await verifyOrgAccess(request, organizationId, { permission: 'automation.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const name = String(body?.fileName || '').slice(-120)
  const size = Number(body?.size) || 0
  const ending = fileEnding(name)
  let folder = ''
  if (body?.purpose === 'source') {
    if (!SOURCE_FILES[ending]) return NextResponse.json({ error: 'Use a PDF, Word (.docx), .txt, .md or .csv file.' }, { status: 400 })
    if (size > MAX_SOURCE_BYTES) return NextResponse.json({ error: 'The file is bigger than 25 MB. Split it into smaller files.' }, { status: 400 })
    folder = 'sources'
  } else {
    const type = mediaTypeOf(name)
    if (!type) return NextResponse.json({ error: 'Use a photo (JPG, PNG, WebP), a video (MP4) or a file (PDF, Word, Excel).' }, { status: 400 })
    if (size > MEDIA_MAX_BYTES[type]) return NextResponse.json({ error: type === 'image' ? 'Photos can be up to 5 MB on WhatsApp.' : type === 'video' ? 'Videos can be up to 16 MB on WhatsApp.' : 'Files can be up to 100 MB.' }, { status: 400 })
    folder = 'attachments'
  }
  const safe = name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60) || 'file'
  const path = `knowledge/${organizationId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}.${ending}`
  const db = getSupabaseAdminClient()
  const { data, error } = await db.storage.from(KNOWLEDGE_BUCKET).createSignedUploadUrl(path)
  if (error || !data) return NextResponse.json({ error: 'The upload could not start. Try again.' }, { status: 500 })
  const publicUrl = db.storage.from(KNOWLEDGE_BUCKET).getPublicUrl(path).data.publicUrl
  return NextResponse.json({ path, token: data.token, bucket: KNOWLEDGE_BUCKET, publicUrl })
}
