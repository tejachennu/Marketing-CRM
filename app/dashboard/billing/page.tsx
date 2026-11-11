'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle, AlertTriangle, ArrowRight, BadgeCheck, Bot, Building2, CalendarClock, CheckCircle2, ChevronDown, Clock, CreditCard,
  GraduationCap, Headphones, Loader2, Lock, Mail, Megaphone, MessageCircle, Package, Receipt, RotateCcw, ShieldCheck, ShoppingBag,
  Sparkles, Stethoscope, Store, TrendingUp, Users, Workflow, Wallet,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { supabase, restoreSupabaseSession } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import { can, type RoleSubject } from '@/lib/rbac'
import { openRazorpay } from '@/lib/use-razorpay'
import { useConfirm } from '@/lib/dialog-context'
import { FEATURE_GROUPS, USE_CASES } from '@/lib/product-features'
import { MessageWallet, PlanPicker, type PlanView } from '@/components/billing/plan-picker'

interface Billing {
  configured: boolean
  exempt: boolean
  status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired'
  hasAccess: boolean
  hasSubscription: boolean
  /** Auto-pay is set up but nothing has been charged yet (subscribed during the trial) */
  autoPayPending: boolean
  trialEndsAt: string | null
  onTrial: boolean
  trialDays: number
  trialDaysLeft: number | null
  accessUntil: string | null
  cancelAtPeriodEnd: boolean
  aiPercentLeft: number | null
  aiPaused: boolean
  plan: PlanView & { interval: string }
  plans: PlanView[]
  pendingPlan: PlanView | null
  whatsappMode: 'own' | 'shared'
  messageBalance: number
  messagePrices: { utility: number }
  messages: { kind: string; amount: number; category: string | null; date: string }[]
  messageTopupOptions: number[]
  payments: { purpose: string; amount: number; date: string; plan?: string | null }[]
  topupOptions: number[]
  minTopup: number
  maxTopup: number
  razorpayKeyId: string | null
}

const card = 'bg-white dark:bg-[#111b21] rounded-2xl border border-[#e3e8f2] dark:border-slate-800'
const formatDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
// Shown under the questions when set (NEXT_PUBLIC_SUPPORT_EMAIL)
const SUPPORT_EMAIL = (process.env.NEXT_PUBLIC_SUPPORT_EMAIL || '').trim()
const rupees = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

const GROUP_ICONS: Record<string, LucideIcon> = {
  inbox: MessageCircle, ai: Bot, commerce: ShoppingBag, campaigns: Megaphone, flows: Workflow, sales: TrendingUp, team: Users,
}
const USE_CASE_ICONS: Record<string, LucideIcon> = {
  retail: Store, d2c: Package, clinics: Stethoscope, education: GraduationCap, 'real-estate': Building2, support: Headphones,
}
const TINTS = [
  'bg-[#eef3fe] text-[#1D5BEA] dark:bg-blue-950/40 dark:text-blue-300',
  'bg-[#e8f7f1] text-[#047857] dark:bg-emerald-950/40 dark:text-emerald-300',
  'bg-[#fdeef3] text-[#be185d] dark:bg-pink-950/40 dark:text-pink-300',
  'bg-[#fff4e0] text-[#b45309] dark:bg-amber-950/40 dark:text-amber-300',
  'bg-[#f1ecfe] text-[#6d28d9] dark:bg-violet-950/40 dark:text-violet-300',
  'bg-[#e6f6fb] text-[#0e7490] dark:bg-cyan-950/40 dark:text-cyan-300',
]
const AI_USES = ['WhatsApp AI replies', 'Shopping assistant', 'Reply suggestions', 'Lead scoring', 'Writing help']

const FAQ = [
  { q: 'When am I charged?', a: 'If you subscribe during your free trial, the first month is charged on the day the trial ends, not before. After that it renews automatically every month on the same date. Prices are plus 18% GST.' },
  { q: 'How does changing plan work?', a: 'On the free trial you can switch plans as often as you like, for free. While paying, an upgrade starts straight away and you pay only the difference for the days left in the month. A downgrade starts on your next bill date, so you keep what you paid for.' },
  { q: 'What is the message wallet?', a: 'On Starter, WAMA\'s own WhatsApp number sends your booking confirmations and reminders. Each message is paid from the wallet at exactly Meta\'s price, with nothing added. A message that does not reach the customer is not charged.' },
  { q: 'What happens when the trial ends?', a: 'If no plan is set up, the workspace pauses until you subscribe. Nothing is deleted: your chats, contacts, campaigns and settings are all kept.' },
  { q: 'How do AI credits work?', a: 'Every workspace starts with free AI credit. AI replies, reply suggestions, lead scoring and writing help use it. When it runs out, only AI pauses; everything else keeps working. Add credit any time and the meter goes back to 100%. Credit does not expire.' },
  { q: 'Can I stop the plan?', a: 'Yes. Stop auto-renew any time and you keep your plan until the end of the month you paid for. You can turn it back on before then and nothing changes.' },
  { q: 'How do I pay?', a: 'Through Razorpay with UPI autopay, debit or credit card, or net banking. Razorpay emails a receipt for every payment.' },
]

