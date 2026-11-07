import { NextRequest, NextResponse } from 'next/server'
import { rangeBounds, resolveRange } from '@/lib/salon/ranges'
import { reviewPeople, reviewSummary, type ReviewRow } from '@/lib/salon/reviews'
import { allRows } from '@/lib/salon/rows'
import { withSalonSchema } from '@/lib/salon/schema'
import { salonAccess, serverError } from '@/lib/salon/server'

export const runtime = 'nodejs'

const MAX_REVIEWS = 5000

// GET ?organizationId&preset&from&to: the customer reviews in the range, with their bills and a summary (managers and up)
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const access = await salonAccess(request, params.get('organizationId'), 'automation.manage')
  if (!access.ok) return access.response
  const range = resolveRange(params.get('preset'), params.get('from'), params.get('to'))
  const { start, end } = rangeBounds(range)
  const { db, organizationId } = access.ctx
  try {
    const [feedback, staff] = await Promise.all([
      allRows<ReviewRow>((from, to) => withSalonSchema(() => db.from('salon_feedback').select('*').eq('organization_id', organizationId)
        .gte('created_at', start).lt('created_at', end).order('created_at', { ascending: false }).order('id').range(from, to)), { max: MAX_REVIEWS }),
      withSalonSchema(() => db.from('salon_staff').select('id, name, active').eq('organization_id', organizationId).order('name')),
    ])
    if (staff.error) throw new Error(staff.error.message)

    // The bills, for their number, link and who did what (a few at a time: ids go in the address)
    const ids = [...new Set(feedback.rows.map((row) => row.invoice_id).filter(Boolean))] as string[]
    const invoices = new Map<string, any>()
    for (let i = 0; i < ids.length; i += 150) {
      const { data, error } = await db.from('salon_invoices').select('id, number, public_token, total, status, staff_name, items').eq('organization_id', organizationId).in('id', ids.slice(i, i + 150))
      if (error) throw new Error(error.message)
      for (const invoice of data || []) invoices.set(invoice.id, invoice)
    }

    const reviews = feedback.rows.map((row) => {
      const invoice = row.invoice_id ? invoices.get(row.invoice_id) : null
      return {
        id: row.id,
        rating: row.rating,
        comment: row.comment || null,
        tags: row.tags || [],
        source: row.source || 'chat',
        created_at: row.created_at,
        followed_up_at: row.followed_up_at || null,
        customer_name: row.customer_name || null,
        customer_phone: row.customer_phone || null,
        people: reviewPeople(row, invoice),
        invoice: invoice ? { number: invoice.number, public_token: invoice.public_token, total: Number(invoice.total) || 0, status: invoice.status } : null,
      }
    })
    return NextResponse.json({
      success: true,
      range,
      reviews,
      truncated: feedback.truncated,
      summary: reviewSummary(feedback.rows, staff.data || []),
      staff: (staff.data || []).filter((member: any) => member.active !== false).map((member: any) => ({ id: member.id, name: member.name })),
    })
  } catch (error) {
    return serverError('reviews', error)
  }
}
