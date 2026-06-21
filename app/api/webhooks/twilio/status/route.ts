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
 * Twilio Status Callback Webhook
 * 
 * Twilio sends delivery status updates here (queued, sent, delivered, read, failed, etc.)
 * for outgoing messages we've sent.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text()
    const params = new URLSearchParams(body)

    const messageSid = params.get('MessageSid') || ''
    const messageStatus = params.get('MessageStatus') || ''
    const errorCode = params.get('ErrorCode') || null
    const errorMessage = params.get('ErrorMessage') || null

    console.log('[v0] Twilio status callback:', { messageSid, messageStatus, errorCode })

    // Optionally update the message delivery status in the database
    if (messageSid && messageStatus) {
      try {
        const supabase = getSupabaseClient()

        // We can store delivery status; for now just log it
        // If you want to track delivery status, add a 'delivery_status' column to messages table
        // and uncomment the below:
        //
        // await supabase
        //   .from('messages')
        //   .update({ delivery_status: messageStatus })
        //   .eq('twilio_message_sid', messageSid)

        if (messageStatus === 'failed' || messageStatus === 'undelivered') {
          console.error('[v0] Message delivery failed:', {
            messageSid,
            errorCode,
            errorMessage,
          })
        }
      } catch (dbError) {
        console.error('[v0] Error updating message status:', dbError)
        // Non-fatal — don't fail the webhook
      }
    }

    // Always return 200 to Twilio to acknowledge receipt
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[v0] Status webhook error:', error)
    // Still return 200 to prevent Twilio from retrying
    return NextResponse.json({ success: true })
  }
}
