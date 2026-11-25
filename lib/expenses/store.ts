/**
 * Expenses and the monthly sales review in the database (rules in rules.ts). Server only.
 * Sales come from Front Desk bills (not cancelled) and shop orders (not cancelled, not waiting for payment).
 */

import { randomUUID } from 'node:crypto'
import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'
import {
  byCategory, insightKindFor, istToday, monthBounds, monthOf, monthsUpTo, monthTotals, monthName, repeatsDue, salesByWeekday,
  topItems, addMonths, daysInMonth,
  type ExpenseInput, type ExpenseRow, type Insight, type InsightFacts, type InsightKind, type SaleRow, type SoldItem,
} from './rules'

/** supabase/migrations/20261212_expenses.sql word for word. */
export const EXPENSES_SQL = `-- Expenses (salaries, rent, stock…) and the once-a-month AI review of sales. Safe to run more than once.
-- The app runs it on its own when first needed.
CREATE TABLE IF NOT EXISTS business_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  spent_on DATE NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  note TEXT,
  paid_to TEXT,
  method TEXT,
  repeat_monthly BOOLEAN NOT NULL DEFAULT FALSE,
  repeat_key UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_business_expenses_org ON business_expenses(organization_id, spent_on DESC);
-- A repeating expense is copied into a month once
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_expenses_repeat ON business_expenses(organization_id, repeat_key, spent_on) WHERE repeat_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS business_insights (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'full',
  insight JSONB,
  facts JSONB,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, month, kind)
);

ALTER TABLE business_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_insights ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
`
export const EXPENSES_LOCK = 724519038
export const expensesSchemaSetup = createAutoSetup('Expenses', (connectionString) => runMigrationSql(connectionString, EXPENSES_SQL, EXPENSES_LOCK))

export async function withExpensesSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = expensesSchemaSetup): Promise<any> {
  const first = await step()
  if (!isMissingSchemaError(first.error, /business_expenses|business_insights/)) return first
  if (!(await setup.ensure())) return first
  return step()
}

const EXPENSE_COLUMNS = 'id, spent_on, category, amount, note, paid_to, method, repeat_monthly, repeat_key, created_at'
const PAGE = 1000

/** Every row of a query, a thousand at a time (Supabase answers at most 1,000 rows per call). */
async function allRows(query: (from: number, to: number) => PromiseLike<any>, max = 20_000): Promise<{ data: any[]; error: any }> {
  const rows: any[] = []
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1)
    if (error) return { data: rows, error }
    rows.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return { data: rows, error: null }
}

export async function expensesBetween(db: any, organizationId: string, first: string, last: string): Promise<ExpenseRow[]> {
  const { data, error } = await withExpensesSchema(() => allRows((from, to) =>
    db.from('business_expenses').select(EXPENSE_COLUMNS).eq('organization_id', organizationId).gte('spent_on', first).lte('spent_on', last)
      .order('spent_on', { ascending: false }).order('created_at', { ascending: false }).range(from, to)))
  if (error) throw new Error(error.message || 'Expenses could not be loaded.')
  return data
}

const ORDER_SKIPPED = ['canceled', 'cancelled', 'payment_pending']

/** Sales between two moments: Front Desk bills and shop orders. Missing tables (connector never used) count as none. */
export async function salesBetween(db: any, organizationId: string, start: string, end: string, detail = false): Promise<{ sales: SaleRow[]; items: SoldItem[] }> {
  const sales: SaleRow[] = []
  const items: SoldItem[] = []
  const bills = await allRows((from, to) =>
    db.from('salon_invoices').select(detail ? 'id, total, status, issued_at, items, customer_phone, contact_id' : 'id, total, status, issued_at')
      .eq('organization_id', organizationId).gte('issued_at', start).lt('issued_at', end).order('issued_at', { ascending: true }).range(from, to))
  for (const bill of bills.error ? [] : bills.data) {
    if (bill.status === 'void') continue
    sales.push({ at: bill.issued_at, amount: Number(bill.total) || 0, paid: bill.status === 'paid', kind: 'bill', customer: bill.customer_phone ? phoneKey(bill.customer_phone) : bill.contact_id || null })
    if (detail) {
      for (const line of Array.isArray(bill.items) ? bill.items : []) {
        const quantity = Number(line?.quantity) || 1
        items.push({ name: String(line?.name || ''), quantity, amount: Number(line?.total ?? line?.amount ?? (Number(line?.price) || 0) * quantity) || 0 })
      }
    }
  }
  const orders = await allRows((from, to) =>
    db.from('commerce_orders').select(detail ? 'id, total_amount, status, payment_status, created_at, contact_id, shipping_address' : 'id, total_amount, status, payment_status, created_at')
      .eq('organization_id', organizationId).gte('created_at', start).lt('created_at', end).order('created_at', { ascending: true }).range(from, to))
  const counted = (orders.error ? [] : orders.data).filter((o: any) => !ORDER_SKIPPED.includes(String(o.status)))
  for (const order of counted) {
    const phone = order.shipping_address?.phone_number
    sales.push({ at: order.created_at, amount: Number(order.total_amount) || 0, paid: order.payment_status === 'paid', kind: 'order', customer: phone ? phoneKey(phone) : order.contact_id || null })
  }
  if (detail && counted.length) {
    const ids = counted.map((o: any) => o.id)
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await db.from('commerce_order_items').select('title, quantity, total_price').in('order_id', ids.slice(i, i + 200))
      for (const line of data || []) items.push({ name: String(line.title || ''), quantity: Number(line.quantity) || 1, amount: Number(line.total_price) || 0 })
    }
  }
  return { sales, items }
}

