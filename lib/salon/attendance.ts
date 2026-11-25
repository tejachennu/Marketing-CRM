/**
 * Staff attendance for Front Desk: one mark per person per day (present, absent, on leave, half day, week off).
 * Pure and browser-safe, so the screens, the API and the tests agree. India dates throughout (IST helpers in spoken.ts).
 * Who is away (absent, on leave, week off) is not offered for bookings that day; a half day stays bookable.
 */

import { addDays, istDate } from './spoken'
import { istWeekday } from './availability'

export const ATTENDANCE_STATUSES = ['present', 'absent', 'leave', 'half_day', 'week_off'] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

export const LEAVE_KINDS = ['casual', 'sick', 'other'] as const
export type LeaveKind = (typeof LEAVE_KINDS)[number]

/** Words for the screens: the full label and the one letter on the month grid. */
export const STATUS_INFO: Record<AttendanceStatus, { label: string; short: string; away: boolean }> = {
  present: { label: 'Present', short: 'P', away: false },
  absent: { label: 'Absent', short: 'A', away: true },
  leave: { label: 'On leave', short: 'L', away: true },
  half_day: { label: 'Half day', short: 'H', away: false },
  week_off: { label: 'Week off', short: 'W', away: true },
}

export const LEAVE_KIND_LABELS: Record<LeaveKind, string> = { casual: 'Casual', sick: 'Sick', other: 'Other' }

/** Not offered for bookings on a day marked like this. */
export const AWAY_STATUSES: AttendanceStatus[] = ATTENDANCE_STATUSES.filter((s) => STATUS_INFO[s].away)

/** Marks can be made up to about two months ahead (leave planned in advance), and up to a year back. */
export const MAX_DAYS_AHEAD = 62
export const MAX_DAYS_BACK = 366
/** The longest leave marked in one go. */
export const MAX_LEAVE_DAYS = 62
export const NOTE_MAX = 200

export interface AttendanceMark {
  staff_id: string
  day: string
  status: AttendanceStatus
  leave_kind: LeaveKind | null
  note: string | null
}

export interface StaffLike { id: string; name?: string | null; active?: boolean | null }

type Refusal = { error: string; field: string }

const DATE = /^\d{4}-\d{2}-\d{2}$/
const MONTH = /^\d{4}-\d{2}$/

export function isDay(value: unknown): value is string {
  return typeof value === 'string' && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

export function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return typeof value === 'string' && (ATTENDANCE_STATUSES as readonly string[]).includes(value)
}

export function isAwayStatus(value: unknown): boolean {
  return isAttendanceStatus(value) && STATUS_INFO[value].away
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/** Why a day cannot be marked (too far ahead or back), or null when it can. */
export function dayProblem(day: unknown, now: Date | number = Date.now()): string | null {
  if (!isDay(day)) return 'Choose a day.'
  const today = istDate(now)
  if (daysBetween(today, day) > MAX_DAYS_AHEAD) return `You can mark up to ${MAX_DAYS_AHEAD} days ahead.`
  if (daysBetween(day, today) > MAX_DAYS_BACK) return 'That day is more than a year ago.'
  return null
}

export function cleanNote(value: unknown): string | null {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, NOTE_MAX) : null
}

/** One mark as sent by a screen: checked, with the leave kind kept only for leave. */
export function cleanMark(input: any, now: Date | number = Date.now()): { value: AttendanceMark } | Refusal {
  const staffId = typeof input?.staff_id === 'string' ? input.staff_id.trim() : ''
  if (!staffId || staffId.length > 64) return { error: 'Choose a team member.', field: 'staff_id' }
  const day = typeof input?.day === 'string' ? input.day.trim() : ''
  const problem = dayProblem(day, now)
  if (problem) return { error: problem, field: 'day' }
  if (!isAttendanceStatus(input?.status)) return { error: 'Choose present, absent, leave, half day or week off.', field: 'status' }
  const status = input.status as AttendanceStatus
  const kind = status === 'leave' && (LEAVE_KINDS as readonly string[]).includes(input?.leave_kind) ? (input.leave_kind as LeaveKind) : null
  if (input?.note != null && String(input.note).replace(/\s+/g, ' ').trim().length > NOTE_MAX) return { error: `Keep the note under ${NOTE_MAX} letters.`, field: 'note' }
  return { value: { staff_id: staffId, day, status, leave_kind: kind, note: cleanNote(input?.note) } }
}

