'use client'

/** Setup → WhatsApp: the chat assistant, chat bookings, opening hours, reminders and feedback. */

import { useState } from 'react'
import { Clock3, Loader2, MessageCircle, Star } from 'lucide-react'
import { api, card, Chip, Field, input, primaryButton, Toggle } from './ui'
import type { SalonSetup } from './types'

type Flash = (tone: 'success' | 'error', text: string) => void

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const TIMES = Array.from({ length: 36 }, (_, i) => {
  const minutes = 6 * 60 + i * 30
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
})
const DELAYS: { minutes: number; label: string }[] = [{ minutes: 30, label: '30 min' }, { minutes: 60, label: '1 hour' }, { minutes: 120, label: '2 hours' }, { minutes: 240, label: '4 hours' }, { minutes: 1440, label: 'Next day' }]
const timeLabel = (time: string) => { const [h, m] = time.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}` }

function Row({ title, help, children }: { title: string; help: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <span className="min-w-0"><span className="block text-[15px] font-bold text-[#0E1B3D] dark:text-white">{title}</span><span className="block text-[13.5px] text-[#6B7894] dark:text-slate-400">{help}</span></span>
      {children}
    </div>
  )
}

export function WhatsAppSettings({ orgId, setup, onChange, flash, children }: { orgId: string; setup: SalonSetup; onChange: (setup: SalonSetup) => void; flash: Flash; children?: React.ReactNode }) {
  const s = setup.settings
  const [form, setForm] = useState({
    chat_assistant: s.chat_assistant !== false,
    auto_approve_bookings: s.auto_approve_bookings === true,
    opens_at: s.opens_at || '10:00',
    closes_at: s.closes_at || '21:00',
    closed_weekdays: s.closed_weekdays || [],
    reminders_enabled: s.reminders_enabled !== false,
    feedback_enabled: s.feedback_enabled !== false,
    feedback_delay_minutes: s.feedback_delay_minutes || 120,
    review_link: s.review_link || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }))

  async function save() {
    setSaving(true)
    try {
      const data = await api('/api/salon/settings', { method: 'PATCH', body: JSON.stringify({ organizationId: orgId, ...form }) })
      onChange({ ...setup, settings: { ...setup.settings, ...data.settings } })
      flash('success', 'WhatsApp settings saved.')
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={card}>
      <div className="px-4 @xl:px-5 py-4 border-b border-[#eef1f6] dark:border-slate-800 flex items-center gap-3">
        <span className="h-11 w-11 shrink-0 rounded-2xl bg-[#e8f7f1] text-[#047857] dark:bg-emerald-950/40 dark:text-emerald-300 flex items-center justify-center"><MessageCircle size={21} /></span>
        <div className="min-w-0">
          <h2 className="text-[18px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white">WhatsApp</h2>
          <p className="text-[13.5px] text-[#6B7894] dark:text-slate-400">Answers, bookings, reminders and feedback on your WhatsApp number</p>
        </div>
      </div>
      <div className="p-4 @xl:p-5 space-y-5">
        <div className="rounded-2xl border border-[#e3e8f2] dark:border-slate-800 divide-y divide-[#eef1f6] dark:divide-slate-800">
          <Row title="Answer questions and take bookings" help="Customers ask about services, prices and timings, and book a time, in English, Telugu or Hindi. Uses AI credit.">
            <Toggle checked={form.chat_assistant} onChange={(value) => set({ chat_assistant: value })} label="Answer questions and take bookings" />
          </Row>
          <Row title="Confirm free slots automatically" help={form.auto_approve_bookings ? 'On: a free time is booked straight away and the customer gets the confirmation.' : 'Off: chat bookings wait on the Counter until you tap Approve.'}>
            <Toggle checked={form.auto_approve_bookings} onChange={(value) => set({ auto_approve_bookings: value })} label="Confirm free slots automatically" />
          </Row>
          <Row title="Appointment reminders" help="A WhatsApp reminder about 2 hours before each booking.">
            <Toggle checked={form.reminders_enabled} onChange={(value) => set({ reminders_enabled: value })} label="Appointment reminders" />
          </Row>
          <Row title="Ask for feedback after the visit" help="A short rating message after the bill. Ratings show in Team, next to each person.">
            <Toggle checked={form.feedback_enabled} onChange={(value) => set({ feedback_enabled: value })} label="Ask for feedback" />
          </Row>
        </div>

        <div className="grid @xl:grid-cols-2 gap-4">
          <Field label="Opens at">
            <select className={input} value={form.opens_at} onChange={(e) => set({ opens_at: e.target.value })}>{TIMES.map((t) => <option key={t} value={t}>{timeLabel(t)}</option>)}</select>
          </Field>
          <Field label="Closes at">
            <select className={input} value={form.closes_at} onChange={(e) => set({ closes_at: e.target.value })}>{TIMES.map((t) => <option key={t} value={t}>{timeLabel(t)}</option>)}</select>
          </Field>
        </div>
        <Field group label="Closed on" hint="Chat bookings are not offered on these days.">
          <div className="flex flex-wrap gap-2">
            {DAYS.map((day, index) => {
              const closed = form.closed_weekdays.includes(index)
              return <Chip key={day} selected={closed} onClick={() => set({ closed_weekdays: closed ? form.closed_weekdays.filter((d) => d !== index) : [...form.closed_weekdays, index] })}>{day}</Chip>
            })}
          </div>
        </Field>

        {form.feedback_enabled && (
          <div className="rounded-2xl bg-[#f8fafc] dark:bg-slate-900/50 p-4 space-y-4">
            <Field group label="Ask for feedback">
              <div className="flex flex-wrap gap-2">{DELAYS.map((d) => <Chip key={d.minutes} selected={form.feedback_delay_minutes === d.minutes} onClick={() => set({ feedback_delay_minutes: d.minutes })}><Clock3 size={14} /> {d.label} after the bill</Chip>)}</div>
            </Field>
            <Field label="Google review link (optional)" hint="Customers who give 4 or 5 stars are invited to review you here.">
              <input className={input} value={form.review_link} onChange={(e) => set({ review_link: e.target.value })} placeholder="https://g.page/r/…/review" inputMode="url" />
            </Field>
            <p className="flex items-center gap-1.5 text-[12.5px] text-[#6B7894]"><Star size={13} /> 1–2 stars are flagged in Team so you can call the customer.</p>
          </div>
        )}

        <div className="flex justify-end"><button type="button" onClick={save} disabled={saving} className={primaryButton}>{saving && <Loader2 size={18} className="animate-spin" />} Save WhatsApp settings</button></div>
        {children}
      </div>
    </section>
  )
}