// ── Status panel ──────────────────────────────────────────────────────────────

type Tone = 'brand' | 'green' | 'amber' | 'red' | 'neutral'

interface StatusView {
  tone: Tone
  icon: LucideIcon
  eyebrow: string
  title: string
  body: string
  action?: { label: string; kind: 'subscribe' | 'cancel'; caption?: string }
  progress?: number
  /** Key facts shown along the bottom of the panel */
  facts?: { label: string; value: string }[]
}

function statusView(billing: Billing): StatusView {
  const until = formatDate(billing.accessUntil)
  const price = `₹${billing.plan.price.toLocaleString('en-IN')}`
  const planName = `WAMA CRM ${billing.plan.name}`
  if (!billing.configured) return { tone: 'neutral', icon: Clock, eyebrow: 'Setting up', title: 'Billing is being set up', body: 'Everything keeps working in the meantime. There is nothing for you to do.' }
  if (billing.exempt) return { tone: 'neutral', icon: ShieldCheck, eyebrow: 'Custom arrangement', title: 'Nothing to pay here', body: 'Your workspace is covered by an arrangement with Magnetora. Every feature is included.' }

  switch (billing.status) {
    case 'trialing': {
      const left = billing.trialDaysLeft ?? 0
      return {
        tone: 'brand', icon: Clock, eyebrow: 'Free trial',
        title: left <= 1 ? 'Your free trial ends today' : `${left} days left in your free trial`,
        body: `Your trial ends on ${until}. Subscribe now so your inbox, campaigns and AI keep running without a break.`,
        action: { label: `Subscribe · ${price} / month`, kind: 'subscribe', caption: `First charge on ${until}, when the trial ends.` },
        progress: Math.min(100, Math.max(4, ((billing.trialDays - left) / billing.trialDays) * 100)),
        facts: [{ label: 'Plan', value: planName }, { label: 'Trial ends', value: until }, { label: 'After the trial', value: `${price} / month` }],
      }
    }
    case 'active':
      if (billing.cancelAtPeriodEnd) {
        return { tone: 'amber', icon: CalendarClock, eyebrow: 'Auto-renew is off', title: `Your plan ends on ${until}`, body: 'You keep every feature until then. Turn auto-renew back on and nothing changes for your team.', action: { label: 'Turn auto-renew on', kind: 'subscribe', caption: `Next charge on ${until}.` },
          facts: [{ label: 'Access until', value: until }, { label: 'Next charge', value: 'None' }, { label: 'Plan', value: planName }] }
      }
      if (billing.autoPayPending) {
        return { tone: 'green', icon: BadgeCheck, eyebrow: 'Auto-pay is set up', title: "You're all set", body: `Your free trial carries on until ${until}. The first ${price} is charged on that day, then every month. Nothing has been charged yet.`, action: { label: 'Cancel auto-pay', kind: 'cancel' },
          facts: [{ label: 'Trial ends', value: until }, { label: 'First charge', value: `${price} · ${until}` }, { label: 'Pay with', value: 'Razorpay auto-pay' }] }
      }
      return { tone: 'green', icon: BadgeCheck, eyebrow: 'Active', title: `${planName} is active`, body: billing.pendingPlan ? `Your change to ${billing.pendingPlan.name} starts on ${until}.` : 'Your plan renews automatically every month for your whole team.', action: { label: 'Stop auto-renew', kind: 'cancel' },
        facts: [{ label: 'Plan', value: planName }, { label: 'Next charge', value: until ? `${billing.pendingPlan ? `₹${billing.pendingPlan.price.toLocaleString('en-IN')}` : price} · ${until}` : `${price} monthly` }, { label: 'Pay with', value: 'Razorpay auto-pay' }] }
    case 'past_due':
      return { tone: 'red', icon: AlertTriangle, eyebrow: 'Payment failed', title: 'Your last payment did not go through', body: 'Razorpay will try again. To avoid any interruption, pay now with another card or UPI.', action: { label: `Pay ${price} now`, kind: 'subscribe', caption: 'Then monthly through auto-pay.' },
        facts: [{ label: 'Amount due', value: price }, ...(until ? [{ label: 'Access until', value: until }] : []), { label: 'Plan', value: planName }] }
    case 'cancelled':
      if (billing.hasAccess) return { tone: 'amber', icon: CalendarClock, eyebrow: 'Plan cancelled', title: `Your plan ends on ${until}`, body: 'You keep your plan until then.', action: { label: 'Subscribe again', kind: 'subscribe', caption: 'Charged today, then monthly.' } }
      return { tone: 'brand', icon: Lock, eyebrow: 'Plan ended', title: 'Subscribe to unlock your workspace', body: 'Your chats, contacts and settings are safe and waiting for you.', action: { label: `Subscribe · ${price} / month`, kind: 'subscribe', caption: 'Charged today, then monthly.' } }
    default:
      return { tone: 'brand', icon: Lock, eyebrow: billing.onTrial ? 'Trial ended' : 'Plan ended', title: 'Subscribe to unlock your workspace', body: 'Your chats, contacts and settings are safe and waiting for you.', action: { label: `Subscribe · ${price} / month`, kind: 'subscribe', caption: 'Charged today, then monthly.' } }
  }
}

