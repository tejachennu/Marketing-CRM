import { NextRequest, NextResponse } from 'next/server'
import { runSalonJobs } from '@/lib/salon/jobs'
import { salonAccess, serverError } from '@/lib/salon/server'

export const runtime = 'nodejs'
export const maxDuration = 60

// POST { organizationId }: send what is due (feedback questions, reminders). The open counter calls this every couple of minutes.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId)
  if (!access.ok) return access.response
  try {
    const result = await runSalonJobs(access.ctx.db, access.ctx.organizationId)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    return serverError('tick', error)
  }
}
