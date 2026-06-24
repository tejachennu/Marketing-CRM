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

async function getTwilioClientForOrg(orgId: string | null) {
  let TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ''
  let TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''

  if (orgId) {
    try {
      const supabase = getSupabaseClient()
      const { data: orgData } = await supabase
        .from('organizations')
        .select('twilio_account_sid, twilio_auth_token')
        .eq('id', orgId)
        .single()

      if (orgData) {
        if (orgData.twilio_account_sid) TWILIO_ACCOUNT_SID = orgData.twilio_account_sid
        if (orgData.twilio_auth_token) TWILIO_AUTH_TOKEN = orgData.twilio_auth_token
      }
    } catch (e) {
      console.error('Failed to load twilio config for templates:', e)
    }
  }

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error('Missing Twilio credentials')
  }
  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
}

// Fetch organization WhatsApp config from DB
async function getOrgWhatsappConfig(orgId: string) {
  const supabase = getSupabaseClient()
  const { data: orgData } = await supabase
    .from('organizations')
    .select('whatsapp_provider, whatsapp_api_token, whatsapp_graph_api_version, whatsapp_business_account_id')
    .eq('id', orgId)
    .single()

  return {
    provider: orgData?.whatsapp_provider || process.env.WHATSAPP_PROVIDER || 'twilio',
    apiToken: orgData?.whatsapp_api_token || process.env.WHATSAPP_API_TOKEN || '',
    graphApiVersion: orgData?.whatsapp_graph_api_version || process.env.WHATSAPP_GRAPH_API_VERSION || 'v25.0',
    businessAccountId: orgData?.whatsapp_business_account_id || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
  }
}

