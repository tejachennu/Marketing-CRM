import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { createClient } from '@supabase/supabase-js'
import { verifyOrgAccess, verifyRecordAccess } from '@/lib/api-auth-helper'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

async function getTwilioClientForOrg(orgId: string | null) {
  const isMasterOrg = !orgId || orgId === '303b7a2d-281c-403c-b794-54d1e195ca69'

  let TWILIO_ACCOUNT_SID = isMasterOrg ? (process.env.TWILIO_ACCOUNT_SID || '') : ''
  let TWILIO_AUTH_TOKEN = isMasterOrg ? (process.env.TWILIO_AUTH_TOKEN || '') : ''

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
    .select('whatsapp_provider, whatsapp_api_token, whatsapp_graph_api_version, whatsapp_business_account_id, whatsapp_phone_number_id')
    .eq('id', orgId)
    .single()

  const isMasterOrg = !orgId || orgId === '303b7a2d-281c-403c-b794-54d1e195ca69'

  return {
    provider: orgData?.whatsapp_provider || (isMasterOrg ? (process.env.WHATSAPP_PROVIDER || 'twilio') : 'twilio'),
    apiToken: orgData?.whatsapp_api_token || (isMasterOrg ? (process.env.WHATSAPP_API_TOKEN || '') : ''),
    graphApiVersion: orgData?.whatsapp_graph_api_version || (isMasterOrg ? (process.env.WHATSAPP_GRAPH_API_VERSION || 'v25.0') : 'v25.0'),
    businessAccountId: orgData?.whatsapp_business_account_id || (isMasterOrg ? (process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '') : ''),
    phoneNumberId: orgData?.whatsapp_phone_number_id || (isMasterOrg ? (process.env.WHATSAPP_PHONE_NUMBER_ID || '') : ''),
  }
}


