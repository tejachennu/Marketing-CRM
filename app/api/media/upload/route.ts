import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const uploadsDir = path.join(process.cwd(), 'public', 'uploads')
    // Ensure uploads directory exists
    await mkdir(uploadsDir, { recursive: true })

    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
    const ext = path.extname(file.name)
    const basename = path.basename(file.name, ext).replace(/[^a-zA-Z0-9]/g, '_')
    const filename = `${basename}-${uniqueSuffix}${ext}`
    const filePath = path.join(uploadsDir, filename)

    await writeFile(filePath, buffer)
    console.log(`[Upload] File saved to ${filePath}`)

    const fileUrl = `/uploads/${filename}`
    return NextResponse.json({ success: true, url: fileUrl, filename })
  } catch (error) {
    console.error('[Upload] Error uploading file:', error)
    return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 })
  }
}