/** Many marks at once (at most 500); the first problem refuses them all, so nothing is half saved. */
export function cleanMarks(list: unknown, now: Date | number = Date.now()): { value: AttendanceMark[] } | Refusal {
  if (!Array.isArray(list) || !list.length) return { error: 'Nothing to mark.', field: 'marks' }
  if (list.length > 500) return { error: 'Mark at most 500 at a time.', field: 'marks' }
  const byKey = new Map<string, AttendanceMark>()
  for (const item of list) {
    const checked = cleanMark(item, now)
    if ('error' in checked) return checked
    // The same person and day twice: the last one counts
    byKey.set(`${checked.value.staff_id}|${checked.value.day}`, checked.value)
  }
  return { value: [...byKey.values()] }
}

/**
 * "Mark all present" (or another status) for a day: everyone on the active team. People already marked keep their
 * mark unless `overwrite` (someone on leave stays on leave).
 */
export function markAll(staff: StaffLike[], day: string, existing: { staff_id: string; day: string }[], options: { status?: AttendanceStatus; overwrite?: boolean } = {}): AttendanceMark[] {
  const status = options.status && isAttendanceStatus(options.status) ? options.status : 'present'
  const marked = new Set(existing.filter((m) => m.day === day).map((m) => m.staff_id))
  return staff
    .filter((m) => m.active !== false && (options.overwrite || !marked.has(m.id)))
    .map((m) => ({ staff_id: m.id, day, status, leave_kind: null, note: null }))
}

/** Every day from `from` to `to`, both included. */
export function daysFrom(from: string, to: string): string[] {
  if (!isDay(from) || !isDay(to) || to < from) return []
  const out: string[] = []
  for (let day = from; day <= to && out.length <= 400; day = addDays(day, 1)) out.push(day)
  return out
}

/**
 * Leave from one day to another for one person, in one go. Days the business is closed (its weekly closed days) are
 * left out: they are not leave. Status is leave unless asked for week off or absent.
 */
export function leaveRange(input: any, now: Date | number = Date.now(), closedWeekdays: number[] = []): { value: AttendanceMark[] } | Refusal {
  const staffId = typeof input?.staff_id === 'string' ? input.staff_id.trim() : ''
  if (!staffId) return { error: 'Choose a team member.', field: 'staff_id' }
  const from = String(input?.from ?? '').trim()
  const to = String(input?.to ?? input?.from ?? '').trim() || from
  if (!isDay(from)) return { error: 'Choose the first day.', field: 'from' }
  if (!isDay(to)) return { error: 'Choose the last day.', field: 'to' }
  if (to < from) return { error: 'The last day is before the first day.', field: 'to' }
  if (daysBetween(from, to) + 1 > MAX_LEAVE_DAYS) return { error: `Mark at most ${MAX_LEAVE_DAYS} days in one go.`, field: 'to' }
  const fromProblem = dayProblem(from, now)
  if (fromProblem) return { error: fromProblem, field: 'from' }
  const toProblem = dayProblem(to, now)
  if (toProblem) return { error: toProblem, field: 'to' }
  const status: AttendanceStatus = ['leave', 'week_off', 'absent'].includes(input?.status) ? input.status : 'leave'
  const kind = status === 'leave' && (LEAVE_KINDS as readonly string[]).includes(input?.leave_kind) ? (input.leave_kind as LeaveKind) : null
  if (input?.note != null && String(input.note).replace(/\s+/g, ' ').trim().length > NOTE_MAX) return { error: `Keep the note under ${NOTE_MAX} letters.`, field: 'note' }
  const note = cleanNote(input?.note)
  const closed = new Set((closedWeekdays || []).filter((d) => Number.isInteger(d)))
  const days = daysFrom(from, to).filter((day) => !closed.has(istWeekday(day)))
  if (!days.length) return { error: 'You are closed on all of those days.', field: 'from' }
  return { value: days.map((day) => ({ staff_id: staffId, day, status, leave_kind: kind, note })) }
}

