'use client'

/**
 * The AI chat on a business's websites: the online store ('store') and the Front Desk website ('desk'). One design:
 * an "Ask us" button, then a chat with quick actions, answers with real product / service cards, order and booking
 * cards straight from the data, small forms for "track my order" / "my booking", follow-up chips, and the business's
 * WhatsApp or phone when a person is needed. The chat is kept for the browser tab (sessionStorage). Colours come from
 * the page's own --c.
 */

import { useEffect, useRef, useState } from 'react'
import { CalendarCheck, Check, Clock, IndianRupee, Loader2, MapPin, MessageCircle, Package, Phone, RotateCcw, Send, Sparkles, Tag, Truck, X } from 'lucide-react'

interface ProductCard { id: string; title: string; price: number; mrp: number | null; image: string; inStock: boolean; hasOptions: boolean }
interface ServiceCard { id: string; name: string; category: string; minutes: number; price: number }
interface OrderCard {
  number: string; status: string; tone?: string; placedAt: string | null; payment: string; total: number; currency: string
  items: { title: string; quantity: number }[]; tracking: { number: string; carrier: string } | null
  timeline: { key: string; label: string; state: string; at: string | null }[]
}
interface BookingCard { id: string; when: string; services: string[]; staff: string | null; status: string; paid: string }
interface Turn {
  role: 'user' | 'assistant'
  content: string
  products?: ProductCard[]
  services?: ServiceCard[]
  orders?: OrderCard[]
  bookings?: BookingCard[]
  buttons?: { title: string; question: string }[]
  attachments?: { type: string; url: string; name?: string }[]
  form?: 'order' | 'booking'
  handoff?: boolean
  error?: boolean
}

const QUICK = {
  store: [
    { icon: Package, label: 'Track my order', ask: 'Where is my order?' },
    { icon: Truck, label: 'Delivery charges', ask: 'How much is delivery and how long does it take?' },
    { icon: Tag, label: 'Offers today', ask: 'What offers do you have today?' },
    { icon: RotateCcw, label: 'Returns', ask: 'What is your return policy?' },
  ],
  desk: [
    { icon: IndianRupee, label: 'Services & prices', ask: 'What services do you offer and what are the prices?' },
    { icon: Clock, label: 'Timings', ask: 'What are your timings? Are you open now?' },
    { icon: CalendarCheck, label: 'My booking', ask: 'I want to check my booking' },
    { icon: MapPin, label: 'Location', ask: 'Where are you located?' },
  ],
}

