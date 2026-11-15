'use client'

/**
 * Members: membership cards customers hold (search, state, what is left), the plans the business sells,
 * and how cards are used (money taken, credit and sessions used, what is still owed). Selling a card and
 * using one on a bill go through the counter (/api/salon/act); see lib/salon/memberships.ts.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BadgePercent, CalendarClock, Check, Copy, CreditCard, ExternalLink, IdCard, Loader2, MessageCircle, Minus, Pencil, Plus, Search, Ticket, Trash2, Wallet, X } from 'lucide-react'
import { CARD_STATE_WORDS, cardState, PLAN_COLOURS, planBenefits, sessionsLeft, usageWords, validityWords, type CardState } from '@/lib/salon/membership-rules'
import { formatRupees } from '@/lib/salon/invoice'
import { rangeQuery, type DateRange } from '@/lib/salon/ranges'
import { CustomerFields, type CustomerValue, type PaymentChoice } from './counter-sheets'
import { leftWords } from './membership-box'
import { DateRangeFilter } from './date-range'
import { api, Avatar, card, Chip, dangerButton, Field, input, Modal, primaryButton, secondaryButton, StatTile, Toggle } from './ui'
import type { SalonSetup } from './types'

type Flash = (tone: 'success' | 'error', text: string) => void
type View = 'cards' | 'plans' | 'usage'

const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
const sectionTitle = 'text-[13px] font-bold uppercase tracking-wide text-[#6B7894] dark:text-slate-400'
const errorBox = 'rounded-xl bg-[#fdf0f0] dark:bg-red-950/30 text-[#b91c1c] dark:text-red-300 px-4 py-3 text-[14.5px] font-medium'

function StateChip({ state }: { state: CardState }) {
  const attention = state === 'expiring' || state === 'expired'
  return (
    <span className={`inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-bold whitespace-nowrap ${attention ? 'bg-[#fdf0f0] text-[#b91c1c]' : state === 'cancelled' ? 'bg-[#eef1f6] text-[#6B7894]' : 'bg-[#eef3fe] text-[#1D5BEA]'}`}>
      {CARD_STATE_WORDS[state]}
    </span>
  )
}

/** A card as it looks to the customer, small. */
function CardFace({ c }: { c: any }) {
  return (
    <div style={{ background: c.plan?.colour || PLAN_COLOURS[0] }} className="relative overflow-hidden rounded-2xl p-4 text-white">
      <span aria-hidden="true" className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/10" />
      <p className="relative text-[11.5px] uppercase tracking-widest text-white/80">{c.plan?.name || 'Membership'}</p>
      <p className="relative mt-1 text-[19px] font-extrabold leading-tight break-words">{c.customer_name}</p>
      <div className="relative mt-3 flex items-end justify-between gap-2">
        <p className="font-mono text-[15px] font-bold tracking-wider">{c.card_number}</p>
        <p className="text-[12px] text-white/85">till {day(c.expires_at)}</p>
      </div>
    </div>
  )
}

