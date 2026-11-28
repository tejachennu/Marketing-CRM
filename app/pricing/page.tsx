import Link from 'next/link'
import { Check, MessageCircle, Smartphone, Monitor } from 'lucide-react'
import { ADS_OFFER, GST_PERCENT, PLANS, POPULAR_PLAN, planPrice, type Plan } from '@/lib/plans'
import { messagePrice } from '@/lib/message-wallet'
import { TRIAL_DAYS } from '@/lib/billing'
import { BRAND, whatsappUs } from '@/lib/brand'

export const metadata = {
  title: 'Pricing | WAMA CRM by Magnetora AI',
  description: 'Business ₹999, Growth ₹1,499 (we build your website), Growth + Content ₹2,499 (videos and posters every month), Ads on request. 14-day free trial. WhatsApp messages at Meta\'s price.',
}

// Prices can change through the environment (Meta's message price): build the page on each request
export const dynamic = 'force-dynamic'

/** The four cards at the top (owner's pricing sheet, 28 Nov 2026); Starter and Pro sit under "More plans". */
const MAIN = ['business', 'growth', 'content']
const MORE = ['starter', 'pro_1', 'pro_2', 'pro_3']

const FAQ = [
  { q: 'Is there a free trial?', a: `Yes, ${TRIAL_DAYS} days on every plan. No payment is taken during the trial.` },
  { q: 'Does it work on my phone?', a: 'Yes. Every plan has the mobile app for Android and iPhone, and the web app for any computer or laptop. Your whole team can use it.' },
  { q: 'Do I need my own WhatsApp Business number?', a: 'From Business (₹999) up, you connect your own number and get the team inbox, AI replies and campaigns. Starter (₹300) works without it: booking and order messages go from WAMA\'s own WhatsApp number, with your business name in every message.' },
  { q: 'Do you really build the website?', a: 'Yes. On Growth and above our team builds it for you: a booking site for a salon, clinic or gym, or an online store for a shop, boutique or café. It can be on our free address or your own domain.' },
  { q: 'What do I get with Growth + Content?', a: 'Everything in Growth, plus 3 short videos (reels) and 2 designed posters every month, made by our team in your brand colours and ready for Instagram, Facebook and WhatsApp Status.' },
  { q: 'How do ads work?', a: 'Our team plans, targets and designs your Google and Meta ads, and every lead lands in your WhatsApp inbox. The price depends on your business, so talk to us. The ad budget is paid separately to Google or Meta.' },
  { q: 'What does a WhatsApp message cost?', a: 'Exactly what Meta charges, with nothing added. You top up a message wallet and each message takes its price. A message that does not reach the customer is not charged.' },
  { q: 'Can I change plan later?', a: 'Yes. An upgrade starts at once and you pay only the difference for the days left in the month. A downgrade starts on your next bill date.' },
  { q: 'Is GST included?', a: `Prices are plus ${GST_PERCENT}% GST. You get a GST invoice for every payment.` },
  { q: 'How do I pay?', a: 'Through Razorpay: UPI autopay, debit or credit card, or net banking. Stop any time; you keep your plan until the end of the month you paid for.' },
]

/** A plan's lines: "Everything in Business, plus:" is a heading, the rest get a tick. */
function Features({ items, dark = false, small = false }: { items: readonly string[]; dark?: boolean; small?: boolean }) {
  return (
    <ul className={`${small ? 'mt-3 space-y-2' : 'mt-4 space-y-2.5'} flex-1`}>
      {items.map((feature) => feature.endsWith(':') ? (
        <li key={feature} className={`pt-1 text-[12px] font-extrabold uppercase tracking-wide ${dark ? 'text-[#8fa0c4]' : 'text-[#8a94a8]'}`}>{feature.slice(0, -1)}</li>
      ) : (
        <li key={feature} className={`flex items-start gap-2 ${small ? 'text-[13px]' : 'text-[14px]'} leading-snug ${dark ? 'text-[#d4dbea]' : 'text-[#4a5672]'}`}>
          <Check size={15} strokeWidth={2.6} className={`shrink-0 mt-0.5 ${dark ? 'text-white' : 'text-[#008069]'}`} /> <span className="min-w-0">{feature}</span>
        </li>
      ))}
    </ul>
  )
}

