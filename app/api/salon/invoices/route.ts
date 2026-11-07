import { NextRequest, NextResponse } from 'next/server'
import { rangeBounds, resolveRange } from '@/lib/salon/ranges'
import { allRows } from '@/lib/salon/rows'
import { salonAccess, serverError } from '@/lib/salon/server'

export const runtime = 'nodejs'

/** How many bills the list shows at most; the totals always cover the whole range. */
const LIST_LIMIT = 1000

// GET ?organizationId&preset=today|yesterday|week|month|last_month|custom&from&to: the bills in the range and their totals
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const access = await salonAccess(request, params.get('organizationId'))
  if (!access.ok) return access.response
  const { db, organizationId } = access.ctx
  const range = resolveRange(params.get('preset'), params.get('from'), params.get('to'))
  const { start, end } = rangeBounds(range)
  try {
    const inRange = (columns: string) => db.from('salon_invoices').select(columns).eq('organization_id', organizationId).gte('issued_at', start).lt('issued_at', end)
    const [list, all] = await Promise.all([
      inRange('*').order('issued_at', { ascending: false }).limit(LIST_LIMIT),
      allRows((from, to) => inRange('id, total, status').order('issued_at', { ascending: false }).order('id').range(from, to)),
    ])
    if (list.error) throw list.error
    const rows = all.rows as { total: number | string; status: string }[]
    const sum = (status: (s: string) => boolean) => Math.round(rows.filter((row) => status(row.status)).reduce((total, row) => total + (Number(row.total) || 0), 0) * 100) / 100
    const count = (status: string) => rows.filter((row) => row.status === status).length
    const invoices = list.data || []
    return NextResponse.json({
      success: true,
      range,
      invoices,
      // Fewer bills listed than in the range: a long range, choose a shorter one to see them all
      more: Math.max(0, rows.length - invoices.length),
      summary: {
        collected: sum((s) => s === 'paid'),
        billed: sum((s) => s !== 'void'),
        bills: rows.length - count('void'),
        paidCount: count('paid'),
        unpaidCount: count('unpaid'),
        unpaidAmount: sum((s) => s === 'unpaid'),
        voidCount: count('void'),
      },
    })
  } catch (error) {
    return serverError('invoices', error)
  }
}
