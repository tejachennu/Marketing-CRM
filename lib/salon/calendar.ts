/**
 * The appointments calendar, with no database code (safe in the browser): the day's grid by team
 * member, the week's days, clashes, and the numbers for a period. India time throughout.
 */

const IST_OFFSET_MIN = 330

/** Minutes after midnight, India time, of an instant. */
export function istMinutes(iso: string): number {
  const t = new Date(iso).getTime() + IST_OFFSET_MIN * 60_000
  const d = new Date(t)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

/** "HH:MM" → minutes after midnight (null when it is not a time). */
export function clockMinutes(value: unknown): number | null {
  const m = String(value ?? '').match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const n = Number(m[1]) * 60 + Number(m[2])
  return n >= 0 && n <= 24 * 60 ? n : null
}

/** "YYYY-MM-DD" plus n days. */
export function shiftDate(date: string, days: number): string {
  const t = Date.parse(`${date}T12:00:00Z`) + days * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

/** The Monday-to-Sunday week a date is in. */
export function weekOf(date: string): string[] {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() // 0 Sunday
  const monday = shiftDate(date, -((weekday + 6) % 7))
  return Array.from({ length: 7 }, (_, i) => shiftDate(monday, i))
}

export interface CalAppointment {
  id: string
  starts_at: string
  ends_at: string
  status: string
  staff_id?: string | null
  customer_name: string
  services?: { name: string; price?: number | string; staff_id?: string | null }[]
}

export const ACTIVE_STATUSES = ['booked', 'arrived', 'in_service']

/** The hours the day's grid shows: opening to closing time, stretched to fit every appointment. */
export function dayWindow(hours: { opens_at?: string | null; closes_at?: string | null }, appointments: Pick<CalAppointment, 'starts_at' | 'ends_at'>[]): { start: number; end: number } {
  let start = clockMinutes(hours.opens_at) ?? 9 * 60
  let end = clockMinutes(hours.closes_at) ?? 21 * 60
  if (end <= start) end = Math.min(24 * 60, start + 12 * 60)
  for (const a of appointments) {
    const s = istMinutes(a.starts_at)
    const e = s + Math.max(15, Math.round((Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60_000))
    start = Math.min(start, Math.floor(s / 60) * 60)
    end = Math.max(end, Math.min(24 * 60, Math.ceil(e / 60) * 60))
  }
  return { start: Math.floor(start / 60) * 60, end: Math.ceil(end / 60) * 60 }
}

export interface Block<T extends CalAppointment = CalAppointment> {
  appointment: T
  column: string
  top: number
  height: number
  lane: number
  lanes: number
}

/**
 * Where each appointment sits in the day's grid: in its person's column (or "anyone"), from its start to
 * its end. Appointments that overlap in one column sit side by side (lanes).
 */
export function layoutDay<T extends CalAppointment>(appointments: T[], staffIds: string[], window: { start: number; end: number }): { columns: string[]; blocks: Block<T>[] } {
  const known = new Set(staffIds)
  const columnOf = (a: T) => (a.staff_id && known.has(a.staff_id) ? a.staff_id : 'anyone')
  const hasAnyone = appointments.some((a) => columnOf(a) === 'anyone')
  const columns = [...staffIds, ...(hasAnyone ? ['anyone'] : [])]
  const blocks: Block<T>[] = []
  for (const column of columns) {
    const mine = appointments.filter((a) => columnOf(a) === column).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
    // Group overlapping appointments, then give each a lane in its group
    let group: Block<T>[] = []
    let groupEnd = -1
    const close = () => { const lanes = Math.max(1, ...group.map((b) => b.lane + 1)); for (const b of group) b.lanes = lanes; group = [] }
    for (const a of mine) {
      const s = istMinutes(a.starts_at)
      const length = Math.max(15, Math.round((Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60_000))
      if (s >= groupEnd) close()
      const busyLanes = group.filter((b) => b.top + b.height > s - window.start).map((b) => b.lane)
      let lane = 0
      while (busyLanes.includes(lane)) lane++
      const block: Block<T> = { appointment: a, column, top: s - window.start, height: length, lane, lanes: 1 }
      group.push(block)
      blocks.push(block)
      groupEnd = Math.max(groupEnd, s + length)
    }
    close()
  }
  return { columns, blocks }
}

/** Another active appointment for the same person at the same time (for the reschedule warning). */
export function findClash<T extends CalAppointment>(appointments: T[], candidate: { id?: string; starts_at: string; ends_at: string; staff_id?: string | null }): T | null {
  if (!candidate.staff_id) return null
  const s = Date.parse(candidate.starts_at)
  const e = Date.parse(candidate.ends_at)
  return appointments.find((a) => a.id !== candidate.id && ACTIVE_STATUSES.includes(a.status) && a.staff_id === candidate.staff_id && Date.parse(a.starts_at) < e && Date.parse(a.ends_at) > s) || null
}

export const STATUS_WORDS: Record<string, string> = {
  requested: 'Request', booked: 'Booked', arrived: 'Arrived', in_service: 'In service', completed: 'Done', cancelled: 'Cancelled', no_show: 'No-show',
}

/** Numbers for the days shown: how many in each state, and the money booked. */
export function periodSummary(appointments: CalAppointment[]) {
  const count = (statuses: string[]) => appointments.filter((a) => statuses.includes(a.status)).length
  const value = (a: CalAppointment) => (a.services || []).reduce((sum, s) => sum + (Number(s.price) || 0), 0)
  const live = appointments.filter((a) => !['cancelled', 'no_show', 'requested'].includes(a.status))
  return {
    total: appointments.filter((a) => a.status !== 'requested').length,
    upcoming: count(['booked']),
    inShop: count(['arrived', 'in_service']),
    done: count(['completed']),
    noShow: count(['no_show']),
    cancelled: count(['cancelled']),
    expected: Math.round(live.reduce((sum, a) => sum + value(a), 0) * 100) / 100,
  }
}

/** The appointments of one day, India time. */
export function onDay<T extends Pick<CalAppointment, 'starts_at'>>(appointments: T[], date: string): T[] {
  return appointments.filter((a) => new Date(new Date(a.starts_at).getTime() + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10) === date)
}
