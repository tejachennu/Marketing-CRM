import { NextRequest, NextResponse } from 'next/server'
import { badRequest, salonAccess, serverError } from '@/lib/salon/server'
import { parseSettings, parseWhatsAppSettings } from '@/lib/salon/validate'
import { withSalonSchema } from '@/lib/salon/schema'

export const runtime = 'nodejs'

// PUT { organizationId, ...settings }: business details for invoices and counter preferences (managers and up)
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  const parsed = parseSettings(body)
  if ('error' in parsed) return badRequest(parsed.error)
  const { db, organizationId } = access.ctx
  const { data, error } = await withSalonSchema(() => db.from('salon_settings')
    .upsert({ ...parsed.value, organization_id: organizationId, updated_at: new Date().toISOString() }, { onConflict: 'organization_id' })
    .select('*').single())
  if (error) return serverError('settings', error)
  return NextResponse.json({ success: true, settings: data })
}

// PATCH { organizationId, ...whatsappSettings }: opening hours, chat bookings, reminders and feedback (managers and up)
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  const parsed = parseWhatsAppSettings(body)
  if ('error' in parsed) return badRequest(parsed.error)
  if (!Object.keys(parsed.value).length) return badRequest('Nothing to change.')
  const { db, organizationId } = access.ctx
  const { data, error } = await withSalonSchema(() => db.from('salon_settings')
    .upsert({ ...parsed.value, organization_id: organizationId, updated_at: new Date().toISOString() }, { onConflict: 'organization_id' })
    .select('*').single())
  if (error) return serverError('settings', error)
  return NextResponse.json({ success: true, settings: data })
}
