'use client'

/**
 * The counter's sheets: a booking, a bill (for an appointment or a walk-in, all on one screen) and
 * the result with the invoice link. Everything is chosen by tapping; a returning customer is found
 * by part of their mobile number or name.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Banknote, CalendarPlus, Check, Clock, Copy, CreditCard, ExternalLink, Loader2, MessageCircle, Plus, Receipt, RotateCcw, Search, Smartphone, UserRound, X } from 'lucide-react'
import { busyFrom, counterSlots, describeHours, isClosedOn, type Busy } from '@/lib/salon/availability'
import { customerSearch, type CustomerMatch } from '@/lib/salon/customers'
import { computeInvoice, formatRupees, type Discount } from '@/lib/salon/invoice'
import { addDays, formatIstDay, formatIstTime, fromIst, istDate } from '@/lib/salon/spoken'
import { api, Avatar, Chip, Field, input, Modal, primaryButton, secondaryButton, Toggle } from './ui'
import type { Appointment, SalonSetup, Service } from './types'

export type PaymentChoice = 'cash' | 'upi' | 'card' | null

export interface BookingDraft {
  contact_id?: string | null
  name?: string
  phone?: string
  service_ids?: string[]
  staff_id?: string | null
  date?: string
  time?: string
}

export interface CustomerValue { contact_id: string | null; name: string; phone: string }

export type BillTarget =
  | { kind: 'appointment'; appointment: Appointment }
  | { kind: 'walkin'; customer?: CustomerValue; service_ids?: string[] }

const PRESET_DISCOUNTS: { label: string; value: Discount | null }[] = [
  { label: 'None', value: null },
  { label: '5%', value: { type: 'percent', value: 5 } },
  { label: '10%', value: { type: 'percent', value: 10 } },
  { label: '15%', value: { type: 'percent', value: 15 } },
  { label: '20%', value: { type: 'percent', value: 20 } },
  { label: '₹100 off', value: { type: 'amount', value: 100 } },
]
const PAYMENTS: { value: PaymentChoice; label: string; icon: typeof Banknote }[] = [
  { value: 'cash', label: 'Cash', icon: Banknote }, { value: 'upi', label: 'UPI', icon: Smartphone }, { value: 'card', label: 'Card', icon: CreditCard }, { value: null, label: 'Pay later', icon: Clock },
]

const sameDiscount = (a?: Discount | null, b?: Discount | null) => (!a && !b) || (a && b && a.type === b.type && a.value === b.value)
const sectionTitle = 'text-[13px] font-bold uppercase tracking-wide text-[#6B7894] dark:text-slate-400'
const errorBox = 'rounded-xl bg-[#fdf0f0] dark:bg-red-950/30 text-[#b91c1c] dark:text-red-300 px-4 py-3 text-[14.5px] font-medium'

// ── Customer ─────────────────────────────────────────────────────────────────

/**
 * Mobile number and name. Typing either looks up saved customers; picking one fills both and shows
 * their last visit, with "Same as last time" to add those services.
 */
