'use client'

/**
 * Staff attendance (Front Desk → Team → Attendance): today's team with one-tap Present / Absent / Leave / Half day /
 * Week off, "Mark all present", notes, leave from one day to another, and a month calendar per person with totals.
 * People marked absent, on leave or week off are not offered for bookings that day. Holidays: the shop's closed days
 * (salon-holidays.tsx), left out of leave and never "not marked".
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, CalendarHeart, CalendarOff, CalendarRange, Check, ChevronLeft, ChevronRight, Loader2, NotebookPen, Plus, UserCheck, X } from 'lucide-react'
import {
  ATTENDANCE_STATUSES, LEAVE_KINDS, LEAVE_KIND_LABELS, STATUS_INFO, addMonths, leaveRange, markLabel, monthBounds, monthDays, monthLabel, readMonth,
  type AttendanceMark, type AttendanceStatus, type LeaveKind, type LeaveSpan, type PersonMonth,
} from '@/lib/salon/attendance'
import { istWeekday } from '@/lib/salon/availability'
import { addDays, formatIstDay, fromIst, istDate } from '@/lib/salon/spoken'
import { api, Avatar, card, Field, input, Modal, primaryButton, secondaryButton } from './ui'
import { SalonHolidays } from './salon-holidays'
import type { Holiday } from '@/lib/salon/holidays'

type Flash = (tone: 'success' | 'error', text: string) => void
interface Person { id: string; name: string; active?: boolean }
interface DayData { day: string; today: string; canMark: boolean; closedWeekdays: number[]; holiday?: { name: string; start: string; end: string; label: string } | null; holidayRules?: Holiday[]; staff: Person[]; rows: { staff_id: string; name: string; mark: AttendanceMark | null }[]; counts: Record<string, number> }
interface MonthData { month: string; today: string; canMark: boolean; closedWeekdays: number[]; holidays?: Record<string, string>; holidayRules?: Holiday[]; staff: Person[]; marks: AttendanceMark[]; summary: PersonMonth[]; leave: LeaveSpan[] }
type View = 'day' | 'month' | 'holidays'

/** One look per status: blue for in, navy for leave, greys for half day and week off, red only for absent. */
const TONE: Record<AttendanceStatus, { on: string; soft: string; dot: string }> = {
  present: { on: 'bg-[#1D5BEA] border-[#1D5BEA] text-white', soft: 'bg-[#eef3fe] text-[#1D5BEA] dark:bg-blue-950/40 dark:text-blue-300', dot: 'bg-[#1D5BEA]' },
  absent: { on: 'bg-[#b91c1c] border-[#b91c1c] text-white', soft: 'bg-[#fdf0f0] text-[#b91c1c] dark:bg-red-950/30 dark:text-red-300', dot: 'bg-[#b91c1c]' },
  leave: { on: 'bg-[#0E1B3D] border-[#0E1B3D] text-white dark:bg-white dark:border-white dark:text-[#0E1B3D]', soft: 'bg-[#e3e8f2] text-[#0E1B3D] dark:bg-slate-700 dark:text-white', dot: 'bg-[#0E1B3D] dark:bg-white' },
  half_day: { on: 'bg-[#4a5672] border-[#4a5672] text-white', soft: 'bg-[#eef1f6] text-[#4a5672] dark:bg-slate-800 dark:text-slate-200', dot: 'bg-white border-2 border-[#1D5BEA] dark:bg-transparent' },
  week_off: { on: 'bg-[#6B7894] border-[#6B7894] text-white', soft: 'bg-[#f4f6fa] text-[#6B7894] dark:bg-slate-800 dark:text-slate-400', dot: 'bg-[#d5ddeb] dark:bg-slate-600' },
}
const SHORT_LABEL: Record<AttendanceStatus, string> = { present: 'Present', absent: 'Absent', leave: 'Leave', half_day: 'Half day', week_off: 'Week off' }
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const dayTitle = (day: string, today: string) => {
  const noon = fromIst(day, '12:00')
  const plain = noon ? noon.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : day
  const near = formatIstDay(day, today)
  return near === plain ? { title: plain, sub: '' } : { title: near, sub: plain }
}
const shortDate = (day: string) => fromIst(day, '12:00')?.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) || day
const plural = (n: number, word: string) => `${n % 1 ? n.toFixed(1) : n} ${word}${n === 1 ? '' : 's'}`

