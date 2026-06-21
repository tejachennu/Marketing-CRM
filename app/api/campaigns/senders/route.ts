import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'

export async function GET(request: NextRequest) {
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID || ''
    const authToken = process.env.TWILIO_AUTH_TOKEN || ''
    
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
    const envWhatsapp = process.env.TWILIO_WHATSAPP_NUMBER
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
    const sendgridKey = process.env.SENDGRID_API_KEY
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

    // Add env configured From email if present
    const envEmail = process.env.SENDGRID_FROM_EMAIL
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
