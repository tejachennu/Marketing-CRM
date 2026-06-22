import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
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
    const orgId = searchParams.get('organizationId')

    let accountSid = process.env.TWILIO_ACCOUNT_SID || ''
    let authToken = process.env.TWILIO_AUTH_TOKEN || ''
    let envWhatsapp = process.env.TWILIO_WHATSAPP_NUMBER || ''
    let sendgridKey = process.env.SENDGRID_API_KEY || ''
    let envEmail = process.env.SENDGRID_FROM_EMAIL || ''

    // Resolve tenant credentials
    if (orgId) {
      try {
        const supabase = getSupabaseClient()
        const { data: orgData } = await supabase
          .from('organizations')
          .select('twilio_account_sid, twilio_auth_token, twilio_whatsapp_number, sendgrid_api_key, sendgrid_from_email')
          .eq('id', orgId)
          .single()

        if (orgData) {
          if (orgData.twilio_account_sid) accountSid = orgData.twilio_account_sid
          if (orgData.twilio_auth_token) authToken = orgData.twilio_auth_token
          if (orgData.twilio_whatsapp_number) envWhatsapp = orgData.twilio_whatsapp_number
          if (orgData.sendgrid_api_key) sendgridKey = orgData.sendgrid_api_key
          if (orgData.sendgrid_from_email) envEmail = orgData.sendgrid_from_email
        }
      } catch (dbErr) {
        console.error('[Senders API] Error loading database credentials:', dbErr)
      }
    }

    const smsSenders: Array<{ value: string; label: string }> = []
    const whatsappSenders: Array<{ value: string; label: string }> = []
    const emailSenders: Array<{ value: string; label: string }> = []

    // 1. Fetch Twilio Numbers & Services
    if (accountSid && authToken) {
      try {
        const client = twilio(accountSid, authToken)

        // Fetch active incoming phone numbers
        const numbers = await client.incomingPhoneNumbers.list({ limit: 50 })
        numbers.forEach((n) => {
          smsSenders.push({
            value: n.phoneNumber,
            label: `${n.friendlyName || n.phoneNumber} (${n.phoneNumber})`,
          })

          whatsappSenders.push({
            value: `whatsapp:${n.phoneNumber}`,
            label: `WhatsApp: ${n.friendlyName || n.phoneNumber} (${n.phoneNumber})`,
          })
        })

        // Fetch messaging services
        const services = await client.messaging.v1.services.list({ limit: 50 })
        services.forEach((s) => {
          smsSenders.push({
            value: s.sid,
            label: `Messaging Service: ${s.friendlyName} (${s.sid})`,
          })
        })
      } catch (err) {
        console.error('[Senders API] Error fetching Twilio numbers/services:', err)
      }
    }

    // Add env configured WhatsApp number if present
    if (envWhatsapp) {
      const cleanWhatsapp = envWhatsapp.startsWith('whatsapp:') ? envWhatsapp : `whatsapp:${envWhatsapp}`
      const cleanPhone = envWhatsapp.replace('whatsapp:', '')
      if (!whatsappSenders.some((s) => s.value === cleanWhatsapp)) {
        whatsappSenders.unshift({
          value: cleanWhatsapp,
          label: `Configured WhatsApp Number (${cleanPhone})`,
        })
      }
    }

    // Always offer the Twilio WhatsApp Sandbox number as a fallback
    const sandboxWhatsapp = 'whatsapp:+14155238886'
    if (!whatsappSenders.some((s) => s.value === sandboxWhatsapp)) {
      whatsappSenders.push({
        value: sandboxWhatsapp,
        label: 'Twilio WhatsApp Sandbox (+14155238886)',
      })
    }

    // 2. Fetch SendGrid Verified Senders
    if (sendgridKey) {
      try {
        const sgRes = await fetch('https://api.sendgrid.com/v3/verified_senders', {
          headers: {
            Authorization: `Bearer ${sendgridKey}`,
          },
        })
        if (sgRes.ok) {
          const sgData = await sgRes.json()
          const results = sgData.results || []
          results.forEach((r: any) => {
            emailSenders.push({
              value: r.email,
              label: r.nickname ? `${r.nickname} <${r.email}>` : r.email,
            })
          })
        }
      } catch (err) {
        console.error('[Senders API] Error fetching SendGrid senders:', err)
      }
    }

    // Add configured From email if present
    if (envEmail && !emailSenders.some((s) => s.value === envEmail)) {
      emailSenders.unshift({
        value: envEmail,
        label: `Configured From Email (${envEmail})`,
      })
    }

    return NextResponse.json({
      success: true,
      smsSenders,
      whatsappSenders,
      emailSenders,
    })
  } catch (error) {
    console.error('[API] Get senders error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to retrieve senders' },
      { status: 500 }
    )
  }
}
