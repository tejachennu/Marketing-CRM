/**
 * Expenses and the money picture: what the business spent (salaries, rent, stock…), what it sold, what was left, and
 * the once-a-month AI review of its sales. Pure and browser-safe (no imports), so the web page, the server and the
 * tests agree. Months are India time ("2026-11"); days are "2026-11-25".
 */

export const EXPENSE_CATEGORIES = [
  { key: 'salaries', label: 'Salaries' },
  { key: 'rent', label: 'Rent' },
  { key: 'bills', label: 'Electricity, water, internet' },
  { key: 'stock', label: 'Stock and supplies' },
  { key: 'marketing', label: 'Ads and marketing' },
  { key: 'transport', label: 'Transport and delivery' },
  { key: 'repairs', label: 'Repairs and upkeep' },
  { key: 'tax', label: 'Taxes and fees' },
  { key: 'loan', label: 'Loan and EMI' },
  { key: 'other', label: 'Other' },
] as const
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]['key']

export const PAY_METHODS = [
  { key: 'cash', label: 'Cash' },
  { key: 'upi', label: 'UPI' },
  { key: 'bank', label: 'Bank transfer' },
  { key: 'card', label: 'Card' },
] as const
export type PayMethod = (typeof PAY_METHODS)[number]['key']

export const MAX_AMOUNT = 100_000_000 // ₹10 crore for one entry
export const SUMMARY_MONTHS = 6

export interface ExpenseInput {
  spent_on: string
  category: ExpenseCategory
  amount: number
  note: string | null
  paid_to: string | null
  method: PayMethod | null
  repeat_monthly: boolean
}

export interface ExpenseRow {
  id?: string
  spent_on: string
  category: string
  amount: number | string
  note?: string | null
  paid_to?: string | null
  method?: string | null
  repeat_monthly?: boolean | null
  repeat_key?: string | null
}

/** One sale: a Front Desk bill or a shop order. */
export interface SaleRow {
  at: string
  amount: number | string
  paid: boolean
  kind: 'bill' | 'order'
  customer?: string | null
}

export interface SoldItem { name: string; quantity: number; amount: number }

export const categoryLabel = (key: string) => EXPENSE_CATEGORIES.find((c) => c.key === key)?.label || 'Other'
export const methodLabel = (key: string | null | undefined) => PAY_METHODS.find((m) => m.key === key)?.label || ''

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTH_RE = /^(\d{4})-(\d{2})$/
const IST_MS = 330 * 60_000

/** Today in India, "2026-11-25" */
export function istToday(now: Date | number = Date.now()): string {
  return new Date(Number(now) + IST_MS).toISOString().slice(0, 10)
}

/** The India-time day of a moment, "2026-11-25" */
export function istDayOf(at: string | Date | number): string {
  const ms = typeof at === 'string' ? Date.parse(at) : Number(at)
  return Number.isFinite(ms) ? new Date(ms + IST_MS).toISOString().slice(0, 10) : ''
}

export function isDay(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const m = DAY_RE.exec(value)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

export function isMonth(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const m = MONTH_RE.exec(value)
  return Boolean(m && +m[1] >= 2000 && +m[1] <= 2100 && +m[2] >= 1 && +m[2] <= 12)
}

export const monthOf = (day: string) => day.slice(0, 7)

export function addMonths(month: string, count: number): string {
  const [y, m] = month.split('-').map(Number)
  const index = y * 12 + (m - 1) + count
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** The month asked for, or this month; never a month after this one. */
export function readMonth(value: unknown, now: Date | number = Date.now()): string {
  const current = monthOf(istToday(now))
  return isMonth(value) && value <= current ? value : current
}

/** The months ending at `month`, oldest first. */
export function monthsUpTo(month: string, count = SUMMARY_MONTHS): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(month, i - count + 1))
}

