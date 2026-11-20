'use client'

/**
 * The booking form: services, who, a free day and time (live from the server), the customer's details, and how
 * they pay (online in full or an advance, or at the shop, as the business allows). Used on the booking page
 * (/b/<slug>) and inside the business website (embedded). The website's Book buttons pick a service or a person
 * here through a 'wama-book' window event. Online payment opens Razorpay's window, or goes to Stripe's page and
 * comes back with ?booked=<id>&session=<id>.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarCheck, Check, Clock, CreditCard, Loader2, MapPin, Phone, Store, User } from 'lucide-react'
import { PhoneField } from '@/components/phone-field'
import type { BookingPageView } from '@/lib/salon/booking-page'
import { bookingPayOptions } from '@/lib/salon/booking-pay'
import { formatIstDay, istDate } from '@/lib/salon/spoken'

const rupees = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const MAX_SERVICES = 5
/** The website's Book buttons send this (components/salon-site/book-button.tsx). */
const BOOK_EVENT = 'wama-book'

/** "16:30" → "4:30 pm" */
function clock(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const hour = h % 12 || 12
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`
}

/** Razorpay's payment window, loaded only when someone pays online. */
function loadRazorpay(): Promise<any> {
  const w = window as any
  if (w.Razorpay) return Promise.resolve(w.Razorpay)
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.onload = () => (w.Razorpay ? resolve(w.Razorpay) : reject(new Error('Online payment could not be opened.')))
    script.onerror = () => reject(new Error('Online payment could not be opened. Check your internet and try again.'))
    document.body.appendChild(script)
  })
}

interface Done { status: string; when: string; staff: string | null; confirmation: boolean; services: string[]; paid: number }
interface Unpaid { bookingId: string; ref: string; razorpay?: any; stripeUrl?: string; services: string[]; when: string; amount: number }

function Step({ number, title, children, done }: { number: number; title: string; children: React.ReactNode; done?: boolean }) {
  return (
    <section className="bg-white rounded-2xl border border-[#e3e8f2] p-4 sm:p-5">
      <h2 className="flex items-center gap-2.5 text-[16px] font-bold">
        <span className={`h-7 w-7 shrink-0 rounded-full text-[13px] font-bold flex items-center justify-center ${done ? 'bg-[var(--bk)] text-white' : 'bg-[#eef1f6] text-[#4a5672]'}`}>{done ? <Check size={15} /> : number}</span>
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

export function BookingWizard({ page, days, startService, startPerson, embedded = false, colour }: {
  page: BookingPageView; days: string[]; startService: string | null; startPerson: string | null
  /** Inside the business website: no business header, the site's colour */
  embedded?: boolean; colour?: string
}) {
  const [picked, setPicked] = useState<string[]>(startService ? [startService] : [])
  const [person, setPerson] = useState<string | null>(startPerson)
  const [day, setDay] = useState<string>(days[0] || '')
  const [times, setTimes] = useState<string[] | null>(null)
  const [time, setTime] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [payChoice, setPayChoice] = useState<'online' | 'shop'>(page.pay.mode === 'shop' ? 'shop' : 'online')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Done | null>(null)
  const [unpaid, setUnpaid] = useState<Unpaid | null>(null)
  const top = useRef<HTMLDivElement>(null)
  const today = istDate()
  const unpaidKey = `booking-unpaid:${page.slug}`

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
  const options = bookingPayOptions({ mode: page.pay.mode, advance: page.pay.advance }, page.pay.online, total)
  const payOnline = options.online && (payChoice === 'online' || !options.atShop)

  const scrollTop = () => {
    if (embedded) top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    else window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // The website's Book buttons: pick that service or person here
  useEffect(() => {
    const onBook = (event: Event) => {
      const detail = (event as CustomEvent).detail || {}
      setDone(null)
      if (detail.service && page.services.some((s) => s.id === detail.service)) setPicked((current) => (current.includes(detail.service) ? current : [...current, detail.service].slice(-MAX_SERVICES)))
      if (detail.person && page.staff.some((m) => m.id === detail.person)) setPerson(detail.person)
      top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    window.addEventListener(BOOK_EVENT, onBook)
    return () => window.removeEventListener(BOOK_EVENT, onBook)
  }, [page.services, page.staff])

  // Back from Stripe (?booked=&session=) or from leaving its page (?unpaid=): check the payment
  useEffect(() => {
    const url = new URL(window.location.href)
    const booked = url.searchParams.get('booked')
    const session = url.searchParams.get('session')
    const left = url.searchParams.get('unpaid')
    if (!booked && !left) return
    let saved: Unpaid | null = null
    try { saved = JSON.parse(sessionStorage.getItem(unpaidKey) || 'null') } catch {}
    for (const key of ['booked', 'session', 'unpaid']) url.searchParams.delete(key)
    window.history.replaceState(null, '', url.pathname + (url.search || '') + url.hash)
    const bookingId = booked || left || ''
    if (!saved || saved.bookingId !== bookingId) return
    if (left) { setUnpaid(saved); setTimeout(scrollTop, 50); return }
    setBusy(true)
    fetch(`/api/public/booking/${page.slug}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId, sessionId: session || saved.ref, action: 'check' }) })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ok && data.paid) {
          try { sessionStorage.removeItem(unpaidKey) } catch {}
          setDone({ status: data.status, when: data.when, staff: data.staff, confirmation: data.status === 'booked', services: data.services || saved!.services, paid: data.paidAmount || saved!.amount })
        } else setUnpaid(saved)
        setTimeout(scrollTop, 50)
      })
      .catch(() => setUnpaid(saved))
      .finally(() => setBusy(false))
    // Once, on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const confirmPaid = async (pending: Unpaid, extra: Record<string, unknown>) => {
    const res = await fetch(`/api/public/booking/${page.slug}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId: pending.bookingId, ...(pending.razorpay ? { razorpayOrderId: pending.ref } : { sessionId: pending.ref }), ...extra }) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'The payment could not be checked. If money was taken, the business will see it shortly.')
    return data
  }

  /** Open the payment for a booking waiting for it. Razorpay: its window here; Stripe: its own page. */
  async function pay(pending: Unpaid) {
    setError('')
    if (pending.stripeUrl) {
      try { sessionStorage.setItem(unpaidKey, JSON.stringify(pending)) } catch {}
      window.location.href = pending.stripeUrl
      return
    }
    const Razorpay = await loadRazorpay()
    await new Promise<void>((resolve) => {
      const checkout = new Razorpay({
        key: pending.razorpay.keyId, order_id: pending.razorpay.orderId, amount: pending.razorpay.amount, currency: pending.razorpay.currency,
        name: pending.razorpay.name, description: pending.razorpay.description,
        prefill: { name: pending.razorpay.customer?.name, contact: pending.razorpay.customer?.contact },
        theme: { color: colour || '#1D5BEA' },
        handler: async (response: any) => {
          try {
            const data = await confirmPaid(pending, { paymentId: response.razorpay_payment_id, signature: response.razorpay_signature })
            if (data.paid) {
              setUnpaid(null)
              setDone({ status: data.status, when: data.when, staff: data.staff, confirmation: data.status === 'booked', services: data.services || pending.services, paid: data.paidAmount || pending.amount })
              scrollTop()
            } else setUnpaid(pending)
          } catch (err: any) {
            setUnpaid(pending)
            setError(err.message)
          }
          resolve()
        },
        modal: { ondismiss: () => { setUnpaid(pending); resolve() } },
      })
      checkout.open()
    })
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
        body: JSON.stringify({ service_ids: picked, staff_id: person, date: day, time, name, phone, note, pay: payOnline ? 'online' : 'shop', returnPath: window.location.pathname }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data.taken) setTimes((current) => (current || []).filter((t) => t !== time))
        throw new Error(data.error || 'The booking could not be saved. Please try again.')
      }
      if (data.status === 'awaiting_payment') {
        const pending: Unpaid = {
          bookingId: data.bookingId, ref: data.razorpay?.orderId || data.stripe?.sessionId, razorpay: data.razorpay, stripeUrl: data.stripe?.url,
          services: chosen.map((s) => s.name), when: data.when, amount: Number(data.amount) || 0,
        }
        await pay(pending)
        return
      }
      setDone({ status: data.status, when: data.when, staff: data.staff || null, confirmation: data.confirmation === true, services: chosen.map((s) => s.name), paid: 0 })
      scrollTop()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function atShopInstead() {
    if (!unpaid) return
    setBusy(true)
    setError('')
    try {
      const data = await confirmPaid(unpaid, { action: 'shop' })
      try { sessionStorage.removeItem(unpaidKey) } catch {}
      setDone({ status: data.status, when: data.when, staff: data.staff, confirmation: data.status === 'booked', services: data.services || unpaid.services, paid: 0 })
      setUnpaid(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function checkAgain() {
    if (!unpaid) return
    setBusy(true)
    setError('')
    try {
      const data = await confirmPaid(unpaid, { action: 'check' })
      if (data.paid) {
        try { sessionStorage.removeItem(unpaidKey) } catch {}
        setDone({ status: data.status, when: data.when, staff: data.staff, confirmation: data.status === 'booked', services: data.services || unpaid.services, paid: data.paidAmount || unpaid.amount })
        setUnpaid(null)
      } else setError('We could not see a payment yet. Try paying again, or wait a minute and check again.')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const header = embedded ? null : (
    <header className="bg-white rounded-2xl border border-[#e3e8f2] p-4 sm:p-5 flex items-start gap-3">
      {page.logo
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={page.logo} alt="" className="h-14 w-14 rounded-xl object-cover border border-[#eef1f6] shrink-0" />
        : <span className="h-14 w-14 rounded-xl bg-[#0E1B3D] text-white text-[22px] font-bold flex items-center justify-center shrink-0">{page.business.slice(0, 1).toUpperCase()}</span>}
      <div className="min-w-0">
        <h1 className="text-[20px] sm:text-[22px] font-extrabold leading-tight">{page.business}</h1>
        <p className="text-[13.5px] text-[#4a5672] mt-1 flex items-start gap-1.5"><Clock size={14} className="shrink-0 mt-0.5" /> {page.hours}</p>
        {page.address && <p className="text-[13.5px] text-[#4a5672] mt-0.5 flex items-start gap-1.5"><MapPin size={14} className="shrink-0 mt-0.5" /> <span className="min-w-0">{page.address}</span></p>}
        {page.phone && <a href={`tel:${page.phone.replace(/[^\d+]/g, '')}`} className="text-[13.5px] text-[var(--bk)] font-semibold mt-0.5 inline-flex items-center gap-1.5"><Phone size={14} /> {page.phone}</a>}
      </div>
    </header>
  )
  const shell = (children: React.ReactNode) => (
    <div ref={top} style={{ ['--bk' as any]: colour || '#1D5BEA' }} className={`${embedded ? '' : 'max-w-xl mx-auto px-4 py-6'} space-y-3 scroll-mt-20 text-[#0E1B3D]`}>
      {header}
      {children}
    </div>
  )

  if (done) {
    return shell(
      <section className="bg-white rounded-2xl border border-[#e3e8f2] p-4 sm:p-5 text-center py-8">
        <span className="mx-auto h-14 w-14 rounded-full bg-[#eef3fe] text-[var(--bk)] flex items-center justify-center"><CalendarCheck size={28} /></span>
        <h2 className="mt-4 text-[22px] font-extrabold">{done.status === 'booked' ? 'You are booked!' : 'Request sent'}</h2>
        <p className="mt-2 text-[15px] text-[#4a5672]">{done.services.join(', ')} · {done.when}{done.staff ? ` with ${done.staff}` : ''}</p>
        {done.paid > 0 && <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#eef3fe] px-3 py-1 text-[13.5px] font-bold text-[var(--bk)]"><Check size={14} /> Paid {rupees(done.paid)} online</p>}
        <p className="mt-3 text-[14px] text-[#4a5672] max-w-sm mx-auto">
          {done.status === 'booked'
            ? done.confirmation ? 'We have sent the confirmation to your WhatsApp.' : 'Please keep this page or take a screenshot.'
            : `${page.business} will confirm your time soon.`}
          {page.phone ? ` To change it, call ${page.phone}.` : ''}
        </p>
        <button type="button" onClick={() => { setDone(null); setPicked([]); setTime(''); setNote('') }} className="mt-6 h-11 px-5 rounded-xl border border-[#d5ddeb] text-[14px] font-semibold hover:border-[var(--bk)] hover:text-[var(--bk)] cursor-pointer">Book another visit</button>
      </section>,
    )
  }

  if (unpaid) {
    return shell(
      <section className="bg-white rounded-2xl border border-[#e3e8f2] p-4 sm:p-5 text-center py-7">
        <span className="mx-auto h-14 w-14 rounded-full bg-[#fdf0f0] text-[#b91c1c] flex items-center justify-center"><CreditCard size={26} /></span>
        <h2 className="mt-4 text-[21px] font-extrabold">Payment not finished</h2>
        <p className="mt-2 text-[14.5px] text-[#4a5672]">{unpaid.services.join(', ')} · {unpaid.when}</p>
        <p className="mt-2 text-[14px] text-[#4a5672] max-w-sm mx-auto">We are keeping this time for you for a short while. Pay {rupees(unpaid.amount)} to confirm it.</p>
        <div className="mt-5 flex flex-col gap-2 max-w-xs mx-auto">
          <button type="button" disabled={busy} onClick={() => pay(unpaid).catch((err) => setError(err.message))} className="h-12 rounded-xl bg-[var(--bk)] hover:opacity-90 text-white text-[15px] font-bold cursor-pointer disabled:opacity-60">Try paying again</button>
          {page.pay.mode !== 'online'
            ? <button type="button" disabled={busy} onClick={atShopInstead} className="h-11 rounded-xl border border-[#d5ddeb] text-[14px] font-semibold hover:border-[var(--bk)] cursor-pointer disabled:opacity-60">Pay at the shop instead</button>
            : null}
          <button type="button" disabled={busy} onClick={checkAgain} className="h-10 text-[13.5px] font-semibold text-[var(--bk)] cursor-pointer disabled:opacity-60">{busy ? 'Checking…' : 'I have paid: check again'}</button>
        </div>
        {error && <p role="alert" className="mt-3 text-[13.5px] font-semibold text-[#b91c1c]">{error}</p>}
      </section>,
    )
  }

  const stepNo = (n: number) => (page.staff.length ? n : n - 1)
  return shell(
    <>
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
                        className={`w-full text-left rounded-xl border px-3 py-2.5 flex items-center gap-3 transition-colors cursor-pointer ${on ? 'border-[var(--bk)] bg-[#f4f7fe]' : 'border-[#e3e8f2] hover:border-[#d5ddeb]'}`}>
                        <span className={`h-5 w-5 shrink-0 rounded-md border flex items-center justify-center ${on ? 'bg-[var(--bk)] border-[var(--bk)] text-white' : 'border-[#d5ddeb]'}`}>{on && <Check size={14} />}</span>
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
                className={`h-10 px-3.5 rounded-full border text-[14px] font-semibold inline-flex items-center gap-1.5 cursor-pointer ${person === m.id ? 'border-[var(--bk)] bg-[var(--bk)] text-white' : 'border-[#d5ddeb] bg-white hover:border-[var(--bk)]'}`}>
                <User size={14} /> {m.name}
              </button>
            ))}
          </div>
        </Step>
      )}

      {picked.length > 0 && (
        <Step number={stepNo(3)} title="Pick a day and time" done={Boolean(time)}>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:thin]">
            {days.map((d) => (
              <button key={d} type="button" onClick={() => setDay(d)} aria-pressed={day === d}
                className={`shrink-0 h-12 min-w-[84px] px-3 rounded-xl border text-[13px] font-semibold cursor-pointer ${day === d ? 'border-[var(--bk)] bg-[var(--bk)] text-white' : 'border-[#d5ddeb] bg-white hover:border-[var(--bk)]'}`}>
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
                    className={`h-10 rounded-lg border text-[14px] font-semibold cursor-pointer ${time === t ? 'border-[var(--bk)] bg-[var(--bk)] text-white' : 'border-[#d5ddeb] bg-white hover:border-[var(--bk)]'}`}>
                    {clock(t)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </Step>
      )}

      {time && (
        <Step number={stepNo(4)} title="Your details">
          <div className="space-y-3">
            <label className="block">
              <span className="block text-[13px] font-semibold text-[#4a5672] mb-1">Your name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="w-full h-11 px-3 rounded-xl border border-[#d5ddeb] text-[15px] outline-none focus:border-[var(--bk)]" />
            </label>
            <div>
              <span className="block text-[13px] font-semibold text-[#4a5672] mb-1">WhatsApp number</span>
              <PhoneField value={phone} onChange={setPhone} inputClassName="h-11 px-3 rounded-xl border border-[#d5ddeb] text-[15px] outline-none focus:border-[var(--bk)]" />
            </div>
            <label className="block">
              <span className="block text-[13px] font-semibold text-[#4a5672] mb-1">Anything we should know? (optional)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="w-full h-11 px-3 rounded-xl border border-[#d5ddeb] text-[15px] outline-none focus:border-[var(--bk)]" />
            </label>
          </div>
        </Step>
      )}

      {time && options.online && (
        <Step number={stepNo(5)} title="How would you like to pay?" done>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="How would you like to pay?">
            <button type="button" role="radio" aria-checked={payOnline} onClick={() => setPayChoice('online')}
              className={`text-left rounded-xl border-2 p-3 flex gap-3 cursor-pointer ${payOnline ? 'border-[var(--bk)] bg-[#f4f7fe]' : 'border-[#e3e8f2] hover:border-[#d5ddeb]'}`}>
              <CreditCard size={20} className="shrink-0 mt-0.5 text-[var(--bk)]" />
              <span className="min-w-0">
                <span className="block text-[14.5px] font-bold">{options.full ? `Pay ${rupees(options.amount)} now` : `Pay ${rupees(options.amount)} now to book`}</span>
                <span className="block text-[12.5px] text-[#6B7894]">{options.full ? page.pay.methods : `${rupees(Math.round((total - options.amount) * 100) / 100)} at the shop · ${page.pay.methods}`}</span>
              </span>
            </button>
            {options.atShop && (
              <button type="button" role="radio" aria-checked={!payOnline} onClick={() => setPayChoice('shop')}
                className={`text-left rounded-xl border-2 p-3 flex gap-3 cursor-pointer ${!payOnline ? 'border-[var(--bk)] bg-[#f4f7fe]' : 'border-[#e3e8f2] hover:border-[#d5ddeb]'}`}>
                <Store size={20} className="shrink-0 mt-0.5 text-[#4a5672]" />
                <span className="min-w-0">
                  <span className="block text-[14.5px] font-bold">Pay at the shop</span>
                  <span className="block text-[12.5px] text-[#6B7894]">Cash, UPI or card after your visit</span>
                </span>
              </button>
            )}
          </div>
          {!options.atShop && <p className="mt-2 text-[12.5px] text-[#6B7894]">{page.business} asks for {options.full ? 'payment' : 'an advance'} online to keep your time.</p>}
        </Step>
      )}

      {picked.length > 0 && (
        <section className={`bg-white rounded-2xl border border-[#e3e8f2] p-4 sm:p-5 sticky ${embedded ? 'bottom-[76px] md:bottom-3' : 'bottom-3'} shadow-sm z-10`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[14px] font-bold truncate">{chosen.map((s) => s.name).join(', ')}</p>
              <p className="text-[13px] text-[#6B7894]">{minutes} min{total > 0 ? ` · ${rupees(total)}` : ''}{time ? ` · ${formatIstDay(day, today)}, ${clock(time)}` : ''}</p>
            </div>
            <button type="button" onClick={book} disabled={busy || !time}
              className="shrink-0 h-11 px-5 rounded-xl bg-[var(--bk)] hover:opacity-90 text-white text-[15px] font-bold inline-flex items-center gap-2 cursor-pointer disabled:opacity-50">
              {busy && <Loader2 size={16} className="animate-spin" />} {time && payOnline ? `Pay ${rupees(options.amount)}` : page.approval ? 'Request' : 'Book'}
            </button>
          </div>
          {error && <p role="alert" className="mt-2 text-[13.5px] font-semibold text-[#b91c1c]">{error}</p>}
          {page.approval && time && !payOnline && <p className="mt-1.5 text-[12.5px] text-[#6B7894]">{page.business} confirms each booking.</p>}
        </section>
      )}
    </>,
  )
}
