'use client'

/** Booking requests from the WhatsApp chat, waiting for the counter: approve, move to another time, or decline. */

import { useState } from 'react'
import { CalendarClock, Check, Loader2, MessageCircle, X } from 'lucide-react'
import { useConfirm } from '@/lib/dialog-context'
import { formatRupees } from '@/lib/salon/invoice'
import { addDays, bookingSlots, formatIstDay, formatIstTime, fromIst, istDate } from '@/lib/salon/spoken'
import { api, card, Chip } from './ui'
import type { Appointment } from './types'

type Flash = (tone: 'success' | 'error', text: string) => void

function outcome(result: any): { tone: 'success' | 'error'; text: string } {
  if (result.whatsapp && !result.whatsapp.sent) return { tone: 'error', text: `${result.message}. WhatsApp message not sent: ${result.whatsapp.windowClosed ? 'the 24-hour window is closed' : result.whatsapp.error}` }
  return { tone: 'success', text: `${result.message}${result.whatsapp?.sent ? ' · customer told on WhatsApp' : ''}` }
}

export function BookingRequests({ orgId, requests, canWrite, onDone, flash }: { orgId: string; requests: Appointment[]; canWrite: boolean; onDone: () => void; flash: Flash }) {
  const confirm = useConfirm()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [moveDate, setMoveDate] = useState<string>(istDate())
  if (!requests.length) return null
  const today = istDate()

  async function act(request: Appointment, action: Record<string, unknown>) {
    setBusyId(request.id)
    try {
      const result = await api('/api/salon/act', { method: 'POST', body: JSON.stringify({ organizationId: orgId, action: { ...action, appointment_id: request.id } }) })
      const { tone, text } = outcome(result)
      flash(tone, text)
      setMovingId(null)
      onDone()
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section aria-label="WhatsApp booking requests" className={`${card} overflow-hidden border-[#f5d48a] dark:border-amber-900/60`}>
      <div className="px-4 @xl:px-5 py-3.5 bg-[#fff8e8] dark:bg-amber-950/20 border-b border-[#f5e2b5] dark:border-amber-900/40 flex items-center gap-2.5">
        <span className="h-9 w-9 rounded-xl bg-[#00A884] text-white flex items-center justify-center"><MessageCircle size={18} /></span>
        <div className="min-w-0">
          <h2 className="text-[16px] font-extrabold text-[#0E1B3D] dark:text-white">Booking requests from WhatsApp <span className="ml-1 inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full bg-[#f59e0b] text-white text-[12.5px] font-bold align-middle">{requests.length}</span></h2>
          <p className="text-[13px] text-[#6B7894] dark:text-slate-400">Approve to confirm on WhatsApp, or pick another time.</p>
        </div>
      </div>
      <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800">
        {requests.map((request) => {
          const busy = busyId === request.id
          const total = request.services.reduce((sum, s) => sum + Number(s.price || 0), 0)
          const day = istDate(request.starts_at)
          const moving = movingId === request.id
          return (
            <li key={request.id} className="px-4 @xl:px-5 py-4">
              <div className="flex flex-col @4xl:flex-row @4xl:items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[16.5px] font-bold text-[#0E1B3D] dark:text-white">{request.customer_name}{request.customer_phone && <span className="ml-2 text-[13.5px] font-normal text-[#6B7894]">{request.customer_phone}</span>}</p>
                  <p className="mt-0.5 text-[14.5px] text-[#0E1B3D] dark:text-slate-200 flex items-center gap-1.5"><CalendarClock size={16} className="text-[#b45309]" /> <strong>{formatIstDay(day, today)}, {formatIstTime(request.starts_at)}</strong> · {request.services.map((s) => s.name).join(', ')} · {formatRupees(total)}</p>
                </div>
                {canWrite && (
                  <div className="flex gap-2 shrink-0">
                    <button type="button" disabled={busy} onClick={() => act(request, { type: 'approve_request' })} className="flex-1 @4xl:flex-none inline-flex items-center justify-center gap-1.5 h-11 px-4 rounded-xl bg-[#00A884] hover:bg-[#008f70] text-white text-[15px] font-bold cursor-pointer disabled:opacity-50">{busy ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} strokeWidth={3} />} Approve</button>
                    <button type="button" disabled={busy} onClick={() => { setMovingId(moving ? null : request.id); setMoveDate(day < today ? today : day) }} aria-expanded={moving} className="flex-1 @4xl:flex-none inline-flex items-center justify-center gap-1.5 h-11 px-4 rounded-xl border border-[#d5ddeb] dark:border-slate-700 text-[15px] font-semibold text-[#0E1B3D] dark:text-white hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50">Other time</button>
                    <button type="button" disabled={busy} aria-label={`Decline ${request.customer_name}'s request`} onClick={async () => {
                      if (await confirm({ title: `Decline ${request.customer_name}'s request?`, message: 'They will get a WhatsApp message asking them to pick another day or time.', confirmLabel: 'Decline', destructive: true })) act(request, { type: 'decline_request' })
                    }} className="inline-flex items-center justify-center h-11 w-11 rounded-xl border border-[#f3c7c7] dark:border-red-900 text-[#b91c1c] dark:text-red-300 hover:bg-[#fdf0f0] dark:hover:bg-red-950/30 cursor-pointer disabled:opacity-50"><X size={18} /></button>
                  </div>
                )}
              </div>
              {moving && (
                <div className="mt-3 rounded-2xl bg-[#f8fafc] dark:bg-slate-900/60 p-3 space-y-2.5">
                  <div className="flex flex-wrap gap-2">
                    {[0, 1, 2, 3].map((offset) => { const d = addDays(today, offset); return <Chip key={d} selected={moveDate === d} onClick={() => setMoveDate(d)}>{formatIstDay(d, today)}</Chip> })}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {bookingSlots(moveDate).map((slot) => (
                      <Chip key={slot} disabled={busy} onClick={() => act(request, { type: 'approve_request', starts_at: fromIst(moveDate, slot)!.toISOString() })}>{formatIstTime(fromIst(moveDate, slot)!)}</Chip>
                    ))}
                    {!bookingSlots(moveDate).length && <p className="text-[14px] text-[#6B7894]">No times left that day. Pick another day.</p>}
                  </div>
                  <p className="text-[12.5px] text-[#8a94a8]">Tapping a time books it and sends them the new time on WhatsApp.</p>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
