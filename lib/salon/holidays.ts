/**
 * Shop holidays for Front Desk: days the business is closed besides its weekly closed days (Setup → Hours).
 * One-off (Diwali this year, a family function) or repeating: every year on a date (Republic Day), every month on a
 * date (the 1st), or every month on a weekday (the 2nd Tuesday, the last Saturday).
 *
 * On a holiday the shop counts as closed: no free times for bookings (availability.ts isClosedOn), the website says
 * "Closed today · Diwali", and attendance does not count it as a working day. Bills can still be made.
 *
 * Pure and browser-safe (the web screens, the API and the tests use the same rules; the app has a copy in
 * mobile/lib/data/attendance_logic.dart). Dates are India calendar days, "YYYY-MM-DD".
 */

import { addDays, istDate } from './spoken'

export const HOLIDAY_REPEATS = ['none', 'yearly', 'monthly', 'monthly_weekday', 'monthly_last_weekday'] as const
export type HolidayRepeat = (typeof HOLIDAY_REPEATS)[number]

export interface Holiday {
  id: string
  /** "Diwali", "Republic Day" */
  name: string
  /** The first day (for a repeating holiday: the first time, and the date or weekday it repeats on) */
  start: string
  /** How many days in a row (1 for most) */
  days: number
  repeat: HolidayRepeat
}

/** One time a holiday falls: from `start` to `end`, both included. */
export interface HolidaySpan { id: string; name: string; start: string; end: string; days: number; repeat: HolidayRepeat }

export const MAX_HOLIDAYS = 60
export const HOLIDAY_NAME_MAX = 40
/** Longest holiday in one go: a month (once or every year); a few days for the monthly ones. */
export const MAX_HOLIDAY_DAYS = 31
export const MAX_MONTHLY_HOLIDAY_DAYS = 7
/** A holiday can be planned up to two years ahead. */
export const MAX_HOLIDAY_DAYS_AHEAD = 730

/** Fixed-date national holidays, offered as one-tap suggestions (each repeats every year). */
export const SUGGESTED_HOLIDAYS: { name: string; monthDay: string }[] = [
  { name: 'Republic Day', monthDay: '01-26' },
  { name: 'Independence Day', monthDay: '08-15' },
  { name: 'Gandhi Jayanti', monthDay: '10-02' },
  { name: 'Christmas', monthDay: '12-25' },
  { name: "New Year's Day", monthDay: '01-01' },
]

type Refusal = { error: string; field: string }

// ── Calendar arithmetic (calendar days, no time zone needed) ─────────────────

const DATE = /^\d{4}-\d{2}-\d{2}$/
const pad = (n: number) => String(n).padStart(2, '0')

function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE.test(value)) return false
  const time = Date.parse(`${value}T00:00:00Z`)
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value
}

const parts = (date: string) => ({ y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)), d: Number(date.slice(8, 10)) })
const dayOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const monthLength = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
/** Sunday = 0 … Saturday = 6 */
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay()
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/** 1 for the 1st to 7th of a month, 2 for the 8th to 14th … 5 for the 29th to 31st. */
export const weekOfMonth = (date: string) => Math.ceil(parts(date).d / 7)

/** The day this holiday falls on in a year (29 Feb → 28 Feb when there is none). */
function yearlyAnchor(start: string, year: number): string {
  const { m, d } = parts(start)
  return dayOf(year, m, Math.min(d, monthLength(year, m)))
}

/** The day this holiday falls on in a month: the same date (31st → the month's last day) or the same weekday. */
function monthlyAnchor(holiday: Holiday, y: number, m: number): string {
  const length = monthLength(y, m)
  if (holiday.repeat === 'monthly') return dayOf(y, m, Math.min(parts(holiday.start).d, length))
  const weekday = weekdayOf(holiday.start)
  const nth = weekOfMonth(holiday.start)
  if (holiday.repeat === 'monthly_weekday' && nth <= 4) {
    const first = 1 + ((weekday - weekdayOf(dayOf(y, m, 1)) + 7) % 7)
    return dayOf(y, m, first + 7 * (nth - 1))
  }
  // The last one in the month (a "5th" weekday is the last one too: most months have no 5th)
  return dayOf(y, m, length - ((weekdayOf(dayOf(y, m, length)) - weekday + 7) % 7))
}

