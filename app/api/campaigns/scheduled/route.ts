import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runCampaignWorker } from '../run/worker/route'

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
 * Checks for all campaigns marked SCHEDULED whose scheduled_at timestamp has passed (<= now).
 * Automatically transitions them to PROCESSING and triggers the background campaign worker.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseClient()
    const nowIso = new Date().toISOString()

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

    const processedCampaigns: Array<{ id: string; name: string; scheduled_at: string }> = []

    // 2. Dispatch worker for each due campaign
    if (dueCampaigns && dueCampaigns.length > 0) {
      console.log(`[Scheduled Campaigns API] Found ${dueCampaigns.length} scheduled campaign(s) due for dispatch.`)

      for (const campaign of dueCampaigns) {
        // Mark status as PROCESSING immediately to prevent duplicate triggers
        await supabase
          .from('campaigns')
          .update({
            status: 'PROCESSING',
            updated_at: new Date().toISOString()
          })
          .eq('id', campaign.id)

        // Launch worker in background without blocking response
        runCampaignWorker(campaign.id).catch((workerErr) => {
          console.error(`[Scheduled Campaigns API] Execution error for campaign ${campaign.id}:`, workerErr)
        })

        processedCampaigns.push({
          id: campaign.id,
          name: campaign.name,
          scheduled_at: campaign.scheduled_at
        })
      }
    }

    // 3. Fetch upcoming scheduled campaigns for status display
    const { data: upcomingCampaigns } = await supabase
      .from('campaigns')
      .select('id, name, scheduled_at, total_contacts, channel')
      .eq('status', 'SCHEDULED')
      .gt('scheduled_at', nowIso)
      .order('scheduled_at', { ascending: true })
      .limit(10)

    return NextResponse.json({
      success: true,
      timestamp: nowIso,
      triggeredCount: processedCampaigns.length,
      triggeredCampaigns: processedCampaigns,
      upcomingCount: upcomingCampaigns?.length || 0,
      upcomingCampaigns: upcomingCampaigns || []
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

    const supabase = getSupabaseClient()

    if (action === 'send_now') {
      // Transition from SCHEDULED to PROCESSING immediately
      await supabase
        .from('campaigns')
        .update({
          status: 'PROCESSING',
          updated_at: new Date().toISOString()
        })
        .eq('id', campaignId)

      runCampaignWorker(campaignId).catch((err) => {
        console.error(`[Scheduled API] Immediate dispatch error for ${campaignId}:`, err)
      })

      return NextResponse.json({
        success: true,
        message: 'Campaign dispatched immediately.'
      })
    } else if (action === 'cancel_schedule') {
      await supabase
        .from('campaigns')
        .update({
          status: 'STOPPED',
          updated_at: new Date().toISOString()
        })
        .eq('id', campaignId)

      return NextResponse.json({
        success: true,
        message: 'Scheduled campaign cancelled successfully.'
      })
    }

    return NextResponse.json({ error: 'Unknown action. Supported: send_now, cancel_schedule' }, { status: 400 })
  } catch (error: any) {
    console.error('[Scheduled API] Action error:', error)
    return NextResponse.json({ error: error.message || 'Action failure' }, { status: 500 })
  }
}