export function SalonMembers({ orgId, setup, canManage, canWrite, flash, range, onRangeChange }: { orgId: string; setup: SalonSetup; canManage: boolean; canWrite: boolean; flash: Flash; range: DateRange; onRangeChange: (range: DateRange) => void }) {
  const [view, setView] = useState<View>('cards')
  const [plans, setPlans] = useState<any[] | null>(null)
  const [selling, setSelling] = useState(false)
  const [openCard, setOpenCard] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  const loadPlans = useCallback(async () => {
    try {
      const data = await api(`/api/salon/memberships?organizationId=${orgId}&view=plans`)
      setPlans(data.plans || [])
    } catch (err: any) {
      flash('error', err.message)
      setPlans([])
    }
  }, [orgId, flash])
  useEffect(() => { loadPlans() }, [loadPlans])

  const onSale = (plans || []).filter((p) => p.active)
  const views: { id: View; label: string }[] = [{ id: 'cards', label: 'Cards' }, ...(canManage ? [{ id: 'plans' as View, label: 'Plans' }, { id: 'usage' as View, label: 'Usage' }] : [])]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Members" className="inline-flex rounded-xl bg-[#eef1f6] dark:bg-slate-900 p-1">
          {views.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)}
              className={`h-9 px-4 rounded-lg text-[14px] font-semibold cursor-pointer ${view === v.id ? 'bg-white dark:bg-[#111b21] text-[#0E1B3D] dark:text-white shadow-sm' : 'text-[#4a5672] dark:text-slate-400'}`}>
              {v.label}
            </button>
          ))}
        </div>
        {canWrite && (
          <button type="button" onClick={() => (onSale.length ? setSelling(true) : canManage ? setView('plans') : flash('error', 'There are no membership plans yet. Ask a manager to add one.'))} className={`${primaryButton} ml-auto`}>
            <IdCard size={17} /> Sell a membership
          </button>
        )}
      </div>

      {view === 'cards' && <CardList orgId={orgId} reload={reload} onOpen={setOpenCard} noPlans={plans !== null && plans.length === 0} canManage={canManage} onAddPlan={() => setView('plans')} />}
      {view === 'plans' && canManage && <PlanList orgId={orgId} setup={setup} plans={plans} onChanged={loadPlans} flash={flash} />}
      {view === 'usage' && canManage && <Usage orgId={orgId} range={range} onRangeChange={onRangeChange} onOpen={setOpenCard} />}

      {selling && (
        <SellSheet orgId={orgId} plans={onSale} onClose={() => setSelling(false)}
          onSold={(result) => { setSelling(false); setReload((n) => n + 1); flash('success', result.message || 'Card sold.'); if (result.membership?.id) setOpenCard(result.membership.id) }} />
      )}
      {openCard && <CardSheet orgId={orgId} cardId={openCard} canManage={canManage} canWrite={canWrite} flash={flash} onClose={() => setOpenCard(null)} onChanged={() => setReload((n) => n + 1)} />}
    </div>
  )
}

// ── Cards ────────────────────────────────────────────────────────────────────

const STATES: { id: '' | CardState; label: string }[] = [
  { id: '', label: 'All' }, { id: 'active', label: 'Active' }, { id: 'expiring', label: 'Ending soon' }, { id: 'expired', label: 'Expired' }, { id: 'cancelled', label: 'Cancelled' },
]

