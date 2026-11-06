import { NextRequest, NextResponse } from 'next/server'
import { salonAccess, serverError } from '@/lib/salon/server'
import { istDate, istDayRange } from '@/lib/salon/spoken'

export const runtime = 'nodejs'

// GET ?organizationId: recent invoices with today's and this month's takings
export async function GET(request: NextRequest) {
  const access = await salonAccess(request, new URL(request.url).searchParams.get('organizationId'))
  if (!access.ok) return access.response
  const { db, organizationId } = access.ctx
  try {
    const today = istDate()
    const monthStart = istDayRange(`${today.slice(0, 7)}-01`).start
    const todayStart = istDayRange(today).start
    const [recent, month] = await Promise.all([
      db.from('salon_invoices').select('*').eq('organization_id', organizationId).order('issued_at', { ascending: false }).limit(100),
      db.from('salon_invoices').select('total, status, issued_at, paid_at').eq('organization_id', organizationId).gte('issued_at', monthStart).limit(5000),
    ])
    if (recent.error) throw recent.error
    const rows = month.data || []
    const sum = (list: any[]) => Math.round(list.reduce((total, row) => total + (Number(row.total) || 0), 0) * 100) / 100
    const paid = rows.filter((row: any) => row.status === 'paid')
    const unpaid = rows.filter((row: any) => row.status === 'unpaid')
    return NextResponse.json({
      success: true,
      invoices: recent.data || [],
      summary: {
        today: sum(paid.filter((row: any) => (row.paid_at || row.issued_at) >= todayStart)),
        month: sum(paid),
        unpaidCount: unpaid.length,
        unpaidAmount: sum(unpaid),
      },
    })
  } catch (error) {
    return serverError('invoices', error)
  }
}
