'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, ArrowUpRight, Building2, CalendarPlus, Check, ChevronRight, CreditCard, IndianRupee, Loader2, Mail, Plus,
  RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Trash2, Users, X,
} from 'lucide-react'
import { PLANS } from '@/lib/plans'
import { ConsoleOverview, ConsoleSetup, WorkspaceList, type WorkspaceFilter } from '@/components/superadmin/console-parts'
import { authSessionManager } from '@/lib/auth-context'
import { useConfirm } from '@/lib/dialog-context'
import { getRoleDisplay, toStoredRole } from '@/lib/rbac'
import { PlatformEmailSettings } from '@/components/superadmin/platform-email-settings'

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkspaceBilling {
  configured: boolean
  exempt: boolean
  status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired'
  hasAccess: boolean
  trialDaysLeft: number | null
  accessUntil: string | null
  cancelAtPeriodEnd: boolean
  aiPercentLeft: number | null
  aiPaused: boolean
  aiBalance: number | null
  hasSubscription: boolean
  onTrial: boolean
  plan: string
  planName: string
  price: number
  pendingPlan: string | null
  whatsappMode: 'own' | 'shared'
  messageBalance: number
  overrides: Record<string, unknown>
}

interface Workspace {
  id: string
  name: string
  slug: string
  created_at: string
  contact_email: string | null
  whatsapp: 'meta' | 'twilio' | null
  members: number
  max_teammates: number | null
  enable_ai: boolean
  billing: WorkspaceBilling
}

interface Totals {
  workspaces: number
  paying: number
  trialing: number
  expired: number
  exempt: number
  pastDue: number
  aiPaused: number
  monthlyRevenue: number
  people: number
}

interface WorkspaceDetails {
  workspace: Workspace
  organization: Record<string, any>
  billingRow: { trial_ends_at: string; current_period_end: string | null; razorpay_subscription_id: string | null; ai_allowance: number } | null
  members: { id: string; email: string; full_name: string | null; role: string; created_at: string }[]
  aiActivity: { kind: string; amount: number; feature: string | null; created_at: string }[]
  aiUsageThisMonth: Record<string, number>
  payments: { purpose: string; amount_paise: number; razorpay_payment_id: string; created_at: string }[]
}

interface Person {
  id: string
  email: string
  full_name: string | null
  role: string
  organization_id: string | null
  created_at: string
  organization?: { name: string; slug: string } | null
}

type Tab = 'overview' | 'workspaces' | 'people' | 'setup' | 'email'
type Filter = WorkspaceFilter

// ── Helpers ───────────────────────────────────────────────────────────────────

const card = 'bg-white dark:bg-[#111b21] rounded-2xl border border-[#e3e8f2] dark:border-slate-800'
const field = 'h-10 px-3 rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] text-[14px] text-[#0E1B3D] dark:text-white placeholder:text-[#8a94a8] focus:outline-none focus:border-[#1D5BEA] focus:ring-2 focus:ring-[#1D5BEA]/15'
const input = `w-full ${field}`
const primary = 'inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-[#1D5BEA] hover:bg-[#174bc4] text-white text-[14px] font-bold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
const secondary = 'inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl border border-[#d5ddeb] dark:border-slate-700 text-[#0E1B3D] dark:text-slate-100 text-[14px] font-semibold hover:bg-[#f4f6fa] dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50'
const rupees = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const formatDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

