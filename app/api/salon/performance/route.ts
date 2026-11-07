import { NextRequest, NextResponse } from 'next/server'
import { computePerformance, periodRange } from '@/lib/salon/performance'
import { withSalonSchema } from '@/lib/salon/schema'
import { salonAccess, serverError } from '@/lib/salon/server'
import { istDayRange } from '@/lib/salon/spoken'

export const runtime = 'nodejs'

// GET ?organizationId&period=today|week|month|last_month: staff performance, commission and feedback (managers and up)
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const access = await salonAccess(request, params.get('organizationId'), 'automation.manage')
  if (!access.ok) return access.response
  const period = ['today', 'week', 'month', 'last_month'].includes(params.get('period') || '') ? params.get('period')! : 'month'
  const { from, to } = periodRange(period)
  const start = istDayRange(from).start
  const end = istDayRange(to).end
  const { db, organizationId } = access.ctx
  try {
    const [invoices, feedback, staff, toCall, recent] = await Promise.all([
      withSalonSchema(() => db.from('salon_invoices').select('id, status, issued_at, staff_name, items').eq('organization_id', organizationId).gte('issued_at', start).lt('issued_at', end).limit(5000)),
      withSalonSchema(() => db.from('salon_feedback').select('rating, staff_ids, staff_names, staff_ratings, created_at').eq('organization_id', organizationId).gte('created_at', start).lt('created_at', end).limit(5000)),
      withSalonSchema(() => db.from('salon_staff').select('*').eq('organization_id', organizationId).order('name')),
      // Unhappy customers nobody has called yet (last 60 days)
      withSalonSchema(() => db.from('salon_feedback').select('*').eq('organization_id', organizationId).lte('rating', 2).is('followed_up_at', null)
        .gte('created_at', new Date(Date.now() - 60 * 24 * 3600_000).toISOString()).order('created_at', { ascending: false }).limit(50)),
      withSalonSchema(() => db.from('salon_feedback').select('*').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(20)),
    ])
    for (const result of [invoices, feedback, staff]) if (result.error) throw new Error(result.error.message)
    const report = computePerformance(invoices.data || [], feedback.data || [], staff.data || [])
    return NextResponse.json({ success: true, period, from, to, ...report, toCall: toCall.data || [], recentFeedback: recent.data || [] })
  } catch (error) {
    return serverError('performance', error)
  }
}
