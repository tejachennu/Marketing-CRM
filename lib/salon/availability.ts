/**
 * Free times for a booking: opening hours, closed days, the length of the services and who is
 * already busy. Pure, so the chat assistant, the counter and the tests agree.
 */

import { addDays, fromIst, istDate, istTime } from './spoken'

/** An appointment that takes up time: who is on it (empty when nobody in particular yet). */
export interface Busy { starts_at: string; ends_at: string; staff_ids: string[] }

export interface OpeningHours { opens_at?: string | null; closes_at?: string | null; closed_weekdays?: number[] | null }

/** Statuses that hold a chair. A request from the chat holds it too, so it is not offered twice. */
export const HOLDING_STATUSES = ['requested', 'booked', 'arrived', 'in_service']

const clock = (value: string | null | undefined, fallback: string) => (/^\d{1,2}:\d{2}$/.test(String(value || '')) ? String(value).padStart(5, '0') : fallback)
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
const timeOf = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** Sunday = 0 … Saturday = 6, for a date in India. */
export function istWeekday(date: string): number {
  const noon = fromIst(date, '12:00')
  return noon ? noon.getUTCDay() : -1
}

export function isClosedOn(date: string, hours: OpeningHours): boolean {
  return (hours.closed_weekdays || []).includes(istWeekday(date))
}

/** The appointments of a day as busy time: everyone named on the visit or on any of its services. */
export function busyFrom(appointments: { starts_at: string; ends_at: string; status: string; staff_id?: string | null; services?: { staff_id?: string | null }[] }[]): Busy[] {
  return appointments
    .filter((a) => HOLDING_STATUSES.includes(a.status))
    .map((a) => ({ starts_at: a.starts_at, ends_at: a.ends_at, staff_ids: [...new Set([a.staff_id, ...(a.services || []).map((s) => s.staff_id)].filter(Boolean))] as string[] }))
}

export interface FreeTimesInput {
  date: string
  now?: number
  hours: OpeningHours
  /** Length of the visit */
  minutes: number
  /** Who can do all the services (empty: the salon has no staff list, so one chair) */
  eligibleStaff: string[]
  /** A particular person the customer asked for */
  staffId?: string | null
  busy: Busy[]
  /** Offer times near this one first ("17:00") */
  around?: string | null
  limit?: number
  step?: number
}

/** Free start times ("HH:MM") on a day, earliest first, at most `limit`. */
export function freeTimes(input: FreeTimesInput): string[] {
  const { date, hours, busy } = input
  const now = input.now ?? Date.now()
  const step = input.step ?? 30
  const limit = input.limit ?? 10
  const length = Math.max(15, Math.round(input.minutes) || 30)
  if (isClosedOn(date, hours) || date < istDate(now)) return []
  const opens = minutesOf(clock(hours.opens_at, '10:00'))
  const closes = minutesOf(clock(hours.closes_at, '21:00'))
  const free: string[] = []
  for (let start = opens; start + length <= closes; start += step) {
    const time = timeOf(start)
    const begins = fromIst(date, time)
    if (!begins || begins.getTime() < now + 30 * 60_000) continue
    const ends = begins.getTime() + length * 60_000
    const overlapping = busy.filter((b) => Date.parse(b.starts_at) < ends && Date.parse(b.ends_at) > begins.getTime())
    if (input.staffId) {
      if (!overlapping.some((b) => b.staff_ids.includes(input.staffId!))) free.push(time)
      continue
    }
    if (!input.eligibleStaff.length) {
      if (!overlapping.length) free.push(time)
      continue
    }
    // Free people who can do it, less the bookings nobody is assigned to yet
    const taken = new Set(overlapping.flatMap((b) => b.staff_ids))
    const unassigned = overlapping.filter((b) => !b.staff_ids.length).length
    if (input.eligibleStaff.filter((id) => !taken.has(id)).length - unassigned > 0) free.push(time)
  }
  if (input.around && /^\d{1,2}:\d{2}$/.test(input.around) && free.length > limit) {
    const target = minutesOf(input.around.padStart(5, '0'))
    return free.map((time) => ({ time, gap: Math.abs(minutesOf(time) - target) })).sort((a, b) => a.gap - b.gap).slice(0, limit).map((x) => x.time).sort()
  }
  return free.slice(0, limit)
}

/** Whether one particular start time is still free (checked again when the customer taps it). */
export function isTimeFree(input: Omit<FreeTimesInput, 'around' | 'limit'> & { time: string }): boolean {
  const start = fromIst(input.date, input.time)
  if (!start || start.getTime() < (input.now ?? Date.now())) return false
  // The half-hour notice applies to offering times, not to taking one the customer already chose
  return freeTimes({ ...input, limit: 500, now: start.getTime() - 31 * 60_000 }).includes(input.time)
}

/** The next day (from `from`, up to two weeks ahead) with any free time. */
export function nextOpenDay(input: Omit<FreeTimesInput, 'date' | 'busy'> & { from: string; busyFor: (date: string) => Busy[] }): string | null {
  for (let offset = 0; offset < 14; offset++) {
    const date = addDays(input.from, offset)
    if (freeTimes({ ...input, date, busy: input.busyFor(date), limit: 1 }).length) return date
  }
  return null
}

/** "Open 10:00 am to 9:00 pm, closed on Sunday" */
export function describeHours(hours: OpeningHours): string {
  const format = (time: string) => {
    const [h, m] = time.split(':').map(Number)
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`
  }
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const closed = (hours.closed_weekdays || []).filter((d) => d >= 0 && d <= 6).map((d) => days[d])
  return `Open ${format(clock(hours.opens_at, '10:00'))} to ${format(clock(hours.closes_at, '21:00'))}${closed.length ? `, closed on ${closed.join(' and ')}` : ', every day'}`
}

export { istTime }