/** First and last day of a month, and the moments (UTC) its India-time days start and end. */
export function monthBounds(month: string): { first: string; last: string; start: string; end: string } {
  const first = `${month}-01`
  const last = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`
  const start = new Date(Date.parse(`${first}T00:00:00Z`) - IST_MS).toISOString()
  const end = new Date(Date.parse(`${addMonths(month, 1)}-01T00:00:00Z`) - IST_MS).toISOString()
  return { first, last, start, end }
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export function monthName(month: string, withYear = true): string {
  const [y, m] = month.split('-').map(Number)
  return withYear ? `${MONTH_NAMES[m - 1]} ${y}` : MONTH_NAMES[m - 1]
}
export const shortMonth = (month: string) => monthName(month, false).slice(0, 3)

const text = (value: unknown, max: number) => {
  const clean = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
  return clean || null
}

/** Checks an expense typed by a person. Amount in rupees (paise allowed). */
export function cleanExpense(input: any, now: Date | number = Date.now()): { value: ExpenseInput } | { error: string; field: string } {
  const raw = typeof input?.amount === 'string' ? input.amount.replace(/[₹,\s]/g, '') : input?.amount
  const amount = Number(raw)
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Type how much was spent.', field: 'amount' }
  if (amount > MAX_AMOUNT) return { error: 'That amount looks too big. Check it once.', field: 'amount' }
  const today = istToday(now)
  const spentOn = input?.spent_on ?? input?.date ?? today
  if (!isDay(spentOn)) return { error: 'Pick the date it was spent.', field: 'spent_on' }
  if (spentOn < '2000-01-01') return { error: 'Pick the date it was spent.', field: 'spent_on' }
  // Rent paid ahead is fine; a date years away is a typing slip
  const latest = new Date(Date.parse(`${today}T00:00:00Z`) + 62 * 86_400_000).toISOString().slice(0, 10)
  if (spentOn > latest) return { error: 'That date is too far ahead.', field: 'spent_on' }
  const category = EXPENSE_CATEGORIES.some((c) => c.key === input?.category) ? (input.category as ExpenseCategory) : null
  if (!category) return { error: 'Pick what kind of expense it is.', field: 'category' }
  const method = PAY_METHODS.some((m) => m.key === input?.method) ? (input.method as PayMethod) : null
  return {
    value: {
      spent_on: spentOn,
      category,
      amount: round2(amount),
      note: text(input?.note, 200),
      paid_to: text(input?.paid_to, 80),
      method,
      repeat_monthly: input?.repeat_monthly === true,
    },
  }
}

export interface MonthTotals {
  month: string
  sales: number
  salesCount: number
  received: number
  expenses: number
  profit: number
}

/** Sales, money received, expenses and what was left, per month (oldest first). */
export function monthTotals(months: string[], sales: SaleRow[], expenses: ExpenseRow[]): MonthTotals[] {
  const rows = new Map(months.map((month) => [month, { month, sales: 0, salesCount: 0, received: 0, expenses: 0, profit: 0 }]))
  for (const sale of sales) {
    const row = rows.get(monthOf(istDayOf(sale.at)))
    const amount = Number(sale.amount) || 0
    if (!row || amount <= 0) continue
    row.sales += amount
    row.salesCount += 1
    if (sale.paid) row.received += amount
  }
  for (const expense of expenses) {
    const row = rows.get(monthOf(String(expense.spent_on)))
    if (row) row.expenses += Number(expense.amount) || 0
  }
  return months.map((month) => {
    const row = rows.get(month)!
    return { ...row, sales: round2(row.sales), received: round2(row.received), expenses: round2(row.expenses), profit: round2(row.sales - row.expenses) }
  })
}

export interface CategoryTotal { key: string; label: string; amount: number; count: number; share: number }

/** Where the money went in a month, biggest first; share is a whole percent. */
export function byCategory(expenses: ExpenseRow[]): CategoryTotal[] {
  const totals = new Map<string, { amount: number; count: number }>()
  for (const expense of expenses) {
    const key = EXPENSE_CATEGORIES.some((c) => c.key === expense.category) ? expense.category : 'other'
    const row = totals.get(key) || { amount: 0, count: 0 }
    row.amount += Number(expense.amount) || 0
    row.count += 1
    totals.set(key, row)
  }
  const all = [...totals.values()].reduce((sum, row) => sum + row.amount, 0)
  return [...totals.entries()]
    .map(([key, row]) => ({ key, label: categoryLabel(key), amount: round2(row.amount), count: row.count, share: all > 0 ? Math.round((row.amount / all) * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount)
}

/** Sales on each day of the week in a month (Mon first), to find the busy and slow days. */
export function salesByWeekday(sales: SaleRow[]): { day: string; amount: number; count: number }[] {
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const rows = names.map((day) => ({ day, amount: 0, count: 0 }))
  for (const sale of sales) {
    const day = istDayOf(sale.at)
    if (!day) continue
    const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7
    rows[weekday].amount += Number(sale.amount) || 0
    rows[weekday].count += 1
  }
  return rows.map((row) => ({ ...row, amount: round2(row.amount) }))
}

/** The best sellers of a month by money, then by count. */
export function topItems(items: SoldItem[], limit = 5): SoldItem[] {
  const totals = new Map<string, SoldItem>()
  for (const item of items) {
    const name = String(item.name || '').trim()
    if (!name) continue
    const key = name.toLowerCase()
    const row = totals.get(key) || { name, quantity: 0, amount: 0 }
    row.quantity += Number(item.quantity) || 0
    row.amount += Number(item.amount) || 0
    totals.set(key, row)
  }
  return [...totals.values()].map((row) => ({ ...row, amount: round2(row.amount) })).sort((a, b) => b.amount - a.amount || b.quantity - a.quantity).slice(0, limit)
}

/** The key a repeating expense keeps across months (the first one's id). */
export const repeatKeyOf = (row: ExpenseRow) => row.repeat_key || row.id || ''

/**
 * Repeating expenses (salaries, rent…) that are not in `month` yet: for each, the latest earlier copy, if it still
 * repeats. The new copy keeps its day of the month (the 31st becomes the month's last day).
 */
export function repeatsDue(month: string, earlier: ExpenseRow[], inMonth: ExpenseRow[]): (ExpenseInput & { repeat_key: string })[] {
  const latest = new Map<string, ExpenseRow>()
  for (const row of earlier) {
    const key = repeatKeyOf(row)
    if (!key || monthOf(String(row.spent_on)) >= month) continue
    const seen = latest.get(key)
    if (!seen || String(row.spent_on) > String(seen.spent_on)) latest.set(key, row)
  }
  const present = new Set(inMonth.map(repeatKeyOf).filter(Boolean))
  const due: (ExpenseInput & { repeat_key: string })[] = []
  for (const [key, row] of latest) {
    if (!row.repeat_monthly || present.has(key)) continue
    const day = Math.min(Number(String(row.spent_on).slice(8, 10)) || 1, daysInMonth(month))
    due.push({
      spent_on: `${month}-${String(day).padStart(2, '0')}`,
      category: (EXPENSE_CATEGORIES.some((c) => c.key === row.category) ? row.category : 'other') as ExpenseCategory,
      amount: round2(Number(row.amount) || 0),
      note: row.note || null,
      paid_to: row.paid_to || null,
      method: (PAY_METHODS.some((m) => m.key === row.method) ? row.method : null) as PayMethod | null,
      repeat_monthly: true,
      repeat_key: key,
    })
  }
  return due.filter((row) => row.amount > 0).sort((a, b) => a.spent_on.localeCompare(b.spent_on))
}

// ── The monthly AI review ───────────────────────────────────────────────────

/** "full" after the month ends; "so_far" while it is still going on. One of each per month. */
export type InsightKind = 'full' | 'so_far'

export function insightKindFor(month: string, now: Date | number = Date.now()): InsightKind {
  return month < monthOf(istToday(now)) ? 'full' : 'so_far'
}

export interface Insight {
  summary: string
  good: string[]
  improve: string[]
  ideas: string[]
  focus: string
}

export interface InsightFacts {
  business: string
  kind: string
  month: string
  monthLabel: string
  soFar: boolean
  daysCounted: number
  totals: MonthTotals
  before: MonthTotals | null
  trend: MonthTotals[]
  categories: CategoryTotal[]
  weekdays: { day: string; amount: number; count: number }[]
  topItems: SoldItem[]
  customers: number
  returning: number
}

const rupees = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`

/** The numbers the AI is given, in plain lines (only these; it must not make any up). */
export function insightFactsText(facts: InsightFacts): string {
  const t = facts.totals
  const lines = [
    `Business: ${facts.business || 'a small business'} (${facts.kind || 'small business'}) in India.`,
    `Month: ${facts.monthLabel}${facts.soFar ? ` (still going on: ${facts.daysCounted} days so far)` : ''}.`,
    `Sales: ${rupees(t.sales)} from ${t.salesCount} ${t.salesCount === 1 ? 'sale' : 'sales'}${t.salesCount ? `, average ${rupees(t.sales / t.salesCount)}` : ''}. Money received: ${rupees(t.received)}; still to collect: ${rupees(Math.max(0, t.sales - t.received))}.`,
    `Expenses: ${rupees(t.expenses)}. Left after expenses: ${rupees(t.profit)}${t.sales > 0 ? ` (${Math.round((t.profit / t.sales) * 100)}% of sales)` : ''}.`,
  ]
  if (facts.categories.length) lines.push(`Expenses by kind: ${facts.categories.map((c) => `${c.label} ${rupees(c.amount)} (${c.share}%)`).join('; ')}.`)
  else lines.push('No expenses were written down for this month.')
  if (facts.before) lines.push(`Month before: sales ${rupees(facts.before.sales)} from ${facts.before.salesCount} sales, expenses ${rupees(facts.before.expenses)}, left ${rupees(facts.before.profit)}.`)
  const trend = facts.trend.filter((m) => m.sales > 0 || m.expenses > 0)
  if (trend.length > 1) lines.push(`Last months (sales / expenses): ${trend.map((m) => `${shortMonth(m.month)} ${rupees(m.sales)} / ${rupees(m.expenses)}`).join(', ')}.`)
  if (facts.topItems.length) lines.push(`Best sellers: ${facts.topItems.map((i) => `${i.name} (${i.quantity} sold, ${rupees(i.amount)})`).join('; ')}.`)
  const busy = facts.weekdays.filter((d) => d.count > 0)
  if (busy.length) lines.push(`Sales by day of week: ${facts.weekdays.map((d) => `${d.day} ${rupees(d.amount)} (${d.count})`).join(', ')}.`)
  if (facts.customers > 0) lines.push(`Customers: ${facts.customers}, of whom ${facts.returning} had bought before.`)
  return lines.join('\n')
}

export function insightPrompt(facts: InsightFacts): string {
  return [
    'You are a friendly business advisor for small shops and service businesses in India.',
    `Review this business's ${facts.soFar ? 'month so far' : 'month'} using ONLY the numbers below. Never make up a number, a percentage or a name that is not below. If something is not known, do not guess it.`,
    'Write for a busy shop owner: plain, simple English, short sentences, no jargon, no English idioms. Use ₹ with Indian grouping.',
    'Give practical sales ideas they can do this month with WhatsApp, offers, repeat customers, slow days, best sellers and costs.',
    '',
    facts.soFar ? 'The month is not over: say "so far" and compare carefully (the month before was a full month).' : '',
    insightFactsText(facts),
    '',
    'Answer as JSON only: {"summary": "2-3 sentences: how the month went", "good": ["up to 3 things that went well"], "improve": ["up to 3 things to fix, with the reason"], "ideas": ["3 or 4 concrete sales ideas for next month"], "focus": "the one most important thing to do next"}',
  ].filter((line, i, all) => line !== '' || all[i - 1] !== '').join('\n')
}

const listOf = (value: unknown, max: number) =>
  (Array.isArray(value) ? value : [])
    .map((item) => (typeof item === 'string' ? item.replace(/\s+/g, ' ').trim().slice(0, 320) : ''))
    .filter(Boolean)
    .slice(0, max)

/** The AI's answer, checked; null when it is unusable. */
export function parseInsight(raw: unknown): Insight | null {
  let data: any = raw
  if (typeof raw === 'string') {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try { data = JSON.parse(raw.slice(start, end + 1)) } catch { return null }
  }
  if (!data || typeof data !== 'object') return null
  const summary = typeof data.summary === 'string' ? data.summary.replace(/\s+/g, ' ').trim().slice(0, 700) : ''
  if (!summary) return null
  const insight: Insight = {
    summary,
    good: listOf(data.good, 3),
    improve: listOf(data.improve, 3),
    ideas: listOf(data.ideas, 4),
    focus: typeof data.focus === 'string' ? data.focus.replace(/\s+/g, ' ').trim().slice(0, 320) : '',
  }
  return insight.ideas.length || insight.improve.length || insight.good.length ? insight : null
}

/** Enough to write about? A month with no sales and no expenses has nothing to review. */
export function insightBlocker(totals: MonthTotals): string | null {
  if (totals.salesCount === 0 && totals.expenses === 0) return 'There are no sales or expenses in this month yet, so there is nothing to review.'
  return null
}
