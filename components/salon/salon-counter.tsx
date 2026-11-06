'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarPlus, ChevronLeft, ChevronRight, Clock, Loader2, MoreHorizontal, Receipt, UserCheck, Wand2, Play } from 'lucide-react'
import { formatRupees } from '@/lib/salon/invoice'
import { addDays, formatIstDay, formatIstTime, istDate } from '@/lib/salon/spoken'
import { useConfirm } from '@/lib/dialog-context'
import { api, card, primaryButton, secondaryButton } from './ui'
import { BillSheet, BookingSheet, ResultSheet, type BillDraft, type BillTarget, type BookingDraft } from './counter-sheets'
import type { Appointment, SalonSetup } from './types'

type Flash = (tone: 'success' | 'error', text: string) => void
type Sheet =
  | { kind: 'book'; mode: 'booking' | 'walkin'; draft?: BookingDraft }
  | { kind: 'bill'; target: BillTarget; draft?: BillDraft }
  | { kind: 'result'; result: any }
  | null

const LANES: { id: 'upcoming' | 'service' | 'done'; title: string; statuses: Appointment['status'][] }[] = [
  { id: 'upcoming', title: 'Upcoming', statuses: ['booked'] },
  { id: 'service', title: 'In service', statuses: ['arrived', 'in_service'] },
  { id: 'done', title: 'Done', statuses: ['completed', 'cancelled', 'no_show'] },
]

const STATUS_PILL: Record<Appointment['status'], [string, string]> = {
  booked: ['Booked', 'bg-[#eef3fe] text-[#1D5BEA] dark:bg-blue-950/40 dark:text-blue-300'],
  arrived: ['Arrived', 'bg-[#fff4e0] text-[#b45309] dark:bg-amber-950/40 dark:text-amber-300'],
  in_service: ['In service', 'bg-[#fdeef6] text-[#be185d] dark:bg-pink-950/40 dark:text-pink-300'],
  completed: ['Done', 'bg-[#e8f7f1] text-[#047857] dark:bg-emerald-950/40 dark:text-emerald-300'],
  cancelled: ['Cancelled', 'bg-[#eef1f6] text-[#6B7894] dark:bg-slate-800 dark:text-slate-400'],
  no_show: ['No-show', 'bg-[#eef1f6] text-[#6B7894] dark:bg-slate-800 dark:text-slate-400'],
}

export interface CounterHandle {
  openBooking: (draft?: BookingDraft) => void
  openWalkIn: (draft?: BookingDraft) => void
  openBill: (appointment: Appointment, draft?: BillDraft) => void
  reload: () => Promise<void>
  appointments: Appointment[]
}