/** The days each time falls, from the period before `from` to the period of `to`. */
function anchorsAround(holiday: Holiday, from: string, to: string): string[] {
  if (holiday.repeat === 'none') return [holiday.start]
  const a = parts(from)
  const b = parts(to)
  const out: string[] = []
  if (holiday.repeat === 'yearly') {
    for (let year = a.y - 1; year <= b.y && out.length < 400; year++) out.push(yearlyAnchor(holiday.start, year))
    return out
  }
  for (let index = a.y * 12 + a.m - 2; index <= b.y * 12 + b.m - 1 && out.length < 400; index++) {
    out.push(monthlyAnchor(holiday, Math.floor(index / 12), (index % 12) + 1))
  }
  return out
}

// ── Reading and checking ────────────────────────────────────────────────────

function cleanName(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function maxDaysFor(repeat: HolidayRepeat): number {
  return repeat === 'none' || repeat === 'yearly' ? MAX_HOLIDAY_DAYS : MAX_MONTHLY_HOLIDAY_DAYS
}

function newId(): string {
  const random = (globalThis as any).crypto?.randomUUID?.() as string | undefined
  return `h_${(random || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`).replace(/-/g, '').slice(0, 16)}`
}

const ID = /^[A-Za-z0-9_-]{1,64}$/

/** One holiday as sent by a screen: checked; an id is made for a new one. */
export function cleanHoliday(input: any, now: Date | number = Date.now()): { value: Holiday } | Refusal {
  const name = cleanName(input?.name)
  if (!name) return { error: 'Give the holiday a name, like Diwali.', field: 'name' }
  if (name.length > HOLIDAY_NAME_MAX) return { error: `Keep the name under ${HOLIDAY_NAME_MAX} letters.`, field: 'name' }
  const start = String(input?.start ?? '').trim()
  if (!isDay(start)) return { error: 'Choose the day.', field: 'start' }
  const today = istDate(now)
  if (daysBetween(today, start) > MAX_HOLIDAY_DAYS_AHEAD) return { error: 'Holidays can be added up to two years ahead.', field: 'start' }
  if (start < '2000-01-01') return { error: 'Choose a day from 2000 on.', field: 'start' }
  const repeat: HolidayRepeat = (HOLIDAY_REPEATS as readonly string[]).includes(input?.repeat) ? input.repeat : 'none'
  const days = input?.days == null || input.days === '' ? 1 : Number(input.days)
  if (!Number.isInteger(days) || days < 1) return { error: 'Choose how many days.', field: 'days' }
  if (days > maxDaysFor(repeat)) return { error: repeat === 'none' || repeat === 'yearly' ? `A holiday can be at most ${MAX_HOLIDAY_DAYS} days.` : `A monthly holiday can be at most ${MAX_MONTHLY_HOLIDAY_DAYS} days.`, field: 'days' }
  if (repeat === 'none' && addDays(start, days - 1) < today) return { error: 'That day has already gone.', field: 'start' }
  const id = typeof input?.id === 'string' && ID.test(input.id) ? input.id : newId()
  return { value: { id, name, start, days, repeat } }
}

/** The saved list, cleaned (anything broken is left out), oldest first, at most MAX_HOLIDAYS. Never throws. */
export function readHolidays(value: unknown): Holiday[] {
  let list: unknown = value
  if (typeof list === 'string') {
    try { list = JSON.parse(list) } catch { return [] }
  }
  if (!Array.isArray(list)) return []
  const out: Holiday[] = []
  const seen = new Set<string>()
  for (const item of list as any[]) {
    const name = cleanName(item?.name).slice(0, HOLIDAY_NAME_MAX)
    const start = String(item?.start ?? '')
    const repeat: HolidayRepeat = (HOLIDAY_REPEATS as readonly string[]).includes(item?.repeat) ? item.repeat : 'none'
    const days = Math.min(Math.max(1, Math.round(Number(item?.days) || 1)), maxDaysFor(repeat))
    const id = typeof item?.id === 'string' && ID.test(item.id) ? item.id : `h_${start.replace(/-/g, '')}_${out.length}`
    if (!name || !isDay(start) || seen.has(id)) continue
    seen.add(id)
    out.push({ id, name, start, days, repeat })
    if (out.length >= MAX_HOLIDAYS) break
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name))
}

/** Add a holiday, or change the one with the same id. */
export function withHoliday(list: Holiday[], holiday: Holiday): { value: Holiday[] } | Refusal {
  const current = readHolidays(list)
  const index = current.findIndex((h) => h.id === holiday.id)
  if (index < 0 && current.length >= MAX_HOLIDAYS) return { error: `You can keep at most ${MAX_HOLIDAYS} holidays. Remove old ones first.`, field: 'holiday' }
  const next = index < 0 ? [...current, holiday] : current.map((h, i) => (i === index ? holiday : h))
  return { value: readHolidays(next) }
}

export function withoutHoliday(list: Holiday[], id: string): Holiday[] {
  return readHolidays(list).filter((h) => h.id !== id)
}

/** One-off holidays that ended more than a year ago are dropped when the list is saved again. */
export function dropOldHolidays(list: Holiday[], now: Date | number = Date.now()): Holiday[] {
  const yearAgo = addDays(istDate(now), -366)
  return list.filter((h) => h.repeat !== 'none' || addDays(h.start, h.days - 1) >= yearAgo)
}

// ── When is a holiday ───────────────────────────────────────────────────────

/** The holiday on this day, or null. Works with the saved list as it is (cleaned here). */
export function holidayOn(date: string, list: unknown): HolidaySpan | null {
  if (!isDay(date)) return null
  for (const holiday of readHolidays(list)) {
    if (date < holiday.start) continue
    for (const anchor of anchorsAround(holiday, date, date)) {
      if (anchor < holiday.start || anchor > date) continue
      if (daysBetween(anchor, date) < holiday.days) return spanOf(holiday, anchor)
    }
  }
  return null
}

export const isHoliday = (date: string, list: unknown) => holidayOn(date, list) !== null

function spanOf(holiday: Holiday, anchor: string): HolidaySpan {
  return { id: holiday.id, name: holiday.name, start: anchor, end: addDays(anchor, holiday.days - 1), days: holiday.days, repeat: holiday.repeat }
}

/** Every time the holidays fall between two days (spans that overlap them), earliest first. */
export function holidaySpans(list: unknown, from: string, to: string): HolidaySpan[] {
  if (!isDay(from) || !isDay(to) || to < from) return []
  const out: HolidaySpan[] = []
  for (const holiday of readHolidays(list)) {
    for (const anchor of anchorsAround(holiday, addDays(from, -MAX_HOLIDAY_DAYS), to)) {
      if (anchor < holiday.start || anchor > to) continue
      const span = spanOf(holiday, anchor)
      if (span.end >= from && !out.some((s) => s.id === span.id && s.start === span.start)) out.push(span)
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name))
}

/** Each holiday day between two days (at most 400 days), with its name: { "2026-11-08": "Diwali" }. */
export function holidayDays(list: unknown, from: string, to: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!isDay(from) || !isDay(to) || to < from || daysBetween(from, to) > 400) return out
  for (const span of holidaySpans(list, from, to)) {
    for (let day = span.start; day <= span.end; day = addDays(day, 1)) {
      if (day >= from && day <= to && !out[day]) out[day] = span.name
    }
  }
  return out
}

/** The next time each holiday falls (from today), soonest first: for the list on the screens. */
export function upcomingHolidays(list: unknown, now: Date | number = Date.now(), withinDays = 400): HolidaySpan[] {
  const today = istDate(now)
  const spans = holidaySpans(list, today, addDays(today, withinDays))
  const firstEach = new Map<string, HolidaySpan>()
  for (const span of spans) if (!firstEach.has(span.id)) firstEach.set(span.id, span)
  return [...firstEach.values()].sort((a, b) => a.start.localeCompare(b.start))
}

/** The next time this one holiday falls on or after today (null when a one-off has gone). */
export function nextTime(holiday: Holiday, now: Date | number = Date.now()): HolidaySpan | null {
  const today = istDate(now)
  return holidaySpans([holiday], today, addDays(today, 800))[0] || null
}

/** A suggested holiday's next date (Republic Day → the coming 26 Jan). */
export function suggestedStart(monthDay: string, now: Date | number = Date.now()): string {
  const today = istDate(now)
  const year = Number(today.slice(0, 4))
  const thisYear = `${year}-${monthDay}`
  return thisYear >= today ? thisYear : `${year + 1}-${monthDay}`
}

// ── Words ───────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** 1st, 2nd, 3rd, 4th, 11th, 21st, 22nd, 31st */
export function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`
}

