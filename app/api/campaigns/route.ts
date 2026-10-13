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

import { getCampaignsReplyStats, getCampaignDetailedRecipients, getCampaignsLogStats, getOrganizationCampaignTotals } from '@/lib/campaign-stats'
import { sanitizeSearchTerm } from '@/lib/utils'
import { buildRecipientList, type CampaignChannel } from '@/lib/campaigns/audience'

// The list's status filter, in the words the dashboard uses
const STATUS_FILTERS: Record<string, string[]> = {
  scheduled: ['SCHEDULED'],
  sending: ['PROCESSING', 'PENDING'],
  completed: ['COMPLETED'],
  failed: ['FAILED'],
  stopped: ['STOPPED', 'CANCELLED'],
}
const CHANNEL_FILTERS = ['whatsapp', 'sms', 'email']

// GET: List all campaigns or get details of a single campaign (including logs and interactive recipient chats)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const orgId = searchParams.get('organizationId')

    if (id) {
      const authResult = await verifyRecordAccess(request, 'campaigns', id, { permission: 'records.view_all' })
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

      // Fetch delivery logs, detailed recipient conversations, and exact aggregated log stats in parallel
      const [logsRes, conversations, logStatsMap] = await Promise.all([
        supabase
          .from('campaign_logs')
          .select('*')
          .eq('campaign_id', id)
          .order('created_at', { ascending: true }),
        getCampaignDetailedRecipients(id),
        getCampaignsLogStats([id])
      ])

      const logs = logsRes.data || []
      if (logsRes.error) throw logsRes.error

      const logStat = logStatsMap[id]
      let computedSent = logStat ? logStat.sent_count : (campaign.sent_count || 0)
      let computedFailed = logStat ? logStat.failed_count : (campaign.failed_count || 0)
      if (!logStat && logs && logs.length > 0) {
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

    // List all campaigns with server-side pagination (or all=true for selection filters)
    const isAll = searchParams.get('all') === 'true'
    const page = isAll ? 1 : Math.max(1, parseInt(searchParams.get('page') || '1') || 1)
    const limit = isAll ? 500 : Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '10') || 10))
    const offset = (page - 1) * limit
    const search = sanitizeSearchTerm(searchParams.get('search'))
    const channelFilter = searchParams.get('channel') || ''
    const statusFilter = searchParams.get('status') || ''

    if (!orgId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, orgId, { permission: 'records.view_all' })
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseClient()

    // Search and filters run here, over every campaign, so a match on another page is still found.
    // The count and the page come from one query, so the pager always agrees with the rows.
    let query = supabase
      .from('campaigns')
      .select(isAll ? 'id, name, channel, status, total_contacts, sent_count, created_at' : '*', { count: 'exact' })
      .eq('organization_id', orgId)

    if (search) {
      query = query.or(`name.ilike.%${search}%,template_name.ilike.%${search}%`)
    }
    if (CHANNEL_FILTERS.includes(channelFilter)) {
      // Campaigns created before channels existed have no channel and are WhatsApp
      query = channelFilter === 'whatsapp' ? query.or('channel.eq.whatsapp,channel.is.null') : query.eq('channel', channelFilter)
    }
    if (STATUS_FILTERS[statusFilter]) {
      query = query.in('status', STATUS_FILTERS[statusFilter])
    }

    const { data, count: total, error: listError } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (listError) throw listError
    const campaigns = (data || []) as any[]

    // The picker in the wizard only needs names; skip the per-campaign statistics for it
    if (isAll) {
      return NextResponse.json({
        success: true,
        campaigns,
        pagination: { total: total || 0, page: 1, limit, pages: 1 },
      })
    }

    // Totals across the whole organization, independent of the page and the filters
    const summary = searchParams.get('summary') === 'false' ? undefined : await getOrganizationCampaignTotals(orgId)

    if (campaigns && campaigns.length > 0) {
      const campIds = campaigns.map(c => c.id)
      const [logStatsMap, replyStatsRes] = await Promise.all([
        getCampaignsLogStats(campIds),
        getCampaignsReplyStats(campIds)
      ])

      campaigns.forEach(c => {
        const logStat = logStatsMap[c.id]
        if (logStat) {
          c.sent_count = logStat.sent_count
          c.failed_count = logStat.failed_count
          c.delivered_count = logStat.delivered_count
          c.read_count = logStat.read_count
        }
        const replyStat = replyStatsRes[c.id]
        c.active_chats_count = replyStat?.active_chats_count || 0
        c.unread_chats_count = replyStat?.unread_chats_count || 0
      })
    }

    return NextResponse.json({
      success: true,
      campaigns: campaigns || [],
      summary: summary ?? null,
      pagination: {
        total: total || 0,
        page,
        limit,
        pages: Math.max(1, Math.ceil((total || 0) / limit))
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

    const authResult = await verifyOrgAccess(request, resolvedOrgId, { permission: 'campaigns.manage' })
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const campaignChannel: CampaignChannel = CHANNEL_FILTERS.includes(channel) ? channel : 'whatsapp'
    const lang = templateLanguage || 'en'

    // The same rules the wizard shows: one message per valid, distinct number or address.
    // Applied here too so a repeated or malformed row can never be sent, whatever the client sends.
    const recipientList = buildRecipientList(
      audience.map((recipient: any) => ({
        address: campaignChannel === 'email' ? recipient?.email : recipient?.phone,
        variables: recipient?.variables && typeof recipient.variables === 'object' ? recipient.variables : {},
      })),
      campaignChannel
    )
    if (recipientList.recipients.length === 0) {
      return NextResponse.json(
        { error: campaignChannel === 'email' ? 'None of the recipients has a valid email address.' : 'None of the recipients has a valid phone number.' },
        { status: 400 }
      )
    }
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
      total_contacts: recipientList.recipients.length,
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
    const pendingLogs = recipientList.recipients.map(recipient => ({
      campaign_id: campaign.id,
      phone_number: recipient.phone || null,
      email_address: recipient.email || null,
      status: 'PENDING',
      variables_mapped: recipient.variables || {}
    }))

    // Insert Pending Logs in batches of 500 to handle 5k+ audiences safely
    const chunkSize = 500
    for (let i = 0; i < pendingLogs.length; i += chunkSize) {
      const chunk = pendingLogs.slice(i, i + chunkSize)
      const { error: logsError } = await supabase
        .from('campaign_logs')
        .insert(chunk)

      if (logsError) {
        // Do not leave a campaign behind with only part of its audience: it could later be sent
        // to that part, and the retry would then message those people a second time
        await supabase.from('campaign_logs').delete().eq('campaign_id', campaign.id)
        await supabase.from('campaigns').delete().eq('id', campaign.id)
        throw logsError
      }
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
