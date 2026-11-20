'use client'

/**
 * Appointments: the day by team member (a grid on wide screens, a list on phones), the week, and a list
 * for any dates, with counts, filters and search. One appointment opens a sheet to move it (with a clash
 * check), mark arrived / started / no-show, cancel, bill it, and see the customer's past visits.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Clock, Loader2, MessageCircle, Phone, Receipt, RotateCcw, Search, UserRound, Users, X } from 'lucide-react'
import { dayWindow, layoutDay, onDay, periodSummary, shiftDate, STATUS_WORDS, weekOf } from '@/lib/salon/calendar'
import { formatRupees } from '@/lib/salon/invoice'
import { paymentNote } from '@/lib/salon/booking-pay'
import { formatIstDay, formatIstTime, istDate } from '@/lib/salon/spoken'
import { BillSheet, BookingSheet, DayAndTime, ResultSheet, type BillTarget, type BookingDraft } from './counter-sheets'
import { api, Avatar, card, Chip, input, Modal, primaryButton, secondaryButton, Toggle } from './ui'
import type { Appointment, SalonSetup } from './types'

type Flash = (tone: 'success' | 'error', text: string) => void
type View = 'day' | 'week' | 'list'
type Sheet = { kind: 'open'; appointment: Appointment } | { kind: 'book'; draft: BookingDraft } | { kind: 'bill'; target: BillTarget } | { kind: 'result'; result: any } | null

const PX_PER_MIN = 1.5
const sectionTitle = 'text-[13px] font-bold uppercase tracking-wide text-[#6B7894] dark:text-slate-400'
const errorBox = 'rounded-xl bg-[#fdf0f0] dark:bg-red-950/30 text-[#b91c1c] dark:text-red-300 px-4 py-3 text-[14.5px] font-medium'

/** Colours by state: navy / blue / grey, red only for no-shows. */
function tone(status: string) {
  switch (status) {
    case 'arrived': case 'in_service': return 'bg-[#1D5BEA] text-white border-[#1D5BEA]'
    case 'completed': return 'bg-[#eef1f6] text-[#4a5672] border-[#d5ddeb] dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
    case 'cancelled': return 'bg-white text-[#8a94a8] border-dashed border-[#d5ddeb] line-through dark:bg-transparent dark:border-slate-700'
    case 'no_show': return 'bg-[#fdf0f0] text-[#b91c1c] border-[#f3c7c7]'
    default: return 'bg-[#0E1B3D] text-white border-[#0E1B3D] dark:bg-white dark:text-[#0E1B3D] dark:border-white'
  }
}

function StatusPill({ status }: { status: string }) {
  return <span className={`inline-flex items-center h-6 px-2.5 rounded-full border text-[12px] font-bold whitespace-nowrap ${tone(status)} !no-underline`}>{STATUS_WORDS[status] || status}</span>
}

const servicesOf = (a: Appointment) => (a.services || []).map((s) => s.name).join(', ')
const time = (iso: string) => formatIstTime(iso)