async function api(path: string, init: RequestInit = {}) {
  const token = authSessionManager.getSession()?.access_token
  const headers = new Headers(init.headers || {})
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body) headers.set('Content-Type', 'application/json')
  const res = await fetch(path, { ...init, headers, cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

function planLabel(billing: WorkspaceBilling): [string, string] {
  if (!billing.configured) return ['No billing yet', 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300']
  if (billing.exempt) return ['Exempt', 'bg-[#e8ecf5] text-[#0E1B3D] dark:bg-slate-800 dark:text-slate-200']
  if (billing.status === 'active') return [billing.cancelAtPeriodEnd ? `Paid till ${formatDate(billing.accessUntil)}` : 'Paying', 'bg-[#eef1f6] text-[#0E1B3D] dark:bg-slate-800 dark:text-slate-200']
  if (billing.status === 'trialing') return [`Trial · ${billing.trialDaysLeft}d left`, 'bg-[#eef3fe] text-[#1D5BEA] dark:bg-blue-950/40 dark:text-blue-300']
  if (billing.status === 'past_due') return ['Payment failed', 'bg-[#fdf0f0] text-[#b91c1c] dark:bg-red-950/40 dark:text-red-300']
  if (billing.status === 'cancelled') return [`Cancelled · till ${formatDate(billing.accessUntil)}`, 'bg-[#eef1f6] text-[#0E1B3D] dark:bg-slate-800 dark:text-slate-200']
  return [billing.onTrial ? 'Trial ended' : 'Plan ended', 'bg-[#fdf0f0] text-[#b91c1c] dark:bg-red-950/40 dark:text-red-300']
}

function PlanPill({ billing }: { billing: WorkspaceBilling }) {
  const [label, tone] = planLabel(billing)
  return <span className={`inline-flex items-center px-2.5 h-7 rounded-lg text-[12.5px] font-bold whitespace-nowrap ${tone}`}>{label}</span>
}

function CreditBar({ billing }: { billing: WorkspaceBilling }) {
  if (billing.exempt || billing.aiPercentLeft === null) return <span className="text-[13px] text-[#6B7894]">Own key</span>
  const percent = billing.aiPercentLeft
  const color = billing.aiPaused || percent <= 20 ? '#b91c1c' : '#1D5BEA'
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="h-2 w-16 rounded-full bg-[#eef1f6] dark:bg-slate-800 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${percent}%`, background: color }} /></div>
      <span className="text-[13px] font-semibold text-[#0E1B3D] dark:text-slate-200">{percent}%</span>
    </div>
  )
}

const FEATURE_NAMES: Record<string, string> = {
  chatbot: 'WhatsApp AI replies', shopping_assistant: 'Shopping assistant', copilot: 'Reply suggestions', playground: 'AI playground',
  assistant: 'CRM assistant', assistant_draft: 'CRM assistant', lead_summary: 'Lead summaries', lead_scoring: 'Lead scoring',
  auto_tagging: 'Auto tagging', knowledge: 'Knowledge base', rephrase: 'Rephrase', email_template: 'Email templates', flow_builder: 'Flow builder',
}

const ROLE_OPTIONS = [
  { value: 'owner', label: 'Owner' },
  { value: 'org_admin', label: 'Admin' },
  { value: 'org_manager', label: 'Manager' },
  { value: 'sales_employee', label: 'Agent' },
  { value: 'viewer', label: 'Viewer' },
  { value: 'superadmin', label: 'Super Admin' },
]
const roleValue = (role: string) => {
  const stored = toStoredRole(role)
  return ROLE_OPTIONS.some((option) => option.value === stored) ? stored : 'sales_employee'
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SuperAdminConsole() {
  const confirm = useConfirm()
  const [tab, setTab] = useState<Tab>('overview')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [billingReady, setBillingReady] = useState(true)
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [peopleSearch, setPeopleSearch] = useState('')
  const [peopleWorkspace, setPeopleWorkspace] = useState('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [details, setDetails] = useState<WorkspaceDetails | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [creditAmount, setCreditAmount] = useState('')
  const [paidUntil, setPaidUntil] = useState('')
  const [seatLimit, setSeatLimit] = useState('')
  const [planChoice, setPlanChoice] = useState('growth')
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [messageAmount, setMessageAmount] = useState('')
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false)
  const [newPersonOpen, setNewPersonOpen] = useState(false)
  // Whether this console can switch billing on itself (the server has a database connection)
  const [canSwitchOnBilling, setCanSwitchOnBilling] = useState(false)
  const [razorpaySetup, setRazorpaySetup] = useState<{ mode: 'live' | 'test' | 'off'; webhook: boolean } | null>(null)
  const [pushSetup, setPushSetup] = useState<{ app: boolean; server: boolean } | null>(null)
  const [resetting, setResetting] = useState(false)
  const [switchingOn, setSwitchingOn] = useState(false)

  const flash = (tone: 'success' | 'error', text: string) => {
    setToast({ tone, text })
    window.setTimeout(() => setToast((current) => (current?.text === text ? null : current)), 5000)
  }

  const loadWorkspaces = useCallback(async () => {
    const data = await api('/api/superadmin/workspaces')
    setWorkspaces(data.workspaces || [])
    setTotals(data.totals || null)
    setBillingReady(data.billingReady !== false)
    api('/api/superadmin/billing-setup')
      .then((setup) => { setCanSwitchOnBilling(Boolean(setup.canSwitchOn)); setRazorpaySetup(setup.razorpay || null); setPushSetup(setup.push || null) })
      .catch(() => setCanSwitchOnBilling(false))
  }, [])

  async function resetBillingData() {
    const ok = await confirm({
      title: 'Clear all billing test data?',
      message: 'Every workspace goes back to a fresh start: a 14-day free trial from today and ₹300 of AI credit. Test subscriptions, test payments and the AI credit history are removed. Exempt workspaces stay exempt. Any workspace with a real (live) Razorpay subscription is left exactly as it is.',
      confirmLabel: 'Clear billing data',
      destructive: true,
    })
    if (!ok) return
    setResetting(true)
    try {
      const result = await api('/api/superadmin/billing-setup', { method: 'POST', body: JSON.stringify({ action: 'reset' }) })
      flash('success', `Billing data cleared: ${result.reset} workspaces start fresh${result.kept ? `, ${result.kept} with live subscriptions kept` : ''}.`)
      await reload()
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setResetting(false)
    }
  }

  async function switchOnBilling() {
    const ok = await confirm({
      title: 'Switch on billing for every client?',
      message: 'Every client workspace starts a 14-day free trial with ₹300 of AI credit, and AI is charged to that credit. Workspaces that have not subscribed lock after 14 days (you can extend any of them here). Consular Helpdesk, Magnetora and your own workspace stay exempt. Add your live Razorpay keys in Vercel so clients can pay.',
      confirmLabel: 'Switch on billing',
    })
    if (!ok) return
    setSwitchingOn(true)
    try {
      const result = await api('/api/superadmin/billing-setup', { method: 'POST', body: '{}' })
      flash('success', `Billing is on: ${result.workspaces} workspaces, ${result.exempt?.length || 0} exempt${result.exempt?.length ? ` (${result.exempt.join(', ')})` : ''}.`)
      await reload()
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setSwitchingOn(false)
    }
  }
  const loadPeople = useCallback(async () => {
    const data = await api('/api/superadmin/users')
    setPeople(data.users || [])
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      await Promise.all([loadWorkspaces(), loadPeople()])
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setLoading(false)
    }
  }, [loadWorkspaces, loadPeople])

  useEffect(() => { reload() }, [reload])

  async function openWorkspace(id: string) {
    setOpenId(id)
    setDetails(null)
    setDetailsLoading(true)
    setCreditAmount('')
    setPaidUntil('')
    try {
      const data: WorkspaceDetails = await api(`/api/superadmin/workspaces/${id}`)
      setDetails(data)
      setSeatLimit(data.workspace.max_teammates ? String(data.workspace.max_teammates) : '')
      setPlanChoice(data.workspace.billing.plan || 'growth')
      const saved = data.workspace.billing.overrides || {}
      setOverrides(Object.fromEntries(['connectors', 'team', 'aiMonthly', 'videos'].map((key) => [key, saved[key] === undefined || saved[key] === null ? '' : String(saved[key])])))
    } catch (err: any) {
      flash('error', err.message)
      setOpenId(null)
    } finally {
      setDetailsLoading(false)
    }
  }

  async function act(body: Record<string, unknown>, success: string) {
    if (!openId) return
    setBusy(String(body.action))
    try {
      const data: WorkspaceDetails = await api(`/api/superadmin/workspaces/${openId}`, { method: 'POST', body: JSON.stringify(body) })
      setDetails(data)
      setWorkspaces((current) => current.map((w) => (w.id === openId ? data.workspace : w)))
      flash('success', success)
      loadWorkspaces().catch(() => {})
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusy(null)
    }
  }

  async function deleteWorkspace(workspace: Workspace) {
    if (!(await confirm({ title: `Delete ${workspace.name}?`, message: `This permanently deletes the workspace, its ${workspace.members} login${workspace.members === 1 ? '' : 's'}, chats, contacts and orders. It cannot be undone.`, confirmLabel: 'Delete for good', destructive: true }))) return
    setBusy('delete')
    try {
      await api(`/api/superadmin/organizations/${workspace.id}`, { method: 'DELETE' })
      setOpenId(null)
      flash('success', `${workspace.name} was deleted.`)
      await reload()
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusy(null)
    }
  }

  async function changePersonRole(person: Person, role: string) {
    const label = ROLE_OPTIONS.find((option) => option.value === role)?.label || role
    if (!(await confirm({ title: `Make ${person.full_name || person.email} ${label === 'Admin' || label === 'Owner' ? 'an' : 'a'} ${label}?`, message: role === 'superadmin' ? 'Super admins can open this console and change every workspace.' : getRoleDisplay(role).description, confirmLabel: 'Change role' }))) return
    try {
      const data = await api(`/api/superadmin/users/${person.id}`, { method: 'PUT', body: JSON.stringify({ role }) })
      setPeople((current) => current.map((p) => (p.id === person.id ? { ...p, ...(data.user || { role }) } : p)))
      flash('success', `${person.full_name || person.email} is now ${label}.`)
    } catch (err: any) {
      flash('error', err.message)
    }
  }

  async function deletePerson(person: Person) {
    if (!(await confirm({ title: `Delete ${person.full_name || person.email}?`, message: 'Their login is removed and they can no longer sign in.', confirmLabel: 'Delete', destructive: true }))) return
    try {
      await api(`/api/superadmin/users/${person.id}`, { method: 'DELETE' })
      setPeople((current) => current.filter((p) => p.id !== person.id))
      flash('success', `${person.email} was deleted.`)
      loadWorkspaces().catch(() => {})
    } catch (err: any) {
      flash('error', err.message)
    }
  }

  // ── Derived lists ──
  const filteredPeople = useMemo(() => {
    const q = peopleSearch.trim().toLowerCase()
    return people.filter((p) => (peopleWorkspace === 'all' || p.organization_id === peopleWorkspace) && (!q || `${p.full_name || ''} ${p.email}`.toLowerCase().includes(q)))
  }, [people, peopleSearch, peopleWorkspace])

  const open = openId ? workspaces.find((w) => w.id === openId) : null

  // ── Render ──
  return (
    <div className="flex-1 overflow-y-auto bg-[#f6f8fc] dark:bg-[#0b141a]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#1D5BEA]"><ShieldCheck size={15} /> WAMA CRM staff</div>
            <h1 className="text-[26px] sm:text-[30px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white">Super Admin</h1>
            <p className="text-[15px] text-[#4a5672] dark:text-slate-400 mt-1">Every workspace, its plan, AI credit and team, in one place.</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={reload} className={`${secondary} w-10 px-0`} aria-label="Reload"><RefreshCw size={18} className={`shrink-0 ${loading ? 'animate-spin' : ''}`} /></button>
            <button type="button" onClick={() => setNewPersonOpen(true)} className={secondary}><Users size={16} /> Add person</button>
            <button type="button" onClick={() => setNewWorkspaceOpen(true)} className={primary}><Plus size={16} /> New workspace</button>
          </div>
        </div>

        {toast && (
          <div role="status" className={`flex items-start gap-2.5 rounded-xl px-4 py-3 text-[14px] font-medium ${toast.tone === 'success' ? 'bg-[#e8f7f1] text-[#047857]' : 'bg-[#fdf0f0] text-[#b91c1c]'}`}>
            {toast.tone === 'success' ? <Check size={18} className="mt-0.5 shrink-0" /> : <AlertTriangle size={18} className="mt-0.5 shrink-0" />}
            <span>{toast.text}</span>
          </div>
        )}

        {!billingReady && (
          <div className="rounded-xl bg-[#fff7e8] dark:bg-amber-950/30 text-[#92400e] dark:text-amber-200 px-4 py-3.5 text-[14px] flex flex-col sm:flex-row sm:items-center gap-3">
            <span className="flex-1">
              <strong>Billing is not switched on yet.</strong> Clients do not see Billing, and every workspace works as before.
              {!canSwitchOnBilling && <> Run <code className="font-mono text-[13px]">supabase/migrations/20261105_billing_and_ai_wallet.sql</code> in the Supabase SQL editor to switch it on.</>}
            </span>
            {canSwitchOnBilling && (
              <button type="button" onClick={switchOnBilling} disabled={switchingOn} className={`${primary} shrink-0`}>
                {switchingOn ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} />} Switch on billing
              </button>
            )}
          </div>
        )}

        <div className="flex gap-1 overflow-x-auto border-b border-[#e3e8f2] dark:border-slate-800">
          {([['overview', 'Overview'], ['workspaces', `Workspaces (${workspaces.length})`], ['people', `People (${people.length})`], ['setup', 'Setup'], ['email', 'Platform email']] as [Tab, string][]).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={`px-4 h-11 text-[14.5px] font-semibold whitespace-nowrap border-b-2 -mb-px cursor-pointer ${tab === id ? 'border-[#1D5BEA] text-[#1D5BEA]' : 'border-transparent text-[#6B7894] hover:text-[#0E1B3D] dark:hover:text-white'}`}>{label}</button>
          ))}
          <Link href="/dashboard/superadmin/advanced" className="ml-auto px-3 h-11 inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#6B7894] hover:text-[#0E1B3D] dark:hover:text-white whitespace-nowrap"><Settings2 size={15} /> Advanced</Link>
        </div>

        {loading && workspaces.length === 0 ? (
          <div className="flex justify-center py-20"><Loader2 className="animate-spin text-[#1D5BEA]" size={28} /></div>
        ) : tab === 'overview' ? (
          <ConsoleOverview workspaces={workspaces} totals={totals} billingReady={billingReady} onOpen={openWorkspace} onShow={(next) => { setFilter(next); setTab('workspaces') }} />
        ) : tab === 'workspaces' ? (
          <WorkspaceList workspaces={workspaces} filter={filter} onFilter={setFilter} onOpen={openWorkspace} />
        ) : tab === 'setup' ? (
          <ConsoleSetup api={api} status={{ razorpay: razorpaySetup, push: pushSetup }} billingReady={billingReady} canSwitchOnBilling={canSwitchOnBilling}
            switchingOn={switchingOn} resetting={resetting} onSwitchOnBilling={switchOnBilling} onResetBilling={resetBillingData} />
        ) : tab === 'people' ? (
          <div className={card}>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 sm:px-5 py-4 border-b border-[#eef1f6] dark:border-slate-800">
              <label className="relative sm:w-72">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a94a8]" />
                <input value={peopleSearch} onChange={(e) => setPeopleSearch(e.target.value)} placeholder="Search by name or email" className={`${input} pl-9`} aria-label="Search people" />
              </label>
              <select value={peopleWorkspace} onChange={(e) => setPeopleWorkspace(e.target.value)} className={`${field} w-full sm:w-64`} aria-label="Workspace">
                <option value="all">All workspaces</option>
                {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <span className="sm:ml-auto text-[13px] text-[#6B7894]">{filteredPeople.length} {filteredPeople.length === 1 ? 'person' : 'people'}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-[14px]">
                <thead>
                  <tr className="text-left text-[13px] text-[#6B7894]">
                    <th className="px-5 py-3 font-semibold">Person</th>
                    <th className="px-3 py-3 font-semibold">Workspace</th>
                    <th className="px-3 py-3 font-semibold">Role</th>
                    <th className="px-3 py-3 font-semibold">Joined</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filteredPeople.slice(0, 300).map((p) => (
                    <tr key={p.id} className="border-t border-[#eef1f6] dark:border-slate-800">
                      <td className="px-5 py-3"><div className="font-semibold text-[#0E1B3D] dark:text-white">{p.full_name || p.email.split('@')[0]}</div><div className="text-[13px] text-[#6B7894]">{p.email}</div></td>
                      <td className="px-3 py-3 text-[#4a5672] dark:text-slate-300">{p.organization?.name || workspaces.find((w) => w.id === p.organization_id)?.name || '—'}</td>
                      <td className="px-3 py-3">
                        <select value={roleValue(p.role)} onChange={(e) => changePersonRole(p, e.target.value)} className="h-9 pl-2.5 pr-7 rounded-lg border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] text-[13.5px] font-semibold text-[#0E1B3D] dark:text-white cursor-pointer" aria-label={`Role for ${p.email}`}>
                          {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-3 text-[#4a5672] dark:text-slate-300 whitespace-nowrap">{formatDate(p.created_at)}</td>
                      <td className="px-3 py-3 text-right">
                        <button type="button" onClick={() => deletePerson(p)} className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-[#b91c1c] hover:bg-[#fdf0f0] dark:hover:bg-red-950/30 cursor-pointer" aria-label={`Delete ${p.email}`}><Trash2 size={16} /></button>
                      </td>
                    </tr>
                  ))}
                  {filteredPeople.length === 0 && <tr><td colSpan={5} className="px-5 py-12 text-center text-[#6B7894]">Nobody matches.</td></tr>}
                </tbody>
              </table>
              {filteredPeople.length > 300 && <p className="px-5 py-3 text-[13px] text-[#6B7894]">Showing the first 300. Search or pick a workspace to narrow it down.</p>}
            </div>
          </div>
        ) : (
          <PlatformEmailSettings />
        )}
      </div>

      {/* Workspace panel */}
      {openId && (
        <div className="fixed inset-0 z-50 flex justify-end bg-[#0E1B3D]/30" onClick={() => setOpenId(null)}>
          <aside onClick={(e) => e.stopPropagation()} className="h-full w-full sm:max-w-xl bg-[#f6f8fc] dark:bg-[#0b141a] shadow-2xl overflow-y-auto">
            <div className="sticky top-0 z-10 bg-white dark:bg-[#111b21] border-b border-[#e3e8f2] dark:border-slate-800 px-5 py-4 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="text-[20px] font-extrabold text-[#0E1B3D] dark:text-white truncate">{details?.workspace.name || open?.name || 'Workspace'}</h2>
                <p className="text-[13px] text-[#6B7894] truncate">{details?.organization.contact_email || details?.workspace.slug || open?.slug} · joined {formatDate(details?.workspace.created_at || open?.created_at)}</p>
              </div>
              <button type="button" onClick={() => setOpenId(null)} aria-label="Close" className="h-9 w-9 rounded-lg flex items-center justify-center text-[#6B7894] hover:bg-[#f1f4f9] dark:hover:bg-slate-800 cursor-pointer"><X size={18} /></button>
            </div>

            {detailsLoading || !details ? (
              <div className="flex justify-center py-20"><Loader2 className="animate-spin text-[#1D5BEA]" size={26} /></div>
            ) : (
              <div className="p-5 space-y-4">
                {/* Plan */}
                <section className={`${card} p-4 space-y-3`}>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-[15px] font-bold text-[#0E1B3D] dark:text-white flex items-center gap-2"><CreditCard size={16} className="text-[#1D5BEA]" /> Plan</h3>
                    <PlanPill billing={details.workspace.billing} />
                  </div>
                  {!details.workspace.billing.configured ? (
                    <p className="text-[14px] text-[#6B7894]">Billing is not switched on in the database yet.</p>
                  ) : (
                    <>
                      <p className="text-[14px] text-[#4a5672] dark:text-slate-400">
                        {details.workspace.billing.exempt
                          ? 'Never billed. Uses its own AI key when it has one.'
                          : details.workspace.billing.status === 'trialing'
                            ? `Free trial until ${formatDate(details.billingRow?.trial_ends_at)}.`
                            : details.workspace.billing.accessUntil
                              ? `${details.workspace.billing.hasAccess ? 'Access until' : 'Access ended'} ${formatDate(details.workspace.billing.accessUntil)}.`
                              : 'Paid by Razorpay subscription.'}
                        {details.billingRow?.razorpay_subscription_id ? ` Razorpay: ${details.billingRow.razorpay_subscription_id}` : ''}
                      </p>
                      {!details.workspace.billing.exempt && (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[13.5px] font-semibold text-[#0E1B3D] dark:text-slate-200 mr-1">Extend trial</span>
                            {[7, 14, 30].map((days) => (
                              <button key={days} type="button" disabled={busy !== null} onClick={() => act({ action: 'extend_trial', days }, `Trial extended by ${days} days.`)} className={`${secondary} h-9 px-3`}><CalendarPlus size={15} /> {days} days</button>
                            ))}
                          </div>
                          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); act({ action: 'paid_until', date: paidUntil }, `Marked as paid until ${formatDate(paidUntil)}.`) }}>
                            <span className="text-[13.5px] font-semibold text-[#0E1B3D] dark:text-slate-200 mr-1">Paid outside Razorpay</span>
                            <input type="date" required value={paidUntil} onChange={(e) => setPaidUntil(e.target.value)} className={`${field} h-9`} aria-label="Paid until" />
                            <button type="submit" disabled={busy !== null || !paidUntil} className={`${primary} h-9 px-3`}>Mark paid</button>
                          </form>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button type="button" disabled={busy !== null} onClick={async () => {
                          const exempt = !details.workspace.billing.exempt
                          if (await confirm({ title: exempt ? 'Exempt this workspace from billing?' : 'Start billing this workspace?', message: exempt ? 'It keeps every feature with no plan, and uses its own AI key when it has one (otherwise WAMA CRM\'s, free).' : 'It needs a plan (or a trial) to keep access, and AI comes out of its AI credit.', confirmLabel: exempt ? 'Exempt' : 'Start billing' })) {
                            act({ action: 'set_exempt', exempt }, exempt ? 'Workspace is now exempt.' : 'Workspace is now billed.')
                          }
                        }} className={`${secondary} h-9 px-3`}><ShieldCheck size={15} /> {details.workspace.billing.exempt ? 'Start billing' : 'Make exempt'}</button>
                        {!details.workspace.billing.exempt && details.workspace.billing.hasAccess && (
                          <button type="button" disabled={busy !== null} onClick={async () => {
                            if (await confirm({ title: 'End access now?', message: 'The workspace is locked until it subscribes. Nothing is deleted.', confirmLabel: 'End access', destructive: true })) act({ action: 'end_access' }, 'Access ended.')
                          }} className="inline-flex items-center gap-2 h-9 px-3 rounded-xl border border-[#f3c7c7] text-[#b91c1c] text-[14px] font-semibold hover:bg-[#fdf0f0] dark:border-red-900 dark:hover:bg-red-950/30 cursor-pointer disabled:opacity-50">End access</button>
                        )}
                      </div>
                    </>
                  )}
                </section>

                {/* Plan, limits and the message wallet */}
                {details.workspace.billing.configured && !details.workspace.billing.exempt && (
                  <section className={`${card} p-4 space-y-3`}>
                    <h3 className="text-[15px] font-bold text-[#0E1B3D] dark:text-white flex items-center gap-2"><CreditCard size={16} className="text-[#1D5BEA]" /> Plan</h3>
                    <p className="text-[14px] text-[#4a5672] dark:text-slate-400">
                      {details.workspace.billing.planName} · {rupees(details.workspace.billing.price)} a month · {details.workspace.billing.whatsappMode === 'shared' ? 'WAMA\'s number' : 'own WhatsApp number'}
                      {details.workspace.billing.pendingPlan ? ` · changing to ${PLANS.find((plan) => plan.id === details.workspace.billing.pendingPlan)?.name || details.workspace.billing.pendingPlan} on the bill date` : ''}
                    </p>
                    <form className="flex flex-wrap items-center gap-2" onSubmit={async (e) => {
                      e.preventDefault()
                      if (await confirm({ title: 'Change the plan by hand?', message: 'The plan changes now. Razorpay auto-pay is not changed, so use this for offline arrangements.', confirmLabel: 'Change plan' })) act({ action: 'set_plan', plan: planChoice }, 'Plan changed.')
                    }}>
                      <select value={planChoice} onChange={(e) => setPlanChoice(e.target.value)} className={`${field} h-9`} aria-label="Plan">
                        {PLANS.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · ₹{(plan.amountPaise / 100).toLocaleString('en-IN')}</option>)}
                      </select>
                      <button type="submit" disabled={busy !== null || planChoice === details.workspace.billing.plan} className={`${secondary} h-9 px-3`}>Set plan</button>
                      <button type="button" disabled={busy !== null} onClick={() => act({ action: 'set_whatsapp_mode', mode: details.workspace.billing.whatsappMode === 'shared' ? 'own' : 'shared' }, 'WhatsApp setting changed.')} className={`${secondary} h-9 px-3`}>
                        {details.workspace.billing.whatsappMode === 'shared' ? 'Use own number' : 'Use WAMA\'s number'}
                      </button>
                    </form>
                    <form className="space-y-2" onSubmit={(e) => {
                      e.preventDefault()
                      const body: Record<string, number | null> = {}
                      for (const [key, value] of Object.entries(overrides)) if (value.trim() !== '') body[key] = Number(value)
                      act({ action: 'set_overrides', overrides: body }, 'Limits saved.')
                    }}>
                      <div className="text-[12.5px] font-semibold text-[#6B7894]">Limits for this workspace (empty = the plan&apos;s own)</div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[['connectors', 'Connectors (max 3)'], ['team', 'Team members'], ['aiMonthly', 'AI credit ₹/month'], ['videos', 'Videos/month']].map(([key, label]) => (
                          <label key={key} className="block min-w-0">
                            <span className="block text-[12px] text-[#6B7894] mb-0.5 truncate">{label}</span>
                            <input type="number" min={0} value={overrides[key] || ''} onChange={(e) => setOverrides((current) => ({ ...current, [key]: e.target.value }))} placeholder="Plan" className={`${field} h-9 w-full`} />
                          </label>
                        ))}
                      </div>
                      <button type="submit" disabled={busy !== null} className={`${secondary} h-9 px-3`}>Save limits</button>
                    </form>
                    <form className="flex flex-wrap items-center gap-2 border-t border-[#eef1f6] dark:border-slate-800 pt-3" onSubmit={(e) => { e.preventDefault(); act({ action: 'add_message_credit', amount: Number(messageAmount) }, `${rupees(Number(messageAmount))} added to the message wallet.`); setMessageAmount('') }}>
                      <span className="text-[13.5px] font-semibold text-[#0E1B3D] dark:text-slate-200 mr-1">Message wallet {rupees(details.workspace.billing.messageBalance || 0)}</span>
                      <span className="relative">
                        <IndianRupee size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a94a8]" />
                        <input type="number" min={1} max={100000} required value={messageAmount} onChange={(e) => setMessageAmount(e.target.value)} placeholder="200" className={`${field} w-28 h-9 pl-8`} aria-label="Amount for the message wallet" />
                      </span>
                      <button type="submit" disabled={busy !== null || !messageAmount} className={`${primary} h-9 px-3`}><Plus size={15} /> Add free</button>
                    </form>
                  </section>
                )}

                {/* AI credit */}
                {details.workspace.billing.configured && !details.workspace.billing.exempt && (
                  <section className={`${card} p-4 space-y-3`}>
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-[15px] font-bold text-[#0E1B3D] dark:text-white flex items-center gap-2"><Sparkles size={16} className="text-[#00A884]" /> AI credit</h3>
                      <CreditBar billing={details.workspace.billing} />
                    </div>
                    <p className="text-[14px] text-[#4a5672] dark:text-slate-400">
                      {rupees(details.workspace.billing.aiBalance || 0)} left of {rupees(details.billingRow?.ai_allowance || 0)}. The customer only sees the percentage.
                    </p>
                    {Object.keys(details.aiUsageThisMonth).length > 0 && (
                      <div className="rounded-xl bg-[#f6f8fc] dark:bg-slate-900 px-3 py-2.5">
                        <div className="text-[12.5px] font-semibold text-[#6B7894] mb-1">Used this month</div>
                        {Object.entries(details.aiUsageThisMonth).sort((a, b) => b[1] - a[1]).map(([feature, amount]) => (
                          <div key={feature} className="flex justify-between text-[13.5px] py-0.5"><span className="text-[#0E1B3D] dark:text-slate-200">{FEATURE_NAMES[feature] || feature}</span><span className="font-semibold text-[#0E1B3D] dark:text-white">{rupees(amount)}</span></div>
                        ))}
                      </div>
                    )}
                    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); act({ action: 'add_ai_credit', amount: Number(creditAmount) }, `${rupees(Number(creditAmount))} of AI credit added.`); setCreditAmount('') }}>
                      <span className="relative">
                        <IndianRupee size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a94a8]" />
                        <input type="number" min={1} max={100000} required value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} placeholder="500" className={`${field} w-32 h-9 pl-8`} aria-label="Amount of AI credit" />
                      </span>
                      <button type="submit" disabled={busy !== null || !creditAmount} className={`${primary} h-9 px-3`}><Plus size={15} /> Add credit free</button>
                    </form>
                  </section>
                )}

                {/* Team */}
                <section className={`${card} p-4 space-y-3`}>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-[15px] font-bold text-[#0E1B3D] dark:text-white flex items-center gap-2"><Users size={16} className="text-[#1D5BEA]" /> Team ({details.members.length})</h3>
                    <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); act({ action: 'set_seat_limit', limit: seatLimit === '' ? null : Number(seatLimit) }, seatLimit ? `Seat limit set to ${seatLimit}.` : 'No seat limit.') }}>
                      <input type="number" min={1} max={1000} value={seatLimit} onChange={(e) => setSeatLimit(e.target.value)} placeholder="No limit" className={`${field} w-24 h-8 text-[13px]`} aria-label="Seat limit" />
                      <button type="submit" disabled={busy !== null} className={`${secondary} h-8 px-2.5 text-[13px] whitespace-nowrap`}>Set limit</button>
                    </form>
                  </div>
                  <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800">
                    {details.members.map((member) => {
                      const display = getRoleDisplay(member.role)
                      return (
                        <li key={member.id} className="flex items-center gap-3 py-2">
                          <span className="flex-1 min-w-0"><span className="block text-[14px] font-semibold text-[#0E1B3D] dark:text-white truncate">{member.full_name || member.email.split('@')[0]}</span><span className="block text-[12.5px] text-[#6B7894] truncate">{member.email}</span></span>
                          <span className={`px-2 h-6 inline-flex items-center rounded-md border text-[12px] font-bold ${display.bg} ${display.color} ${display.border}`}>{display.label}</span>
                        </li>
                      )
                    })}
                    {details.members.length === 0 && <li className="py-3 text-[14px] text-[#6B7894]">No one has an account here yet.</li>}
                  </ul>
                </section>

                {/* Payments */}
                {details.payments.length > 0 && (
                  <section className={`${card} p-4 space-y-2`}>
                    <h3 className="text-[15px] font-bold text-[#0E1B3D] dark:text-white flex items-center gap-2"><IndianRupee size={16} className="text-[#047857]" /> Payments</h3>
                    {details.payments.map((payment) => (
                      <div key={payment.razorpay_payment_id} className="flex justify-between text-[13.5px] py-1">
                        <span className="text-[#4a5672] dark:text-slate-300">{payment.purpose === 'ai_topup' ? 'AI credit' : 'Plan'} · {formatDate(payment.created_at)}</span>
                        <span className="font-semibold text-[#0E1B3D] dark:text-white">{rupees(payment.amount_paise / 100)}</span>
                      </div>
                    ))}
                  </section>
                )}

                <div className="flex flex-col sm:flex-row gap-2">
                  <Link href={`/dashboard/superadmin/advanced?org=${details.workspace.id}`} className={`${secondary} flex-1`}><Settings2 size={15} /> Channels, keys and knowledge <ArrowUpRight size={14} /></Link>
                  {details.organization.contact_email && <a href={`mailto:${details.organization.contact_email}`} className={`${secondary} flex-1`}><Mail size={15} /> Email the owner</a>}
                </div>
                <button type="button" disabled={busy !== null} onClick={() => deleteWorkspace(details.workspace)} className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-xl text-[#b91c1c] text-[14px] font-semibold hover:bg-[#fdf0f0] dark:hover:bg-red-950/30 cursor-pointer disabled:opacity-50"><Trash2 size={15} /> Delete workspace</button>
              </div>
            )}
          </aside>
        </div>
      )}

      {newWorkspaceOpen && <NewWorkspaceDialog onClose={() => setNewWorkspaceOpen(false)} onCreated={(name) => { setNewWorkspaceOpen(false); flash('success', `${name} was created.`); reload() }} />}
      {newPersonOpen && <NewPersonDialog workspaces={workspaces} onClose={() => setNewPersonOpen(false)} onCreated={(email) => { setNewPersonOpen(false); flash('success', `${email} can now sign in.`); reload() }} />}
    </div>
  )
}

