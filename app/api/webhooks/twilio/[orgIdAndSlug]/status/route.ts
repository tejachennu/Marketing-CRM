import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

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

        // 1. Update messages table for CRM Chat
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
          .eq('twilio_message_sid', messageSid)

        if (msgUpdateErr) {
          console.warn('[Status Webhook] Error updating messages table:', msgUpdateErr)
        }

        // 2. Update campaign_logs if this message belonged to a campaign
        const campaignLogStatus = 
          messageStatus === 'read' ? 'READ' :
          messageStatus === 'delivered' ? 'DELIVERED' :
          (messageStatus === 'failed' || messageStatus === 'undelivered') ? 'FAILED' : 'SENT'

        await supabase
          .from('campaign_logs')
          .update({
            status: campaignLogStatus,
            error_message: errorDetail,
          })
          .eq('message_sid', messageSid)

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
