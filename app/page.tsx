import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight, BarChart3, Bot, Boxes, Building2, CalendarCheck, Camera, Check, Code2, CreditCard, FileText, Globe, Inbox,
  Languages, Megaphone, MessageCircle, Phone, ReceiptText, ShieldCheck, Smartphone, Sparkles, Store, Ticket, TrendingUp,
  Truck, Users, Workflow,
} from 'lucide-react'
import { MetaTechProviderBadge } from '@/components/landing/meta-tech-provider-badge'
import { DemoForm, DesktopNav, LightMode, MobileMenu, PhoneChat, UseCases } from '@/components/landing/home-parts'
import { BRAND, whatsappUs } from '@/lib/brand'
import { PLANS } from '@/lib/plans'

export const metadata: Metadata = {
  title: `${BRAND.name}: WhatsApp for your business, with AI, bookings, store and team inbox`,
  description: 'One WhatsApp and Instagram inbox for your team, AI replies in English, Telugu and Hindi, bookings and GST bills, an online store, campaigns and follow-ups. Made for Indian small businesses.',
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`

const HERO_CHAT = [
  { from: 'customer' as const, text: 'Hi, what are your timings on Sunday?' },
  { from: 'business' as const, text: 'We are open on Sunday from 10 am to 6 pm. Would you like to book a visit?' },
  { from: 'customer' as const, text: 'Haan, facial at 4 pm' },
  { from: 'business' as const, text: 'Booked: Facial with Anitha, Sunday 4:00 pm. See you!', card: 'Booking confirmed · ₹900' },
]

const FEATURES = [
  { icon: Inbox, title: 'One inbox for the team', text: 'Every WhatsApp and Instagram chat in one place. Assign chats, see who replied, never miss a customer.' },
  { icon: Bot, title: 'AI that knows your business', text: 'Answers from your prices, services, products, PDFs and website. Hands the chat to your team when it is not sure.' },
  { icon: Languages, title: 'English, Telugu, Hindi and mixes', text: 'Customers write the way they talk. The AI replies the same way, day and night.' },
  { icon: CalendarCheck, title: 'Bookings and reminders', text: 'Customers pick a service, a person and a time on WhatsApp or your booking page. Reminders go out by themselves.' },
  { icon: ReceiptText, title: 'GST bills on WhatsApp', text: 'Walk-in and booking bills with CGST and SGST, sent as a link. Memberships and packages counted for you.' },
  { icon: Store, title: 'Your own website and store', text: 'A business website and an online store on your own domain or ours, with an AI chat that answers shoppers.' },
  { icon: CreditCard, title: 'Payments to your account', text: 'UPI, cards and cash on delivery. Razorpay or Stripe connects to your own account, so the money comes straight to you.' },
  { icon: Truck, title: 'Courier and tracking', text: 'Book Shiprocket or Delhivery from the order. Customers get the tracking link on WhatsApp.' },
  { icon: Megaphone, title: 'Campaigns that get read', text: 'Send offers to the right customers with Meta-approved templates. See who read and who replied.' },
  { icon: TrendingUp, title: 'Leads and follow-ups', text: 'Every enquiry becomes a deal with a follow-up date. Reports show what was won and by whom.' },
  { icon: Ticket, title: 'Tickets for problems', text: 'Complaints become tickets with a summary, so nothing is forgotten. The AI steps back while your team handles it.' },
  { icon: Workflow, title: 'Flows without code', text: 'Build menus, forms and booking steps that run on WhatsApp by themselves.' },
  { icon: Camera, title: 'Instagram too', text: 'Reply to DMs and comments, auto-reply to keywords, and post from one place.' },
  { icon: Smartphone, title: 'Mobile app', text: 'Run the counter, chats and orders from your Android phone, even when the internet is slow.' },
  { icon: Users, title: 'Team roles', text: 'Owners, managers and staff each see what they need. Staff see only their own chats if you want.' },
  { icon: Code2, title: 'Open API', text: 'Connect your own software with API keys and clear documentation.' },
]

const CONNECTORS = [
  { icon: CalendarCheck, name: 'Front Desk', for: 'Salons, clinics, gyms, studios, service centres', points: ['Bookings on WhatsApp and a booking page', 'Walk-in bills with GST', 'Memberships, reviews, staff commission', 'Business website with a Book button'] },
  { icon: Boxes, name: 'E-commerce', for: 'Shops, boutiques, restaurants, home businesses', points: ['Catalog in WhatsApp and an online store', 'UPI, card or cash on delivery', 'Courier booking and tracking', 'Offers, loyalty and GST invoices'] },
  { icon: BarChart3, name: 'Sales Pipeline', for: 'Coaching, real estate, agencies, B2B sales', points: ['Deals by stage on a board', 'Follow-ups due today', 'WhatsApp a lead in one tap', 'Win rate by person and source'] },
]

const STEPS = [
  { title: 'Sign up in 2 minutes', text: 'Start your 14-day free trial. No card needed.' },
  { title: 'Connect WhatsApp', text: 'Link your business number with Meta in a few clicks, or we do it with you on a call, usually the same day.' },
  { title: 'Add what you sell', text: 'Services, products and prices: type them, upload a sheet, or start from a ready list for your kind of business.' },
  { title: 'Go live', text: 'Share your WhatsApp link, booking page or store. The AI answers, customers book and buy, your team sees everything.' },
]

const FAQ = [
  ['Do I need a new WhatsApp number?', 'You can use a number you already have, as long as it is not active in the WhatsApp app on a phone at the same time. Many businesses take a new number for this. The Starter plan uses our number, so you need none.'],
  ['Is this the official WhatsApp?', `Yes. ${BRAND.name} uses Meta's official WhatsApp Business Platform (Cloud API). ${BRAND.company} is a Meta Tech Provider, so your number is safe from bans that unofficial tools cause.`],
  ['What does WhatsApp messaging cost?', 'Replies to customers within 24 hours of their message are free. Messages you start (offers, reminders) are charged by Meta per message. We pass on Meta\'s price with nothing added.'],
  ['Can the AI reply in Telugu or Hindi?', 'Yes. It understands English, Telugu, Hindi and mixed messages like "Sunday ki slot undha?", and replies in the same style. It only answers from what you teach it, and hands the chat to your team when it is unsure.'],
  ['Can my staff use it on their phones?', 'Yes. There is an Android app for the counter, chats and orders, and every page works on a phone browser too.'],
  ['Can I change my plan or stop later?', 'Yes, any time. Upgrade and you pay only the difference for the rest of the month. There is no lock-in.'],
  ['Who helps me set it up?', `Our team does it with you on a call or video, free. Message us on WhatsApp at ${BRAND.phoneShown}.`],
]