function CardList({ orgId, reload, onOpen, noPlans, canManage, onAddPlan }: { orgId: string; reload: number; onOpen: (id: string) => void; noPlans: boolean; canManage: boolean; onAddPlan: () => void }) {
  const [cards, setCards] = useState<any[] | null>(null)
  const [q, setQ] = useState('')
  const [state, setState] = useState<'' | CardState>('')
  const [error, setError] = useState('')

  useEffect(() => {
    let gone = false
    const timer = setTimeout(async () => {
      try {
        const data = await api(`/api/salon/memberships?organizationId=${orgId}&view=cards&q=${encodeURIComponent(q)}&state=${state}`)
        if (!gone) { setCards(data.cards || []); setError('') }
      } catch (err: any) {
        if (!gone) setError(err.message)
      }
    }, q ? 300 : 0)
    return () => { gone = true; clearTimeout(timer) }
  }, [orgId, q, state, reload])

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative sm:max-w-sm flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8a94a8]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, mobile or card number" aria-label="Search cards" className={`${input} pl-10`} />
        </div>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {STATES.map((s) => <Chip key={s.id || 'all'} selected={state === s.id} onClick={() => setState(s.id)}>{s.label}</Chip>)}
        </div>
      </div>
      {error && <div role="alert" className={errorBox}>{error}</div>}
      {cards === null ? (
        <p className="py-14 text-center text-[#6B7894] inline-flex w-full justify-center items-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading cards…</p>
      ) : cards.length === 0 ? (
        <div className={`${card} p-8 text-center`}>
          <span className="mx-auto h-14 w-14 rounded-full bg-[#eef3fe] text-[#1D5BEA] flex items-center justify-center"><IdCard size={26} /></span>
          <p className="mt-3 font-bold text-[#0E1B3D] dark:text-white">{q || state ? 'No cards match' : 'No membership cards yet'}</p>
          <p className="mt-1 text-[14px] text-[#6B7894]">{noPlans ? 'Start by adding a plan, like Gold: ₹5,000 for ₹6,000 to spend, valid one year.' : 'Sell a membership and its card shows up here.'}</p>
          {noPlans && canManage && <button type="button" onClick={onAddPlan} className={`${primaryButton} mt-4`}><Plus size={17} /> Add a plan</button>}
        </div>
      ) : (
        <ul className="grid gap-2.5 md:grid-cols-2">
          {cards.map((c) => {
            const st = cardState(c)
            return (
              <li key={c.id}>
                <button type="button" onClick={() => onOpen(c.id)} className={`${card} w-full text-left p-3.5 flex items-center gap-3 hover:border-[#9db5ef] cursor-pointer`}>
                  <span style={{ background: c.plan?.colour || PLAN_COLOURS[0] }} className="h-11 w-11 rounded-xl text-white flex items-center justify-center shrink-0"><IdCard size={20} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-bold text-[#0E1B3D] dark:text-white truncate">{c.customer_name}</span>
                      <StateChip state={st} />
                    </span>
                    <span className="block text-[13px] text-[#6B7894] truncate">{c.plan?.name} · {c.card_number}{c.customer_phone ? ` · ${c.customer_phone}` : ''}</span>
                    <span className="block text-[13px] font-semibold text-[#4a5672] dark:text-slate-300 truncate">{leftWords(c)} · till {day(c.expires_at)}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function CardSheet({ orgId, cardId, canManage, canWrite, flash, onClose, onChanged }: { orgId: string; cardId: string; canManage: boolean; canWrite: boolean; flash: Flash; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ card: any; usage: any[]; link: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [credit, setCredit] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setData(await api(`/api/salon/memberships?organizationId=${orgId}&view=card&id=${cardId}`))
    } catch (err: any) {
      setError(err.message)
    }
  }, [orgId, cardId])
  useEffect(() => { load() }, [load])

  async function post(action: any, done: string) {
    setBusy(true)
    setError('')
    try {
      const result = await api('/api/salon/memberships', { method: 'POST', body: JSON.stringify({ organizationId: orgId, action }) })
      if (action.type === 'send_card') flash(result.whatsapp?.sent ? 'success' : 'error', result.whatsapp?.sent ? done : result.whatsapp?.windowClosed ? 'WhatsApp can only send this within 24 hours of their last message. Copy the link and share it instead.' : result.whatsapp?.error || 'The card could not be sent.')
      else flash('success', done)
      await load()
      onChanged()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const c = data?.card
  const st = c ? cardState(c) : null
  const live = st === 'active' || st === 'expiring' || st === 'upcoming'

  return (
    <Modal size="lg" title={c ? `${c.customer_name}'s card` : 'Membership card'} subtitle={c ? `${c.card_number} · ${c.plan?.name}` : undefined} icon={<IdCard size={21} />} onClose={onClose}>
      {!data ? (
        error ? <div role="alert" className={errorBox}>{error}</div> : <p className="py-10 text-center text-[#6B7894] inline-flex w-full justify-center items-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading…</p>
      ) : (
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-4 min-w-0">
            <CardFace c={c} />
            <div className="flex items-center justify-between gap-2">
              {st && <StateChip state={st} />}
              <span className="text-[13px] text-[#6B7894]">{day(c.starts_at)} – {day(c.expires_at)}</span>
            </div>
            <div className={`${card} p-4 space-y-2.5`}>
              <p className={sectionTitle}>Left on the card</p>
              {(Number(c.plan?.credit) > 0 || Number(c.credit_balance) > 0) && <div className="flex justify-between gap-2 text-[15px]"><span className="inline-flex items-center gap-2"><Wallet size={16} className="text-[#1D5BEA]" /> Credit</span><b>{formatRupees(Number(c.credit_balance) || 0)}</b></div>}
              {(c.sessions || []).map((s: any) => (
                <div key={s.service_id} className="flex justify-between gap-2 text-[15px]">
                  <span className="inline-flex items-center gap-2 min-w-0"><Ticket size={16} className="text-[#1D5BEA] shrink-0" /> <span className="truncate">{s.name}</span></span>
                  <span className="inline-flex items-center gap-1.5 shrink-0">
                    {canManage && live && <button type="button" disabled={busy || s.total <= s.used} onClick={() => post({ type: 'adjust', card_id: c.id, change: { type: 'sessions', service_id: s.service_id, count: -1 } }, 'Session taken off.')} aria-label={`One less ${s.name}`} className="h-7 w-7 rounded-lg border border-[#d5ddeb] flex items-center justify-center cursor-pointer disabled:opacity-40"><Minus size={13} /></button>}
                    <b>{Math.max(0, s.total - s.used)} of {s.total}</b>
                    {canManage && live && <button type="button" disabled={busy} onClick={() => post({ type: 'adjust', card_id: c.id, change: { type: 'sessions', service_id: s.service_id, count: 1 } }, 'Session added.')} aria-label={`One more ${s.name}`} className="h-7 w-7 rounded-lg border border-[#d5ddeb] flex items-center justify-center cursor-pointer disabled:opacity-40"><Plus size={13} /></button>}
                  </span>
                </div>
              ))}
              {Number(c.plan?.discount_percent) > 0 && <div className="flex justify-between gap-2 text-[15px]"><span className="inline-flex items-center gap-2"><BadgePercent size={16} className="text-[#1D5BEA]" /> Discount on services</span><b>{Number(c.plan.discount_percent)}% off</b></div>}
            </div>
            {canWrite && (
              <div className="flex flex-wrap gap-2">
                {c.customer_phone && <button type="button" disabled={busy} onClick={() => post({ type: 'send_card', card_id: c.id }, 'Card sent on WhatsApp.')} className={secondaryButton}><MessageCircle size={16} /> Send on WhatsApp</button>}
                <button type="button" onClick={() => navigator.clipboard?.writeText(data.link).then(() => flash('success', 'Card link copied.'))} className={secondaryButton}><Copy size={16} /> Copy link</button>
                <a href={data.link} target="_blank" rel="noreferrer" className={secondaryButton}><ExternalLink size={16} /> Open</a>
              </div>
            )}
          </div>
          <div className="space-y-4 min-w-0">
            {error && <div role="alert" className={errorBox}>{error}</div>}
            {canManage && live && (
              <div className={`${card} p-4 space-y-3`}>
                <p className={sectionTitle}>Change the card</p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-semibold text-[#4a5672] mr-1 inline-flex items-center gap-1.5"><CalendarClock size={16} /> Extend</span>
                  {[30, 90, 365].map((d) => <Chip key={d} disabled={busy} onClick={() => post({ type: 'adjust', card_id: c.id, change: { type: 'extend', days: d } }, `Valid ${validityWords(d)} longer.`)}>+{validityWords(d)}</Chip>)}
                </div>
                <div className="flex items-center gap-2">
                  <input type="number" inputMode="decimal" value={credit} onChange={(e) => setCredit(e.target.value)} placeholder="Credit, e.g. 500 or -200" aria-label="Credit to add" className={`${input} flex-1 min-w-0`} />
                  <button type="button" disabled={busy || !Number(credit)} onClick={() => { post({ type: 'adjust', card_id: c.id, change: { type: 'credit', amount: Number(credit) } }, 'Credit changed.'); setCredit('') }} className={`${secondaryButton} shrink-0`}><Wallet size={16} /> {Number(credit) < 0 ? 'Take off' : 'Add'}</button>
                </div>
                <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Cancel card ${c.card_number}? It can no longer be used.`)) post({ type: 'adjust', card_id: c.id, change: { type: 'cancel' } }, 'Card cancelled.') }} className={`${dangerButton} w-full`}><Trash2 size={16} /> Cancel this card</button>
              </div>
            )}
            <div className={`${card} p-4`}>
              <p className={`${sectionTitle} mb-2`}>History</p>
              {data.usage.length === 0 ? <p className="text-[14px] text-[#6B7894]">Not used yet.</p> : (
                <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800">
                  {data.usage.map((u) => (
                    <li key={u.id} className="py-2 flex justify-between gap-3 text-[14px]">
                      <span className="min-w-0 break-words text-[#0E1B3D] dark:text-slate-100">{usageWords(u)}</span>
                      <span className="shrink-0 text-[#6B7894]">{day(u.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── Selling ──────────────────────────────────────────────────────────────────

const PAYMENTS: { value: PaymentChoice; label: string }[] = [{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }, { value: null, label: 'Pay later' }]

function SellSheet({ orgId, plans, onClose, onSold }: { orgId: string; plans: any[]; onClose: () => void; onSold: (result: any) => void }) {
  const [customer, setCustomer] = useState<CustomerValue>({ contact_id: null, name: '', phone: '' })
  const [planId, setPlanId] = useState<string>(plans[0]?.id || '')
  const [payment, setPayment] = useState<PaymentChoice>('cash')
  const [send, setSend] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const plan = plans.find((p) => p.id === planId)

  async function sell() {
    setError('')
    if (!customer.phone.trim() && !customer.contact_id) { setError('Add the customer\'s mobile number, so the card can be found at the counter.'); return }
    setBusy(true)
    try {
      const action = { type: 'sell_membership', plan_id: planId, customer: { contact_id: customer.contact_id, name: customer.name.trim(), phone: customer.phone.trim() || null }, payment_method: payment, send_whatsapp: send }
      onSold(await api('/api/salon/act', { method: 'POST', body: JSON.stringify({ organizationId: orgId, action }) }))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal size="lg" title="Sell a membership" icon={<IdCard size={21} />} subtitle="The customer gets a card with a number and a link; a bill is made for the price." onClose={onClose}
      footer={
        <div className="w-full flex items-center gap-3">
          <div className="min-w-0 mr-auto"><p className="text-[12.5px] text-[#6B7894]">To pay</p><p className="text-[22px] font-extrabold leading-tight text-[#0E1B3D] dark:text-white">{formatRupees(Number(plan?.price) || 0)}</p></div>
          <button type="button" onClick={onClose} className={`${secondaryButton} max-sm:hidden`}>Cancel</button>
          <button type="button" onClick={sell} disabled={busy || !plan} className={`${primaryButton} flex-1 sm:flex-none`}>{busy ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />} Sell card</button>
        </div>
      }>
      <div className="space-y-5">
        {error && <div role="alert" className={errorBox}>{error}</div>}
        <section className="space-y-2"><p className={sectionTitle}>Customer</p><CustomerFields orgId={orgId} value={customer} onChange={setCustomer} /></section>
        <section className="space-y-2">
          <p className={sectionTitle}>Plan</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {plans.map((p) => (
              <button key={p.id} type="button" onClick={() => setPlanId(p.id)} aria-pressed={planId === p.id}
                className={`text-left rounded-2xl border-2 p-3.5 cursor-pointer transition-colors ${planId === p.id ? 'border-[#1D5BEA] bg-[#eef3fe] dark:bg-blue-950/30' : 'border-[#e3e8f2] dark:border-slate-700 hover:border-[#9db5ef]'}`}>
                <span className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 font-bold text-[#0E1B3D] dark:text-white min-w-0"><span style={{ background: p.colour || PLAN_COLOURS[0] }} className="h-3 w-3 rounded-full shrink-0" /><span className="truncate">{p.name}</span></span>
                  <span className="font-extrabold text-[#0E1B3D] dark:text-white shrink-0">{formatRupees(Number(p.price) || 0)}</span>
                </span>
                <span className="mt-1 block text-[13px] text-[#4a5672] dark:text-slate-400">{planBenefits({ ...p, credit: Number(p.credit), discount_percent: Number(p.discount_percent), validity_days: Number(p.validity_days) }).join(' · ')}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="space-y-2">
          <p className={sectionTitle}>Paid by</p>
          <div className="flex flex-wrap gap-2">{PAYMENTS.map((p) => <Chip key={p.label} selected={payment === p.value} onClick={() => setPayment(p.value)}>{p.label}</Chip>)}</div>
        </section>
        {customer.phone.trim() && (
          <label className="flex items-center justify-between gap-4 rounded-2xl bg-[#f4f6fa] dark:bg-slate-900/40 px-4 py-3 text-[15px] text-[#0E1B3D] dark:text-white">
            <span className="min-w-0"><strong>Send the card on WhatsApp</strong><span className="block text-[13px] text-[#4a5672] dark:text-slate-400 truncate">With its link, to {customer.phone}</span></span>
            <Toggle checked={send} onChange={setSend} label="Send the card on WhatsApp" />
          </label>
        )}
      </div>
    </Modal>
  )
}

// ── Plans ────────────────────────────────────────────────────────────────────

function PlanList({ orgId, setup, plans, onChanged, flash }: { orgId: string; setup: SalonSetup; plans: any[] | null; onChanged: () => void; flash: Flash }) {
  const [editing, setEditing] = useState<any | null>(null)
  async function toggle(plan: any) {
    try {
      await api('/api/salon/memberships', { method: 'POST', body: JSON.stringify({ organizationId: orgId, action: { type: 'plan_active', plan_id: plan.id, active: !plan.active } }) })
      flash('success', plan.active ? `${plan.name} is off sale. Cards already sold still work.` : `${plan.name} is on sale.`)
      onChanged()
    } catch (err: any) {
      flash('error', err.message)
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[14px] text-[#4a5672] dark:text-slate-400">Plans you sell. Changing a plan does not change cards already sold.</p>
        <button type="button" onClick={() => setEditing({})} className={`${secondaryButton} shrink-0`}><Plus size={17} /> New plan</button>
      </div>
      {plans === null ? <p className="py-10 text-center text-[#6B7894]"><Loader2 size={16} className="inline animate-spin" /> Loading…</p> : plans.length === 0 ? (
        <div className={`${card} p-6 text-center text-[14.5px] text-[#6B7894]`}>No plans yet. Add one: for example <b>Gold</b> — pay ₹5,000, get ₹6,000 to spend, valid 1 year.</div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {plans.map((p) => (
            <li key={p.id} className={`${card} overflow-hidden ${p.active ? '' : 'opacity-70'}`}>
              <div style={{ background: p.colour || PLAN_COLOURS[0] }} className="h-2" />
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-extrabold text-[17px] text-[#0E1B3D] dark:text-white truncate">{p.name}</p>
                    <p className="text-[20px] font-extrabold text-[#0E1B3D] dark:text-white">{formatRupees(Number(p.price) || 0)}</p>
                  </div>
                  <Toggle checked={p.active} onChange={() => toggle(p)} label={p.active ? 'On sale' : 'Off sale'} />
                </div>
                <ul className="mt-2 space-y-1 text-[14px] text-[#4a5672] dark:text-slate-300">
                  {planBenefits({ ...p, credit: Number(p.credit), discount_percent: Number(p.discount_percent), validity_days: Number(p.validity_days) }).map((b) => <li key={b} className="flex gap-2"><Check size={15} className="shrink-0 mt-0.5 text-[#1D5BEA]" /> {b}</li>)}
                </ul>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-[12.5px] text-[#6B7894]">{p.active ? 'On sale' : 'Off sale'}{Number(p.tax_rate) ? ` · GST ${Number(p.tax_rate)}%` : ''}</span>
                  <button type="button" onClick={() => setEditing(p)} className="h-9 px-3 rounded-lg border border-[#d5ddeb] dark:border-slate-700 text-[13.5px] font-semibold inline-flex items-center gap-1.5 cursor-pointer"><Pencil size={14} /> Edit</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <PlanSheet orgId={orgId} setup={setup} plan={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); flash('success', 'Plan saved.') }} />}
    </div>
  )
}

const UNITS = [{ id: 'days', label: 'days', days: 1 }, { id: 'months', label: 'months', days: 30 }, { id: 'years', label: 'years', days: 365 }] as const

function PlanSheet({ orgId, setup, plan, onClose, onSaved }: { orgId: string; setup: SalonSetup; plan: any; onClose: () => void; onSaved: () => void }) {
  const startDays = Number(plan.validity_days) || 365
  const startUnit = startDays % 365 === 0 ? 'years' : startDays % 30 === 0 ? 'months' : 'days'
  const [form, setForm] = useState({
    name: plan.name || '', price: plan.price ? String(Number(plan.price)) : '', credit: Number(plan.credit) ? String(Number(plan.credit)) : '',
    discount: Number(plan.discount_percent) ? String(Number(plan.discount_percent)) : '', terms: plan.terms || '', colour: plan.colour || PLAN_COLOURS[0],
    tax: plan.tax_rate !== undefined ? Number(plan.tax_rate) : 18, active: plan.active !== false,
    length: String(startDays / UNITS.find((u) => u.id === startUnit)!.days), unit: startUnit as (typeof UNITS)[number]['id'],
  })
  const [sessions, setSessions] = useState<{ service_id: string; count: string }[]>((plan.sessions || []).map((s: any) => ({ service_id: s.service_id, count: String(s.count) })))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const services = useMemo(() => setup.services.filter((s) => s.active), [setup.services])
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))

  async function save() {
    setBusy(true)
    setError('')
    try {
      const body = {
        id: plan.id, name: form.name, price: Number(form.price) || 0, credit: Number(form.credit) || 0, discount_percent: Number(form.discount) || 0,
        validity_days: Math.round((Number(form.length) || 0) * UNITS.find((u) => u.id === form.unit)!.days), tax_rate: form.tax, colour: form.colour, terms: form.terms, active: form.active,
        sessions: sessions.filter((s) => s.service_id && Number(s.count) > 0).map((s) => ({ service_id: s.service_id, count: Number(s.count) })),
      }
      await api('/api/salon/memberships', { method: 'POST', body: JSON.stringify({ organizationId: orgId, action: { type: 'save_plan', plan: body } }) })
      onSaved()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal size="lg" title={plan.id ? `Edit ${plan.name}` : 'New membership plan'} icon={<IdCard size={21} />} onClose={onClose}
      footer={<div className="w-full flex justify-end gap-2"><button type="button" onClick={onClose} className={secondaryButton}>Cancel</button><button type="button" onClick={save} disabled={busy} className={primaryButton}>{busy ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />} Save plan</button></div>}>
      <div className="space-y-5">
        {error && <div role="alert" className={errorBox}>{error}</div>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><input value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} placeholder="Gold" className={input} /></Field>
          <Field label="Price (₹)"><input type="number" min={0} inputMode="decimal" value={form.price} onChange={(e) => set({ price: e.target.value })} placeholder="5000" className={input} /></Field>
        </div>
        <Field label="Valid for">
          <div className="flex gap-2">
            <input type="number" min={1} inputMode="numeric" value={form.length} onChange={(e) => set({ length: e.target.value })} aria-label="How long" className={`${input} w-24`} />
            <div className="flex flex-wrap gap-1.5">{UNITS.map((u) => <Chip key={u.id} selected={form.unit === u.id} onClick={() => set({ unit: u.id })}>{u.label}</Chip>)}</div>
          </div>
        </Field>
        <section className="space-y-3">
          <p className={sectionTitle}>What the customer gets (any mix)</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Credit to spend (₹)" hint="Paid from the card at billing. E.g. pay ₹5,000, get ₹6,000."><input type="number" min={0} inputMode="decimal" value={form.credit} onChange={(e) => set({ credit: e.target.value })} placeholder="6000" className={input} /></Field>
            <Field label="Discount on services (%)" hint="Comes off every service on the bill."><input type="number" min={0} max={100} inputMode="decimal" value={form.discount} onChange={(e) => set({ discount: e.target.value })} placeholder="10" className={input} /></Field>
          </div>
          <div className="space-y-2">
            <p className="text-[14px] font-semibold text-[#0E1B3D] dark:text-white">Free sessions</p>
            {sessions.map((s, i) => (
              <div key={i} className="flex gap-2">
                <select value={s.service_id} onChange={(e) => setSessions(sessions.map((x, j) => (j === i ? { ...x, service_id: e.target.value } : x)))} aria-label="Service" className={`${input} flex-1 min-w-0`}>
                  <option value="">Choose a service</option>
                  {services.map((svc) => <option key={svc.id} value={svc.id}>{svc.name}</option>)}
                </select>
                <input type="number" min={1} inputMode="numeric" value={s.count} onChange={(e) => setSessions(sessions.map((x, j) => (j === i ? { ...x, count: e.target.value } : x)))} aria-label="How many" className={`${input} w-20`} />
                <button type="button" onClick={() => setSessions(sessions.filter((_, j) => j !== i))} aria-label="Remove" className="h-11 w-11 shrink-0 rounded-xl border border-[#d5ddeb] dark:border-slate-700 flex items-center justify-center cursor-pointer"><X size={16} /></button>
              </div>
            ))}
            <button type="button" onClick={() => setSessions([...sessions, { service_id: '', count: '4' }])} className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#1D5BEA] cursor-pointer"><Plus size={16} /> Add free sessions of a service</button>
          </div>
        </section>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="GST on the price">
            <div className="flex flex-wrap gap-1.5">{[0, 5, 18].map((t) => <Chip key={t} selected={form.tax === t} onClick={() => set({ tax: t })}>{t ? `${t}%` : 'None'}</Chip>)}</div>
          </Field>
          <Field label="Card colour">
            <div className="flex flex-wrap gap-2">{PLAN_COLOURS.map((c) => <button key={c} type="button" onClick={() => set({ colour: c })} aria-label={`Colour ${c}`} style={{ background: c }} className={`h-9 w-9 rounded-full flex items-center justify-center text-white cursor-pointer ${form.colour === c ? 'ring-2 ring-offset-2 ring-[#8a94a8]' : ''}`}>{form.colour === c && <Check size={16} />}</button>)}</div>
          </Field>
        </div>
        <Field label="Terms (optional)" hint="Shown on the customer's card."><textarea value={form.terms} onChange={(e) => set({ terms: e.target.value })} rows={3} maxLength={600} placeholder="Not refundable. One card per person." className={`${input} h-auto py-2.5`} /></Field>
        <label className="flex items-center justify-between gap-3 text-[15px] font-semibold text-[#0E1B3D] dark:text-white">On sale <Toggle checked={form.active} onChange={(v) => set({ active: v })} label="On sale" /></label>
      </div>
    </Modal>
  )
}

// ── Usage report ─────────────────────────────────────────────────────────────

function Usage({ orgId, range, onRangeChange, onOpen }: { orgId: string; range: DateRange; onRangeChange: (range: DateRange) => void; onOpen: (id: string) => void }) {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let gone = false
    setData(null)
    api(`/api/salon/memberships?organizationId=${orgId}&view=report&${rangeQuery(range)}`).then((d) => { if (!gone) setData(d) }).catch((err) => { if (!gone) setError(err.message) })
    return () => { gone = true }
  }, [orgId, range])
  const r = data?.report
  return (
    <div className="space-y-4">
      <DateRangeFilter value={range} onChange={onRangeChange} />
      {error && <div role="alert" className={errorBox}>{error}</div>}
      {!r ? <p className="py-10 text-center text-[#6B7894]"><Loader2 size={16} className="inline animate-spin" /> Loading…</p> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Cards sold" value={r.sold} hint={formatRupees(r.revenue)} icon={<IdCard size={18} />} />
            <StatTile label="Credit used" value={formatRupees(r.creditUsed)} icon={<Wallet size={18} />} />
            <StatTile label="Sessions used" value={r.sessionsUsed} icon={<Ticket size={18} />} />
            <StatTile label="Discount given" value={formatRupees(r.discountGiven)} icon={<BadgePercent size={18} />} />
          </div>
          <div className={`${card} p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[14px]`}>
            <div><p className="text-[#6B7894]">Active cards</p><p className="text-[20px] font-extrabold text-[#0E1B3D] dark:text-white">{r.cards.active + r.cards.expiring}</p></div>
            <div><p className="text-[#6B7894]">Ending in 14 days</p><p className={`text-[20px] font-extrabold ${r.cards.expiring ? 'text-[#b91c1c]' : 'text-[#0E1B3D] dark:text-white'}`}>{r.cards.expiring}</p></div>
            <div><p className="text-[#6B7894]">Credit still on cards</p><p className="text-[20px] font-extrabold text-[#0E1B3D] dark:text-white">{formatRupees(r.creditOwed)}</p></div>
            <div><p className="text-[#6B7894]">Sessions still on cards</p><p className="text-[20px] font-extrabold text-[#0E1B3D] dark:text-white">{r.sessionsOwed}</p></div>
          </div>
          {r.perPlan.length > 0 && (
            <div className={`${card} overflow-x-auto`}>
              <table className="w-full min-w-[520px] text-[14px]">
                <thead><tr className="text-left text-[#6B7894] border-b border-[#eef1f6] dark:border-slate-800"><th className="p-3">Plan</th><th className="p-3 text-right">Sold</th><th className="p-3 text-right">Money in</th><th className="p-3 text-right">Credit used</th><th className="p-3 text-right">Sessions</th><th className="p-3 text-right">Discount</th></tr></thead>
                <tbody>
                  {r.perPlan.map((p: any) => (
                    <tr key={p.plan} className="border-b last:border-0 border-[#eef1f6] dark:border-slate-800 text-[#0E1B3D] dark:text-slate-100">
                      <td className="p-3 font-semibold">{p.plan}</td><td className="p-3 text-right">{p.sold}</td><td className="p-3 text-right">{formatRupees(p.revenue)}</td><td className="p-3 text-right">{formatRupees(p.credit)}</td><td className="p-3 text-right">{p.sessions}</td><td className="p-3 text-right">{formatRupees(p.saved)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className={`${card} p-4`}>
            <p className={`${sectionTitle} mb-2`}>Card use in these dates</p>
            {data.recent.length === 0 ? <p className="text-[14px] text-[#6B7894]">No card use in these dates.</p> : (
              <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800">
                {data.recent.map((u: any) => (
                  <li key={u.id}>
                    <button type="button" onClick={() => onOpen(u.membership_id)} className="w-full py-2.5 flex items-center gap-3 text-left cursor-pointer">
                      <Avatar name={u.salon_memberships?.customer_name || '?'} size={34} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-[#0E1B3D] dark:text-white truncate">{u.salon_memberships?.customer_name} · {u.salon_memberships?.card_number}</span>
                        <span className="block text-[13px] text-[#4a5672] dark:text-slate-400 truncate">{usageWords(u)}</span>
                      </span>
                      <span className="shrink-0 text-[12.5px] text-[#6B7894]">{day(u.created_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
