import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // Convert file to base64 Data URL to avoid read-only or ephemeral filesystem restrictions on Vercel
    const mimeType = file.type || 'application/octet-stream'
    const base64 = buffer.toString('base64')
    const fileUrl = `data:${mimeType};base64,${base64}`

    console.log(`[Upload] File converted to data URL, size: ${fileUrl.length} characters`)
    return NextResponse.json({ success: true, url: fileUrl, filename: file.name })
  } catch (error) {
    console.error('[Upload] Error uploading file:', error)
    return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 })
  }
}
