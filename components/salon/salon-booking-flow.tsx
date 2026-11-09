'use client'

/**
 * Setup → Booking flow: how customers book on WhatsApp in a few taps. The business switches it on,
 * picks the words that start it, the first message, whether to ask who, and how far ahead; the
 * phone on the right shows each step as the customer sees it.
 */

import { useMemo, useState } from 'react'
import { CalendarCheck2, Check, Copy, Loader2, Plus, X } from 'lucide-react'
import { DAYS_AHEAD_CHOICES, DEFAULT_TRIGGERS, parseBookingFlow, type BookingFlowSettings, type FlowLanguage } from '@/lib/salon/booking-flow-settings'
import { groupByCategory } from '@/lib/salon/categories'
import { formatRupees } from '@/lib/salon/invoice'
import { api, card, Chip, Field, input, primaryButton, secondaryButton, Toggle } from './ui'
import type { SalonSetup } from './types'

type Flash = (tone: 'success' | 'error', text: string) => void

const LANGUAGES: { id: FlowLanguage; label: string }[] = [{ id: 'en', label: 'English' }, { id: 'te', label: 'Telugu (Tenglish)' }, { id: 'hi', label: 'Hindi (Hinglish)' }]
const WELCOME: Record<FlowLanguage, string> = {
  en: "Hi {name}! Let's book your visit at {business}. Which service would you like?",
  te: 'Namaste {name} garu! {business} lo mee visit book cheddam. Ee service kavali?',
  hi: 'Namaste {name}! {business} mein aapki visit book karte hain. Kaunsi service chahiye?',
}

