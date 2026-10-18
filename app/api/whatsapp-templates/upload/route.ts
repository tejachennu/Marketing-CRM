import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { getMetaCredentials } from '@/lib/flows/meta-client'
import { uploadSampleMedia } from '@/lib/whatsapp-templates/meta-templates'

// What Meta accepts as a template header sample. The sample only shows Meta's reviewers an
// example, so 4 MB is plenty, and it stays under the hosting platform's request size limit.
const MAX_BYTES = 4 * 1024 * 1024
const ACCEPTED: Record<string, number> = {
  'image/jpeg': MAX_BYTES,
  'image/png': MAX_BYTES,
  'video/mp4': MAX_BYTES,
  'video/3gpp': MAX_BYTES,
  'application/pdf': MAX_BYTES,
}

// POST (multipart: organizationId, file): upload a header sample, get Meta's handle back
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null)
  const organizationId = String(form?.get('organizationId') || '')
  const access = await verifyOrgAccess(request, organizationId, { permission: 'campaigns.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })

  const file = form?.get('file')
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'Choose a file to upload.' }, { status: 400 })
  const limit = ACCEPTED[file.type]
  if (!limit) return NextResponse.json({ error: 'Use a JPG or PNG image, an MP4 video, or a PDF document.' }, { status: 400 })
  if (file.size > limit) return NextResponse.json({ error: 'This sample is too large. Use a file under 4 MB; it is only an example for Meta\'s review.' }, { status: 400 })

  const { data: org } = await getSupabaseAdminClient().from('organizations').select('*').eq('id', organizationId).maybeSingle()
  let credentials
  try {
    credentials = getMetaCredentials(org || {})
  } catch {
    return NextResponse.json({ error: 'Connect WhatsApp (Cloud API) in Settings to upload template samples.' }, { status: 400 })
  }
  const appId = process.env.NEXT_PUBLIC_META_APP_ID || '1747554262928162'
  try {
    const handle = await uploadSampleMedia(credentials, appId, { name: file.name, type: file.type, bytes: await file.arrayBuffer() })
    return NextResponse.json({ handle })
  } catch (err: any) {
    return NextResponse.json({ error: err?.details?.[0]?.error_user_msg || err?.message || 'Meta did not accept the file.' }, { status: 422 })
  }
}
