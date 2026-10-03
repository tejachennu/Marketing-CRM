import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseKey)
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const mimeType = file.type || 'application/octet-stream'

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
