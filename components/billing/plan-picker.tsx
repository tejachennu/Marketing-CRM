'use client'

import { Check, Loader2, MessageCircle, Wallet } from 'lucide-react'

export interface PlanView {
  id: string
  name: string
  tagline: string
  price: number
  whatsapp: 'shared' | 'own'
  features: string[]
}

const rupees = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const card = 'bg-white dark:bg-[#111b21] rounded-2xl border border-[#e3e8f2] dark:border-slate-800'

/**
 * Every plan side by side, with the one the workspace is on marked. Choosing another one starts the
 * change (free on the trial; an upgrade pays the difference; a downgrade starts on the bill date).
 */
export function PlanPicker({ plans, currentId, pendingId, canChange, busyId, onChoose }: {
  plans: PlanView[]
  currentId: string
  pendingId?: string | null
  canChange: boolean
  busyId: string | null
  onChoose: (plan: PlanView) => void
}) {
  const currentPrice = plans.find((plan) => plan.id === currentId)?.price ?? 0
  return (
    <section id="plans" aria-labelledby="plans-title" className={`${card} p-4 sm:p-6`}>
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
        <div>
          <h2 id="plans-title" className="text-[20px] sm:text-[22px] font-extrabold text-[#0E1B3D] dark:text-white">Plans</h2>
          <p className="text-[14.5px] text-[#4a5672] dark:text-slate-400 mt-0.5">Monthly, plus 18% GST. Change any time.</p>
        </div>
        <p className="text-[13.5px] text-[#6B7894]">Upgrade: pay only the difference for the days left. Downgrade: starts on your next bill date.</p>
      </div>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        {plans.map((plan) => {
          const current = plan.id === currentId
          const pending = plan.id === pendingId
          const label = current ? 'Your plan' : pending ? 'Starts on your bill date' : plan.price > currentPrice ? `Upgrade to ${plan.name}` : `Switch to ${plan.name}`
          return (
            <div key={plan.id} className={`rounded-xl border p-4 flex flex-col min-w-0 ${current ? 'border-[#1D5BEA] bg-[#f4f7fe] dark:bg-blue-950/20' : 'border-[#e3e8f2] dark:border-slate-800'}`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[16px] font-extrabold text-[#0E1B3D] dark:text-white">{plan.name}</h3>
                {current && <span className="text-[11.5px] font-bold px-2 py-0.5 rounded-full bg-[#1D5BEA] text-white">Current</span>}
              </div>
              <p className="mt-1"><span className="text-[24px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white">{rupees(plan.price)}</span><span className="text-[13px] font-semibold text-[#6B7894]"> / month</span></p>
              <p className="text-[13px] text-[#4a5672] dark:text-slate-400 mt-1 leading-snug">{plan.tagline}</p>
              {plan.whatsapp === 'shared' && (
                <p className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#4a5672] dark:text-slate-300">
                  <MessageCircle size={14} className="shrink-0 text-[#1D5BEA]" /> No WhatsApp setup needed
                </p>
              )}
              <ul className="mt-3 space-y-2 flex-1">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-[13px] leading-snug text-[#0E1B3D] dark:text-slate-200">
                    <Check size={15} className="shrink-0 mt-0.5 text-[#1D5BEA]" /> <span className="min-w-0">{feature}</span>
                  </li>
                ))}
              </ul>
              {canChange && (
                <button type="button" disabled={current || pending || busyId !== null} onClick={() => onChoose(plan)}
                  className={`mt-4 h-10 w-full rounded-lg text-[13.5px] font-bold inline-flex items-center justify-center gap-2 transition-colors ${current || pending ? 'bg-[#eef1f6] text-[#6B7894] dark:bg-slate-800 cursor-default' : 'bg-[#1D5BEA] hover:bg-[#174bc4] text-white cursor-pointer disabled:opacity-50'}`}>
                  {busyId === plan.id && <Loader2 size={15} className="animate-spin" />} {label}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** The message wallet: WhatsApp messages sent from WAMA's number, at Meta's price. */
export function MessageWallet({ balance, price, history, options, canPay, busy, onTopup }: {
  balance: number
  price: number
  history: { kind: string; amount: number; category: string | null; date: string }[]
  options: number[]
  canPay: boolean
  busy: boolean
  onTopup: (amount: number) => void
}) {
  const low = balance < 100
  const messagesLeft = price > 0 ? Math.floor(balance / price) : null
  return (
    <section aria-labelledby="message-wallet" className={`${card} p-5 sm:p-6`}>
      <div className="flex items-center gap-3">
        <span className="h-10 w-10 rounded-xl bg-[#eef1f6] dark:bg-slate-800 text-[#1D5BEA] flex items-center justify-center shrink-0"><Wallet size={20} /></span>
        <div className="min-w-0">
          <h2 id="message-wallet" className="text-[18px] font-extrabold text-[#0E1B3D] dark:text-white">Message wallet</h2>
          <p className="text-[13.5px] text-[#4a5672] dark:text-slate-400">WhatsApp messages at Meta&apos;s price, no extra charge</p>
        </div>
      </div>
      <div className={`mt-4 rounded-xl p-4 ${low ? 'bg-[#fdf0f0] dark:bg-red-950/30' : 'bg-[#f4f6fa] dark:bg-slate-800/60'}`}>
        <p className={`text-[30px] font-extrabold tracking-tight ${low ? 'text-[#b91c1c]' : 'text-[#0E1B3D] dark:text-white'}`}>{rupees(balance)}</p>
        <p className="text-[13.5px] text-[#4a5672] dark:text-slate-400">
          {messagesLeft !== null ? `About ${messagesLeft.toLocaleString('en-IN')} booking messages at ${rupees(price)} each.` : 'Booking messages are free right now.'}
          {low ? ' Top up so confirmations and reminders keep going out.' : ''}
        </p>
      </div>
      {canPay && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {options.map((amount) => (
            <button key={amount} type="button" disabled={busy} onClick={() => onTopup(amount)}
              className="h-10 rounded-lg border border-[#d5ddeb] dark:border-slate-700 text-[14px] font-bold text-[#0E1B3D] dark:text-slate-100 hover:border-[#1D5BEA] hover:text-[#1D5BEA] transition-colors cursor-pointer disabled:opacity-50">
              + {rupees(amount)}
            </button>
          ))}
        </div>
      )}
      <p className="mt-3 text-[12.5px] text-[#6B7894]">A message that does not reach the customer is not charged. Money in the wallet does not expire.</p>
      {history.length > 0 && (
        <div className="mt-4 border-t border-[#eef1f6] dark:border-slate-800 pt-3">
          <h3 className="text-[13.5px] font-bold text-[#0E1B3D] dark:text-white mb-2">Recent</h3>
          <ul className="space-y-1.5">
            {history.slice(0, 8).map((row, index) => (
              <li key={index} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="text-[#4a5672] dark:text-slate-400 truncate">
                  {row.kind === 'topup' ? 'Top-up' : row.kind === 'refund' ? 'Refund (not delivered)' : row.kind === 'adjustment' ? 'Added by WAMA' : 'Message sent'}
                  {' · '}{new Date(row.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </span>
                <span className={`font-semibold tabular-nums shrink-0 ${row.amount < 0 ? 'text-[#4a5672] dark:text-slate-300' : 'text-[#0E1B3D] dark:text-white'}`}>{row.amount < 0 ? '−' : '+'}{rupees(Math.abs(row.amount))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
