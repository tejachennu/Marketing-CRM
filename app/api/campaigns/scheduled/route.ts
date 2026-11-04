import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthenticatedUser, verifyRecordAccess } from '@/lib/api-auth-helper'
import { isSuperAdmin } from '@/lib/rbac'
import { dispatchDueCampaigns, startWorkerAfterResponse } from '@/lib/campaigns/dispatcher'
import { workerDeadline } from '@/lib/scheduler/campaign-worker'

// Workers started here (claims, resumes and "send now") run in this invocation, so it gets as
// long as Vercel allows, and each worker is told when it ends: it pauses cleanly before then
// instead of being cut off mid-batch with messages already accepted but still marked SENDING
export const maxDuration = 300

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseKey)
}

/**
 * GET /api/campaigns/scheduled
 * Starts every campaign marked SCHEDULED whose scheduled_at timestamp has passed (<= now) and
 * resumes campaigns whose worker stopped. The work lives in lib/campaigns/dispatcher.ts, which
 * the cron tick (/api/cron/tick) runs as well; the Campaigns page keeps polling this route every
 * 25 seconds, so campaigns also go out promptly while someone is looking.
 *
 * The dispatch itself needs no session (so an external scheduler can ping it), but campaign
 * details are only returned to a signed-in caller, limited to their own organization.
 */
export async function GET(request: NextRequest) {
  // First, so the time spent below counts against it
  const deadline = workerDeadline(maxDuration)
  try {
    const supabase = getSupabaseClient()
    const now = new Date()
    const nowIso = now.toISOString()
    const viewer = await getAuthenticatedUser(request)
    const canSee = (organizationId: string | null) =>
      !!viewer && (isSuperAdmin(viewer) || viewer.organization_id === organizationId)

    // 1. Start due campaigns and resume stuck ones
    const dispatched = await dispatchDueCampaigns({
      supabase,
      origin: new URL(request.url).origin,
      now,
      deadline,
      startWorker: (campaignId, context) => startWorkerAfterResponse(campaignId, context, { deadline }),
    })
    const visibleTriggered = dispatched.campaigns
      .filter((campaign) => canSee(campaign.organization_id))
      .map(({ id, name, scheduled_at }) => ({ id, name, scheduled_at }))

    // 2. Fetch upcoming scheduled campaigns for status display (signed-in callers only)
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
      triggeredCount: dispatched.claimed,
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
  const deadline = workerDeadline(maxDuration)
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
      startWorkerAfterResponse(campaignId, 'Immediate dispatch error', { deadline })

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
