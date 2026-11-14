'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowDownUp, BellRing, Building2, CheckCircle2, ChevronRight, CircleAlert, Clock, CreditCard, Download, Loader2, Search, Trash2 } from 'lucide-react'
import { SharedNumberPanel } from './shared-number'

// ── What the server sends (lib/superadmin-workspaces.ts) ─────────────────────

export interface Attention { kind: string; text: string; urgent: boolean }

export interface ConsoleBilling {
  configured: boolean
  exempt: boolean
  status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired'
  hasAccess: boolean
  trialDaysLeft: number | null
  accessUntil: string | null
  cancelAtPeriodEnd: boolean
  aiPercentLeft: number | null
  aiPaused: boolean
  onTrial: boolean
  plan: string
  planName: string
  price: number
  whatsappMode: 'own' | 'shared'
  messageBalance: number
}

export interface ConsoleWorkspace {
  id: string
  name: string
  slug: string
  created_at: string
  contact_email: string | null
  whatsapp: 'meta' | 'twilio' | null
  members: number
  max_teammates: number | null
  last_active_at?: string | null
  attention?: Attention[]
  billing: ConsoleBilling
}

export interface PlanRow { plan: string; name: string; price: number; paying: number; trial: number; revenue: number }

export interface ConsoleTotals {
  workspaces: number
  paying: number
  trialing: number
  expired: number
  exempt: number
  pastDue: number
  monthlyRevenue: number
  people: number
  attention?: number
  trialsEndingSoon?: number
  byPlan?: PlanRow[]
}

export type WorkspaceFilter = 'all' | 'paying' | 'trial' | 'attention' | 'ended' | 'exempt'

// ── Shared bits ──────────────────────────────────────────────────────────────

const card = 'bg-white dark:bg-[#111b21] rounded-2xl border border-[#e3e8f2] dark:border-slate-800'
const field = 'h-10 px-3 rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] text-[14px] text-[#0E1B3D] dark:text-white placeholder:text-[#8a94a8] focus:outline-none focus:border-[#1D5BEA]'
const rupees = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const formatDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

/** "Today", "3 days ago", "2 months ago", or "No chats yet". */
export function lastActive(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'No chats yet'
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  return months < 12 ? `${months} month${months === 1 ? '' : 's'} ago` : 'Over a year ago'
}

/** The plan and where it stands, in a few words. Red only when something is wrong. */
export function planStatus(b: ConsoleBilling): { label: string; tone: 'plain' | 'blue' | 'red' } {
  if (!b.configured) return { label: 'No billing yet', tone: 'plain' }
  if (b.exempt) return { label: 'Exempt', tone: 'plain' }
  if (b.status === 'past_due') return { label: 'Payment failed', tone: 'red' }
  if (!b.hasAccess) return { label: b.onTrial ? 'Trial ended' : 'Plan ended', tone: 'red' }
  if (b.status === 'trialing') return { label: `Trial · ${b.trialDaysLeft ?? 0}d left`, tone: 'blue' }
  if (b.status === 'active') return { label: b.cancelAtPeriodEnd ? `Paid till ${formatDate(b.accessUntil)}` : 'Paying', tone: 'plain' }
  return { label: `Cancelled · till ${formatDate(b.accessUntil)}`, tone: 'plain' }
}

const TONES = {
  plain: 'bg-[#eef1f6] text-[#0E1B3D] dark:bg-slate-800 dark:text-slate-200',
  blue: 'bg-[#eef3fe] text-[#1D5BEA] dark:bg-blue-950/40 dark:text-blue-300',
  red: 'bg-[#fdf0f0] text-[#b91c1c] dark:bg-red-950/40 dark:text-red-300',
}

export function StatusPill({ billing }: { billing: ConsoleBilling }) {
  const { label, tone } = planStatus(billing)
  return <span className={`inline-flex items-center px-2.5 h-7 rounded-lg text-[12.5px] font-bold whitespace-nowrap ${TONES[tone]}`}>{label}</span>
}