function Bubble({ mine, children }: { mine?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-snug shadow-[0_1px_1px_rgba(0,0,0,0.08)] ${mine ? 'bg-[#d9fdd3] text-[#111b21] rounded-br-sm' : 'bg-white text-[#111b21] rounded-bl-sm'}`}>{children}</div>
    </div>
  )
}

/** A WhatsApp list message: the text, then the button that opens the choices (shown opened). */
function ListBubble({ text, button, rows }: { text: string; button: string; rows: { title: string; note?: string }[] }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] w-full rounded-xl rounded-bl-sm bg-white shadow-[0_1px_1px_rgba(0,0,0,0.08)] overflow-hidden">
        <p className="px-3 pt-2 pb-2 text-[13px] leading-snug text-[#111b21]">{text}</p>
        <p className="border-t border-[#eef1f6] py-2 text-center text-[13px] font-semibold text-[#027eb5]">☰ {button}</p>
        <ul className="border-t border-[#eef1f6] bg-[#f8fafc]">
          {rows.map((r) => (
            <li key={r.title} className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-[#eef1f6] last:border-0">
              <span className="min-w-0"><span className="block text-[12.5px] font-semibold text-[#111b21] truncate">{r.title}</span>{r.note && <span className="block text-[11px] text-[#6B7894] truncate">{r.note}</span>}</span>
              <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-[#8a94a8]" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function BookingFlowSettingsSection({ orgId, setup, onChange, flash }: { orgId: string; setup: SalonSetup; onChange: (setup: SalonSetup) => void; flash: Flash }) {
  const saved = useMemo(() => parseBookingFlow((setup.settings as any).booking_flow), [setup.settings])
  const [flow, setFlow] = useState<BookingFlowSettings>(saved)
  const [autoApprove, setAutoApprove] = useState(setup.settings.auto_approve_bookings === true)
  const [newWord, setNewWord] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<BookingFlowSettings>) => setFlow((current) => ({ ...current, ...patch }))

  const services = setup.services.filter((s) => s.active)
  const groups = groupByCategory(setup.settings.service_categories, services).filter(([, list]) => list.length > 0)
  const business = setup.settings.business_name || 'your business'
  const welcome = (flow.welcome || WELCOME[flow.language]).replaceAll('{name}', 'Priya').replaceAll('{business}', business)
  const phoneDigits = String(setup.settings.phone || '').replace(/\D/g, '')
  const link = phoneDigits.length >= 10 ? `https://wa.me/${phoneDigits}?text=${encodeURIComponent(flow.triggers[0] ? flow.triggers[0][0].toUpperCase() + flow.triggers[0].slice(1) : 'Book')}` : null
  const first = services[0]

  function addWord() {
    const word = newWord.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 30)
    if (word && !flow.triggers.includes(word)) set({ triggers: [...flow.triggers, word].slice(0, 12) })
    setNewWord('')
  }

  async function save() {
    setSaving(true)
    try {
      const data = await api('/api/salon/settings', { method: 'PATCH', body: JSON.stringify({ organizationId: orgId, booking_flow: flow, auto_approve_bookings: autoApprove }) })
      onChange({ ...setup, settings: { ...setup.settings, ...data.settings } })
      flash('success', flow.enabled ? 'Booking flow saved. Customers can book by sending a trigger word.' : 'Booking flow saved (switched off).')
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={card}>
      <div className="px-4 @xl:px-5 py-4 border-b border-[#eef1f6] dark:border-slate-800 flex items-center gap-3">
        <span className="h-11 w-11 shrink-0 rounded-2xl flex items-center justify-center bg-[#f4f6fa] text-[#0E1B3D] dark:bg-slate-800 dark:text-slate-100"><CalendarCheck2 size={21} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[18px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white">Booking flow</h2>
          <p className="text-[13.5px] text-[#6B7894] dark:text-slate-400">Customers book on WhatsApp in a few taps: service, day, time. No typing, no AI cost.</p>
        </div>
        <Toggle checked={flow.enabled} onChange={(enabled) => set({ enabled })} label="Booking flow on" />
      </div>

      <div className="p-4 @xl:p-5 grid grid-cols-1 @5xl:grid-cols-5 gap-6">
        <div className="@5xl:col-span-3 min-w-0 space-y-5">
          {services.length === 0 && (
            <p className="rounded-xl bg-[#fdf0f0] px-4 py-3 text-[14px] font-semibold text-[#b91c1c]">Add your services first (Setup → Services). The flow lists them for customers.</p>
          )}

          <Field group label="Words that start it" hint="When a customer sends a short message with one of these words, the flow starts. Long messages still go to the WhatsApp assistant.">
            <div className="flex flex-wrap gap-2">
              {flow.triggers.map((word) => (
                <span key={word} className="inline-flex items-center gap-1 h-9 pl-3 pr-1.5 rounded-full border border-[#d5ddeb] dark:border-slate-700 text-[14px] font-semibold text-[#0E1B3D] dark:text-white">
                  {word}
                  <button type="button" onClick={() => set({ triggers: flow.triggers.filter((w) => w !== word) })} disabled={flow.triggers.length <= 1} aria-label={`Remove ${word}`} className="h-6 w-6 rounded-full flex items-center justify-center text-[#6B7894] hover:bg-[#f4f6fa] dark:hover:bg-slate-800 disabled:opacity-30 cursor-pointer"><X size={14} /></button>
                </span>
              ))}
            </div>
            <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); addWord() }}>
              <input className={`${input} flex-1 min-w-0`} value={newWord} onChange={(e) => setNewWord(e.target.value)} placeholder="Add a word, like slot or appointment" aria-label="New trigger word" maxLength={30} />
              <button type="submit" disabled={!newWord.trim()} className={`${secondaryButton} shrink-0`}><Plus size={17} /> Add</button>
            </form>
            {flow.triggers.join() !== DEFAULT_TRIGGERS.join() && (
              <button type="button" onClick={() => set({ triggers: DEFAULT_TRIGGERS })} className="mt-1.5 text-[13px] font-semibold text-[#1D5BEA] hover:underline cursor-pointer">Use the default words</button>
            )}
          </Field>

          <Field group label="Language of the steps">
            <div className="flex flex-wrap gap-2">
              {LANGUAGES.map((l) => <Chip key={l.id} selected={flow.language === l.id} onClick={() => set({ language: l.id })}>{flow.language === l.id && <Check size={15} strokeWidth={3} />} {l.label}</Chip>)}
            </div>
          </Field>

          <Field label="First message" hint="{name} is the customer's first name, {business} your business name. Leave empty for the message shown.">
            <textarea className={`${input} h-24 py-2.5`} value={flow.welcome} maxLength={600} onChange={(e) => set({ welcome: e.target.value })} placeholder={WELCOME[flow.language]} />
          </Field>

          <Field group label="Book how far ahead">
            <div className="flex flex-wrap gap-2">
              {DAYS_AHEAD_CHOICES.map((d) => <Chip key={d} selected={flow.days_ahead === d} onClick={() => set({ days_ahead: d })}>{d} days</Chip>)}
            </div>
          </Field>

          <div className="rounded-2xl border border-[#e3e8f2] dark:border-slate-800 divide-y divide-[#eef1f6] dark:divide-slate-800">
            <label className="flex items-center justify-between gap-4 px-4 py-3.5">
              <span><span className="block text-[15px] font-bold text-[#0E1B3D] dark:text-white">Ask who they want</span><span className="block text-[13.5px] text-[#6B7894]">A step to pick a team member (or anyone free), when more than one person does the service.</span></span>
              <Toggle checked={flow.ask_staff} onChange={(ask_staff) => set({ ask_staff })} label="Ask who they want" />
            </label>
            <label className="flex items-center justify-between gap-4 px-4 py-3.5">
              <span><span className="block text-[15px] font-bold text-[#0E1B3D] dark:text-white">Confirm free times on their own</span><span className="block text-[13.5px] text-[#6B7894]">Off: each booking waits for you to approve it on the Front Desk. On: a free time is booked at once.</span></span>
              <Toggle checked={autoApprove} onChange={setAutoApprove} label="Confirm free times on their own" />
            </label>
          </div>

          <div className="rounded-2xl bg-[#f4f6fa] dark:bg-slate-900/60 p-4">
            <p className="text-[14px] font-bold text-[#0E1B3D] dark:text-white">Share it with customers</p>
            {link ? (
              <>
                <p className="text-[13px] text-[#4a5672] dark:text-slate-300 mt-0.5">This link opens WhatsApp with “{flow.triggers[0]}” typed for them. Put it on Instagram, Google or a QR code at the counter.</p>
                <div className="mt-2 flex gap-2">
                  <input readOnly value={link} className={`${input} flex-1 min-w-0 text-[13.5px]`} aria-label="Booking link" />
                  <button type="button" onClick={() => { navigator.clipboard?.writeText(link); flash('success', 'Link copied.') }} className={`${secondaryButton} shrink-0`}><Copy size={16} /> Copy</button>
                </div>
                <p className="text-[12.5px] text-[#6B7894] mt-1.5">Uses the phone in Business details. Make sure it is your WhatsApp Business number.</p>
              </>
            ) : (
              <p className="text-[13px] text-[#4a5672] dark:text-slate-300 mt-0.5">Customers send “{flow.triggers[0]}” to your WhatsApp number. Add your WhatsApp number as the phone in Business details to get a link to share.</p>
            )}
          </div>

          <div className="flex justify-end"><button type="button" onClick={save} disabled={saving} className={primaryButton}>{saving && <Loader2 size={18} className="animate-spin" />} Save booking flow</button></div>
        </div>

        {/* How the customer sees it */}
        <div className="@5xl:col-span-2 min-w-0">
          <div className="@5xl:sticky @5xl:top-4">
            <p className="text-[12.5px] font-bold uppercase tracking-wide text-[#8a94a8] mb-2">What the customer sees</p>
            <div className="mx-auto max-w-[340px] rounded-[28px] border-[6px] border-[#0E1B3D] overflow-hidden">
              <div className="bg-[#0E1B3D] px-4 py-2.5 text-white text-[13.5px] font-bold truncate">{business}</div>
              <div className="bg-[#efeae2] p-3 space-y-2.5 max-h-[620px] overflow-y-auto">
                <Bubble mine>{(flow.triggers[0] || 'book').replace(/^./, (c) => c.toUpperCase())}</Bubble>
                {services.length <= 10 ? (
                  <ListBubble text={welcome} button="Choose a service" rows={services.slice(0, 4).map((s) => ({ title: s.name, note: `${formatRupees(Number(s.price))} · ${s.duration_minutes} min` }))} />
                ) : (
                  <ListBubble text={welcome} button="Choose a category" rows={groups.slice(0, 4).map(([c, list]) => ({ title: c, note: `${list.length} services` }))} />
                )}
                <Bubble mine>{first?.name || 'Haircut'}</Bubble>
                {flow.ask_staff && (
                  <>
                    <ListBubble text={`Who would you like for ${first?.name || 'Haircut'}?`} button="Choose who" rows={[{ title: 'Anyone free' }, ...setup.staff.filter((m) => m.active).slice(0, 2).map((m) => ({ title: m.name }))]} />
                    <Bubble mine>Anyone free</Bubble>
                  </>
                )}
                <ListBubble text={`Which day suits you for ${first?.name || 'Haircut'}?`} button="Choose a day" rows={[{ title: 'Today', note: 'Only days with free times' }, { title: 'Tomorrow' }, { title: 'Wed, 11 Nov' }]} />
                <Bubble mine>Tomorrow</Bubble>
                <ListBubble text={`${first?.name || 'Haircut'} on Tomorrow: tap "Choose a time" to pick one.`} button="Choose a time" rows={[{ title: '10:00 am' }, { title: '10:30 am' }, { title: '11:30 am' }]} />
                <Bubble mine>10:30 am</Bubble>
                <Bubble>{autoApprove ? `Confirmed! ${first?.name || 'Haircut'} at ${business}, Tomorrow at 10:30 am. See you soon! ✨` : `Thank you! We have your request for ${first?.name || 'Haircut'} on Tomorrow at 10:30 am. We will confirm it shortly.`}</Bubble>
              </div>
            </div>
            {!autoApprove && <p className="mt-2 text-center text-[12.5px] text-[#6B7894]">Requests appear on the Front Desk under Booking requests, to approve or decline.</p>}
          </div>
        </div>
      </div>
    </section>
  )
}