/** "Diwali 8 to 10 Nov, Stock day 1 Nov" from the month's holiday days. */
function holidayLine(days: Record<string, string>): string {
  const groups: { name: string; from: string; to: string }[] = []
  for (const day of Object.keys(days).sort()) {
    const last = groups[groups.length - 1]
    if (last && last.name === days[day] && addDays(last.to, 1) === day) last.to = day
    else groups.push({ name: days[day], from: day, to: day })
  }
  return groups.map((g) => `${g.name} ${g.from === g.to ? shortDate(g.from) : `${Number(g.from.slice(8))} to ${shortDate(g.to)}`}`).join(', ')
}

function StatusDot({ status, className = '' }: { status: AttendanceStatus; className?: string }) {
  return <span aria-hidden className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${TONE[status].dot} ${className}`} />
}

export function SalonAttendance({ orgId, flash, initialDay }: { orgId: string; flash: Flash; initialDay?: string }) {
  const today = istDate()
  const [view, setView] = useState<View>('day')
  const [day, setDay] = useState(initialDay || today)
  const [month, setMonth] = useState(today.slice(0, 7))
  const [person, setPerson] = useState('')
  const [dayData, setDayData] = useState<DayData | null>(null)
  const [monthData, setMonthData] = useState<MonthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  const [leaveFor, setLeaveFor] = useState<{ staffId: string } | null>(null)
  const latest = useRef(0)

  const loadDay = useCallback(async (which: string) => {
    const request = ++latest.current
    setLoading(true)
    try {
      const data = await api(`/api/salon/attendance?organizationId=${orgId}&day=${which}`)
      if (request === latest.current) setDayData(data)
    } catch (err: any) {
      if (request === latest.current) flash('error', err.message)
    } finally {
      if (request === latest.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  const loadMonth = useCallback(async (which: string, staffId: string) => {
    const request = ++latest.current
    setLoading(true)
    try {
      const data = await api(`/api/salon/attendance?organizationId=${orgId}&month=${which}${staffId ? `&staffId=${staffId}` : ''}`)
      if (request === latest.current) setMonthData(data)
    } catch (err: any) {
      if (request === latest.current) flash('error', err.message)
    } finally {
      if (request === latest.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  useEffect(() => { if (view === 'day') loadDay(day) }, [view, day, loadDay])
  useEffect(() => { if (view === 'month') loadMonth(month, person) }, [view, month, person, loadMonth])

  const canMark = (view === 'day' ? dayData?.canMark : view === 'month' ? monthData?.canMark : false) ?? false
  const team: Person[] = useMemo(() => dayData?.staff || monthData?.staff || [], [dayData, monthData])

  /** Put a mark on the screen at once, then the server's copy. */
  function showMark(staffId: string, mark: AttendanceMark | null) {
    setDayData((current) => {
      if (!current) return current
      const rows = current.rows.map((row) => (row.staff_id === staffId ? { ...row, mark } : row))
      const counts: Record<string, number> = { present: 0, absent: 0, leave: 0, half_day: 0, week_off: 0, not_marked: 0 }
      for (const row of rows) counts[row.mark ? row.mark.status : 'not_marked'] += 1
      return { ...current, rows, counts }
    })
  }

  async function mark(staffId: string, status: AttendanceStatus, extra: { leave_kind?: LeaveKind | null; note?: string | null } = {}) {
    const row = dayData?.rows.find((r) => r.staff_id === staffId)
    const before = row?.mark || null
    const next: AttendanceMark = {
      staff_id: staffId, day, status,
      leave_kind: status === 'leave' ? (extra.leave_kind !== undefined ? extra.leave_kind : before?.status === 'leave' ? before.leave_kind : null) : null,
      note: extra.note !== undefined ? extra.note : before?.note || null,
    }
    showMark(staffId, next)
    setSaving(staffId)
    try {
      const result = await api('/api/salon/attendance', { method: 'POST', body: JSON.stringify({ organizationId: orgId, marks: [next] }) })
      if (result.saved?.[0]) showMark(staffId, result.saved[0])
    } catch (err: any) {
      showMark(staffId, before)
      flash('error', err.message)
    } finally {
      setSaving(null)
    }
  }

  async function clear(staffId: string) {
    const before = dayData?.rows.find((r) => r.staff_id === staffId)?.mark || null
    showMark(staffId, null)
    setSaving(staffId)
    try {
      await api(`/api/salon/attendance?organizationId=${orgId}&staffId=${staffId}&day=${day}`, { method: 'DELETE' })
    } catch (err: any) {
      showMark(staffId, before)
      flash('error', err.message)
    } finally {
      setSaving(null)
    }
  }

  async function markAllPresent() {
    setSaving('all')
    try {
      const result = await api('/api/salon/attendance', { method: 'POST', body: JSON.stringify({ organizationId: orgId, all: { day } }) })
      flash('success', result.count ? `${result.count} ${result.count === 1 ? 'person' : 'people'} marked present.` : 'Everyone is already marked.')
      await loadDay(day)
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setSaving(null)
    }
  }

  async function cancelLeave(span: LeaveSpan) {
    setSaving(`${span.staff_id}:${span.from}`)
    try {
      await api(`/api/salon/attendance?organizationId=${orgId}&staffId=${span.staff_id}&from=${span.from}&to=${span.to}`, { method: 'DELETE' })
      flash('success', 'Leave taken off.')
      await loadMonth(month, person)
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setSaving(null)
    }
  }

  async function saveNote(staffId: string) {
    const row = dayData?.rows.find((r) => r.staff_id === staffId)
    if (!row?.mark) return
    setNoteFor(null)
    await mark(staffId, row.mark.status, { note: noteText.trim() || null })
  }

  const counts = dayData?.counts
  const { title, sub } = dayTitle(day, today)

  return (
    <div className="space-y-4">
      {/* Day or month, the date, and the main buttons */}
      <div className="flex flex-col @2xl:flex-row @2xl:items-center gap-2.5">
        <div role="tablist" aria-label="Attendance view" className="grid grid-cols-3 rounded-xl bg-[#eef1f6] dark:bg-slate-900 p-1 @2xl:w-[340px] shrink-0">
          {(['day', 'month', 'holidays'] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={`h-9 min-w-0 px-1 rounded-lg text-[14px] font-semibold cursor-pointer inline-flex items-center justify-center gap-1.5 ${view === v ? 'bg-white dark:bg-[#111b21] text-[#0E1B3D] dark:text-white shadow-sm' : 'text-[#4a5672] dark:text-slate-400'}`}>
              {v === 'day' ? <><UserCheck size={15} className="shrink-0" /> Day</> : v === 'month' ? <><CalendarDays size={15} className="shrink-0" /> Month</> : <><CalendarHeart size={15} className="shrink-0" /> Holidays</>}
            </button>
          ))}
        </div>

        {view !== 'holidays' && <div className="flex items-center rounded-2xl bg-white dark:bg-[#111b21] border border-[#e3e8f2] dark:border-slate-800 p-1 w-full @2xl:w-auto min-w-0">
          <button type="button" onClick={() => (view === 'day' ? setDay(addDays(day, -1)) : setMonth(addMonths(month, -1)))} aria-label={view === 'day' ? 'Previous day' : 'Previous month'} className="h-10 w-10 shrink-0 rounded-xl flex items-center justify-center text-[#4a5672] dark:text-slate-300 hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer"><ChevronLeft size={19} /></button>
          {view === 'day' ? (
            <label className="relative h-10 px-2 flex-1 @2xl:flex-none @2xl:min-w-[170px] rounded-xl text-center hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer min-w-0 flex flex-col justify-center">
              <span className="block text-[15px] font-extrabold text-[#0E1B3D] dark:text-white leading-tight truncate">{title}</span>
              {sub && <span className="block text-[12px] font-semibold text-[#8a94a8] leading-tight truncate">{sub}</span>}
              <input type="date" aria-label="Pick a day" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
            </label>
          ) : (
            <span className="h-10 px-2 flex-1 @2xl:flex-none @2xl:min-w-[170px] rounded-xl flex items-center justify-center text-[15px] font-extrabold text-[#0E1B3D] dark:text-white truncate">{monthLabel(month)}</span>
          )}
          <button type="button" disabled={view === 'month' && readMonth(addMonths(month, 1)) !== addMonths(month, 1)} onClick={() => (view === 'day' ? setDay(addDays(day, 1)) : setMonth(addMonths(month, 1)))} aria-label={view === 'day' ? 'Next day' : 'Next month'} className="h-10 w-10 shrink-0 rounded-xl flex items-center justify-center text-[#4a5672] dark:text-slate-300 hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer disabled:opacity-30 disabled:cursor-default"><ChevronRight size={19} /></button>
        </div>}
        {((view === 'day' && day !== today) || (view === 'month' && month !== today.slice(0, 7))) && (
          <button type="button" onClick={() => (view === 'day' ? setDay(today) : setMonth(today.slice(0, 7)))} className="self-start @2xl:self-auto h-10 px-3 rounded-xl text-[14px] font-semibold text-[#1D5BEA] hover:bg-[#eef3fe] dark:hover:bg-blue-950/40 cursor-pointer">{view === 'day' ? 'Today' : 'This month'}</button>
        )}

        {canMark && (
          <div className="grid grid-cols-2 gap-2 @2xl:flex @2xl:ml-auto">
            {view === 'day' && <button type="button" disabled={saving === 'all' || !counts?.not_marked || Boolean(dayData?.holiday)} onClick={markAllPresent} className={`${primaryButton} px-3 whitespace-nowrap`}>{saving === 'all' ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />} Mark all present</button>}
            <button type="button" onClick={() => setLeaveFor({ staffId: person || '' })} className={`${secondaryButton} px-3 whitespace-nowrap ${view === 'month' ? 'col-span-2' : ''}`}><CalendarOff size={17} /> Add leave</button>
          </div>
        )}
      </div>

      {view === 'day' && (
        <>
          {dayData?.holiday && dayData.day === day && (
            <div className="flex items-start gap-3 rounded-2xl border border-[#d5ddeb] dark:border-slate-700 bg-[#f4f6fa] dark:bg-slate-900 px-4 py-3">
              <CalendarHeart size={20} className="text-[#1D5BEA] shrink-0 mt-0.5" />
              <div className="min-w-0 text-[14px] text-[#4a5672] dark:text-slate-300">
                <p className="font-bold text-[#0E1B3D] dark:text-white">Shop holiday: {dayData.holiday.name} ({dayData.holiday.label})</p>
                <p>The shop is closed: no bookings are taken and nobody needs marking. Mark anyone who came in anyway.</p>
              </div>
              <button type="button" onClick={() => setView('holidays')} className="ml-auto shrink-0 h-9 px-2.5 rounded-lg text-[13.5px] font-semibold text-[#1D5BEA] hover:bg-[#eef3fe] dark:hover:bg-blue-950/40 cursor-pointer">Holidays</button>
            </div>
          )}
          {counts && (
            <div className="flex flex-wrap gap-1.5" aria-label="Today's numbers">
              {ATTENDANCE_STATUSES.map((status) => (
                <span key={status} className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[13px] font-semibold ${counts[status] ? TONE[status].soft : 'bg-[#f4f6fa] text-[#8a94a8] dark:bg-slate-800 dark:text-slate-500'}`}>
                  <StatusDot status={status} /> {SHORT_LABEL[status]} <span className="font-extrabold">{counts[status]}</span>
                </span>
              ))}
              <span className="inline-flex items-center h-8 px-2.5 rounded-lg text-[13px] font-semibold bg-white border border-dashed border-[#d5ddeb] text-[#4a5672] dark:bg-transparent dark:border-slate-700 dark:text-slate-300">Not marked <span className="ml-1.5 font-extrabold">{counts.not_marked}</span></span>
            </div>
          )}

          <section className={card}>
            {loading && !dayData ? <div className="flex justify-center py-14"><Loader2 className="animate-spin text-[#1D5BEA]" /></div>
              : !dayData?.rows.length ? <p className="px-5 py-12 text-center text-[15px] text-[#6B7894]">Add your team in Setup → Team, then mark who came in each day.</p>
              : (
                <ul className={`divide-y divide-[#eef1f6] dark:divide-slate-800 ${loading ? 'opacity-60' : ''}`}>
                  {dayData.rows.map((row) => {
                    const current = row.mark
                    const busy = saving === row.staff_id
                    return (
                      <li key={row.staff_id} className="px-3.5 @xl:px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <Avatar name={row.name} size={40} />
                          <div className="min-w-0 flex-1">
                            <p className="text-[16px] font-bold text-[#0E1B3D] dark:text-white truncate">{row.name}</p>
                            <p className={`text-[13px] flex items-center gap-1.5 min-w-0 ${current ? 'text-[#4a5672] dark:text-slate-300' : 'text-[#8a94a8]'}`}>
                              {current && <StatusDot status={current.status} />}
                              <span className="truncate">{current ? markLabel(current) : 'Not marked yet'}{current?.note ? ` · ${current.note}` : ''}</span>
                              {busy && <Loader2 size={13} className="animate-spin shrink-0" />}
                            </p>
                          </div>
                          {canMark && current && (
                            <div className="flex items-center shrink-0">
                              <button type="button" aria-label={`Note for ${row.name}`} onClick={() => { setNoteFor(noteFor === row.staff_id ? null : row.staff_id); setNoteText(current.note || '') }} className="h-9 w-9 rounded-lg flex items-center justify-center text-[#6B7894] hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer"><NotebookPen size={17} /></button>
                              <button type="button" aria-label={`Clear ${row.name}'s mark`} disabled={busy} onClick={() => clear(row.staff_id)} className="h-9 w-9 rounded-lg flex items-center justify-center text-[#6B7894] hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"><X size={17} /></button>
                            </div>
                          )}
                        </div>
                        {canMark && (
                          <div role="radiogroup" aria-label={`${row.name} on ${title}`} className="mt-2.5 grid grid-cols-3 @lg:grid-cols-5 gap-1.5">
                            {ATTENDANCE_STATUSES.map((status) => {
                              const on = current?.status === status
                              return (
                                <button key={status} type="button" role="radio" aria-checked={on} disabled={busy} onClick={() => (on ? clear(row.staff_id) : mark(row.staff_id, status))}
                                  className={`h-10 min-w-0 px-1.5 rounded-xl border text-[13.5px] font-semibold whitespace-nowrap cursor-pointer transition-colors disabled:cursor-wait ${on ? TONE[status].on : 'border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] text-[#0E1B3D] dark:text-slate-200 hover:border-[#9db5ef]'}`}>
                                  {SHORT_LABEL[status]}
                                </button>
                              )
                            })}
                          </div>
                        )}
                        {canMark && current?.status === 'leave' && (
                          <div role="radiogroup" aria-label="Kind of leave" className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span className="text-[12.5px] font-semibold text-[#6B7894] mr-0.5">Kind:</span>
                            {LEAVE_KINDS.map((kind) => (
                              <button key={kind} type="button" role="radio" aria-checked={current.leave_kind === kind} disabled={busy} onClick={() => mark(row.staff_id, 'leave', { leave_kind: current.leave_kind === kind ? null : kind })}
                                className={`h-8 px-3 rounded-lg border text-[13px] font-semibold cursor-pointer ${current.leave_kind === kind ? 'border-[#0E1B3D] bg-[#e3e8f2] text-[#0E1B3D] dark:border-white dark:bg-slate-700 dark:text-white' : 'border-[#d5ddeb] dark:border-slate-700 text-[#4a5672] dark:text-slate-300'}`}>
                                {LEAVE_KIND_LABELS[kind]}
                              </button>
                            ))}
                          </div>
                        )}
                        {noteFor === row.staff_id && current && (
                          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); saveNote(row.staff_id) }}>
                            <input autoFocus value={noteText} maxLength={200} onChange={(e) => setNoteText(e.target.value)} placeholder="A short note, like “back on Friday”" aria-label={`Note for ${row.name}`} className={`${input} h-10 min-w-0`} />
                            <button type="submit" className={`${primaryButton} h-10 px-4 shrink-0`}>Save</button>
                          </form>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
          </section>
          {dayData && dayData.rows.some((r) => r.mark && STATUS_INFO[r.mark.status].away) && (
            <p className="text-[13px] text-[#6B7894] px-1">People absent, on leave or on a week off are not offered for bookings that day (WhatsApp, booking page and website). Their bookings already made stay; the counter shows a warning on them.</p>
          )}
        </>
      )}

      {view === 'month' && (
        <>
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-0.5" role="radiogroup" aria-label="Whose month">
            {[{ id: '', name: 'Everyone' }, ...team.filter((m) => m.active !== false)].map((m) => (
              <button key={m.id || 'all'} type="button" role="radio" aria-checked={person === m.id} onClick={() => setPerson(m.id)}
                className={`shrink-0 h-9 px-3.5 rounded-full border text-[14px] font-semibold cursor-pointer ${person === m.id ? 'border-[#0E1B3D] bg-[#0E1B3D] text-white dark:border-white dark:bg-white dark:text-[#0E1B3D]' : 'border-[#e3e8f2] dark:border-slate-700 bg-white dark:bg-[#111b21] text-[#4a5672] dark:text-slate-300'}`}>
                {m.name}
              </button>
            ))}
          </div>
          {loading && !monthData ? <div className={`${card} flex justify-center py-14`}><Loader2 className="animate-spin text-[#1D5BEA]" /></div>
            : monthData && (
              <div className={`space-y-4 ${loading ? 'opacity-60' : ''}`}>
                {person
                  ? <PersonMonthView data={monthData} staffId={person} today={today} canMark={canMark} saving={saving} onOpenDay={(d) => { setDay(d); setView('day') }} onCancelLeave={cancelLeave} onAddLeave={() => setLeaveFor({ staffId: person })} />
                  : <EveryoneMonth data={monthData} today={today} onPick={setPerson} />}
                {Object.keys(monthData.holidays || {}).length > 0 && (
                  <p className="px-1 text-[13px] text-[#4a5672] dark:text-slate-300 flex items-start gap-1.5"><CalendarHeart size={15} className="text-[#1D5BEA] shrink-0 mt-px" /><span><span className="font-semibold">Holidays this month:</span> {holidayLine(monthData.holidays || {})}</span></p>
                )}
                <Legend />
              </div>
            )}
        </>
      )}

      {view === 'holidays' && <SalonHolidays orgId={orgId} flash={flash} onChanged={() => { setDayData(null); setMonthData(null) }} />}

      {leaveFor && (
        <LeaveSheet orgId={orgId} team={team.filter((m) => m.active !== false)} staffId={leaveFor.staffId} closedWeekdays={(view === 'day' ? dayData?.closedWeekdays : monthData?.closedWeekdays) || []} holidays={(view === 'day' ? dayData?.holidayRules : monthData?.holidayRules) || []} startDay={view === 'day' && day >= today ? day : today}
          onClose={() => setLeaveFor(null)}
          onSaved={(message) => { setLeaveFor(null); flash('success', message); if (view === 'day') loadDay(day); else loadMonth(month, person) }} />
      )}
    </div>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-1 text-[12.5px] text-[#6B7894]">
      {ATTENDANCE_STATUSES.map((status) => <span key={status} className="inline-flex items-center gap-1.5"><StatusDot status={status} /> {STATUS_INFO[status].short} = {STATUS_INFO[status].label}</span>)}
    </div>
  )
}

/** Everyone's month: a strip of days and the totals, tap a person for their calendar. */
function EveryoneMonth({ data, today, onPick }: { data: MonthData; today: string; onPick: (id: string) => void }) {
  const days = monthDays(data.month)
  const closed = new Set(data.closedWeekdays)
  if (!data.summary.length) return <div className={`${card} px-5 py-12 text-center text-[15px] text-[#6B7894]`}>Add your team in Setup → Team, then mark who came in each day.</div>
  return (
    <ul className={`${card} divide-y divide-[#eef1f6] dark:divide-slate-800`}>
      {data.summary.map((row) => {
        const own = new Map(data.marks.filter((m) => m.staff_id === row.staff_id).map((m) => [m.day, m.status]))
        return (
          <li key={row.staff_id}>
            <button type="button" onClick={() => onPick(row.staff_id)} className="w-full text-left px-3.5 @xl:px-5 py-3.5 hover:bg-[#f8fafc] dark:hover:bg-slate-900/60 cursor-pointer">
              <div className="flex items-center gap-3">
                <Avatar name={row.name} size={38} />
                <div className="min-w-0 flex-1">
                  <p className="text-[15.5px] font-bold text-[#0E1B3D] dark:text-white truncate">{row.name}</p>
                  <p className="text-[13px] text-[#4a5672] dark:text-slate-300">{plural(row.worked, 'day')} in</p>
                </div>
                <ChevronRight size={18} className="text-[#8a94a8] shrink-0" />
              </div>
              <div className="mt-2.5 flex flex-wrap gap-[3px]" aria-hidden>
                {days.map((d) => {
                  const status = own.get(d) as AttendanceStatus | undefined
                  const holiday = data.holidays?.[d]
                  const isClosed = closed.has(istWeekday(d)) || Boolean(holiday)
                  return <span key={d} title={holiday ? `${d}: ${holiday}` : d} className={`h-3 w-3 rounded-[3px] ${status ? TONE[status].dot : isClosed ? 'bg-[#f4f6fa] dark:bg-slate-800' : d <= today ? 'bg-white border border-dashed border-[#c0c8d8] dark:bg-transparent dark:border-slate-600' : 'bg-[#f4f6fa] dark:bg-slate-900'}`} />
                })}
              </div>
              <MonthNumbers row={row} />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function MonthNumbers({ row }: { row: PersonMonth }) {
  const chip = 'inline-flex items-center gap-1 h-7 px-2 rounded-md text-[12.5px] font-semibold'
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      <span className={`${chip} ${TONE.present.soft}`}>Present {row.present}</span>
      {row.half_day > 0 && <span className={`${chip} ${TONE.half_day.soft}`}>Half days {row.half_day}</span>}
      <span className={`${chip} ${TONE.leave.soft}`}>Leave {row.leave}</span>
      {row.absent > 0 && <span className={`${chip} ${TONE.absent.soft}`}>Absent {row.absent}</span>}
      <span className={`${chip} ${TONE.week_off.soft}`}>Week off {row.week_off}</span>
      {row.not_marked > 0 && <span className={`${chip} bg-white border border-dashed border-[#d5ddeb] text-[#4a5672] dark:bg-transparent dark:border-slate-700 dark:text-slate-300`}>Not marked {row.not_marked}</span>}
    </div>
  )
}

/** One person's month as a calendar, their totals and their leave. */
function PersonMonthView({ data, staffId, today, canMark, saving, onOpenDay, onCancelLeave, onAddLeave }: {
  data: MonthData; staffId: string; today: string; canMark: boolean; saving: string | null
  onOpenDay: (day: string) => void; onCancelLeave: (span: LeaveSpan) => void; onAddLeave: () => void
}) {
  const row = data.summary.find((r) => r.staff_id === staffId)
  const own = new Map(data.marks.filter((m) => m.staff_id === staffId).map((m) => [m.day, m]))
  const { first } = monthBounds(data.month)
  const lead = (istWeekday(first) + 6) % 7 // Monday first
  const days = monthDays(data.month)
  const closed = new Set(data.closedWeekdays)
  const spans = data.leave.filter((s) => s.staff_id === staffId)
  return (
    <div className="grid gap-4 @4xl:grid-cols-2 items-start">
      <section className={`${card} p-3 @xl:p-5`}>
        {row && (
          <div className="flex items-center gap-3 mb-3">
            <Avatar name={row.name} size={40} />
            <div className="min-w-0">
              <p className="text-[16.5px] font-bold text-[#0E1B3D] dark:text-white truncate">{row.name}</p>
              <p className="text-[13px] text-[#4a5672] dark:text-slate-300">{plural(row.worked, 'day')} in · {monthLabel(data.month)}</p>
            </div>
          </div>
        )}
        <div className="grid grid-cols-7 gap-1 text-center max-w-[460px]" role="grid" aria-label={`${row?.name || ''} in ${monthLabel(data.month)}`}>
          {WEEKDAYS.map((w) => <div key={w} className="text-[11.5px] font-bold uppercase tracking-wide text-[#8a94a8] pb-1"><span className="@md:hidden">{w.slice(0, 1)}</span><span className="hidden @md:inline">{w}</span></div>)}
          {Array.from({ length: lead }, (_, i) => <div key={`lead${i}`} />)}
          {days.map((d) => {
            const m = own.get(d)
            const holiday = data.holidays?.[d]
            const isClosed = closed.has(istWeekday(d)) || Boolean(holiday)
            const label = `${shortDate(d)}: ${m ? markLabel(m) : holiday ? `Holiday · ${holiday}` : isClosed ? 'Closed' : d > today ? 'Not yet' : 'Not marked'}`
            return (
              <button key={d} type="button" title={m?.note ? `${label} · ${m.note}` : label} aria-label={label} onClick={() => canMark && d <= addDays(today, 62) && onOpenDay(d)}
                className={`relative aspect-square min-h-[36px] max-h-[60px] w-full rounded-lg border flex flex-col items-center justify-center gap-0.5 ${canMark ? 'cursor-pointer hover:border-[#9db5ef]' : 'cursor-default'} ${d === today ? 'border-[#1D5BEA]' : 'border-[#eef1f6] dark:border-slate-800'} ${isClosed && !m ? 'bg-[#f8fafc] dark:bg-slate-900/50' : 'bg-white dark:bg-[#0b141a]'}`}>
                <span className={`text-[12.5px] leading-none font-semibold ${d > today ? 'text-[#a3adc2]' : 'text-[#0E1B3D] dark:text-slate-200'}`}>{Number(d.slice(8))}</span>
                {m ? <span className={`text-[10.5px] leading-none font-extrabold rounded px-1 py-[2px] ${TONE[m.status].soft}`}>{STATUS_INFO[m.status].short}</span>
                  : holiday ? <CalendarHeart size={12} className="text-[#1D5BEA]" aria-hidden />
                  : <span className="text-[10.5px] leading-none text-transparent select-none">·</span>}
              </button>
            )
          })}
        </div>
        {row && <MonthNumbers row={row} />}
      </section>

      <section className={card}>
        <div className="px-4 @xl:px-5 py-3.5 border-b border-[#eef1f6] dark:border-slate-800 flex items-center gap-2">
          <CalendarRange size={18} className="text-[#1D5BEA] shrink-0" />
          <h3 className="text-[16px] font-extrabold text-[#0E1B3D] dark:text-white">Leave this month</h3>
          {canMark && <button type="button" onClick={onAddLeave} className="ml-auto inline-flex items-center gap-1 h-9 px-3 rounded-xl text-[14px] font-semibold text-[#1D5BEA] hover:bg-[#eef3fe] dark:hover:bg-blue-950/40 cursor-pointer"><Plus size={16} /> Add</button>}
        </div>
        {!spans.length ? <p className="px-5 py-6 text-[14px] text-[#6B7894]">No leave this month.</p> : (
          <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800">
            {spans.map((span) => (
              <li key={span.from} className="px-4 @xl:px-5 py-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold text-[#0E1B3D] dark:text-white">{span.from === span.to ? shortDate(span.from) : `${shortDate(span.from)} to ${shortDate(span.to)}`}</p>
                  <p className="text-[13px] text-[#6B7894] truncate">{plural(span.days, 'day')}{span.leave_kind ? ` · ${LEAVE_KIND_LABELS[span.leave_kind]}` : ''}{span.note ? ` · ${span.note}` : ''}</p>
                </div>
                {canMark && <button type="button" disabled={saving === `${span.staff_id}:${span.from}`} onClick={() => onCancelLeave(span)} className="shrink-0 h-9 px-3 rounded-lg text-[13.5px] font-semibold text-[#4a5672] dark:text-slate-300 border border-[#d5ddeb] dark:border-slate-700 hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50">Cancel leave</button>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/** Leave from one day to another for one person (closed days are left out by the server and here). */
function LeaveSheet({ orgId, team, staffId, closedWeekdays, holidays, startDay, onClose, onSaved }: {
  orgId: string; team: Person[]; staffId: string; closedWeekdays: number[]; holidays: Holiday[]; startDay: string
  onClose: () => void; onSaved: (message: string) => void
}) {
  const [who, setWho] = useState(staffId || (team.length === 1 ? team[0].id : ''))
  const [from, setFrom] = useState(startDay)
  const [to, setTo] = useState(startDay)
  const [kind, setKind] = useState<LeaveKind | null>(null)
  const [status, setStatus] = useState<'leave' | 'week_off'>('leave')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const preview = who ? leaveRange({ staff_id: who, from, to, status, leave_kind: kind, note }, Date.now(), closedWeekdays, holidays) : null
  const count = preview && 'value' in preview ? preview.value.length : 0

  async function save() {
    setError('')
    if (!who) { setError('Choose who is on leave.'); return }
    if (preview && 'error' in preview) { setError(preview.error); return }
    setSaving(true)
    try {
      const result = await api('/api/salon/attendance', { method: 'POST', body: JSON.stringify({ organizationId: orgId, leave: { staff_id: who, from, to, status, leave_kind: kind, note: note.trim() || null } }) })
      onSaved(result.message)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const chip = (on: boolean) => `h-10 px-3.5 rounded-xl border text-[14px] font-semibold cursor-pointer ${on ? 'border-[#1D5BEA] bg-[#eef3fe] text-[#1D5BEA] dark:bg-blue-950/40 dark:text-blue-300' : 'border-[#d5ddeb] dark:border-slate-700 text-[#0E1B3D] dark:text-slate-200'}`
  return (
    <Modal title="Add leave" subtitle="Mark days off in one go" icon={<CalendarOff size={20} />} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
        <button type="button" disabled={saving} onClick={save} className={primaryButton}>{saving ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />} {count ? `Save ${plural(count, 'day')}` : 'Save'}</button>
      </>}>
      <div className="space-y-4">
        <Field label="Who" group>
          <div className="flex flex-wrap gap-1.5">
            {team.map((m) => <button key={m.id} type="button" aria-pressed={who === m.id} onClick={() => setWho(m.id)} className={chip(who === m.id)}>{m.name}</button>)}
          </div>
        </Field>
        <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
          <Field label="From"><input type="date" value={from} min={istDate()} onChange={(e) => { const v = e.target.value; if (v) { setFrom(v); if (to < v) setTo(v) } }} className={input} /></Field>
          <Field label="To"><input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className={input} /></Field>
        </div>
        <Field label="Mark as" group>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" aria-pressed={status === 'leave'} onClick={() => setStatus('leave')} className={chip(status === 'leave')}>Leave</button>
            <button type="button" aria-pressed={status === 'week_off'} onClick={() => setStatus('week_off')} className={chip(status === 'week_off')}>Week off</button>
          </div>
        </Field>
        {status === 'leave' && (
          <Field label="Kind of leave (if you like)" group>
            <div className="flex flex-wrap gap-1.5">
              {LEAVE_KINDS.map((k) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)} className={chip(kind === k)}>{LEAVE_KIND_LABELS[k]}</button>)}
            </div>
          </Field>
        )}
        <Field label="Note (if you like)"><input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Like “sister's wedding”" className={input} /></Field>
        <p className="text-[13.5px] text-[#4a5672] dark:text-slate-300">
          {preview && 'value' in preview ? `${plural(count, 'day')} will be marked${closedWeekdays.length || holidays.length ? ' (days you are closed and holidays are left out)' : ''}. They are not offered for bookings on those days.` : preview && 'error' in preview ? preview.error : 'Choose who, and the days.'}
        </p>
        {error && <p role="alert" className="rounded-xl bg-[#fdf0f0] dark:bg-red-950/30 px-3.5 py-2.5 text-[14px] font-semibold text-[#b91c1c] dark:text-red-300">{error}</p>}
      </div>
    </Modal>
  )
}
