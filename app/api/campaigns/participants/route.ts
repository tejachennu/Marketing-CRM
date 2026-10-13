import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOrgAccess } from '@/lib/api-auth-helper'
import { isUuid } from '@/lib/record-visibility'

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

    const authResult = await verifyOrgAccess(request, orgId, { permission: 'records.view_all' })
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

    if (campaignIds.length > 50) {
      return NextResponse.json({ error: 'Select at most 50 campaigns at a time' }, { status: 400 })
    }
    if (!campaignIds.every(isUuid)) {
      return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 })
    }

    const supabase = getSupabaseClient()

    // Only campaigns that belong to this organization: the ids come from the request
    const { data: ownCampaigns, error: ownError } = await supabase
      .from('campaigns')
      .select('id')
      .eq('organization_id', orgId)
      .in('id', campaignIds)
    if (ownError) throw ownError
    const ownIds = (ownCampaigns || []).map((c: any) => c.id)

    const participantsByCampaign: Record<string, string[]> = {}
    for (const id of ownIds) {
      participantsByCampaign[id] = []
    }

    // A request returns at most 1,000 rows, so the logs are read page by page.
    // Stopping at the first page silently dropped everyone after the 1,000th recipient.
    const PAGE_SIZE = 1000
    const MAX_ROWS = 300000
    for (let from = 0; ownIds.length > 0 && from < MAX_ROWS; from += PAGE_SIZE) {
      const { data: logs, error } = await supabase
        .from('campaign_logs')
        .select('campaign_id, phone_number, email_address')
        .in('campaign_id', ownIds)
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1)

      if (error) throw error

      for (const log of logs || []) {
        const list = participantsByCampaign[log.campaign_id]
        if (!list) continue
        if (log.phone_number) list.push(log.phone_number)
        if (log.email_address) list.push(log.email_address)
      }
      if (!logs || logs.length < PAGE_SIZE) break
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
