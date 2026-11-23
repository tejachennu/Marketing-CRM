import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight, BarChart3, Bot, Building2, CalendarCheck, Camera, Check, Clapperboard, Compass, ImageIcon, Inbox,
  Languages, LineChart, Megaphone, MessageCircle, Phone, Search, Sparkles, Store, Target, TrendingUp, Workflow,
} from 'lucide-react'
import { MetaTechProviderBadge } from '@/components/landing/meta-tech-provider-badge'
import { DemoForm, DesktopNav, LightMode, MobileMenu, PhoneChat, UseCases } from '@/components/landing/home-parts'
import { BRAND, whatsappUs } from '@/lib/brand'
import { PLANS } from '@/lib/plans'

export const metadata: Metadata = {
  title: `${BRAND.company}: your digital marketing and AI partner`,
  description: 'Growth strategy, ads on Instagram, Facebook and Google, video editing, reels and photos, WhatsApp automation and AI assistants. One partner to grow your business.',
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`

/** What we do for a business */
const SERVICES = [
  {
    icon: Compass, title: 'Growth strategy', text: 'We study your business, your customers and your area, then make a clear plan: who to reach, what to offer, and where.',
    points: ['Customer and competitor study', 'Offers and pricing ideas', 'A month-by-month marketing calendar'],
  },
  {
    icon: Megaphone, title: 'Ads that bring customers', text: 'Instagram, Facebook and Google ads set up, run and improved every week by our team, aimed at people near you who are ready to buy.',
    points: ['Ads to WhatsApp, calls or your website', 'Local targeting by area', 'Weekly checks so no money is wasted'],
  },
  {
    icon: Clapperboard, title: 'Video editing and reels', text: 'Reels, ads and short videos edited for Instagram and YouTube, from your phone clips or a shoot, with captions and music.',
    points: ['Reels and short ads', 'Captions in English, Telugu or Hindi', 'Made to stop the scroll'],
  },
  {
    icon: ImageIcon, title: 'Photos and design', text: 'Product photos cleaned up, posters, festival posts, menus and banners that look like one brand.',
    points: ['Product photo editing', 'Social posts and festival creatives', 'Logos, menus, flyers and banners'],
  },
  {
    icon: Workflow, title: 'Workflow automation', text: 'The work your team repeats every day, done by itself: booking steps, reminders, follow-ups, order updates and reports.',
    points: ['WhatsApp booking and order flows', 'Follow-ups that never get forgotten', 'Leads from ads straight to your team'],
  },
  {
    icon: Bot, title: 'AI assistants', text: 'An AI that answers your customers on WhatsApp, Instagram and your website, from your own prices and details, day and night.',
    points: ['English, Telugu, Hindi and mixes', 'Books, takes orders, answers questions', 'Hands over to your team when needed'],
  },
]

const STEPS = [
  { icon: Search, title: 'Understand', text: 'A free call to learn your business, your customers and what is working today.' },
  { icon: Target, title: 'Plan', text: 'A growth plan: the offers, the ads, the content and the automations, with a monthly budget you agree to.' },
  { icon: Sparkles, title: 'Make and run', text: 'We make the videos and designs, run the ads and switch on WhatsApp automation and AI replies.' },
  { icon: LineChart, title: 'Measure and improve', text: 'A simple report every month: enquiries, bookings and sales, and what we change next.' },
]

const PLATFORM = [
  { icon: Inbox, title: 'One inbox', text: 'WhatsApp and Instagram chats for the whole team.' },
  { icon: Bot, title: 'AI replies', text: 'Answers from your own details, day and night.' },
  { icon: CalendarCheck, title: 'Bookings and bills', text: 'Appointments, reminders and GST bills on WhatsApp.' },
  { icon: Store, title: 'Store and website', text: 'Your own online store and business website.' },
  { icon: TrendingUp, title: 'Leads and follow-ups', text: 'Every enquiry tracked until it is won.' },
  { icon: Megaphone, title: 'Campaigns', text: 'Offers sent to the right customers on WhatsApp.' },
  { icon: Camera, title: 'Instagram', text: 'DMs, comments, auto replies and posting.' },
  { icon: BarChart3, title: 'Reports', text: 'Sales, bookings and where customers came from.' },
]

const FAQ = [
  ['What kind of businesses do you work with?', 'Local and growing businesses: salons, clinics, gyms, shops, restaurants, service centres, coaching centres, real estate and more. The use cases above show how we help each one.'],
  ['Do I have to take every service?', 'No. Take only what you need: just ads, just videos, just the AI platform, or everything together as your full marketing partner.'],
  ['Who pays for the ads?', 'You decide the monthly ad budget. It is paid to Meta or Google for the ads themselves; our work to plan, make and run them is separate, and agreed with you before we start.'],
  ['How soon will I see results?', 'WhatsApp automation and AI replies work from the first day. Ads usually start bringing enquiries in the first weeks, and get better as we learn what works for your business.'],
  ['Is your WhatsApp official?', `Yes. Our platform uses Meta's official WhatsApp Business Platform, and ${BRAND.company} is a Meta Tech Provider, so your number is safe from the bans unofficial tools cause.`],
  ['Can the AI talk in Telugu or Hindi?', 'Yes. It understands English, Telugu, Hindi and mixed messages, and replies the same way. It only answers from what you teach it.'],
  ['How do we start?', `Fill the form below or WhatsApp us at ${BRAND.phoneShown}. We call you, understand your business and send you a free growth plan.`],
]

