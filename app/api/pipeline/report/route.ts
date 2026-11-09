import { NextRequest, NextResponse } from 'next/server'
import { pipelineReport, isUuid } from '@/lib/pipeline/rules'
import { pipelineAccess, serverError, teamOf } from '@/lib/pipeline/server'
import { loadStages, scoped } from '@/lib/pipeline/store'
import { rangeBounds, resolveRange } from '@/lib/salon/ranges'
import { allRows } from '@/lib/salon/rows'

export const runtime = 'nodejs'

const COLUMNS = 'id, title, value, status, priority, source, pipeline_stage_id, assigned_to, created_at, won_at, lost_at, won_lost_reason, next_follow_up_at, last_activity_at, expected_close_date'

// GET ?organizationId&preset&from&to&owner: the pipeline's numbers for a date range (a salesperson
// who only sees their own work gets their own numbers)
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const access = await pipelineAccess(request, params.get('organizationId'))
  if (!access.ok) return access.response
  const { db, organizationId, actor } = access.ctx
  const range = resolveRange(params.get('preset'), params.get('from'), params.get('to'))
  const owner = params.get('owner')
  try {
    const [stages, team, leads] = await Promise.all([
      loadStages(db, organizationId),
      teamOf(db, organizationId),
      allRows((from, to) => {
        let query = scoped(db.from('leads').select(COLUMNS).eq('organization_id', organizationId), actor)
        if (actor.seeAll && owner === 'none') query = query.is('assigned_to', null)
        else if (actor.seeAll && isUuid(owner)) query = query.eq('assigned_to', owner)
        return query.order('created_at', { ascending: false }).order('id').range(from, to)
      }, { max: 20_000 }),
    ])
    return NextResponse.json({ success: true, range, truncated: leads.truncated, report: pipelineReport(leads.rows, stages, team, rangeBounds(range)) })
  } catch (error) {
    return serverError('report', error)
  }
}