function PlanCard({ plan }: { plan: Plan }) {
  const popular = plan.id === POPULAR_PLAN
  return (
    <div className={`relative bg-white rounded-2xl p-5 sm:p-6 flex flex-col min-w-0 ${popular ? 'border-2 border-[#008069]' : 'border border-[#e3e8f2]'}`}>
      {popular && <span className="absolute -top-3 left-5 text-[11.5px] font-extrabold uppercase tracking-wide px-3 py-1 rounded-full bg-[#008069] text-white">Most popular</span>}
      <h2 className="text-[19px] font-extrabold">{plan.name}</h2>
      <p className="text-[14px] text-[#6B7894] mt-1 leading-snug sm:min-h-[40px]">{plan.tagline}</p>
      <p className="mt-3 whitespace-nowrap"><span className="text-[36px] font-extrabold tracking-tight tabular-nums">{planPrice(plan)}</span><span className="text-[14px] font-semibold text-[#6B7894]"> / month</span></p>
      <Link href={`/signup?plan=${plan.id}`} className={`mt-4 h-11 rounded-xl inline-flex items-center justify-center text-[15px] font-bold ${popular ? 'bg-[#008069] hover:bg-[#006d5b] text-white' : 'border-2 border-[#008069] text-[#008069] hover:bg-[#e7f5f0]'}`}>
        Start free trial
      </Link>
      <Features items={plan.id === 'business' ? ['What you get:', ...plan.features] : plan.features} />
    </div>
  )
}

