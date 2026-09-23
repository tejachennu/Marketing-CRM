import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOrgAccess } from '@/lib/api-auth-helper'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseKey)
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('organizationId')
    const campaignIdsParam = searchParams.get('campaignIds')

    if (!orgId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, orgId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    if (!campaignIdsParam) {
      return NextResponse.json({ success: true, participantsByCampaign: {} })
    }

    const campaignIds = campaignIdsParam.split(',').map(id => id.trim()).filter(Boolean)
    if (campaignIds.length === 0) {
      return NextResponse.json({ success: true, participantsByCampaign: {} })
    }

    const supabase = getSupabaseClient()
    const { data: logs, error } = await supabase
      .from('campaign_logs')
      .select('campaign_id, phone_number, email_address')
      .in('campaign_id', campaignIds)

    if (error) throw error

    const participantsByCampaign: Record<string, string[]> = {}
    for (const id of campaignIds) {
      participantsByCampaign[id] = []
    }

    for (const log of logs || []) {
      if (!participantsByCampaign[log.campaign_id]) {
        participantsByCampaign[log.campaign_id] = []
      }
      if (log.phone_number) {
        participantsByCampaign[log.campaign_id].push(log.phone_number)
      }
      if (log.email_address) {
        participantsByCampaign[log.campaign_id].push(log.email_address)
      }
    }

    return NextResponse.json({
      success: true,
      participantsByCampaign
    })
  } catch (err: any) {
    console.error('[API] Error fetching campaign participants:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to fetch campaign participants' },
      { status: 500 }
    )
  }
}
