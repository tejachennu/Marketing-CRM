import { NextRequest, NextResponse } from 'next/server'
import { badRequest, salonAccess, serverError } from '@/lib/salon/server'
import { withSalonSchema } from '@/lib/salon/schema'
import { LOGO_BUCKET, logoStoragePath, MAX_LOGO_BYTES, sniffImageType } from '@/lib/salon/logo'

export const runtime = 'nodejs'

async function saveLogoUrl(db: any, organizationId: string, logoUrl: string | null) {
  return withSalonSchema(() => db.from('salon_settings')
    .upsert({ organization_id: organizationId, logo_url: logoUrl, updated_at: new Date().toISOString() }, { onConflict: 'organization_id' })
    .select('*').single())
}

// POST multipart { organizationId, file }: upload the business logo shown on invoices (managers and up)
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null)
  if (!form) return badRequest('The logo did not arrive. Please try again.')
  const access = await salonAccess(request, String(form.get('organizationId') || ''), 'automation.manage')
  if (!access.ok) return access.response
  const file = form.get('file')
  if (!file || typeof file === 'string' || file.size === 0) return badRequest('Choose a logo image.')
  if (file.size > MAX_LOGO_BYTES) return badRequest('That image is too large. Use one under 2 MB.')

  const bytes = new Uint8Array(await file.arrayBuffer())
  const type = sniffImageType(bytes)
  if (!type) return badRequest('Use a PNG, JPG or WebP image for the logo.')

  const { db, organizationId } = access.ctx
  try {
    const path = logoStoragePath(organizationId, type)
    const upload = () => db.storage.from(LOGO_BUCKET).upload(path, bytes, { contentType: type, upsert: false, cacheControl: '31536000' })
    let { error: uploadError } = await upload()
    if (uploadError && /not found/i.test(uploadError.message || '')) {
      await db.storage.createBucket(LOGO_BUCKET, { public: true })
      ;({ error: uploadError } = await upload())
    }
    if (uploadError) throw new Error(`The logo could not be stored: ${uploadError.message}`)
    const { data: { publicUrl } } = db.storage.from(LOGO_BUCKET).getPublicUrl(path)

    const { data, error } = await saveLogoUrl(db, organizationId, publicUrl)
    if (error) throw error
    return NextResponse.json({ success: true, settings: data })
  } catch (error) {
    return serverError('logo', error)
  }
}

// DELETE ?organizationId: stop showing a logo on new invoices. The image itself stays stored,
// because invoices already sent keep showing the logo they were issued with.
export async function DELETE(request: NextRequest) {
  const access = await salonAccess(request, new URL(request.url).searchParams.get('organizationId'), 'automation.manage')
  if (!access.ok) return access.response
  const { db, organizationId } = access.ctx
  const { data, error } = await saveLogoUrl(db, organizationId, null)
  if (error) return serverError('logo', error)
  return NextResponse.json({ success: true, settings: data })
}