export default function PricingPage() {
  const utility = messagePrice('utility')
  const byId = (id: string) => PLANS.find((plan) => plan.id === id)!
  return (
    <main className="min-h-screen bg-[#f4f6fa] text-[#0E1B3D] overflow-x-hidden">
      <header className="bg-white border-b border-[#e3e8f2]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <Link href="/" className="text-[16px] sm:text-[18px] font-extrabold tracking-tight whitespace-nowrap">{BRAND.name}</Link>
          <div className="flex items-center gap-1 sm:gap-2">
            <Link href="/login" className="h-10 px-2 sm:px-4 inline-flex items-center rounded-lg text-[14px] font-semibold text-[#4a5672] hover:text-[#0E1B3D] whitespace-nowrap">Sign in</Link>
            <Link href="/signup" className="h-10 px-3 sm:px-4 inline-flex items-center rounded-lg text-[13px] sm:text-[14px] font-bold bg-[#008069] hover:bg-[#006d5b] text-white whitespace-nowrap">Start free trial</Link>
          </div>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-14 text-center">
        <h1 className="text-[30px] sm:text-[42px] font-extrabold tracking-tight leading-tight">Simple plans to grow your business</h1>
        <p className="mt-3 text-[16px] sm:text-[17px] text-[#4a5672] max-w-2xl mx-auto">
          WhatsApp, AI and marketing in one place. {TRIAL_DAYS}-day free trial on every plan. Prices are per month for your whole business, plus {GST_PERCENT}% GST.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <span className="inline-flex items-center gap-2 h-9 px-3.5 rounded-full bg-white border border-[#e3e8f2] text-[13.5px] font-semibold"><Smartphone size={16} className="text-[#008069]" /> Mobile app for Android and iPhone</span>
          <span className="inline-flex items-center gap-2 h-9 px-3.5 rounded-full bg-white border border-[#e3e8f2] text-[13.5px] font-semibold"><Monitor size={16} className="text-[#008069]" /> Web app on any computer</span>
        </div>
      </section>

      {/* Business · Growth · Growth + Content · Ads */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-6">
        {MAIN.map((id) => <PlanCard key={id} plan={byId(id)} />)}
        <div className="relative bg-[#0E1B3D] text-white rounded-2xl p-5 sm:p-6 flex flex-col min-w-0">
          <h2 className="text-[19px] font-extrabold">{ADS_OFFER.name}</h2>
          <p className="text-[14px] text-[#b9c3d9] mt-1 leading-snug sm:min-h-[40px]">{ADS_OFFER.tagline}</p>
          <p className="mt-3"><span className="text-[36px] font-extrabold tracking-tight">Custom</span></p>
          <a href={whatsappUs('Hi, I would like to know about running ads for my business.')} target="_blank" rel="noopener noreferrer" className="mt-4 h-11 rounded-xl inline-flex items-center justify-center gap-2 text-[15px] font-bold bg-white text-[#0E1B3D] hover:bg-[#eef1f6]">
            <MessageCircle size={17} /> Contact sales
          </a>
          <Features dark items={['Done for you:', ...ADS_OFFER.features]} />
          <p className="mt-5 text-[13.5px] text-[#b9c3d9]">Talk to us on WhatsApp<span className="block text-[17px] font-bold text-white mt-0.5">{BRAND.phoneShown}</span></p>
        </div>
      </section>

      {/* Starter (no own WhatsApp) and the bigger Pro plans */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 mt-12">
        <h2 className="text-[20px] sm:text-[22px] font-extrabold">More plans</h2>
        <p className="text-[14.5px] text-[#4a5672] mt-1">Start small without your own WhatsApp, or go bigger with ads and video campaigns every month.</p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {MORE.map((id) => {
            const plan = byId(id)
            return (
              <div key={id} className="bg-white rounded-2xl border border-[#e3e8f2] p-5 flex flex-col min-w-0">
                <h3 className="text-[17px] font-extrabold">{plan.name}</h3>
                <p className="mt-1 whitespace-nowrap"><span className="text-[26px] font-extrabold tracking-tight tabular-nums">{planPrice(plan)}</span><span className="text-[13px] font-semibold text-[#6B7894]"> / month</span></p>
                <p className="text-[13.5px] text-[#4a5672] mt-1 leading-snug">{plan.tagline}</p>
                {plan.whatsapp === 'shared' && (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#4a5672]">
                    <MessageCircle size={14} className="shrink-0 text-[#008069]" /> No WhatsApp setup needed
                  </p>
                )}
                <Features small items={plan.features} />
                <Link href={`/signup?plan=${plan.id}`} className="mt-4 h-10 rounded-lg inline-flex items-center justify-center text-[14px] font-bold border border-[#d5ddeb] hover:border-[#008069] hover:text-[#008069]">
                  Start free trial
                </Link>
              </div>
            )
          })}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 mt-6">
        <div className="bg-white rounded-2xl border border-[#e3e8f2] p-5 sm:p-6 flex flex-col md:flex-row md:items-center gap-4 justify-between">
          <div className="min-w-0">
            <h2 className="text-[18px] font-extrabold">WhatsApp messages at Meta&apos;s price, no extra charge</h2>
            <p className="text-[14.5px] text-[#4a5672] mt-1">
              A booking confirmation or reminder costs what Meta charges, about ₹{utility.toLocaleString('en-IN', { maximumFractionDigits: 3 })} a message today, paid from your message wallet.
              A salon with 300 bookings a month (confirmation, reminder and thank-you) spends about ₹{Math.round(utility * 900).toLocaleString('en-IN')} on messages.
            </p>
          </div>
          <p className="text-[13px] text-[#6B7894] md:max-w-[240px]">Messages that do not reach the customer are not charged. Wallet money does not expire.</p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 mt-12 pb-16">
        <h2 className="text-[22px] sm:text-[26px] font-extrabold text-center">Questions</h2>
        <div className="mt-5 bg-white rounded-2xl border border-[#e3e8f2] divide-y divide-[#eef1f6]">
          {FAQ.map((item) => (
            <details key={item.q} className="group p-4 sm:p-5">
              <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-[15px] font-bold">
                {item.q}
                <span className="text-[#6B7894] group-open:rotate-45 transition-transform text-[20px] leading-none" aria-hidden="true">+</span>
              </summary>
              <p className="mt-2 text-[14.5px] text-[#4a5672] leading-relaxed">{item.a}</p>
            </details>
          ))}
        </div>
        <p className="mt-6 text-center text-[13.5px] text-[#6B7894]">
          <Link href="/terms" className="underline underline-offset-2">Terms</Link> · <Link href="/privacy" className="underline underline-offset-2">Privacy</Link>
        </p>
      </section>
    </main>
  )
}
