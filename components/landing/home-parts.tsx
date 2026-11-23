'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight, Car, Check, CheckCheck, GraduationCap, HeartPulse, Home, Loader2, Menu, Scissors, ShoppingBag, Store, Dumbbell,
  UtensilsCrossed, X,
} from 'lucide-react'
import { BRAND, whatsappUs } from '@/lib/brand'

/** The home page is always light, whatever the dashboard was set to */
export function LightMode() {
  useEffect(() => { document.documentElement.classList.remove('dark') }, [])
  return null
}

const NAV = [
  ['#use-cases', 'Use cases'],
  ['#features', 'Features'],
  ['#how', 'How it works'],
  ['#pricing', 'Pricing'],
  ['#faq', 'Questions'],
] as const

/** Phone menu: the page links, Log in and Start free */
export function MobileMenu() {
  const [open, setOpen] = useState(false)
  return (
    <div className="lg:hidden">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? 'Close menu' : 'Open menu'} className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-[#e3e8f2] text-[#0E1B3D] cursor-pointer">
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full border-b border-[#e3e8f2] bg-white shadow-lg">
          <nav className="mx-auto max-w-6xl px-4 py-3 flex flex-col">
            {NAV.map(([href, label]) => (
              <a key={href} href={href} onClick={() => setOpen(false)} className="py-3 text-[16px] font-semibold text-[#0E1B3D] border-b border-[#eef1f6]">{label}</a>
            ))}
            <div className="grid grid-cols-2 gap-2 pt-3 pb-1">
              <Link href="/login" className="h-11 inline-flex items-center justify-center rounded-lg border border-[#d5ddeb] font-semibold text-[#0E1B3D]">Log in</Link>
              <Link href="/signup" className="h-11 inline-flex items-center justify-center rounded-lg bg-[#1D5BEA] font-semibold text-white">Start free</Link>
            </div>
          </nav>
        </div>
      )}
    </div>
  )
}

export function DesktopNav() {
  return (
    <nav className="hidden lg:flex items-center gap-7 text-[14.5px] font-semibold text-[#4a5672]">
      {NAV.map(([href, label]) => <a key={href} href={href} className="hover:text-[#0E1B3D]">{label}</a>)}
    </nav>
  )
}

type Line = { from: 'customer' | 'business'; text: string; card?: string }
type UseCase = {
  key: string
  label: string
  icon: typeof Scissors
  title: string
  problem: string
  points: string[]
  connector: string
  chat: Line[]
}

