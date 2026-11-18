import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireUser } from '@/lib/api-auth-helper'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseKey)
}

const TYPES_BY_ENDING: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', '3gp': 'video/3gpp',
  m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/opus', amr: 'audio/amr',
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv', txt: 'text/plain',
}
function typeFromName(name: string): string | null {
  return TYPES_BY_ENDING[(name.split('.').pop() || '').toLowerCase()] || null
}

export async function POST(request: NextRequest) {
  try {
    // Uploads land in a public bucket via the service role, so require a signed-in user
    const authResult = await requireUser(request, { permission: 'records.write' })
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    // Some browsers send no type (often .m4a / .heic): the file's ending tells it. Instagram and WhatsApp go by
    // the type the file is served with, so a wrong one makes them refuse it.
    const mimeType = (file.type && file.type !== 'application/octet-stream' ? file.type : typeFromName(file.name)) || 'application/octet-stream'

    // Try uploading to Supabase Storage 'media-attachments' public bucket
    try {
      const supabase = getSupabaseClient()
      const rawExt = file.name.split('.').pop() || mimeType.split('/')[1] || 'bin'
      const ext = rawExt.replace(/[^a-zA-Z0-9]/g, '')
      const safeBaseName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_')
      const storagePath = `uploads/${Date.now()}-${Math.random().toString(36).substring(2, 8)}-${safeBaseName}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('media-attachments')
        .upload(storagePath, buffer, {
          contentType: mimeType,
          upsert: true,
        })

      if (!uploadError) {
        const { data: { publicUrl } } = supabase.storage
          .from('media-attachments')
          .getPublicUrl(storagePath)

        console.log(`[Upload] File uploaded to Supabase Storage: ${publicUrl}`)
        return NextResponse.json({ success: true, url: publicUrl, filename: file.name })
      } else {
        console.warn('[Upload] Supabase Storage upload failed, falling back to data URL:', uploadError)
      }
    } catch (storageErr) {
      console.warn('[Upload] Supabase storage exception, falling back to data URL:', storageErr)
    }

    // Fallback: Convert file to base64 Data URL
    const base64 = buffer.toString('base64')
    const fileUrl = `data:${mimeType};base64,${base64}`

    console.log(`[Upload] File converted to data URL, size: ${fileUrl.length} characters`)
    return NextResponse.json({ success: true, url: fileUrl, filename: file.name })
  } catch (error) {
    console.error('[Upload] Error uploading file:', error)
    return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 })
  }
}
