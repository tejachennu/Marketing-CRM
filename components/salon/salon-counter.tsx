'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Armchair, ArrowUpRight, CalendarClock, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, CircleCheck, Clock, Hourglass, Loader2, MoreHorizontal, Play, Receipt, ReceiptText, UserCheck, UserX, Wallet, XCircle, Zap } from 'lucide-react'
import { formatRupees } from '@/lib/salon/invoice'
import { addDays, formatIstDay, formatIstTime, fromIst, istDate } from '@/lib/salon/spoken'
import { useConfirm } from '@/lib/dialog-context'
import { api, Avatar, card, primaryButton, StatTile } from './ui'
import { BillSheet, BookingSheet, ResultSheet, type BillTarget, type BookingDraft } from './counter-sheets'
import { BookingRequests } from './booking-requests'
import type { Appointment, SalonSetup } from './types'

type Flash = (tone: 'success' | 'error', text: string) => void
type Sheet =
  | { kind: 'book'; draft?: BookingDraft }
  | { kind: 'bill'; target: BillTarget }
  | { kind: 'result'; result: any; walkIn: boolean }
  | null

const LANES: { id: 'upcoming' | 'service' | 'done'; title: string; statuses: Appointment['status'][] }[] = [
  { id: 'upcoming', title: 'Upcoming', statuses: ['booked'] },
  { id: 'service', title: 'In service', statuses: ['arrived', 'in_service'] },
  { id: 'done', title: 'Done', statuses: ['completed', 'cancelled', 'no_show'] },
]

const STATUS_PILL: Record<Appointment['status'], [string, string]> = {
  requested: ['Requested', 'bg-[#fff4e0] text-[#b45309] dark:bg-amber-950/40 dark:text-amber-300'],
  booked: ['Booked', 'bg-[#eef3fe] text-[#1D5BEA] dark:bg-blue-950/40 dark:text-blue-300'],
  arrived: ['Arrived', 'bg-[#fff4e0] text-[#b45309] dark:bg-amber-950/40 dark:text-amber-300'],
  in_service: ['In service', 'bg-[#fdeef6] text-[#be185d] dark:bg-pink-950/40 dark:text-pink-300'],
  completed: ['Done', 'bg-[#e8f7f1] text-[#047857] dark:bg-emerald-950/40 dark:text-emerald-300'],
  cancelled: ['Cancelled', 'bg-[#eef1f6] text-[#6B7894] dark:bg-slate-800 dark:text-slate-400'],
  no_show: ['No-show', 'bg-[#eef1f6] text-[#6B7894] dark:bg-slate-800 dark:text-slate-400'],
}

const LANE_DOT: Record<string, string> = { upcoming: 'bg-[#1D5BEA]', service: 'bg-[#db2777]', done: 'bg-[#00A884]' }
const STRIPE: Record<Appointment['status'], string> = {
  requested: 'bg-[#f59e0b]',
  booked: 'bg-[#1D5BEA]', arrived: 'bg-[#f59e0b]', in_service: 'bg-[#db2777]', completed: 'bg-[#00A884]', cancelled: 'bg-[#c0c8d8]', no_show: 'bg-[#c0c8d8]',
}
const PAID_BY: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card' }
const stepButton = 'flex-1 min-w-0 inline-flex items-center justify-center gap-2 h-11 px-3 rounded-xl text-[15px] font-bold whitespace-nowrap transition-colors cursor-pointer disabled:opacity-50'
const menuItem = 'w-full flex items-center gap-2.5 text-left px-3 py-2.5 rounded-xl text-[15px] font-medium text-[#0E1B3D] dark:text-white hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer'

