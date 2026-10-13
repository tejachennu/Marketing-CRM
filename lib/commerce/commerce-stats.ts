import { getPool } from '@/lib/campaign-stats'
import { OPEN_CHECKOUT_STATUSES, TO_SHIP_STATUSES } from './commerce-utils'

export interface CommerceSummary {
  total: number
  awaiting: number
  toShip: number
  shipped: number
  delivered: number
  canceled: number
  /** Canceled after the customer paid: money that has to be refunded. */
  refundDue: number
  /** Money received for orders that were not canceled, per currency, largest first. */
  revenue: { currency: string; amount: number }[]
}

const EMPTY: CommerceSummary = { total: 0, awaiting: 0, toShip: 0, shipped: 0, delivered: 0, canceled: 0, refundDue: 0, revenue: [] }
const int = (value: unknown) => parseInt(String(value ?? '0'), 10) || 0

/**
 * Totals for every order of a store, whatever page or filter the dashboard is on.
 * Uses one SQL query when a direct database connection is configured, otherwise counts
 * through the API.
 */
export async function getCommerceSummary(supabase: any, organizationId: string): Promise<CommerceSummary> {
  const pool = getPool()
  if (pool) {
    try {
      const [counts, revenue] = await Promise.all([
        pool.query(
          `SELECT
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE status = ANY($2::text[])) AS awaiting,
             COUNT(*) FILTER (WHERE status = ANY($3::text[])) AS to_ship,
             COUNT(*) FILTER (WHERE status = 'shipped') AS shipped,
             COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
             COUNT(*) FILTER (WHERE status = 'canceled') AS canceled,
             COUNT(*) FILTER (WHERE status = 'canceled' AND payment_status = 'paid') AS refund_due
           FROM commerce_orders
           WHERE organization_id = $1`,
          [organizationId, OPEN_CHECKOUT_STATUSES, TO_SHIP_STATUSES]
        ),
        pool.query(
          `SELECT UPPER(currency) AS currency, SUM(total_amount) AS amount
           FROM commerce_orders
           WHERE organization_id = $1 AND payment_status = 'paid' AND status <> 'canceled'
           GROUP BY UPPER(currency)
           ORDER BY SUM(total_amount) DESC`,
          [organizationId]
        ),
      ])
      const row = counts.rows[0] || {}
      return {
        total: int(row.total),
        awaiting: int(row.awaiting),
        toShip: int(row.to_ship),
        shipped: int(row.shipped),
        delivered: int(row.delivered),
        canceled: int(row.canceled),
        refundDue: int(row.refund_due),
        revenue: revenue.rows.map((item: any) => ({ currency: item.currency || 'INR', amount: Number(item.amount) || 0 })),
      }
    } catch (err) {
      console.error('[Commerce Stats] SQL summary failed, falling back to API counts:', err)
    }
  }

  try {
    const count = async (apply: (query: any) => any) => {
      const { count: value } = await apply(supabase.from('commerce_orders').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId))
      return value || 0
    }
    const [total, awaiting, toShip, shipped, delivered, canceled, refundDue] = await Promise.all([
      count((query) => query),
      count((query) => query.in('status', OPEN_CHECKOUT_STATUSES)),
      count((query) => query.in('status', TO_SHIP_STATUSES)),
      count((query) => query.eq('status', 'shipped')),
      count((query) => query.eq('status', 'delivered')),
      count((query) => query.eq('status', 'canceled')),
      count((query) => query.eq('status', 'canceled').eq('payment_status', 'paid')),
    ])

    // Revenue has to be added up from the rows; they are read a page at a time
    const totals = new Map<string, number>()
    for (let from = 0; from < 50000; from += 1000) {
      const { data, error } = await supabase
        .from('commerce_orders')
        .select('total_amount, currency')
        .eq('organization_id', organizationId)
        .eq('payment_status', 'paid')
        .neq('status', 'canceled')
        .order('id', { ascending: true })
        .range(from, from + 999)
      if (error || !data) break
      for (const order of data) {
        const code = String(order.currency || 'INR').toUpperCase()
        totals.set(code, (totals.get(code) || 0) + (Number(order.total_amount) || 0))
      }
      if (data.length < 1000) break
    }

    return {
      total, awaiting, toShip, shipped, delivered, canceled, refundDue,
      revenue: [...totals.entries()].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => b.amount - a.amount),
    }
  } catch (err) {
    console.error('[Commerce Stats] Summary failed:', err)
    return EMPTY
  }
}