/** "8 Nov", or "8 Nov 2026" with the year */
export function shortDay(date: string, withYear = false): string {
  const { y, m, d } = parts(date)
  return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ''}`
}

/** "8 Nov", "8 to 10 Nov", "30 Dec to 2 Jan" (with the year when asked) */
export function spanLabel(span: { start: string; end: string }, withYear = false): string {
  if (span.start === span.end) return shortDay(span.start, withYear)
  const a = parts(span.start)
  const b = parts(span.end)
  if (a.y === b.y && a.m === b.m) return `${a.d} to ${b.d} ${MONTHS[b.m - 1]}${withYear ? ` ${b.y}` : ''}`
  return `${shortDay(span.start, withYear && a.y !== b.y)} to ${shortDay(span.end, withYear)}`
}

/** "Only once", "Every year on 26 Jan", "Every month on the 1st", "Every month on the 2nd Tuesday", "… the last Saturday" */
export function repeatLabel(holiday: Pick<Holiday, 'start' | 'repeat' | 'days'>): string {
  const length = holiday.days > 1 ? `, ${holiday.days} days` : ''
  if (holiday.repeat === 'yearly') return `Every year on ${shortDay(holiday.start)}${length}`
  if (holiday.repeat === 'monthly') return `Every month on the ${ordinal(parts(holiday.start).d)}${length}`
  const weekday = WEEKDAYS[weekdayOf(holiday.start)]
  if (holiday.repeat === 'monthly_weekday' && weekOfMonth(holiday.start) <= 4) return `Every month on the ${ordinal(weekOfMonth(holiday.start))} ${weekday}${length}`
  if (holiday.repeat === 'monthly_weekday' || holiday.repeat === 'monthly_last_weekday') return `Every month on the last ${weekday}${length}`
  return holiday.days > 1 ? `Only once, ${holiday.days} days` : 'Only once'
}

/** The ways a holiday starting on this day can repeat, with words for a picker. */
export function repeatChoices(start: string): { value: HolidayRepeat; label: string }[] {
  if (!isDay(start)) return [{ value: 'none', label: 'Only once' }]
  const choices: { value: HolidayRepeat; label: string }[] = [
    { value: 'none', label: 'Only once' },
    { value: 'yearly', label: repeatLabel({ start, repeat: 'yearly', days: 1 }) },
    { value: 'monthly', label: repeatLabel({ start, repeat: 'monthly', days: 1 }) },
  ]
  if (weekOfMonth(start) <= 4) choices.push({ value: 'monthly_weekday', label: repeatLabel({ start, repeat: 'monthly_weekday', days: 1 }) })
  // In the month's last week: "the last Saturday" too
  if (parts(start).d > monthLength(parts(start).y, parts(start).m) - 7) choices.push({ value: 'monthly_last_weekday', label: repeatLabel({ start, repeat: 'monthly_last_weekday', days: 1 }) })
  return choices
}

/** For the AI assistant: "Closed for holidays: Diwali (8 Nov), Republic Day (26 Jan)." or "" when none soon. */
export function holidaysSentence(list: unknown, now: Date | number = Date.now(), withinDays = 60): string {
  const today = istDate(now)
  const spans = holidaySpans(list, today, addDays(today, withinDays)).slice(0, 8)
  if (!spans.length) return ''
  return `Closed for holidays: ${spans.map((s) => `${s.name} (${spanLabel(s)}${s.start !== s.end ? '' : `, ${WEEKDAYS[weekdayOf(s.start)]}`}, ${s.start})`).join('; ')}.`
}
