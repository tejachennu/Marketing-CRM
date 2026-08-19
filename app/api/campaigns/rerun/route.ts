import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseKey)
}

export async function POST(request: NextRequest) {
  try {
    const { campaignId, rerunType } = await request.json()
    if (!campaignId) {
      return NextResponse.json({ error: 'Campaign ID is required' }, { status: 400 })
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

    if (mode === 'all') {
      // Reset all recipient logs to PENDING
      await supabase
        .from('campaign_logs')
        .update({
          status: 'PENDING',
          error_message: null,
          message_sid: null
        })
        .eq('campaign_id', campaignId)

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
      // Rerun failed or un-sent logs: reset logs where status != SENT
      await supabase
        .from('campaign_logs')
        .update({
          status: 'PENDING',
          error_message: null,
          message_sid: null
        })
        .eq('campaign_id', campaignId)
        .neq('status', 'SENT')

      // Recalculate current sent count
      const { count: actualSentCount } = await supabase
        .from('campaign_logs')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .eq('status', 'SENT')

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

    // Trigger asynchronous campaign execution
    const origin = request.nextUrl.origin
    fetch(`${origin}/api/campaigns/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaignId })
    }).catch(err => console.error('[Campaign Rerun API] Error triggering campaign run:', err))

    return NextResponse.json({
      success: true,
      message: `Campaign restarted (${mode === 'all' ? 'Full Rerun' : 'Rerun Remaining/Failed'}).`
    })
  } catch (error: any) {
    console.error('[Campaign Rerun API] Error restarting campaign:', error)
    return NextResponse.json({ error: error.message || 'Failed to rerun campaign' }, { status: 500 })
  }
}
