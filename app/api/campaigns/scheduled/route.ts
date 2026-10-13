import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthenticatedUser, verifyRecordAccess } from '@/lib/api-auth-helper'
import { isSuperAdmin } from '@/lib/rbac'
import { runCampaignWorker } from '../run/worker/route'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseKey)
}

function dispatchWorker(campaignId: string, context: string) {
  // `after` keeps the function alive until the worker settles, without blocking the response
  after(() =>
    runCampaignWorker(campaignId).catch((workerErr) => {
      console.error(`[Scheduled Campaigns API] ${context} for campaign ${campaignId}:`, workerErr)
    })
  )
}

/**
 * GET /api/campaigns/scheduled
 * Checks for all campaigns marked SCHEDULED whose scheduled_at timestamp has passed (<= now).
 * Automatically transitions them to PROCESSING and triggers the background campaign worker.
 *
 * The dispatch itself needs no session (so an external scheduler can ping it), but campaign
 * details are only returned to a signed-in caller, limited to their own organization.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseClient()
    const nowIso = new Date().toISOString()
    const viewer = await getAuthenticatedUser(request)
    const canSee = (organizationId: string | null) =>
      !!viewer && (isSuperAdmin(viewer) || viewer.organization_id === organizationId)

    // 1. Fetch campaigns that are scheduled and due for execution
    const { data: dueCampaigns, error: fetchErr } = await supabase
      .from('campaigns')
      .select('id, name, scheduled_at, status, total_contacts, organization_id')
      .eq('status', 'SCHEDULED')
      .lte('scheduled_at', nowIso)
      .order('scheduled_at', { ascending: true })

    if (fetchErr) {
      console.error('[Scheduled Campaigns API] Error fetching due campaigns:', fetchErr)
      return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    }

    let triggeredCount = 0
    const visibleTriggered: Array<{ id: string; name: string; scheduled_at: string }> = []

    // 2. Dispatch worker for each due campaign
    if (dueCampaigns && dueCampaigns.length > 0) {
      console.log(`[Scheduled Campaigns API] Found ${dueCampaigns.length} scheduled campaign(s) due for dispatch.`)

      for (const campaign of dueCampaigns) {
        // Claim the campaign atomically. Every open dashboard polls this endpoint, so
        // only the request that flips SCHEDULED -> PROCESSING may start the worker;
        // otherwise two workers would send the same messages twice.
        const { data: claimed, error: claimErr } = await supabase
          .from('campaigns')
          .update({
            status: 'PROCESSING',
            updated_at: new Date().toISOString()
          })
          .eq('id', campaign.id)
          .eq('status', 'SCHEDULED')
          .select('id')

        if (claimErr || !claimed || claimed.length === 0) continue

        dispatchWorker(campaign.id, 'Execution error')

        triggeredCount++
        if (canSee(campaign.organization_id)) {
          visibleTriggered.push({
            id: campaign.id,
            name: campaign.name,
            scheduled_at: campaign.scheduled_at
          })
        }
      }
    }

    // 2b. Auto-recovery watchdog: Resume campaigns stuck in PENDING or PROCESSING with remaining pending logs
    try {
      const twoMinutesAgoIso = new Date(Date.now() - 2 * 60 * 1000).toISOString()
      const { data: stuckCampaigns } = await supabase
        .from('campaigns')
        .select('id, name, status, updated_at')
        .in('status', ['PENDING', 'PROCESSING'])
        .lte('updated_at', twoMinutesAgoIso)
        .limit(3)

      if (stuckCampaigns && stuckCampaigns.length > 0) {
        for (const stuck of stuckCampaigns) {
          const { count: pendingCount } = await supabase
            .from('campaign_logs')
            .select('id', { count: 'exact', head: true })
            .eq('campaign_id', stuck.id)
            .eq('status', 'PENDING')

          if (pendingCount && pendingCount > 0) {
            // Same atomic claim: the heartbeat must be unchanged since we read it,
            // so a concurrent poll (or a worker that just woke up) cannot double-resume.
            const { data: claimed } = await supabase
              .from('campaigns')
              .update({ status: 'PROCESSING', updated_at: new Date().toISOString() })
              .eq('id', stuck.id)
              .eq('status', stuck.status)
              .eq('updated_at', stuck.updated_at)
              .select('id')

            if (!claimed || claimed.length === 0) continue

            console.log(`[Scheduled Campaigns API] Watchdog resuming stuck campaign ${stuck.name} (${stuck.id}) with ${pendingCount} pending logs.`)
            dispatchWorker(stuck.id, 'Failed to resume stuck campaign')
          }
        }
      }
    } catch (watchdogErr) {
      console.warn('[Scheduled Campaigns API] Watchdog check encountered non-fatal error:', watchdogErr)
    }

    // 3. Fetch upcoming scheduled campaigns for status display (signed-in callers only)
    let upcomingCampaigns: any[] = []
    if (viewer) {
      let upcomingQuery = supabase
        .from('campaigns')
        .select('id, name, scheduled_at, total_contacts, channel')
        .eq('status', 'SCHEDULED')
        .gt('scheduled_at', nowIso)
        .order('scheduled_at', { ascending: true })
        .limit(10)

      if (!isSuperAdmin(viewer)) {
        upcomingQuery = upcomingQuery.eq('organization_id', viewer.organization_id)
      }

      const { data } = await upcomingQuery
      upcomingCampaigns = data || []
    }

    return NextResponse.json({
      success: true,
      timestamp: nowIso,
      triggeredCount,
      triggeredCampaigns: visibleTriggered,
      upcomingCount: upcomingCampaigns.length,
      upcomingCampaigns
    })
  } catch (error: any) {
    console.error('[Scheduled Campaigns API] Handler failure:', error)
    return NextResponse.json({ error: error.message || 'Failed to check scheduled campaigns' }, { status: 500 })
  }
}

/**
 * POST /api/campaigns/scheduled
 * Allows manual action on a scheduled campaign (e.g., 'send_now' or 'cancel_schedule')
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { campaignId, action } = body

    if (!campaignId) {
      return NextResponse.json({ error: 'Campaign ID is required' }, { status: 400 })
    }

    if (action !== 'send_now' && action !== 'cancel_schedule') {
      return NextResponse.json({ error: 'Unknown action. Supported: send_now, cancel_schedule' }, { status: 400 })
    }

    const authResult = await verifyRecordAccess(request, 'campaigns', campaignId, { permission: 'campaigns.manage' })
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseClient()

    // Both actions only apply while the campaign is still waiting on its schedule.
    // The status guard makes a double click (or a race with the scheduler) a no-op.
    const { data: updated, error: updateErr } = await supabase
      .from('campaigns')
      .update({
        status: action === 'send_now' ? 'PROCESSING' : 'STOPPED',
        updated_at: new Date().toISOString()
      })
      .eq('id', campaignId)
      .eq('status', 'SCHEDULED')
      .select('id')

    if (updateErr) throw updateErr

    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { error: 'This campaign is no longer scheduled. It may have already started or been cancelled.' },
        { status: 409 }
      )
    }

    if (action === 'send_now') {
      dispatchWorker(campaignId, 'Immediate dispatch error')

      return NextResponse.json({
        success: true,
        message: 'Campaign dispatched immediately.'
      })
    }

    return NextResponse.json({
      success: true,
      message: 'Scheduled campaign cancelled successfully.'
    })
  } catch (error: any) {
    console.error('[Scheduled API] Action error:', error)
    return NextResponse.json({ error: error.message || 'Action failure' }, { status: 500 })
  }
}
