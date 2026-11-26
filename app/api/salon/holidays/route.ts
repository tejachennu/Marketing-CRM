import { NextRequest, NextResponse } from 'next/server'
import { can } from '@/lib/rbac'
import { badRequest, salonAccess, serverError } from '@/lib/salon/server'
import { bookingsOnHoliday, loadHolidays, saveHolidays } from '@/lib/salon/holidays-store'
import {
  SUGGESTED_HOLIDAYS, cleanHoliday, nextTime, repeatLabel, spanLabel, suggestedStart, upcomingHolidays, withHoliday, withoutHoliday,
  type Holiday,
} from '@/lib/salon/holidays'
import { logChange } from '@/lib/salon/change-log'
import { istDate } from '@/lib/salon/spoken'

export const runtime = 'nodejs'

/** Each holiday with its words and the next time it falls, for the screens. */
function view(list: Holiday[], now = Date.now()) {
  return list.map((h) => {
    const next = nextTime(h, now)
    return { ...h, label: repeatLabel(h), next: next ? { start: next.start, end: next.end, label: spanLabel(next, true) } : null }
  })
}

function answer(list: Holiday[], canChange: boolean, extra: Record<string, unknown> = {}) {
  const now = Date.now()
  return NextResponse.json({
    success: true, today: istDate(now), canChange,
    holidays: view(list, now),
    upcoming: upcomingHolidays(list, now).slice(0, 12).map((s) => ({ ...s, label: spanLabel(s, true) })),
    // One-tap national holidays (each every year), those not added yet
    suggestions: SUGGESTED_HOLIDAYS.filter((s) => !list.some((h) => h.repeat === 'yearly' && h.start.slice(5) === s.monthDay))
      .map((s) => ({ name: s.name, start: suggestedStart(s.monthDay, now), repeat: 'yearly' as const })),
    ...extra,
  })
}

// GET ?organizationId: the shop's holidays (one-off and repeating), the next ones, and suggestions.
// Everyone in the workspace can look (the counter shows "Holiday today"); managers change them.
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const access = await salonAccess(request, params.get('organizationId'))
  if (!access.ok) return access.response
  const { db, organizationId, user } = access.ctx
  try {
    return answer(await loadHolidays(db, organizationId), can(user, 'automation.manage'))
  } catch (error) {
    return serverError('holidays', error)
  }
}

// POST (or PUT: the same holiday sent again just replaces it)
//   { organizationId, holiday: { id?, name, start, days?, repeat? } }   add one, or change the one with that id
// repeat: none | yearly | monthly | monthly_weekday | monthly_last_weekday. Managers and up.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  const checked = cleanHoliday(body?.holiday)
  if ('error' in checked) return NextResponse.json({ error: checked.error, field: checked.field }, { status: 400 })
  const { db, organizationId } = access.ctx
  try {
    const current = await loadHolidays(db, organizationId)
    const changing = current.some((h) => h.id === checked.value.id)
    const next = withHoliday(current, checked.value)
    if ('error' in next) return NextResponse.json({ error: next.error, field: next.field }, { status: 400 })
    const saved = await saveHolidays(db, organizationId, next.value)
    await logChange(access.ctx, { area: 'settings', action: changing ? 'changed holiday' : 'added holiday', target: checked.value.name, details: { start: checked.value.start, days: checked.value.days, repeat: repeatLabel(checked.value) } })
    // Bookings already on those days stay: say so, so the team can call those customers
    const booked = await bookingsOnHoliday(db, organizationId, checked.value)
    const message = booked.count
      ? `Saved. ${booked.count} booking${booked.count === 1 ? ' is' : 's are'} already on ${booked.count === 1 ? 'that day' : 'those days'}: they stay, so call ${booked.count === 1 ? 'that customer' : 'those customers'} to move ${booked.count === 1 ? 'it' : 'them'}.`
      : changing ? 'Holiday changed.' : 'Holiday added. No bookings will be taken that day.'
    return answer(saved, true, { saved: checked.value, bookings: booked, message })
  } catch (error) {
    return serverError('holidays', error)
  }
}

export const PUT = POST

// DELETE ?organizationId&id (body works too): remove a holiday (every time it repeats). Managers and up.
export async function DELETE(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const body = await request.json().catch(() => ({}))
  const read = (key: string) => params.get(key) || (typeof body?.[key] === 'string' ? body[key] : null)
  const access = await salonAccess(request, read('organizationId'), 'automation.manage')
  if (!access.ok) return access.response
  const id = read('id')
  if (!id) return badRequest('Choose the holiday to remove.')
  const { db, organizationId } = access.ctx
  try {
    const current = await loadHolidays(db, organizationId)
    const gone = current.find((h) => h.id === id)
    // Already removed (the app may send it again): nothing to do
    if (!gone) return answer(current, true, { removed: false, message: 'Already removed.' })
    const saved = await saveHolidays(db, organizationId, withoutHoliday(current, id))
    await logChange(access.ctx, { area: 'settings', action: 'removed holiday', target: gone.name, details: { start: gone.start, repeat: repeatLabel(gone) } })
    return answer(saved, true, { removed: true, message: `${gone.name} removed.` })
  } catch (error) {
    return serverError('holidays', error)
  }
}
