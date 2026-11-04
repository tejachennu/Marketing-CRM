/**
 * Starts scheduled campaigns and resumes stuck ones. Shared by the dashboard's 25-second poll
 * (GET /api/campaigns/scheduled) and the cron tick (GET /api/cron/tick), so campaigns go out
 * whether or not someone has the Campaigns page open.
 */
import { after } from 'next/server'
import { runCampaignWorker } from '@/app/api/campaigns/run/worker/route'

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
  /** Database errors met on the way; they are reported and stop nothing else. */
  errors: number
  /** The claimed campaigns, for callers that show them (the dashboard poll). */
  campaigns: DispatchedCampaign[]
}

/** Starts a campaign's worker in the background; `context` names the step for the error log. */
export type StartWorker = (campaignId: string, context: string) => void

/**
 * Run the worker after the response is sent. `after` keeps the serverless function alive
 * until the worker settles; a bare floating promise can be frozen as soon as the response
 * returns.
 */
export function startWorkerAfterResponse(campaignId: string, context: string): void {
  after(() =>
    runCampaignWorker(campaignId).catch((workerErr) => {
      console.error(`[Campaign Dispatcher] ${context} for campaign ${campaignId}:`, workerErr)
    })
  )
}

/** A worker whose heartbeat (updated_at) is older than this has died; its campaign is resumed. */
const STUCK_AFTER_MS = 2 * 60 * 1000
/** Resumes per call, so one request never starts more workers than it can carry. */
const MAX_RESUMES = 3

/**
 * Start every campaign whose scheduled time has passed, then resume campaigns whose worker
 * died with messages still pending. Safe to run from several places at once: each campaign
 * is claimed with a conditional update, so only one caller starts its worker.
 */
export async function dispatchDueCampaigns({
  supabase,
  origin,
  now = new Date(),
  startWorker = startWorkerAfterResponse,
}: {
  supabase: Database
  /** Where this dispatch runs, for the log lines; the worker itself runs in this process. */
  origin?: string
  now?: Date
  startWorker?: StartWorker
}): Promise<DispatchResult> {
  const result: DispatchResult = { claimed: 0, restarted: 0, errors: 0, campaigns: [] }
  const where = origin ? ` (${origin})` : ''

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

      startWorker(campaign.id, 'Execution error')
      result.claimed++
      result.campaigns.push({
        id: campaign.id,
        name: campaign.name,
        scheduled_at: campaign.scheduled_at,
        organization_id: campaign.organization_id ?? null
      })
    }
  }

  // 2. Watchdog: resume campaigns stuck in PENDING or PROCESSING with pending logs left
  try {
    const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MS).toISOString()
    const { data: stuckCampaigns, error: stuckErr } = await supabase
      .from('campaigns')
      .select('id, name, status, updated_at')
      .in('status', ['PENDING', 'PROCESSING'])
      .lte('updated_at', stuckBefore)
      .limit(MAX_RESUMES)
    if (stuckErr) throw stuckErr

    for (const stuck of stuckCampaigns || []) {
      const { count: pendingCount } = await supabase
        .from('campaign_logs')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', stuck.id)
        .eq('status', 'PENDING')

      if (!pendingCount || pendingCount <= 0) continue

      // Same atomic claim: the heartbeat must be unchanged since we read it, so a concurrent
      // poll (or a worker that just woke up) cannot double-resume.
      const { data: claimed } = await supabase
        .from('campaigns')
        .update({ status: 'PROCESSING', updated_at: now.toISOString() })
        .eq('id', stuck.id)
        .eq('status', stuck.status)
        .eq('updated_at', stuck.updated_at)
        .select('id')

      if (!claimed || claimed.length === 0) continue

      console.log(`[Campaign Dispatcher] Watchdog resuming stuck campaign ${stuck.name} (${stuck.id}) with ${pendingCount} pending logs${where}.`)
      startWorker(stuck.id, 'Failed to resume stuck campaign')
      result.restarted++
    }
  } catch (watchdogErr) {
    console.warn('[Campaign Dispatcher] Watchdog check encountered non-fatal error:', watchdogErr)
    result.errors++
  }

  return result
}
