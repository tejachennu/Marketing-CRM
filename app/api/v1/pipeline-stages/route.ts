import { NextResponse } from 'next/server'
import { apiAuth, apiError } from '@/lib/public-api/auth'
import { pipelineOff, toApiStage } from '@/lib/public-api/leads'
import { loadStages } from '@/lib/pipeline/store'

export const runtime = 'nodejs'

// GET /api/v1/pipeline-stages: the Sales Pipeline's stages, in order
export async function GET(request: Request) {
  const auth = await apiAuth(request, 'leads:read')
  if (!auth.ok) return auth.response
  const off = pipelineOff(auth.ctx.organization)
  if (off) return off
  try {
    return NextResponse.json({ data: (await loadStages(auth.ctx.db, auth.ctx.organizationId)).map(toApiStage) })
  } catch (error: any) {
    console.error('[API stages]', error?.message)
    return apiError(500, 'server_error', 'The stages could not be read. Please try again.')
  }
}
