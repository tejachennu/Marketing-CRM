import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { dispatchDueCampaigns } from '@/lib/campaigns/dispatcher'
import { sendCheckoutReminders } from '@/lib/scheduler/checkout-reminders'
import { expireIdleFlowSessions } from '@/lib/scheduler/flow-sessions'
import { authorizeCronRequest } from '@/lib/scheduler/cron-auth'
import { runJob, type JobReport } from '@/lib/scheduler/run-job'

// Vercel stops the function here; the jobs budget their own time so a tick ends well before it
export const maxDuration = 60
/** When each job must stop starting new work, counted from the start of the tick. */
const REMINDERS_BUDGET_MS = 35 * 1000
const EXPIRY_BUDGET_MS = 45 * 1000
const REMINDERS_PER_TICK = 50

/**
 * GET or POST /api/cron/tick: the scheduler's heartbeat, every 10 minutes from Vercel Cron
 * (vercel.json) or from Supabase pg_cron (supabase/migrations/20261104_scheduler_pg_cron.sql).
 * Each job is reported on its own, with its duration and error, and one failing never stops
 * the others. Campaign workers started here keep running after the response, within
 * maxDuration; a campaign cut off by the limit is resumed by a later tick.
 */
async function tick(request: NextRequest) {
  const auth = authorizeCronRequest(request.headers, process.env.CRON_SECRET)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let supabase
  try {
    supabase = getSupabaseAdminClient()
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Supabase is not configured' }, { status: 503 })
  }

  const startedAt = Date.now()
  const now = new Date(startedAt)
  const origin = new URL(request.url).origin

  const jobs: Record<string, JobReport> = {}
  jobs.campaigns = await runJob('campaigns', () => dispatchDueCampaigns({ supabase, origin, now }))
  jobs.checkout_reminders = await runJob('checkout_reminders', () =>
    sendCheckoutReminders({ supabase, now, limit: REMINDERS_PER_TICK, deadline: startedAt + REMINDERS_BUDGET_MS })
  )
  jobs.flow_sessions = await runJob('flow_sessions', () =>
    expireIdleFlowSessions({ supabase, now, deadline: startedAt + EXPIRY_BUDGET_MS })
  )

  return NextResponse.json({
    ok: Object.values(jobs).every((job) => job.ok),
    ran_at: now.toISOString(),
    duration_ms: Date.now() - startedAt,
    jobs,
  })
}

export const GET = tick
export const POST = tick
