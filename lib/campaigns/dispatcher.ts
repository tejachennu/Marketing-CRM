/**
 * Starts scheduled campaigns and resumes stuck ones. Shared by the dashboard's 25-second poll
 * (GET /api/campaigns/scheduled) and the cron tick (GET /api/cron/tick), so campaigns go out
 * whether or not someone has the Campaigns page open.
 */
import { after } from 'next/server'
import { runCampaignWorker } from '@/app/api/campaigns/run/worker/route'
import { RESUME_REQUESTED_AT, SENDING_RESET_AFTER_MS } from '@/lib/scheduler/campaign-worker'

type Database = any

export interface DispatchedCampaign {
  id: string
  name: string
  scheduled_at: string
  organization_id: string | null
}

export interface DispatchResult {
  /** Due campaigns this call moved from SCHEDULED to PROCESSING and started. */
  claimed: number
  /** Campaigns whose worker had stopped with messages still pending, started again. */
  restarted: number
  /** Stuck campaigns with nothing left to send, closed as COMPLETED (their worker died before it could). */
  finished?: number
  /** Database errors met on the way, and workers that could not be started; they are reported and stop nothing else. */
  errors: number
  /** The claimed campaigns, for callers that show them (the dashboard poll). */
  campaigns: DispatchedCampaign[]
  /** The run stopped early because its time was up; what is left waits for the next call. */
  out_of_time?: true
}

/**
 * Starts a campaign's worker; `context` names the step for the error log. It may run the
 * worker in the background of this invocation or hand it to another one; either way it
 * settles once the worker is on its way, and throws when it could not be started.
 */
export type StartWorker = (campaignId: string, context: string) => void | Promise<void>

/**
 * Run the worker after the response is sent. `after` keeps the serverless function alive
 * until the worker settles; a bare floating promise can be frozen as soon as the response
 * returns. `deadline` (a Date.now() value) is when this invocation ends: the worker pauses
 * before it and the watchdog resumes the campaign.
 */
export function startWorkerAfterResponse(campaignId: string, context: string, options: { deadline?: number } = {}): void {
  after(() =>
    runCampaignWorker(campaignId, { deadline: options.deadline }).catch((workerErr) => {
      console.error(`[Campaign Dispatcher] ${context} for campaign ${campaignId}:`, workerErr)
    })
  )
}

/** A worker whose heartbeat (updated_at) is older than this has died; its campaign is resumed. */
const STUCK_AFTER_MS = 2 * 60 * 1000
/** Resumes per call, so one request never starts more workers than it can carry. */
const MAX_RESUMES = 3
/**
 * Stuck campaigns looked at per call, oldest heartbeat first. More than are resumed, so a
 * campaign with nothing left to send cannot keep one with pending messages waiting.
 */
const MAX_EXAMINED = 10

/**
 * Start every campaign whose scheduled time has passed, then resume campaigns whose worker
 * died with messages still pending. Safe to run from several places at once: each campaign
 * is claimed with a conditional update, so only one caller starts its worker.
 * `deadline` (a Date.now() value) is when the call must stop claiming; the rest waits.
 */
