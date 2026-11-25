import { NextRequest, NextResponse } from 'next/server'
import { can } from '@/lib/rbac'
import { badRequest, loadSalonSettings, salonAccess, serverError } from '@/lib/salon/server'
import { clearMarks, loadTeam, marksInMonth, marksOn, saveMarks, type AttendanceRow } from '@/lib/salon/attendance-store'
import {
  cleanMarks, dayCounts, dayList, dayProblem, isDay, leaveRange, leaveSpans, markAll, monthSummary, readMonth,
  type AttendanceMark,
} from '@/lib/salon/attendance'
import { istDate } from '@/lib/salon/spoken'

export const runtime = 'nodejs'

/** Notes can say why someone is away (a doctor's visit): only managers see them. */
const forViewer = (rows: AttendanceRow[], manager: boolean) => (manager ? rows : rows.map((row) => ({ ...row, note: null })))

// GET ?organizationId&day=YYYY-MM-DD: everyone on the team that day with their mark (the default: today)
//     ?organizationId&month=YYYY-MM[&staffId]: a month's marks, totals per person and leave ranges
// Everyone in the workspace can look (the counter needs to know who is away); only managers mark.
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const access = await salonAccess(request, params.get('organizationId'))
  if (!access.ok) return access.response
  const { db, organizationId, user } = access.ctx
  const manager = can(user, 'automation.manage')
  try {
    const [team, settings] = await Promise.all([loadTeam(db, organizationId), loadSalonSettings(db, organizationId)])
    const closed: number[] = Array.isArray(settings.closed_weekdays) ? settings.closed_weekdays : []
    const staffId = params.get('staffId') || null
    if (params.get('month') || staffId) {
      const month = readMonth(params.get('month'))
      const marks = await marksInMonth(db, organizationId, month, staffId)
      const people = team.filter((m) => (staffId ? m.id === staffId : m.active || marks.some((x) => x.staff_id === m.id)))
      return NextResponse.json({
        success: true, month, today: istDate(), closedWeekdays: closed, canMark: manager,
        staff: people, marks: forViewer(marks, manager),
        summary: monthSummary(people, marks, month, Date.now(), closed),
        leave: leaveSpans(marks, staffId, closed).map((span) => (manager ? span : { ...span, note: null })),
      })
    }
    const day = isDay(params.get('day')) ? params.get('day')! : istDate()
    const marks = await marksOn(db, organizationId, day)
    const rows = dayList(team, marks, day)
    return NextResponse.json({
      success: true, day, today: istDate(), closedWeekdays: closed, canMark: manager,
      staff: team.filter((m) => m.active), marks: forViewer(marks, manager),
      rows: rows.map((row) => ({ ...row, mark: row.mark && !manager ? { ...row.mark, note: null } : row.mark })),
      counts: dayCounts(rows),
    })
  } catch (error) {
    return serverError('attendance', error)
  }
}

// POST (or PUT, which the app's offline queue sends again safely: a mark replaces the one before)
//   { organizationId, marks: [{ staff_id, day, status, leave_kind?, note? }] }   one or many marks
//   { organizationId, all: { day, status? } }                                       everyone not marked yet (default present)
//   { organizationId, leave: { staff_id, from, to, leave_kind?, note?, status? } }  leave from one day to another
// Managers and up.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  const { db, organizationId, user } = access.ctx
  try {
    let marks: AttendanceMark[]
    let what: string
    if (body?.leave && typeof body.leave === 'object') {
      const settings = await loadSalonSettings(db, organizationId)
      const range = leaveRange(body.leave, Date.now(), Array.isArray(settings.closed_weekdays) ? settings.closed_weekdays : [])
      if ('error' in range) return NextResponse.json({ error: range.error, field: range.field }, { status: 400 })
      marks = range.value
      what = 'leave'
    } else if (body?.all && typeof body.all === 'object') {
      const day = String(body.all.day || istDate())
      const problem = dayProblem(day)
      if (problem) return NextResponse.json({ error: problem, field: 'day' }, { status: 400 })
      const [team, existing] = await Promise.all([loadTeam(db, organizationId), marksOn(db, organizationId, day)])
      marks = markAll(team, day, existing, { status: body.all.status, overwrite: body.all.overwrite === true })
      what = 'everyone'
      if (!marks.length) return NextResponse.json({ success: true, saved: [], count: 0, message: 'Everyone is already marked.' })
    } else {
      const checked = cleanMarks(Array.isArray(body?.marks) ? body.marks : body?.mark ? [body.mark] : [])
      if ('error' in checked) return NextResponse.json({ error: checked.error, field: checked.field }, { status: 400 })
      marks = checked.value
      what = 'marks'
    }
    const result = await saveMarks(db, organizationId, marks, user?.id)
    if ('error' in result) return NextResponse.json({ error: result.error, field: result.field }, { status: 400 })
    const message = what === 'leave' ? `${marks[0]?.status === 'week_off' ? 'Week off' : marks[0]?.status === 'absent' ? 'Absent' : 'Leave'} marked for ${result.saved.length} day${result.saved.length === 1 ? '' : 's'}.`
      : what === 'everyone' ? `${result.saved.length} more marked.`
      : result.saved.length === 1 ? 'Marked.' : `${result.saved.length} marked.`
    return NextResponse.json({ success: true, saved: result.saved, count: result.saved.length, message })
  } catch (error) {
    return serverError('attendance', error)
  }
}

export const PUT = POST

// DELETE ?organizationId&staffId&day (or &from&to): take a mark (or a leave range) off. Body works too. Managers and up.
export async function DELETE(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const body = await request.json().catch(() => ({}))
  const read = (key: string) => params.get(key) || (typeof body?.[key] === 'string' ? body[key] : null)
  const access = await salonAccess(request, read('organizationId'), 'automation.manage')
  if (!access.ok) return access.response
  const staffId = read('staffId') || read('staff_id')
  const from = read('from') || read('day')
  const to = read('to') || from
  if (!staffId) return badRequest('Choose a team member.')
  if (!isDay(from) || !isDay(to) || to! < from!) return badRequest('Choose the day to clear.')
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 > 62) return badRequest('Clear at most 62 days at a time.')
  const { db, organizationId } = access.ctx
  try {
    const removed = await clearMarks(db, organizationId, staffId, from!, to!)
    return NextResponse.json({ success: true, removed })
  } catch (error) {
    return serverError('attendance', error)
  }
}
