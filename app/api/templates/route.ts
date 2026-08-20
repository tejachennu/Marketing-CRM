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
    category: 'UTILITY',
    language: 'en',
    approvalStatus: 'approved'
  },
  {
    sid: 'HX_promotion_discount',
    name: 'promotion_discount (Meta Approved)',
    body: 'Hey {{1}}! Get {{2}}% off on all our services this weekend. Use code {{3}} at checkout.',
    variables: ['1', '2', '3'],
    category: 'MARKETING',
    language: 'en',
    approvalStatus: 'approved'
  },
  {
    sid: 'HX_follow_up_lead',
    name: 'follow_up_lead (Meta Approved)',
    body: 'Hi {{1}}, this is {{2}} from {{3}}. Just following up on our previous conversation regarding your inquiry. Let us know if you have any questions!',
    variables: ['1', '2', '3'],
    category: 'UTILITY',
    language: 'en',
    approvalStatus: 'approved'
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

      // Fetch approval statuses in parallel
      const approvalPromises = twilioTemplates.map(async (item: any) => {
        try {
          const approval = await client.content.v1.contents(item.sid).approvalFetch().fetch()
          return { sid: item.sid, approval }
        } catch {
          return { sid: item.sid, approval: null }
        }
      })

      const approvalsList = await Promise.allSettled(approvalPromises)
      const approvalMap = new Map<string, any>()
      approvalsList.forEach(res => {
        if (res.status === 'fulfilled' && res.value?.approval) {
          approvalMap.set(res.value.sid, res.value.approval)
        }
      })

      // Parse Twilio Content API formats
      const templates = twilioTemplates.map((item: any) => {
        const types = item.types || {}
        let body = ''
        
        // Find body text across supported Content types
        if (types['whatsapp/card'] && types['whatsapp/card'].body) {
          body = types['whatsapp/card'].body
        } else if (types['twilio/text'] && types['twilio/text'].body) {
          body = types['twilio/text'].body
        } else if (types['twilio/card'] && types['twilio/card'].body) {
          body = types['twilio/card'].body
        } else if (types['twilio/quick-reply'] && types['twilio/quick-reply'].body) {
          body = types['twilio/quick-reply'].body
        } else if (types['twilio/call-to-action'] && types['twilio/call-to-action'].body) {
          body = types['twilio/call-to-action'].body
        } else if (types['whatsapp/media'] && types['whatsapp/media'].body) {
          body = types['whatsapp/media'].body
        } else if (types['twilio/media'] && types['twilio/media'].body) {
          body = types['twilio/media'].body
        } else {
          // Fallback - stringify values or grab what we can
          for (const key of Object.keys(types)) {
            if (types[key]?.body) {
              body = types[key].body
              break
            } else if (types[key]?.text) {
              body = types[key].text
              break
            }
          }
        }

        // Detect variables {{1}}, {{2}} or {{name}} etc.
        const variables: string[] = []
        const varMatches = body.match(/\{\{([^}]+)\}\}/g)
        if (varMatches) {
          varMatches.forEach((match: string) => {
            const rawVar = match.replace(/[\{\}]/g, '').trim()
            if (rawVar && !variables.includes(rawVar)) {
              variables.push(rawVar)
            }
          })
          variables.sort((a, b) => {
            const numA = parseInt(a)
            const numB = parseInt(b)
            if (!isNaN(numA) && !isNaN(numB)) return numA - numB
            return a.localeCompare(b)
          })
        }

        // Check if item has registered variables in Twilio
        if (variables.length === 0 && item.variables && typeof item.variables === 'object') {
          Object.keys(item.variables).forEach(k => {
            if (!variables.includes(k)) variables.push(k)
          })
        }

        const approvalData = approvalMap.get(item.sid)
        const whatsappApproval = approvalData?.whatsapp || {}
        const approvalStatus = whatsappApproval.status || 'approved'
        const category = whatsappApproval.category || 'UTILITY'
        const rejectionReason = whatsappApproval.rejectionReason || null
        const language = item.language || 'en'

        return {
          sid: item.sid,
          name: item.friendlyName || item.sid,
          whatsappName: whatsappApproval.name || item.friendlyName || item.sid,
          body: body,
          variables: variables,
          category: category,
          language: language,
          approvalStatus: approvalStatus,
          rejectionReason: rejectionReason
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