export function CustomerFields({ orgId, value, onChange, onRepeat, optional }: {
  orgId: string
  value: CustomerValue
  onChange: (value: CustomerValue) => void
  onRepeat?: (serviceIds: string[], staffIds: (string | null)[]) => void
  optional?: boolean
}) {
  const [matches, setMatches] = useState<CustomerMatch[]>([])
  const [picked, setPicked] = useState<CustomerMatch | null>(null)
  const [searching, setSearching] = useState(false)
  const [lastEdited, setLastEdited] = useState<'phone' | 'name'>('phone')
  const [looked, setLooked] = useState('')
  const latest = useRef(0)
  const typed = (lastEdited === 'phone' ? value.phone : value.name).trim()

  useEffect(() => {
    if (value.contact_id || !customerSearch(typed)) { setMatches([]); setSearching(false); return }
    const request = ++latest.current
    setSearching(true)
    const timer = window.setTimeout(() => {
      api(`/api/salon/customers?organizationId=${orgId}&q=${encodeURIComponent(typed)}`)
        .then((data) => {
          if (request !== latest.current) return
          const found: CustomerMatch[] = data.customers || []
          const exact = found.filter((c) => c.exact)
          // The whole number typed belongs to one saved contact: pick them straight away
          if (lastEdited === 'phone' && exact.length === 1) pick(exact[0])
          else setMatches(found)
          setLooked(typed)
        })
        .catch(() => { if (request === latest.current) setMatches([]) })
        .finally(() => { if (request === latest.current) setSearching(false) })
    }, 250)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed, value.contact_id, orgId])

  function pick(match: CustomerMatch) {
    setPicked(match)
    setMatches([])
    onChange({ contact_id: match.contact_id, name: match.name, phone: match.phone || '' })
  }

  if (value.contact_id) {
    const last = picked?.contact_id === value.contact_id ? picked.last_visit : null
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-3 rounded-2xl border border-[#cfdcfb] dark:border-blue-900/60 bg-[#f5f8ff] dark:bg-blue-950/20 p-3">
          <Avatar name={value.name || 'Customer'} size={44} />
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-bold text-[#0E1B3D] dark:text-white truncate">{value.name || 'Customer'}</p>
            <p className="text-[13.5px] text-[#4a5672] dark:text-slate-300 truncate">{value.phone || 'No mobile number'}{picked?.contact_id === value.contact_id ? (picked.visits > 0 ? ` · ${picked.visits} visit${picked.visits === 1 ? '' : 's'}` : ' · from Contacts') : ''}</p>
            {last && <p className="text-[12.5px] text-[#6B7894] dark:text-slate-400 truncate">Last: {formatIstDay(last.date)} · {last.services.join(', ') || 'visit'} · {formatRupees(last.total)}</p>}
          </div>
          <button type="button" onClick={() => { setPicked(null); onChange({ contact_id: null, name: '', phone: '' }) }} aria-label="Change customer"
            className="shrink-0 inline-flex items-center gap-1 h-10 px-3 rounded-xl text-[14px] font-semibold text-[#1D5BEA] dark:text-blue-300 hover:bg-white dark:hover:bg-slate-800 cursor-pointer"><X size={16} /> <span className="hidden min-[400px]:inline">Change</span></button>
        </div>
        {onRepeat && last && last.service_ids.length > 0 && (
          <button type="button" onClick={() => onRepeat(last.service_ids, last.staff_ids)} className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-10 px-3.5 py-2 rounded-xl border border-[#d5ddeb] dark:border-slate-700 text-[14px] font-semibold text-[#0E1B3D] dark:text-slate-100 hover:border-[#9db5ef] hover:bg-[#f8fafc] dark:hover:bg-slate-800 cursor-pointer text-left">
            <RotateCcw size={16} className="shrink-0 text-[#1D5BEA]" /> <span className="min-w-0">Same as last time: <span className="font-normal text-[#4a5672] dark:text-slate-300">{last.services.join(', ')}</span></span>
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label={optional ? 'Mobile number (optional)' : 'Mobile number'}>
          <span className="relative block">
            <input className={`${input} pr-9`} value={value.phone} inputMode="tel" autoComplete="off" placeholder="98765 43210"
              onChange={(e) => { setLastEdited('phone'); onChange({ ...value, phone: e.target.value }) }} />
            {searching && lastEdited === 'phone' && <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[#8a94a8]" />}
          </span>
        </Field>
        <Field label={optional ? 'Name (optional)' : 'Name'}>
          <span className="relative block">
            <input className={`${input} pr-9`} value={value.name} autoComplete="off" placeholder={optional ? 'Walk-in customer' : 'Priya'}
              onChange={(e) => { setLastEdited('name'); onChange({ ...value, name: e.target.value }) }} />
            {searching && lastEdited === 'name' && <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[#8a94a8]" />}
          </span>
        </Field>
      </div>
      {!matches.length && !searching && lastEdited === 'phone' && value.phone.replace(/\D/g, '').length >= 10 && looked === typed && (
        <p className="text-[12.5px] text-[#6B7894]">New customer: they are saved to Contacts when you {optional ? 'bill' : 'book'}.</p>
      )}
      {matches.length > 0 && (
        <div className="rounded-2xl border border-[#e3e8f2] dark:border-slate-700 overflow-hidden">
          <p className="px-3.5 py-2 bg-[#f8fafc] dark:bg-slate-900/60 text-[12.5px] font-bold text-[#6B7894]">From your Contacts · tap to pick</p>
          <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800 max-h-60 overflow-y-auto">
            {matches.slice(0, 6).map((match) => (
              <li key={match.contact_id}>
                <button type="button" onClick={() => pick(match)} className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-[#f5f8ff] dark:hover:bg-blue-950/20 cursor-pointer">
                  <Avatar name={match.name} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold text-[#0E1B3D] dark:text-white truncate">{match.name}</span>
                    <span className="block text-[13px] text-[#6B7894] truncate">{match.phone || 'No number'}{match.last_visit ? ` · last ${formatIstDay(match.last_visit.date)}` : ''}</span>
                  </span>
                  {match.visits > 0 && <span className="shrink-0 inline-flex items-center h-6 px-2 rounded-md bg-[#eef3fe] dark:bg-blue-950/40 text-[12px] font-bold text-[#1D5BEA] dark:text-blue-300">{match.visits} visit{match.visits === 1 ? '' : 's'}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── Services ─────────────────────────────────────────────────────────────────

/** The service list as tappable rows, with a search box and categories once the list is long. */
export function ServicePicker({ services, selected, onChange }: { services: Service[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const active = useMemo(() => services.filter((s) => s.active), [services])
  const categories = useMemo(() => ['All', ...new Set(active.map((s) => s.category || 'General'))], [active])
  const words = query.trim().toLowerCase()
  const shown = active.filter((s) => (category === 'All' || (s.category || 'General') === category) && (!words || s.name.toLowerCase().includes(words) || (s.category || '').toLowerCase().includes(words)))
  const long = active.length > 6
  return (
    <div className="space-y-3 min-w-0">
      {long && (
        <div className="space-y-2">
          <label className="relative block">
            <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a94a8]" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search services" aria-label="Search services" className={`${input} pl-9`} />
          </label>
          {categories.length > 2 && (
            <div role="radiogroup" aria-label="Category" className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1 [scrollbar-width:none]">
              {categories.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={category === c} onClick={() => setCategory(c)}
                  className={`shrink-0 h-9 px-3.5 rounded-full border text-[13.5px] font-semibold whitespace-nowrap cursor-pointer transition-colors ${category === c ? 'border-[#0E1B3D] bg-[#0E1B3D] text-white dark:border-white dark:bg-white dark:text-[#0E1B3D]' : 'border-[#d5ddeb] dark:border-slate-700 text-[#4a5672] dark:text-slate-300 hover:border-[#9db5ef]'}`}>{c}</button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {shown.map((service) => {
          const on = selected.includes(service.id)
          return (
            <button key={service.id} type="button" aria-pressed={on} onClick={() => onChange(on ? selected.filter((id) => id !== service.id) : [...selected, service.id])}
              className={`min-h-[56px] rounded-xl border px-3 py-2 flex items-center gap-3 text-left cursor-pointer transition-colors ${on ? 'border-[#1D5BEA] bg-[#eef3fe] dark:bg-blue-950/40' : 'border-[#e3e8f2] dark:border-slate-700 hover:border-[#9db5ef] hover:bg-[#f8fafc] dark:hover:bg-slate-800/60'}`}>
              <span className={`h-6 w-6 shrink-0 rounded-md border-2 flex items-center justify-center ${on ? 'bg-[#1D5BEA] border-[#1D5BEA] text-white' : 'border-[#c0c8d8] dark:border-slate-600'}`}>{on && <Check size={14} strokeWidth={3} />}</span>
              <span className="min-w-0 flex-1">
                <span className={`block text-[14.5px] font-semibold leading-snug break-words ${on ? 'text-[#1D5BEA] dark:text-blue-200' : 'text-[#0E1B3D] dark:text-white'}`}>{service.name}</span>
                <span className="block text-[12.5px] text-[#6B7894] dark:text-slate-400">{service.duration_minutes} min{category === 'All' && categories.length > 2 ? ` · ${service.category || 'General'}` : ''}</span>
              </span>
              <span className="shrink-0 text-[14.5px] font-bold text-[#0E1B3D] dark:text-white">{formatRupees(Number(service.price))}</span>
            </button>
          )
        })}
      </div>
      {!shown.length && <p className="text-[14px] text-[#6B7894] py-2">{active.length ? `No service matches “${query.trim()}”.` : 'No services on offer. Add them in Setup.'}</p>}
    </div>
  )
}

// ── Who does each service ───────────────────────────────────────────────────

export interface StaffLine { key: string; service_id: string | null; name: string }

/**
 * Who does (or did) each service. One tap on a name also fills the other services that person
 * does and nobody is down for yet, so a single person doing everything is one tap.
 */
export function WhoDidIt({ setup, lines, value, onChange, planned }: { setup: SalonSetup; lines: StaffLine[]; value: Record<string, string | null>; onChange: (next: Record<string, string | null>) => void; planned?: boolean }) {
  const team = setup.staff.filter((member) => member.active)
  if (!team.length || !lines.length) return null
  const canDo = (serviceId: string | null) => team.filter((member) => !member.service_ids.length || !serviceId || member.service_ids.includes(serviceId))
  function pick(key: string, staffId: string | null) {
    const next = { ...value, [key]: staffId }
    if (staffId) for (const line of lines) if (line.key !== key && !next[line.key] && canDo(line.service_id).some((member) => member.id === staffId)) next[line.key] = staffId
    onChange(next)
  }
  const many = lines.length > 1
  const chip = (on: boolean) => `shrink-0 inline-flex items-center gap-1.5 h-10 pl-1.5 pr-3 rounded-xl border text-[14px] font-semibold whitespace-nowrap cursor-pointer transition-colors ${on ? 'border-[#1D5BEA] bg-[#eef3fe] text-[#1D5BEA] dark:bg-blue-950/40 dark:text-blue-200' : 'border-[#d5ddeb] dark:border-slate-700 text-[#0E1B3D] dark:text-slate-200 hover:border-[#9db5ef]'}`
  return (
    <div role="group" aria-label={planned ? 'Who will do it' : 'Who did it'} className="space-y-2 min-w-0">
      <p className={sectionTitle}>{many ? (planned ? 'Who will do each service' : 'Who did each service') : (planned ? 'Who will do it' : 'Who did it')}</p>
      {many && <p className="text-[12.5px] text-[#6B7894] -mt-1">Tap a name once and it fills their other services too.</p>}
      <div className={many ? 'rounded-2xl border border-[#e3e8f2] dark:border-slate-800 divide-y divide-[#eef1f6] dark:divide-slate-800' : ''}>
        {lines.map((line) => {
          const chosen = value[line.key] || null
          return (
            <div key={line.key} className={many ? 'px-3 py-2.5 min-w-0' : 'min-w-0'}>
              {many && <div className="text-[14px] font-bold text-[#0E1B3D] dark:text-white truncate mb-1.5">{line.name}</div>}
              <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5 [scrollbar-width:none] sm:flex-wrap" role="radiogroup" aria-label={`Who for ${line.name}`}>
                {canDo(line.service_id).map((member) => (
                  <button key={member.id} type="button" role="radio" aria-checked={chosen === member.id} onClick={() => pick(line.key, member.id)} className={chip(chosen === member.id)}>
                    <Avatar name={member.name} size={26} /> {member.name}
                  </button>
                ))}
                <button type="button" role="radio" aria-checked={!chosen} onClick={() => pick(line.key, null)} className={`${chip(!chosen)} pl-3`}>Anyone</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Day and time ─────────────────────────────────────────────────────────────

function DayAndTime({ orgId, setup, date, time, minutes, serviceIds, staffIds, onDate, onTime }: {
  orgId: string
  setup: SalonSetup
  date: string
  time: string
  minutes: number
  serviceIds: string[]
  staffIds: (string | null)[]
  onDate: (date: string) => void
  onTime: (time: string) => void
}) {
  const today = istDate()
  const [busy, setBusy] = useState<Busy[]>([])
  const [other, setOther] = useState(false)

  // Who is already booked that day, to show which times are taken
  useEffect(() => {
    let live = true
    api(`/api/salon/appointments?organizationId=${orgId}&date=${date}`)
      .then((data) => { if (live) setBusy(busyFrom([...(data.appointments || []), ...(data.requests || []).filter((r: Appointment) => istDate(r.starts_at) === date)])) })
      .catch(() => { if (live) setBusy([]) })
    return () => { live = false }
  }, [orgId, date])

  const hours = { opens_at: setup.settings.opens_at, closes_at: setup.settings.closes_at, closed_weekdays: setup.settings.closed_weekdays }
  const eligible = setup.staff.filter((m) => m.active && serviceIds.every((id) => !m.service_ids.length || m.service_ids.includes(id))).map((m) => m.id)
  const chosenStaff = staffIds.filter(Boolean) as string[]
  const slots = counterSlots({ date, hours, minutes: minutes || 30, eligibleStaff: eligible, staffIds: chosenStaff, busy })
  const groups = [
    { label: 'Morning', list: slots.filter((s) => s.time < '12:00') },
    { label: 'Afternoon', list: slots.filter((s) => s.time >= '12:00' && s.time < '17:00') },
    { label: 'Evening', list: slots.filter((s) => s.time >= '17:00') },
  ].filter((g) => g.list.length)
  const closed = isClosedOn(date, hours)
  const chosenSlot = slots.find((s) => s.time === time)
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i))
  const dayChip = (on: boolean) => `shrink-0 flex flex-col items-center justify-center w-[64px] h-[58px] rounded-xl border cursor-pointer transition-colors ${on ? 'border-[#0E1B3D] bg-[#0E1B3D] text-white dark:border-white dark:bg-white dark:text-[#0E1B3D]' : 'border-[#d5ddeb] dark:border-slate-700 text-[#0E1B3D] dark:text-slate-200 hover:border-[#9db5ef]'}`

  return (
    <div className="space-y-4 min-w-0">
      <div className="space-y-2">
        <p className={sectionTitle}>Day</p>
        <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1 [scrollbar-width:none]" role="radiogroup" aria-label="Day">
          {days.map((day) => {
            const noon = fromIst(day, '12:00')!
            return (
              <button key={day} type="button" role="radio" aria-checked={date === day} onClick={() => { onDate(day); onTime('') }} className={dayChip(date === day)}>
                <span className="text-[11.5px] font-bold uppercase tracking-wide opacity-80">{day === today ? 'Today' : day === addDays(today, 1) ? 'Tmrw' : noon.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' })}</span>
                <span className="text-[17px] font-extrabold leading-tight">{noon.toLocaleDateString('en-IN', { day: 'numeric', timeZone: 'Asia/Kolkata' })}</span>
              </button>
            )
          })}
          <label className={`${dayChip(!days.includes(date))} relative`}>
            <span className="text-[11.5px] font-bold uppercase tracking-wide opacity-80">{days.includes(date) ? 'Other' : fromIst(date, '12:00')!.toLocaleDateString('en-IN', { month: 'short', timeZone: 'Asia/Kolkata' })}</span>
            <span className="text-[15px] font-extrabold leading-tight">{days.includes(date) ? 'Date' : fromIst(date, '12:00')!.toLocaleDateString('en-IN', { day: 'numeric', timeZone: 'Asia/Kolkata' })}</span>
            <input type="date" aria-label="Pick another day" min={today} value={date} onClick={(e) => { try { (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.() } catch {} }} onChange={(e) => { if (e.target.value) { onDate(e.target.value); onTime('') } }} className="absolute inset-0 opacity-0 cursor-pointer" />
          </label>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className={sectionTitle}>Time</p>
          <span className="text-[12.5px] text-[#8a94a8] text-right">{chosenStaff.length ? 'Free for who you picked' : 'Free for anyone who does it'}</span>
        </div>
        {closed && <p className="rounded-xl bg-[#f4f6fa] dark:bg-slate-800/60 text-[#4a5672] dark:text-slate-300 px-3.5 py-2.5 text-[13.5px]">You are closed this day ({describeHours(hours).replace(/^Open /, 'open ')}). You can still pick a time.</p>}
        {groups.length ? groups.map((group) => (
          <div key={group.label}>
            <p className="text-[12.5px] font-semibold text-[#8a94a8] mb-1.5">{group.label}</p>
            <div className="grid grid-cols-3 min-[400px]:grid-cols-4 sm:grid-cols-6 gap-1.5">
              {group.list.map((slot) => {
                const on = time === slot.time
                return (
                  <button key={slot.time} type="button" aria-pressed={on} onClick={() => { onTime(slot.time); setOther(false) }} title={slot.free ? undefined : 'Already busy then'}
                    className={`h-10 rounded-lg border text-[13.5px] font-semibold cursor-pointer transition-colors ${on ? 'border-[#1D5BEA] bg-[#1D5BEA] text-white' : slot.free ? 'border-[#d5ddeb] dark:border-slate-700 text-[#0E1B3D] dark:text-slate-200 hover:border-[#9db5ef]' : 'border-dashed border-[#e3e8f2] dark:border-slate-800 text-[#a3adc2] dark:text-slate-600 line-through'}`}>
                    {formatIstTime(fromIst(date, slot.time)!)}
                  </button>
                )
              })}
            </div>
          </div>
        )) : <p className="text-[14px] text-[#6B7894]">No more times this day. Pick another day, or type a time below.</p>}
        {chosenSlot && !chosenSlot.free && <p className="text-[13.5px] font-medium text-[#4a5672] dark:text-slate-300">Someone is already booked then. You can still book it.</p>}
        {chosenSlot && chosenSlot.free && chosenSlot.late && <p className="text-[13.5px] font-medium text-[#4a5672] dark:text-slate-300">This visit ends after closing time. You can still book it.</p>}
        {other || (time && !chosenSlot)
          ? <input type="time" aria-label="Exact time" value={time} onChange={(e) => onTime(e.target.value)} className={`${input} w-40`} />
          : <button type="button" onClick={() => setOther(true)} className="text-[13.5px] font-semibold text-[#1D5BEA] dark:text-blue-300 hover:underline cursor-pointer">Another time</button>}
      </div>
    </div>
  )
}

// ── Booking ──────────────────────────────────────────────────────────────────

export function BookingSheet({ orgId, setup, draft, onClose, onBooked }: {
  orgId: string
  setup: SalonSetup
  draft?: BookingDraft
  onClose: () => void
  onBooked: (result: any) => void
}) {
  const today = istDate()
  const [customer, setCustomer] = useState<CustomerValue>({ contact_id: draft?.contact_id || null, name: draft?.name || '', phone: draft?.phone || '' })
  const [serviceIds, setServiceIds] = useState<string[]>(draft?.service_ids || [])
  const [lineStaff, setLineStaff] = useState<Record<string, string | null>>(() => Object.fromEntries((draft?.service_ids || []).map((id) => [id, draft?.staff_id || null])))
  const [date, setDate] = useState(draft?.date && draft.date >= today ? draft.date : today)
  const [time, setTime] = useState(draft?.time || '')
  const [sendWhatsApp, setSendWhatsApp] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const chosen = serviceIds.map((id) => setup.services.find((service) => service.id === id)).filter(Boolean) as Service[]
  const minutes = chosen.reduce((sum, service) => sum + Number(service.duration_minutes || 0), 0)
  const price = chosen.reduce((sum, service) => sum + Number(service.price || 0), 0)
  const startsAt = time ? fromIst(date, time) : null

  async function submit() {
    setError('')
    if (!customer.name.trim() && !customer.phone.trim()) { setError('Add the customer\'s mobile number or name.'); return }
    if (!serviceIds.length) { setError('Choose at least one service.'); return }
    if (!startsAt) { setError('Choose a time.'); return }
    setSaving(true)
    try {
      const result = await api('/api/salon/act', { method: 'POST', body: JSON.stringify({ organizationId: orgId, action: {
        type: 'create_appointment', customer: { contact_id: customer.contact_id, name: customer.name.trim(), phone: customer.phone.trim() || null },
        service_ids: serviceIds, staff_ids: serviceIds.map((id) => lineStaff[id] || null), starts_at: startsAt.toISOString(), send_whatsapp: sendWhatsApp,
      } }) })
      onBooked(result)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal size="lg" title="New booking" subtitle="Customer, services and a time" icon={<CalendarPlus size={21} />} onClose={onClose}
      footer={
        <div className="w-full flex items-center gap-3">
          <div className="min-w-0 mr-auto">
            <p className="text-[12.5px] text-[#6B7894] truncate">{chosen.length ? `${chosen.length} service${chosen.length === 1 ? '' : 's'} · ${minutes} min` : 'No services yet'}</p>
            <p className="text-[20px] font-extrabold leading-tight text-[#0E1B3D] dark:text-white">{formatRupees(price)}</p>
          </div>
          <button type="button" onClick={onClose} className={`${secondaryButton} max-sm:hidden`}>Cancel</button>
          <button type="button" onClick={submit} disabled={saving} className={`${primaryButton} h-12 min-w-0 flex-1 sm:flex-none sm:min-w-[220px]`}>
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} strokeWidth={3} />}
            <span className="truncate">{startsAt ? `Book ${formatIstDay(date, today)}, ${formatIstTime(startsAt)}` : 'Book'}</span>
          </button>
        </div>
      }>
      <div className="space-y-6 min-w-0">
        {error && <div role="alert" className={errorBox}>{error}</div>}
        <section className="space-y-2">
          <p className={sectionTitle}>Customer</p>
          <CustomerFields orgId={orgId} value={customer} onChange={setCustomer}
            onRepeat={(ids, staff) => { const known = ids.filter((id) => setup.services.some((s) => s.id === id && s.active)); setServiceIds(known); setLineStaff(Object.fromEntries(known.map((id, i) => [id, staff[i] || null]))) }} />
        </section>
        <section className="space-y-2">
          <p className={sectionTitle}>Services</p>
          <ServicePicker services={setup.services} selected={serviceIds} onChange={setServiceIds} />
        </section>
        <WhoDidIt planned setup={setup} lines={chosen.map((service) => ({ key: service.id, service_id: service.id, name: service.name }))} value={lineStaff} onChange={setLineStaff} />
        <DayAndTime orgId={orgId} setup={setup} date={date} time={time} minutes={minutes} serviceIds={serviceIds} staffIds={serviceIds.map((id) => lineStaff[id] || null)} onDate={setDate} onTime={setTime} />
        {customer.phone.trim() && (
          <label className="flex items-center justify-between gap-4 rounded-2xl bg-[#f4f6fa] dark:bg-slate-900/40 px-4 py-3 text-[15px] text-[#0E1B3D] dark:text-white">
            <span className="flex items-center gap-3 min-w-0"><span className="h-9 w-9 shrink-0 rounded-xl bg-[#1D5BEA] text-white flex items-center justify-center"><MessageCircle size={18} /></span><span className="min-w-0"><strong>Send confirmation on WhatsApp</strong><span className="block text-[13px] text-[#4a5672] dark:text-slate-400">With the day, time and services</span></span></span>
            <Toggle checked={sendWhatsApp} onChange={setSendWhatsApp} label="Send confirmation on WhatsApp" />
          </label>
        )}
      </div>
    </Modal>
  )
}

// ── Bill ─────────────────────────────────────────────────────────────────────

type Line = { key: string; service_id: string | null; name: string; price: number; tax_rate: number; sac_code: string | null; staff_id?: string | null }

export function BillSheet({ orgId, setup, target, onClose, onBilled }: {
  orgId: string
  setup: SalonSetup
  target: BillTarget
  onClose: () => void
  onBilled: (result: any) => void
}) {
  const walkIn = target.kind === 'walkin'
  const [customer, setCustomer] = useState<CustomerValue>(walkIn ? target.customer || { contact_id: null, name: '', phone: '' } : { contact_id: target.appointment.contact_id, name: target.appointment.customer_name, phone: target.appointment.customer_phone || '' })
  const [serviceIds, setServiceIds] = useState<string[]>(walkIn ? target.service_ids || [] : [])
  const [extra, setExtra] = useState<string[]>([])
  const [addMore, setAddMore] = useState(false)
  const [discount, setDiscount] = useState<Discount | null>(null)
  const [customOff, setCustomOff] = useState<{ type: 'percent' | 'amount'; value: string } | null>(null)
  const [payment, setPayment] = useState<PaymentChoice>('cash')
  const [sendWhatsApp, setSendWhatsApp] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const fromList = (id: string, key: string): Line | null => {
    const s = setup.services.find((service) => service.id === id)
    return s ? { key, service_id: s.id, name: s.name, price: Number(s.price), tax_rate: Number(s.tax_rate), sac_code: s.sac_code } : null
  }
  // The lines in the order the server bills them, each with a key for "who did it"
  const lines: Line[] = walkIn
    ? serviceIds.map((id) => fromList(id, `s:${id}`)).filter(Boolean) as Line[]
    : [...target.appointment.services.map((s, index) => ({ ...s, key: `b${index}`, price: Number(s.price), tax_rate: Number(s.tax_rate), staff_id: s.staff_id || target.appointment.staff_id })), ...extra.map((id) => fromList(id, `e:${id}`)).filter(Boolean) as Line[]]
  const [lineStaff, setLineStaff] = useState<Record<string, string | null>>(() => Object.fromEntries(lines.map((line) => [line.key, line.staff_id || null])))
  const staffName = (id: string | null | undefined) => (id ? setup.staff.find((member) => member.id === id)?.name : undefined)
  const registered = Boolean(setup.settings.gstin)
  const appliedDiscount: Discount | null = customOff ? (Number(customOff.value) > 0 ? { type: customOff.type, value: Number(customOff.value) } : null) : discount
  const bill = computeInvoice(lines.map((line) => ({ ...line, tax_rate: registered ? Number(line.tax_rate) : 0 })), { pricesIncludeTax: setup.settings.prices_include_tax, discount: appliedDiscount })
  const phone = customer.phone.trim()

  async function submit() {
    setError('')
    if (!lines.length) { setError('Choose at least one service.'); return }
    setSaving(true)
    try {
      const staff_ids = lines.map((line) => lineStaff[line.key] || null)
      const action = walkIn
        ? { type: 'walk_in_bill', customer: { contact_id: customer.contact_id, name: customer.name.trim() || 'Walk-in customer', phone: phone || null }, service_ids: serviceIds, staff_ids, discount: appliedDiscount, payment_method: payment, send_whatsapp: sendWhatsApp }
        : { type: 'complete_and_bill', appointment_id: target.appointment.id, extra_service_ids: extra, staff_ids, discount: appliedDiscount, payment_method: payment, send_whatsapp: sendWhatsApp }
      onBilled(await api('/api/salon/act', { method: 'POST', body: JSON.stringify({ organizationId: orgId, action }) }))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const receipt = (
    <div className="rounded-2xl bg-[#f8fafc] dark:bg-slate-900/60 border border-[#e3e8f2] dark:border-slate-800 p-4">
      <p className={`${sectionTitle} mb-3`}>{registered ? 'Tax invoice' : 'Bill'}</p>
      {bill.lines.length ? (
        <ul className="space-y-2">
          {bill.lines.map((line, index) => (
            <li key={index} className="flex items-start justify-between gap-3 text-[14.5px]">
              <span className="min-w-0"><span className="block text-[#0E1B3D] dark:text-white font-semibold break-words">{line.name}</span>{staffName(lineStaff[lines[index]?.key]) && <span className="block text-[12.5px] text-[#6B7894]">by {staffName(lineStaff[lines[index]?.key])}</span>}</span>
              <span className="shrink-0 font-bold text-[#0E1B3D] dark:text-white">{formatRupees(line.price * line.quantity)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-[14px] text-[#8a94a8]">Pick services to see the bill.</p>}
      <div className="mt-3 pt-3 border-t border-dashed border-[#c0c8d8] dark:border-slate-700 space-y-1.5 text-[14px] text-[#4a5672] dark:text-slate-400">
        {bill.discount > 0 && <div className="flex justify-between gap-2"><span>Discount</span><span className="font-semibold text-[#0E1B3D] dark:text-slate-100">− {formatRupees(bill.discount)}</span></div>}
        {registered && <div className="flex justify-between gap-2"><span>GST (CGST + SGST)</span><span>{formatRupees(bill.tax)}</span></div>}
        <div className="flex items-end justify-between gap-2 pt-1">
          <span className="text-[15px] font-bold text-[#0E1B3D] dark:text-white">Total</span>
          <span className="text-[26px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white leading-none">{formatRupees(bill.total)}</span>
        </div>
      </div>
    </div>
  )

  return (
    <Modal size="xl" title={walkIn ? 'Quick bill' : `Bill ${customer.name || 'customer'}`} icon={<Receipt size={21} />}
      subtitle={walkIn ? 'Walk-in: pick services, who did them and how they paid' : [`${formatIstTime(target.appointment.starts_at)} appointment`, customer.phone].filter(Boolean).join(' · ')} onClose={onClose}
      footer={
        <div className="w-full flex items-center gap-3">
          <div className="min-w-0 mr-auto">
            <p className="text-[12.5px] text-[#6B7894] truncate">Total{payment ? ` · ${PAYMENTS.find((p) => p.value === payment)?.label}` : ' · pay later'}</p>
            <p className="text-[22px] font-extrabold leading-tight text-[#0E1B3D] dark:text-white">{formatRupees(bill.total)}</p>
          </div>
          <button type="button" onClick={onClose} className={`${secondaryButton} max-sm:hidden`}>Cancel</button>
          <button type="button" onClick={submit} disabled={saving || !lines.length}
            className="inline-flex items-center justify-center gap-2 h-12 px-5 flex-1 sm:flex-none sm:min-w-[220px] rounded-xl bg-[#1D5BEA] hover:bg-[#174bc4] text-white text-[16px] font-bold shadow-sm shadow-[#1D5BEA]/20 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Receipt size={18} />} {payment ? 'Bill & mark paid' : 'Bill, pay later'}
          </button>
        </div>
      }>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 min-w-0">
        <div className="space-y-6 min-w-0">
          {error && <div role="alert" className={errorBox}>{error}</div>}
          {walkIn && (
            <section className="space-y-2">
              <p className={sectionTitle}>Customer</p>
              <CustomerFields optional orgId={orgId} value={customer} onChange={setCustomer}
                onRepeat={(ids, staff) => { const known = ids.filter((id) => setup.services.some((s) => s.id === id && s.active)); setServiceIds(known); setLineStaff(Object.fromEntries(known.map((id, i) => [`s:${id}`, staff[i] || null]))) }} />
            </section>
          )}
          <section className="space-y-2">
            <p className={sectionTitle}>Services</p>
            {walkIn ? <ServicePicker services={setup.services} selected={serviceIds} onChange={setServiceIds} /> : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {target.appointment.services.map((s, i) => <span key={i} className="inline-flex items-center h-8 px-3 rounded-lg bg-[#f4f6fa] dark:bg-slate-800 text-[13.5px] font-semibold text-[#0E1B3D] dark:text-slate-200">{s.name}</span>)}
                </div>
                {!addMore
                  ? <button type="button" onClick={() => setAddMore(true)} className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl border-2 border-dashed border-[#d5ddeb] dark:border-slate-700 text-[15px] font-semibold text-[#4a5672] dark:text-slate-300 hover:border-[#9db5ef] hover:text-[#1D5BEA] cursor-pointer"><Plus size={18} /> Add another service</button>
                  : <div className="pt-1"><ServicePicker services={setup.services} selected={extra} onChange={setExtra} /></div>}
              </>
            )}
          </section>
          <WhoDidIt setup={setup} lines={lines} value={lineStaff} onChange={setLineStaff} />
          <section className="space-y-2">
            <p className={sectionTitle}>Discount</p>
            <div className="flex flex-wrap gap-2">
              {PRESET_DISCOUNTS.map((option) => <Chip key={option.label} selected={!customOff && Boolean(sameDiscount(discount, option.value))} onClick={() => { setCustomOff(null); setDiscount(option.value) }}>{option.label}</Chip>)}
              <Chip selected={Boolean(customOff)} onClick={() => setCustomOff(customOff || { type: 'amount', value: '' })}>Other</Chip>
            </div>
            {customOff && (
              <div className="flex items-center gap-2">
                <div role="radiogroup" aria-label="Discount in" className="inline-flex rounded-xl bg-[#eef1f6] dark:bg-slate-900 p-1 shrink-0">
                  {(['amount', 'percent'] as const).map((type) => <button key={type} type="button" role="radio" aria-checked={customOff.type === type} onClick={() => setCustomOff({ ...customOff, type })} className={`h-9 w-11 rounded-lg text-[15px] font-bold cursor-pointer ${customOff.type === type ? 'bg-white dark:bg-[#111b21] text-[#0E1B3D] dark:text-white shadow-sm' : 'text-[#6B7894]'}`}>{type === 'amount' ? '₹' : '%'}</button>)}
                </div>
                <input type="number" min={0} inputMode="decimal" autoFocus value={customOff.value} onChange={(e) => setCustomOff({ ...customOff, value: e.target.value })} placeholder={customOff.type === 'amount' ? '150' : '12'} aria-label="Discount" className={`${input} w-32`} />
              </div>
            )}
          </section>
          <section className="space-y-2">
            <p className={sectionTitle}>Paid by</p>
            <div className="grid grid-cols-2 min-[480px]:grid-cols-4 gap-2">
              {PAYMENTS.map(({ value, label, icon: Icon }) => {
                const on = payment === value
                return (
                  <button key={label} type="button" aria-pressed={on} onClick={() => setPayment(value)}
                    className={`relative h-[68px] rounded-2xl border-2 flex flex-col items-center justify-center gap-1 text-[14.5px] font-bold cursor-pointer transition-colors ${on ? 'border-[#1D5BEA] bg-[#eef3fe] text-[#1D5BEA] dark:bg-blue-950/40 dark:text-blue-200' : 'border-[#e3e8f2] dark:border-slate-700 text-[#0E1B3D] dark:text-slate-200 hover:border-[#9db5ef]'}`}>
                    {on && <span className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-[#1D5BEA] text-white flex items-center justify-center"><Check size={13} strokeWidth={3} /></span>}
                    <Icon size={22} /> {label}
                  </button>
                )
              })}
            </div>
          </section>
          {phone && (
            <label className="flex items-center justify-between gap-4 rounded-2xl bg-[#f4f6fa] dark:bg-slate-900/40 px-4 py-3 text-[15px] text-[#0E1B3D] dark:text-white">
              <span className="flex items-center gap-3 min-w-0"><span className="h-9 w-9 shrink-0 rounded-xl bg-[#1D5BEA] text-white flex items-center justify-center"><MessageCircle size={18} /></span><span className="min-w-0"><strong>Send the bill on WhatsApp</strong><span className="block text-[13px] text-[#4a5672] dark:text-slate-400 truncate">To {phone}</span></span></span>
              <Toggle checked={sendWhatsApp} onChange={setSendWhatsApp} label="Send the bill on WhatsApp" />
            </label>
          )}
        </div>
        <aside className="min-w-0 lg:sticky lg:top-0 lg:self-start">{receipt}</aside>
      </div>
    </Modal>
  )
}

// ── After billing ───────────────────────────────────────────────────────────

export function ResultSheet({ result, onClose, onCopied, onNext }: { result: any; onClose: () => void; onCopied: () => void; onNext?: () => void }) {
  const invoice = result.invoice
  const link: string = result.link
  const phone = String(invoice?.customer_phone || '').replace(/\D/g, '')
  const shareText = `Your bill ${invoice?.number} from ${invoice?.business?.name || 'us'}: ${formatRupees(Number(invoice?.total))}. ${link}`
  const paid = invoice?.status === 'paid'
  const tile = 'flex flex-col items-center justify-center gap-1.5 h-[80px] rounded-2xl border border-[#e3e8f2] dark:border-slate-700 text-[14px] font-bold text-[#0E1B3D] dark:text-white hover:border-[#9db5ef] hover:bg-[#f8fafc] dark:hover:bg-slate-800 transition-colors cursor-pointer'
  return (
    <Modal title="Billed" subtitle={`${invoice?.number} · ${invoice?.customer_name}`} onClose={onClose}
      footer={<>
        {onNext && <button type="button" onClick={onNext} className={secondaryButton}><UserRound size={17} /> Next walk-in</button>}
        <button type="button" onClick={onClose} className={`${primaryButton} sm:min-w-[140px]`}>Done</button>
      </>}>
      <div className="text-center pt-1 pb-2">
        <span className="relative mx-auto h-[72px] w-[72px] flex items-center justify-center">
          <span aria-hidden className="absolute inset-0 rounded-full bg-[#1D5BEA]/10" />
          <span className="relative h-14 w-14 rounded-full bg-[#1D5BEA] text-white flex items-center justify-center shadow-lg shadow-[#1D5BEA]/20"><Check size={30} strokeWidth={3} /></span>
        </span>
        <p className="text-[34px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white mt-3 leading-none">{formatRupees(Number(invoice?.total))}</p>
        <p className={`mt-2 inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[13.5px] font-bold ${paid ? 'bg-[#f4f6fa] text-[#0E1B3D] dark:bg-slate-800 dark:text-slate-100' : 'bg-[#f4f6fa] text-[#4a5672] dark:bg-slate-800 dark:text-slate-300'}`}>
          {paid ? <Check size={14} strokeWidth={3} /> : <Clock size={14} />} {paid ? `Paid${invoice?.payment_method ? ` · ${({ cash: 'Cash', upi: 'UPI', card: 'Card' } as Record<string, string>)[invoice.payment_method] || ''}` : ''}` : 'Not paid yet'}
        </p>
        {result.whatsapp?.sent && <p className="mt-3 flex items-center justify-center gap-1.5 text-[14px] font-semibold text-[#0E1B3D] dark:text-slate-100"><MessageCircle size={15} /> Sent to the customer on WhatsApp</p>}
        {result.whatsapp && !result.whatsapp.sent && <p className="mt-4 rounded-xl bg-[#f4f6fa] dark:bg-slate-800/60 text-[#4a5672] dark:text-slate-300 px-4 py-2.5 text-[14px] text-left">{result.whatsapp.windowClosed ? 'Not sent on WhatsApp: this customer hasn\'t messaged you in 24 hours, and that needs an approved bill template (Setup → Templates). Share the link below instead.' : result.whatsapp.error}</p>}
      </div>
      <div className={`grid ${phone ? 'grid-cols-3' : 'grid-cols-2'} gap-2 mt-4`}>
        <a href={link} target="_blank" rel="noopener noreferrer" className={tile}><ExternalLink size={20} className="text-[#1D5BEA]" /> Open bill</a>
        <button type="button" onClick={() => { navigator.clipboard?.writeText(link).then(onCopied).catch(() => {}) }} className={tile}><Copy size={20} className="text-[#4a5672] dark:text-slate-300" /> Copy link</button>
        {phone && <a href={`https://wa.me/${phone}?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer" className={tile}><MessageCircle size={20} className="text-[#1D5BEA]" /> WhatsApp</a>}
      </div>
    </Modal>
  )
}