const HERO_CHAT = [
  { from: 'customer' as const, text: 'Saw your reel on Instagram. Bridal makeup price?' },
  { from: 'business' as const, text: 'Thank you! Bridal makeup starts at ₹12,000, with a free trial session. Would you like to book the trial?' },
  { from: 'customer' as const, text: 'Yes, Saturday' },
  { from: 'business' as const, text: 'Booked: Bridal trial, Saturday 11:00 am. See you!', card: 'From an Instagram ad · Booking confirmed' },
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
          <Link href="/" className="flex items-center gap-2.5 min-w-0" aria-label={`${BRAND.company} home`}>
            <span className="h-9 w-9 shrink-0 rounded-lg bg-[#1D5BEA] text-white inline-flex items-center justify-center"><TrendingUp size={20} /></span>
            <span className="text-[18px] font-bold tracking-tight truncate">{BRAND.company}</span>
          </Link>
          <DesktopNav />
          <div className="flex items-center gap-2">
            <Link href="/login" className="hidden sm:inline-flex h-10 items-center rounded-lg px-4 text-[14.5px] font-semibold text-[#0E1B3D] hover:bg-[#f4f6fa]">Log in</Link>
            <a href="#demo" className="hidden sm:inline-flex h-10 items-center rounded-lg bg-[#1D5BEA] hover:bg-[#174bc4] px-4 text-[14.5px] font-semibold text-white">Free growth plan</a>
            <MobileMenu />
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className={`${section} pt-12 pb-16 sm:pt-20 sm:pb-24 bg-[#f4f6fa] border-b border-[#e3e8f2]`}>
          <div className={`${wrap} grid gap-12 lg:grid-cols-[1.15fr_1fr] items-center`}>
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-[#d5ddeb] bg-white px-3 py-1 text-[13px] font-semibold text-[#4a5672]">
                <Sparkles size={15} className="text-[#1D5BEA]" /> Digital marketing and AI solutions partner
              </p>
              <h1 className="mt-5 text-[36px] sm:text-[52px] font-bold leading-[1.08] tracking-tight">
                We grow your business. <span className="text-[#1D5BEA]">Strategy, ads, content and AI, all in one place.</span>
              </h1>
              <p className="mt-5 max-w-xl text-[17px] sm:text-[19px] leading-relaxed text-[#4a5672]">
                We plan how you grow, run your ads, edit your videos and photos, and automate your WhatsApp with AI, so more people find you, message you and buy from you.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <a href="#demo" className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#1D5BEA] hover:bg-[#174bc4] px-6 text-[16px] font-bold text-white">Get a free growth plan <ArrowRight size={18} /></a>
                <a href={whatsappUs(`Hi, I want to grow my business with ${BRAND.company}.`)} target="_blank" rel="noopener noreferrer" className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-[#d5ddeb] bg-white px-6 text-[16px] font-semibold text-[#0E1B3D] hover:border-[#1D5BEA]"><MessageCircle size={18} /> WhatsApp us</a>
              </div>
              <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[14px] font-medium text-[#4a5672]">
                {['Ads', 'Reels and videos', 'Photos and design', 'Automation', 'AI assistants'].map((t) => (
                  <li key={t} className="inline-flex items-center gap-1.5"><Check size={16} className="text-[#1D5BEA]" /> {t}</li>
                ))}
              </ul>
            </div>
            <div className="relative">
              <PhoneChat name="Glow Bridal Studio" lines={HERO_CHAT} />
              <p className="mt-3 text-center text-[12.5px] text-[#6B7894]">An example: an ad brings the customer, the AI books her.</p>
            </div>
          </div>
        </section>

        {/* The full loop */}
        <section className={`${section} py-12 border-b border-[#e3e8f2]`}>
          <div className={`${wrap} grid grid-cols-2 lg:grid-cols-4 gap-6`}>
            {[
              ['Get found', 'Ads, reels and posts that reach the right people near you'],
              ['Get messages', 'Every enquiry lands in one WhatsApp and Instagram inbox'],
              ['Get bookings', 'AI and automations reply, book and take orders at once'],
              ['Get them back', 'Follow-ups, offers and reviews bring customers again'],
            ].map(([n, t], i) => (
              <div key={n}>
                <p className="text-[13px] font-bold text-[#8a94a8]">Step {i + 1}</p>
                <p className="mt-0.5 text-[22px] sm:text-[26px] font-bold tracking-tight text-[#1D5BEA]">{n}</p>
                <p className="mt-1 text-[14.5px] text-[#4a5672]">{t}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Services */}
        <section id="services" className={`${section} py-16 sm:py-24 scroll-mt-16`}>
          <div className={wrap}>
            <div className="max-w-2xl">
              <p className={eyebrow}>What we do</p>
              <h2 className={h2}>One partner for everything that grows your business</h2>
              <p className={lead}>No more running between an ad agency, a video editor, a designer and a software company. One team, one plan, one place to see results.</p>
            </div>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {SERVICES.map((s) => {
                const Icon = s.icon
                return (
                  <div key={s.title} className="rounded-2xl border border-[#e3e8f2] bg-white p-6 flex flex-col">
                    <span className="h-11 w-11 rounded-xl bg-[#eef3fe] text-[#1D5BEA] inline-flex items-center justify-center"><Icon size={22} /></span>
                    <h3 className="mt-4 text-[19px] font-bold">{s.title}</h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-[#4a5672]">{s.text}</p>
                    <ul className="mt-4 space-y-2 border-t border-[#eef1f6] pt-4">
                      {s.points.map((p) => <li key={p} className="flex gap-2.5 text-[14.5px]"><Check size={16} className="mt-0.5 shrink-0 text-[#1D5BEA]" /> {p}</li>)}
                    </ul>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* How we work */}
        <section id="how" className={`${section} py-16 sm:py-24 bg-[#0E1B3D] text-white scroll-mt-16`}>
          <div className={wrap}>
            <div className="max-w-2xl">
              <p className="text-[13px] font-bold uppercase tracking-wider text-[#9db5ef]">How we work</p>
              <h2 className="mt-2 text-[28px] sm:text-[38px] font-bold leading-[1.15] tracking-tight">A plan first. Then we do the work, and show you the results.</h2>
            </div>
            <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s, i) => {
                const Icon = s.icon
                return (
                  <li key={s.title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                    <div className="flex items-center justify-between">
                      <Icon size={22} className="text-[#9db5ef]" />
                      <span className="text-[13px] font-bold text-[#9db5ef]">0{i + 1}</span>
                    </div>
                    <h3 className="mt-4 text-[18px] font-bold">{s.title}</h3>
                    <p className="mt-1.5 text-[14.5px] leading-relaxed text-[#c5d5fa]">{s.text}</p>
                  </li>
                )
              })}
            </ol>
          </div>
        </section>

        {/* Industries */}
        <section id="industries" className={`${section} py-16 sm:py-24 scroll-mt-16`}>
          <div className={wrap}>
            <div className="text-center max-w-2xl mx-auto mb-10">
              <p className={eyebrow}>Industries</p>
              <h2 className={h2}>How we grow businesses like yours</h2>
              <p className={lead}>Pick your kind of business and see what changes.</p>
            </div>
            <UseCases />
          </div>
        </section>

        {/* Platform */}
        <section id="platform" className={`${section} py-16 sm:py-24 bg-[#f4f6fa] border-y border-[#e3e8f2] scroll-mt-16`}>
          <div className={`${wrap} grid gap-12 lg:grid-cols-[1fr_1.2fr] items-start`}>
            <div>
              <p className={eyebrow}>Our AI platform</p>
              <h2 className={h2}>The software that turns every enquiry into a customer</h2>
              <p className={lead}>Ads and content bring people in. {BRAND.name}, our own platform, makes sure not one of them is missed: it answers, books, sells and follows up, and shows you where every customer came from.</p>
              <ul className="mt-6 space-y-3">
                {[
                  'Official WhatsApp Business Platform, with Instagram too',
                  'AI replies in English, Telugu, Hindi and mixes',
                  'Works on the phone with our Android app',
                ].map((t) => <li key={t} className="flex gap-3 text-[15.5px]"><Check size={18} className="mt-0.5 shrink-0 text-[#1D5BEA]" /> {t}</li>)}
              </ul>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <MetaTechProviderBadge size="sm" />
                <span className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-[#4a5672]"><Languages size={16} className="text-[#1D5BEA]" /> 3 languages</span>
              </div>
              <Link href="/signup" className="mt-8 inline-flex h-11 items-center gap-2 rounded-lg bg-[#1D5BEA] hover:bg-[#174bc4] px-5 font-semibold text-white">Try the platform free for 14 days <ArrowRight size={17} /></Link>
            </div>
            <div className="grid gap-4 grid-cols-1 min-[420px]:grid-cols-2">
              {PLATFORM.map((f) => {
                const Icon = f.icon
                return (
                  <div key={f.title} className="rounded-2xl border border-[#e3e8f2] bg-white p-5">
                    <Icon size={20} className="text-[#1D5BEA]" />
                    <p className="mt-3 font-bold">{f.title}</p>
                    <p className="mt-1 text-[14px] leading-relaxed text-[#4a5672]">{f.text}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className={`${section} py-16 sm:py-24 scroll-mt-16`}>
          <div className={wrap}>
            <div className="text-center max-w-2xl mx-auto">
              <p className={eyebrow}>Pricing</p>
              <h2 className={h2}>Start with the platform. Add our team when you are ready.</h2>
              <p className={lead}>Platform plans are monthly, with 14 days free. Ads, videos and design are planned with you and priced to your needs.</p>
            </div>
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {plans.map((plan) => {
                const featured = plan.id === 'pro_1'
                return (
                  <div key={plan.id} className={`relative rounded-2xl bg-white p-6 flex flex-col ${featured ? 'border-2 border-[#1D5BEA]' : 'border border-[#e3e8f2]'}`}>
                    {featured && <span className="absolute -top-3 left-6 rounded-full bg-[#1D5BEA] px-3 py-0.5 text-[12px] font-bold text-white">With our marketing team</span>}
                    <h3 className="text-[19px] font-bold">{plan.name}</h3>
                    <p className="mt-1 text-[14px] text-[#6B7894] min-h-[42px]">{plan.tagline}</p>
                    <p className="mt-4"><span className="text-[34px] font-bold tracking-tight">{rupees(plan.amountPaise)}</span><span className="text-[#6B7894]"> / month</span></p>
                    <ul className="mt-5 space-y-2.5 flex-1">
                      {(featured ? plan.features.slice(-6) : plan.features.slice(0, 6)).map((f) => <li key={f} className="flex gap-2.5 text-[14.5px]"><Check size={17} className="mt-0.5 shrink-0 text-[#1D5BEA]" /> {f}</li>)}
                    </ul>
                    <Link href={`/signup?plan=${plan.id}`} className={`mt-6 inline-flex h-11 items-center justify-center rounded-lg font-semibold ${featured ? 'bg-[#1D5BEA] hover:bg-[#174bc4] text-white' : 'border border-[#d5ddeb] text-[#0E1B3D] hover:border-[#1D5BEA]'}`}>Start free</Link>
                  </div>
                )
              })}
            </div>
            <div className="mt-6 rounded-2xl border border-[#e3e8f2] bg-[#f4f6fa] p-6 flex flex-col md:flex-row md:items-center gap-4 justify-between">
              <div>
                <p className="text-[17px] font-bold">Want us to run your marketing?</p>
                <p className="mt-1 text-[15px] text-[#4a5672]">Ads management, reels, photos and a full growth plan, as a monthly package made for your business.</p>
              </div>
              <a href="#demo" className="shrink-0 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0E1B3D] px-5 font-semibold text-white">Get a custom plan <ArrowRight size={17} /></a>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className={`${section} py-16 sm:py-24 bg-[#f4f6fa] border-y border-[#e3e8f2] scroll-mt-16`}>
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
                    <span className="h-7 w-7 shrink-0 rounded-full border border-[#d5ddeb] bg-white inline-flex items-center justify-center text-[#1D5BEA] transition-transform group-open:rotate-45" aria-hidden>+</span>
                  </summary>
                  <p className="mt-3 text-[15.5px] leading-relaxed text-[#4a5672]">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Free growth plan */}
        <section id="demo" className={`${section} py-16 sm:py-24 scroll-mt-16`}>
          <div className={`${wrap} grid gap-10 lg:grid-cols-2 items-start`}>
            <div>
              <p className={eyebrow}>Free growth plan</p>
              <h2 className={h2}>Tell us about your business. We will show you how to grow it.</h2>
              <p className={lead}>A short call with our team. You get a clear plan: what to fix first, which ads to run, what content to make, and what to automate.</p>
              <ul className="mt-6 space-y-3">
                {['A 20-minute call, free', 'A written growth plan for your business', 'No pressure to buy anything'].map((t) => (
                  <li key={t} className="flex gap-3 text-[15.5px]"><Check size={18} className="mt-0.5 shrink-0 text-[#1D5BEA]" /> {t}</li>
                ))}
              </ul>
              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <a href={whatsappUs(`Hi, I want a free growth plan from ${BRAND.company}.`)} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0E1B3D] px-5 font-semibold text-white"><MessageCircle size={18} /> WhatsApp us</a>
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
            <p className="flex items-center gap-2.5 text-white text-[18px] font-bold"><span className="h-9 w-9 rounded-lg bg-[#1D5BEA] inline-flex items-center justify-center"><TrendingUp size={20} /></span> {BRAND.company}</p>
            <p className="mt-3 max-w-sm text-[14.5px] leading-relaxed">Your digital marketing and AI solutions partner: growth strategy, ads, video and photo editing, workflow automation and AI assistants.</p>
            <MetaTechProviderBadge variant="dark" size="sm" className="mt-5" />
          </div>
          <div>
            <p className="text-white font-semibold">What we do</p>
            <ul className="mt-3 space-y-2 text-[14.5px]">
              <li><a href="#services" className="hover:text-white">Services</a></li>
              <li><a href="#industries" className="hover:text-white">Industries</a></li>
              <li><a href="#platform" className="hover:text-white">AI platform</a></li>
              <li><Link href="/pricing" className="hover:text-white">Platform pricing</Link></li>
              <li><Link href="/developers" className="hover:text-white">API for developers</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-white font-semibold">Company</p>
            <ul className="mt-3 space-y-2 text-[14.5px]">
              <li><a href={whatsappUs(`Hi, I have a question for ${BRAND.company}.`)} target="_blank" rel="noopener noreferrer" className="hover:text-white">Contact on WhatsApp</a></li>
              <li><Link href="/login" className="hover:text-white">Log in</Link></li>
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