function AttentionChips({ items }: { items: Attention[] }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span key={item.kind} className={`inline-flex items-center px-2 h-6 rounded-md text-[12px] font-semibold whitespace-nowrap ${item.urgent ? TONES.red : TONES.plain}`}>{item.text}</span>
      ))}
    </span>
  )
}

function whatsappLabel(w: ConsoleWorkspace): string {
  if (w.billing.whatsappMode === 'shared' && !w.billing.exempt) return "WAMA's number"
  return w.whatsapp === 'meta' ? 'Own number' : w.whatsapp === 'twilio' ? 'Twilio' : 'Not connected'
}

function matches(w: ConsoleWorkspace, filter: WorkspaceFilter): boolean {
  const b = w.billing
  if (filter === 'paying') return !b.exempt && (b.status === 'active' || b.status === 'past_due')
  if (filter === 'trial') return !b.exempt && b.status === 'trialing' && b.hasAccess
  if (filter === 'attention') return (w.attention || []).length > 0
  if (filter === 'ended') return b.configured && !b.exempt && !b.hasAccess
  if (filter === 'exempt') return b.exempt
  return true
}

// ── Overview ─────────────────────────────────────────────────────────────────

function Tile({ label, value, hint, alert, onClick }: { label: string; value: string; hint?: string; alert?: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`${card} px-4 py-4 text-left min-w-0 hover:border-[#1D5BEA] transition-colors cursor-pointer`}>
      <span className="block text-[13px] font-semibold text-[#6B7894] truncate">{label}</span>
      <span className={`block text-[26px] font-extrabold leading-tight mt-1 truncate ${alert ? 'text-[#b91c1c]' : 'text-[#0E1B3D] dark:text-white'}`}>{value}</span>
      {hint && <span className="block text-[12.5px] text-[#8a94a8] mt-0.5 truncate">{hint}</span>}
    </button>
  )
}

function ListCard({ title, icon, empty, children, action }: { title: string; icon: React.ReactNode; empty?: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className={`${card} min-w-0`}>
      <div className="px-4 sm:px-5 py-3.5 border-b border-[#eef1f6] dark:border-slate-800 flex items-center gap-2">
        {icon}
        <h2 className="flex-1 text-[16px] font-bold text-[#0E1B3D] dark:text-white">{title}</h2>
        {action}
      </div>
      {empty ? <p className="px-5 py-8 text-[14px] text-[#6B7894] text-center">{empty}</p> : children}
    </section>
  )
}

function Row({ workspace, sub, right, onOpen }: { workspace: ConsoleWorkspace; sub: React.ReactNode; right?: React.ReactNode; onOpen: (id: string) => void }) {
  return (
    <li>
      <button type="button" onClick={() => onOpen(workspace.id)} className="w-full flex items-center gap-3 px-4 sm:px-5 py-3 text-left hover:bg-[#f4f6fa] dark:hover:bg-slate-800/50 cursor-pointer">
        <span className="flex-1 min-w-0">
          <span className="block text-[14.5px] font-semibold text-[#0E1B3D] dark:text-white truncate">{workspace.name}</span>
          <span className="block text-[13px] text-[#6B7894] mt-0.5">{sub}</span>
        </span>
        {right}
        <ChevronRight size={16} className="shrink-0 text-[#8a94a8]" />
      </button>
    </li>
  )
}