/** Who it is for: each kind of business, what it struggles with, and what the product does about it */
const USE_CASES: UseCase[] = [
  {
    key: 'salon', label: 'Salons and spas', icon: Scissors, connector: 'Front Desk',
    title: 'Fill every chair, without picking up the phone',
    problem: 'Bookings come by call, WhatsApp and walk-in. Staff forget who is next, and customers forget to come back.',
    points: [
      'Customers book on WhatsApp or your booking page: pick the service, the stylist and a free time',
      'Reminders before the visit, and a "How was it?" message after',
      'Walk-in bills in a few taps, with GST, sent on WhatsApp',
      'Each stylist\'s sales and commission, worked out for you',
      'Membership cards and packages that count every visit',
    ],
    chat: [
      { from: 'customer', text: 'Hi, haircut and beard trim tomorrow evening?' },
      { from: 'business', text: 'Sure! Ravi is free at 5:30 pm or 7:00 pm tomorrow. Which one?' },
      { from: 'customer', text: '7 pm' },
      { from: 'business', text: 'Booked: Haircut + Beard trim with Ravi, tomorrow 7:00 pm.', card: 'Booking confirmed · ₹450' },
    ],
  },
  {
    key: 'clinic', label: 'Clinics and dentists', icon: HeartPulse, connector: 'Front Desk',
    title: 'Appointments, reminders and bills for your clinic',
    problem: 'The front desk spends the day on calls, patients miss visits, and follow-ups are forgotten.',
    points: [
      'Patients book a slot with the right doctor on WhatsApp',
      'Reminders the day before cut no-shows',
      'Consultation bills with GST, sent on WhatsApp',
      'Questions about timings, fees and location answered by AI, day and night',
      'A simple website with your doctors, services and a Book button',
    ],
    chat: [
      { from: 'customer', text: 'Is Dr. Rao available on Saturday?' },
      { from: 'business', text: 'Yes, Dr. Rao sees patients on Saturday from 10 am to 2 pm. Free times: 10:30, 11:15 and 12:45.' },
      { from: 'customer', text: '11:15 please' },
      { from: 'business', text: 'Done. See you on Saturday at 11:15 am.', card: 'Appointment booked' },
    ],
  },
  {
    key: 'shop', label: 'Shops and boutiques', icon: ShoppingBag, connector: 'E-commerce',
    title: 'Sell on WhatsApp and on your own online store',
    problem: 'Customers ask for prices one by one on WhatsApp, and orders get lost in the chat.',
    points: [
      'Your products in WhatsApp and on your own store website (your domain or ours)',
      'UPI, card or cash on delivery; Razorpay or Stripe on your own account',
      'Courier booking with Shiprocket or Delhivery, tracking sent on WhatsApp',
      'Offers, discount codes, loyalty points and GST invoices',
      'Cart reminders bring back customers who did not finish',
    ],
    chat: [
      { from: 'customer', text: 'Do you have the blue kurta in size M?' },
      { from: 'business', text: 'Yes! Blue cotton kurta, size M is in stock: ₹899 (MRP ₹1,299).', card: 'Blue cotton kurta · ₹899 · Add to cart' },
      { from: 'customer', text: 'Order it, cash on delivery' },
      { from: 'business', text: 'Order ORD-261122-0042 placed. It ships tomorrow; we will send the tracking link here.' },
    ],
  },
  {
    key: 'gym', label: 'Gyms and studios', icon: Dumbbell, connector: 'Front Desk',
    title: 'Memberships, classes and renewals on autopilot',
    problem: 'Members drop off quietly, renewals are chased by phone, and class slots are a mess.',
    points: [
      'Membership cards that track every visit and what is left',
      'Class and trainer bookings on WhatsApp',
      'Renewal reminders and offers to members who stopped coming',
      'Trainer performance and commission',
      'Campaigns for new batches and festival offers',
    ],
    chat: [
      { from: 'customer', text: 'How many sessions are left on my card?' },
      { from: 'business', text: 'Your Gold card has 6 of 24 sessions left, valid till 15 Jan.', card: 'Gold membership · 6 left' },
      { from: 'customer', text: 'Book yoga tomorrow 7 am' },
      { from: 'business', text: 'Booked: Yoga with Sana, tomorrow 7:00 am.' },
    ],
  },
  {
    key: 'food', label: 'Restaurants and cafés', icon: UtensilsCrossed, connector: 'E-commerce',
    title: 'Take orders and table bookings on WhatsApp',
    problem: 'Calls during rush hour are missed, and regular customers never hear about new dishes.',
    points: [
      'Menu in WhatsApp; customers order for pick-up or delivery',
      'Pay online or on delivery',
      'Table bookings with a confirmation message',
      'Offers to regulars with one campaign',
      'Reviews asked after every order',
    ],
    chat: [
      { from: 'customer', text: 'Menu please' },
      { from: 'business', text: 'Here is today\'s menu. Tap an item to add it to your order.', card: 'Menu · 24 items' },
      { from: 'customer', text: '2 paneer biryani, pick up at 8' },
      { from: 'business', text: 'Order placed: 2 Paneer Biryani, ₹480. Ready for pick-up at 8:00 pm.' },
    ],
  },
  {
    key: 'service', label: 'Service centres', icon: Car, connector: 'Front Desk',
    title: 'Service bookings, job updates and bills',
    problem: 'Customers keep calling to ask "Is my vehicle ready?" and the counter loses track.',
    points: [
      'Customers book a service slot on WhatsApp',
      'Status updates and the bill sent on WhatsApp when the job is done',
      'Reminders when the next service is due',
      'Questions about prices and timings answered by AI',
      'Reviews collected after every job',
    ],
    chat: [
      { from: 'customer', text: 'Bike service on Monday?' },
      { from: 'business', text: 'Monday morning is open: 9:00, 10:00 or 11:30. Which one suits you?' },
      { from: 'customer', text: '10' },
      { from: 'business', text: 'Booked for Monday 10:00 am. We will message you when it is ready.', card: 'Service booked' },
    ],
  },
  {
    key: 'tutor', label: 'Coaching and tutors', icon: GraduationCap, connector: 'Sales Pipeline',
    title: 'Turn every enquiry into an admission',
    problem: 'Enquiries come from ads and walk-ins, and nobody follows up on time.',
    points: [
      'Every enquiry becomes a lead with a follow-up date',
      'Ad leads from Meta land straight in the inbox',
      'The AI answers fee, batch and timing questions',
      'Demo class reminders and admission campaigns',
      'Reports: who converted, from which source, by which counsellor',
    ],
    chat: [
      { from: 'customer', text: 'Fees for the NEET batch?' },
      { from: 'business', text: 'The NEET 2027 batch is ₹45,000 for the year, in 3 parts. A free demo class is on Sunday at 10 am. Shall I book a seat?' },
      { from: 'customer', text: 'Yes' },
      { from: 'business', text: 'Your demo seat is booked for Sunday 10 am.', card: 'Lead added · Follow-up Monday' },
    ],
  },
  {
    key: 'sales', label: 'Real estate and sales teams', icon: Home, connector: 'Sales Pipeline',
    title: 'Every lead followed up, every deal tracked',
    problem: 'Leads sit in personal phones, and the owner cannot see which deal is where.',
    points: [
      'One shared WhatsApp number for the whole team',
      'Deals by stage: new, site visit, negotiation, won',
      'Follow-ups due today, with one tap to message',
      'Brochures and price lists sent automatically by the AI',
      'Won, lost and win rate for each person',
    ],
    chat: [
      { from: 'customer', text: 'Send 2BHK details in Kokapet' },
      { from: 'business', text: '2BHK at Green Heights, Kokapet: 1,250 sq ft from ₹78 lakh. Brochure attached. Would you like a site visit this weekend?', card: 'Brochure.pdf' },
      { from: 'customer', text: 'Saturday 11 am' },
      { from: 'business', text: 'Site visit booked for Saturday 11 am. Our team will call you to confirm.' },
    ],
  },
]