const inr = (n: number) => `₹${(Math.round(n * 100) / 100).toLocaleString('en-IN')}`
const duration = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`)

/** Words with *bold*, • lists and https links, written safely (no HTML from the server). */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => (
        <span key={i} className={`block ${line.trim().startsWith('•') ? 'pl-3 -indent-3' : ''} ${i > 0 && !line.trim() ? 'h-2' : ''}`}>
          {line.split(/(\*[^*\n]{1,120}\*|https:\/\/[^\s)]+)/g).map((part, j) => {
            if (/^\*[^*]+\*$/.test(part)) return <b key={j}>{part.slice(1, -1)}</b>
            if (/^https:\/\//.test(part)) return <a key={j} href={part} target="_blank" rel="noreferrer" className="underline break-all">{part.replace(/^https:\/\/(www\.)?/, '').slice(0, 40)}</a>
            return <span key={j}>{part}</span>
          })}
        </span>
      ))}
    </>
  )
}

const chipTone = (status: string) => /cancel|not|waiting for (your )?payment/i.test(status) ? 'bg-[#fdf0f0] text-[#b91c1c]' : /deliver|picked up|confirmed|checked in/i.test(status) ? 'bg-[#eef3fe] text-[#1D5BEA]' : 'bg-[#eef1f6] text-[#4a5672]'

function OrderView({ order, money }: { order: OrderCard; money: (n: number) => string }) {
  return (
    <div className="mt-2 rounded-xl bg-white border border-[#e3e8f2] p-3 text-[13px] text-[#0E1B3D]">
      <div className="flex items-center gap-2">
        <Package size={16} className="shrink-0 text-[var(--c)]" />
        <span className="font-bold truncate flex-1">{order.number}</span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-bold ${chipTone(order.status)}`}>{order.status}</span>
      </div>
      {order.timeline.length > 0 && (
        <ol className="mt-3 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${order.timeline.length}, minmax(0, 1fr))` }}>
          {order.timeline.map((step) => (
            <li key={step.key} className="min-w-0">
              <span className={`block h-1.5 rounded-full ${step.state === 'done' || step.state === 'now' ? 'bg-[var(--c)]' : step.state === 'stopped' ? 'bg-[#b91c1c]' : 'bg-[#e3e8f2]'}`} />
              <span className={`mt-1 block text-[10.5px] leading-tight ${step.state === 'now' ? 'font-bold text-[#0E1B3D]' : 'text-[#6B7894]'}`}>{step.label}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-2.5 text-[#4a5672]">{order.items.slice(0, 3).map((i) => `${i.quantity} × ${i.title}`).join(', ')}{order.items.length > 3 ? ` +${order.items.length - 3} more` : ''}</p>
      <p className="mt-1 flex justify-between gap-2"><span className="text-[#6B7894]">{order.payment}</span><b>{money(order.total)}</b></p>
      {order.tracking && <p className="mt-1 text-[#4a5672]">{order.tracking.carrier || 'Courier'} · {order.tracking.number}</p>}
    </div>
  )
}

function BookingView({ booking }: { booking: BookingCard }) {
  return (
    <div className="mt-2 rounded-xl bg-white border border-[#e3e8f2] p-3 text-[13px] text-[#0E1B3D]">
      <div className="flex items-start gap-2">
        <CalendarCheck size={16} className="shrink-0 mt-0.5 text-[var(--c)]" />
        <div className="min-w-0 flex-1">
          <p className="font-bold">{booking.when}</p>
          <p className="text-[#4a5672]">{booking.services.join(', ')}{booking.staff ? ` · with ${booking.staff}` : ''}</p>
          {booking.paid && <p className="text-[var(--c)] font-semibold">{booking.paid}</p>}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-bold ${chipTone(booking.status)}`}>{booking.status.replace('Waiting for the shop to confirm', 'Not confirmed yet')}</span>
      </div>
    </div>
  )
}

/** The small form under "send your order number and phone" / "phone and first name". */
function LookupForm({ kind, onSend, busy }: { kind: 'order' | 'booking'; onSend: (text: string) => void; busy: boolean }) {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const field = 'w-full min-w-0 h-10 px-3 rounded-lg border border-[#d5ddeb] bg-white text-[14px] text-[#0E1B3D] outline-none focus:border-[var(--c)]'
  const ready = kind === 'order' ? a.trim().length >= 6 && b.replace(/\D/g, '').length >= 10 : a.replace(/\D/g, '').length >= 10 && b.trim().length >= 2
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ready) onSend(kind === 'order' ? `Order ${a.trim().toUpperCase()}, phone ${b.trim()}` : `Phone ${a.trim()}, name ${b.trim()}`) }}
      className="mt-2 rounded-xl bg-white border border-[#e3e8f2] p-3 space-y-2">
      {kind === 'order' ? (
        <>
          <input value={a} onChange={(e) => setA(e.target.value)} placeholder="Order number, like ORD-261118-ABCD" aria-label="Order number" autoCapitalize="characters" className={field} />
          <input value={b} onChange={(e) => setB(e.target.value)} placeholder="Phone number you ordered with" aria-label="Phone number" inputMode="tel" autoComplete="tel" className={field} />
        </>
      ) : (
        <>
          <input value={a} onChange={(e) => setA(e.target.value)} placeholder="Phone number you booked with" aria-label="Phone number" inputMode="tel" autoComplete="tel" className={field} />
          <input value={b} onChange={(e) => setB(e.target.value)} placeholder="Your first name" aria-label="First name" autoComplete="given-name" className={field} />
        </>
      )}
      <button type="submit" disabled={!ready || busy} className="w-full h-10 rounded-lg bg-[var(--c)] text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50">{kind === 'order' ? 'Check my order' : 'Check my booking'}</button>
    </form>
  )
}

export function SiteChat({ kind, endpoint, storageKey, name, logo, whatsapp, phone, raised = false, money = inr, productHref, onAdd, authHeaders }: {
  kind: 'store' | 'desk'
  endpoint: string
  storageKey: string
  name: string
  logo?: string | null
  whatsapp?: string | null
  phone?: string | null
  /** Above the page's phone bottom bar */
  raised?: boolean
  money?: (n: number) => string
  productHref?: (id: string) => string
  onAdd?: (id: string) => void
  /** The signed-in shopper's token (their own orders) */
  authHeaders?: () => Record<string, string>
}) {
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const waDigits = String(whatsapp || '').replace(/\D/g, '')
  const callDigits = String(phone || '').replace(/[^\d+]/g, '')

  useEffect(() => {
    try { setTurns(JSON.parse(sessionStorage.getItem(storageKey) || '[]').slice(-30)) } catch {}
  }, [storageKey])
  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(turns.slice(-30))) } catch {}
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' })
  }, [turns, storageKey, busy])
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 50) }, [open])

  async function ask(question: string) {
    const q = question.replace(/\s+/g, ' ').trim().slice(0, 500)
    if (!q || busy) return
    setText('')
    const history = turns.filter((t) => !t.error).map((t) => ({ role: t.role, content: t.content })).slice(-8)
    setTurns((t) => [...t, { role: 'user', content: q }])
    setBusy(true)
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authHeaders?.() || {}) }, body: JSON.stringify({ message: q, history }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The chat could not answer just now.')
      setTurns((t) => [...t, {
        role: 'assistant', content: String(data.reply || ''), products: data.products, services: data.services, orders: data.orders, bookings: data.bookings,
        buttons: data.buttons, attachments: data.attachments, form: data.form, handoff: data.handoff,
      }])
    } catch (err: any) {
      setTurns((t) => [...t, { role: 'assistant', content: err.message, error: true, handoff: true }])
    } finally {
      setBusy(false)
    }
  }

  /** Book a service on the website: the booking form on the page picks it (BookingWizard listens). */
  function book(serviceId: string) {
    window.dispatchEvent(new CustomEvent('wama-book', { detail: { service: serviceId } }))
    document.getElementById('book')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (window.matchMedia('(max-width: 639px)').matches) setOpen(false)
  }

  const lastAsked = [...turns].reverse().find((t) => t.role === 'user')?.content || ''
  const wa = (msg: string) => `https://wa.me/${waDigits}?text=${encodeURIComponent(msg)}`
  const quick = QUICK[kind]
  const helloLine = kind === 'store' ? 'Ask me about products, prices, delivery, offers or your order.' : 'Ask me about services, prices, timings, or your booking.'

  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} aria-label={`Chat with ${name}`}
          className={`fixed right-4 z-30 h-12 pl-4 pr-5 rounded-full bg-[#0E1B3D] text-white shadow-lg inline-flex items-center gap-2 font-bold text-[14px] cursor-pointer hover:bg-[#1b2a52] ${raised ? 'bottom-[76px] md:bottom-6' : 'bottom-[76px] sm:bottom-6'}`}>
          <Sparkles size={18} /> Ask us
        </button>
      )}
      {open && (
        <div role="dialog" aria-label={`Chat with ${name}`}
          className="fixed z-50 inset-0 h-[100dvh] sm:h-[640px] sm:inset-auto sm:right-4 sm:bottom-4 sm:w-[400px] sm:max-h-[calc(100vh-2rem)] bg-white sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden sm:border sm:border-[#e3e8f2]">
          {/* Header */}
          <div className="px-3 py-2.5 flex items-center gap-2.5 bg-[var(--c)] text-white shrink-0">
            {logo
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={logo} alt="" className="h-10 w-10 rounded-full bg-white object-contain p-0.5 shrink-0" />
              : <span className="h-10 w-10 rounded-full bg-white/15 flex items-center justify-center text-[16px] font-extrabold shrink-0">{name.slice(0, 1).toUpperCase()}</span>}
            <div className="min-w-0 flex-1">
              <p className="font-extrabold text-[15.5px] leading-tight truncate">{name}</p>
              <p className="text-[12px] text-white/80 flex items-center gap-1"><Sparkles size={12} /> AI assistant · replies in seconds</p>
            </div>
            {turns.length > 0 && <button type="button" aria-label="Start a new chat" title="New chat" onClick={() => { setTurns([]); setText('') }} className="h-10 w-10 rounded-full hover:bg-white/10 flex items-center justify-center cursor-pointer"><RotateCcw size={17} /></button>}
            <button type="button" aria-label="Close chat" onClick={() => setOpen(false)} className="h-10 w-10 rounded-full hover:bg-white/10 flex items-center justify-center cursor-pointer"><X size={20} /></button>
          </div>

          {/* Messages */}
          <div ref={list} className="flex-1 overflow-y-auto overscroll-contain bg-[#f4f6fa] px-3 py-4 space-y-3" aria-live="polite">
            <div className="max-w-[88%] rounded-2xl rounded-tl-md bg-white px-3.5 py-2.5 text-[14px] text-[#0E1B3D] shadow-sm">
              <p className="font-bold">Hi! Welcome to {name}.</p>
              <p className="mt-0.5 text-[#4a5672]">{helloLine}</p>
            </div>
            {turns.length === 0 && (
              <div className="grid grid-cols-2 gap-2">
                {quick.map(({ icon: Icon, label, ask: q }) => (
                  <button key={label} type="button" onClick={() => ask(q)} className="text-left rounded-xl border border-[#e3e8f2] bg-white p-3 flex flex-col gap-1.5 hover:border-[var(--c)] cursor-pointer">
                    <Icon size={18} className="text-[var(--c)]" />
                    <span className="text-[13px] font-bold text-[#0E1B3D] leading-tight">{label}</span>
                  </button>
                ))}
              </div>
            )}

            {turns.map((t, i) => {
              const last = i === turns.length - 1
              if (t.role === 'user') {
                return <div key={i} className="flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-tr-md bg-[var(--c)] text-white px-3.5 py-2.5 text-[14px] break-words shadow-sm">{t.content}</div></div>
              }
              return (
                <div key={i} className="max-w-[92%]">
                  {t.content && (
                    <div className={`rounded-2xl rounded-tl-md px-3.5 py-2.5 text-[14px] break-words shadow-sm ${t.error ? 'bg-white text-[#4a5672]' : 'bg-white text-[#0E1B3D]'}`}>
                      <Rich text={t.content} />
                    </div>
                  )}

                  {t.orders?.map((o) => <OrderView key={o.number} order={o} money={money} />)}
                  {t.bookings?.map((b) => <BookingView key={b.id} booking={b} />)}

                  {t.products && t.products.length > 0 && (
                    <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar pb-1">
                      {t.products.map((p) => (
                        <div key={p.id} className="w-[150px] shrink-0 rounded-xl bg-white border border-[#e3e8f2] p-2">
                          <a href={productHref?.(p.id) || '#'} className="block">
                            {p.image
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img src={p.image} alt={p.title} className="h-24 w-full object-contain rounded-lg bg-[#f4f6fa]" />
                              : <span className="h-24 w-full rounded-lg bg-[#f4f6fa] flex items-center justify-center text-[#8a94a8]"><Package size={22} /></span>}
                            <p className="mt-1.5 text-[12.5px] leading-snug line-clamp-2 text-[#0E1B3D]">{p.title}</p>
                            <p className="text-[13px]"><b>{money(p.price)}</b>{p.mrp ? <s className="ml-1 text-[11.5px] text-[#8a94a8]">{money(p.mrp)}</s> : null}</p>
                          </a>
                          {!p.inStock ? <p className="mt-1 text-[11.5px] font-semibold text-[#8a94a8]">Out of stock</p>
                            : p.hasOptions || !onAdd ? <a href={productHref?.(p.id) || '#'} className="mt-1.5 block h-8 leading-[30px] text-center rounded-lg border border-[var(--c)] text-[var(--c)] text-[12.5px] font-bold">{p.hasOptions ? 'Choose' : 'View'}</a>
                            : <button type="button" onClick={() => { onAdd(p.id); setAdded(p.id); setTimeout(() => setAdded(null), 1500) }} className="mt-1.5 w-full h-8 rounded-lg bg-[var(--c)] text-white text-[12.5px] font-bold cursor-pointer inline-flex items-center justify-center gap-1">{added === p.id ? <><Check size={13} /> Added</> : 'Add to cart'}</button>}
                        </div>
                      ))}
                    </div>
                  )}

                  {t.services && t.services.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {t.services.map((s) => (
                        <div key={s.id} className="rounded-xl bg-white border border-[#e3e8f2] p-2.5 flex items-center gap-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="text-[13.5px] font-bold text-[#0E1B3D] truncate">{s.name}</p>
                            <p className="text-[12px] text-[#6B7894]">{s.category} · {duration(s.minutes)}{s.price > 0 ? <> · <b className="text-[#0E1B3D]">{money(s.price)}</b></> : null}</p>
                          </div>
                          <button type="button" onClick={() => book(s.id)} className="shrink-0 h-9 px-3.5 rounded-full bg-[var(--c)] text-white text-[12.5px] font-bold cursor-pointer">Book</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {t.attachments && t.attachments.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {t.attachments.map((a) => a.type === 'image'
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <a key={a.url} href={a.url} target="_blank" rel="noreferrer"><img src={a.url} alt={a.name || ''} className="h-28 rounded-xl border border-[#e3e8f2] object-cover" /></a>
                        : <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="rounded-lg border border-[#d5ddeb] bg-white px-2.5 py-1.5 text-[12.5px] font-semibold text-[var(--c)]">{a.type === 'video' ? 'Watch video' : `Open ${a.name || 'file'}`}</a>)}
                    </div>
                  )}

                  {last && t.form && !busy && <LookupForm kind={t.form} onSend={ask} busy={busy} />}

                  {t.handoff && (waDigits || callDigits) && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {waDigits && <a href={wa(`Hi ${name}, ${lastAsked}`)} target="_blank" rel="noreferrer" className="h-9 px-3.5 rounded-full bg-[#25D366] text-white text-[13px] font-bold inline-flex items-center gap-1.5"><MessageCircle size={15} /> WhatsApp us</a>}
                      {callDigits && <a href={`tel:${callDigits}`} className="h-9 px-3.5 rounded-full border border-[#d5ddeb] bg-white text-[#0E1B3D] text-[13px] font-bold inline-flex items-center gap-1.5"><Phone size={14} /> Call</a>}
                    </div>
                  )}

                  {last && t.buttons && t.buttons.length > 0 && !busy && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {t.buttons.map((b) => <button key={b.title} type="button" onClick={() => ask(b.question)} className="rounded-full border border-[#d5ddeb] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[var(--c)] cursor-pointer hover:border-[var(--c)]">{b.title}</button>)}
                    </div>
                  )}
                </div>
              )
            })}

            {busy && (
              <div className="inline-flex items-center gap-1 rounded-2xl rounded-tl-md bg-white px-3.5 py-3 shadow-sm" aria-label="Typing">
                {[0, 150, 300].map((d) => <span key={d} className="h-2 w-2 rounded-full bg-[#8a94a8] animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
              </div>
            )}
          </div>

          {/* Quick actions stay one tap away once the chat has started */}
          {turns.length > 0 && !busy && (
            <div className="px-2.5 pt-2 bg-white flex gap-1.5 overflow-x-auto no-scrollbar shrink-0 border-t border-[#eef1f6]">
              {quick.map(({ label, ask: q }) => <button key={label} type="button" onClick={() => ask(q)} className="shrink-0 rounded-full bg-[#f4f6fa] px-3 py-1.5 text-[12px] font-semibold text-[#4a5672] cursor-pointer hover:text-[var(--c)]">{label}</button>)}
            </div>
          )}

          <form onSubmit={(e) => { e.preventDefault(); ask(text) }} className="p-2.5 bg-white flex items-center gap-2 shrink-0 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
            <input ref={input} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Type your question" aria-label="Your question" enterKeyHint="send"
              className="flex-1 min-w-0 h-11 px-4 rounded-full bg-[#f4f6fa] border border-transparent text-[15px] text-[#0E1B3D] placeholder:text-[#8a94a8] focus:outline-none focus:border-[var(--c)] focus:bg-white" />
            <button type="submit" disabled={busy || !text.trim()} aria-label="Send" className="h-11 w-11 shrink-0 rounded-full bg-[var(--c)] text-white flex items-center justify-center disabled:opacity-40 cursor-pointer">
              {busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          </form>
          <p className="px-3 pb-2 bg-white text-[11px] text-[#8a94a8] text-center shrink-0">Answers come from {name}&apos;s own details. For anything else, {waDigits ? 'WhatsApp' : 'call'} us.</p>
        </div>
      )}
    </>
  )
}