export async function dispatchDueCampaigns({
  supabase,
  origin,
  now = new Date(),
  startWorker = startWorkerAfterResponse,
  deadline,
}: {
  supabase: Database
  /** Where this dispatch runs, for the log lines; the worker itself runs in this process. */
  origin?: string
  now?: Date
  startWorker?: StartWorker
  deadline?: number
}): Promise<DispatchResult> {
  const result: DispatchResult = { claimed: 0, restarted: 0, errors: 0, campaigns: [] }
  const where = origin ? ` (${origin})` : ''
  const outOfTime = () => {
    if (!deadline || Date.now() < deadline) return false
    result.out_of_time = true
    return true
  }

  // A worker that cannot be started leaves its campaign PROCESSING with a fresh heartbeat; the
  // watchdog takes it up again a couple of minutes later, here or from the dashboard poll
  const start = async (campaignId: string, context: string): Promise<void> => {
    try {
      await startWorker(campaignId, context)
    } catch (startErr) {
      console.error(`[Campaign Dispatcher] ${context}: could not start the worker for campaign ${campaignId}:`, startErr)
      result.errors++
    }
  }

  // 1. Campaigns that are scheduled and due
  const { data: dueCampaigns, error: fetchErr } = await supabase
    .from('campaigns')
    .select('id, name, scheduled_at, status, total_contacts, organization_id')
    .eq('status', 'SCHEDULED')
    .lte('scheduled_at', now.toISOString())
    .order('scheduled_at', { ascending: true })

  if (fetchErr) {
    console.error('[Campaign Dispatcher] Error fetching due campaigns:', fetchErr)
    throw new Error(fetchErr.message || 'Failed to fetch due campaigns')
  }

  if (dueCampaigns && dueCampaigns.length > 0) {
    console.log(`[Campaign Dispatcher] Found ${dueCampaigns.length} scheduled campaign(s) due for dispatch${where}.`)

    for (const campaign of dueCampaigns) {
      if (outOfTime()) break

      // Claim the campaign atomically. Every open dashboard polls, and the cron tick runs
      // as well, so only the request that flips SCHEDULED -> PROCESSING may start the
      // worker; otherwise two workers would send the same messages twice.
      const { data: claimed, error: claimErr } = await supabase
        .from('campaigns')
        .update({
          status: 'PROCESSING',
          updated_at: now.toISOString()
        })
        .eq('id', campaign.id)
        .eq('status', 'SCHEDULED')
        .select('id')

      if (claimErr) {
        console.error(`[Campaign Dispatcher] Could not claim campaign ${campaign.id}:`, claimErr)
        result.errors++
        continue
      }
      if (!claimed || claimed.length === 0) continue // another caller got there first

      await start(campaign.id, 'Execution error')
      result.claimed++
      result.campaigns.push({
        id: campaign.id,
        name: campaign.name,
        scheduled_at: campaign.scheduled_at,
        organization_id: campaign.organization_id ?? null
      })
    }
  }

  // 2. Watchdog: resume campaigns stuck in PENDING or PROCESSING with pending logs left.
  //    Oldest heartbeat first, which puts a worker that paused on purpose (heartbeat at the
  //    epoch, lib/scheduler/campaign-worker.ts) ahead of everything else.
  // Only the query below aborts the watchdog; each campaign is handled on its own further down.
  let stuckCampaigns: { id: string; name: string; status: string; updated_at: string }[] = []
  try {
    const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MS).toISOString()
    const { data, error: stuckErr } = await supabase
      .from('campaigns')
      .select('id, name, status, updated_at')
      .in('status', ['PENDING', 'PROCESSING'])
      .lte('updated_at', stuckBefore)
      .order('updated_at', { ascending: true })
      .limit(MAX_EXAMINED)
    if (stuckErr) throw stuckErr
    stuckCampaigns = data || []
  } catch (watchdogErr) {
    console.warn('[Campaign Dispatcher] Watchdog check encountered non-fatal error:', watchdogErr)
    result.errors++
    return result
  }

  const resetBefore = now.getTime() - SENDING_RESET_AFTER_MS
  const resumeRequested = Date.parse(RESUME_REQUESTED_AT)
  const countLogs = async (campaignId: string, statuses: string[]): Promise<number> => {
    const { count, error } = await supabase
      .from('campaign_logs')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .in('status', statuses)
    if (error) throw error
    return count || 0
  }

  for (const stuck of stuckCampaigns) {
    if (result.restarted >= MAX_RESUMES || outOfTime()) break
    // A failed query or write on one campaign (a statement timeout on a very large one, a
    // held lock) is counted and logged, and the watchdog moves on: the oldest heartbeat sorts
    // first, so aborting here would leave every campaign behind it unattended on every call.
    try {
      const heartbeat = Date.parse(stuck.updated_at)
      // A worker that paused on purpose leaves the epoch: it settled its own batch first, so any
      // log still SENDING belongs to another worker that may be alive, whatever the heartbeat says
      const pausedOnPurpose = heartbeat === resumeRequested

      // Logs claimed by a worker that was killed mid-batch (before Meta or Twilio answered)
      // go back to PENDING, so the resumed worker sends them. Only once the heartbeat is old
      // enough that no worker can still be busy with them.
      if (heartbeat <= resetBefore && !pausedOnPurpose) {
        const { data: reset, error: resetErr } = await supabase
          .from('campaign_logs')
          .update({ status: 'PENDING' })
          .eq('campaign_id', stuck.id)
          .eq('status', 'SENDING')
          .select('id')
        if (resetErr) throw resetErr
        if (reset && reset.length > 0) {
          console.warn(`[Campaign Dispatcher] Watchdog returned ${reset.length} unsettled log(s) of campaign ${stuck.name} (${stuck.id}) to PENDING${where}.`)
        }
      }

      // Every write below is guarded on the heartbeat read above, so a concurrent poll (or a
      // worker that just woke up, or a Stop) is never overwritten.
      const guarded = (values: Record<string, unknown>) => supabase
        .from('campaigns')
        .update(values)
        .eq('id', stuck.id)
        .eq('status', stuck.status)
        .eq('updated_at', stuck.updated_at)
        .select('id')

      const pendingCount = await countLogs(stuck.id, ['PENDING'])
      if (pendingCount <= 0) {
        const sendingCount = await countLogs(stuck.id, ['SENDING'])
        if (sendingCount > 0) {
          // Another worker's logs, or a dead one's that are not old enough to give back yet. A
          // paused campaign gets a real heartbeat now, so they are given back ten minutes from
          // now if nobody settles them, and it stops sorting ahead of everything else.
          if (pausedOnPurpose) {
            const { error: bumpErr } = await guarded({ updated_at: now.toISOString() })
            if (bumpErr) throw bumpErr
          }
          continue
        }
        // Nothing left to send: the worker died before it could close the campaign. Left as it
        // is, it would keep its old heartbeat and hold a place among the campaigns examined.
        const [sentCount, failedCount] = await Promise.all([countLogs(stuck.id, ['SENT', 'DELIVERED', 'READ']), countLogs(stuck.id, ['FAILED'])])
        const { data: closed, error: closeErr } = await guarded({ status: 'COMPLETED', sent_count: sentCount, failed_count: failedCount, updated_at: now.toISOString() })
        if (closeErr) throw closeErr
        if (closed && closed.length > 0) {
          result.finished = (result.finished || 0) + 1
          console.warn(`[Campaign Dispatcher] Watchdog closed campaign ${stuck.name} (${stuck.id}) as COMPLETED: nothing left to send${where}.`)
        }
        continue
      }

      // Same atomic claim: the heartbeat must be unchanged since we read it, so a concurrent
      // poll (or a worker that just woke up) cannot double-resume.
      const { data: claimed, error: resumeErr } = await guarded({ status: 'PROCESSING', updated_at: now.toISOString() })
      if (resumeErr) throw resumeErr
      if (!claimed || claimed.length === 0) continue

      console.log(`[Campaign Dispatcher] Watchdog resuming stuck campaign ${stuck.name} (${stuck.id}) with ${pendingCount} pending logs${where}.`)
      await start(stuck.id, 'Failed to resume stuck campaign')
      result.restarted++
    } catch (campaignErr) {
      console.warn(`[Campaign Dispatcher] Watchdog could not handle campaign ${stuck.name} (${stuck.id})${where}:`, campaignErr)
      result.errors++
    }
  }

  return result
}