const phoneKey = (phone: unknown) => String(phone || '').replace(/\D/g, '').slice(-10)

export interface SavedInsight { month: string; kind: InsightKind; insight: Insight | null; created_at: string }

export async function insightsFor(db: any, organizationId: string, month: string): Promise<SavedInsight[]> {
  const { data, error } = await withExpensesSchema(() => db.from('business_insights').select('month, kind, insight, created_at').eq('organization_id', organizationId).eq('month', month))
  if (error) return []
  return (data || []).filter((row: any) => row.insight).map((row: any) => ({ month: row.month, kind: row.kind, insight: row.insight, created_at: row.created_at }))
}

/** Everything the Expenses page shows for a month. */
export async function loadExpensesOverview(db: any, organizationId: string, month: string, now: Date | number = Date.now()) {
  const months = monthsUpTo(month)
  const range = { first: monthBounds(months[0]).first, last: monthBounds(month).last, start: monthBounds(months[0]).start, end: monthBounds(month).end }
  const [expenses, { sales }, insights] = await Promise.all([
    expensesBetween(db, organizationId, range.first, range.last),
    salesBetween(db, organizationId, range.start, range.end),
    insightsFor(db, organizationId, month),
  ])
  const thisMonth = expenses.filter((row) => monthOf(String(row.spent_on)) === month)
  const earlier = await expensesBetween(db, organizationId, monthBounds(addMonths(month, -3)).first, monthBounds(addMonths(month, -1)).last)
  const kind = insightKindFor(month, now)
  return {
    month,
    current: monthOf(istToday(now)),
    months: monthTotals(months, sales, expenses),
    categories: byCategory(thisMonth),
    expenses: thisMonth.map((row) => ({ ...row, amount: Number(row.amount) || 0 })),
    repeatsDue: repeatsDue(month, earlier, thisMonth).length,
    insight: insights.find((row) => row.kind === 'full') || insights.find((row) => row.kind === kind) || null,
    insightKind: kind,
    canAskInsight: !insights.some((row) => row.kind === kind) && !insights.some((row) => row.kind === 'full'),
  }
}

export async function addExpense(db: any, organizationId: string, value: ExpenseInput, userId: string | null) {
  const id = randomUUID()
  const { data, error } = await withExpensesSchema(() => db.from('business_expenses').insert({
    id, organization_id: organizationId, ...value, repeat_key: value.repeat_monthly ? id : null, created_by: userId,
  }).select(EXPENSE_COLUMNS).single())
  if (error) throw new Error(error.message || 'The expense could not be saved.')
  return data
}

export async function updateExpense(db: any, organizationId: string, id: string, value: ExpenseInput) {
  const { data: old } = await withExpensesSchema(() => db.from('business_expenses').select('id, repeat_key').eq('organization_id', organizationId).eq('id', id).maybeSingle())
  if (!old) return null
  // Switching "every month" on starts a chain from this one; switching it off keeps the chain so it is not copied again
  const repeatKey = old.repeat_key || (value.repeat_monthly ? id : null)
  const { data, error } = await db.from('business_expenses').update({ ...value, repeat_key: repeatKey, updated_at: new Date().toISOString() })
    .eq('organization_id', organizationId).eq('id', id).select(EXPENSE_COLUMNS).single()
  if (error) throw new Error(error.message || 'The expense could not be saved.')
  return data
}

export async function deleteExpense(db: any, organizationId: string, id: string): Promise<boolean> {
  const { data, error } = await withExpensesSchema(() => db.from('business_expenses').delete().eq('organization_id', organizationId).eq('id', id).select('id'))
  if (error) throw new Error(error.message || 'The expense could not be removed.')
  return Boolean(data?.length)
}

