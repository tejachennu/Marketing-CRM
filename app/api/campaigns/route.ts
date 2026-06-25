import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOrgAccess, verifyRecordAccess } from '@/lib/api-auth-helper'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseKey)
}

// GET: List all campaigns or get details of a single campaign (including logs)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const orgId = searchParams.get('organizationId')

    if (id) {
      const authResult = await verifyRecordAccess(request, 'campaigns', id)
      if (!authResult.authorized) {
        return NextResponse.json({ error: authResult.error }, { status: authResult.status })
      }

      const supabase = getSupabaseClient()
      // Fetch details of a single campaign
      const { data: campaign, error: campaignError } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', id)
        .single()

      if (campaignError) throw campaignError

      // Fetch delivery logs for this campaign
      const { data: logs, error: logsError } = await supabase
        .from('campaign_logs')
        .select('*')
        .eq('campaign_id', id)
        .order('created_at', { ascending: true })

      if (logsError) throw logsError

      return NextResponse.json({
        success: true,
        campaign,
        logs: logs || []
      })
    }

    // List all campaigns with server-side pagination
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const offset = (page - 1) * limit

    if (!orgId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, orgId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseClient()

    // Count total matching campaigns
    const { count: total, error: countError } = await supabase
      .from('campaigns')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId)
    if (countError) throw countError

    const query = supabase
      .from('campaigns')
      .select('*')
      .eq('organization_id', orgId)

    const { data: campaigns, error: listError } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (listError) throw listError

    return NextResponse.json({
      success: true,
      campaigns: campaigns || [],
      pagination: {
        total: total || 0,
        page,
        limit,
        pages: Math.ceil((total || 0) / limit)
      }
    })
  } catch (error) {
    console.error('[API] Get campaigns error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to retrieve campaigns' },
      { status: 500 }
    )
  }
}

// POST: Create a new campaign + initialize pending logs
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      name,
      templateName,
      templateBody,
      templateSid,
      audience, // array of { phone: string, email?: string, variables: Record<string, string> }
      organizationId,
      createdBy,
      channel, // 'whatsapp', 'sms', 'email'
      sender, // sender phone number, service SID, or email
      subject // email subject line
    } = body

    if (!name || !templateName || !templateBody || !audience || !Array.isArray(audience) || audience.length === 0) {
      return NextResponse.json(
        { error: 'Missing required campaign parameters: name, templateName, templateBody, and audience' },
        { status: 400 }
      )
    }

    const supabase = getSupabaseClient()

    // Resolve or get default organizationId
    let resolvedOrgId = organizationId
    if (!resolvedOrgId) {
      const { data: orgs } = await supabase.from('organizations').select('id').limit(1)
      if (orgs && orgs.length > 0) {
        resolvedOrgId = orgs[0].id
      }
    }

    const authResult = await verifyOrgAccess(request, resolvedOrgId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const campaignChannel = channel || 'whatsapp'

    // Insert Campaign
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .insert([
        {
          organization_id: resolvedOrgId || null,
          name,
          template_name: templateName,
          template_body: templateBody,
          template_sid: templateSid || null,
          status: 'PENDING',
          total_contacts: audience.length,
          sent_count: 0,
          failed_count: 0,
          created_by: createdBy || null,
          channel: campaignChannel,
          sender: sender || null,
          subject: subject || null
        }
      ])
      .select()
      .single()

    if (campaignError) throw campaignError

    // Insert Pending Logs
    const pendingLogs = audience.map(recipient => {
      if (campaignChannel === 'email') {
        const emailVal = recipient.email || ''
        return {
          campaign_id: campaign.id,
          phone_number: null,
          email_address: emailVal.trim(),
          status: 'PENDING',
          variables_mapped: recipient.variables || {}
        }
      } else {
        const phone = recipient.phone || ''
        const cleanPhone = phone.replace(/[\s-()]/g, '')
        return {
          campaign_id: campaign.id,
          phone_number: cleanPhone.startsWith('+') ? cleanPhone : `+${cleanPhone}`,
          email_address: null,
          status: 'PENDING',
          variables_mapped: recipient.variables || {}
        }
      }
    })

    const { error: logsError } = await supabase
      .from('campaign_logs')
      .insert(pendingLogs)

    if (logsError) throw logsError

    return NextResponse.json({
      success: true,
      campaign,
      message: 'Campaign created and queued successfully.'
    })
  } catch (error) {
    console.error('[API] Create campaign error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create campaign' },
      { status: 500 }
    )
  }
}
