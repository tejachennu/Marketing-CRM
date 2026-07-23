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

function getTwilioErrorExplanation(code: string | null, rawMsg: string | null): string {
  if (!code && !rawMsg) return 'Twilio dispatch failed'
  
  switch (code) {
    case '63007':
      return 'Twilio Sandbox Error 63007: Recipient phone number has not joined your Twilio WhatsApp Sandbox. Recipient must send "join <sandbox-code>" to your sandbox number first.'
    case '63016':
      return 'Twilio Policy Error 63016: Cannot send free-form message outside 24-hour window. An approved Twilio Content Template (contentSid) is required.'
    case '63015':
      return 'Twilio Error 63015: Recipient has not opted in to receive WhatsApp messages from this sender.'
    case '21211':
      return 'Twilio Error 21211: Invalid phone number format. Ensure phone number starts with "+" and country code (e.g. +14155238886).'
    default:
      return rawMsg || `Twilio delivery error (Code ${code})`
  }
}

/**
 * Twilio Status Callback Webhook
 * 
 * Twilio sends delivery status updates here (queued, sent, delivered, read, failed, undelivered, etc.)
 * for outgoing messages & campaigns.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text()
    const params = new URLSearchParams(body)

    const messageSid = params.get('MessageSid') || ''
    const messageStatus = params.get('MessageStatus') || ''
    const errorCode = params.get('ErrorCode') || null
    const rawErrorMessage = params.get('ErrorMessage') || null

    console.log('[v0] Twilio status callback received:', { messageSid, messageStatus, errorCode, rawErrorMessage })

    if (messageSid && messageStatus) {
      const supabase = getSupabaseClient()
      const errorExplanation = (messageStatus === 'failed' || messageStatus === 'undelivered')
        ? getTwilioErrorExplanation(errorCode, rawErrorMessage)
        : null

      // 1. Update live chat messages table
      try {
        await supabase
          .from('messages')
          .update({
            status: messageStatus,
            error_message: errorExplanation
          })
          .eq('twilio_message_sid', messageSid)
      } catch (msgErr) {
        console.error('[v0] Error updating message status:', msgErr)
      }

      // 2. Update campaign logs table
      try {
        const isFailed = messageStatus === 'failed' || messageStatus === 'undelivered'
        const logStatus = isFailed ? 'FAILED' : messageStatus.toUpperCase()

        const { data: logData } = await supabase
          .from('campaign_logs')
          .select('id, campaign_id, status')
          .eq('message_sid', messageSid)
          .maybeSingle()

        if (logData) {
          await supabase
            .from('campaign_logs')
            .update({
              status: logStatus,
              error_message: errorExplanation
            })
            .eq('id', logData.id)

          // If transition from SENT to FAILED, update campaign counters
          if (isFailed && logData.status !== 'FAILED' && logData.campaign_id) {
            const { data: c } = await supabase
              .from('campaigns')
              .select('sent_count, failed_count')
              .eq('id', logData.campaign_id)
              .single()

            if (c) {
              await supabase
                .from('campaigns')
                .update({
                  sent_count: Math.max(0, (c.sent_count || 1) - 1),
                  failed_count: (c.failed_count || 0) + 1
                })
                .eq('id', logData.campaign_id)
            }
          }
        }
      } catch (campErr) {
        console.error('[v0] Error updating campaign log status:', campErr)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[v0] Status webhook error:', error)
    return NextResponse.json({ success: true })
  }
}
