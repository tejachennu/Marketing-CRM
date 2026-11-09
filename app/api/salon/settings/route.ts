import { NextRequest, NextResponse } from 'next/server'
import { badRequest, salonAccess, serverError } from '@/lib/salon/server'
import { parseSettings, parseWhatsAppSettings } from '@/lib/salon/validate'
import { withSalonSchema } from '@/lib/salon/schema'
import { changedFields, logChange, type ChangeArea } from '@/lib/salon/change-log'

export const runtime = 'nodejs'

// The history: which area each setting belongs to, and big values written as "changed" only
const BIG = ['booking_flow', 'message_templates']
function areaOf(field: string, fallback: ChangeArea): ChangeArea {
  if (field === 'booking_flow') return 'booking_flow'
  if (field === 'message_templates') return 'templates'
  if (field === 'business_type') return 'business'
  return fallback
}
async function logSettings(ctx: { db: any; organizationId: string; user?: any }, before: any, after: any, fields: string[], fallback: ChangeArea) {
  const changed = changedFields(before, after, fields)
  const byArea = new Map<ChangeArea, Record<string, unknown>>()
  for (const [field, change] of Object.entries(changed)) {
    const area = areaOf(field, fallback)
    const list = byArea.get(area) || {}
    list[field] = BIG.includes(field) ? 'changed' : change
    byArea.set(area, list)
  }
  for (const [area, details] of byArea) await logChange(ctx, { area, action: 'changed', details })
}
const before = (db: any, organizationId: string) => withSalonSchema(() => db.from('salon_settings').select('*').eq('organization_id', organizationId).maybeSingle()).then((r: any) => r?.data || null).catch(() => null)

// PUT { organizationId, ...settings }: business details for invoices and counter preferences (managers and up)
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  const parsed = parseSettings(body)
  if ('error' in parsed) return badRequest(parsed.error)
  const { db, organizationId } = access.ctx
  const previous = await before(db, organizationId)
  const { data, error } = await withSalonSchema(() => db.from('salon_settings')
    .upsert({ ...parsed.value, organization_id: organizationId, updated_at: new Date().toISOString() }, { onConflict: 'organization_id' })
    .select('*').single())
  if (error) return serverError('settings', error)
  await logSettings(access.ctx, previous, data, Object.keys(parsed.value), 'business')
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
  const previous = await before(db, organizationId)
  const { data, error } = await withSalonSchema(() => db.from('salon_settings')
    .upsert({ ...parsed.value, organization_id: organizationId, updated_at: new Date().toISOString() }, { onConflict: 'organization_id' })
    .select('*').single())
  if (error) return serverError('settings', error)
  await logSettings(access.ctx, previous, data, Object.keys(parsed.value), 'whatsapp')
  return NextResponse.json({ success: true, settings: data })
}
