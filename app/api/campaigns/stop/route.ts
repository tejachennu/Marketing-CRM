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
    const { campaignId } = await request.json()
    if (!campaignId) {
      return NextResponse.json({ error: 'Campaign ID is required' }, { status: 400 })
    }

    const supabase = getSupabaseClient()

    // Fetch campaign to verify ownership
    const { data: campaign, error: fetchErr } = await supabase
      .from('campaigns')
      .select('id, organization_id, status')
      .eq('id', campaignId)
      .single()

    if (fetchErr || !campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    // Update status to STOPPED
    const { error: updateErr } = await supabase
      .from('campaigns')
      .update({
        status: 'STOPPED',
        updated_at: new Date().toISOString()
      })
      .eq('id', campaignId)

    if (updateErr) throw updateErr

    return NextResponse.json({
      success: true,
      message: 'Campaign has been stopped successfully.'
    })
  } catch (error: any) {
    console.error('[Campaign Stop API] Error stopping campaign:', error)
    return NextResponse.json({ error: error.message || 'Failed to stop campaign' }, { status: 500 })
  }
}
