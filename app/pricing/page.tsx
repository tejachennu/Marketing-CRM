import Link from 'next/link'
import { Check, MessageCircle } from 'lucide-react'
import { GST_PERCENT, PLANS, planPrice } from '@/lib/plans'
import { messagePrice } from '@/lib/message-wallet'
import { TRIAL_DAYS } from '@/lib/billing'

export const metadata = {
  title: 'Pricing | WAMA CRM by Magnetora AI',
  description: 'WAMA CRM plans: Starter ₹999, Growth ₹2,500 and Pro from ₹6,000 a month. 14-day free trial. WhatsApp messages at Meta\'s price.',
}

// Prices can change through the environment (Meta's message price): build the page on each request
export const dynamic = 'force-dynamic'

const FAQ = [
  { q: 'Is there a free trial?', a: `Yes, ${TRIAL_DAYS} days on every plan. No payment is taken during the trial.` },
  { q: 'Do I need my own WhatsApp Business number?', a: 'Not on Starter: booking confirmations and reminders go from WAMA\'s own WhatsApp number, with your business name in every message. On Growth and Pro you connect your own number and get the full team inbox.' },
  { q: 'What does a WhatsApp message cost on Starter?', a: 'Exactly what Meta charges, with nothing added. You top up a message wallet and each message takes its price. A message that does not reach the customer is not charged.' },
  { q: 'Can I change plan later?', a: 'Yes. An upgrade starts at once and you pay only the difference for the days left in the month. A downgrade starts on your next bill date.' },
  { q: 'What are ads support and video campaigns?', a: 'Magnetora\'s team runs your Google and Meta ads (Growth and Pro) and makes video campaigns for you every month (Pro). You ask for them from the app.' },
  { q: 'Is GST included?', a: `Prices are plus ${GST_PERCENT}% GST. You get a GST invoice for every payment.` },
  { q: 'How do I pay?', a: 'Through Razorpay: UPI autopay, debit or credit card, or net banking. Stop any time; you keep your plan until the end of the month you paid for.' },
]

export default function PricingPage() {
  const utility = messagePrice('utility')
  return (
    <main className="min-h-screen bg-[#f4f6fa] text-[#0E1B3D]">
      <header className="bg-white border-b border-[#e3e8f2]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <Link href="/" className="text-[18px] font-extrabold tracking-tight">WAMA CRM</Link>
          <div className="flex items-center gap-2">
            <Link href="/login" className="h-10 px-4 inline-flex items-center rounded-lg text-[14px] font-semibold text-[#4a5672] hover:text-[#0E1B3D]">Sign in</Link>
            <Link href="/signup" className="h-10 px-4 inline-flex items-center rounded-lg text-[14px] font-bold bg-[#1D5BEA] hover:bg-[#174bc4] text-white">Start free trial</Link>
          </div>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-14 text-center">
        <h1 className="text-[30px] sm:text-[40px] font-extrabold tracking-tight leading-tight">Simple monthly plans</h1>
        <p className="mt-3 text-[16px] sm:text-[17px] text-[#4a5672] max-w-2xl mx-auto">
          {TRIAL_DAYS}-day free trial on every plan. Prices are per month for your whole business, plus {GST_PERCENT}% GST.
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {PLANS.map((plan) => (
          <div key={plan.id} className={`bg-white rounded-2xl border p-5 flex flex-col min-w-0 ${plan.id === 'growth' ? 'border-[#1D5BEA]' : 'border-[#e3e8f2]'}`}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[18px] font-extrabold">{plan.name}</h2>
              {plan.id === 'growth' && <span className="text-[11.5px] font-bold px-2 py-0.5 rounded-full bg-[#1D5BEA] text-white">Popular</span>}
            </div>
            <p className="mt-2"><span className="text-[28px] font-extrabold tracking-tight">{planPrice(plan)}</span><span className="text-[13px] font-semibold text-[#6B7894]"> / month</span></p>
            <p className="text-[13.5px] text-[#4a5672] mt-1 leading-snug">{plan.tagline}</p>
            {plan.whatsapp === 'shared' && (
              <p className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#4a5672]">
                <MessageCircle size={14} className="shrink-0 text-[#1D5BEA]" /> No WhatsApp setup needed
              </p>
            )}
            <ul className="mt-4 space-y-2.5 flex-1">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-[13.5px] leading-snug">
                  <Check size={15} className="shrink-0 mt-0.5 text-[#1D5BEA]" /> <span className="min-w-0">{feature}</span>
                </li>
              ))}
            </ul>
            <Link href={`/signup?plan=${plan.id}`} className={`mt-5 h-11 rounded-lg inline-flex items-center justify-center text-[14px] font-bold ${plan.id === 'growth' ? 'bg-[#1D5BEA] hover:bg-[#174bc4] text-white' : 'border border-[#d5ddeb] hover:border-[#1D5BEA] hover:text-[#1D5BEA]'}`}>
              Start free trial
            </Link>
          </div>
        ))}
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 mt-6">
        <div className="bg-white rounded-2xl border border-[#e3e8f2] p-5 sm:p-6 flex flex-col md:flex-row md:items-center gap-4 justify-between">
          <div className="min-w-0">
            <h2 className="text-[18px] font-extrabold">WhatsApp messages at Meta&apos;s price, no extra charge</h2>
            <p className="text-[14.5px] text-[#4a5672] mt-1">
              On Starter, a booking confirmation or reminder costs what Meta charges, about ₹{utility.toLocaleString('en-IN', { maximumFractionDigits: 3 })} a message today.
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
