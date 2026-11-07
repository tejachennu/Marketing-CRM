/**
 * Staff performance from the bills: for each person, the services they did, the value of those
 * services (before GST, after discounts), their commission and their ratings. Pure, so the Team
 * tab and the tests agree.
 */

import { addDays, istDate } from './spoken'

export interface PerformanceStaff { id: string; name: string; commission_percent?: number | string | null; active?: boolean }
export interface PerformanceInvoice { id: string; status: string; issued_at: string; staff_name?: string | null; items: { name: string; taxable?: number | string; staff_id?: string | null; staff_name?: string | null }[] }
export interface PerformanceFeedback { rating: number; staff_ids?: string[] | null; staff_names?: string[] | null; created_at: string }

export interface StaffPerformance {
  id: string | null
  name: string
  commissionPercent: number
  services: number
  visits: number
  revenue: number
  commission: number
  ratings: number
  averageRating: number | null
  topServices: { name: string; count: number }[]
}

export interface PerformanceReport {
  staff: StaffPerformance[]
  totals: { revenue: number; services: number; visits: number; commission: number; ratings: number; averageRating: number | null }
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

/** A period as India dates (inclusive): today, the last 7 days, this month or last month. */
export function periodRange(period: string, now = Date.now()): { from: string; to: string } {
  const today = istDate(now)
  if (period === 'today') return { from: today, to: today }
  if (period === 'week') return { from: addDays(today, -6), to: today }
  const [year, month] = today.split('-').map(Number)
  if (period === 'last_month') {
    const first = new Date(Date.UTC(month === 1 ? year - 1 : year, (month + 10) % 12, 1)).toISOString().slice(0, 10)
    const last = addDays(`${today.slice(0, 8)}01`, -1)
    return { from: first, to: last }
  }
  return { from: `${today.slice(0, 8)}01`, to: today }
}

export function computePerformance(invoices: PerformanceInvoice[], feedback: PerformanceFeedback[], staff: PerformanceStaff[]): PerformanceReport {
  const byId = new Map(staff.map((member) => [member.id, member]))
  const byName = new Map(staff.map((member) => [member.name.trim().toLowerCase(), member]))
  const rows = new Map<string, StaffPerformance & { _visits: Set<string>; _services: Map<string, number>; _ratingSum: number }>()
  const rowFor = (member: PerformanceStaff | null, fallbackName: string) => {
    const key = member?.id || `name:${fallbackName || 'Not assigned'}`
    let row = rows.get(key)
    if (!row) {
      row = { id: member?.id || null, name: member?.name || fallbackName || 'Not assigned', commissionPercent: Number(member?.commission_percent) || 0, services: 0, visits: 0, revenue: 0, commission: 0, ratings: 0, averageRating: null, topServices: [], _visits: new Set(), _services: new Map(), _ratingSum: 0 }
      rows.set(key, row)
    }
    return row
  }
  // Every team member shows, even with nothing yet in the period
  for (const member of staff.filter((m) => m.active !== false)) rowFor(member, member.name)

  for (const invoice of invoices) {
    if (invoice.status === 'void') continue
    // Bills from before per-service staff name one person for the whole visit
    const visitNames = String(invoice.staff_name || '').split(',').map((n) => n.trim()).filter(Boolean)
    for (const line of invoice.items || []) {
      const member = (line.staff_id && byId.get(line.staff_id)) || (line.staff_name && byName.get(line.staff_name.trim().toLowerCase())) || (!line.staff_name && !line.staff_id && visitNames.length === 1 ? byName.get(visitNames[0].toLowerCase()) : undefined) || null
      const row = rowFor(member, line.staff_name || (visitNames.length === 1 ? visitNames[0] : ''))
      row.services += 1
      row.revenue += Number(line.taxable) || 0
      row._visits.add(invoice.id)
      row._services.set(line.name, (row._services.get(line.name) || 0) + 1)
    }
  }
  for (const entry of feedback) {
    const ids = entry.staff_ids || []
    const names = entry.staff_names || []
    const members = ids.length ? ids.map((id) => byId.get(id)).filter(Boolean) as PerformanceStaff[] : names.map((n) => byName.get(n.trim().toLowerCase())).filter(Boolean) as PerformanceStaff[]
    for (const member of new Set(members)) {
      const row = rowFor(member, member.name)
      row.ratings += 1
      row._ratingSum += Number(entry.rating) || 0
    }
  }

  const staffRows: StaffPerformance[] = [...rows.values()].map(({ _visits, _services, _ratingSum, ...row }) => ({
    ...row,
    visits: _visits.size,
    revenue: round2(row.revenue),
    commission: round2(row.revenue * row.commissionPercent / 100),
    averageRating: row.ratings ? Math.round((_ratingSum / row.ratings) * 10) / 10 : null,
    topServices: [..._services.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([name, count]) => ({ name, count })),
  }))
  // Most value first; people with nothing yet after them; "Not assigned" last
  staffRows.sort((a, b) => Number(!a.id && a.name === 'Not assigned') - Number(!b.id && b.name === 'Not assigned') || b.revenue - a.revenue || a.name.localeCompare(b.name))
  const visible = staffRows.filter((row) => row.id || row.services > 0)
  const ratingCount = feedback.length
  return {
    staff: visible,
    totals: {
      revenue: round2(visible.reduce((sum, row) => sum + row.revenue, 0)),
      services: visible.reduce((sum, row) => sum + row.services, 0),
      visits: new Set(invoices.filter((i) => i.status !== 'void').map((i) => i.id)).size,
      commission: round2(visible.reduce((sum, row) => sum + row.commission, 0)),
      ratings: ratingCount,
      averageRating: ratingCount ? Math.round((feedback.reduce((sum, f) => sum + (Number(f.rating) || 0), 0) / ratingCount) * 10) / 10 : null,
    },
  }
}
