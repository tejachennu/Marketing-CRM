'use client'

/**
 * Expenses: what the business spent (salaries, rent, stock…) next to what it sold, the last 6 months as bars, where
 * the money went, and the once-a-month AI review of sales. Admins only. Rules in lib/expenses/rules.ts.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, ChevronLeft, ChevronRight, Loader2, Plus, Repeat, Sparkles, Trash2, TrendingDown, TrendingUp, Wallet, ReceiptText, Target, ThumbsUp, Wrench, Lightbulb } from 'lucide-react'
import { api, card, Chip, dangerButton, Field, input, Modal, primaryButton, secondaryButton, StatTile, Toast, Toggle, useToast, useWorkspace } from '@/components/salon/ui'
import { formatMoney } from '@/lib/pipeline/rules'
import { can } from '@/lib/rbac'
import { EXPENSE_CATEGORIES, PAY_METHODS, addMonths, categoryLabel, istToday, methodLabel, monthName, shortMonth, type Insight, type MonthTotals } from '@/lib/expenses/rules'

interface Expense { id: string; spent_on: string; category: string; amount: number; note: string | null; paid_to: string | null; method: string | null; repeat_monthly: boolean; repeat_key: string | null }
interface Overview {
  month: string
  current: string
  months: MonthTotals[]
  categories: { key: string; label: string; amount: number; count: number; share: number }[]
  expenses: Expense[]
  repeatsDue: number
  insight: { month: string; kind: 'full' | 'so_far'; insight: Insight; created_at: string } | null
  insightKind: 'full' | 'so_far'
  canAskInsight: boolean
}

const money = (value: number) => formatMoney(value)
const shortMoney = (value: number) => formatMoney(value, 'INR', true)
const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })

export function ExpensesPage() {
  const { workspace, error } = useWorkspace()
  if (error) return <Shell><p className="text-[#b91c1c]">{error}</p></Shell>
  if (workspace && !can(workspace.me, 'settings.manage')) return <Shell><p className="text-[15px] text-[#4a5672]">Only the owner and admins can see expenses.</p></Shell>
  return <ExpensesBoard orgId={workspace?.orgId} />
}

/** The page itself, for a workspace (orgId undefined while it loads). */
export function ExpensesBoard({ orgId }: { orgId?: string }) {
  const { toast, flash } = useToast()
  const [month, setMonth] = useState(() => istToday().slice(0, 7))
  const [view, setView] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Expense | 'new' | null>(null)
  const [filter, setFilter] = useState('all')
  const [copying, setCopying] = useState(false)
  const [asking, setAsking] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError('')
    try {
      setView(await api(`/api/expenses?organizationId=${orgId}&month=${month}`))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [orgId, month])
  useEffect(() => { load() }, [load])
  useEffect(() => { setFilter('all') }, [month])

  const copyRepeats = async () => {
    if (!orgId) return
    setCopying(true)
    try {
      const { added } = await api('/api/expenses', { method: 'POST', body: JSON.stringify({ organizationId: orgId, action: 'copy_repeats', month }) })
      flash('success', added ? `Added ${added} monthly ${added === 1 ? 'expense' : 'expenses'}` : 'They are already added')
      await load()
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setCopying(false)
    }
  }

  const askInsight = async () => {
    if (!orgId) return
    setAsking(true)
    try {
      await api('/api/expenses/insight', { method: 'POST', body: JSON.stringify({ organizationId: orgId, month }) })
      await load()
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setAsking(false)
    }
  }

  const totals = view?.months[view.months.length - 1]
  const shown = (view?.expenses || []).filter((row) => filter === 'all' || row.category === filter)
  const present = EXPENSE_CATEGORIES.filter((c) => view?.expenses.some((row) => row.category === c.key))
  const atCurrent = view ? month >= view.current : true

  return (
    <Shell>
      <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-center @2xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-[24px] @xl:text-[28px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white">Expenses</h1>
          <p className="text-[14.5px] text-[#6B7894] dark:text-slate-400">Salaries, rent, stock and everything you spend, next to your sales.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#111b21]">
            <button type="button" onClick={() => setMonth(addMonths(month, -1))} aria-label="Month before" className="h-11 w-11 flex items-center justify-center text-[#4a5672] hover:bg-[#f4f6fa] dark:hover:bg-slate-800 rounded-l-xl cursor-pointer"><ChevronLeft size={18} /></button>
            <span className="px-2 min-w-[8.5rem] text-center text-[15px] font-bold text-[#0E1B3D] dark:text-white">{monthName(month)}</span>
            <button type="button" onClick={() => setMonth(addMonths(month, 1))} disabled={atCurrent} aria-label="Next month" className="h-11 w-11 flex items-center justify-center text-[#4a5672] hover:bg-[#f4f6fa] dark:hover:bg-slate-800 rounded-r-xl cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"><ChevronRight size={18} /></button>
          </div>
          <button type="button" className={`${primaryButton} flex-1 @md:flex-none`} onClick={() => setEditing('new')} disabled={!view}><Plus size={18} /> Add expense</button>
        </div>
      </div>

      {error && <div className={`${card} p-4 text-[15px] text-[#b91c1c] flex items-center justify-between gap-3`}><span>{error}</span><button type="button" className={secondaryButton} onClick={load}>Try again</button></div>}

      {!view && loading && <div className="grid grid-cols-2 @xl:grid-cols-4 gap-3">{[0, 1, 2, 3].map((i) => <div key={i} className={`${card} h-[92px] animate-pulse`} />)}</div>}

      {view && totals && (
        <>
          <div className={`grid grid-cols-2 @3xl:grid-cols-4 gap-3 transition-opacity ${loading ? 'opacity-60' : ''}`}>
            <StatTile label="Sales" value={money(totals.sales)} icon={<TrendingUp />} hint={`${totals.salesCount} ${totals.salesCount === 1 ? 'sale' : 'sales'}`} />
            <StatTile label="Expenses" value={money(totals.expenses)} icon={<Wallet />} hint={`${view.expenses.length} ${view.expenses.length === 1 ? 'entry' : 'entries'}`} />
            <StatTile label={totals.profit < 0 ? 'Loss' : 'Profit'} icon={totals.profit < 0 ? <TrendingDown /> : <Target />}
              value={<span className={totals.profit < 0 ? 'text-[#b91c1c]' : ''}>{money(Math.abs(totals.profit))}</span>}
              hint={totals.sales > 0 ? `${Math.round((totals.profit / totals.sales) * 100)}% of sales` : 'No sales yet'} />
            <StatTile label="Money received" value={money(totals.received)} icon={<ReceiptText />} hint={totals.sales > totals.received ? `${money(totals.sales - totals.received)} to collect` : 'All collected'} />
          </div>

          {view.repeatsDue > 0 && (
            <div className={`${card} p-4 flex flex-col @xl:flex-row @xl:items-center gap-3 justify-between`}>
              <div className="flex items-start gap-3 min-w-0">
                <span className="h-10 w-10 shrink-0 rounded-xl bg-[#eef3fe] dark:bg-blue-950/40 text-[#1D5BEA] flex items-center justify-center"><Repeat size={18} /></span>
                <p className="text-[15px] text-[#0E1B3D] dark:text-slate-100"><b>{view.repeatsDue} monthly {view.repeatsDue === 1 ? 'expense' : 'expenses'}</b> (like salaries or rent) {view.repeatsDue === 1 ? 'is' : 'are'} not added for {monthName(month, false)} yet.</p>
              </div>
              <button type="button" className={primaryButton} onClick={copyRepeats} disabled={copying}>{copying ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />} Add them</button>
            </div>
          )}

          <InsightCard view={view} asking={asking} onAsk={askInsight} />

          <div className="grid gap-4 @4xl:grid-cols-[1.4fr_1fr]">
            <MonthsChart months={view.months} picked={month} />
            <WhereItWent categories={view.categories} total={totals.expenses} />
          </div>

          <section className={`${card} p-4 @xl:p-5`}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-[17px] font-extrabold text-[#0E1B3D] dark:text-white">Expenses in {monthName(month, false)}</h2>
              <span className="text-[14px] font-bold text-[#4a5672] dark:text-slate-300">{money(shown.reduce((sum, row) => sum + row.amount, 0))}</span>
            </div>
            {present.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 mb-1 [&>button]:shrink-0 [&>button]:whitespace-nowrap">
                <Chip selected={filter === 'all'} onClick={() => setFilter('all')}>All</Chip>
                {present.map((c) => <Chip key={c.key} selected={filter === c.key} onClick={() => setFilter(c.key)}>{c.label}</Chip>)}
              </div>
            )}
            {view.expenses.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-[15px] text-[#4a5672] dark:text-slate-300">No expenses written down for {monthName(month, false)}.</p>
                <p className="text-[13.5px] text-[#8a94a8] mt-1">Add salaries, rent, stock, bills, ads — anything you pay for.</p>
                <button type="button" className={`${primaryButton} mt-4`} onClick={() => setEditing('new')}><Plus size={18} /> Add the first one</button>
              </div>
            ) : (
              <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800">
                {shown.map((row) => (
                  <li key={row.id}>
                    <button type="button" onClick={() => setEditing(row)} className="w-full flex items-center gap-3 py-3 text-left hover:bg-[#f4f6fa] dark:hover:bg-slate-800/50 rounded-xl px-2 -mx-2 cursor-pointer">
                      <span className="w-12 shrink-0 text-center">
                        <span className="block text-[18px] font-extrabold leading-none text-[#0E1B3D] dark:text-white">{Number(row.spent_on.slice(8, 10))}</span>
                        <span className="block text-[12px] font-semibold text-[#8a94a8] uppercase">{shortMonth(row.spent_on.slice(0, 7))}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-[15px] font-bold text-[#0E1B3D] dark:text-white min-w-0">
                          <span className="truncate">{categoryLabel(row.category)}</span>
                          {row.repeat_monthly && <Repeat size={13} className="text-[#6B7894] shrink-0" aria-label="Every month" />}
                        </span>
                        <span className="block text-[13.5px] text-[#6B7894] dark:text-slate-400 truncate">{[row.paid_to, row.note, methodLabel(row.method)].filter(Boolean).join(' · ') || 'Tap to add details'}</span>
                      </span>
                      <span className="shrink-0 text-[15.5px] font-extrabold text-[#0E1B3D] dark:text-white">{money(row.amount)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {editing && orgId && (
        <ExpenseForm orgId={orgId} month={month} expense={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(text) => { setEditing(null); flash('success', text); load() }} />
      )}
      <Toast toast={toast} />
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="@container min-h-full bg-[#f4f6fa] dark:bg-[#0b141a]"><div className="max-w-6xl mx-auto px-4 @xl:px-6 py-5 @xl:py-8 flex flex-col gap-4 pb-28 md:pb-10">{children}</div></div>
}

// ── The monthly AI review ───────────────────────────────────────────────────

function InsightCard({ view, asking, onAsk }: { view: Overview; asking: boolean; onAsk: () => void }) {
  const saved = view.insight
  const totals = view.months[view.months.length - 1]
  const empty = totals.salesCount === 0 && totals.expenses === 0
  const written = saved ? new Date(saved.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''
  return (
    <section className={`${card} p-4 @xl:p-5`}>
      <div className="flex flex-col @xl:flex-row @xl:items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="h-11 w-11 shrink-0 rounded-2xl bg-[#eef3fe] dark:bg-blue-950/40 text-[#1D5BEA] flex items-center justify-center"><Sparkles size={20} /></span>
          <div className="min-w-0">
            <h2 className="text-[17px] font-extrabold text-[#0E1B3D] dark:text-white">AI review of your sales</h2>
            <p className="text-[13.5px] text-[#6B7894] dark:text-slate-400">
              {saved
                ? saved.kind === 'full' ? `For all of ${monthName(saved.month)} · written ${written}` : `${monthName(saved.month)} so far · written ${written}`
                : 'How the month went, what to fix, and sales ideas for next month. Once a month.'}
            </p>
          </div>
        </div>
        {view.canAskInsight && (
          <button type="button" className={primaryButton} onClick={onAsk} disabled={asking || empty} title={empty ? 'Add sales or expenses first' : undefined}>
            {asking ? <><Loader2 size={18} className="animate-spin" /> Writing…</> : <><Sparkles size={18} /> {view.insightKind === 'so_far' ? 'Review this month so far' : 'Get the review'}</>}
          </button>
        )}
      </div>
      {!saved && view.canAskInsight && (
        <p className="mt-3 text-[13px] text-[#8a94a8]">{empty ? 'Add sales or expenses for this month first.' : view.insightKind === 'so_far' ? 'You get one review while the month is going on, and the full review after it ends. It uses a little AI credit.' : 'One review per month. It uses a little AI credit.'}</p>
      )}
      {saved && (
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-[15.5px] leading-relaxed text-[#0E1B3D] dark:text-slate-100">{saved.insight.summary}</p>
          <div className="grid gap-3 @3xl:grid-cols-3">
            <InsightList title="What went well" icon={<ThumbsUp size={16} />} items={saved.insight.good} />
            <InsightList title="What to fix" icon={<Wrench size={16} />} items={saved.insight.improve} />
            <InsightList title="Sales ideas" icon={<Lightbulb size={16} />} items={saved.insight.ideas} />
          </div>
          {saved.insight.focus && (
            <div className="rounded-xl bg-[#0E1B3D] text-white px-4 py-3 flex items-start gap-3">
              <Target size={18} className="shrink-0 mt-0.5" />
              <p className="text-[15px]"><b>Do this first: </b>{saved.insight.focus}</p>
            </div>
          )}
          {saved.kind === 'so_far' && view.month === view.current && <p className="text-[13px] text-[#8a94a8]">After {monthName(view.month, false)} ends you can get the full review.</p>}
        </div>
      )}
    </section>
  )
}

function InsightList({ title, icon, items }: { title: string; icon: React.ReactNode; items: string[] }) {
  if (!items.length) return null
  return (
    <div className="rounded-xl bg-[#f4f6fa] dark:bg-slate-800/60 p-3.5">
      <h3 className="flex items-center gap-2 text-[14px] font-extrabold text-[#0E1B3D] dark:text-white mb-2"><span className="text-[#1D5BEA]">{icon}</span>{title}</h3>
      <ul className="flex flex-col gap-1.5">
        {items.map((item, i) => <li key={i} className="text-[14.5px] leading-snug text-[#4a5672] dark:text-slate-300 pl-3 relative before:absolute before:left-0 before:top-[0.6em] before:h-1.5 before:w-1.5 before:rounded-full before:bg-[#8a94a8]">{item}</li>)}
      </ul>
    </div>
  )
}

// ── Charts ──────────────────────────────────────────────────────────────────

const SALES = 'bg-[#1D5BEA] dark:bg-[#4F83F5]'
const SPENT = 'bg-[#7486B3] dark:bg-[#97A3C4]'

function MonthsChart({ months, picked }: { months: MonthTotals[]; picked: string }) {
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(1, ...months.map((m) => Math.max(m.sales, m.expenses)))
  const top = niceTop(max)
  const lines = [top, top / 2, 0]
  const shownIndex = active ?? months.findIndex((m) => m.month === picked)
  const shown = months[shownIndex]
  return (
    <section className={`${card} p-4 @xl:p-5 min-w-0`}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-[17px] font-extrabold text-[#0E1B3D] dark:text-white">Sales and expenses, last 6 months</h2>
        <div className="flex items-center gap-3 text-[13px] font-semibold text-[#4a5672] dark:text-slate-300">
          <span className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${SALES}`} />Sales</span>
          <span className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${SPENT}`} />Expenses</span>
        </div>
      </div>
      {shown && (
        <p className="text-[13.5px] text-[#4a5672] dark:text-slate-300 mb-2 min-h-[1.25rem]" aria-live="polite">
          <b className="text-[#0E1B3D] dark:text-white">{monthName(shown.month, false)}:</b> sales {money(shown.sales)} · expenses {money(shown.expenses)} · {shown.profit < 0 ? <span className="text-[#b91c1c] font-semibold">loss {money(-shown.profit)}</span> : <>left {money(shown.profit)}</>}
        </p>
      )}
      <div className="relative h-48 pl-11">
        {lines.map((value) => (
          <div key={value} className="absolute left-0 right-0 flex items-center gap-2" style={{ bottom: `${(value / top) * 100}%`, transform: 'translateY(50%)' }}>
            <span className="w-9 text-right text-[11.5px] text-[#8a94a8] shrink-0">{value === 0 ? '0' : shortMoney(value)}</span>
            <span className={`flex-1 border-t ${value === 0 ? 'border-[#d5ddeb] dark:border-slate-700' : 'border-dashed border-[#eef1f6] dark:border-slate-800'}`} />
          </div>
        ))}
        <div className="absolute inset-0 left-11 flex items-end gap-1">
          {months.map((m, i) => (
            <button key={m.month} type="button" onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} onClick={() => setActive(i)}
              aria-label={`${monthName(m.month)}: sales ${money(m.sales)}, expenses ${money(m.expenses)}`}
              className={`relative h-full flex-1 flex items-end justify-center gap-[2px] rounded-t-lg cursor-pointer ${i === shownIndex ? 'bg-[#f4f6fa] dark:bg-slate-800/50' : ''}`}>
              <span className={`w-[38%] max-w-6 rounded-t ${SALES}`} style={{ height: `${(m.sales / top) * 100}%`, minHeight: m.sales > 0 ? 2 : 0 }} />
              <span className={`w-[38%] max-w-6 rounded-t ${SPENT}`} style={{ height: `${(m.expenses / top) * 100}%`, minHeight: m.expenses > 0 ? 2 : 0 }} />
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-1 pl-11 mt-1.5">
        {months.map((m) => <span key={m.month} className={`flex-1 text-center text-[12px] ${m.month === picked ? 'font-extrabold text-[#0E1B3D] dark:text-white' : 'font-semibold text-[#8a94a8]'}`}>{shortMonth(m.month)}</span>)}
      </div>
      <details className="mt-3 group">
        <summary className="text-[13.5px] font-semibold text-[#1D5BEA] cursor-pointer list-none">See as a table</summary>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-[13.5px]">
            <thead><tr className="text-left text-[#6B7894]"><th className="py-1.5 font-semibold">Month</th><th className="py-1.5 font-semibold text-right">Sales</th><th className="py-1.5 font-semibold text-right">Expenses</th><th className="py-1.5 font-semibold text-right">Left</th></tr></thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month} className="border-t border-[#eef1f6] dark:border-slate-800 text-[#0E1B3D] dark:text-slate-200">
                  <td className="py-1.5">{shortMonth(m.month)} {m.month.slice(0, 4)}</td>
                  <td className="py-1.5 text-right">{money(m.sales)}</td>
                  <td className="py-1.5 text-right">{money(m.expenses)}</td>
                  <td className={`py-1.5 text-right font-semibold ${m.profit < 0 ? 'text-[#b91c1c]' : ''}`}>{m.profit < 0 ? `−${money(-m.profit)}` : money(m.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}

/** A round top for the axis: 1, 2 or 5 × a power of ten, at or above the biggest bar. */
function niceTop(max: number) {
  const power = 10 ** Math.floor(Math.log10(max))
  return [1, 2, 5, 10].map((step) => step * power).find((value) => value >= max) || max
}

function WhereItWent({ categories, total }: { categories: Overview['categories']; total: number }) {
  const biggest = Math.max(1, ...categories.map((c) => c.amount))
  return (
    <section className={`${card} p-4 @xl:p-5 min-w-0`}>
      <h2 className="text-[17px] font-extrabold text-[#0E1B3D] dark:text-white mb-3">Where the money went</h2>
      {categories.length === 0 ? (
        <p className="text-[14.5px] text-[#6B7894] py-6 text-center">Nothing spent yet this month.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {categories.map((c) => (
            <li key={c.key} title={`${c.label}: ${money(c.amount)}, ${c.share}% of ${money(total)}`}>
              <div className="flex items-baseline justify-between gap-2 text-[14px]">
                <span className="font-semibold text-[#0E1B3D] dark:text-slate-100 truncate">{c.label}</span>
                <span className="shrink-0 text-[#4a5672] dark:text-slate-300"><b className="text-[#0E1B3D] dark:text-white">{money(c.amount)}</b> · {c.share}%</span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-[#eef1f6] dark:bg-slate-800">
                <div className={`h-2 rounded-full ${SALES}`} style={{ width: `${Math.max(2, (c.amount / biggest) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── Add / change an expense ─────────────────────────────────────────────────

function ExpenseForm({ orgId, month, expense, onClose, onSaved }: { orgId: string; month: string; expense: Expense | null; onClose: () => void; onSaved: (text: string) => void }) {
  const today = istToday()
  const [amount, setAmount] = useState(expense ? String(expense.amount) : '')
  const [category, setCategory] = useState(expense?.category || '')
  const [day, setDay] = useState(expense?.spent_on || (today.startsWith(month) ? today : `${month}-01`))
  const [paidTo, setPaidTo] = useState(expense?.paid_to || '')
  const [method, setMethod] = useState(expense?.method || '')
  const [note, setNote] = useState(expense?.note || '')
  const [repeat, setRepeat] = useState(expense ? expense.repeat_monthly : false)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<{ text: string; field?: string } | null>(null)
  const repeatHint = useMemo(() => category === 'salaries' || category === 'rent' || category === 'loan', [category])

  const pickCategory = (key: string) => {
    setCategory(key)
    // Salaries, rent and EMIs are usually the same every month
    if (!expense && (key === 'salaries' || key === 'rent' || key === 'loan')) setRepeat(true)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const body = { organizationId: orgId, id: expense?.id, amount, category, spent_on: day, paid_to: paidTo, method: method || null, note, repeat_monthly: repeat }
      await api('/api/expenses', { method: expense ? 'PUT' : 'POST', body: JSON.stringify(body) })
      onSaved(expense ? 'Expense saved' : 'Expense added')
    } catch (err: any) {
      setError({ text: err.message })
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!expense) return
    if (!removing) { setRemoving(true); return }
    setSaving(true)
    try {
      await api(`/api/expenses?organizationId=${orgId}&id=${expense.id}`, { method: 'DELETE' })
      onSaved('Expense removed')
    } catch (err: any) {
      setError({ text: err.message })
      setSaving(false)
    }
  }

  return (
    <Modal title={expense ? 'Change expense' : 'Add expense'} subtitle={expense ? dayLabel(expense.spent_on) : 'Salaries, rent, stock, bills, anything'} icon={<Wallet size={20} />} onClose={onClose}
      footer={
        <>
          {expense && <button type="button" className={`${dangerButton} sm:mr-auto`} onClick={remove} disabled={saving}><Trash2 size={17} /> {removing ? 'Yes, remove it' : 'Remove'}</button>}
          <button type="button" className={secondaryButton} onClick={onClose}>Cancel</button>
          <button type="button" className={primaryButton} onClick={save} disabled={saving || !amount || !category}>{saving ? <Loader2 size={18} className="animate-spin" /> : null} {expense ? 'Save' : 'Add expense'}</button>
        </>
      }>
      <div className="flex flex-col gap-4">
        <Field label="How much (₹)">
          <input className={`${input} text-[18px] font-bold`} inputMode="decimal" autoFocus={!expense} placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} />
        </Field>
        <Field label="What for" group>
          <div className="flex flex-wrap gap-2">
            {EXPENSE_CATEGORIES.map((c) => <Chip key={c.key} selected={category === c.key} onClick={() => pickCategory(c.key)}>{c.label}</Chip>)}
          </div>
        </Field>
        <div className="grid gap-4 @md:grid-cols-2">
          <Field label="Date"><input type="date" className={input} value={day} onChange={(e) => setDay(e.target.value)} /></Field>
          <Field label="Paid to (optional)"><input className={input} placeholder={category === 'salaries' ? 'Name of the person' : 'Shop, landlord, company…'} value={paidTo} maxLength={80} onChange={(e) => setPaidTo(e.target.value)} /></Field>
        </div>
        <Field label="How you paid (optional)" group>
          <div className="flex flex-wrap gap-2">
            {PAY_METHODS.map((m) => <Chip key={m.key} selected={method === m.key} onClick={() => setMethod(method === m.key ? '' : m.key)}>{m.label}</Chip>)}
          </div>
        </Field>
        <Field label="Note (optional)"><input className={input} placeholder="e.g. November salary, 10 kg stock" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="rounded-xl border border-[#e3e8f2] dark:border-slate-800 p-3.5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-[#0E1B3D] dark:text-white flex items-center gap-2"><CalendarClock size={16} className="text-[#6B7894]" /> Same every month</p>
            <p className="text-[13px] text-[#6B7894]">{repeatHint ? 'Next month, add it again with one tap.' : 'For salaries, rent or EMIs: add it again next month with one tap.'}</p>
          </div>
          <Toggle checked={repeat} onChange={setRepeat} label="Same every month" />
        </div>
        {error && <p className="text-[14px] font-semibold text-[#b91c1c]" role="alert">{error.text}</p>}
      </div>
    </Modal>
  )
}
