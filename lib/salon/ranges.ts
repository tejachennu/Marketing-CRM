/**
 * Date ranges for the salon's lists and reports, as India dates (inclusive): presets or any custom
 * range. Pure and browser-safe, so the screens and the API work out the same dates.
 */

import { addDays, formatIstDay, istDate, istDayRange } from './spoken'

export type RangePreset = 'today' | 'yesterday' | 'week' | 'month' | 'last_month' | 'custom'
export interface DateRange { preset: RangePreset; from: string; to: string }

export const RANGE_PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'Last 7 days' },
  { id: 'month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'custom', label: 'Custom' },
]

/** The longest custom range: about a year. */
export const MAX_RANGE_DAYS = 366

const DATE = /^\d{4}-\d{2}-\d{2}$/
const validDate = (value: unknown): value is string => typeof value === 'string' && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value

/** A preset's dates: today, yesterday, the last 7 days, this month or last month. */
export function periodRange(period: string, now = Date.now()): { from: string; to: string } {
  const today = istDate(now)
  if (period === 'today') return { from: today, to: today }
  if (period === 'yesterday') { const day = addDays(today, -1); return { from: day, to: day } }
  if (period === 'week') return { from: addDays(today, -6), to: today }
  const [year, month] = today.split('-').map(Number)
  if (period === 'last_month') {
    const first = new Date(Date.UTC(month === 1 ? year - 1 : year, (month + 10) % 12, 1)).toISOString().slice(0, 10)
    return { from: first, to: addDays(`${today.slice(0, 8)}01`, -1) }
  }
  return { from: `${today.slice(0, 8)}01`, to: today }
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/**
 * The range asked for. A custom range needs two real dates (swapped if back to front, at most a
 * year, never past today); anything else falls back to `fallback`.
 */
export function resolveRange(preset: unknown, from?: unknown, to?: unknown, now = Date.now(), fallback: RangePreset = 'month'): DateRange {
  const today = istDate(now)
  if (preset === 'custom' && validDate(from) && validDate(to)) {
    let [start, end] = from <= to ? [from, to] : [to, from]
    if (end > today) end = today
    if (start > end) start = end
    if (daysBetween(start, end) >= MAX_RANGE_DAYS) start = addDays(end, -(MAX_RANGE_DAYS - 1))
    return { preset: 'custom', from: start, to: end }
  }
  const known = RANGE_PRESETS.some((p) => p.id === preset && p.id !== 'custom') ? preset as RangePreset : fallback
  return { preset: known, ...periodRange(known, now) }
}

/** The range as times for the database: from the start of the first day to the end of the last (India time). */
export function rangeBounds(range: { from: string; to: string }): { start: string; end: string } {
  return { start: istDayRange(range.from).start, end: istDayRange(range.to).end }
}

/** "Today", "Sun, 1 Nov – Today", or with the year when it is not this year: "Wed, 1 Oct 2025 – Fri, 31 Oct 2025" */
export function rangeLabel(range: { from: string; to: string }, today = istDate()): string {
  const day = (date: string) => date.slice(0, 4) === today.slice(0, 4) ? formatIstDay(date, today) : `${formatIstDay(date, today)} ${date.slice(0, 4)}`
  return range.from === range.to ? day(range.from) : `${day(range.from)} – ${day(range.to)}`
}

/** Query string for a range: preset, and the dates when custom. */
export function rangeQuery(range: DateRange): string {
  return range.preset === 'custom' ? `preset=custom&from=${range.from}&to=${range.to}` : `preset=${range.preset}`
}