// Fetch templates from Meta WhatsApp Business Cloud API
async function fetchMetaTemplates(apiToken: string, graphApiVersion: string, businessAccountId: string): Promise<any[]> {
  if (!apiToken || !businessAccountId) {
    console.warn('[Templates] Missing Meta API token or WABA ID, skipping Meta template fetch')
    return []
  }

  const allTemplates: any[] = []
  let url: string | null = `https://graph.facebook.com/${graphApiVersion}/${businessAccountId}/message_templates?fields=name,status,category,language,components,id&limit=100&access_token=${apiToken}`

  try {
    while (url) {
      const res: Response = await fetch(url)

      if (!res.ok) {
        const errText = await res.text()
        console.error(`[Templates] Meta API error: ${res.status} ${errText}`)
        break
      }

      const data = await res.json()
      const templates = data.data || []

      for (const tpl of templates) {
        // Only include APPROVED templates
        if (tpl.status !== 'APPROVED') continue

        // Extract body text from components
        let body = ''
        const components = tpl.components || []
        for (const comp of components) {
          if (comp.type === 'BODY') {
            body = comp.text || ''
            break
          }
        }

        // Extract variables from body (e.g., {{1}}, {{2}})
        const variables: string[] = []
        const varMatches = body.match(/\{\{[^\}]+\}\}/g)
        if (varMatches) {
          varMatches.forEach((match: string) => {
            const variable = match.replace(/[\{\}]/g, '')
            if (!variables.includes(variable)) {
              variables.push(variable)
            }
          })
        }

        allTemplates.push({
          sid: `META_${tpl.id}`,
          name: `${tpl.name} (Meta Approved)`,
          body: body,
          variables: variables,
          category: tpl.category || 'UTILITY',
          language: tpl.language || 'en',
          isDbTemplate: false,
          source: 'meta',
          meta_template_name: tpl.name,
        })
      }

      // Handle pagination
      url = data.paging?.next || null
    }
  } catch (err) {
    console.error('[Templates] Failed to fetch Meta templates:', err)
  }

  return allTemplates
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
    category: 'UTILITY',
    language: 'en'
  }
]

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('organizationId')

    // Determine which provider this org uses
    let whatsappConfig = {
      provider: process.env.WHATSAPP_PROVIDER || 'twilio',
      apiToken: process.env.WHATSAPP_API_TOKEN || '',
      graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION || 'v25.0',
      businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
    }

    if (orgId) {
      try {
        whatsappConfig = await getOrgWhatsappConfig(orgId)
      } catch (e) {
        console.warn('[Templates] Failed to load org whatsapp config:', e)
      }
    }

    let twilioList: any[] = []
    let metaList: any[] = []

    if (whatsappConfig.provider === 'facebook') {
      // Fetch templates from Meta WhatsApp Business Cloud API
      try {
        metaList = await fetchMetaTemplates(
          whatsappConfig.apiToken,
          whatsappConfig.graphApiVersion,
          whatsappConfig.businessAccountId
        )
      } catch (metaErr) {
        console.warn('[Templates] Failed to fetch from Meta WhatsApp API:', metaErr)
      }
    } else {
      // Fetch templates from Twilio Content API
      try {
        const client = await getTwilioClientForOrg(orgId)
        const twilioTemplates = await client.content.v1.contents.list({ limit: 50 })
        
        if (twilioTemplates) {
          twilioList = twilioTemplates.map((item: any) => {
            const types = item.types || {}
            let body = ''
            
            if (types['twilio/text']) {
              body = types['twilio/text'].body
            } else if (types['twilio/media']) {
              body = types['twilio/media'].body || ''
            } else if (types['twilio/card']) {
              body = types['twilio/card'].body || ''
            } else {
              const firstType = Object.keys(types)[0]
              if (firstType && types[firstType]) {
                body = types[firstType].body || types[firstType].text || ''
              }
            }

            const variables: string[] = []
            const varMatches = body.match(/\{\{[^\}]+\}\}/g)
            if (varMatches) {
              varMatches.forEach((match: string) => {
                const variable = match.replace(/[\{\}]/g, '')
                if (!variables.includes(variable)) {
                  variables.push(variable)
                }
              })
            }

            return {
              sid: item.sid,
              name: item.friendlyName || item.sid,
              body: body,
              variables: variables,
              category: 'UTILITY',
              language: 'en',
              isDbTemplate: false
            }
          })
        }
      } catch (apiError) {
        console.warn('Failed to fetch from Twilio Content API, loading DB templates next:', apiError)
      }
    }

    let dbList: any[] = []
    if (orgId) {
      try {
        const supabase = getSupabaseClient()
        const { data: dbTemplates } = await supabase
          .from('message_templates')
          .select('*')
          .eq('organization_id', orgId)
          .eq('status', 'APPROVED')

        if (dbTemplates) {
          dbList = dbTemplates.map((t: any) => {
            const variables: string[] = []
            const varMatches = t.body.match(/\{\{[^\}]+\}\}/g)
            if (varMatches) {
              varMatches.forEach((match: string) => {
                const variable = match.replace(/[\{\}]/g, '')
                if (!variables.includes(variable)) {
                  variables.push(variable)
                }
              })
            }
            return {
              sid: t.id,
              name: t.name,
              body: t.body,
              variables: variables,
              category: t.category || 'UTILITY',
              language: t.language || 'en',
              isDbTemplate: true
            }
          })
        }
      } catch (dbErr) {
        console.error('Failed to fetch templates from database:', dbErr)
      }
    }

    // Merge: DB templates first, then provider-specific templates (Meta or Twilio)
    const mergedTemplates = [...dbList, ...metaList, ...twilioList]

    if (mergedTemplates.length === 0) {
      return NextResponse.json({ templates: fallbackTemplates })
    }

    return NextResponse.json({ templates: mergedTemplates })
  } catch (error) {
    console.error('Templates fetch general error:', error)
    return NextResponse.json({ templates: fallbackTemplates })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { organizationId, name, category, language, body: templateBody } = body

    if (!organizationId || !name || !templateBody) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const supabase = getSupabaseClient()
    const { data, error } = await supabase
      .from('message_templates')
      .insert({
        organization_id: organizationId,
        name: name.trim().toLowerCase(),
        category: category || 'UTILITY',
        language: language || 'en',
        body: templateBody,
        status: 'APPROVED',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single()

    if (error) {
      console.error('Failed to create database template:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, template: data })
  } catch (error: any) {
    console.error('Template POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing template ID' }, { status: 400 })
    }

    const supabase = getSupabaseClient()
    const { error } = await supabase
      .from('message_templates')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Failed to delete template:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Template DELETE error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
