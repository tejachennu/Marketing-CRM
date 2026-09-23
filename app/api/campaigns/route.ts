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

import { getCampaignsReplyStats, getCampaignDetailedRecipients } from '@/lib/campaign-stats'

// GET: List all campaigns or get details of a single campaign (including logs and interactive recipient chats)
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

      // Fetch delivery logs and detailed recipient conversations in parallel
      const [logsRes, conversations] = await Promise.all([
        supabase
          .from('campaign_logs')
          .select('*')
          .eq('campaign_id', id)
          .order('created_at', { ascending: true }),
        getCampaignDetailedRecipients(id)
      ])

      const logs = logsRes.data || []
      if (logsRes.error) throw logsRes.error

      let computedSent = campaign.sent_count || 0
      let computedFailed = campaign.failed_count || 0
      if (logs && logs.length > 0) {
        computedSent = logs.filter(l => ['SENT', 'DELIVERED', 'READ'].includes(l.status)).length
        computedFailed = logs.filter(l => l.status === 'FAILED').length
      }

      const activeChatsCount = conversations.filter(c => c.has_replied).length
      const unreadChatsCount = conversations.filter(c => c.needs_reply).length
      const totalRecipients = campaign.total_contacts || logs.length || 0
      const replyRate = totalRecipients > 0 ? Math.round((activeChatsCount / totalRecipients) * 100) : 0

      return NextResponse.json({
        success: true,
        campaign: {
          ...campaign,
          sent_count: computedSent,
          failed_count: computedFailed,
          active_chats_count: activeChatsCount,
          unread_chats_count: unreadChatsCount,
          reply_rate: replyRate
        },
        stats: {
          total_contacts: totalRecipients,
          sent_count: computedSent,
          failed_count: computedFailed,
          active_chats_count: activeChatsCount,
          unread_chats_count: unreadChatsCount,
          reply_rate: replyRate
        },
        logs: logs || [],
        conversations: conversations || []
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

    if (campaigns && campaigns.length > 0) {
      const campIds = campaigns.map(c => c.id)
      const [logStatsRes, replyStatsRes] = await Promise.all([
        supabase
          .from('campaign_logs')
          .select('campaign_id, status')
          .in('campaign_id', campIds),
        getCampaignsReplyStats(campIds)
      ])

      const logStats = logStatsRes.data || []
      const statsMap: Record<string, { sent: number; failed: number }> = {}
      for (const l of logStats) {
        if (!statsMap[l.campaign_id]) statsMap[l.campaign_id] = { sent: 0, failed: 0 }
        if (['SENT', 'DELIVERED', 'READ'].includes(l.status)) {
          statsMap[l.campaign_id].sent++
        } else if (l.status === 'FAILED') {
          statsMap[l.campaign_id].failed++
        }
      }

      campaigns.forEach(c => {
        if (statsMap[c.id]) {
          c.sent_count = statsMap[c.id].sent
          c.failed_count = statsMap[c.id].failed
        }
        const replyStat = replyStatsRes[c.id]
        c.active_chats_count = replyStat?.active_chats_count || 0
        c.unread_chats_count = replyStat?.unread_chats_count || 0
      })
    }

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
      templateLanguage,
      audience, // array of { phone: string, email?: string, variables: Record<string, string> }
      organizationId,
      createdBy,
      channel, // 'whatsapp', 'sms', 'email'
      sender, // sender phone number, service SID, or email
      subject, // email subject line
      scheduledAt // ISO timestamp for schedule-based marketing (in IST/UTC)
    } = body

    const effectiveTemplateBody = templateBody || templateName || 'custom_message'
    if (!name || !templateName || (!templateBody && !templateSid) || !audience || !Array.isArray(audience) || audience.length === 0) {
      return NextResponse.json(
        { error: 'Missing required campaign parameters: name, templateName, and audience' },
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
    const lang = templateLanguage || 'en'
    const isScheduled = !!scheduledAt && new Date(scheduledAt).getTime() > Date.now()
    const initialStatus = isScheduled ? 'SCHEDULED' : 'PENDING'

    // Insert Campaign (with graceful fallback if template_language or scheduled_at columns are not yet migrated)
    const campaignInsertPayload: any = {
      organization_id: resolvedOrgId || null,
      name,
      template_name: templateName,
      template_body: effectiveTemplateBody,
      template_sid: templateSid || null,
      template_language: lang,
      status: initialStatus,
      total_contacts: audience.length,
      sent_count: 0,
      failed_count: 0,
      created_by: createdBy || null,
      channel: campaignChannel,
      sender: sender || null,
      subject: subject || null,
      scheduled_at: isScheduled ? scheduledAt : null
    }

    let { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .insert([campaignInsertPayload])
      .select()
      .single()

    if (campaignError) {
      const retryPayload = { ...campaignInsertPayload }
      if (campaignError.message?.includes('template_language') || campaignError.code === '42703') {
        delete retryPayload.template_language
      }
      if (campaignError.message?.includes('scheduled_at') || campaignError.code === '42703') {
        delete retryPayload.scheduled_at
      }
      const retry = await supabase
        .from('campaigns')
        .insert([retryPayload])
        .select()
        .single()
      campaign = retry.data
      campaignError = retry.error
    }

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
        let cleanPhone = (recipient.phone || '').replace(/[^\d+]/g, '')
        if (cleanPhone.startsWith('+')) cleanPhone = cleanPhone.slice(1)
        if (cleanPhone.length === 10 && /^[6-9]/.test(cleanPhone)) {
          cleanPhone = `91${cleanPhone}`
        }
        return {
          campaign_id: campaign.id,
          phone_number: `+${cleanPhone}`,
          email_address: null,
          status: 'PENDING',
          variables_mapped: recipient.variables || {}
        }
      }
    })

    // Insert Pending Logs in batches of 500 to handle 5k+ audiences safely
    const chunkSize = 500
    for (let i = 0; i < pendingLogs.length; i += chunkSize) {
      const chunk = pendingLogs.slice(i, i + chunkSize)
      const { error: logsError } = await supabase
        .from('campaign_logs')
        .insert(chunk)

      if (logsError) throw logsError
    }

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