// ── Months ──────────────────────────────────────────────────────────────────

export function isMonth(value: unknown): value is string {
  return typeof value === 'string' && MONTH.test(value) && Number(value.slice(5, 7)) >= 1 && Number(value.slice(5, 7)) <= 12
}

export function addMonths(month: string, count: number): string {
  const [year, m] = month.split('-').map(Number)
  const index = year * 12 + (m - 1) + count
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

/** A month to show: the one asked when it is a real month from 2000 up to three months ahead, else this month (India). */
export function readMonth(value: unknown, now: Date | number = Date.now()): string {
  const current = istDate(now).slice(0, 7)
  if (!isMonth(value) || value < '2000-01' || value > addMonths(current, 3)) return current
  return value
}

/** First and last day of a month ("2026-11" → 2026-11-01 … 2026-11-30). */
export function monthBounds(month: string): { first: string; last: string; days: number } {
  const [year, m] = month.split('-').map(Number)
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate()
  return { first: `${month}-01`, last: `${month}-${String(days).padStart(2, '0')}`, days }
}

export function monthDays(month: string): string[] {
  const { first, last } = monthBounds(month)
  return daysFrom(first, last)
}

/** "November 2026" */
export function monthLabel(month: string): string {
  const [year, m] = month.split('-').map(Number)
  return new Date(Date.UTC(year, m - 1, 15)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

// ── Summaries ───────────────────────────────────────────────────────────────

export interface PersonMonth {
  staff_id: string
  name: string
  present: number
  absent: number
  leave: number
  half_day: number
  week_off: number
  /** Working days up to today (closed days left out) with no mark */
  not_marked: number
  /** Present days, a half day counting 0.5 */
  worked: number
  /** Leave days (absent not included), a half day not counted */
  leave_days: string[]
}

/**
 * A month for each person on the team: present, absent, leave, half days (0.5 each in `worked`), week offs, and
 * working days up to today with no mark. Days the business is closed are not counted as not marked.
 */
export function monthSummary(staff: StaffLike[], marks: { staff_id: string; day: string; status: string }[], month: string, now: Date | number = Date.now(), closedWeekdays: number[] = []): PersonMonth[] {
  const { first, last } = monthBounds(month)
  const today = istDate(now)
  const closed = new Set(closedWeekdays || [])
  const upTo = today < last ? today : last
  const workingDays = upTo < first ? [] : daysFrom(first, upTo).filter((day) => !closed.has(istWeekday(day)))
  return staff.map((person) => {
    const own = marks.filter((m) => m.staff_id === person.id && m.day >= first && m.day <= last && isAttendanceStatus(m.status))
    const count = (status: AttendanceStatus) => own.filter((m) => m.status === status).length
    const markedDays = new Set(own.map((m) => m.day))
    const halfDays = count('half_day')
    return {
      staff_id: person.id,
      name: String(person.name || ''),
      present: count('present'),
      absent: count('absent'),
      leave: count('leave'),
      half_day: halfDays,
      week_off: count('week_off'),
      not_marked: workingDays.filter((day) => !markedDays.has(day)).length,
      worked: count('present') + halfDays * 0.5,
      leave_days: own.filter((m) => m.status === 'leave').map((m) => m.day).sort(),
    }
  })
}

/** The days a person was (or will be) on leave, oldest first. */
export function leaveDates(marks: { staff_id: string; day: string; status: string }[], staffId: string): string[] {
  return marks.filter((m) => m.staff_id === staffId && m.status === 'leave').map((m) => m.day).sort()
}

export interface LeaveSpan { staff_id: string; from: string; to: string; days: number; leave_kind: LeaveKind | null; note: string | null }

/**
 * A person's leave as ranges ("12 Nov to 15 Nov"): days next to each other with the same kind join up, and so do
 * days with only the business's closed days between them.
 */
export function leaveSpans(marks: { staff_id: string; day: string; status: string; leave_kind?: string | null; note?: string | null }[], staffId?: string | null, closedWeekdays: number[] = []): LeaveSpan[] {
  const closed = new Set(closedWeekdays || [])
  const list = marks.filter((m) => m.status === 'leave' && (!staffId || m.staff_id === staffId))
    .sort((a, b) => (a.staff_id === b.staff_id ? a.day.localeCompare(b.day) : a.staff_id.localeCompare(b.staff_id)))
  const spans: LeaveSpan[] = []
  for (const mark of list) {
    const kind = (LEAVE_KINDS as readonly string[]).includes(String(mark.leave_kind)) ? (mark.leave_kind as LeaveKind) : null
    const last = spans[spans.length - 1]
    if (last && last.staff_id === mark.staff_id && last.leave_kind === kind) {
      // Only closed days between the end of the span and this day: the same leave
      let gap = addDays(last.to, 1)
      while (gap < mark.day && closed.has(istWeekday(gap))) gap = addDays(gap, 1)
      if (gap === mark.day) {
        last.to = mark.day
        last.days += 1
        if (!last.note && mark.note) last.note = mark.note
        continue
      }
    }
    spans.push({ staff_id: mark.staff_id, from: mark.day, to: mark.day, days: 1, leave_kind: kind, note: mark.note || null })
  }
  return spans
}

export interface DayRow { staff_id: string; name: string; mark: AttendanceMark | null }

/** Everyone on the active team for a day, with their mark (or none yet), in name order. */
export function dayList(staff: StaffLike[], marks: AttendanceMark[], day: string): DayRow[] {
  return staff
    .filter((m) => m.active !== false)
    .map((m) => ({ staff_id: m.id, name: String(m.name || ''), mark: marks.find((x) => x.staff_id === m.id && x.day === day) || null }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** How many of each on a day, and how many are not marked yet. */
export function dayCounts(rows: DayRow[]): Record<AttendanceStatus | 'not_marked', number> {
  const counts = { present: 0, absent: 0, leave: 0, half_day: 0, week_off: 0, not_marked: 0 }
  for (const row of rows) counts[row.mark ? row.mark.status : 'not_marked'] += 1
  return counts
}

/** The people not offered for bookings on a day (absent, on leave, week off). */
export function awayIds(marks: { staff_id: string; day: string; status: string }[], day: string): string[] {
  return [...new Set(marks.filter((m) => m.day === day && isAwayStatus(m.status)).map((m) => m.staff_id))]
}

/** "On leave · Sick", "Week off", "Half day" */
export function markLabel(mark: { status: string; leave_kind?: string | null } | null | undefined): string {
  if (!mark || !isAttendanceStatus(mark.status)) return 'Not marked'
  const kind = mark.status === 'leave' && (LEAVE_KINDS as readonly string[]).includes(String(mark.leave_kind)) ? LEAVE_KIND_LABELS[mark.leave_kind as LeaveKind] : null
  return kind ? `${STATUS_INFO[mark.status].label} · ${kind}` : STATUS_INFO[mark.status].label
}

/** Days present in a period for each person (a half day counts 0.5), for the Team numbers. */
export function daysWorked(marks: { staff_id: string; status: string }[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of marks) {
    if (m.status === 'present') out[m.staff_id] = (out[m.staff_id] || 0) + 1
    else if (m.status === 'half_day') out[m.staff_id] = (out[m.staff_id] || 0) + 0.5
  }
  return out
}