// ── Dialogs ───────────────────────────────────────────────────────────────────

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#0E1B3D]/40 sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-lg bg-white dark:bg-[#111b21] rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="text-[20px] font-extrabold text-[#0E1B3D] dark:text-white">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="h-9 w-9 rounded-lg flex items-center justify-center text-[#6B7894] hover:bg-[#f1f4f9] dark:hover:bg-slate-800 cursor-pointer"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-[14px] font-semibold text-[#0E1B3D] dark:text-white mb-1.5">{label}</span>{children}</label>
}

function NewWorkspaceDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string) => void }) {
  const [form, setForm] = useState({ name: '', slug: '', contactEmail: '', ownerName: '', ownerEmail: '', ownerPassword: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const created = await api('/api/superadmin/organizations', { method: 'POST', body: JSON.stringify({ name: form.name.trim(), slug: form.slug, contact_email: form.contactEmail.trim() || form.ownerEmail.trim() || null, contact_name: form.ownerName.trim() || null }) })
      if (form.ownerEmail.trim()) {
        try {
          await api('/api/superadmin/users', { method: 'POST', body: JSON.stringify({ email: form.ownerEmail.trim(), password: form.ownerPassword, fullName: form.ownerName.trim() || form.ownerEmail.split('@')[0], role: 'owner', organizationId: created.organization.id }) })
        } catch (err: any) {
          throw new Error(`The workspace was created, but the owner's login was not: ${err.message}`)
        }
      }
      onCreated(form.name.trim())
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog title="New workspace" onClose={onClose}>
      <form onSubmit={submit} className="px-5 py-4 space-y-4">
        {error && <div className="rounded-xl bg-[#fdf0f0] text-[#b91c1c] px-3.5 py-2.5 text-[14px]">{error}</div>}
        <Field label="Business name"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: slugify(e.target.value) })} placeholder="Radhakrishna Books" className={input} autoFocus /></Field>
        <Field label="Short name (used in webhook links)"><input required value={form.slug} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })} placeholder="radhakrishna-books" className={input} /></Field>
        <Field label="Contact email"><input type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} placeholder="owner@business.in" className={input} /></Field>
        <div className="rounded-xl border border-[#e3e8f2] dark:border-slate-700 p-3.5 space-y-3">
          <div className="text-[14px] font-semibold text-[#0E1B3D] dark:text-white">Owner login (optional)</div>
          <input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} placeholder="Owner's name" className={input} aria-label="Owner's name" />
          <input type="email" value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} placeholder="Owner's email" className={input} aria-label="Owner's email" />
          {form.ownerEmail && <input type="text" required minLength={8} value={form.ownerPassword} onChange={(e) => setForm({ ...form, ownerPassword: e.target.value })} placeholder="Temporary password (8+ characters)" className={input} aria-label="Temporary password" />}
        </div>
        <p className="text-[13px] text-[#6B7894]">New workspaces start a 14-day free trial with ₹300 of AI credit.</p>
        <div className="flex justify-end gap-2 pb-1">
          <button type="button" onClick={onClose} className={secondary}>Cancel</button>
          <button type="submit" disabled={saving} className={primary}>{saving && <Loader2 size={16} className="animate-spin" />} Create workspace</button>
        </div>
      </form>
    </Dialog>
  )
}

