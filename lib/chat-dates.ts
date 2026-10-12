/**
 * WhatsApp-style date formatting for the conversation list and the message thread.
 * Everything is computed in the viewer's local time zone and locale.
 */

type DateInput = string | number | Date | null | undefined

const DAY_MS = 24 * 60 * 60 * 1000

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Whole calendar days between `date` and `now` (0 = today, 1 = yesterday). */
function calendarDaysAgo(date: Date, now: Date): number {
  // Rounded because a day that contains a DST change is 23 or 25 hours long
  return Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS)
}

function formatNumericDate(date: Date): string {
  return date.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Today -> "Today", yesterday -> "Yesterday", the last week -> weekday, older -> date. */
function formatRelativeDay(date: Date, now: Date): string | null {
  const daysAgo = calendarDaysAgo(date, now)
  if (daysAgo === 0) return 'Today'
  if (daysAgo === 1) return 'Yesterday'
  if (daysAgo > 1 && daysAgo < 7) return date.toLocaleDateString([], { weekday: 'long' })
  return null
}

export function isSameDay(a: DateInput, b: DateInput): boolean {
  const first = toDate(a)
  const second = toDate(b)
  if (!first || !second) return false
  return startOfDay(first) === startOfDay(second)
}

/** Time shown inside a message bubble, e.g. "9:05 am". */
export function formatChatTime(value: DateInput): string {
  const date = toDate(value)
  if (!date) return ''
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
}

/** Label of the date divider between two days of messages. */
export function formatChatDayLabel(value: DateInput, now: Date = new Date()): string {
  const date = toDate(value)
  if (!date) return ''
  return formatRelativeDay(date, now) ?? formatNumericDate(date)
}

/** Timestamp in the conversation list: the time for today, otherwise the day. */
export function formatChatListTimestamp(value: DateInput, now: Date = new Date()): string {
  const date = toDate(value)
  if (!date) return ''
  if (calendarDaysAgo(date, now) === 0) return formatChatTime(date)
  return formatRelativeDay(date, now) ?? formatNumericDate(date)
}
