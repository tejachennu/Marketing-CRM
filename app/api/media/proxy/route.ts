import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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
    const mediaUrl = searchParams.get('url')

    if (!mediaUrl) {
      return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
    }

    // Only proxy Twilio media
    if (!mediaUrl.startsWith('https://api.twilio.com')) {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }

    let twilioAccountSid = process.env.TWILIO_ACCOUNT_SID || ''
    let twilioAuthToken = process.env.TWILIO_AUTH_TOKEN || ''

    // Try to extract Account SID from the mediaUrl
    const match = mediaUrl.match(/\/Accounts\/(AC[a-fA-F0-9]{32})\//)
    const extractedSid = match ? match[1] : null

    if (extractedSid && extractedSid !== twilioAccountSid) {
      try {
        const supabase = getSupabaseClient()
        const { data: orgData } = await supabase
          .from('organizations')
          .select('twilio_auth_token')
          .eq('twilio_account_sid', extractedSid)
          .maybeSingle()
        if (orgData?.twilio_auth_token) {
          twilioAccountSid = extractedSid
          twilioAuthToken = orgData.twilio_auth_token
        }
      } catch (dbErr) {
        console.error('[Proxy] Error loading credentials from DB:', dbErr)
      }
    }

    const authHeader = 'Basic ' + Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64')


    // Clean hash from URL if present
    const cleanUrl = mediaUrl.split('#')[0]

    // Fetch from Twilio with redirects manual
    let res = await fetch(cleanUrl, {
      headers: {
        'Authorization': authHeader
      },
      redirect: 'manual'
    })

    // Handle redirect manually to Amazon S3 URL
    if (res.status >= 300 && res.status < 400) {
      const redirectUrl = res.headers.get('location')
      if (redirectUrl) {
        res = await fetch(redirectUrl)
      } else {
        return NextResponse.json({ error: 'Location header missing on redirect' }, { status: 500 })
      }
    }

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch media from Twilio' }, { status: res.status })
    }

    const contentType = res.headers.get('content-type') || 'application/octet-stream'
    const arrayBuffer = await res.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Return the media with correct headers (cache for 1 day)
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      }
    })
  } catch (err) {
    console.error('[Proxy] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