export function SalonAppointments({ orgId, setup, canWrite, flash }: { orgId: string; setup: SalonSetup; canWrite: boolean; flash: Flash }) {
  const today = istDate()
  const [view, setView] = useState<View>('day')
  const [date, setDate] = useState(today)
  const [listRange, setListRange] = useState({ from: shiftDate(today, -7), to: shiftDate(today, 7) })
  const [staffFilter, setStaffFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [q, setQ] = useState('')
  const [appointments, setAppointments] = useState<Appointment[] | null>(null)
  const [error, setError] = useState('')
  const [sheet, setSheet] = useState<Sheet>(null)
  const [reload, setReload] = useState(0)
  const staff = useMemo(() => setup.staff.filter((m) => m.active !== false), [setup.staff])
  const staffName = useCallback((id?: string | null) => (id ? setup.staff.find((m) => m.id === id)?.name || 'Someone' : 'Anyone'), [setup.staff])

  const days = view === 'week' ? weekOf(date) : view === 'day' ? [date] : null
  const from = days ? days[0] : listRange.from
  const to = days ? days[days.length - 1] : listRange.to

  useEffect(() => {
    let gone = false
    setAppointments(null)
    api(`/api/salon/appointments?organizationId=${orgId}&from=${from}&to=${to}`)
      .then((data) => { if (!gone) { setAppointments(data.appointments || []); setError('') } })
      .catch((err) => { if (!gone) { setError(err.message); setAppointments([]) } })
    return () => { gone = true }
  }, [orgId, from, to, reload])

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase()
    const digits = q.replace(/\D/g, '')
    return (appointments || []).filter((a) =>
      (!staffFilter || a.staff_id === staffFilter || (a.services || []).some((s) => s.staff_id === staffFilter))
      && (!statusFilter || a.status === statusFilter || (statusFilter === 'booked' && ['booked', 'arrived', 'in_service'].includes(a.status)))
      && (!words || a.customer_name.toLowerCase().includes(words) || (digits.length >= 3 && String(a.customer_phone || '').replace(/\D/g, '').includes(digits)) || servicesOf(a).toLowerCase().includes(words)))
  }, [appointments, staffFilter, statusFilter, q])
  const summary = periodSummary(shown as any)

  const refresh = () => setReload((n) => n + 1)
  const move = (by: number) => setDate((d) => shiftDate(d, view === 'week' ? by * 7 : by))
  const heading = view === 'week' ? `${formatIstDay(days![0], today)} – ${formatIstDay(days![6], today)}` : view === 'day' ? formatIstDay(date, today) : ''

  return (
    <div className="space-y-4">
      {/* Views, dates, Book */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Calendar view" className="inline-flex rounded-xl bg-[#eef1f6] dark:bg-slate-900 p-1">
          {(['day', 'week', 'list'] as View[]).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={`h-9 px-3.5 rounded-lg text-[14px] font-semibold capitalize cursor-pointer ${view === v ? 'bg-white dark:bg-[#111b21] text-[#0E1B3D] dark:text-white shadow-sm' : 'text-[#4a5672] dark:text-slate-400'}`}>
              {v}
            </button>
          ))}
        </div>
        {view !== 'list' ? (
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => move(-1)} aria-label="Earlier" className="h-10 w-10 rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#111b21] flex items-center justify-center cursor-pointer"><ChevronLeft size={18} /></button>
            <label className="relative h-10 px-3 rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#111b21] inline-flex items-center gap-2 text-[14px] font-semibold text-[#0E1B3D] dark:text-white cursor-pointer">
              <CalendarDays size={16} className="text-[#1D5BEA]" /> <span className="whitespace-nowrap">{heading}</span>
              <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Pick a day" className="absolute inset-0 opacity-0 cursor-pointer" />
            </label>
            <button type="button" onClick={() => move(1)} aria-label="Later" className="h-10 w-10 rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#111b21] flex items-center justify-center cursor-pointer"><ChevronRight size={18} /></button>
            {date !== today && <button type="button" onClick={() => setDate(today)} className="h-10 px-3 rounded-xl text-[14px] font-semibold text-[#1D5BEA] cursor-pointer">Today</button>}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-[14px]">
            <input type="date" value={listRange.from} onChange={(e) => e.target.value && setListRange((r) => ({ from: e.target.value, to: e.target.value > r.to ? e.target.value : r.to }))} aria-label="From" className={`${input} w-[150px] h-10`} />
            <span className="text-[#6B7894]">to</span>
            <input type="date" value={listRange.to} onChange={(e) => e.target.value && setListRange((r) => ({ from: e.target.value < r.from ? e.target.value : r.from, to: e.target.value }))} aria-label="To" className={`${input} w-[150px] h-10`} />
          </div>
        )}
        {canWrite && <button type="button" onClick={() => setSheet({ kind: 'book', draft: { date: view === 'list' ? today : date, staff_id: staffFilter || null } })} className={`${primaryButton} ml-auto`}><CalendarPlus size={17} /> Book</button>}
      </div>

      {/* Filters */}
      <div className="flex flex-col @xl:flex-row gap-2">
        <div className="relative @xl:max-w-xs flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8a94a8]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer, mobile or service" aria-label="Search appointments" className={`${input} pl-10 h-10`} />
        </div>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar [&>*]:shrink-0 whitespace-nowrap">
          <Chip selected={!staffFilter} onClick={() => setStaffFilter('')}>Everyone</Chip>
          {staff.map((m) => <Chip key={m.id} selected={staffFilter === m.id} onClick={() => setStaffFilter(staffFilter === m.id ? '' : m.id)}>{m.name}</Chip>)}
        </div>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar [&>*]:shrink-0 whitespace-nowrap">
          {[['', 'All'], ['booked', 'Coming / in'], ['completed', 'Done'], ['no_show', 'No-show'], ['cancelled', 'Cancelled']].map(([id, label]) => <Chip key={id || 'all'} selected={statusFilter === id} onClick={() => setStatusFilter(id)}>{label}</Chip>)}
        </div>
      </div>

      {/* Numbers */}
      <div className="grid grid-cols-3 @xl:grid-cols-6 gap-2">
        {[
          ['Appointments', summary.total], ['Coming', summary.upcoming], ['In the shop', summary.inShop], ['Done', summary.done],
          ['No-show', summary.noShow], ['Booked value', formatRupees(summary.expected)],
        ].map(([label, value]) => (
          <div key={String(label)} className={`${card} px-3 py-2.5`}>
            <p className="text-[12px] text-[#6B7894] truncate">{label}</p>
            <p className={`text-[18px] font-extrabold ${label === 'No-show' && Number(value) > 0 ? 'text-[#b91c1c]' : 'text-[#0E1B3D] dark:text-white'}`}>{value}</p>
          </div>
        ))}
      </div>

      {error && <div role="alert" className={errorBox}>{error}</div>}
      {appointments === null ? (
        <p className="py-14 text-center text-[#6B7894] inline-flex w-full justify-center items-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading appointments…</p>
      ) : view === 'day' ? (
        <DayView setup={setup} date={date} appointments={shown} staffFilter={staffFilter} staffName={staffName} onOpen={(a) => setSheet({ kind: 'open', appointment: a })}
          onEmpty={(staffId, at) => canWrite && setSheet({ kind: 'book', draft: { date, time: at, staff_id: staffId } })} />
      ) : view === 'week' ? (
        <WeekView days={days!} today={today} appointments={shown} staffName={staffName} onOpen={(a) => setSheet({ kind: 'open', appointment: a })} onDay={(d) => { setDate(d); setView('day') }} />
      ) : (
        <ListView appointments={shown} staffName={staffName} onOpen={(a) => setSheet({ kind: 'open', appointment: a })} />
      )}

      {sheet?.kind === 'open' && (
        <AppointmentSheet orgId={orgId} setup={setup} appointment={sheet.appointment} canWrite={canWrite} staffName={staffName} flash={flash}
          onClose={() => setSheet(null)} onChanged={refresh} onBill={(appointment) => setSheet({ kind: 'bill', target: { kind: 'appointment', appointment } })} />
      )}
      {sheet?.kind === 'book' && <BookingSheet orgId={orgId} setup={setup} draft={sheet.draft} onClose={() => setSheet(null)} onBooked={(result: any) => { setSheet(null); refresh(); flash('success', result?.warning ? `${result.message}. Note: ${result.warning}` : result?.message || 'Booked.') }} />}
      {sheet?.kind === 'bill' && <BillSheet orgId={orgId} setup={setup} target={sheet.target} onClose={() => setSheet(null)} onBilled={(result) => { refresh(); setSheet({ kind: 'result', result }) }} />}
      {sheet?.kind === 'result' && <ResultSheet result={sheet.result} onClose={() => setSheet(null)} onCopied={() => flash('success', 'Link copied')} />}
    </div>
  )
}

