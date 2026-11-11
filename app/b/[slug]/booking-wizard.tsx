'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarCheck, Check, Clock, Loader2, MapPin, Phone, User } from 'lucide-react'
import { PhoneField } from '@/components/phone-field'
import type { BookingPageView } from '@/lib/salon/booking-page'
import { formatIstDay, istDate } from '@/lib/salon/spoken'

const card = 'bg-white rounded-2xl border border-[#e3e8f2] p-4 sm:p-5'
const rupees = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const MAX_SERVICES = 5

/** "16:30" → "4:30 pm" */
function clock(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const hour = h % 12 || 12
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`
}

function Step({ number, title, children, done }: { number: number; title: string; children: React.ReactNode; done?: boolean }) {
  return (
    <section className={card}>
      <h2 className="flex items-center gap-2.5 text-[16px] font-bold">
        <span className={`h-7 w-7 shrink-0 rounded-full text-[13px] font-bold flex items-center justify-center ${done ? 'bg-[#1D5BEA] text-white' : 'bg-[#eef1f6] text-[#4a5672]'}`}>{done ? <Check size={15} /> : number}</span>
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

export function BookingWizard({ page, days, startService, startPerson }: { page: BookingPageView; days: string[]; startService: string | null; startPerson: string | null }) {
  const [picked, setPicked] = useState<string[]>(startService ? [startService] : [])
  const [person, setPerson] = useState<string | null>(startPerson)
  const [day, setDay] = useState<string>(days[0] || '')
  const [times, setTimes] = useState<string[] | null>(null)
  const [time, setTime] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ status: 'booked' | 'requested'; when: string; staff: string | null; confirmation: boolean } | null>(null)
  const today = istDate()

  const categories = useMemo(() => {
    const map = new Map<string, BookingPageView['services']>()
    for (const service of page.services) map.set(service.category, [...(map.get(service.category) || []), service])
    return [...map.entries()]
  }, [page.services])

  // People who can do every picked service
  const people = useMemo(() => page.staff.filter((m) => !m.service_ids.length || picked.every((id) => m.service_ids.includes(id))), [page.staff, picked])
  useEffect(() => {
    if (person && !people.some((m) => m.id === person)) setPerson(null)
  }, [people, person])

  const chosen = page.services.filter((s) => picked.includes(s.id))
  const minutes = chosen.reduce((sum, s) => sum + s.minutes, 0)
  const total = chosen.reduce((sum, s) => sum + s.price, 0)

  // Free times for the day, whenever the services, person or day change
  useEffect(() => {
    setTime('')
    if (!picked.length || !day) { setTimes(null); return }
    let cancelled = false
    setTimes(null)
    const params = new URLSearchParams({ services: picked.join(','), date: day, ...(person ? { staff: person } : {}) })
    fetch(`/api/public/booking/${page.slug}/times?${params}`)
      .then((res) => res.json())
      .then((data) => { if (!cancelled) setTimes(Array.isArray(data.times) ? data.times : []) })
      .catch(() => { if (!cancelled) setTimes([]) })
    return () => { cancelled = true }
  }, [picked, person, day, page.slug])

  function toggle(id: string) {
    setError('')
    setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : current.length >= MAX_SERVICES ? current : [...current, id]))
  }

  async function book() {
    setError('')
    if (!picked.length) return setError('Choose a service.')
    if (!time) return setError('Choose a time.')
    if (name.trim().length < 2) return setError('Please type your name.')
    setBusy(true)
    try {
      const res = await fetch(`/api/public/booking/${page.slug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_ids: picked, staff_id: person, date: day, time, name, phone, note }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data.taken) setTimes((current) => (current || []).filter((t) => t !== time))
        throw new Error(data.error || 'The booking could not be saved. Please try again.')
      }
      setDone({ status: data.status, when: data.when, staff: data.staff || null, confirmation: data.confirmation === true })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const header = (
    <header className={`${card} flex items-start gap-3`}>
      {page.logo
        ? <img src={page.logo} alt="" className="h-14 w-14 rounded-xl object-cover border border-[#eef1f6] shrink-0" />
        : <span className="h-14 w-14 rounded-xl bg-[#0E1B3D] text-white text-[22px] font-bold flex items-center justify-center shrink-0">{page.business.slice(0, 1).toUpperCase()}</span>}
      <div className="min-w-0">
        <h1 className="text-[20px] sm:text-[22px] font-extrabold leading-tight">{page.business}</h1>
        <p className="text-[13.5px] text-[#4a5672] mt-1 flex items-start gap-1.5"><Clock size={14} className="shrink-0 mt-0.5" /> {page.hours}</p>
        {page.address && <p className="text-[13.5px] text-[#4a5672] mt-0.5 flex items-start gap-1.5"><MapPin size={14} className="shrink-0 mt-0.5" /> <span className="min-w-0">{page.address}</span></p>}
        {page.phone && <a href={`tel:${page.phone.replace(/[^\d+]/g, '')}`} className="text-[13.5px] text-[#1D5BEA] font-semibold mt-0.5 inline-flex items-center gap-1.5"><Phone size={14} /> {page.phone}</a>}
      </div>
    </header>
  )

  if (done) {
    return (
      <div className="max-w-xl mx-auto px-4 py-6 space-y-3">
        {header}
        <section className={`${card} text-center py-8`}>
          <span className="mx-auto h-14 w-14 rounded-full bg-[#eef3fe] text-[#1D5BEA] flex items-center justify-center"><CalendarCheck size={28} /></span>
          <h2 className="mt-4 text-[22px] font-extrabold">{done.status === 'booked' ? 'You are booked!' : 'Request sent'}</h2>
          <p className="mt-2 text-[15px] text-[#4a5672]">
            {chosen.map((s) => s.name).join(', ')} · {done.when}{done.staff ? ` with ${done.staff}` : ''}
          </p>
          <p className="mt-3 text-[14px] text-[#4a5672] max-w-sm mx-auto">
            {done.status === 'booked'
              ? done.confirmation ? 'We have sent the confirmation to your WhatsApp.' : 'Please keep this page or take a screenshot.'
              : `${page.business} will confirm your time soon.`}
            {page.phone ? ` To change it, call ${page.phone}.` : ''}
          </p>
          <button type="button" onClick={() => { setDone(null); setPicked([]); setTime(''); setNote('') }} className="mt-6 h-11 px-5 rounded-xl border border-[#d5ddeb] text-[14px] font-semibold hover:border-[#1D5BEA] hover:text-[#1D5BEA] cursor-pointer">Book another visit</button>
        </section>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-6 space-y-3">
      {header}

      <Step number={1} title="Choose services" done={picked.length > 0}>
        <div className="space-y-4">
          {categories.map(([category, services]) => (
            <div key={category}>
              {categories.length > 1 && <h3 className="text-[12.5px] font-bold uppercase tracking-wide text-[#6B7894] mb-1.5">{category}</h3>}
              <ul className="space-y-1.5">
                {services.map((service) => {
                  const on = picked.includes(service.id)
                  return (
                    <li key={service.id}>
                      <button type="button" onClick={() => toggle(service.id)} aria-pressed={on}
                        className={`w-full text-left rounded-xl border px-3 py-2.5 flex items-center gap-3 transition-colors cursor-pointer ${on ? 'border-[#1D5BEA] bg-[#f4f7fe]' : 'border-[#e3e8f2] hover:border-[#d5ddeb]'}`}>
                        <span className={`h-5 w-5 shrink-0 rounded-md border flex items-center justify-center ${on ? 'bg-[#1D5BEA] border-[#1D5BEA] text-white' : 'border-[#d5ddeb]'}`}>{on && <Check size={14} />}</span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[14.5px] font-semibold truncate">{service.name}</span>
                          <span className="block text-[12.5px] text-[#6B7894]">{service.minutes} min</span>
                        </span>
                        {service.price > 0 && <span className="text-[14px] font-bold shrink-0">{rupees(service.price)}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
        {picked.length >= MAX_SERVICES && <p className="mt-2 text-[12.5px] text-[#6B7894]">Up to {MAX_SERVICES} services in one booking.</p>}
      </Step>

      {page.staff.length > 0 && picked.length > 0 && (
        <Step number={2} title="Who would you like?" done>
          <div className="flex flex-wrap gap-2">
            {[{ id: null as string | null, name: 'Anyone available' }, ...people].map((m) => (
              <button key={m.id || 'any'} type="button" onClick={() => setPerson(m.id)} aria-pressed={person === m.id}
                className={`h-10 px-3.5 rounded-full border text-[14px] font-semibold inline-flex items-center gap-1.5 cursor-pointer ${person === m.id ? 'border-[#1D5BEA] bg-[#1D5BEA] text-white' : 'border-[#d5ddeb] hover:border-[#1D5BEA]'}`}>
                <User size={14} /> {m.name}
              </button>
            ))}
          </div>
        </Step>
      )}

      {picked.length > 0 && (
        <Step number={page.staff.length ? 3 : 2} title="Pick a day and time" done={Boolean(time)}>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:thin]">
            {days.map((d) => (
              <button key={d} type="button" onClick={() => setDay(d)} aria-pressed={day === d}
                className={`shrink-0 h-12 min-w-[84px] px-3 rounded-xl border text-[13px] font-semibold cursor-pointer ${day === d ? 'border-[#1D5BEA] bg-[#1D5BEA] text-white' : 'border-[#d5ddeb] bg-white hover:border-[#1D5BEA]'}`}>
                {formatIstDay(d, today)}
              </button>
            ))}
          </div>
          <div className="mt-3">
            {times === null ? (
              <p className="text-[14px] text-[#6B7894] flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Finding free times…</p>
            ) : times.length === 0 ? (
              <p className="text-[14px] text-[#4a5672]">No free times on this day. Please try another day.</p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {times.map((t) => (
                  <button key={t} type="button" onClick={() => setTime(t)} aria-pressed={time === t}
                    className={`h-10 rounded-lg border text-[14px] font-semibold cursor-pointer ${time === t ? 'border-[#1D5BEA] bg-[#1D5BEA] text-white' : 'border-[#d5ddeb] hover:border-[#1D5BEA]'}`}>
                    {clock(t)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </Step>
      )}

      {time && (
        <Step number={page.staff.length ? 4 : 3} title="Your details">
          <div className="space-y-3">
            <label className="block">
              <span className="block text-[13px] font-semibold text-[#4a5672] mb-1">Your name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="w-full h-11 px-3 rounded-xl border border-[#d5ddeb] text-[15px] outline-none focus:border-[#1D5BEA]" />
            </label>
            <div>
              <span className="block text-[13px] font-semibold text-[#4a5672] mb-1">WhatsApp number</span>
              <PhoneField value={phone} onChange={setPhone} inputClassName="h-11 px-3 rounded-xl border border-[#d5ddeb] text-[15px] outline-none focus:border-[#1D5BEA]" />
            </div>
            <label className="block">
              <span className="block text-[13px] font-semibold text-[#4a5672] mb-1">Anything we should know? (optional)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="w-full h-11 px-3 rounded-xl border border-[#d5ddeb] text-[15px] outline-none focus:border-[#1D5BEA]" />
            </label>
          </div>
        </Step>
      )}

      {picked.length > 0 && (
        <section className={`${card} sticky bottom-3 shadow-sm`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[14px] font-bold truncate">{chosen.map((s) => s.name).join(', ')}</p>
              <p className="text-[13px] text-[#6B7894]">{minutes} min{total > 0 ? ` · ${rupees(total)}` : ''}{time ? ` · ${formatIstDay(day, today)}, ${clock(time)}` : ''}</p>
            </div>
            <button type="button" onClick={book} disabled={busy || !time}
              className="shrink-0 h-11 px-5 rounded-xl bg-[#1D5BEA] hover:bg-[#174bc4] text-white text-[15px] font-bold inline-flex items-center gap-2 cursor-pointer disabled:opacity-50">
              {busy && <Loader2 size={16} className="animate-spin" />} {page.approval ? 'Request' : 'Book'}
            </button>
          </div>
          {error && <p role="alert" className="mt-2 text-[13.5px] font-semibold text-[#b91c1c]">{error}</p>}
          {page.approval && time && <p className="mt-1.5 text-[12.5px] text-[#6B7894]">{page.business} confirms each booking.</p>}
        </section>
      )}
    </div>
  )
}
