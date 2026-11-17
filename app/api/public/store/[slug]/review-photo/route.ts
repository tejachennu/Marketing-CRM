import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { loadStore } from '@/lib/commerce/storefront'
import { orderByReviewToken } from '@/lib/commerce/review-store'
import { checkRateLimit } from '@/lib/rate-limiter'

export const runtime = 'nodejs'

const MAX_BYTES = 4 * 1024 * 1024

// POST multipart { token, file }: a customer's photo for a review (only with a valid review link; images only)
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  if (!checkRateLimit(`store-review-photo:${ip}`, 20, 60 * 60_000).allowed) return NextResponse.json({ error: 'Too many photos. Please wait a little.' }, { status: 429 })
  const { slug } = await params
  const form = await request.formData().catch(() => null)
  const file = form?.get('file') as File | null
  const token = String(form?.get('token') || '')
  if (!file || !/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) return NextResponse.json({ error: 'Choose a photo (JPG or PNG).' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'This photo is too big. Please choose one under 4 MB.' }, { status: 400 })
  const db = getSupabaseAdminClient()
  const page = await loadStore(db, slug)
  const order = page ? await orderByReviewToken(db, page.organization.id, token) : null
  if (!page || !order) return NextResponse.json({ error: 'This review link is not valid.' }, { status: 404 })
  const ext = file.type.split('/')[1].replace('jpeg', 'jpg')
  const path = `reviews/${page.organization.id}/${order.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await db.storage.from('media-attachments').upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type })
  if (error) return NextResponse.json({ error: 'The photo could not be saved. Please try again.' }, { status: 500 })
  const { data: { publicUrl } } = db.storage.from('media-attachments').getPublicUrl(path)
  return NextResponse.json({ url: publicUrl })
}
