import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { isStatusProgress } from '@/lib/meta-webhook'
import { describeTwilioRefusal, verifyTwilioRequest } from '@/lib/twilio-webhook'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseKey)
}

/**
 * Twilio Status Callback Webhook (Multi-Tenant)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgIdAndSlug: string }> | { orgIdAndSlug: string } }
) {
  try {
    const resolvedParams = await (params as any)
    const orgIdAndSlug = resolvedParams.orgIdAndSlug || ''
    const uuidMatch = orgIdAndSlug.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)

    if (!uuidMatch) {
      console.error('[Status Webhook] Invalid organization context:', orgIdAndSlug)
      return NextResponse.json({ success: true })
    }

    const orgId = uuidMatch[0]

    const body = await request.text()
    // Only Twilio, signing with this workspace's auth token, may move its statuses
    const { data: org } = await getSupabaseClient().from('organizations').select('twilio_auth_token').eq('id', orgId).maybeSingle()
    const signed = verifyTwilioRequest(request, body, [org?.twilio_auth_token, process.env.TWILIO_AUTH_TOKEN])
    if (!signed.ok) {
      console.warn(`[Status Webhook] Refused a request for Org ${orgId}: ${describeTwilioRefusal(signed.reason)}`)
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
    }
    const paramsMap = new URLSearchParams(body)

    const messageSid = paramsMap.get('MessageSid') || ''
    const messageStatus = paramsMap.get('MessageStatus') || ''
    const errorCode = paramsMap.get('ErrorCode') || null
    const errorMessage = paramsMap.get('ErrorMessage') || null

    console.log(`[Status Webhook] Org: ${orgId} Status:`, { messageSid, messageStatus, errorCode })

    if (messageSid && messageStatus) {
      try {
        const supabase = getSupabaseClient()
        const errorDetail = errorMessage || (errorCode ? `Twilio Error ${errorCode}` : null)

        // Track failed message statuses
        if (messageStatus === 'failed' || messageStatus === 'undelivered') {
          console.error(`[Status Webhook] Message delivery failed for Org ${orgId}:`, {
            messageSid,
            errorCode,
            errorMessage,
          })
        }

        // 1. Update messages table for CRM Chat. Twilio's callbacks arrive out of order and again, so a
        //    status only moves forward, and only on this workspace's message: the address names the
        //    workspace, and a SID posted to another workspace's address must not touch its chats
        const { data: messageRows, error: msgReadErr } = await supabase
          .from('messages')
          .select('id, status')
          .eq('twilio_message_sid', messageSid)
          .eq('organization_id', orgId)
        if (msgReadErr) {
          console.warn('[Status Webhook] Error reading messages table:', msgReadErr)
        }
        const messageIds = (messageRows || []).filter((row: any) => isStatusProgress(row.status, messageStatus)).map((row: any) => row.id)
        if (messageIds.length > 0) {
          const updateMsgData: any = {
            status: messageStatus,
            error_message: errorDetail,
          }
          if (messageStatus === 'read') {
            updateMsgData.read_at = new Date().toISOString()
          }

          const { error: msgUpdateErr } = await supabase
            .from('messages')
            .update(updateMsgData)
            .in('id', messageIds)
            .eq('organization_id', orgId)

          if (msgUpdateErr) {
            console.warn('[Status Webhook] Error updating messages table:', msgUpdateErr)
          }
        }

        // 2. Update campaign_logs if this message belonged to a campaign. A log has no organization_id
        //    of its own; its campaign has, and only a log of this workspace's campaign is touched,
        //    forward only as above
        const campaignLogStatus =
          messageStatus === 'read' ? 'READ' :
          messageStatus === 'delivered' ? 'DELIVERED' :
          (messageStatus === 'failed' || messageStatus === 'undelivered') ? 'FAILED' : 'SENT'

        const { data: campaignLogs, error: logReadErr } = await supabase
          .from('campaign_logs')
          .select('id, status, campaign:campaigns(organization_id)')
          .eq('message_sid', messageSid)
        if (logReadErr) {
          console.warn('[Status Webhook] Error reading campaign logs:', logReadErr)
        }
        for (const log of campaignLogs || []) {
          const campaign = Array.isArray(log.campaign) ? log.campaign[0] : log.campaign
          if (campaign?.organization_id !== orgId || !isStatusProgress(log.status, messageStatus)) continue
          const { error: logErr } = await supabase
            .from('campaign_logs')
            .update({
              status: campaignLogStatus,
              error_message: errorDetail,
            })
            .eq('id', log.id)
          if (logErr) {
            console.warn('[Status Webhook] Error updating campaign log:', logErr)
          }
        }

      } catch (dbError) {
        console.error('[Status Webhook] Error updating status in database:', dbError)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Status Webhook] Error:', error)
    return NextResponse.json({ success: true })
  }
}