const section = 'px-4 sm:px-6'
const wrap = 'mx-auto max-w-6xl'
const eyebrow = 'text-[13px] font-bold uppercase tracking-wider text-[#1D5BEA]'
const h2 = 'mt-2 text-[28px] sm:text-[38px] font-bold leading-[1.15] tracking-tight text-[#0E1B3D]'
const lead = 'mt-3 text-[16px] sm:text-[17px] leading-relaxed text-[#4a5672]'

export default function HomePage() {
  const plans = PLANS.filter((p) => ['starter', 'growth', 'pro_1'].includes(p.id))
  return (
    <div className="min-h-screen bg-white text-[#0E1B3D] overflow-x-hidden">
      <LightMode />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-[#e3e8f2] bg-white/95 backdrop-blur">
        <div className={`${wrap} relative flex h-16 items-center justify-between gap-4 ${section}`}>
          <Link href="/" className="flex items-center gap-2.5 min-w-0" aria-label={`${BRAND.name} home`}>
            <span className="h-9 w-9 shrink-0 rounded-lg bg-[#1D5BEA] text-white inline-flex items-center justify-center"><MessageCircle size={20} /></span>
            <span className="text-[18px] font-bold tracking-tight truncate">{BRAND.name}</span>
          </Link>
          <DesktopNav />
          <div className="flex items-center gap-2">
            <Link href="/login" className="hidden sm:inline-flex h-10 items-center rounded-lg px-4 text-[14.5px] font-semibold text-[#0E1B3D] hover:bg-[#f4f6fa]">Log in</Link>
            <Link href="/signup" className="hidden sm:inline-flex h-10 items-center rounded-lg bg-[#1D5BEA] hover:bg-[#174bc4] px-4 text-[14.5px] font-semibold text-white">Start free</Link>
            <MobileMenu />
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className={`${section} pt-12 pb-16 sm:pt-20 sm:pb-24 bg-[#f4f6fa] border-b border-[#e3e8f2]`}>
          <div className={`${wrap} grid gap-12 lg:grid-cols-[1.15fr_1fr] items-center`}>
            <div>
              <MetaTechProviderBadge size="sm" />
              <h1 className="mt-5 text-[36px] sm:text-[52px] font-bold leading-[1.08] tracking-tight">
                Run your business on WhatsApp. <span className="text-[#1D5BEA]">Bookings, sales and replies, done for you.</span>
              </h1>
              <p className="mt-5 max-w-xl text-[17px] sm:text-[19px] leading-relaxed text-[#4a5672]">
                One inbox for your team, an AI that answers customers in English, Telugu and Hindi, bookings and GST bills, your own online store, and campaigns that bring customers back.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <Link href="/signup" className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#1D5BEA] hover:bg-[#174bc4] px-6 text-[16px] font-bold text-white">Start your 14-day free trial <ArrowRight size={18} /></Link>
                <a href="#demo" className="inline-flex h-12 items-center justify-center rounded-lg border border-[#d5ddeb] bg-white px-6 text-[16px] font-semibold text-[#0E1B3D] hover:border-[#1D5BEA]">Book a free demo</a>
              </div>
              <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[14px] font-medium text-[#4a5672]">
                {['No card needed', 'Set up with you, free', 'Cancel any time'].map((t) => (
                  <li key={t} className="inline-flex items-center gap-1.5"><Check size={16} className="text-[#1D5BEA]" /> {t}</li>
                ))}
              </ul>
            </div>
            <PhoneChat name="Glow Salon" lines={HERO_CHAT} />
          </div>
        </section>

        {/* What changes */}
        <section className={`${section} py-12 border-b border-[#e3e8f2]`}>
          <div className={`${wrap} grid grid-cols-2 lg:grid-cols-4 gap-6`}>
            {[
              ['24 × 7', 'Customers get an answer, even at midnight'],
              ['1 inbox', 'WhatsApp and Instagram for the whole team'],
              ['3 languages', 'English, Telugu, Hindi and mixes'],
              ['1 day', 'Usually all it takes to go live'],
            ].map(([n, t]) => (
              <div key={n}>
                <p className="text-[28px] sm:text-[34px] font-bold tracking-tight text-[#1D5BEA]">{n}</p>
                <p className="mt-1 text-[14.5px] text-[#4a5672]">{t}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Use cases */}
        <section id="use-cases" className={`${section} py-16 sm:py-24 scroll-mt-16`}>
          <div className={wrap}>
            <div className="text-center max-w-2xl mx-auto mb-10">
              <p className={eyebrow}>Use cases</p>
              <h2 className={h2}>Made for the way your business works</h2>
              <p className={lead}>Pick your kind of business and see what changes.</p>
            </div>
            <UseCases />
          </div>
        </section>

        {/* Connectors */}
        <section className={`${section} py-16 sm:py-24 bg-[#f4f6fa] border-y border-[#e3e8f2]`}>
          <div className={wrap}>
            <div className="max-w-2xl">
              <p className={eyebrow}>Connectors</p>
              <h2 className={h2}>Switch on the app made for your work</h2>
              <p className={lead}>Every plan has the inbox, AI and campaigns. Then add the one connector that fits your business. Change it any time; nothing is lost.</p>
            </div>
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {CONNECTORS.map((c) => {
                const Icon = c.icon
                return (
                  <div key={c.name} className="rounded-2xl border border-[#e3e8f2] bg-white p-6">
                    <span className="h-11 w-11 rounded-xl bg-[#eef3fe] text-[#1D5BEA] inline-flex items-center justify-center"><Icon size={22} /></span>
                    <h3 className="mt-4 text-[20px] font-bold">{c.name}</h3>
                    <p className="mt-1 text-[14px] text-[#6B7894]">{c.for}</p>
                    <ul className="mt-4 space-y-2.5">
                      {c.points.map((p) => <li key={p} className="flex gap-2.5 text-[15px]"><Check size={17} className="mt-0.5 shrink-0 text-[#1D5BEA]" /> {p}</li>)}
                    </ul>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className={`${section} py-16 sm:py-24 scroll-mt-16`}>
          <div className={wrap}>
            <div className="text-center max-w-2xl mx-auto">
              <p className={eyebrow}>Everything in one place</p>
              <h2 className={h2}>No more five apps and a notebook</h2>
              <p className={lead}>Chats, bookings, bills, orders, payments, delivery and follow-ups, working together.</p>
            </div>
            <div className="mt-12 grid gap-x-8 gap-y-9 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((f) => {
                const Icon = f.icon
                return (
                  <div key={f.title}>
                    <span className="h-10 w-10 rounded-lg bg-[#eef3fe] text-[#1D5BEA] inline-flex items-center justify-center"><Icon size={20} /></span>
                    <h3 className="mt-3 text-[16.5px] font-bold">{f.title}</h3>
                    <p className="mt-1.5 text-[14.5px] leading-relaxed text-[#4a5672]">{f.text}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* AI in focus */}
        <section className={`${section} py-16 sm:py-24 bg-[#0E1B3D] text-white`}>
          <div className={`${wrap} grid gap-12 lg:grid-cols-2 items-center`}>
            <div>
              <p className="text-[13px] font-bold uppercase tracking-wider text-[#9db5ef]">AI assistant</p>
              <h2 className="mt-2 text-[28px] sm:text-[38px] font-bold leading-[1.15] tracking-tight">Teach it once. It answers every customer.</h2>
              <p className="mt-3 text-[16px] sm:text-[17px] leading-relaxed text-[#c5d5fa]">Add your price list, FAQs, a PDF or your website. The AI replies from that, never makes up prices, and sends photos, brochures and links when they help.</p>
              <ul className="mt-6 space-y-3">
                {[
                  'Books appointments and takes orders inside the chat',
                  'Answers "Where is my order?" and "When is my booking?" from your real data',
                  'Hands the chat to a person, with a summary, when it is unsure or the customer is upset',
                  'Shows you the questions it could not answer, so you can teach it',
                ].map((t) => <li key={t} className="flex gap-3 text-[15.5px]"><Sparkles size={18} className="mt-0.5 shrink-0 text-[#9db5ef]" /> {t}</li>)}
              </ul>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                [FileText, 'PDFs and documents', 'Menus, brochures, price lists'],
                [Globe, 'Your website', 'Read page by page, kept up to date'],
                [MessageCircle, 'FAQs with photos', 'Answers with pictures, videos and links'],
                [ShieldCheck, 'Safe answers', 'Prices checked before they are sent'],
              ].map(([Icon, title, text]) => {
                const I = Icon as typeof FileText
                return (
                  <div key={title as string} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                    <I size={22} className="text-[#9db5ef]" />
                    <p className="mt-3 font-bold">{title as string}</p>
                    <p className="mt-1 text-[14px] text-[#c5d5fa]">{text as string}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className={`${section} py-16 sm:py-24 scroll-mt-16`}>
          <div className={wrap}>
            <div className="text-center max-w-2xl mx-auto">
              <p className={eyebrow}>How it works</p>
              <h2 className={h2}>Live in a day, with our help</h2>
            </div>
            <ol className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s, i) => (
                <li key={s.title} className="rounded-2xl border border-[#e3e8f2] p-6">
                  <span className="h-9 w-9 rounded-full bg-[#0E1B3D] text-white inline-flex items-center justify-center font-bold">{i + 1}</span>
                  <h3 className="mt-4 text-[17px] font-bold">{s.title}</h3>
                  <p className="mt-1.5 text-[14.5px] leading-relaxed text-[#4a5672]">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className={`${section} py-16 sm:py-24 bg-[#f4f6fa] border-y border-[#e3e8f2] scroll-mt-16`}>
          <div className={wrap}>
            <div className="text-center max-w-2xl mx-auto">
              <p className={eyebrow}>Pricing</p>
              <h2 className={h2}>Simple monthly plans</h2>
              <p className={lead}>14 days free on any plan. Prices are per month.</p>
            </div>
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {plans.map((plan) => {
                const popular = plan.id === 'growth'
                return (
                  <div key={plan.id} className={`relative rounded-2xl bg-white p-6 flex flex-col ${popular ? 'border-2 border-[#1D5BEA]' : 'border border-[#e3e8f2]'}`}>
                    {popular && <span className="absolute -top-3 left-6 rounded-full bg-[#1D5BEA] px-3 py-0.5 text-[12px] font-bold text-white">Recommended</span>}
                    <h3 className="text-[19px] font-bold">{plan.name}</h3>
                    <p className="mt-1 text-[14px] text-[#6B7894] min-h-[42px]">{plan.tagline}</p>
                    <p className="mt-4"><span className="text-[34px] font-bold tracking-tight">{rupees(plan.amountPaise)}</span><span className="text-[#6B7894]"> / month</span></p>
                    <ul className="mt-5 space-y-2.5 flex-1">
                      {plan.features.slice(0, 5).map((f) => <li key={f} className="flex gap-2.5 text-[14.5px]"><Check size={17} className="mt-0.5 shrink-0 text-[#1D5BEA]" /> {f}</li>)}
                    </ul>
                    <Link href={`/signup?plan=${plan.id}`} className={`mt-6 inline-flex h-11 items-center justify-center rounded-lg font-semibold ${popular ? 'bg-[#1D5BEA] hover:bg-[#174bc4] text-white' : 'border border-[#d5ddeb] text-[#0E1B3D] hover:border-[#1D5BEA]'}`}>Start free</Link>
                  </div>
                )
              })}
            </div>
            <p className="mt-6 text-center text-[14.5px] text-[#4a5672]">Bigger team? Pro 2 and Pro 3 add more people, AI credit, ads support and video campaigns. <Link href="/pricing" className="font-semibold text-[#1D5BEA]">See all plans</Link></p>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className={`${section} py-16 sm:py-24 scroll-mt-16`}>
          <div className="mx-auto max-w-3xl">
            <div className="text-center">
              <p className={eyebrow}>Questions</p>
              <h2 className={h2}>Asked by business owners like you</h2>
            </div>
            <div className="mt-10 divide-y divide-[#e3e8f2] border-y border-[#e3e8f2]">
              {FAQ.map(([q, a]) => (
                <details key={q} className="group py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16.5px] font-semibold">
                    {q}
                    <span className="h-7 w-7 shrink-0 rounded-full border border-[#d5ddeb] inline-flex items-center justify-center text-[#1D5BEA] transition-transform group-open:rotate-45" aria-hidden>+</span>
                  </summary>
                  <p className="mt-3 text-[15.5px] leading-relaxed text-[#4a5672]">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Demo */}
        <section id="demo" className={`${section} py-16 sm:py-24 bg-[#f4f6fa] border-t border-[#e3e8f2] scroll-mt-16`}>
          <div className={`${wrap} grid gap-10 lg:grid-cols-2 items-start`}>
            <div>
              <p className={eyebrow}>Free demo</p>
              <h2 className={h2}>See it working for your business</h2>
              <p className={lead}>Tell us a little about your business. We show you how it works for you, and set up your WhatsApp with you, free.</p>
              <ul className="mt-6 space-y-3">
                {['20 minutes, on a call or video', 'We connect your WhatsApp number with you', 'Your services or products added for you'].map((t) => (
                  <li key={t} className="flex gap-3 text-[15.5px]"><Check size={18} className="mt-0.5 shrink-0 text-[#1D5BEA]" /> {t}</li>
                ))}
              </ul>
              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <a href={whatsappUs(`Hi, I want to know more about ${BRAND.name}.`)} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0E1B3D] px-5 font-semibold text-white"><MessageCircle size={18} /> WhatsApp us</a>
                <a href={`tel:+${BRAND.whatsapp}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[#d5ddeb] bg-white px-5 font-semibold text-[#0E1B3D]"><Phone size={17} /> {BRAND.phoneShown}</a>
              </div>
            </div>
            <DemoForm />
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className={`${section} bg-[#0E1B3D] text-[#c5d5fa] py-12`}>
        <div className={`${wrap} grid gap-8 sm:grid-cols-2 lg:grid-cols-4`}>
          <div className="lg:col-span-2">
            <p className="flex items-center gap-2.5 text-white text-[18px] font-bold"><span className="h-9 w-9 rounded-lg bg-[#1D5BEA] inline-flex items-center justify-center"><MessageCircle size={20} /></span> {BRAND.name}</p>
            <p className="mt-3 max-w-sm text-[14.5px] leading-relaxed">WhatsApp, AI, bookings, store and follow-ups for small businesses. By {BRAND.company}.</p>
            <MetaTechProviderBadge variant="dark" size="sm" className="mt-5" />
          </div>
          <div>
            <p className="text-white font-semibold">Product</p>
            <ul className="mt-3 space-y-2 text-[14.5px]">
              <li><a href="#use-cases" className="hover:text-white">Use cases</a></li>
              <li><a href="#features" className="hover:text-white">Features</a></li>
              <li><Link href="/pricing" className="hover:text-white">Pricing</Link></li>
              <li><Link href="/developers" className="hover:text-white">API for developers</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-white font-semibold">Company</p>
            <ul className="mt-3 space-y-2 text-[14.5px]">
              <li><a href={whatsappUs(`Hi, I have a question about ${BRAND.name}.`)} target="_blank" rel="noopener noreferrer" className="hover:text-white">Contact on WhatsApp</a></li>
              <li><Link href="/privacy" className="hover:text-white">Privacy policy</Link></li>
              <li><Link href="/terms" className="hover:text-white">Terms of service</Link></li>
              <li><Link href="/data-deletion" className="hover:text-white">Delete my data</Link></li>
            </ul>
          </div>
        </div>
        <div className={`${wrap} mt-10 border-t border-white/10 pt-6 flex flex-col sm:flex-row justify-between gap-2 text-[13px]`}>
          <p>© {new Date().getFullYear()} {BRAND.company}. All rights reserved.</p>
          <p className="inline-flex items-center gap-1.5"><Building2 size={14} /> Made in India for Indian businesses</p>
        </div>
      </footer>
    </div>
  )
}
