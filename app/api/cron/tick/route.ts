import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { dispatchDueCampaigns, startWorkerAfterResponse } from '@/lib/campaigns/dispatcher'
import { sendCheckoutReminders } from '@/lib/scheduler/checkout-reminders'
import { expireIdleFlowSessions } from '@/lib/scheduler/flow-sessions'
import { authorizeCronRequest, configuredCronSecret, cronSecretsFromEnv } from '@/lib/scheduler/cron-auth'
import { startWorkerInOwnInvocation } from '@/lib/scheduler/campaign-worker'
import { runJob, type JobReport } from '@/lib/scheduler/run-job'

// Vercel stops the function here; the jobs budget their own time so a tick ends well before it
export const maxDuration = 60
/** When each job must stop starting new work, counted from the start of the tick. */
const CAMPAIGNS_BUDGET_MS = 25 * 1000
// A reminder started just before this may take up to its send timeout (20 s), so the job ends
// by 50 s at the latest, inside the minute
const REMINDERS_BUDGET_MS = 30 * 1000
const EXPIRY_BUDGET_MS = 45 * 1000
const REMINDERS_PER_TICK = 50

/**
 * GET or POST /api/cron/tick: the scheduler's heartbeat, from Vercel Cron (vercel.json) or
 * from Supabase pg_cron (supabase/migrations/20261104_scheduler_pg_cron.sql). Each job is
 * reported on its own, with its duration and error, and one failing never stops the others;
 * a failed job makes the answer a 500, so the scheduler's monitoring shows it.
 *
 * Campaign workers are not run here: a worker started in this invocation would only get what
 * is left of the minute. Each campaign is handed to POST /api/campaigns/run/worker, which
 * runs it in an invocation of its own for as long as the plan allows and pauses cleanly
 * before the end, for the watchdog to resume at the next dispatch.
 */
async function tick(request: NextRequest) {
  const auth = authorizeCronRequest(request.headers, cronSecretsFromEnv())
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
  const startWorker = startWorkerInOwnInvocation({
    origin,
    secret: configuredCronSecret() || '',
    // When the hand-off fails the campaign would otherwise wait for the watchdog, a whole day
    // on a daily schedule; what is left of this minute is better than that
    fallback: (campaignId, context) => startWorkerAfterResponse(campaignId, context, { deadline: startedAt + maxDuration * 1000 }),
  })

  const jobs: Record<string, JobReport> = {}
  jobs.campaigns = await runJob('campaigns', () =>
    dispatchDueCampaigns({ supabase, origin, now, startWorker, deadline: startedAt + CAMPAIGNS_BUDGET_MS })
  )
  // The dispatcher carries on past a failed claim or watchdog query (the dashboard poll wants
  // what did work), but for the scheduler's monitoring those runs failed
  const campaignErrors = Number(jobs.campaigns.errors) || 0
  if (jobs.campaigns.ok && campaignErrors > 0) {
    jobs.campaigns.ok = false
    jobs.campaigns.error = `${campaignErrors} campaign dispatch error(s); see the logs`
  }
  jobs.checkout_reminders = await runJob('checkout_reminders', () =>
    sendCheckoutReminders({ supabase, now, limit: REMINDERS_PER_TICK, deadline: startedAt + REMINDERS_BUDGET_MS })
  )
  jobs.flow_sessions = await runJob('flow_sessions', () =>
    expireIdleFlowSessions({ supabase, now, deadline: startedAt + EXPIRY_BUDGET_MS })
  )

  const ok = Object.values(jobs).every((job) => job.ok)
  // A job that skips (its migration is not applied yet) did its job; it is listed so the gap is visible
  const skipped = Object.keys(jobs).filter((name) => jobs[name].skipped === true)
  return NextResponse.json(
    {
      ok,
      ran_at: now.toISOString(),
      duration_ms: Date.now() - startedAt,
      skipped,
      jobs,
    },
    { status: ok ? 200 : 500 }
  )
}

export const GET = tick
export const POST = tick
