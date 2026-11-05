'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, BadgeCheck, CheckCircle2, CreditCard, Loader2, ShieldCheck, Sparkles, Zap } from 'lucide-react'
import { supabase, restoreSupabaseSession } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import { can, type RoleSubject } from '@/lib/rbac'
import { openRazorpay } from '@/lib/use-razorpay'
import { useConfirm } from '@/lib/dialog-context'

interface Billing {
  configured: boolean
  exempt: boolean
  status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired'
  hasAccess: boolean
  hasSubscription: boolean
  trialDaysLeft: number | null
  accessUntil: string | null
  cancelAtPeriodEnd: boolean
  aiPercentLeft: number | null
  aiPaused: boolean
  plan: { name: string; price: number; interval: string; features: string[] }
  topupOptions: number[]
  minTopup: number
  maxTopup: number
  razorpayKeyId: string | null
}

const card = 'bg-white dark:bg-[#111b21] rounded-2xl border border-[#e3e8f2] dark:border-slate-800 p-5 sm:p-6'
const primary = 'inline-flex items-center justify-center gap-2 h-11 px-6 rounded-xl bg-[#1D5BEA] hover:bg-[#174bc4] text-white text-[15px] font-bold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
const secondary = 'inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl border border-[#d5ddeb] dark:border-slate-700 text-[#0E1B3D] dark:text-slate-100 text-[14px] font-semibold hover:bg-[#f4f6fa] dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50'
const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

function StatusPill({ billing }: { billing: Billing }) {
  const [label, tone] = billing.exempt
    ? ['Custom arrangement', 'bg-[#e8f7f1] text-[#047857]']
    : billing.status === 'active' && billing.cancelAtPeriodEnd
      ? [`Active till ${formatDate(billing.accessUntil)}`, 'bg-[#fff7e8] text-[#92400e]']
      : billing.status === 'active'
        ? ['Active', 'bg-[#e8f7f1] text-[#047857]']
        : billing.status === 'trialing'
          ? [`Free trial · ${billing.trialDaysLeft} day${billing.trialDaysLeft === 1 ? '' : 's'} left`, 'bg-[#eef3fe] text-[#1D5BEA]']
          : billing.status === 'past_due'
            ? ['Payment failed · retrying', 'bg-[#fdf0f0] text-[#b91c1c]']
            : billing.status === 'cancelled'
              ? [`Cancelled · access till ${formatDate(billing.accessUntil)}`, 'bg-[#fff7e8] text-[#92400e]']
              : ['Expired', 'bg-[#fdf0f0] text-[#b91c1c]']
  return <span className={`inline-flex items-center px-3 py-1 rounded-full text-[13px] font-bold ${tone}`}>{label}</span>
}

function CreditRing({ percent, paused }: { percent: number; paused: boolean }) {
  const radius = 54
  const circumference = 2 * Math.PI * radius
  const color = paused ? '#E5484D' : percent <= 20 ? '#F59E0B' : '#00A884'
  return (
    <div className="relative h-36 w-36 shrink-0">
      <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
        <circle cx="64" cy="64" r={radius} fill="none" stroke="#eef1f6" strokeWidth="12" />
        <circle cx="64" cy="64" r={radius} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - percent / 100)} style={{ transition: 'stroke-dashoffset .6s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[32px] font-extrabold text-[#0E1B3D] dark:text-white leading-none">{percent}%</span>
        <span className="text-[12px] font-semibold text-[#6B7894] mt-1">left</span>
      </div>
    </div>
  )
}