/** The front counter: WhatsApp requests, the day at a glance, and the board of appointments. */
export function SalonCounter({ orgId, setup, canWrite, flash }: {
  orgId: string
  setup: SalonSetup
  canWrite: boolean
  flash: Flash
}) {
  const confirm = useConfirm()
  const today = istDate()
  const [date, setDate] = useState(today)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [requests, setRequests] = useState<Appointment[]>([])
  const [invoices, setInvoices] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [laneTab, setLaneTab] = useState<'upcoming' | 'service' | 'done' | null>(null)
  const [now, setNow] = useState(() => Date.now())

  // "In 20 min" and "15 min late" stay current
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const load = useCallback(async () => {
    const data = await api(`/api/salon/appointments?organizationId=${orgId}&date=${date}`)
    setAppointments(data.appointments || [])
    setRequests(data.requests || [])
    setInvoices(Object.fromEntries((data.invoices || []).map((invoice: any) => [invoice.id, invoice])))
  }, [orgId, date])

  // New WhatsApp requests and changes from other counters show up without a refresh
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') load().catch(() => {}) }, 60_000)
    return () => window.clearInterval(timer)
  }, [load])

  // While the counter is open, feedback questions and reminders go out when they are due
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') api('/api/salon/tick', { method: 'POST', body: JSON.stringify({ organizationId: orgId }) }).catch(() => {}) }
    tick()
    const timer = window.setInterval(tick, 120_000)
    return () => window.clearInterval(timer)
  }, [orgId])

  useEffect(() => {
    setLoading(true)
    load().catch((err) => flash('error', err.message)).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  useEffect(() => {
    if (!menuFor) return
    const close = () => setMenuFor(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menuFor])

  const staffName = useMemo(() => Object.fromEntries(setup.staff.map((member) => [member.id, member.name])), [setup.staff])

  async function setStatus(appointment: Appointment, status: 'arrived' | 'in_service' | 'cancelled' | 'no_show' | 'booked') {
    if (status === 'cancelled' && !(await confirm({ title: `Cancel ${appointment.customer_name}'s appointment?`, message: `${formatIstTime(appointment.starts_at)} · ${appointment.services.map((s) => s.name).join(', ')}`, confirmLabel: 'Cancel appointment', destructive: true }))) return
    setBusyId(appointment.id)
    try {
      const result = await api('/api/salon/act', { method: 'POST', body: JSON.stringify({ organizationId: orgId, action: { type: 'set_status', appointment_id: appointment.id, status } }) })
      setAppointments((current) => current.map((a) => (a.id === appointment.id ? result.appointment : a)))
      flash('success', result.message)
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusyId(null)
    }
  }

  function afterBooking(result: any) {
    setSheet(null)
    flash(result.warning ? 'error' : 'success', result.warning ? `Booked, but note: ${result.warning}` : result.whatsapp && !result.whatsapp.sent ? `${result.message}. WhatsApp confirmation not sent: ${result.whatsapp.windowClosed ? 'the 24-hour window is closed' : result.whatsapp.error}` : `${result.message}${result.whatsapp?.sent ? ' · confirmation sent on WhatsApp' : ''}`)
    setDate(istDate(result.appointment.starts_at))
    load().catch(() => {})
  }

  function afterBilling(result: any, walkIn: boolean) {
    setSheet({ kind: 'result', result, walkIn })
    if (result.invoice && date !== istDate(result.appointment?.starts_at || Date.now())) setDate(istDate())
    load().catch(() => {})
  }

  const quickBill = () => setSheet({ kind: 'bill', target: { kind: 'walkin' } })
  const newBooking = () => setSheet({ kind: 'book', draft: { date: date < today ? today : date } })

  const total = (appointment: Appointment) => appointment.services.reduce((sum, s) => sum + Number(s.price || 0), 0)

  // The day at a glance
  const live = appointments.filter((a) => !['cancelled', 'no_show'].includes(a.status))
  const waiting = live.filter((a) => a.status === 'booked' || a.status === 'arrived')
  const inChair = live.filter((a) => a.status === 'in_service')
  const dayInvoices = Object.values(invoices).filter((invoice: any) => invoice.status !== 'void')
  const billed = dayInvoices.filter((invoice: any) => invoice.status === 'paid').reduce((sum: number, invoice: any) => sum + Number(invoice.total || 0), 0)
  const unpaid = dayInvoices.filter((invoice: any) => invoice.status === 'unpaid').length
  const next = live.filter((a) => a.status === 'booked').sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0]
  const isToday = date === today
  const laneCount = (id: string) => appointments.filter((a) => LANES.find((lane) => lane.id === id)!.statuses.includes(a.status)).length
  const activeLane = laneTab ?? (laneCount('service') ? 'service' : 'upcoming')
  const dayDate = (fromIst(date, '12:00') || new Date()).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })

  return (
    <div className="space-y-4 @xl:space-y-5">
      <div className="flex flex-col @2xl:flex-row @2xl:items-center gap-3">
        <div className="flex items-center rounded-2xl bg-white dark:bg-[#111b21] border border-[#e3e8f2] dark:border-slate-800 p-1 shadow-[0_1px_2px_rgba(14,27,61,0.04)] w-full @2xl:w-auto">
          <button type="button" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day" className="h-11 w-11 shrink-0 rounded-xl flex items-center justify-center text-[#4a5672] dark:text-slate-300 hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer"><ChevronLeft size={20} /></button>
          <button type="button" onClick={() => setDate(today)} title="Back to today" className="h-11 px-3 flex-1 @2xl:flex-none @2xl:min-w-[170px] rounded-xl text-center hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer min-w-0">
            <span className="block text-[15.5px] font-extrabold text-[#0E1B3D] dark:text-white leading-tight truncate">{formatIstDay(date, today)}</span>
            <span className="block text-[12px] font-semibold text-[#8a94a8] leading-tight truncate">{isToday ? dayDate : `${dayDate} · tap for today`}</span>
          </button>
          <button type="button" onClick={() => setDate(addDays(date, 1))} aria-label="Next day" className="h-11 w-11 shrink-0 rounded-xl flex items-center justify-center text-[#4a5672] dark:text-slate-300 hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer"><ChevronRight size={20} /></button>
        </div>
        {canWrite && (
          <div className="grid grid-cols-2 gap-2 @2xl:flex @2xl:ml-auto">
            <button type="button" onClick={quickBill} className="inline-flex items-center justify-center gap-2 h-12 px-4 rounded-xl bg-[#00A884] hover:bg-[#008f70] text-white text-[15px] font-bold shadow-sm shadow-[#00A884]/25 transition-colors cursor-pointer whitespace-nowrap"><Zap size={18} /> Quick bill</button>
            <button type="button" onClick={newBooking} className={`${primaryButton} h-12 whitespace-nowrap`}><CalendarPlus size={18} /> New booking</button>
          </div>
        )}
      </div>

      <BookingRequests orgId={orgId} requests={requests} canWrite={canWrite} flash={flash} onDone={() => load().catch(() => {})} />

      <div className="grid grid-cols-2 @4xl:grid-cols-4 gap-2.5 @xl:gap-3">
        <StatTile label={isToday ? 'Appointments today' : 'Appointments'} value={live.length} icon={<CalendarDays size={20} />} tone="blue" hint={`${live.filter((a) => a.status === 'completed').length} done`} />
        <StatTile label="Waiting" value={waiting.length} icon={<Hourglass size={20} />} tone="amber" hint={next ? `Next ${formatIstTime(next.starts_at)}` : 'No one booked'} />
        <StatTile label="In the chair" value={inChair.length} icon={<Armchair size={20} />} tone="pink" hint={inChair.length ? inChair.map((a) => a.customer_name.split(' ')[0]).join(', ') : 'Free'} />
        <StatTile label={isToday ? 'Billed today' : 'Billed'} value={formatRupees(billed)} icon={<Wallet size={20} />} tone="green" hint={unpaid ? `${unpaid} not paid yet` : 'All paid'} />
      </div>

      {/* Phones: one lane at a time */}
      <div role="tablist" aria-label="Lanes" className="@4xl:hidden grid grid-cols-3 gap-1 rounded-2xl bg-[#e8ecf3] dark:bg-slate-900 p-1">
        {LANES.map((lane) => (
          <button key={lane.id} type="button" role="tab" aria-selected={activeLane === lane.id} onClick={() => setLaneTab(lane.id)}
            className={`h-10 min-w-0 px-1 rounded-xl text-[13px] min-[400px]:text-[14px] font-bold inline-flex items-center justify-center gap-1 min-[400px]:gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${activeLane === lane.id ? 'bg-white dark:bg-[#111b21] text-[#0E1B3D] dark:text-white shadow-sm' : 'text-[#6B7894] dark:text-slate-400'}`}>
            <span aria-hidden className={`hidden min-[360px]:inline-block h-2 w-2 shrink-0 rounded-full ${LANE_DOT[lane.id]}`} /> {lane.title} <span className="text-[12.5px] font-semibold text-[#8a94a8]">{laneCount(lane.id)}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-[#1D5BEA]" size={28} /></div>
      ) : (
        <div className="grid grid-cols-1 @4xl:grid-cols-3 gap-4 items-start">
          {LANES.map((lane) => {
            const list = appointments.filter((a) => lane.statuses.includes(a.status))
            const open = list.filter((a) => !['cancelled', 'no_show'].includes(a.status))
            const dropped = list.filter((a) => ['cancelled', 'no_show'].includes(a.status))
            const EmptyIcon = lane.id === 'upcoming' ? CalendarClock : lane.id === 'service' ? Armchair : ReceiptText
            return (
              <section key={lane.id} aria-label={lane.title} className={`${activeLane === lane.id ? 'block' : 'hidden'} @4xl:block rounded-3xl bg-[#eef1f6]/80 dark:bg-slate-900/50 p-2.5 @xl:p-3`}>
                <h2 className="hidden @4xl:flex px-2 pt-1 pb-3 items-center gap-2 text-[15px] font-extrabold text-[#0E1B3D] dark:text-slate-200">
                  <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${LANE_DOT[lane.id]}`} /> {lane.title}
                  <span className="ml-auto inline-flex items-center justify-center min-w-7 h-6 px-2 rounded-full bg-white dark:bg-slate-800 text-[12.5px] font-bold text-[#4a5672] dark:text-slate-300">{list.length}</span>
                </h2>
                {list.length === 0 && (
                  <div className="rounded-2xl border-2 border-dashed border-[#d9e0ec] dark:border-slate-800 px-4 py-9 text-center">
                    <EmptyIcon size={26} className="mx-auto text-[#a3adc2]" />
                    <p className="mt-2 text-[14.5px] font-semibold text-[#6B7894]">{lane.id === 'upcoming' ? 'No one waiting' : lane.id === 'service' ? 'No one in the chair' : 'Nothing billed yet'}</p>
                    {lane.id === 'upcoming' && canWrite && date >= today && <button type="button" onClick={newBooking} className="mt-2 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[14px] font-bold text-[#1D5BEA] dark:text-blue-300 hover:bg-white dark:hover:bg-slate-800 cursor-pointer"><CalendarPlus size={16} /> New booking</button>}
                    {lane.id === 'done' && canWrite && isToday && <button type="button" onClick={quickBill} className="mt-2 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[14px] font-bold text-[#047857] dark:text-emerald-300 hover:bg-white dark:hover:bg-slate-800 cursor-pointer"><Zap size={16} /> Quick bill a walk-in</button>}
                  </div>
                )}
                <ul className="space-y-2.5">
                  {open.map((appointment) => {
                    const [pill, pillTone] = STATUS_PILL[appointment.status]
                    const invoice = appointment.invoice_id ? invoices[appointment.invoice_id] : null
                    const busy = busyId === appointment.id
                    // Everyone on this visit: who does each service, else who it was booked with
                    const serviceStaff = appointment.services.map((s) => s.staff_name || (s.staff_id ? staffName[s.staff_id] : null) || null)
                    const people = [...new Set(serviceStaff.filter(Boolean))] as string[]
                    if (!people.length && appointment.staff_id && staffName[appointment.staff_id]) people.push(staffName[appointment.staff_id])
                    const mixed = people.length > 1
                    const minutes = Math.round((Date.parse(appointment.starts_at) - now) / 60_000)
                    const timing = isToday && appointment.status === 'booked'
                      ? minutes > 0 && minutes <= 90 ? ['In ' + (minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`), 'bg-[#eef3fe] text-[#1D5BEA] dark:bg-blue-950/40 dark:text-blue-300']
                        : minutes < -5 ? [`${Math.min(-minutes, 999)} min late`, 'bg-[#fff4e0] text-[#b45309] dark:bg-amber-950/40 dark:text-amber-300']
                        : minutes <= 0 ? ['Now', 'bg-[#eef3fe] text-[#1D5BEA] dark:bg-blue-950/40 dark:text-blue-300'] : null
                      : null
                    return (
                      <li key={appointment.id} className={`relative ${card} p-3.5 pl-[18px] @xl:p-4 @xl:pl-5 overflow-visible`}>
                        <span aria-hidden className={`absolute left-0 top-3 bottom-3 w-1.5 rounded-r-full ${STRIPE[appointment.status]}`} />
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[14px] text-[#6B7894] flex items-baseline gap-1.5"><span className="text-[15.5px] font-extrabold text-[#0E1B3D] dark:text-white">{formatIstTime(appointment.starts_at)}</span> – {formatIstTime(appointment.ends_at)}</p>
                          <span className={`shrink-0 inline-flex items-center h-6 px-2 rounded-md text-[12.5px] font-bold ${timing ? timing[1] : pillTone}`}>{timing ? timing[0] : pill}</span>
                        </div>
                        <p className="text-[17px] @xl:text-[18px] font-bold tracking-tight text-[#0E1B3D] dark:text-white mt-1 truncate">{appointment.customer_name}</p>
                        {appointment.customer_phone && <a href={`tel:${appointment.customer_phone}`} className="text-[13px] font-semibold text-[#1D5BEA] dark:text-blue-300 hover:underline">{appointment.customer_phone}</a>}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {appointment.services.map((service, index) => <span key={index} className="inline-flex items-center h-7 px-2.5 rounded-lg bg-[#f4f6fa] dark:bg-slate-800 text-[13px] font-semibold text-[#4a5672] dark:text-slate-300">{service.name}{mixed && serviceStaff[index] && <span className="font-normal text-[#8a94a8]">&nbsp;· {serviceStaff[index]}</span>}</span>)}
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2 min-w-0 text-[13.5px] font-semibold text-[#4a5672] dark:text-slate-300">
                            {people.length ? <><span className="flex -space-x-1.5 shrink-0">{people.slice(0, 3).map((person) => <Avatar key={person} name={person} size={26} className="ring-2 ring-white dark:ring-[#111b21]" />)}</span><span className="truncate">{people.join(', ')}</span></> : appointment.status !== 'completed' && <span className="text-[#8a94a8] font-normal">Anyone free</span>}
                          </span>
                          <span className="text-right">
                            <span className="block text-[16.5px] font-extrabold text-[#0E1B3D] dark:text-white">{formatRupees(invoice ? Number(invoice.total) : total(appointment))}</span>
                            {invoice && <span className="block text-[12px] font-semibold text-[#8a94a8]">{invoice.number}</span>}
                          </span>
                        </div>

                        {canWrite && appointment.status !== 'completed' && (
                          <div className="mt-3 flex items-center gap-2">
                            {appointment.status === 'booked' && <button type="button" disabled={busy} onClick={() => setStatus(appointment, 'arrived')} className={`${stepButton} bg-[#eef3fe] text-[#1D5BEA] hover:bg-[#dfe8fd] dark:bg-blue-950/50 dark:text-blue-200 dark:hover:bg-blue-900/50`}>{busy ? <Loader2 size={18} className="animate-spin" /> : <UserCheck size={18} />} Arrived</button>}
                            {appointment.status === 'arrived' && <button type="button" disabled={busy} onClick={() => setStatus(appointment, 'in_service')} className={`${stepButton} bg-[#fdeef6] text-[#be185d] hover:bg-[#fbdcec] dark:bg-pink-950/50 dark:text-pink-200 dark:hover:bg-pink-900/50`}>{busy ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />} Start service</button>}
                            {appointment.status === 'in_service' && <button type="button" onClick={() => setSheet({ kind: 'bill', target: { kind: 'appointment', appointment } })} className={`${stepButton} bg-[#00A884] text-white hover:bg-[#008f70] shadow-sm shadow-[#00A884]/30`}><Receipt size={18} /> Complete & bill</button>}
                            {['booked', 'arrived'].includes(appointment.status) && (
                              <div className="relative">
                                <button type="button" aria-label={`More for ${appointment.customer_name}`} onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === appointment.id ? null : appointment.id) }} className="h-11 w-11 rounded-xl border border-[#e3e8f2] dark:border-slate-700 flex items-center justify-center text-[#4a5672] dark:text-slate-300 hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer"><MoreHorizontal size={20} /></button>
                                {menuFor === appointment.id && (
                                  <div className="absolute right-0 bottom-13 z-20 w-56 rounded-2xl border border-[#e3e8f2] dark:border-slate-700 bg-white dark:bg-[#111b21] shadow-xl p-1.5" onClick={(e) => e.stopPropagation()}>
                                    <button type="button" onClick={() => { setMenuFor(null); setSheet({ kind: 'bill', target: { kind: 'appointment', appointment } }) }} className={menuItem}><Receipt size={16} /> Bill now</button>
                                    {appointment.status === 'booked' && <button type="button" onClick={() => { setMenuFor(null); setStatus(appointment, 'no_show') }} className={menuItem}><UserX size={16} /> Did not come</button>}
                                    <button type="button" onClick={() => { setMenuFor(null); setStatus(appointment, 'cancelled') }} className={`${menuItem} text-[#b91c1c] dark:text-red-300 hover:bg-[#fdf0f0] dark:hover:bg-red-950/30`}><XCircle size={16} /> Cancel appointment</button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        {appointment.status === 'completed' && invoice && (
                          <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-[#f8fafc] dark:bg-slate-900/60 px-3 py-2">
                            <span className={`inline-flex items-center gap-1.5 text-[13.5px] font-bold ${invoice.status === 'paid' ? 'text-[#047857] dark:text-emerald-300' : invoice.status === 'void' ? 'text-[#6B7894]' : 'text-[#b45309] dark:text-amber-300'}`}>
                              {invoice.status === 'paid' ? <CircleCheck size={16} /> : <Clock size={16} />}
                              {invoice.status === 'paid' ? `Paid${PAID_BY[invoice.payment_method] ? ` · ${PAID_BY[invoice.payment_method]}` : ''}` : invoice.status === 'void' ? 'Void' : 'Not paid yet'}
                            </span>
                            <a href={`/i/${invoice.public_token}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13.5px] font-bold text-[#1D5BEA] dark:text-blue-300 hover:underline">View bill <ArrowUpRight size={15} /></a>
                          </div>
                        )}
                      </li>
                    )
                  })}
                  {dropped.map((appointment) => (
                    <li key={appointment.id} className="rounded-2xl border border-dashed border-[#d5ddeb] dark:border-slate-700 px-4 py-3 flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[14.5px] font-semibold text-[#6B7894] dark:text-slate-400 truncate">{formatIstTime(appointment.starts_at)} · {appointment.customer_name}</p>
                        <p className="text-[12.5px] text-[#8a94a8] truncate">{appointment.status === 'no_show' ? 'Did not come' : 'Cancelled'} · {appointment.services.map((s) => s.name).join(', ')}</p>
                      </div>
                      {canWrite && <button type="button" disabled={busyId === appointment.id} onClick={() => setStatus(appointment, 'booked')} className="shrink-0 h-9 px-3 rounded-lg text-[13.5px] font-bold text-[#1D5BEA] dark:text-blue-300 hover:bg-[#eef3fe] dark:hover:bg-blue-950/40 cursor-pointer disabled:opacity-50">Book again</button>}
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}

      {sheet?.kind === 'book' && <BookingSheet orgId={orgId} setup={setup} draft={sheet.draft} onClose={() => setSheet(null)} onBooked={afterBooking} />}
      {sheet?.kind === 'bill' && <BillSheet orgId={orgId} setup={setup} target={sheet.target} onClose={() => setSheet(null)} onBilled={(result) => afterBilling(result, sheet.target.kind === 'walkin')} />}
      {sheet?.kind === 'result' && <ResultSheet result={sheet.result} onClose={() => setSheet(null)} onCopied={() => flash('success', 'Link copied')} onNext={sheet.walkIn && canWrite ? quickBill : undefined} />}
    </div>
  )
}