/** The first screen: money, who needs help, which plans sell, trials about to end, who just joined. */
export function ConsoleOverview({ workspaces, totals, billingReady, onOpen, onShow }: {
  workspaces: ConsoleWorkspace[]
  totals: ConsoleTotals | null
  billingReady: boolean
  onOpen: (id: string) => void
  onShow: (filter: WorkspaceFilter) => void
}) {
  const attention = useMemo(() => workspaces.filter((w) => (w.attention || []).length > 0)
    .sort((a, b) => Number((b.attention || []).some((x) => x.urgent)) - Number((a.attention || []).some((x) => x.urgent))), [workspaces])
  const trials = useMemo(() => workspaces.filter((w) => matches(w, 'trial')).sort((a, b) => (a.billing.trialDaysLeft ?? 99) - (b.billing.trialDaysLeft ?? 99)), [workspaces])
  const plans = totals?.byPlan || []
  const biggest = Math.max(1, ...plans.map((plan) => plan.paying + plan.trial))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Monthly revenue" value={rupees(totals?.monthlyRevenue || 0)} hint={`${totals?.paying || 0} paying`} onClick={() => onShow('paying')} />
        <Tile label="On free trial" value={String(totals?.trialing || 0)} hint={totals?.trialsEndingSoon ? `${totals.trialsEndingSoon} end in 3 days` : 'None ending soon'} onClick={() => onShow('trial')} />
        <Tile label="Need attention" value={String(totals?.attention ?? attention.length)} hint={totals?.pastDue ? `${totals.pastDue} payment failed` : totals?.expired ? `${totals.expired} ended` : 'Nothing urgent'} alert={attention.some((w) => (w.attention || []).some((x) => x.urgent))} onClick={() => onShow('attention')} />
        <Tile label="Workspaces" value={String(totals?.workspaces || 0)} hint={`${totals?.people || 0} people${billingReady ? ` · ${totals?.exempt || 0} exempt` : ''}`} onClick={() => onShow('all')} />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <ListCard title="Needs attention" icon={<AlertTriangle size={17} className="text-[#b91c1c]" />} empty={attention.length ? undefined : 'All good. Nothing needs you right now.'}
          action={attention.length > 6 ? <button type="button" onClick={() => onShow('attention')} className="text-[13.5px] font-semibold text-[#1D5BEA] cursor-pointer">See all {attention.length}</button> : undefined}>
          <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800">
            {attention.slice(0, 6).map((w) => <Row key={w.id} workspace={w} onOpen={onOpen} sub={<AttentionChips items={w.attention || []} />} />)}
          </ul>
        </ListCard>

        <ListCard title="Plans" icon={<CreditCard size={17} className="text-[#1D5BEA]" />} empty={billingReady ? undefined : 'Billing is not switched on yet.'}>
          <ul className="px-4 sm:px-5 py-3 space-y-3">
            {plans.map((plan) => (
              <li key={plan.plan} className="min-w-0">
                <div className="flex items-baseline justify-between gap-3 text-[14px]">
                  <span className="font-semibold text-[#0E1B3D] dark:text-white truncate">{plan.name} <span className="font-normal text-[#6B7894]">· {rupees(plan.price)}</span></span>
                  <span className="shrink-0 text-[#4a5672] dark:text-slate-300">{plan.paying} paying · {plan.trial} trial</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-[#eef1f6] dark:bg-slate-800 overflow-hidden flex">
                    <div className="h-full bg-[#0E1B3D] dark:bg-white" style={{ width: `${(plan.paying / biggest) * 100}%` }} />
                    <div className="h-full bg-[#1D5BEA]/45" style={{ width: `${(plan.trial / biggest) * 100}%` }} />
                  </div>
                  <span className="w-20 shrink-0 text-right text-[13px] font-semibold text-[#0E1B3D] dark:text-white">{rupees(plan.revenue)}</span>
                </div>
              </li>
            ))}
          </ul>
          <p className="px-4 sm:px-5 pb-3.5 text-[12.5px] text-[#8a94a8]">Dark bar: paying. Light bar: on trial. Amount: what the plan brings in a month.</p>
        </ListCard>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <ListCard title="Trials ending next" icon={<Clock size={17} className="text-[#1D5BEA]" />} empty={trials.length ? undefined : 'Nobody is on a free trial.'}>
          <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800">
            {trials.slice(0, 6).map((w) => (
              <Row key={w.id} workspace={w} onOpen={onOpen} sub={`${w.billing.planName} · last chat: ${lastActive(w.last_active_at).toLowerCase()}`}
                right={<span className={`shrink-0 text-[13px] font-bold ${(w.billing.trialDaysLeft ?? 99) <= 3 ? 'text-[#b91c1c]' : 'text-[#0E1B3D] dark:text-white'}`}>{w.billing.trialDaysLeft ?? 0}d left</span>} />
            ))}
          </ul>
        </ListCard>
        <ListCard title="Newest workspaces" icon={<Building2 size={17} className="text-[#1D5BEA]" />} empty={workspaces.length ? undefined : 'No workspaces yet.'}>
          <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800">
            {workspaces.slice(0, 6).map((w) => <Row key={w.id} workspace={w} onOpen={onOpen} sub={`Joined ${formatDate(w.created_at)} · ${w.members} ${w.members === 1 ? 'person' : 'people'}`} right={<StatusPill billing={w.billing} />} />)}
          </ul>
        </ListCard>
      </div>
    </div>
  )
}