const TONES: Record<Tone, { panel: string; icon: string; eyebrow: string; title: string; body: string }> = {
  brand: { panel: 'bg-[#0E1B3D] border-transparent text-white', icon: 'bg-white/10 text-[#7CF0A8]', eyebrow: 'bg-white/10 text-[#7CF0A8]', title: 'text-white', body: 'text-white/75' },
  green: { panel: 'bg-white dark:bg-[#111b21] border-[#cfeee2] dark:border-emerald-900/60', icon: 'bg-[#e8f7f1] text-[#047857] dark:bg-emerald-950/50 dark:text-emerald-300', eyebrow: 'bg-[#e8f7f1] text-[#047857] dark:bg-emerald-950/50 dark:text-emerald-300', title: 'text-[#0E1B3D] dark:text-white', body: 'text-[#4a5672] dark:text-slate-400' },
  amber: { panel: 'bg-[#fffbf3] dark:bg-amber-950/20 border-[#f6e1b5] dark:border-amber-900/60', icon: 'bg-[#fff1d6] text-[#92400e] dark:bg-amber-950/50 dark:text-amber-300', eyebrow: 'bg-[#fff1d6] text-[#92400e] dark:bg-amber-950/50 dark:text-amber-300', title: 'text-[#0E1B3D] dark:text-white', body: 'text-[#4a5672] dark:text-slate-400' },
  red: { panel: 'bg-[#fff8f8] dark:bg-red-950/20 border-[#f5cccc] dark:border-red-900/60', icon: 'bg-[#fde4e4] text-[#b91c1c] dark:bg-red-950/50 dark:text-red-300', eyebrow: 'bg-[#fde4e4] text-[#b91c1c] dark:bg-red-950/50 dark:text-red-300', title: 'text-[#0E1B3D] dark:text-white', body: 'text-[#4a5672] dark:text-slate-400' },
  neutral: { panel: 'bg-white dark:bg-[#111b21] border-[#e3e8f2] dark:border-slate-800', icon: 'bg-[#eef1f6] text-[#4a5672] dark:bg-slate-800 dark:text-slate-300', eyebrow: 'bg-[#eef1f6] text-[#4a5672] dark:bg-slate-800 dark:text-slate-300', title: 'text-[#0E1B3D] dark:text-white', body: 'text-[#4a5672] dark:text-slate-400' },
}

// ── AI credit meter ───────────────────────────────────────────────────────────