export function SalonCounter({ orgId, setup, canWrite, flash, voice }: {
  orgId: string
  setup: SalonSetup
  canWrite: boolean
  flash: Flash
  /** The voice bar, given the counter's controls (phase 4) */
  voice?: (handle: CounterHandle) => React.ReactNode
}) {
  const confirm = useConfirm()
  const today = istDate()
  const [date, setDate] = useState(today)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [invoices, setInvoices] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)

  const load = useCallback(async () => {
    const data = await api(`/api/salon/appointments?organizationId=${orgId}&date=${date}`)
    setAppointments(data.appointments || [])
    setInvoices(Object.fromEntries((data.invoices || []).map((invoice: any) => [invoice.id, invoice])))
  }, [orgId, date])

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

  function afterBilling(result: any) {
    setSheet({ kind: 'result', result })
    if (result.invoice && date !== istDate(result.appointment?.starts_at || Date.now())) setDate(istDate())
    load().catch(() => {})
  }

  const handle: CounterHandle = {
    openBooking: (draft) => setSheet({ kind: 'book', mode: 'booking', draft }),
    openWalkIn: (draft) => setSheet({ kind: 'book', mode: 'walkin', draft }),
    openBill: (appointment, draft) => setSheet({ kind: 'bill', target: { kind: 'appointment', appointment }, draft }),
    reload: load,
    appointments,
  }

  const total = (appointment: Appointment) => appointment.services.reduce((sum, s) => sum + Number(s.price || 0), 0)

  return (
    <div className="space-y-5">
      {canWrite && voice?.(handle)}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 self-start">
          <button type="button" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day" className="h-11 w-11 rounded-xl border border-[#d5ddeb] dark:border-slate-700 flex items-center justify-center text-[#0E1B3D] dark:text-white hover:bg-white dark:hover:bg-slate-800 cursor-pointer"><ChevronLeft size={20} /></button>
          <button type="button" onClick={() => setDate(today)} className="h-11 px-4 rounded-xl text-[17px] font-bold text-[#0E1B3D] dark:text-white hover:bg-white dark:hover:bg-slate-800 cursor-pointer min-w-[130px]">{formatIstDay(date, today)}</button>
          <button type="button" onClick={() => setDate(addDays(date, 1))} aria-label="Next day" className="h-11 w-11 rounded-xl border border-[#d5ddeb] dark:border-slate-700 flex items-center justify-center text-[#0E1B3D] dark:text-white hover:bg-white dark:hover:bg-slate-800 cursor-pointer"><ChevronRight size={20} /></button>
          <span className="ml-2 text-[14px] text-[#6B7894]">{appointments.filter((a) => !['cancelled', 'no_show'].includes(a.status)).length} appointments</span>
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <button type="button" onClick={() => setSheet({ kind: 'book', mode: 'walkin' })} className={`${secondaryButton} flex-1 sm:flex-none`}><Wand2 size={18} /> Walk-in bill</button>
            <button type="button" onClick={() => setSheet({ kind: 'book', mode: 'booking', draft: { date } })} className={`${primaryButton} flex-1 sm:flex-none`}><CalendarPlus size={18} /> New booking</button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-[#1D5BEA]" size={28} /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          {LANES.map((lane) => {
            const list = appointments.filter((a) => lane.statuses.includes(a.status))
            return (
              <section key={lane.id} className="rounded-2xl bg-[#eef1f6]/70 dark:bg-slate-900/50 p-3">
                <h2 className="px-1.5 pb-2.5 text-[15px] font-bold text-[#4a5672] dark:text-slate-300 flex items-center justify-between">{lane.title}<span className="text-[13px] font-semibold text-[#8a94a8]">{list.length}</span></h2>
                {list.length === 0 && <p className="px-2 py-6 text-center text-[14px] text-[#8a94a8]">{lane.id === 'upcoming' ? 'No one waiting' : lane.id === 'service' ? 'No one in the chair' : 'Nothing billed yet'}</p>}
                <ul className="space-y-2.5">
                  {list.map((appointment) => {
                    const [pill, pillTone] = STATUS_PILL[appointment.status]
                    const invoice = appointment.invoice_id ? invoices[appointment.invoice_id] : null
                    const busy = busyId === appointment.id
                    return (
                      <li key={appointment.id} className={`${card} p-4 ${['cancelled', 'no_show'].includes(appointment.status) ? 'opacity-60' : ''}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[13.5px] font-semibold text-[#6B7894] flex items-center gap-1.5"><Clock size={14} /> {formatIstTime(appointment.starts_at)} – {formatIstTime(appointment.ends_at)}</p>
                            <p className="text-[18px] font-bold text-[#0E1B3D] dark:text-white mt-0.5 truncate">{appointment.customer_name}</p>
                          </div>
                          <span className={`shrink-0 inline-flex items-center h-6 px-2 rounded-md text-[12.5px] font-bold ${pillTone}`}>{pill}</span>
                        </div>
                        <p className="text-[14.5px] text-[#4a5672] dark:text-slate-300 mt-1">{appointment.services.map((s) => s.name).join(', ')}</p>
                        <p className="text-[13.5px] text-[#6B7894] mt-0.5">{appointment.staff_id && staffName[appointment.staff_id] ? `With ${staffName[appointment.staff_id]} · ` : ''}{formatRupees(invoice ? Number(invoice.total) : total(appointment))}{invoice ? ` · ${invoice.number}` : ''}</p>

                        {canWrite && (
                          <div className="mt-3 flex items-center gap-2">
                            {appointment.status === 'booked' && <button type="button" disabled={busy} onClick={() => setStatus(appointment, 'arrived')} className={`${primaryButton} flex-1 h-12`}>{busy ? <Loader2 size={18} className="animate-spin" /> : <UserCheck size={18} />} Arrived</button>}
                            {appointment.status === 'arrived' && <button type="button" disabled={busy} onClick={() => setStatus(appointment, 'in_service')} className={`${primaryButton} flex-1 h-12`}>{busy ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />} Start</button>}
                            {appointment.status === 'in_service' && <button type="button" onClick={() => setSheet({ kind: 'bill', target: { kind: 'appointment', appointment } })} className={`${primaryButton} flex-1 h-12`}><Receipt size={18} /> Complete & bill</button>}
                            {appointment.status === 'completed' && invoice && (
                              <a href={`/i/${invoice.public_token}`} target="_blank" rel="noopener noreferrer" className={`${secondaryButton} flex-1 h-11`}><Receipt size={17} /> {invoice.status === 'paid' ? 'Paid · view bill' : invoice.status === 'void' ? 'Void · view' : 'Unpaid · view bill'}</a>
                            )}
                            {['booked', 'arrived'].includes(appointment.status) && (
                              <div className="relative">
                                <button type="button" aria-label={`More for ${appointment.customer_name}`} onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === appointment.id ? null : appointment.id) }} className="h-12 w-12 rounded-xl border border-[#d5ddeb] dark:border-slate-700 flex items-center justify-center text-[#4a5672] hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer"><MoreHorizontal size={20} /></button>
                                {menuFor === appointment.id && (
                                  <div className="absolute right-0 bottom-14 z-20 w-56 rounded-xl border border-[#e3e8f2] dark:border-slate-700 bg-white dark:bg-[#111b21] shadow-lg py-1" onClick={(e) => e.stopPropagation()}>
                                    <button type="button" onClick={() => { setMenuFor(null); setSheet({ kind: 'bill', target: { kind: 'appointment', appointment } }) }} className="w-full text-left px-4 py-3 text-[15px] text-[#0E1B3D] dark:text-white hover:bg-[#f6f8fc] dark:hover:bg-slate-800 cursor-pointer">Bill now</button>
                                    {appointment.status === 'booked' && <button type="button" onClick={() => { setMenuFor(null); setStatus(appointment, 'no_show') }} className="w-full text-left px-4 py-3 text-[15px] text-[#0E1B3D] dark:text-white hover:bg-[#f6f8fc] dark:hover:bg-slate-800 cursor-pointer">Did not come</button>}
                                    <button type="button" onClick={() => { setMenuFor(null); setStatus(appointment, 'cancelled') }} className="w-full text-left px-4 py-3 text-[15px] text-[#b91c1c] hover:bg-[#fdf0f0] dark:hover:bg-red-950/30 cursor-pointer">Cancel appointment</button>
                                  </div>
                                )}
                              </div>
                            )}
                            {['cancelled', 'no_show'].includes(appointment.status) && <button type="button" disabled={busy} onClick={() => setStatus(appointment, 'booked')} className={`${secondaryButton} flex-1 h-11`}>Book again</button>}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      )}

      {sheet?.kind === 'book' && (
        <BookingSheet orgId={orgId} setup={setup} mode={sheet.mode} draft={sheet.draft} onClose={() => setSheet(null)}
          onBooked={(result) => { setSheet(null); flash(result.warning ? 'error' : 'success', result.warning ? `Booked, but note: ${result.warning}` : result.whatsapp && !result.whatsapp.sent ? `${result.message}. WhatsApp confirmation not sent: ${result.whatsapp.windowClosed ? 'the 24-hour window is closed' : result.whatsapp.error}` : `${result.message}${result.whatsapp?.sent ? ' · confirmation sent on WhatsApp' : ''}`); setDate(istDate(result.appointment.starts_at)); load().catch(() => {}) }}
          onWalkInReady={(target) => setSheet({ kind: 'bill', target })} />
      )}
      {sheet?.kind === 'bill' && <BillSheet orgId={orgId} setup={setup} target={sheet.target} draft={sheet.draft} onClose={() => setSheet(null)} onBilled={afterBilling} />}
      {sheet?.kind === 'result' && <ResultSheet result={sheet.result} onClose={() => setSheet(null)} onCopied={() => flash('success', 'Link copied')} />}
    </div>
  )
}