// ── Workspaces ───────────────────────────────────────────────────────────────

type Sort = 'newest' | 'name' | 'trial' | 'active'

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  // A cell starting with = + - @ could run as a formula in a spreadsheet
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Every workspace: filter by where it stands and by plan, search, sort, save as a spreadsheet. A table on wide screens, cards on phones. */
export function WorkspaceList({ workspaces, filter, onFilter, onOpen }: { workspaces: ConsoleWorkspace[]; filter: WorkspaceFilter; onFilter: (filter: WorkspaceFilter) => void; onOpen: (id: string) => void }) {
  const [search, setSearch] = useState('')
  const [plan, setPlan] = useState('all')
  const [sort, setSort] = useState<Sort>('newest')
  const filters: [WorkspaceFilter, string][] = [['all', 'All'], ['paying', 'Paying'], ['trial', 'On trial'], ['attention', 'Need attention'], ['ended', 'Ended'], ['exempt', 'Exempt']]
  const planNames = useMemo(() => [...new Map(workspaces.filter((w) => !w.billing.exempt && w.billing.configured).map((w) => [w.billing.plan, w.billing.planName])).entries()], [workspaces])

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = workspaces.filter((w) => matches(w, filter) && (plan === 'all' || (w.billing.plan === plan && !w.billing.exempt)) && (!q || `${w.name} ${w.slug} ${w.contact_email || ''}`.toLowerCase().includes(q)))
    const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : 0)
    if (sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name))
    else if (sort === 'trial') rows.sort((a, b) => (a.billing.status === 'trialing' ? a.billing.trialDaysLeft ?? 99 : 999) - (b.billing.status === 'trialing' ? b.billing.trialDaysLeft ?? 99 : 999))
    else if (sort === 'active') rows.sort((a, b) => time(b.last_active_at) - time(a.last_active_at))
    else rows.sort((a, b) => time(b.created_at) - time(a.created_at))
    return rows
  }, [workspaces, filter, plan, search, sort])

  function download() {
    const head = ['Workspace', 'Email', 'Plan', 'Price', 'Status', 'WhatsApp', 'People', 'AI credit left %', 'Message wallet', 'Last chat', 'Joined', 'Needs attention']
    const lines = list.map((w) => [w.name, w.contact_email || '', w.billing.exempt ? 'Exempt' : w.billing.planName, w.billing.exempt ? '' : w.billing.price, planStatus(w.billing).label, whatsappLabel(w), w.members,
      w.billing.aiPercentLeft ?? '', w.billing.whatsappMode === 'shared' ? w.billing.messageBalance : '', w.last_active_at ? formatDate(w.last_active_at) : '', formatDate(w.created_at), (w.attention || []).map((a) => a.text).join('; ')])
    const csv = [head, ...lines].map((row) => row.map(csvCell).join(',')).join('\n')
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
    link.download = `wama-workspaces-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <section className={card}>
      <div className="px-4 sm:px-5 py-4 border-b border-[#eef1f6] dark:border-slate-800 space-y-3">
        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5">
          {filters.map(([id, label]) => {
            const count = workspaces.filter((w) => matches(w, id)).length
            return (
              <button key={id} type="button" onClick={() => onFilter(id)} aria-pressed={filter === id}
                className={`px-3 h-9 rounded-lg text-[13.5px] font-semibold whitespace-nowrap cursor-pointer ${filter === id ? 'bg-[#0E1B3D] text-white dark:bg-white dark:text-[#0E1B3D]' : 'bg-[#eef1f6] dark:bg-slate-800 text-[#4a5672] dark:text-slate-300 hover:text-[#0E1B3D]'}`}>
                {label} <span className={filter === id ? 'opacity-70' : 'text-[#8a94a8]'}>{count}</span>
              </button>
            )
          })}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <label className="relative flex-1 min-w-0">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a94a8]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email" className={`${field} w-full pl-9`} aria-label="Search workspaces" />
          </label>
          <div className="grid grid-cols-[1fr_1fr_auto] sm:flex gap-2">
            <select value={plan} onChange={(e) => setPlan(e.target.value)} className={`${field} flex-1 sm:flex-none min-w-0`} aria-label="Plan">
              <option value="all">All plans</option>
              {planNames.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <label className="relative flex-1 sm:flex-none min-w-0">
              <ArrowDownUp size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a94a8] pointer-events-none" />
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={`${field} w-full pl-8`} aria-label="Sort">
                <option value="newest">Newest</option>
                <option value="name">Name</option>
                <option value="trial">Trial ending</option>
                <option value="active">Last chat</option>
              </select>
            </label>
            <button type="button" onClick={download} disabled={!list.length} title="Save this list as a spreadsheet" aria-label="Save this list as a spreadsheet"
              className="h-10 w-10 shrink-0 rounded-xl border border-[#d5ddeb] dark:border-slate-700 flex items-center justify-center text-[#0E1B3D] dark:text-white hover:border-[#1D5BEA] hover:text-[#1D5BEA] cursor-pointer disabled:opacity-40"><Download size={16} /></button>
          </div>
        </div>
      </div>

      {list.length === 0 ? <p className="px-5 py-12 text-center text-[14px] text-[#6B7894]">No workspaces match.</p> : (
        <>
          {/* Phones: one card per workspace */}
          <ul className="md:hidden divide-y divide-[#eef1f6] dark:divide-slate-800">
            {list.map((w) => (
              <li key={w.id}>
                <button type="button" onClick={() => onOpen(w.id)} className="w-full text-left px-4 py-3.5 hover:bg-[#f4f6fa] dark:hover:bg-slate-800/40 cursor-pointer">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-[15px] font-bold text-[#0E1B3D] dark:text-white truncate">{w.name}</span>
                      <span className="block text-[13px] text-[#6B7894] truncate">{w.contact_email || w.slug}</span>
                    </span>
                    <StatusPill billing={w.billing} />
                  </span>
                  <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-[#4a5672] dark:text-slate-300">
                    {!w.billing.exempt && w.billing.configured && <span>{w.billing.planName} · {rupees(w.billing.price)}</span>}
                    <span>{whatsappLabel(w)}</span>
                    <span>{w.members} {w.members === 1 ? 'person' : 'people'}</span>
                    <span>Last chat: {lastActive(w.last_active_at).toLowerCase()}</span>
                  </span>
                  {(w.attention || []).length > 0 && <span className="mt-2 block"><AttentionChips items={w.attention || []} /></span>}
                </button>
              </li>
            ))}
          </ul>

          {/* Wider screens: a table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="text-left text-[13px] text-[#6B7894]">
                  <th className="px-5 py-3 font-semibold">Workspace</th>
                  <th className="px-3 py-3 font-semibold">Plan</th>
                  <th className="px-3 py-3 font-semibold">WhatsApp</th>
                  <th className="px-3 py-3 font-semibold">People</th>
                  <th className="px-3 py-3 font-semibold">Credit</th>
                  <th className="px-3 py-3 font-semibold">Last chat</th>
                  <th className="px-3 py-3 font-semibold">Joined</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {list.map((w) => {
                  const b = w.billing
                  return (
                    <tr key={w.id} onClick={() => onOpen(w.id)} className="border-t border-[#eef1f6] dark:border-slate-800 hover:bg-[#f4f6fa] dark:hover:bg-slate-800/40 cursor-pointer align-top">
                      <td className="px-5 py-3 max-w-[260px]">
                        <div className="font-semibold text-[#0E1B3D] dark:text-white truncate">{w.name}</div>
                        <div className="text-[13px] text-[#6B7894] truncate">{w.contact_email || w.slug}</div>
                        {(w.attention || []).length > 0 && <div className="mt-1.5"><AttentionChips items={w.attention || []} /></div>}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {!b.exempt && b.configured && <div className="text-[13px] font-semibold text-[#0E1B3D] dark:text-white mb-1">{b.planName} · {rupees(b.price)}</div>}
                        <StatusPill billing={b} />
                      </td>
                      <td className={`px-3 py-3 whitespace-nowrap ${whatsappLabel(w) === 'Not connected' ? 'text-[#8a94a8]' : 'text-[#4a5672] dark:text-slate-300'}`}>{whatsappLabel(w)}</td>
                      <td className="px-3 py-3 text-[#0E1B3D] dark:text-slate-200 whitespace-nowrap">{w.members}{w.max_teammates ? ` / ${w.max_teammates}` : ''}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-[13px]">
                        {b.exempt || !b.configured ? <span className="text-[#8a94a8]">—</span> : (
                          <>
                            {b.aiPercentLeft !== null && <div className={b.aiPaused ? 'font-semibold text-[#b91c1c]' : 'text-[#4a5672] dark:text-slate-300'}>AI {b.aiPercentLeft}%</div>}
                            {b.whatsappMode === 'shared' && <div className={b.messageBalance < 100 ? 'font-semibold text-[#b91c1c]' : 'text-[#4a5672] dark:text-slate-300'}>Messages {rupees(b.messageBalance)}</div>}
                          </>
                        )}
                      </td>
                      <td className="px-3 py-3 text-[#4a5672] dark:text-slate-300 whitespace-nowrap">{lastActive(w.last_active_at)}</td>
                      <td className="px-3 py-3 text-[#4a5672] dark:text-slate-300 whitespace-nowrap">{formatDate(w.created_at)}</td>
                      <td className="px-3 py-3 text-right"><ChevronRight size={16} className="inline text-[#8a94a8]" /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="px-4 sm:px-5 py-3 border-t border-[#eef1f6] dark:border-slate-800 text-[13px] text-[#6B7894]">{list.length} of {workspaces.length} workspaces</p>
    </section>
  )
}

// ── Setup ────────────────────────────────────────────────────────────────────

export interface SetupStatus {
  razorpay: { mode: 'live' | 'test' | 'off'; webhook: boolean } | null
  push: { app: boolean; server: boolean } | null
}

function Check({ ok, title, detail }: { ok: boolean | null; title: string; detail: string }) {
  return (
    <li className="flex items-start gap-3 py-3">
      {ok === null ? <Loader2 size={18} className="shrink-0 mt-0.5 animate-spin text-[#8a94a8]" /> : ok ? <CheckCircle2 size={18} className="shrink-0 mt-0.5 text-[#1D5BEA]" /> : <CircleAlert size={18} className="shrink-0 mt-0.5 text-[#b91c1c]" />}
      <span className="min-w-0">
        <span className="block text-[14.5px] font-semibold text-[#0E1B3D] dark:text-white">{title}</span>
        <span className={`block text-[13.5px] ${ok === false ? 'text-[#b91c1c]' : 'text-[#4a5672] dark:text-slate-400'}`}>{detail}</span>
      </span>
    </li>
  )
}

/** Is everything the product needs switched on? Payments, WAMA's WhatsApp number, pop-up notifications. */
export function ConsoleSetup({ api, status, billingReady, canSwitchOnBilling, switchingOn, resetting, onSwitchOnBilling, onResetBilling }: {
  api: (path: string, init?: RequestInit) => Promise<any>
  status: SetupStatus
  billingReady: boolean
  canSwitchOnBilling: boolean
  switchingOn: boolean
  resetting: boolean
  onSwitchOnBilling: () => void
  onResetBilling: () => void
}) {
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)
  const { razorpay, push } = status

  async function testPush() {
    setTesting(true); setTestResult(null)
    try {
      const result = await api('/api/superadmin/push-test', { method: 'POST', body: '{}' })
      setTestResult({ ok: Number(result.sent) > 0, text: result.message })
    } catch (error: any) {
      setTestResult({ ok: false, text: error.message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-5">
      <section className={`${card} p-4 sm:p-5`}>
        <h2 className="text-[16px] font-bold text-[#0E1B3D] dark:text-white flex items-center gap-2"><CreditCard size={17} className="text-[#1D5BEA]" /> Payments</h2>
        <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800 mt-1">
          <Check ok={billingReady} title="Billing" detail={billingReady ? 'Switched on: plans, free trials and wallets are running.' : 'Not switched on yet. Clients do not see Billing.'} />
          <Check ok={razorpay ? razorpay.mode === 'live' : null} title="Razorpay keys" detail={!razorpay ? 'Checking…' : razorpay.mode === 'live' ? 'Live keys: real payments.' : razorpay.mode === 'test' ? 'Test keys: no real money is taken. Put the live keys in Vercel.' : 'Not set in Vercel, so nobody can pay.'} />
          <Check ok={razorpay ? razorpay.webhook : null} title="Razorpay webhook secret" detail={!razorpay ? 'Checking…' : razorpay.webhook ? 'Set: renewals and failed payments are picked up.' : 'Not set in Vercel, so renewals and failed payments are missed.'} />
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          {!billingReady && canSwitchOnBilling && (
            <button type="button" onClick={onSwitchOnBilling} disabled={switchingOn} className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-[#1D5BEA] hover:bg-[#174bc4] text-white text-[14px] font-bold cursor-pointer disabled:opacity-50">
              {switchingOn ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} />} Switch on billing
            </button>
          )}
          {billingReady && (
            <button type="button" onClick={onResetBilling} disabled={resetting} className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-[#f3c7c7] text-[#b91c1c] text-[14px] font-semibold hover:bg-[#fdf0f0] dark:border-red-900 dark:hover:bg-red-950/30 cursor-pointer disabled:opacity-50">
              {resetting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Clear billing test data
            </button>
          )}
        </div>
      </section>

      <SharedNumberPanel api={api} />

      <section className={`${card} p-4 sm:p-5`}>
        <h2 className="text-[16px] font-bold text-[#0E1B3D] dark:text-white flex items-center gap-2"><BellRing size={17} className="text-[#1D5BEA]" /> Pop-up notifications on phones</h2>
        <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800 mt-1">
          <Check ok={push ? push.app : null} title="App settings" detail={!push ? 'Checking…' : push.app ? 'Set: the app can register phones.' : 'Missing in Vercel: FIREBASE_PROJECT_ID, FIREBASE_ANDROID_APP_ID, FIREBASE_API_KEY, FIREBASE_SENDER_ID.'} />
          <Check ok={push ? push.server : null} title="Sending key" detail={!push ? 'Checking…' : push.server ? 'Set: the server can send notifications.' : 'FIREBASE_SERVICE_ACCOUNT is missing in Vercel, or is not the whole JSON file.'} />
        </ul>
        <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <button type="button" onClick={testPush} disabled={testing} className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl border border-[#d5ddeb] dark:border-slate-700 text-[#0E1B3D] dark:text-white text-[14px] font-semibold hover:border-[#1D5BEA] hover:text-[#1D5BEA] cursor-pointer disabled:opacity-50 shrink-0">
            {testing ? <Loader2 size={16} className="animate-spin" /> : <BellRing size={16} />} Send a test to my phone
          </button>
          {testResult && <p role="status" className={`text-[13.5px] ${testResult.ok ? 'text-[#0E1B3D] dark:text-white' : 'text-[#b91c1c]'}`}>{testResult.text}</p>}
        </div>
        <p className="mt-2 text-[12.5px] text-[#8a94a8]">Sign in to the phone app with this account first. The test goes only to your own phones.</p>
      </section>
    </div>
  )
}
