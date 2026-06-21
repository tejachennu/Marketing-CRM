import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'

function getTwilioClient() {
  const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ''
  const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error('Missing Twilio credentials')
  }
  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
}

const fallbackTemplates = [
  {
    sid: 'HX_welcome_campaign',
    name: 'welcome_campaign (Meta Approved)',
    body: 'Hello {{1}}, welcome to {{2}}! We are thrilled to have you onboard.',
    variables: ['1', '2'],
    category: 'UTILITY'
  },
  {
    sid: 'HX_promotion_discount',
    name: 'promotion_discount (Meta Approved)',
    body: 'Hey {{1}}! Get {{2}}% off on all our services this weekend. Use code {{3}} at checkout.',
    variables: ['1', '2', '3'],
    category: 'MARKETING'
  },
  {
    sid: 'HX_follow_up_lead',
    name: 'follow_up_lead (Meta Approved)',
    body: 'Hi {{1}}, this is {{2}} from {{3}}. Just following up on our previous conversation regarding your inquiry. Let us know if you have any questions!',
    variables: ['1', '2', '3'],
    category: 'UTILITY'
  }
]

export async function GET(request: NextRequest) {
  try {
    let client
    try {
      client = getTwilioClient()
    } catch {
      console.warn('Twilio credentials not configured, returning fallback templates')
      return NextResponse.json({ templates: fallbackTemplates })
    }

    // Attempt to fetch templates using Twilio Content API
    // Content API: https://www.twilio.com/docs/content
    try {
      const twilioTemplates = await client.content.v1.contents.list({ limit: 50 })
      
      if (!twilioTemplates || twilioTemplates.length === 0) {
        return NextResponse.json({ templates: fallbackTemplates })
      }

      // Parse Twilio Content API formats
      const templates = twilioTemplates.map((item: any) => {
        // Twilio templates have their bodies nested under types (e.g. twilio/text or twilio/card etc)
        const types = item.types || {}
        let body = ''
        
        // Find body text in template types
        if (types['twilio/text']) {
          body = types['twilio/text'].body
        } else if (types['twilio/media']) {
          body = types['twilio/media'].body || ''
        } else if (types['twilio/card']) {
          body = types['twilio/card'].body || ''
        } else {
          // Fallback - stringify values or grab what we can
          const firstType = Object.keys(types)[0]
          if (firstType && types[firstType]) {
            body = types[firstType].body || types[firstType].text || ''
          }
        }

        // Detect variables {{1}}, {{2}} etc.
        const variables: string[] = []
        const varMatches = body.match(/\{\{\d+\}\}/g)
        if (varMatches) {
          varMatches.forEach((match: string) => {
            const num = match.replace(/[\{\}]/g, '')
            if (!variables.includes(num)) {
              variables.push(num)
            }
          })
          variables.sort((a, b) => parseInt(a) - parseInt(b))
        }

        return {
          sid: item.sid,
          name: item.friendlyName || item.sid,
          body: body,
          variables: variables,
          category: item.language || 'en'
        }
      })

      return NextResponse.json({ templates })
    } catch (apiError) {
      console.warn('Failed to fetch from Twilio Content API, returning fallbacks:', apiError)
      return NextResponse.json({ templates: fallbackTemplates })
    }
  } catch (error) {
    console.error('Templates fetch general error:', error)
    return NextResponse.json({ templates: fallbackTemplates })
  }
}
