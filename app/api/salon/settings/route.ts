import { NextRequest, NextResponse } from 'next/server'
import { badRequest, salonAccess, serverError } from '@/lib/salon/server'
import { parseSettings, parseWhatsAppSettings } from '@/lib/salon/validate'
import { withSalonSchema } from '@/lib/salon/schema'
import { changedFields, logChange, type ChangeArea } from '@/lib/salon/change-log'
import { parseBookingFlow } from '@/lib/salon/booking-flow-settings'
import { ensureServicesForm } from '@/lib/salon/services-form'
import { can } from '@/lib/rbac'
import { APPOINTMENTS_ADMIN_ONLY } from '@/lib/salon/appointments-switch'
import { withAppointmentsSchema } from '@/lib/salon/appointments-setting'

export const runtime = 'nodejs'

// The history: which area each setting belongs to, and big values written as "changed" only
const BIG = ['booking_flow', 'message_templates']
function areaOf(field: string, fallback: ChangeArea): ChangeArea {
  if (field === 'booking_flow') return 'booking_flow'
  if (field === 'message_templates') return 'templates'
  if (field === 'business_type') return 'business'
  if (field === 'takes_appointments') return 'settings'
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

// PATCH { organizationId, ...whatsappSettings, takes_appointments? }: opening hours, chat bookings, reminders and
// feedback (managers and up); "We take appointments" on or off (owners and admins: it changes what customers see)
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  const switching = typeof body?.takes_appointments === 'boolean'
  if (switching && !can(access.ctx.user, 'settings.manage')) return NextResponse.json({ error: APPOINTMENTS_ADMIN_ONLY }, { status: 403 })
  const parsed = parseWhatsAppSettings(body)
  if ('error' in parsed) return badRequest(parsed.error)
  const value: Record<string, unknown> = { ...parsed.value, ...(switching ? { takes_appointments: body.takes_appointments } : {}) }
  if (!Object.keys(value).length) return badRequest('Nothing to change.')
  const { db, organizationId } = access.ctx
  const previous = await before(db, organizationId)
  const save = () => db.from('salon_settings')
    .upsert({ ...value, organization_id: organizationId, updated_at: new Date().toISOString() }, { onConflict: 'organization_id' })
    .select('*').single()
  // The appointments column is added the first time the switch is saved (appointments-setting.ts)
  const { data, error } = await withSalonSchema(() => (switching ? withAppointmentsSchema(save) : save()))
  if (error) return serverError('settings', error)
  await logSettings(access.ctx, previous, data, Object.keys(value), 'whatsapp')
  // The tick-box services form is published on WhatsApp when the flow is saved to use it
  let servicesForm: { ready: boolean; problem?: string } | undefined
  const flow = 'booking_flow' in parsed.value ? parseBookingFlow(data.booking_flow) : null
  if (flow?.enabled && flow.services_style === 'form' && flow.multi_select) {
    const { data: organization } = await db.from('organizations').select('*').eq('id', organizationId).maybeSingle()
    const form = organization ? await ensureServicesForm(db, organization, { force: true }).catch((e: any) => ({ problem: String(e?.message || e) })) : { problem: 'Workspace not found.' }
    servicesForm = 'id' in form ? { ready: true } : { ready: false, problem: form.problem }
  }
  return NextResponse.json({ success: true, settings: data, ...(servicesForm ? { services_form: servicesForm } : {}) })
}
