/** Front Desk through the public API: how services, staff, appointments and invoices look, and free times. */

import { busyFrom, freeTimes, isTimeFree } from '../salon/availability'
import { fromIst, istDate, istDayRange } from '../salon/spoken'

export const toApiService = (row: any) => ({
  id: row.id, name: row.name, category: row.category || 'General', price: Number(row.price) || 0,
  duration_minutes: Number(row.duration_minutes) || 30, tax_rate: Number(row.tax_rate) || 0, active: row.active !== false,
})

export const toApiStaff = (row: any) => ({
  id: row.id, name: row.name, active: row.active !== false, service_ids: Array.isArray(row.service_ids) ? row.service_ids : [],
})

export const toApiAppointment = (row: any) => ({
  id: row.id,
  status: row.status,
  starts_at: row.starts_at,
  ends_at: row.ends_at,
  customer: { name: row.customer_name, phone: row.customer_phone || null, contact_id: row.contact_id || null },
  services: (row.services || []).map((s: any) => ({ service_id: s.service_id || null, name: s.name, price: Number(s.price) || 0, duration_minutes: Number(s.duration_minutes) || 0, staff_id: s.staff_id || null, staff_name: s.staff_name || null })),
  staff_id: row.staff_id || null,
  invoice_id: row.invoice_id || null,
  source: row.source || 'counter',
  notes: row.notes || null,
  created_at: row.created_at || null,
})

export const toApiInvoice = (row: any, origin: string) => ({
  id: row.id,
  number: row.number,
  status: row.status,
  customer: { name: row.customer_name, phone: row.customer_phone || null, contact_id: row.contact_id || null },
  appointment_id: row.appointment_id || null,
  items: (row.items || []).map((item: any) => ({ service_id: item.service_id || null, name: item.name, quantity: Number(item.quantity) || 1, price: Number(item.price) || 0, tax_rate: Number(item.tax_rate) || 0, taxable: Number(item.taxable) || 0, tax: Number(item.tax) || 0, total: Number(item.total) || 0, staff_id: item.staff_id || null, staff_name: item.staff_name || null })),
  subtotal: Number(row.subtotal) || 0,
  discount: Number(row.discount) || 0,
  taxable: Number(row.taxable) || 0,
  cgst: Number(row.cgst) || 0,
  sgst: Number(row.sgst) || 0,
  igst: Number(row.igst) || 0,
  total: Number(row.total) || 0,
  payment_method: row.payment_method || null,
  issued_at: row.issued_at,
  paid_at: row.paid_at || null,
  url: row.public_token ? `${origin.replace(/\/+$/, '')}/i/${row.public_token}` : null,
})

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** ?date, or ?from and ?to (India dates), as times for the database; at most 31 days. */
export function dateWindow(params: URLSearchParams): { start: string; end: string; from: string; to: string } | { error: string } {
  const date = params.get('date')
  const from = params.get('from') || date || istDate()
  const to = params.get('to') || date || from
  if (!DATE.test(from) || !DATE.test(to) || !fromIst(from) || !fromIst(to)) return { error: 'Dates are YYYY-MM-DD (India time), like 2026-11-08.' }
  if (to < from) return { error: '"to" must be on or after "from".' }
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 > 31) return { error: 'Ask for at most 31 days at a time.' }
  return { start: istDayRange(from).start, end: istDayRange(to).end, from, to }
}

/** Free start times on a day for some services (and a person, if asked), using the opening hours and bookings. */
export async function availableTimes(db: any, organizationId: string, input: { date: string; serviceIds: string[]; staffId?: string | null; now?: number }) {
  const [{ data: settings }, { data: services }, { data: staff }, { data: booked }] = await Promise.all([
    db.from('salon_settings').select('opens_at, closes_at, closed_weekdays').eq('organization_id', organizationId).maybeSingle(),
    db.from('salon_services').select('id, duration_minutes, active').eq('organization_id', organizationId).in('id', input.serviceIds),
    db.from('salon_staff').select('id, service_ids, active').eq('organization_id', organizationId),
    db.from('salon_appointments').select('starts_at, ends_at, status, staff_id, services').eq('organization_id', organizationId).gte('starts_at', istDayRange(input.date).start).lt('starts_at', istDayRange(input.date).end),
  ])
  const found = (services || []).filter((s: any) => s.active !== false)
  if (found.length !== new Set(input.serviceIds).size) return { error: 'One of those services is not on the list (or is switched off). GET /api/v1/services shows them.' }
  const minutes = found.reduce((sum: number, s: any) => sum + (Number(s.duration_minutes) || 30), 0)
  const team = (staff || []).filter((m: any) => m.active !== false)
  if (input.staffId && !team.some((m: any) => m.id === input.staffId)) return { error: 'That staff member is not on the list. GET /api/v1/staff shows them.' }
  const eligibleStaff = team.filter((m: any) => input.serviceIds.every((id) => !(m.service_ids || []).length || m.service_ids.includes(id))).map((m: any) => m.id)
  const hours = { opens_at: settings?.opens_at, closes_at: settings?.closes_at, closed_weekdays: settings?.closed_weekdays }
  const busy = busyFrom(booked || [])
  const times = freeTimes({ date: input.date, now: input.now, hours, minutes, eligibleStaff, staffId: input.staffId || null, busy, limit: 200 })
  return { minutes, times, check: (time: string) => isTimeFree({ date: input.date, now: input.now, hours, minutes, eligibleStaff, staffId: input.staffId || null, busy, time }) }
}
