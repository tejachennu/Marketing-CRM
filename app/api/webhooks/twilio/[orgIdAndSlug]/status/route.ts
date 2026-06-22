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

        // Track failed message statuses
        if (messageStatus === 'failed' || messageStatus === 'undelivered') {
          console.error(`[Status Webhook] Message delivery failed for Org ${orgId}:`, {
            messageSid,
            errorCode,
            errorMessage,
          })
        }
      } catch (dbError) {
        console.error('[Status Webhook] Error updating status:', dbError)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Status Webhook] Error:', error)
    return NextResponse.json({ success: true })
  }
}