function NewPersonDialog({ workspaces, onClose, onCreated }: { workspaces: Workspace[]; onClose: () => void; onCreated: (email: string) => void }) {
  const [form, setForm] = useState({ fullName: '', email: '', password: '', role: 'org_admin', organizationId: workspaces[0]?.id || '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await api('/api/superadmin/users', { method: 'POST', body: JSON.stringify(form) })
      onCreated(form.email)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog title="Add a person" onClose={onClose}>
      <form onSubmit={submit} className="px-5 py-4 space-y-4">
        {error && <div className="rounded-xl bg-[#fdf0f0] text-[#b91c1c] px-3.5 py-2.5 text-[14px]">{error}</div>}
        <Field label="Workspace">
          <select required value={form.organizationId} onChange={(e) => setForm({ ...form, organizationId: e.target.value })} className={input}>
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
        <Field label="Full name"><input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className={input} /></Field>
        <Field label="Email"><input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={input} /></Field>
        <Field label="Temporary password"><input required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="8+ characters" className={input} /></Field>
        <Field label="Role">
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={input}>
            {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <div className="flex justify-end gap-2 pb-1">
          <button type="button" onClick={onClose} className={secondary}>Cancel</button>
          <button type="submit" disabled={saving} className={primary}>{saving && <Loader2 size={16} className="animate-spin" />} Add person</button>
        </div>
      </form>
    </Dialog>
  )
}
