import { NextRequest, NextResponse } from 'next/server'
import { computePerformance } from '@/lib/salon/performance'
import { rangeBounds, resolveRange } from '@/lib/salon/ranges'
import { allRows } from '@/lib/salon/rows'
import { withSalonSchema } from '@/lib/salon/schema'
import { salonAccess, serverError } from '@/lib/salon/server'

export const runtime = 'nodejs'

// GET ?organizationId&preset&from&to: staff performance, commission and feedback (managers and up).
// `period` is the older name for `preset`.
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const access = await salonAccess(request, params.get('organizationId'), 'automation.manage')
  if (!access.ok) return access.response
  const range = resolveRange(params.get('preset') || params.get('period'), params.get('from'), params.get('to'))
  const { start, end } = rangeBounds(range)
  const { db, organizationId } = access.ctx
  try {
    const [invoices, feedback, staff, toCall, recent] = await Promise.all([
      allRows((from, to) => withSalonSchema(() => db.from('salon_invoices').select('id, status, issued_at, staff_name, items').eq('organization_id', organizationId).gte('issued_at', start).lt('issued_at', end).order('issued_at').order('id').range(from, to))),
      allRows((from, to) => withSalonSchema(() => db.from('salon_feedback').select('rating, staff_ids, staff_names, staff_ratings, created_at').eq('organization_id', organizationId).gte('created_at', start).lt('created_at', end).order('created_at').order('id').range(from, to))),
      withSalonSchema(() => db.from('salon_staff').select('*').eq('organization_id', organizationId).order('name')),
      // Unhappy customers nobody has called yet (last 60 days)
      withSalonSchema(() => db.from('salon_feedback').select('*').eq('organization_id', organizationId).lte('rating', 2).is('followed_up_at', null)
        .gte('created_at', new Date(Date.now() - 60 * 24 * 3600_000).toISOString()).order('created_at', { ascending: false }).limit(50)),
      withSalonSchema(() => db.from('salon_feedback').select('*').eq('organization_id', organizationId).gte('created_at', start).lt('created_at', end).order('created_at', { ascending: false }).limit(20)),
    ])
    if (staff.error) throw new Error(staff.error.message)
    const report = computePerformance(invoices.rows, feedback.rows, staff.data || [])
    return NextResponse.json({ success: true, range, period: range.preset, from: range.from, to: range.to, ...report, toCall: toCall.data || [], recentFeedback: recent.data || [] })
  } catch (error) {
    return serverError('performance', error)
  }
}
