'use client'

import { Check, CreditCard } from 'lucide-react'
import { PLAN_COLOURS, sessionsLeft } from '@/lib/salon/membership-rules'
import { formatRupees } from '@/lib/salon/invoice'

const sectionTitle = 'text-[13px] font-bold uppercase tracking-wide text-[#6B7894] dark:text-slate-400'

/** What is left on a card, in one line: "₹2,400 · 3 sessions · 10% off" */
export function leftWords(c: any): string {
  const parts: string[] = []
  if (Number(c.credit_balance) > 0 || Number(c.plan?.credit) > 0) parts.push(formatRupees(Number(c.credit_balance) || 0))
  const left = sessionsLeft(c)
  if ((c.sessions || []).length) parts.push(`${left} session${left === 1 ? '' : 's'}`)
  if (Number(c.plan?.discount_percent) > 0) parts.push(`${Number(c.plan.discount_percent)}% off`)
  return parts.join(' · ') || 'Nothing left'
}

/** The membership box in a bill: the customer's cards, and what the chosen one takes off. */
export function MembershipBox({ cards, chosen, onChoose, preview }: { cards: any[]; chosen: string | null; onChoose: (id: string | null) => void; preview: { sessions: number; discount: number; credit: number } | null }) {
  if (!cards.length) return null
  return (
    <section className="space-y-2">
      <p className={sectionTitle}>Membership</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {cards.map((c) => {
          const on = chosen === c.id
          return (
            <button key={c.id} type="button" aria-pressed={on} onClick={() => onChoose(on ? null : c.id)}
              className={`relative text-left rounded-2xl border-2 p-3 cursor-pointer transition-colors ${on ? 'border-[#008069] bg-[#e7f5f0] dark:bg-emerald-950/30' : 'border-[#e3e8f2] dark:border-slate-700 hover:border-[#8fcfbf]'}`}>
              {on && <span className="absolute top-2 right-2 h-5 w-5 rounded-full bg-[#008069] text-white flex items-center justify-center"><Check size={13} strokeWidth={3} /></span>}
              <span className="flex items-center gap-2 font-bold text-[#0E1B3D] dark:text-white pr-6"><span style={{ background: c.plan?.colour || PLAN_COLOURS[0] }} className="h-3 w-3 rounded-full shrink-0" /> <span className="truncate">{c.plan?.name} · {c.card_number}</span></span>
              <span className="block mt-0.5 text-[13px] text-[#4a5672] dark:text-slate-400">{leftWords(c)}</span>
            </button>
          )
        })}
      </div>
      {chosen && preview && (
        <p className="text-[13.5px] text-[#0E1B3D] dark:text-slate-200 rounded-xl bg-[#f4f6fa] dark:bg-slate-900/50 px-3 py-2">
          <CreditCard size={15} className="inline -mt-0.5 mr-1.5 text-[#008069]" />
          {[preview.sessions ? `${preview.sessions} service${preview.sessions === 1 ? '' : 's'} free` : '', preview.discount ? `${formatRupees(preview.discount)} off` : '', preview.credit ? `${formatRupees(preview.credit)} from credit` : ''].filter(Boolean).join(' · ') || 'Nothing on this card applies to these services.'}
        </p>
      )}
    </section>
  )
}