function CreditRing({ percent, paused }: { percent: number; paused: boolean }) {
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const color = paused ? '#E5484D' : percent <= 20 ? '#F59E0B' : '#00A884'
  return (
    <div className="relative h-32 w-32 shrink-0">
      <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="64" cy="64" r={radius} fill="none" className="stroke-[#eef1f6] dark:stroke-slate-800" strokeWidth="11" />
        <circle cx="64" cy="64" r={radius} fill="none" stroke={color} strokeWidth="11" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - percent / 100)} style={{ transition: 'stroke-dashoffset .7s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`${percent >= 100 ? 'text-[25px]' : 'text-[29px]'} font-extrabold tracking-tight text-[#0E1B3D] dark:text-white leading-none`}>{percent}%</span>
        <span className="text-[12.5px] font-semibold text-[#6B7894] mt-1">left</span>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const confirmDialog = useConfirm()
  const [orgId, setOrgId] = useState('')
  const [viewer, setViewer] = useState<RoleSubject>(null)
  const [orgName, setOrgName] = useState('')
  const [billing, setBilling] = useState<Billing | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [amount, setAmount] = useState<number | 'other'>(1000)
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

  // From an "Upgrade" card (?change=1): go straight to the plans
  const loaded = billing !== null
  useEffect(() => {
    if (loaded && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('change') === '1') {
      document.getElementById('plans')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [loaded])

  async function subscribe() {
    setBusy('subscribe'); setError(''); setNotice('')
    try {
      const res = await fetch('/api/billing/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, plan: billing?.plan.id }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The subscription could not be started.')
      const paid = await openRazorpay({
        key: data.keyId, subscription_id: data.subscriptionId, name: 'WAMA CRM',
        description: data.startsAt ? `${billing ? rupees(billing.plan.price) : ''} a month · first charge on ${formatDate(data.startsAt)}` : `${billing ? rupees(billing.plan.price) : ''} a month`,
        notes: { organization_id: orgId }, onFailure: (message: string) => setError(message),
      })
      if (!paid) return
      const verify = await fetch('/api/billing/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, ...paid }) })
      const result = await verify.json().catch(() => ({}))
      if (!verify.ok) throw new Error(result.error || 'The payment could not be confirmed.')
      setNotice(data.startsAt ? `Auto-pay is set up. Your first ${billing ? rupees(billing.plan.price) : 'payment'} is charged on ${formatDate(data.startsAt)}.` : 'Payment received. Your plan is active. Thank you!')
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
    const pending = Boolean(billing?.autoPayPending)
    const ok = await confirmDialog(pending
      ? { title: 'Cancel auto-pay?', message: `Nothing has been charged. Your free trial carries on until ${formatDate(billing?.accessUntil)}, and you can set up auto-pay again any time before then.`, confirmLabel: 'Cancel auto-pay', destructive: true }
      : { title: 'Stop auto-renew?', message: `You keep every feature until ${formatDate(billing?.accessUntil)}. You can turn auto-renew back on before then and nothing changes.`, confirmLabel: 'Stop auto-renew', destructive: true })
    if (!ok) return
    setBusy('cancel'); setError(''); setNotice('')
    try {
      const res = await fetch('/api/billing/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The plan could not be cancelled.')
      setNotice(data.trial
        ? `Auto-pay cancelled. Nothing was charged, and your free trial carries on until ${formatDate(data.accessUntil)}.`
        : `Auto-renew is off. You keep access until ${formatDate(data.accessUntil)}.`)
      window.dispatchEvent(new Event('billing:changed'))
      await load(orgId)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  /** Open Razorpay for a plan change's auto-pay, then confirm it. Returns true when set up. */
  async function approveAutoPay(subscriptionId: string, keyId: string, plan: PlanView, startsAt: string | null): Promise<boolean> {
    const paid = await openRazorpay({
      key: keyId, subscription_id: subscriptionId, name: 'WAMA CRM',
      description: `${plan.name} · ${rupees(plan.price)} a month${startsAt ? ` from ${formatDate(startsAt)}` : ''}`,
      notes: { organization_id: orgId }, onFailure: (message: string) => setError(message),
    })
    if (!paid) return false
    const res = await fetch('/api/billing/change-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, ...paid }) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'The auto-pay could not be confirmed.')
    return true
  }

  async function choosePlan(plan: PlanView) {
    if (!billing) return
    const up = plan.price > billing.plan.price
    const paying = billing.hasSubscription && !billing.autoPayPending
    const ok = await confirmDialog(paying
      ? up
        ? { title: `Upgrade to ${plan.name}?`, message: `${plan.name} starts as soon as you pay the difference for the days left this month. From your next bill date it is ${rupees(plan.price)} a month.`, confirmLabel: 'Continue' }
        : { title: `Move to ${plan.name}?`, message: `You keep ${billing.plan.name} until your next bill date (${formatDate(billing.accessUntil)}). From then it is ${rupees(plan.price)} a month. Anything ${plan.name} does not include is switched off then.`, confirmLabel: 'Continue' }
      : { title: `Switch to ${plan.name}?`, message: `${plan.name} is ${rupees(plan.price)} a month after your free trial. You can switch again any time.`, confirmLabel: 'Switch' })
    if (!ok) return
    setBusy(plan.id); setError(''); setNotice('')
    try {
      const res = await fetch('/api/billing/change-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, plan: plan.id }) })
      let data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The plan could not be changed.')
      if (data.kind === 'switched') {
        setNotice(data.autoPayCleared ? `You are on ${plan.name}. Set up auto-pay again for the new price.` : `You are on ${plan.name}.`)
      } else {
        if (data.kind === 'pay_difference') {
          const paid = await openRazorpay({
            key: data.keyId, order_id: data.orderId, amount: data.amount, currency: data.currency, name: 'WAMA CRM',
            description: `Upgrade to ${plan.name} for the rest of this month`, onFailure: (message: string) => setError(message),
          })
          if (!paid) return
          const verify = await fetch('/api/billing/change-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, ...paid }) })
          data = await verify.json().catch(() => ({}))
          if (!verify.ok) throw new Error(data.error || 'The payment could not be confirmed.')
          setNotice(`You are on ${plan.name}. Approve the new monthly auto-pay to keep it after this month.`)
        }
        if (data.kind === 'auto_pay' && data.subscriptionId) {
          const done = await approveAutoPay(data.subscriptionId, data.keyId, plan, data.startsAt)
          if (done) setNotice(up ? `You are on ${plan.name}. ${rupees(plan.price)} a month from ${formatDate(data.startsAt) || 'today'}.` : `Done. ${plan.name} starts on ${formatDate(data.startsAt) || 'your next bill date'}.`)
        }
      }
      await load(orgId)
      window.dispatchEvent(new Event('billing:changed'))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  async function topupMessages(value: number) {
    setBusy('messages'); setError(''); setNotice('')
    try {
      const res = await fetch('/api/billing/topup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, amount: value, wallet: 'messages' }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The top-up could not be started.')
      const paid = await openRazorpay({
        key: data.keyId, order_id: data.orderId, amount: data.amount, currency: data.currency, name: 'WAMA CRM', description: 'Message wallet',
        onFailure: (message: string) => setError(message),
      })
      if (!paid) return
      const verify = await fetch('/api/billing/topup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, wallet: 'messages', ...paid }) })
      const result = await verify.json().catch(() => ({}))
      if (!verify.ok) throw new Error(result.error || 'The payment could not be confirmed.')
      setNotice(`${rupees(value)} added to your message wallet.`)
      await load(orgId)
      window.dispatchEvent(new Event('billing:changed'))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  async function topup(value: number) {
    setBusy('topup'); setError(''); setNotice('')
    try {
      const res = await fetch('/api/billing/topup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, amount: value }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The top-up could not be started.')
      const paid = await openRazorpay({
        key: data.keyId, order_id: data.orderId, amount: data.amount, currency: data.currency, name: 'WAMA CRM', description: 'AI credit',
        onFailure: (message: string) => setError(message),
      })
      if (!paid) return
      const verify = await fetch('/api/billing/topup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, ...paid }) })
      const result = await verify.json().catch(() => ({}))
      if (!verify.ok) throw new Error(result.error || 'The payment could not be confirmed.')
      setNotice('AI credit added. Your meter is back to 100%.')
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
      <div className="h-full flex items-center justify-center bg-[#f6f8fc] dark:bg-[#0b141a]">
        {error ? <p className="text-[15px] text-[#b91c1c] flex items-center gap-2"><AlertCircle size={17} /> {error}</p> : <Loader2 className="animate-spin text-[#1D5BEA]" size={28} />}
      </div>
    )
  }

  const view = statusView(billing)
  const tone = TONES[view.tone]
  const StatusIcon = view.icon
  const percent = billing.aiPercentLeft ?? 0
  const custom = Number(customAmount)
  const chosen = amount === 'other' ? custom : amount
  const chosenValid = Number.isFinite(chosen) && chosen >= billing.minTopup && chosen <= billing.maxTopup
  const paymentsOn = Boolean(billing.razorpayKeyId) && billing.configured
  const aiTracked = !billing.exempt && billing.aiPercentLeft !== null

  return (
    <div className="h-full overflow-y-auto bg-[#f6f8fc] dark:bg-[#0b141a]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-24 md:pb-10 space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-[28px] sm:text-[30px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white">Billing</h1>
            <p className="text-[15px] text-[#4a5672] dark:text-slate-400 mt-0.5">{orgName ? `${orgName} · ` : ''}your plan, payments and AI credit</p>
          </div>
          <p className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-[#6B7894]"><Lock size={14} /> Payments secured by Razorpay</p>
        </div>

        {notice && <div role="status" className="rounded-xl bg-[#e8f7f1] dark:bg-emerald-950/40 text-[#047857] dark:text-emerald-300 px-4 py-3 text-[14.5px] font-semibold flex items-center gap-2"><CheckCircle2 size={18} className="shrink-0" /> {notice}</div>}
        {error && <div role="alert" className="rounded-xl bg-[#fdf0f0] dark:bg-red-950/40 text-[#b91c1c] dark:text-red-300 px-4 py-3 text-[14.5px] font-semibold flex items-center gap-2"><AlertCircle size={18} className="shrink-0" /> {error}</div>}

        {/* Where the workspace stands, and the one thing to do next */}
        <section className={`relative overflow-hidden rounded-2xl border ${tone.panel}`}>
          <div className="relative p-5 sm:p-7 flex flex-col md:flex-row md:items-center gap-5 md:gap-8">
            <div className="flex items-start gap-4 flex-1 min-w-0">
              <span className={`h-12 w-12 shrink-0 rounded-2xl flex items-center justify-center ${tone.icon}`}><StatusIcon size={24} /></span>
              <div className="min-w-0 flex-1">
                <span className={`inline-flex items-center h-6 px-2.5 rounded-full text-[12.5px] font-bold ${tone.eyebrow}`}>{view.eyebrow}</span>
                <h2 className={`text-[22px] sm:text-[26px] font-extrabold tracking-tight leading-tight mt-2 ${tone.title}`}>{view.title}</h2>
                <p className={`text-[15px] leading-relaxed mt-1.5 max-w-2xl ${tone.body}`}>{view.body}</p>
                {view.progress !== undefined && (
                  <div className="mt-4 max-w-md">
                    <div className="h-2 rounded-full bg-white/15 overflow-hidden"><div className="h-full rounded-full bg-[#7CF0A8]" style={{ width: `${view.progress}%` }} /></div>
                    <div className="flex justify-between text-[12.5px] text-white/60 mt-1.5"><span>Trial started</span><span>Ends {formatDate(billing.accessUntil)}</span></div>
                  </div>
                )}
              </div>
            </div>

            {view.action && (
              <div className="md:w-[290px] shrink-0 md:text-right">
                {!canPay ? (
                  <p className={`text-[14px] ${tone.body}`}>Only workspace admins can change the plan.</p>
                ) : view.action.kind === 'cancel' ? (
                  <button type="button" onClick={cancel} disabled={busy !== null} className="inline-flex items-center gap-2 h-11 px-5 rounded-xl border border-[#d5ddeb] dark:border-slate-700 text-[#0E1B3D] dark:text-slate-100 text-[14.5px] font-semibold hover:bg-[#f4f6fa] dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50">
                    {busy === 'cancel' && <Loader2 size={16} className="animate-spin" />} {view.action.label}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={subscribe}
                      disabled={busy !== null || !paymentsOn}
                      className={`w-full md:w-auto inline-flex items-center justify-center gap-2 h-12 px-6 rounded-xl text-[15.5px] font-bold transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                        view.tone === 'brand' ? 'bg-white text-[#0E1B3D] hover:bg-[#eef3fe]' : view.tone === 'red' ? 'bg-[#b91c1c] text-white hover:bg-[#991b1b]' : 'bg-[#1D5BEA] text-white hover:bg-[#174bc4]'
                      }`}
                    >
                      {busy === 'subscribe' ? <Loader2 size={18} className="animate-spin" /> : view.tone === 'amber' ? <RotateCcw size={18} /> : <CreditCard size={18} />}
                      {view.action.label}
                    </button>
                    <p className={`text-[13px] mt-2 ${tone.body}`}>{paymentsOn ? view.action.caption : 'Online payments are not switched on yet. Please contact us.'}</p>
                  </>
                )}
              </div>
            )}
          </div>
          {view.facts && view.facts.length > 0 && (
            <dl className={`relative grid grid-cols-1 sm:grid-cols-3 border-t ${view.tone === 'brand' ? 'border-white/10' : 'border-black/5 dark:border-white/10'}`}>
              {view.facts.map((fact, index) => (
                <div key={fact.label} className={`px-5 sm:px-7 py-3.5 ${index > 0 ? `border-t sm:border-t-0 sm:border-l ${view.tone === 'brand' ? 'border-white/10' : 'border-black/5 dark:border-white/10'}` : ''}`}>
                  <dt className={`text-[12.5px] font-semibold ${view.tone === 'brand' ? 'text-white/60' : 'text-[#6B7894]'}`}>{fact.label}</dt>
                  <dd className={`text-[15.5px] font-bold mt-0.5 ${view.tone === 'brand' ? 'text-white' : 'text-[#0E1B3D] dark:text-white'}`}>{fact.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        {!billing.exempt && billing.configured && (
          <PlanPicker plans={billing.plans} currentId={billing.plan.id} pendingId={billing.pendingPlan?.id} canChange={canPay && paymentsOn} busyId={busy} onChoose={choosePlan} />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <div className="lg:col-span-7">
          {/* The plan: everything included */}
          <section className={card}>
            <div className="p-5 sm:p-6 border-b border-[#eef1f6] dark:border-slate-800">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-[13.5px] font-semibold text-[#6B7894]">Your plan</p>
                  <h2 className="text-[22px] font-extrabold text-[#0E1B3D] dark:text-white mt-0.5">{billing.plan.name}</h2>
                </div>
                {!billing.exempt && (
                  <p className="text-right"><span className="text-[34px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white">{rupees(billing.plan.price)}</span><span className="text-[15px] font-semibold text-[#6B7894]"> / month</span></p>
                )}
              </div>
              <p className="text-[14.5px] text-[#4a5672] dark:text-slate-400 mt-1">{billing.plan.tagline}. Plus 18% GST.</p>
            </div>

            <ul className="p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
              {billing.plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-3 text-[15px] leading-snug text-[#0E1B3D] dark:text-slate-200">
                  <CheckCircle2 size={19} className="shrink-0 mt-px text-[#1D5BEA]" /> {feature}
                </li>
              ))}
            </ul>

            <div className="border-t border-[#eef1f6] dark:border-slate-800 px-5 sm:px-6 py-3.5 flex flex-wrap gap-x-6 gap-y-2 text-[13.5px] text-[#4a5672] dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5"><Wallet size={15} className="text-[#00A884]" /> UPI, cards and net banking</span>
              <span className="inline-flex items-center gap-1.5"><RotateCcw size={15} className="text-[#00A884]" /> Stop any time</span>
              <span className="inline-flex items-center gap-1.5"><Mail size={15} className="text-[#00A884]" /> Receipt emailed for every payment</span>
            </div>
          </section>
          </div>
          <div className="lg:col-span-5 space-y-5">
          {(billing.whatsappMode === 'shared' || billing.messageBalance > 0) && (
            <MessageWallet balance={billing.messageBalance} price={billing.messagePrices.utility} history={billing.messages || []} options={billing.messageTopupOptions || []} canPay={canPay && paymentsOn} busy={busy !== null} onTopup={topupMessages} />
          )}
          {/* AI credit */}
          <section className={`${card} p-5 sm:p-6`}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[17px] font-bold text-[#0E1B3D] dark:text-white flex items-center gap-2"><Sparkles size={18} className="text-[#1D5BEA]" /> AI credit</h2>
              {aiTracked && (
                <span className={`inline-flex items-center h-6 px-2.5 rounded-full text-[12.5px] font-bold ${billing.aiPaused ? 'bg-[#fde4e4] text-[#b91c1c] dark:bg-red-950/50 dark:text-red-300' : percent <= 20 ? 'bg-[#fff1d6] text-[#92400e] dark:bg-amber-950/50 dark:text-amber-300' : 'bg-[#e8f7f1] text-[#047857] dark:bg-emerald-950/50 dark:text-emerald-300'}`}>
                  {billing.aiPaused ? 'Paused' : percent <= 20 ? 'Running low' : 'Running'}
                </span>
              )}
            </div>

            {!aiTracked ? (
              <p className="mt-4 text-[15px] text-[#4a5672] dark:text-slate-400">Your workspace uses its own AI key, so there is no AI credit to track.</p>
            ) : (
              <>
                <div className="mt-4 flex items-center gap-5">
                  <CreditRing percent={percent} paused={billing.aiPaused} />
                  <div className="min-w-0">
                    <p className="text-[15.5px] font-bold text-[#0E1B3D] dark:text-white">
                      {billing.aiPaused ? 'AI is paused' : percent <= 20 ? 'Add credit soon' : 'AI is working for you'}
                    </p>
                    <p className="text-[14px] text-[#4a5672] dark:text-slate-400 mt-1 leading-snug">
                      {billing.aiPaused ? 'Add credit to switch AI replies and suggestions back on. Everything else keeps working.' : 'Credit is used a little at a time as AI helps your team.'}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {AI_USES.map((use) => <span key={use} className="inline-flex items-center h-7 px-2.5 rounded-lg bg-[#f1f4f9] dark:bg-slate-800 text-[12.5px] font-medium text-[#4a5672] dark:text-slate-300">{use}</span>)}
                </div>

                <div className="mt-5 pt-5 border-t border-[#eef1f6] dark:border-slate-800">
                  {canPay ? (
                    <>
                      <p className="text-[14.5px] font-bold text-[#0E1B3D] dark:text-white">Add credit</p>
                      <p className="text-[13px] text-[#6B7894] mt-0.5">The meter goes back to 100%. Credit never expires.</p>
                      <div role="radiogroup" aria-label="Amount" className="mt-3 grid grid-cols-3 gap-2">
                        {[...billing.topupOptions, 'other' as const].map((option) => {
                          const selected = amount === option
                          return (
                            <button key={option} type="button" role="radio" aria-checked={selected} onClick={() => setAmount(option)}
                              className={`h-11 rounded-xl border text-[15px] font-bold transition-colors cursor-pointer ${selected ? 'border-[#1D5BEA] bg-[#eef3fe] text-[#1D5BEA] dark:bg-blue-950/40 dark:text-blue-300' : 'border-[#d5ddeb] dark:border-slate-700 text-[#0E1B3D] dark:text-white hover:border-[#9db5ef]'}`}>
                              {option === 'other' ? 'Other' : rupees(option)}
                            </button>
                          )
                        })}
                      </div>
                      {amount === 'other' && (
                        <label className="relative block mt-2">
                          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] font-semibold text-[#6B7894]">₹</span>
                          <input value={customAmount} onChange={(event) => setCustomAmount(event.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" autoFocus
                            placeholder={`${billing.minTopup} to ${billing.maxTopup.toLocaleString('en-IN')}`} aria-label="Other amount"
                            className="w-full h-11 pl-8 pr-3 rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] text-[15px] text-[#0E1B3D] dark:text-white focus:outline-none focus:border-[#1D5BEA] focus:ring-2 focus:ring-[#1D5BEA]/15" />
                        </label>
                      )}
                      <button type="button" onClick={() => topup(chosen)} disabled={!chosenValid || busy !== null || !paymentsOn}
                        className="mt-3 w-full inline-flex items-center justify-center gap-2 h-12 rounded-xl bg-[#1D5BEA] hover:bg-[#174bc4] text-white text-[15.5px] font-bold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                        {busy === 'topup' ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                        {chosenValid ? `Add ${rupees(chosen)} of AI credit` : `Choose an amount (₹${billing.minTopup}+)`}
                      </button>
                    </>
                  ) : (
                    <p className="text-[14px] text-[#6B7894]">Your workspace admin can add AI credit.</p>
                  )}
                </div>
              </>
            )}
          </section>

          </div>
        </div>

        {/* How businesses use it */}
        <section aria-labelledby="use-cases" className="pt-2">
          <h2 id="use-cases" className="text-[22px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white">How businesses use WAMA CRM</h2>
          <p className="text-[15px] text-[#4a5672] dark:text-slate-400 mt-0.5">A few of the ways teams put it to work every day.</p>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {USE_CASES.map((useCase, index) => {
              const Icon = USE_CASE_ICONS[useCase.id] || Sparkles
              const tint = TINTS[index % TINTS.length]
              return (
                <article key={useCase.id} className={`${card} p-5 flex flex-col`}>
                  <div className="flex items-center gap-3">
                    <span className={`h-10 w-10 shrink-0 rounded-xl flex items-center justify-center ${tint}`}><Icon size={19} /></span>
                    <span className="text-[13.5px] font-semibold text-[#6B7894]">{useCase.business}</span>
                  </div>
                  <h3 className="text-[17px] font-bold leading-snug text-[#0E1B3D] dark:text-white mt-3.5">{useCase.headline}</h3>
                  <ol className="mt-3.5 space-y-2.5">
                    {useCase.steps.map((step, stepIndex) => (
                      <li key={step} className="flex items-start gap-2.5 text-[14px] leading-snug text-[#4a5672] dark:text-slate-300">
                        <span className="h-5 w-5 shrink-0 mt-px rounded-full bg-[#f1f4f9] dark:bg-slate-800 text-[11.5px] font-bold text-[#0E1B3D] dark:text-white flex items-center justify-center">{stepIndex + 1}</span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </article>
              )
            })}
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start pt-2">
          {canPay && !billing.exempt && (
            <div className="lg:col-span-7">
            <section className={`${card}`}>
              <div className="px-5 sm:px-6 py-4 border-b border-[#eef1f6] dark:border-slate-800 flex items-center gap-2">
                <Receipt size={18} className="text-[#1D5BEA]" />
                <h2 className="text-[17px] font-bold text-[#0E1B3D] dark:text-white">Payments</h2>
              </div>
              {billing.payments.length === 0 ? (
                <div className="px-5 sm:px-6 py-10 text-center">
                  <div className="mx-auto h-11 w-11 rounded-2xl bg-[#f1f4f9] dark:bg-slate-800 flex items-center justify-center text-[#8a94a8]"><Receipt size={20} /></div>
                  <p className="text-[15px] font-semibold text-[#0E1B3D] dark:text-white mt-3">No payments yet</p>
                  <p className="text-[14px] text-[#6B7894] mt-0.5">Your plan and AI credit payments will show here.</p>
                </div>
              ) : (
                <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800">
                  {billing.payments.map((payment, index) => {
                    const isPlan = payment.purpose === 'subscription'
                    return (
                      <li key={`${payment.date}-${index}`} className="px-5 sm:px-6 py-3.5 flex items-center gap-3">
                        <span className={`h-10 w-10 shrink-0 rounded-xl flex items-center justify-center ${isPlan ? 'bg-[#eef3fe] text-[#1D5BEA] dark:bg-blue-950/40 dark:text-blue-300' : 'bg-[#e8f7f1] text-[#047857] dark:bg-emerald-950/40 dark:text-emerald-300'}`}>
                          {isPlan ? <CreditCard size={18} /> : <Sparkles size={18} />}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[14.5px] font-semibold text-[#0E1B3D] dark:text-white">{isPlan ? `WAMA CRM ${billing.plans.find((plan) => plan.id === payment.plan)?.name || 'plan'} · monthly` : payment.purpose === 'upgrade' ? `Upgrade to ${billing.plans.find((plan) => plan.id === payment.plan)?.name || 'a bigger plan'}` : payment.purpose === 'message_topup' ? 'Message wallet' : 'AI credit'}</span>
                          <span className="block text-[13px] text-[#6B7894]">{formatDate(payment.date)}</span>
                        </span>
                        <span className="text-right">
                          <span className="block text-[15px] font-bold text-[#0E1B3D] dark:text-white">{rupees(payment.amount)}</span>
                          <span className="block text-[12.5px] font-semibold text-[#047857] dark:text-emerald-300">Paid</span>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
            </div>
          )}
          <div className={canPay && !billing.exempt ? 'lg:col-span-5' : 'lg:col-span-12'}>
          {/* Questions */}
          <section className={`${card}`}>
            <div className="px-5 sm:px-6 py-4 border-b border-[#eef1f6] dark:border-slate-800 flex items-center gap-2">
              <Bot size={18} className="text-[#1D5BEA]" />
              <h2 className="text-[17px] font-bold text-[#0E1B3D] dark:text-white">Common questions</h2>
            </div>
            <div className="divide-y divide-[#eef1f6] dark:divide-slate-800">
              {FAQ.map((item) => (
                <details key={item.q} className="group px-5 sm:px-6">
                  <summary className="flex items-center justify-between gap-3 py-3.5 cursor-pointer list-none text-[14.5px] font-semibold text-[#0E1B3D] dark:text-white [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <ChevronDown size={17} className="shrink-0 text-[#8a94a8] transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="pb-4 -mt-1 text-[14px] leading-relaxed text-[#4a5672] dark:text-slate-400">{item.a}</p>
                </details>
              ))}
            </div>
            {SUPPORT_EMAIL && (
              <p className="px-5 sm:px-6 py-3.5 border-t border-[#eef1f6] dark:border-slate-800 text-[13.5px] text-[#6B7894]">
                Need help with billing? Write to <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-[#1D5BEA] hover:underline">{SUPPORT_EMAIL}</a>
              </p>
            )}
          </section>
          </div>
        </div>
      </div>
    </div>
  )
}
