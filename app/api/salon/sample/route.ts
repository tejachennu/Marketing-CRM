import { NextRequest, NextResponse } from 'next/server'
import { loadSalonSetup, salonAccess, serverError } from '@/lib/salon/server'
import { SAMPLE_SERVICES, SAMPLE_STAFF } from '@/lib/salon/sample'
import { normalizeName } from '@/lib/salon/spoken'

export const runtime = 'nodejs'

// POST { organizationId }: add the sample services and team (skips any that already exist by name)
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  const { db, organizationId } = access.ctx
  try {
    const existing = await loadSalonSetup(db, organizationId)
    const haveServices = new Set(existing.services.map((service: any) => normalizeName(service.name)))
    const newServices = SAMPLE_SERVICES.filter((service) => !haveServices.has(normalizeName(service.name)))
      .map((service, index) => ({ ...service, organization_id: organizationId, tax_rate: 18, active: true, position: existing.services.length + index }))
    if (newServices.length) {
      const { error } = await db.from('salon_services').insert(newServices)
      if (error) throw error
    }
    const services = (await loadSalonSetup(db, organizationId)).services
    const haveStaff = new Set(existing.staff.map((member: any) => normalizeName(member.name)))
    const newStaff = SAMPLE_STAFF.filter((member) => !haveStaff.has(normalizeName(member.name))).map((member) => ({
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
