/** Starter kits: a ready-to-use list of services and a small team for each business type. */

import { BUSINESS_TYPES } from './business'

/** The salon kit (the first one there was), kept for older callers. */
export const SAMPLE_SERVICES = BUSINESS_TYPES.salon.kit!.services
export const SAMPLE_STAFF = BUSINESS_TYPES.salon.kit!.staff

const key = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * The sample services and team still in a workspace, as the starter lists made them (owner, 22 Nov 2026: "why all this
 * test data is showing"). A service is a sample when it was saved as one (`source = 'sample'`), or, for lists added
 * before that, when its name, price and length are still exactly a starter-list service. A team member is a sample when
 * the name is a starter-list name and nothing of theirs was filled in (no phone, no commission). Pure.
 */
export function sampleMatches(services: any[], staff: any[]): { services: any[]; staff: any[] } {
  const kitServices = new Map<string, { price: number; duration_minutes: number }>()
  const kitStaff = new Set<string>()
  for (const info of Object.values(BUSINESS_TYPES)) {
    for (const s of info.kit?.services || []) kitServices.set(key(s.name), { price: s.price, duration_minutes: s.duration_minutes })
    for (const m of info.kit?.staff || []) kitStaff.add(key(m.name))
  }
  const isSample = (s: any) => {
    if (s?.source === 'sample') return true
    if (s?.source && s.source !== 'own') return false
    const kit = kitServices.get(key(s?.name))
    return Boolean(kit && Number(s?.price) === kit.price && Number(s?.duration_minutes) === kit.duration_minutes)
  }
  return {
    services: (services || []).filter(isSample),
    staff: (staff || []).filter((m) => kitStaff.has(key(m?.name)) && !String(m?.phone || '').trim() && !(Number(m?.commission_percent) > 0)),
  }
}

/**
 * Takes the starter-list samples out. One never used on a booking or a bill is deleted; one that was used is only
 * switched off, so past bookings and bills stay exactly as they were.
 */
export async function removeSamples(db: any, organizationId: string, setup: { services: any[]; staff: any[] }) {
  const found = sampleMatches(setup.services, setup.staff)
  const usedServices = new Set<string>()
  const usedStaff = new Set<string>()
  const { data: visits } = await db.from('salon_appointments').select('services, staff_id').eq('organization_id', organizationId).limit(20000)
  for (const v of visits || []) {
    if (v.staff_id) usedStaff.add(String(v.staff_id))
    for (const s of Array.isArray(v.services) ? v.services : []) {
      if (s?.service_id) usedServices.add(String(s.service_id))
      if (s?.staff_id) usedStaff.add(String(s.staff_id))
    }
  }
  const { data: bills } = await db.from('salon_invoices').select('items').eq('organization_id', organizationId).limit(20000)
  for (const b of bills || []) {
    for (const item of Array.isArray(b.items) ? b.items : []) {
      if (item?.service_id) usedServices.add(String(item.service_id))
      if (item?.staff_id) usedStaff.add(String(item.staff_id))
    }
  }
  const result = { removed: { services: 0, staff: 0 }, switchedOff: { services: 0, staff: 0 } }
  for (const [table, rows, used, kind] of [
    ['salon_services', found.services, usedServices, 'services'],
    ['salon_staff', found.staff, usedStaff, 'staff'],
  ] as const) {
    const drop = rows.filter((r) => !used.has(String(r.id))).map((r) => r.id)
    const keep = rows.filter((r) => used.has(String(r.id)) && r.active !== false).map((r) => r.id)
    if (drop.length) {
      const { error } = await db.from(table).delete().eq('organization_id', organizationId).in('id', drop)
      if (error) throw error
      result.removed[kind] = drop.length
    }
    if (keep.length) {
      const { error } = await db.from(table).update({ active: false, updated_at: new Date().toISOString() }).eq('organization_id', organizationId).in('id', keep)
      if (error) throw error
      result.switchedOff[kind] = keep.length
    }
  }
  return result
}
