'use client'

/**
 * Front Desk → Setup → Appointments: "We take appointments", on or off for the whole business (owners and admins).
 * Shops that only bill walk-ins switch it off; the card says plainly what that hides and what stays.
 */

import { useState } from 'react'
import { CalendarClock, Check, EyeOff, Loader2 } from 'lucide-react'
import { useConfirm } from '@/lib/dialog-context'
import { HIDDEN_WHEN_OFF, KEPT_WHEN_OFF, takesAppointments } from '@/lib/salon/appointments-switch'
import { api, card, Toggle } from './ui'
import type { SalonSetup } from './types'

type Flash = (tone: 'success' | 'error', text: string) => void

export function AppointmentsSwitch({ orgId, setup, onChange, flash, canChange }: { orgId: string; setup: SalonSetup; onChange: (setup: SalonSetup) => void; flash: Flash; canChange: boolean }) {
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const on = takesAppointments(setup.settings)

  async function save(value: boolean) {
    if (!value && !(await confirm({
      title: 'Stop taking appointments?',
      message: `${HIDDEN_WHEN_OFF.join('. ')} will be hidden. ${KEPT_WHEN_OFF}`,
      confirmLabel: 'Switch off appointments',
    }))) return
    setBusy(true)
    try {
      const data = await api('/api/salon/settings', { method: 'PATCH', body: JSON.stringify({ organizationId: orgId, takes_appointments: value }) })
      onChange({ ...setup, settings: { ...setup.settings, ...data.settings, takes_appointments: value } })
      flash('success', value ? 'Appointments are on. Customers can book again.' : 'Appointments are off. Front Desk now shows your walk-in bills.')
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={card} aria-labelledby="appointments-title">
      <div className="px-4 @xl:px-5 py-4 border-b border-[#eef1f6] dark:border-slate-800 flex items-center gap-3">
        <span className="h-11 w-11 shrink-0 rounded-2xl bg-[#f4f6fa] text-[#0E1B3D] dark:bg-slate-800 dark:text-slate-100 flex items-center justify-center"><CalendarClock size={21} /></span>
        <div className="min-w-0">
          <h2 id="appointments-title" className="text-[18px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white">Appointments</h2>
          <p className="text-[13.5px] text-[#6B7894] dark:text-slate-400">Do customers book a time with you, or just walk in?</p>
        </div>
      </div>
      <div className="p-4 @xl:p-5 space-y-4">
        <div className="rounded-2xl border border-[#e3e8f2] dark:border-slate-800 flex items-center justify-between gap-4 px-4 py-3.5">
          <span className="min-w-0">
            <span className="block text-[15px] font-bold text-[#0E1B3D] dark:text-white">We take appointments</span>
            <span className="block text-[13.5px] text-[#6B7894] dark:text-slate-400">{on ? 'On: customers book times at the counter, on your website and on WhatsApp.' : 'Off: Front Desk is for walk-in bills only. Nothing can be booked.'}</span>
          </span>
          {busy ? <Loader2 size={22} className="animate-spin text-[#008069] shrink-0" /> : <Toggle checked={on} disabled={!canChange} onChange={save} label="We take appointments" />}
        </div>
        {!canChange && <p className="text-[13px] text-[#6B7894] dark:text-slate-400">Only the owner or an admin can change this.</p>}

        <div className="grid @2xl:grid-cols-2 gap-3 items-start">
          <div className="rounded-2xl bg-[#f8fafc] dark:bg-slate-900/50 p-4">
            <p className="flex items-center gap-2 text-[14px] font-bold text-[#0E1B3D] dark:text-white"><EyeOff size={16} /> {on ? 'Switching it off hides' : 'Hidden while it is off'}</p>
            <ul className="mt-2 space-y-1.5 text-[13.5px] text-[#4a5672] dark:text-slate-300">
              {HIDDEN_WHEN_OFF.map((line) => <li key={line} className="flex gap-2"><span aria-hidden className="mt-2 h-1.5 w-1.5 rounded-full bg-[#8a94a8] shrink-0" />{line}</li>)}
            </ul>
          </div>
          <div className="rounded-2xl bg-[#f8fafc] dark:bg-slate-900/50 p-4">
            <p className="flex items-center gap-2 text-[14px] font-bold text-[#0E1B3D] dark:text-white"><Check size={16} /> Always kept</p>
            <p className="mt-2 text-[13.5px] text-[#4a5672] dark:text-slate-300">{KEPT_WHEN_OFF}</p>
          </div>
        </div>
      </div>
    </section>
  )
}