/** Copies the repeating expenses (salaries, rent…) into a month; returns how many were added. */
export async function copyRepeats(db: any, organizationId: string, month: string, userId: string | null): Promise<number> {
  const earlier = await expensesBetween(db, organizationId, monthBounds(addMonths(month, -3)).first, monthBounds(addMonths(month, -1)).last)
  const inMonth = await expensesBetween(db, organizationId, monthBounds(month).first, monthBounds(month).last)
  const due = repeatsDue(month, earlier, inMonth)
  let added = 0
  for (const row of due) {
    const { error } = await db.from('business_expenses').insert({ organization_id: organizationId, ...row, created_by: userId })
    if (!error) added += 1
    else if (!/duplicate|unique/i.test(String(error.message))) throw new Error(error.message || 'Could not add them.')
  }
  return added
}

/** The numbers behind a month's review. */
export async function insightFacts(db: any, organizationId: string, month: string, now: Date | number = Date.now()): Promise<InsightFacts> {
  const months = monthsUpTo(month)
  const bounds = monthBounds(month)
  const [expenses, trendSales, detail, org] = await Promise.all([
    expensesBetween(db, organizationId, monthBounds(months[0]).first, bounds.last),
    salesBetween(db, organizationId, monthBounds(months[0]).start, bounds.end),
    salesBetween(db, organizationId, bounds.start, bounds.end, true),
    db.from('organizations').select('name, enabled_connectors, enable_commerce').eq('id', organizationId).maybeSingle(),
  ])
  const trend = monthTotals(months, trendSales.sales, expenses)
  const totals = trend[trend.length - 1]
  const before = trend.length > 1 ? trend[trend.length - 2] : null
  // Customers who bought this month, and how many had bought in the year before it
  const buyers = new Set(detail.sales.map((s) => s.customer).filter(Boolean) as string[])
  let returning = 0
  if (buyers.size) {
    const yearBefore = await salesBetween(db, organizationId, monthBounds(addMonths(month, -12)).start, bounds.start, true)
    const old = new Set(yearBefore.sales.map((s) => s.customer).filter(Boolean))
    for (const buyer of buyers) if (old.has(buyer)) returning += 1
  }
  const today = istToday(now)
  const soFar = insightKindFor(month, now) === 'so_far'
  const connectors: string[] = Array.isArray(org?.data?.enabled_connectors) ? org.data.enabled_connectors : []
  return {
    business: String(org?.data?.name || ''),
    kind: connectors.includes('salon') ? 'service business with bookings and bills' : org?.data?.enable_commerce ? 'shop selling products' : 'small business',
    month,
    monthLabel: monthName(month),
    soFar,
    daysCounted: soFar ? Math.max(1, Number(today.slice(8, 10))) : daysInMonth(month),
    totals,
    before,
    trend,
    categories: byCategory(expenses.filter((row) => monthOf(String(row.spent_on)) === month)),
    weekdays: salesByWeekday(detail.sales),
    topItems: topItems(detail.items),
    customers: buyers.size,
    returning,
  }
}

/** Holds the month's review while it is written, so two taps make one. False when one is there or being written. */
export async function claimInsight(db: any, organizationId: string, month: string, kind: InsightKind, userId: string | null): Promise<boolean> {
  const { error } = await withExpensesSchema(() => db.from('business_insights').insert({ organization_id: organizationId, month, kind, insight: null, created_by: userId }))
  if (!error) return true
  if (!/duplicate|unique/i.test(String(error.message))) throw new Error(error.message || 'Could not start the review.')
  // A claim left by a failed try more than 3 minutes ago is taken over
  const { data } = await db.from('business_insights').select('insight, created_at').eq('organization_id', organizationId).eq('month', month).eq('kind', kind).maybeSingle()
  if (data && !data.insight && Date.now() - Date.parse(data.created_at) > 3 * 60_000) {
    const { data: taken } = await db.from('business_insights').update({ created_at: new Date().toISOString(), created_by: userId })
      .eq('organization_id', organizationId).eq('month', month).eq('kind', kind).is('insight', null).eq('created_at', data.created_at).select('month')
    return Boolean(taken?.length)
  }
  return false
}

export async function saveInsight(db: any, organizationId: string, month: string, kind: InsightKind, insight: Insight, facts: InsightFacts) {
  const { data, error } = await db.from('business_insights').update({ insight, facts, created_at: new Date().toISOString() })
    .eq('organization_id', organizationId).eq('month', month).eq('kind', kind).select('month, kind, insight, created_at').single()
  if (error) throw new Error(error.message || 'The review could not be saved.')
  return data as SavedInsight
}

export async function dropClaim(db: any, organizationId: string, month: string, kind: InsightKind) {
  await db.from('business_insights').delete().eq('organization_id', organizationId).eq('month', month).eq('kind', kind).is('insight', null)
}