function Bubble({ line }: { line: Line }) {
  const mine = line.from === 'business'
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[13.5px] leading-snug shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] ${mine ? 'bg-[#e7f0ff] rounded-tr-sm' : 'bg-white rounded-tl-sm'}`}>
        <p className="text-[#111b21]">{line.text}</p>
        {line.card && <p className="mt-1.5 rounded-lg bg-white/80 border border-[#d5ddeb] px-2.5 py-1.5 text-[12.5px] font-semibold text-[#1D5BEA]">{line.card}</p>}
        {mine && <span className="mt-0.5 flex justify-end text-[#1D5BEA]"><CheckCheck size={14} aria-label="Read" /></span>}
      </div>
    </div>
  )
}

/** A phone showing a WhatsApp-style chat (made with HTML, no pictures) */
export function PhoneChat({ name, lines }: { name: string; lines: Line[] }) {
  return (
    <div className="mx-auto w-full max-w-[340px] rounded-[30px] border-[8px] border-[#0E1B3D] bg-[#0E1B3D] shadow-[0_30px_60px_-30px_rgba(14,27,61,0.55)]">
      <div className="rounded-[22px] overflow-hidden bg-[#f4f6fa]">
        <div className="flex items-center gap-2.5 bg-[#0E1B3D] px-3.5 py-3 text-white">
          <span className="h-8 w-8 rounded-full bg-[#1D5BEA] inline-flex items-center justify-center text-[13px] font-bold">{name.slice(0, 1)}</span>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold truncate">{name}</p>
            <p className="text-[11px] text-[#c5d5fa]">Business account · replies in seconds</p>
          </div>
        </div>
        <div className="space-y-2 px-3 py-4 min-h-[300px]">
          {lines.map((line, i) => <Bubble key={i} line={line} />)}
        </div>
      </div>
    </div>
  )
}

/** Use cases: one tab per kind of business, with what it does and a sample chat */
export function UseCases() {
  const [active, setActive] = useState(USE_CASES[0].key)
  const item = USE_CASES.find((u) => u.key === active) || USE_CASES[0]
  return (
    <div>
      <div role="tablist" aria-label="Kinds of business" className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap sm:justify-center">
        {USE_CASES.map((u) => {
          const Icon = u.icon
          const on = u.key === active
          return (
            <button key={u.key} type="button" role="tab" aria-selected={on} onClick={() => setActive(u.key)}
              className={`shrink-0 inline-flex items-center gap-2 h-10 px-4 rounded-full border text-[14px] font-semibold cursor-pointer transition-colors ${on ? 'bg-[#0E1B3D] border-[#0E1B3D] text-white' : 'bg-white border-[#d5ddeb] text-[#4a5672] hover:border-[#1D5BEA] hover:text-[#1D5BEA]'}`}>
              <Icon size={16} /> {u.label}
            </button>
          )
        })}
      </div>
      <div role="tabpanel" className="mt-8 grid gap-10 lg:grid-cols-[1.1fr_1fr] items-center">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#eef3fe] px-3 py-1 text-[12.5px] font-semibold text-[#1D5BEA]"><Store size={14} /> Uses the {item.connector} connector</span>
          <h3 className="mt-3 text-[24px] sm:text-[30px] font-bold leading-tight tracking-tight text-[#0E1B3D]">{item.title}</h3>
          <p className="mt-3 text-[15.5px] leading-relaxed text-[#4a5672]"><strong className="text-[#0E1B3D]">The problem:</strong> {item.problem}</p>
          <ul className="mt-5 space-y-3">
            {item.points.map((p) => (
              <li key={p} className="flex gap-3 text-[15.5px] text-[#0E1B3D]">
                <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-[#1D5BEA] text-white inline-flex items-center justify-center"><Check size={13} strokeWidth={3} /></span>
                {p}
              </li>
            ))}
          </ul>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/signup" className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#1D5BEA] hover:bg-[#174bc4] px-5 font-semibold text-white">Start free for 14 days <ArrowRight size={17} /></Link>
            <a href={whatsappUs(`Hi, I run a business (${item.label}). I want to know more about ${BRAND.name}.`)} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center rounded-lg border border-[#d5ddeb] bg-white px-5 font-semibold text-[#0E1B3D] hover:border-[#1D5BEA]">Ask us on WhatsApp</a>
          </div>
        </div>
        <PhoneChat name={sampleName(item.key)} lines={item.chat} />
      </div>
    </div>
  )
}

function sampleName(key: string) {
  return ({ salon: 'Glow Salon', clinic: 'Smile Dental Clinic', shop: 'Sri Lakshmi Fashions', gym: 'FitZone Gym', food: 'Cafe Mocha', service: 'Speed Auto Service', tutor: 'Bright Academy', sales: 'Green Heights' } as Record<string, string>)[key] || BRAND.name
}

const GOALS = ['Bookings and bills (Front Desk)', 'Selling online and on WhatsApp', 'Leads and follow-ups', 'AI replies on WhatsApp and Instagram', 'Campaigns to my customers', 'Not sure yet, help me choose']

/** "Book a free demo": saved as a lead for our team (/api/public/demo-request) */
export function DemoForm() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', goal: GOALS[0] })
  const [trap, setTrap] = useState('') // hidden from people; a bot that fills it is ignored
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const field = 'w-full h-11 rounded-lg border border-[#d5ddeb] bg-white px-3.5 text-[15px] text-[#0E1B3D] placeholder:text-[#8a94a8] focus:outline-none focus:border-[#1D5BEA] focus:ring-2 focus:ring-[#1D5BEA]/15'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      // Where the visitor came from (ads add these to the link), so the lead shows its source
      const params = new URLSearchParams(window.location.search)
      const source: Record<string, string> = { page: window.location.pathname }
      for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid']) {
        const value = params.get(key)
        if (value) source[key] = value
      }
      const res = await fetch('/api/public/demo-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, email: form.email, phone: form.phone, goal: form.goal, website: trap, source }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'We could not send your request. Please try again.')
      setDone(true)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-[#d5ddeb] bg-white p-8 text-center">
        <span className="mx-auto h-11 w-11 rounded-full bg-[#1D5BEA] text-white inline-flex items-center justify-center"><Check size={22} /></span>
        <h3 className="mt-3 text-[18px] font-bold text-[#0E1B3D]">Thank you! We will call you soon.</h3>
        <p className="mt-1 text-[14.5px] text-[#4a5672]">Usually within a few working hours. In a hurry? <a className="font-semibold text-[#1D5BEA]" href={whatsappUs(`Hi, I just asked for a demo of ${BRAND.name}.`)} target="_blank" rel="noopener noreferrer">WhatsApp us</a>.</p>
      </div>
    )
  }
  return (
    <form onSubmit={submit} className="rounded-2xl border border-[#d5ddeb] bg-white p-5 sm:p-7 space-y-4">
      <div>
        <label htmlFor="demo-name" className="block text-[13.5px] font-semibold text-[#0E1B3D] mb-1.5">Your name</label>
        <input id="demo-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} placeholder="Ravi Kumar" autoComplete="name" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="demo-phone" className="block text-[13.5px] font-semibold text-[#0E1B3D] mb-1.5">WhatsApp number</label>
          <input id="demo-phone" required inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={field} placeholder="98765 43210" autoComplete="tel" />
        </div>
        <div>
          <label htmlFor="demo-email" className="block text-[13.5px] font-semibold text-[#0E1B3D] mb-1.5">Email</label>
          <input id="demo-email" required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={field} placeholder="you@business.com" autoComplete="email" />
        </div>
      </div>
      <div>
        <label htmlFor="demo-goal" className="block text-[13.5px] font-semibold text-[#0E1B3D] mb-1.5">What do you need most?</label>
        <select id="demo-goal" value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} className={field}>
          {GOALS.map((g) => <option key={g}>{g}</option>)}
        </select>
      </div>
      <input type="text" name="website" value={trap} onChange={(e) => setTrap(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />
      {error && <p role="alert" className="rounded-lg bg-[#fdf0f0] px-3 py-2 text-[14px] font-semibold text-[#b91c1c]">{error}</p>}
      <button type="submit" disabled={busy} className="w-full h-12 rounded-lg bg-[#1D5BEA] hover:bg-[#174bc4] text-[15.5px] font-bold text-white inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60">
        {busy ? <Loader2 size={18} className="animate-spin" /> : null} Book my free demo
      </button>
      <p className="text-center text-[12.5px] text-[#6B7894]">20 minutes on a call or video. We set up WhatsApp with you, free.</p>
    </form>
  )
}
