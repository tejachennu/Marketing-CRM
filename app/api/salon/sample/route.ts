import { NextRequest, NextResponse } from 'next/server'
import { loadSalonSetup, salonAccess, serverError } from '@/lib/salon/server'
import { BUSINESS_TYPES, businessType } from '@/lib/salon/business'
import { normalizeName } from '@/lib/salon/spoken'
import { withSalonSchema } from '@/lib/salon/schema'

export const runtime = 'nodejs'

// POST { organizationId, business_type }: add that business type's starter services and team (skips any that already exist by name) and remember the type
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  const { db, organizationId } = access.ctx
  const type = businessType(body?.business_type)
  const kit = BUSINESS_TYPES[type].kit
  try {
    await withSalonSchema(() => db.from('salon_settings').upsert({ organization_id: organizationId, business_type: type, updated_at: new Date().toISOString() }, { onConflict: 'organization_id' }))
    if (!kit) return NextResponse.json({ success: true, added: { services: 0, staff: 0 }, ...(await loadSalonSetup(db, organizationId)) })
    const existing = await loadSalonSetup(db, organizationId)
    const haveServices = new Set(existing.services.map((service: any) => normalizeName(service.name)))
    const newServices = kit.services.filter((service) => !haveServices.has(normalizeName(service.name)))
      .map((service, index) => ({ ...service, organization_id: organizationId, tax_rate: kit.taxRate, active: true, position: existing.services.length + index }))
    if (newServices.length) {
      const { error } = await db.from('salon_services').insert(newServices)
      if (error) throw error
    }
    const services = (await loadSalonSetup(db, organizationId)).services
    const haveStaff = new Set(existing.staff.map((member: any) => normalizeName(member.name)))
    const newStaff = kit.staff.filter((member) => !haveStaff.has(normalizeName(member.name))).map((member) => ({
      organization_id: organizationId,
      name: member.name,
      active: true,
      service_ids: services.filter((service: any) => member.categories.includes(service.category)).map((service: any) => service.id),
    }))
    if (newStaff.length) {
      const { error } = await db.from('salon_staff').insert(newStaff)
      if (error) throw error
    }
    return NextResponse.json({ success: true, added: { services: newServices.length, staff: newStaff.length }, ...(await loadSalonSetup(db, organizationId)) })
  } catch (error) {
    return serverError('sample', error)
  }
}