export default function BillingPage() {
  const confirmDialog = useConfirm()
  const [orgId, setOrgId] = useState('')
  const [viewer, setViewer] = useState<RoleSubject>(null)
  const [orgName, setOrgName] = useState('')
  const [billing, setBilling] = useState<Billing | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [customAmount, setCustomAmount] = useState('')

  const load = useCallback(async (organizationId: string) => {
    const res = await fetch(`/api/billing?organizationId=${organizationId}`, { cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Billing could not be loaded.')
    setBilling(data)
  }, [])

  useEffect(() => {
    (async () => {
      try {
        await restoreSupabaseSession()
        const user = authSessionManager.getUser()
        if (!user?.id) return
        const { data: profile } = await supabase.from('users').select('organization_id, role, see_all, read_only, organizations(name)').eq('id', user.id).maybeSingle()
        if (!profile?.organization_id) return
        setOrgId(profile.organization_id)
        setOrgName((profile as any).organizations?.name || '')
        setViewer({ id: user.id, role: profile.role, see_all: profile.see_all, read_only: profile.read_only })
        await load(profile.organization_id)
      } catch (err: any) {
        setError(err.message)
      }
    })()
  }, [load])

  const canPay = can(viewer, 'billing.manage')

  async function subscribe() {
    setBusy('subscribe'); setError(''); setNotice('')
    try {
      const res = await fetch('/api/billing/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The subscription could not be started.')
      const paid = await openRazorpay({
        key: data.keyId, subscription_id: data.subscriptionId, name: 'WAMA CRM', description: `${billing?.plan.name} · ₹3,000 per month`,
        notes: { organization_id: orgId }, onFailure: (message: string) => setError(message),
      })
      if (!paid) return
      const verify = await fetch('/api/billing/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, ...paid }) })
      const result = await verify.json().catch(() => ({}))
      if (!verify.ok) throw new Error(result.error || 'The payment could not be confirmed.')
      setNotice('Payment received. Your plan is active. Thank you!')
      await load(orgId)
      // Let the rest of the app pick up the new access
      window.dispatchEvent(new Event('billing:changed'))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  async function cancel() {
    if (!(await confirmDialog({ title: 'Stop renewing your plan?', message: 'You keep full access until the end of the month you paid for. You can subscribe again any time.', confirmLabel: 'Stop renewal', destructive: true }))) return
    setBusy('cancel'); setError(''); setNotice('')
    try {
      const res = await fetch('/api/billing/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The plan could not be cancelled.')
      setNotice(`Renewal stopped. You keep access until ${formatDate(data.accessUntil)}.`)
      await load(orgId)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  async function topup(amount: number) {
    setBusy(`topup-${amount}`); setError(''); setNotice('')
    try {
      const res = await fetch('/api/billing/topup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, amount }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The top-up could not be started.')
      const paid = await openRazorpay({
        key: data.keyId, order_id: data.orderId, amount: data.amount, currency: data.currency, name: 'WAMA CRM', description: 'AI credits',
        onFailure: (message: string) => setError(message),
      })
      if (!paid) return
      const verify = await fetch('/api/billing/topup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, ...paid }) })
      const result = await verify.json().catch(() => ({}))
      if (!verify.ok) throw new Error(result.error || 'The payment could not be confirmed.')
      setNotice('AI credits added. AI features are running.')
      setCustomAmount('')
      await load(orgId)
      window.dispatchEvent(new Event('billing:changed'))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  if (!billing) {
    return (
      <div className="h-full flex items-center justify-center">
        {error ? <p className="text-[14px] text-[#b91c1c] flex items-center gap-2"><AlertCircle size={16} /> {error}</p> : <Loader2 className="animate-spin text-[#1D5BEA]" />}
      </div>
    )
  }

  const percent = billing.aiPercentLeft ?? 0
  const custom = Number(customAmount)
  const customValid = Number.isFinite(custom) && custom >= billing.minTopup && custom <= billing.maxTopup

  return (
    <div className="h-full overflow-y-auto bg-[#f4f6fa] dark:bg-[#0b141a]">
      <div className="max-w-5xl mx-auto p-4 pb-24 md:p-8 md:pb-10 space-y-5">
        <div>
          <h1 className="text-[24px] font-extrabold text-[#0E1B3D] dark:text-white">Plan &amp; billing</h1>
          <p className="text-[14px] text-[#4A5874] dark:text-slate-400">{orgName ? `${orgName} · ` : ''}One simple plan with every feature.</p>
        </div>

        {notice && <div role="status" className="rounded-xl bg-[#e8f7f1] text-[#047857] px-4 py-3 text-[14px] font-semibold flex items-center gap-2"><CheckCircle2 size={17} /> {notice}</div>}
        {error && <div role="alert" className="rounded-xl bg-[#fdf0f0] text-[#b91c1c] px-4 py-3 text-[14px] font-semibold flex items-center gap-2"><AlertCircle size={17} /> {error}</div>}
        {!billing.configured && (
          <div className="rounded-xl bg-[#fff7e8] text-[#92400e] px-4 py-3 text-[14px]">Billing is being set up for your workspace. Everything keeps working in the meantime.</div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* Plan */}
          <section className={`${card} lg:col-span-3`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p className="text-[13px] font-bold uppercase tracking-wider text-[#6B7894]">Your plan</p>
                <h2 className="text-[22px] font-extrabold text-[#0E1B3D] dark:text-white mt-1">{billing.plan.name}</h2>
              </div>
              <StatusPill billing={billing} />
            </div>

            {billing.exempt ? (
              <p className="mt-5 text-[15px] text-[#4A5874] dark:text-slate-300 flex items-start gap-2"><ShieldCheck size={18} className="shrink-0 mt-0.5 text-[#00A884]" /> Your workspace is on a custom arrangement with Magnetora. There is nothing to pay here.</p>
            ) : (
              <>
                <p className="mt-4"><span className="text-[40px] font-extrabold text-[#0E1B3D] dark:text-white">₹{billing.plan.price.toLocaleString('en-IN')}</span><span className="text-[16px] font-semibold text-[#6B7894]"> / month</span></p>
                <p className="text-[13px] text-[#6B7894]">Billed monthly through Razorpay. UPI, cards and net banking. Cancel anytime.</p>
                <ul className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {billing.plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-[14px] text-[#0E1B3D] dark:text-slate-200"><CheckCircle2 size={17} className="shrink-0 mt-0.5 text-[#00A884]" /> {feature}</li>
                  ))}
                </ul>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  {billing.status === 'active' && !billing.cancelAtPeriodEnd ? (
                    <>
                      <p className="text-[14px] text-[#4A5874] dark:text-slate-300 flex items-center gap-1.5"><BadgeCheck size={17} className="text-[#00A884]" /> Renews on {formatDate(billing.accessUntil)}</p>
                      {canPay && <button type="button" onClick={cancel} disabled={busy !== null} className={secondary}>{busy === 'cancel' && <Loader2 size={15} className="animate-spin" />} Cancel renewal</button>}
                    </>
                  ) : canPay ? (
                    <button type="button" onClick={subscribe} disabled={busy !== null || !billing.razorpayKeyId || !billing.configured} className={primary}>
                      {busy === 'subscribe' ? <Loader2 size={17} className="animate-spin" /> : <CreditCard size={17} />}
                      {billing.status === 'past_due' ? 'Update payment' : billing.status === 'active' ? 'Resume plan' : 'Subscribe · ₹3,000 / month'}
                    </button>
                  ) : (
                    <p className="text-[14px] text-[#4A5874]">Ask your workspace admin to manage the plan.</p>
                  )}
                  {!billing.razorpayKeyId && canPay && <p className="text-[13px] text-[#92400e]">Online payment is not switched on yet. Please contact Magnetora.</p>}
                </div>
              </>
            )}
          </section>

          {/* AI credits */}
          <section className={`${card} lg:col-span-2`}>
            <p className="text-[13px] font-bold uppercase tracking-wider text-[#6B7894] flex items-center gap-1.5"><Sparkles size={15} className="text-[#1D5BEA]" /> AI credits</p>
            {billing.exempt || billing.aiPercentLeft === null ? (
              <p className="mt-4 text-[15px] text-[#4A5874] dark:text-slate-300">Your workspace uses its own AI key, so there are no AI credits to track.</p>
            ) : (
              <>
                <div className="mt-4 flex items-center gap-5">
                  <CreditRing percent={percent} paused={billing.aiPaused} />
                  <div>
                    <p className={`text-[16px] font-bold ${billing.aiPaused ? 'text-[#b91c1c]' : percent <= 20 ? 'text-[#92400e]' : 'text-[#047857]'}`}>
                      {billing.aiPaused ? 'AI is paused' : percent <= 20 ? 'Running low' : 'AI is running'}
                    </p>
                    <p className="text-[13px] text-[#6B7894] mt-1 leading-snug">
                      {billing.aiPaused ? 'Add credits to switch AI replies, scoring and writing back on.' : 'Used by AI replies, the shopping assistant, lead scoring and writing help.'}
                    </p>
                  </div>
                </div>
                {canPay ? (
                  <div className="mt-5">
                    <p className="text-[13px] font-semibold text-[#0E1B3D] dark:text-slate-200 mb-2">Add credits</p>
                    <div className="grid grid-cols-2 gap-2">
                      {billing.topupOptions.map((amount) => (
                        <button key={amount} type="button" onClick={() => topup(amount)} disabled={busy !== null || !billing.razorpayKeyId}
                          className="h-11 rounded-xl border border-[#d5ddeb] dark:border-slate-700 text-[15px] font-bold text-[#0E1B3D] dark:text-white hover:border-[#1D5BEA] hover:bg-[#eef3fe] dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
                          {busy === `topup-${amount}` ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} className="text-[#F59E0B]" />} ₹{amount.toLocaleString('en-IN')}
                        </button>
                      ))}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <input value={customAmount} onChange={(event) => setCustomAmount(event.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder={`Other amount (₹${billing.minTopup}+)`}
                        className="flex-1 h-11 px-3 rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-slate-900 text-[14px] focus:outline-none focus:border-[#1D5BEA]" />
                      <button type="button" onClick={() => topup(custom)} disabled={!customValid || busy !== null || !billing.razorpayKeyId} className={secondary}>Add</button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-5 text-[13px] text-[#6B7894]">Your workspace admin can add credits.</p>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