// Fetch templates from Meta WhatsApp Business Cloud API
async function fetchMetaTemplates(
  apiToken: string, 
  graphApiVersion: string, 
  businessAccountId: string, 
  phoneNumberId?: string
): Promise<{ templates: any[]; error: string | null }> {
  if (!apiToken) {
    console.warn('[Templates] Missing Meta API token, skipping Meta template fetch')
    return { templates: [], error: 'Missing Meta WhatsApp API Cloud Token in Settings.' }
  }

  let wabaId = businessAccountId
  let resolveErr: string | null = null

  if (!wabaId && phoneNumberId) {
    try {
      console.log(`[Templates] Attempting to auto-resolve Meta WABA ID for Phone ID ${phoneNumberId}...`)
      const phoneRes = await fetch(`https://graph.facebook.com/${graphApiVersion}/${phoneNumberId}?fields=whatsapp_business_account&access_token=${apiToken}`)
      if (phoneRes.ok) {
        const phoneData = await phoneRes.json()
        if (phoneData.whatsapp_business_account?.id) {
          wabaId = phoneData.whatsapp_business_account.id
          console.log(`[Templates] Auto-resolved Meta WABA ID: ${wabaId}`)
        }
      } else {
        const pErr = await phoneRes.json().catch(() => null)
        resolveErr = pErr?.error?.message || `Failed to resolve WABA ID (HTTP ${phoneRes.status})`
      }
    } catch (err: any) {
      console.warn('[Templates] Failed to resolve WABA ID from Phone ID:', err)
      resolveErr = err.message || 'Failed to resolve WABA ID from Phone ID'
    }
  }

  if (!wabaId) {
    console.warn('[Templates] Missing Meta WABA ID and could not resolve from Phone ID')
    return { templates: [], error: resolveErr || 'Missing WhatsApp Business Account ID (WABA ID) in Settings.' }
  }

  const allTemplates: any[] = []
  let version = graphApiVersion || 'v20.0'
  let url: string | null = `https://graph.facebook.com/${version}/${wabaId}/message_templates?fields=name,status,category,language,components,id&limit=100&access_token=${apiToken}`
  let lastError: string | null = null

  try {
    while (url) {
      let res: Response = await fetch(url)

      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        const errMsg = errData?.error?.message || `Meta API error (${res.status})`
        console.error(`[Templates] Meta API error: ${res.status}`, errData || errMsg)
        lastError = `Meta WhatsApp API error: ${errMsg}`

        // If version error (e.g. v25.0 unsupported), try falling back to v20.0
        if (version !== 'v20.0' && (errData?.error?.code === 15 || errMsg.includes('version'))) {
          console.log('[Templates] Retrying Meta API with fallback version v20.0...')
          version = 'v20.0'
          url = `https://graph.facebook.com/${version}/${wabaId}/message_templates?fields=name,status,category,language,components,id&limit=100&access_token=${apiToken}`
          res = await fetch(url)
          if (!res.ok) {
            const errData2 = await res.json().catch(() => null)
            lastError = `Meta WhatsApp API error: ${errData2?.error?.message || errMsg}`
            break
          }
        } else {
          break
        }
      }

      const data = await res.json()
      const templates = data.data || []

      for (const tpl of templates) {
        // Only include APPROVED templates (case-insensitive check)
        const status = (tpl.status || '').toUpperCase()
        if (status !== 'APPROVED') continue

        // Extract body text and scan components for variables/placeholders
        let body = ''
        const components = tpl.components || []
        const variables: string[] = []
        const sampleValues: Record<string, string> = {}

        // 1. Process HEADER component
        const headerComp = components.find((c: any) => (c.type || '').toUpperCase() === 'HEADER')
        if (headerComp) {
          const handle = headerComp.example?.header_handle?.[0] || ''
          if (headerComp.format === 'IMAGE') {
            if (handle) sampleValues['header_image_url'] = handle
          } else if (headerComp.format === 'VIDEO') {
            if (handle) sampleValues['header_video_url'] = handle
          } else if (headerComp.format === 'DOCUMENT') {
            if (handle) {
              sampleValues['header_document_url'] = handle
              sampleValues['header_document_filename'] = 'document.pdf'
            }
          } else if (headerComp.format === 'TEXT' && headerComp.text) {
            const headerVarMatches = headerComp.text.match(/\{\{[^\}]+\}\}/g)
            if (headerVarMatches) {
              variables.push('header_text_1')
              const sampleText = headerComp.example?.header_text?.[0] || ''
              if (sampleText) sampleValues['header_text_1'] = sampleText
            }
          }
        }

        // 2. Process BODY component
        const bodyComp = components.find((c: any) => (c.type || '').toUpperCase() === 'BODY')
        if (bodyComp) {
          body = bodyComp.text || ''
          const namedParams = bodyComp.example?.body_text_named_params
          if (Array.isArray(namedParams) && namedParams.length > 0) {
            namedParams.forEach((paramObj: any) => {
              const variable = paramObj.param_name
              if (variable && !variables.includes(variable)) {
                variables.push(variable)
              }
              if (paramObj.example) {
                sampleValues[variable] = paramObj.example
              }
            })
          } else {
            const varMatches = body.match(/\{\{[^\}]+\}\}/g)
            if (varMatches) {
              const bodyExamples = bodyComp.example?.body_text?.[0] || []
              varMatches.forEach((match: string, idx: number) => {
                const variable = match.replace(/[\{\}]/g, '')
                if (/^[a-zA-Z0-9_]+$/.test(variable) && !variables.includes(variable)) {
                  variables.push(variable)
                }
                const exampleVal = bodyExamples[idx] || ''
                if (exampleVal) {
                  sampleValues[variable] = exampleVal
                }
              })
            }
          }
        }

        // 3. Process BUTTONS component
        const buttonsComp = components.find((c: any) => (c.type || '').toUpperCase() === 'BUTTONS')
        if (buttonsComp && Array.isArray(buttonsComp.buttons)) {
          buttonsComp.buttons.forEach((btn: any, idx: number) => {
            if (btn.type === 'URL' && btn.url) {
              const btnVarMatches = btn.url.match(/\{\{[^\}]+\}\}/g)
              if (btnVarMatches) {
                const varName = `button_url_${idx + 1}`
                variables.push(varName)
                const exampleVal = btn.example?.url_text?.[0] || ''
                if (exampleVal) {
                  sampleValues[varName] = exampleVal
                }
              }
            } else if (btn.type === 'COPY_CODE') {
              const varName = `button_copy_code_${idx + 1}`
              variables.push(varName)
            }
          })
        }

        allTemplates.push({
          sid: `META_${tpl.id}`,
          name: `${tpl.name} (Meta Approved)`,
          body: body,
          variables: variables,
          sampleValues: sampleValues,
          components: components,
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
  } catch (err: any) {
    console.error('[Templates] Failed to fetch Meta templates:', err)
    lastError = err.message || 'Error fetching Meta templates'
  }

  return { templates: allTemplates, error: allTemplates.length > 0 ? null : lastError }
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

    if (orgId) {
      const authResult = await verifyOrgAccess(request, orgId)
      if (!authResult.authorized) {
        return NextResponse.json({ error: authResult.error }, { status: authResult.status })
      }
    }

    // Determine which provider this org uses
    let whatsappConfig = {
      provider: process.env.WHATSAPP_PROVIDER || 'twilio',
      apiToken: process.env.WHATSAPP_API_TOKEN || '',
      graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION || 'v25.0',
      businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    }

    if (orgId) {
      try {
        whatsappConfig = await getOrgWhatsappConfig(orgId)
      } catch (e) {
        console.warn('[Templates] Failed to load org whatsapp config:', e)
      }
    }

    console.log(`[Templates] Config for org ${orgId}: provider=${whatsappConfig.provider}, hasApiToken=${!!whatsappConfig.apiToken}, hasWABA=${!!whatsappConfig.businessAccountId}, hasPhoneId=${!!whatsappConfig.phoneNumberId}, graphVer=${whatsappConfig.graphApiVersion}`)

    let twilioList: any[] = []
    let metaList: any[] = []
    let metaApiError: string | null = null

    const shouldFetchMeta = whatsappConfig.provider === 'facebook' || (!!whatsappConfig.apiToken && (!!whatsappConfig.businessAccountId || !!whatsappConfig.phoneNumberId))
    console.log(`[Templates] shouldFetchMeta=${shouldFetchMeta}`)

    if (shouldFetchMeta) {
      // Fetch templates from Meta WhatsApp Business Cloud API
      try {
        const metaRes = await fetchMetaTemplates(
          whatsappConfig.apiToken,
          whatsappConfig.graphApiVersion,
          whatsappConfig.businessAccountId,
          whatsappConfig.phoneNumberId
        )
        metaList = metaRes.templates
        metaApiError = metaRes.error
        console.log(`[Templates] Meta fetch returned ${metaList.length} templates (Error: ${metaApiError || 'none'})`)
      } catch (metaErr: any) {
        console.warn('[Templates] Failed to fetch from Meta WhatsApp API:', metaErr)
        metaApiError = metaErr.message || 'Failed to fetch Meta WhatsApp templates'
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
      return NextResponse.json({ templates: fallbackTemplates, error: metaApiError, provider: whatsappConfig.provider })
    }

    return NextResponse.json({ templates: mergedTemplates, error: metaApiError, provider: whatsappConfig.provider })
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

    const authResult = await verifyOrgAccess(request, organizationId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
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

    const recordResult = await verifyRecordAccess(request, 'message_templates', id)
    if (!recordResult.authorized) {
      return NextResponse.json({ error: recordResult.error }, { status: recordResult.status })
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