// ── Day ──────────────────────────────────────────────────────────────────────

function DayView({ setup, date, appointments, staffFilter, staffName, onOpen, onEmpty }: {
  setup: SalonSetup; date: string; appointments: Appointment[]; staffFilter: string; staffName: (id?: string | null) => string
  onOpen: (a: Appointment) => void; onEmpty: (staffId: string | null, time: string) => void
}) {
  const people = setup.staff.filter((m) => m.active !== false && (!staffFilter || m.id === staffFilter)).map((m) => m.id)
  const window = dayWindow(setup.settings, appointments)
  const { columns, blocks } = layoutDay(appointments as any, people, window)
  const hours = Array.from({ length: (window.end - window.start) / 60 }, (_, i) => window.start + i * 60)
  const nowLine = date === istDate() ? (() => { const d = new Date(Date.now() + 330 * 60_000); return d.getUTCHours() * 60 + d.getUTCMinutes() - window.start })() : null
  const label = (m: number) => { const h = Math.floor(m / 60) % 24; return `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}` }
  const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

  return (
    <>
      {/* Phones: the day as a list */}
      <div className="@3xl:hidden">
        <AgendaList appointments={appointments} staffName={staffName} onOpen={onOpen} empty="Nothing booked on this day." />
      </div>
      {/* Wide screens: the grid by team member */}
      <div className={`${card} hidden @3xl:block overflow-x-auto`}>
        {columns.length === 0 ? <p className="p-8 text-center text-[#6B7894]">Add your team in Setup to see their day here.</p> : (
          <div className="min-w-max">
            <div className="flex sticky top-0 z-10 bg-white dark:bg-[#111b21] border-b border-[#e3e8f2] dark:border-slate-800">
              <div className="w-16 shrink-0" />
              {columns.map((c) => (
                <div key={c} className="w-[190px] shrink-0 px-3 py-2.5 flex items-center gap-2 border-l border-[#eef1f6] dark:border-slate-800">
                  {c === 'anyone' ? <span className="h-8 w-8 rounded-full bg-[#eef1f6] flex items-center justify-center text-[#6B7894]"><Users size={15} /></span> : <Avatar name={staffName(c)} size={32} />}
                  <span className="font-bold text-[14px] text-[#0E1B3D] dark:text-white truncate">{c === 'anyone' ? 'Anyone' : staffName(c)}</span>
                  <span className="ml-auto text-[12px] text-[#6B7894]">{blocks.filter((b) => b.column === c && !['cancelled'].includes(b.appointment.status)).length}</span>
                </div>
              ))}
            </div>
            <div className="flex relative" style={{ height: (window.end - window.start) * PX_PER_MIN }}>
              <div className="w-16 shrink-0 relative">
                {hours.map((m) => <span key={m} style={{ top: (m - window.start) * PX_PER_MIN }} className="absolute right-2 -translate-y-1/2 text-[11.5px] text-[#8a94a8]">{m === window.start ? '' : label(m)}</span>)}
              </div>
              {columns.map((c) => (
                <div key={c} className="w-[190px] shrink-0 relative border-l border-[#eef1f6] dark:border-slate-800">
                  {hours.map((m) => (
                    <button key={m} type="button" aria-label={`Book ${c === 'anyone' ? '' : `${staffName(c)} `}at ${label(m)}`} onClick={() => onEmpty(c === 'anyone' ? null : c, clock(m))}
                      style={{ top: (m - window.start) * PX_PER_MIN, height: 60 * PX_PER_MIN }} className="absolute inset-x-0 border-t border-[#eef1f6] dark:border-slate-800 hover:bg-[#f4f6fa] dark:hover:bg-slate-900/50 cursor-pointer" />
                  ))}
                  {blocks.filter((b) => b.column === c).map((b) => {
                    const a = b.appointment as Appointment
                    const width = 100 / b.lanes
                    return (
                      <button key={a.id} type="button" onClick={() => onOpen(a)}
                        style={{ top: b.top * PX_PER_MIN + 1, height: Math.max(26, b.height * PX_PER_MIN - 2), left: `calc(${b.lane * width}% + 3px)`, width: `calc(${width}% - 6px)` }}
                        className={`absolute rounded-lg border px-2 py-1 text-left overflow-hidden cursor-pointer shadow-sm ${tone(a.status)}`}>
                        <span className="block text-[12.5px] font-bold leading-tight truncate">{a.customer_name}</span>
                        <span className="block text-[11.5px] leading-tight opacity-85 truncate">{time(a.starts_at)} · {servicesOf(a)}</span>
                      </button>
                    )
                  })}
                </div>
              ))}
              {nowLine !== null && nowLine >= 0 && nowLine <= window.end - window.start && (
                <div aria-hidden="true" style={{ top: nowLine * PX_PER_MIN }} className="absolute left-16 right-0 h-0.5 bg-[#b91c1c] pointer-events-none"><span className="absolute -left-1.5 -top-1 h-2.5 w-2.5 rounded-full bg-[#b91c1c]" /></div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function AgendaList({ appointments, staffName, onOpen, empty, showDay }: { appointments: Appointment[]; staffName: (id?: string | null) => string; onOpen: (a: Appointment) => void; empty: string; showDay?: boolean }) {
  if (!appointments.length) return <div className={`${card} p-8 text-center text-[14.5px] text-[#6B7894]`}>{empty}</div>
  return (
    <ul className={`${card} divide-y divide-[#eef1f6] dark:divide-slate-800`}>
      {appointments.map((a) => (
        <li key={a.id}>
          <button type="button" onClick={() => onOpen(a)} className="w-full text-left px-3.5 py-3 flex items-center gap-3 hover:bg-[#f8fafc] dark:hover:bg-slate-900/40 cursor-pointer">
            <span className="w-[62px] shrink-0 text-center">
              {showDay && <span className="block text-[11.5px] text-[#6B7894]">{formatIstDay(istDate(a.starts_at))}</span>}
              <span className="block text-[14.5px] font-extrabold text-[#0E1B3D] dark:text-white">{time(a.starts_at)}</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block font-bold truncate ${a.status === 'cancelled' ? 'line-through text-[#8a94a8]' : 'text-[#0E1B3D] dark:text-white'}`}>{a.customer_name}</span>
              <span className="block text-[13px] text-[#4a5672] dark:text-slate-400 truncate">{servicesOf(a)} · {staffName(a.staff_id)}</span>
            </span>
            <StatusPill status={a.status} />
          </button>
        </li>
      ))}
    </ul>
  )
}

// ── Week and list ────────────────────────────────────────────────────────────

function WeekView({ days, today, appointments, staffName, onOpen, onDay: openDay }: { days: string[]; today: string; appointments: Appointment[]; staffName: (id?: string | null) => string; onOpen: (a: Appointment) => void; onDay: (d: string) => void }) {
  return (
    <div className="grid gap-2 @3xl:grid-cols-7">
      {days.map((d) => {
        const list = onDay(appointments, d)
        const live = list.filter((a) => a.status !== 'cancelled')
        return (
          <section key={d} className={`${card} p-2.5 min-w-0 ${d === today ? 'ring-2 ring-[#1D5BEA]/40' : ''}`}>
            <button type="button" onClick={() => openDay(d)} className="w-full flex items-center justify-between gap-2 px-1 pb-2 cursor-pointer">
              <span className={`text-[13.5px] font-bold ${d === today ? 'text-[#1D5BEA]' : 'text-[#0E1B3D] dark:text-white'}`}>{formatIstDay(d, today)}</span>
              <span className="text-[12px] text-[#6B7894]">{live.length}</span>
            </button>
            {list.length === 0 ? <p className="px-1 pb-1 text-[12.5px] text-[#8a94a8]">Free</p> : (
              <ul className="space-y-1.5">
                {list.slice(0, 8).map((a) => (
                  <li key={a.id}>
                    <button type="button" onClick={() => onOpen(a)} className={`w-full text-left rounded-lg border px-2 py-1.5 cursor-pointer ${tone(a.status)}`}>
                      <span className="block text-[12px] font-bold truncate">{time(a.starts_at)} · {a.customer_name}</span>
                      <span className="block text-[11.5px] opacity-85 truncate">{staffName(a.staff_id)}</span>
                    </button>
                  </li>
                ))}
                {list.length > 8 && <li><button type="button" onClick={() => openDay(d)} className="w-full text-[12.5px] font-semibold text-[#1D5BEA] py-1 cursor-pointer">+{list.length - 8} more</button></li>}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}

function ListView({ appointments, staffName, onOpen }: { appointments: Appointment[]; staffName: (id?: string | null) => string; onOpen: (a: Appointment) => void }) {
  return <AgendaList appointments={appointments} staffName={staffName} onOpen={onOpen} showDay empty="No appointments in these dates." />
}

// ── One appointment ──────────────────────────────────────────────────────────

function AppointmentSheet({ orgId, setup, appointment, canWrite, staffName, flash, onClose, onChanged, onBill }: {
  orgId: string; setup: SalonSetup; appointment: Appointment; canWrite: boolean; staffName: (id?: string | null) => string; flash: Flash
  onClose: () => void; onChanged: () => void; onBill: (a: Appointment) => void
}) {
  const [a, setA] = useState(appointment)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [moving, setMoving] = useState(false)
  const [newDate, setNewDate] = useState(istDate(appointment.starts_at))
  const [newTime, setNewTime] = useState('')
  const [newStaff, setNewStaff] = useState<string | null>(appointment.staff_id)
  const [notify, setNotify] = useState(true)
  const [visits, setVisits] = useState<any[] | null>(null)
  const minutes = Math.max(15, Math.round((Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60_000))
  const phoneDigits = String(a.customer_phone || '').replace(/\D/g, '')

  useEffect(() => {
    let gone = false
    api(`/api/salon/appointments?organizationId=${orgId}&history=1&contact_id=${a.contact_id || ''}&phone=${encodeURIComponent(a.customer_phone || '')}`)
      .then((data) => { if (!gone) setVisits((data.visits || []).filter((v: any) => v.id !== a.id)) })
      .catch(() => { if (!gone) setVisits([]) })
    return () => { gone = true }
  }, [orgId, a.id, a.contact_id, a.customer_phone])

  async function act(action: any) {
    setBusy(true)
    setError('')
    try {
      const result = await api('/api/salon/act', { method: 'POST', body: JSON.stringify({ organizationId: orgId, action: { ...action, appointment_id: a.id } }) })
      if (result.appointment) setA(result.appointment)
      flash('success', result.warning ? `${result.message}. Note: ${result.warning}` : result.message)
      onChanged()
      setMoving(false)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function reschedule() {
    if (!newTime) { setError('Choose a time.'); return }
    const startsAt = new Date(`${newDate}T${newTime}:00+05:30`).toISOString()
    await act({ type: 'reschedule', starts_at: startsAt, staff_id: newStaff, send_whatsapp: notify })
  }

  const open = ['booked', 'arrived', 'in_service'].includes(a.status)
  const next = a.status === 'booked' ? { label: 'Arrived', status: 'arrived' } : a.status === 'arrived' ? { label: 'Start service', status: 'in_service' } : null
  const value = (a.services || []).reduce((sum, s: any) => sum + (Number(s.price) || 0), 0)

  return (
    <Modal size="lg" title={a.customer_name} icon={<CalendarDays size={21} />} subtitle={`${formatIstDay(istDate(a.starts_at))} · ${time(a.starts_at)}–${time(a.ends_at)}`} onClose={onClose}
      footer={canWrite && open ? (
        <div className="w-full flex flex-wrap items-center gap-2">
          {next && <button type="button" disabled={busy} onClick={() => act({ type: 'set_status', status: next.status })} className={secondaryButton}>{next.label}</button>}
          <button type="button" disabled={busy} onClick={() => onBill(a)} className={`${primaryButton} ml-auto`}><Receipt size={17} /> Bill</button>
        </div>
      ) : undefined}>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4 min-w-0">
          {error && <div role="alert" className={errorBox}>{error}</div>}
          <div className="flex items-center gap-3">
            <Avatar name={a.customer_name} size={44} />
            <div className="min-w-0 flex-1">
              <p className="font-bold text-[#0E1B3D] dark:text-white truncate">{a.customer_name}</p>
              <p className="text-[13.5px] text-[#6B7894] truncate">{a.customer_phone || 'No phone number'}</p>
            </div>
            <StatusPill status={a.status} />
          </div>
          {phoneDigits.length >= 10 && (
            <div className="flex gap-2">
              <a href={`tel:+${phoneDigits}`} className={`${secondaryButton} flex-1`}><Phone size={16} /> Call</a>
              <a href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noreferrer" className={`${secondaryButton} flex-1`}><MessageCircle size={16} /> WhatsApp</a>
            </div>
          )}
          <div className={`${card} p-4 space-y-2`}>
            <p className={sectionTitle}>Services</p>
            {(a.services || []).map((s: any, i) => (
              <div key={i} className="flex justify-between gap-3 text-[14.5px]">
                <span className="min-w-0"><span className="block font-semibold text-[#0E1B3D] dark:text-white break-words">{s.name}</span><span className="block text-[12.5px] text-[#6B7894]">{staffName(s.staff_id || a.staff_id)}{s.duration_minutes ? ` · ${s.duration_minutes} min` : ''}</span></span>
                <span className="font-bold shrink-0 text-[#0E1B3D] dark:text-white">{formatRupees(Number(s.price) || 0)}</span>
              </div>
            ))}
            <div className="flex justify-between pt-2 border-t border-dashed border-[#d5ddeb] dark:border-slate-700 font-bold text-[#0E1B3D] dark:text-white"><span>Value</span><span>{formatRupees(value)}</span></div>
            {paymentNote(a) && <p className="text-[13.5px] font-bold text-[#1D5BEA] dark:text-blue-300">{paymentNote(a)} · taken off the bill</p>}
            {a.notes && <p className="text-[13.5px] text-[#4a5672] dark:text-slate-300 whitespace-pre-line"><b>Note:</b> {a.notes}</p>}
          </div>

          {canWrite && open && !moving && (
            <div className="flex flex-wrap gap-2">
              {a.status !== 'in_service' && <button type="button" disabled={busy} onClick={() => setMoving(true)} className={secondaryButton}><RotateCcw size={16} /> Move</button>}
              {a.status === 'booked' && <button type="button" disabled={busy} onClick={() => act({ type: 'set_status', status: 'no_show' })} className={secondaryButton}><UserRound size={16} /> Did not come</button>}
              <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Cancel ${a.customer_name}'s appointment?`)) act({ type: 'set_status', status: 'cancelled' }) }} className={secondaryButton}><X size={16} /> Cancel</button>
            </div>
          )}
          {canWrite && (a.status === 'no_show' || a.status === 'cancelled') && (
            <button type="button" disabled={busy} onClick={() => act({ type: 'set_status', status: 'booked' })} className={secondaryButton}><RotateCcw size={16} /> Book again as it was</button>
          )}
        </div>

        <div className="space-y-4 min-w-0">
          {moving && (
            <div className={`${card} p-4 space-y-3`}>
              <div className="flex items-center justify-between"><p className={sectionTitle}>Move to</p><button type="button" onClick={() => setMoving(false)} aria-label="Close" className="h-8 w-8 rounded-lg flex items-center justify-center cursor-pointer"><X size={16} /></button></div>
              <div className="flex flex-wrap gap-1.5">
                <Chip selected={newStaff === null} onClick={() => setNewStaff(null)}>Anyone</Chip>
                {setup.staff.filter((m) => m.active !== false).map((m) => <Chip key={m.id} selected={newStaff === m.id} onClick={() => setNewStaff(m.id)}>{m.name}</Chip>)}
              </div>
              <DayAndTime orgId={orgId} setup={setup} date={newDate} time={newTime} minutes={minutes} serviceIds={(a.services || []).map((s: any) => s.service_id).filter(Boolean)} staffIds={[newStaff]} onDate={(d) => { setNewDate(d); setNewTime('') }} onTime={setNewTime} />
              {a.customer_phone && (
                <label className="flex items-center justify-between gap-3 text-[14px] font-semibold text-[#0E1B3D] dark:text-white">Tell them on WhatsApp <Toggle checked={notify} onChange={setNotify} label="Tell them on WhatsApp" /></label>
              )}
              <button type="button" disabled={busy || !newTime} onClick={reschedule} className={`${primaryButton} w-full`}>{busy ? <Loader2 size={17} className="animate-spin" /> : <Clock size={17} />} Move appointment</button>
            </div>
          )}
          <div className={`${card} p-4`}>
            <p className={`${sectionTitle} mb-2`}>Past visits</p>
            {visits === null ? <p className="text-[14px] text-[#6B7894]"><Loader2 size={14} className="inline animate-spin" /> Loading…</p> : visits.length === 0 ? <p className="text-[14px] text-[#6B7894]">First visit.</p> : (
              <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800">
                {visits.slice(0, 8).map((v) => (
                  <li key={v.id} className="py-2 flex items-center justify-between gap-3 text-[14px]">
                    <span className="min-w-0"><span className="block font-semibold text-[#0E1B3D] dark:text-white">{formatIstDay(istDate(v.starts_at))}</span><span className="block text-[12.5px] text-[#6B7894] truncate">{(v.services || []).map((s: any) => s.name).join(', ')}</span></span>
                    <StatusPill status={v.status} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
