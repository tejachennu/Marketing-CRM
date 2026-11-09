import { NextRequest, NextResponse } from 'next/server'
import { pipelineAccess, permissionsOf, serverError, teamOf } from '@/lib/pipeline/server'
import { loadStages, pipelineCounts } from '@/lib/pipeline/store'

export const runtime = 'nodejs'

// GET ?organizationId: what the Sales Pipeline screens need first: stages, the team, the currency,
// what this person may do, and the counts (open deals, follow-ups due)
export async function GET(request: NextRequest) {
  const access = await pipelineAccess(request, new URL(request.url).searchParams.get('organizationId'))
  if (!access.ok) return access.response
  const { db, organizationId, user, actor, currency } = access.ctx
  try {
    const [stages, team, counts] = await Promise.all([loadStages(db, organizationId), teamOf(db, organizationId), pipelineCounts(actor)])
    return NextResponse.json({
      success: true,
      stages: stages.map((s: any) => ({ id: s.id, name: s.name, position: s.position })),
      team,
      currency,
      me: permissionsOf(user),
      counts,
    })
  } catch (error) {
    return serverError('bootstrap', error)
  }
}
