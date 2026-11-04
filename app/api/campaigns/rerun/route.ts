import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyRecordAccess } from '@/lib/api-auth-helper'
import { RESUME_REQUESTED_AT, SENDING_RESET_AFTER_MS, workerDeadline } from '@/lib/scheduler/campaign-worker'
import { runCampaignWorker } from '../run/worker/route'

// The rerun's worker runs in this invocation: it gets as long as Vercel allows, and pauses
// before the end for the watchdog to resume, instead of being cut off mid-batch
export const maxDuration = 300

/**
 * Whether the campaign's SENDING logs may be given back to PENDING: only when no worker can
 * still be sending them, by the watchdog's own rule (lib/campaigns/dispatcher.ts). Otherwise a
 * worker that is finishing its batch after a Stop would send them, and the rerun's worker again.
 * Recent ones are left to that worker; if it died, the watchdog returns them later.
 */
function inFlightLogsAreStale(campaign: { updated_at?: string | null }, now: number): boolean {
  const heartbeat = Date.parse(campaign.updated_at || '')
  if (Number.isNaN(heartbeat)) return true
  // A paused worker settled its own batch; what is still SENDING belongs to another one
  if (heartbeat === Date.parse(RESUME_REQUESTED_AT)) return false
  return heartbeat <= now - SENDING_RESET_AFTER_MS
}

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseKey)
}

export async function POST(request: NextRequest) {
  const deadline = workerDeadline(maxDuration)
  try {
    const { campaignId, rerunType } = await request.json()
    if (!campaignId) {
      return NextResponse.json({ error: 'Campaign ID is required' }, { status: 400 })
    }

    const authResult = await verifyRecordAccess(request, 'campaigns', campaignId, { permission: 'campaigns.manage' })
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseClient()

    // Fetch campaign
    const { data: campaign, error: fetchErr } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .single()

    if (fetchErr || !campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    const mode = rerunType === 'all' ? 'all' : 'failed_only'
    const keepInFlight = !inFlightLogsAreStale(campaign, Date.now())

    if (mode === 'all') {
      // Reset all recipient logs to PENDING (but messages a worker may be sending right now)
      let resetAll = supabase
        .from('campaign_logs')
        .update({
          status: 'PENDING',
          error_message: null,
          message_sid: null
        })
        .eq('campaign_id', campaignId)
      if (keepInFlight) resetAll = resetAll.neq('status', 'SENDING')
      await resetAll

      // Reset campaign counts and status to PENDING
      await supabase
        .from('campaigns')
        .update({
          status: 'PENDING',
          sent_count: 0,
          failed_count: 0,
          updated_at: new Date().toISOString()
        })
        .eq('id', campaignId)
    } else {
      // Rerun failed or un-sent logs: reset logs where status is not SENT, DELIVERED, or READ
      // (nor SENDING, while a worker may still be sending them)
      await supabase
        .from('campaign_logs')
        .update({
          status: 'PENDING',
          error_message: null,
          message_sid: null
        })
        .eq('campaign_id', campaignId)
        .not('status', 'in', keepInFlight ? '("SENT","DELIVERED","READ","SENDING")' : '("SENT","DELIVERED","READ")')

      // Recalculate current sent count
      const { count: actualSentCount } = await supabase
        .from('campaign_logs')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .in('status', ['SENT', 'DELIVERED', 'READ'])

      // Reset campaign status to PENDING
      await supabase
        .from('campaigns')
        .update({
          status: 'PENDING',
          sent_count: actualSentCount || 0,
          failed_count: 0,
          updated_at: new Date().toISOString()
        })
        .eq('id', campaignId)
    }

    // Trigger asynchronous campaign execution once the response has been sent
    after(() =>
      runCampaignWorker(campaignId, { deadline }).catch(err => {
        console.error('[Campaign Rerun API] Error running worker:', err)
      })
    )

    return NextResponse.json({
      success: true,
      message: `Campaign restarted (${mode === 'all' ? 'Full Rerun' : 'Rerun Remaining/Failed'}).`
    })
  } catch (error: any) {
    console.error('[Campaign Rerun API] Error restarting campaign:', error)
    return NextResponse.json({ error: error.message || 'Failed to rerun campaign' }, { status: 500 })
  }
}
