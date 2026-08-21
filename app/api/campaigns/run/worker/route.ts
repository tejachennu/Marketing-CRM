import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'
import nodemailer from 'nodemailer'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseKey)
}

const mediaCache: Record<string, string> = {}

async function uploadMediaUrlToMeta(url: string, apiToken: string, phoneNumberId: string): Promise<string | null> {
  if (mediaCache[url]) {
    return mediaCache[url];
  }

  try {
    const downloadRes = await fetch(url);
    if (!downloadRes.ok) return null;

    const contentType = downloadRes.headers.get('content-type') || 'image/png';
    const arrayBuffer = await downloadRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const fileBlob = new Blob([buffer], { type: contentType });
    const formData = new FormData();
    const extension = contentType.split('/')[1] || 'png';
    formData.append('file', fileBlob, `file.${extension}`);
    formData.append('messaging_product', 'whatsapp');

    const uploadRes = await fetch(`https://graph.facebook.com/v25.0/${phoneNumberId}/media`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`
      },
      body: formData
    });

    const data = await uploadRes.json();
    if (!uploadRes.ok) return null;

    mediaCache[url] = data.id;
    return data.id;
  } catch (err) {
    console.error(`[Campaign Worker] uploadMediaUrlToMeta failed:`, err);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { campaignId } = body

    if (!campaignId) {
      return NextResponse.json({ error: 'Campaign ID is required' }, { status: 400 })
    }

    const supabase = getSupabaseClient()

    // 1. Update status to PROCESSING
    await supabase
      .from('campaigns')
      .update({ status: 'PROCESSING', updated_at: new Date().toISOString() })
      .eq('id', campaignId)

    // 2. Fetch campaign details
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .maybeSingle()

    if (campaignError || !campaign) {
      console.error(`[Campaign Worker] Failed to fetch campaign ${campaignId}:`, campaignError)
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    const channel = campaign.channel || 'whatsapp'
    const campaignSender = campaign.sender
    const campaignSubject = campaign.subject

    // 3. Fetch ALL pending delivery logs (with chunked pagination to handle 5k+ logs)
    let logs: any[] = []
    let fetchOffset = 0
    const logBatchSize = 1000
    let hasMoreLogs = true

    while (hasMoreLogs) {
      const { data: logChunk, error: logsError } = await supabase
        .from('campaign_logs')
        .select('*')
        .eq('campaign_id', campaignId)
        .eq('status', 'PENDING')
        .range(fetchOffset, fetchOffset + logBatchSize - 1)

      if (logsError) {
        console.error(`[Campaign Worker] Error fetching logs chunk for ${campaignId}:`, logsError)
        break
      }

      if (logChunk && logChunk.length > 0) {
        logs = logs.concat(logChunk)
        fetchOffset += logChunk.length
        if (logChunk.length < logBatchSize) {
          hasMoreLogs = false
        }
      } else {
        hasMoreLogs = false
      }
    }

    if (logs.length === 0) {
      // Check if all logs are already completed
      const { count: pendingCount } = await supabase
        .from('campaign_logs')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .eq('status', 'PENDING')

      if (!pendingCount || pendingCount === 0) {
        const { count: finalSent } = await supabase
          .from('campaign_logs')
          .select('id', { count: 'exact', head: true })
          .eq('campaign_id', campaignId)
          .eq('status', 'SENT')

        const { count: finalFailed } = await supabase
          .from('campaign_logs')
          .select('id', { count: 'exact', head: true })
          .eq('campaign_id', campaignId)
          .eq('status', 'FAILED')

        await supabase
          .from('campaigns')
          .update({
            status: 'COMPLETED',
            sent_count: finalSent || 0,
            failed_count: finalFailed || 0,
            updated_at: new Date().toISOString()
          })
          .eq('id', campaignId)
      }

      return NextResponse.json({ success: true, message: 'No pending logs remaining' })
    }

    const isMasterOrg = !campaign.organization_id || campaign.organization_id === '303b7a2d-281c-403c-b794-54d1e195ca69'

    // Load custom credentials per organization
    let twilioAccountSid = isMasterOrg ? (process.env.TWILIO_ACCOUNT_SID || '') : ''
    let twilioAuthToken = isMasterOrg ? (process.env.TWILIO_AUTH_TOKEN || '') : ''
    let TWILIO_WHATSAPP_NUMBER = isMasterOrg ? (process.env.TWILIO_WHATSAPP_NUMBER || '') : ''
    let sendgridKey = isMasterOrg ? (process.env.SENDGRID_API_KEY || '') : ''
    let sendgridFromEmail = isMasterOrg ? (process.env.SENDGRID_FROM_EMAIL || 'no-reply@example.com') : ''
    let emailProvider = 'sendgrid'
    let smtpHost = ''
    let smtpPort = 587
    let smtpEmail = ''
    let smtpPassword = ''
    let whatsappProvider = isMasterOrg ? (process.env.WHATSAPP_PROVIDER || 'twilio') : 'twilio'
    let whatsappApiToken = isMasterOrg ? (process.env.WHATSAPP_API_TOKEN || '') : ''
    let whatsappDefaultPhone = isMasterOrg ? (process.env.WHATSAPP_DEFAULT_PHONE || '') : ''
    let whatsappGraphApiVersion = isMasterOrg ? (process.env.WHATSAPP_GRAPH_API_VERSION || 'v25.0') : 'v25.0'
    let whatsappPhoneNumberId = isMasterOrg ? (process.env.WHATSAPP_PHONE_NUMBER_ID || '') : ''

    if (campaign.organization_id) {
      try {
        const { data: orgData } = await supabase
          .from('organizations')
          .select('twilio_account_sid, twilio_auth_token, twilio_whatsapp_number, sendgrid_api_key, sendgrid_from_email, email_provider, smtp_host, smtp_port, smtp_email, smtp_password, whatsapp_provider, whatsapp_api_token, whatsapp_default_phone, whatsapp_graph_api_version, whatsapp_phone_number_id')
          .eq('id', campaign.organization_id)
          .maybeSingle()

        if (orgData) {
          if (orgData.twilio_account_sid) twilioAccountSid = orgData.twilio_account_sid
          if (orgData.twilio_auth_token) twilioAuthToken = orgData.twilio_auth_token
          if (orgData.twilio_whatsapp_number) TWILIO_WHATSAPP_NUMBER = orgData.twilio_whatsapp_number
          if (orgData.sendgrid_api_key) sendgridKey = orgData.sendgrid_api_key
          if (orgData.sendgrid_from_email) sendgridFromEmail = orgData.sendgrid_from_email
          if (orgData.email_provider) emailProvider = orgData.email_provider
          if (orgData.smtp_host) smtpHost = orgData.smtp_host
          if (orgData.smtp_port) smtpPort = orgData.smtp_port
          if (orgData.smtp_email) smtpEmail = orgData.smtp_email
          if (orgData.smtp_password) smtpPassword = orgData.smtp_password
          if (orgData.whatsapp_provider) whatsappProvider = orgData.whatsapp_provider
          if (orgData.whatsapp_api_token) whatsappApiToken = orgData.whatsapp_api_token
          if (orgData.whatsapp_default_phone) whatsappDefaultPhone = orgData.whatsapp_default_phone
          if (orgData.whatsapp_graph_api_version) whatsappGraphApiVersion = orgData.whatsapp_graph_api_version
          if (orgData.whatsapp_phone_number_id) whatsappPhoneNumberId = orgData.whatsapp_phone_number_id
        }
      } catch (dbErr) {
        console.error('[Campaign Worker] Error loading database credentials:', dbErr)
      }
    }

    let metaTemplateComponents: any[] = []
    let metaTemplateLanguageFromApi: string | null = null
    let metaTemplateNameFromApi: string | null = null

    if (channel === 'whatsapp' && whatsappProvider === 'facebook' && campaign.template_sid && campaign.template_sid.startsWith('META_')) {
      const templateId = campaign.template_sid.replace('META_', '')
      try {
        const tplRes = await fetch(`https://graph.facebook.com/${whatsappGraphApiVersion}/${templateId}?access_token=${whatsappApiToken}`)
        if (tplRes.ok) {
          const tplData = await tplRes.json()
          metaTemplateComponents = tplData.components || []
          if (tplData.language) metaTemplateLanguageFromApi = tplData.language
          if (tplData.name) metaTemplateNameFromApi = tplData.name
          console.log(`[Campaign Worker] Successfully fetched Meta template info: name=${tplData.name}, language=${tplData.language}`)
        }
      } catch (err) {
        console.error(`[Campaign Worker] Error fetching Meta template components:`, err)
      }
    }

    let _twilioClient: ReturnType<typeof twilio> | null = null
    function getTwilioClientForCampaign() {
      if (!_twilioClient) {
        if (!twilioAccountSid || !twilioAuthToken) {
          throw new Error('Twilio credentials must be configured in settings')
        }
        _twilioClient = twilio(twilioAccountSid, twilioAuthToken)
      }
      return _twilioClient
    }

    const { count: initialSent } = await supabase
      .from('campaign_logs')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('status', 'SENT')

    const { count: initialFailed } = await supabase
      .from('campaign_logs')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('status', 'FAILED')

    let sentCount = initialSent || 0
    let failedCount = initialFailed || 0

    const MAX_RUN_LOGS = 40
    const logsToProcess = logs.slice(0, MAX_RUN_LOGS)
    const BATCH_SIZE = 10

    for (let i = 0; i < logsToProcess.length; i += BATCH_SIZE) {
      const { data: latestCamp } = await supabase
        .from('campaigns')
        .select('status')
        .eq('id', campaignId)
        .maybeSingle()

      if (latestCamp && (latestCamp.status === 'STOPPED' || latestCamp.status === 'CANCELLED')) {
        console.log(`[Campaign Worker] Campaign ${campaignId} was STOPPED. Exiting chunk.`)
        return NextResponse.json({ success: true, message: 'Campaign execution stopped by user.' })
      }

      const batchChunk = logsToProcess.slice(i, i + BATCH_SIZE)

      await Promise.allSettled(
        batchChunk.map(async (log) => {
          const recipientPhone = log.phone_number
          const recipientEmail = log.email_address
          const mappedVars = log.variables_mapped || {}
          
          let twilioMessageSid = null
          let errorMessage = null
          let status = 'SENT'
          
          try {
            if (channel === 'whatsapp') {
              if (!recipientPhone) throw new Error('Recipient phone number is missing in campaign log')

              if (whatsappProvider === 'facebook') {
                if (!whatsappApiToken || !whatsappPhoneNumberId) {
                  throw new Error('Facebook WhatsApp API credentials must be configured in settings')
                }

                const cleanToFb = recipientPhone.replace('whatsapp:', '').replace('+', '').trim()
                let templateName = ''
                let templateLanguage = 'en'
                let templateBody = campaign.template_body || ''

                if (campaign.template_sid) {
                  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(campaign.template_sid)) {
                    const { data: dbTpl } = await supabase
                      .from('message_templates')
                      .select('*')
                      .eq('id', campaign.template_sid)
                      .maybeSingle()
                    if (dbTpl) {
                      templateName = dbTpl.name
                      templateLanguage = dbTpl.language || 'en'
                      templateBody = dbTpl.body
                    }
                  } else if (campaign.template_sid.startsWith('META_')) {
                    const rawName = metaTemplateNameFromApi || campaign.template_name || campaign.template_sid.replace('META_', '')
                    templateName = rawName.split('•')[0].replace(/\s*\(Meta Approved\)/i, '').trim()
                    
                    const tagMatch = (campaign.template_name || '').match(/\[([a-z]{2}(?:_[A-Z]{2})?)\]/i)
                    templateLanguage = metaTemplateLanguageFromApi || campaign.template_language || tagMatch?.[1] || 'en'
                  } else if (campaign.template_sid.startsWith('HX_')) {
                    const matchedFallback = [
                      { sid: 'HX_welcome_campaign', name: 'welcome_campaign', body: 'Hello {{1}}, welcome to {{2}}! We are thrilled to have you onboard.', language: 'en' },
                      { sid: 'HX_promotion_discount', name: 'promotion_discount', body: 'Hey {{1}}! Get {{2}}% off on all our services this weekend. Use code {{3}} at checkout.', language: 'en' },
                      { sid: 'HX_follow_up_lead', name: 'follow_up_lead', body: 'Hi {{1}}, this is {{2}} from {{3}}. Just following up on our previous conversation regarding your inquiry. Let us know if you have any questions!', language: 'en' }
                    ].find(t => t.sid === campaign.template_sid)

                    if (matchedFallback) {
                      templateName = matchedFallback.name
                      templateLanguage = matchedFallback.language || 'en'
                      templateBody = matchedFallback.body
                    }
                  } else {
                    templateName = campaign.template_sid
                  }
                }

                if (templateName) {
                  templateName = templateName.replace(/\s*\(Meta Approved\)/i, '').trim()
                }

                let payload: any = {
                  messaging_product: 'whatsapp',
                  recipient_type: 'individual',
                  to: cleanToFb,
                }

                if (templateName) {
                  payload.type = 'template'
                  payload.template = {
                    name: templateName,
                    language: { code: templateLanguage }
                  }

                  if (metaTemplateComponents && metaTemplateComponents.length > 0) {
                    const reqComponents: any[] = []
                    const parseMediaParam = async (val: string) => {
                      const cleaned = String(val || '').trim();
                      if (cleaned.includes('scontent.whatsapp.net') || cleaned.includes('fbcdn.net')) {
                        const uploadedId = await uploadMediaUrlToMeta(cleaned, whatsappApiToken, whatsappPhoneNumberId);
                        if (uploadedId) return { id: uploadedId };
                      }
                      if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) return { link: cleaned };
                      return { id: cleaned };
                    };

                    for (const comp of metaTemplateComponents) {
                      if (comp.type === 'HEADER') {
                        if (comp.format === 'IMAGE') {
                          const imgVal = mappedVars['header_image_url'] || mappedVars['header_link'] || mappedVars['header_media_url'] || comp.example?.header_handle?.[0] || '';
                          if (imgVal) {
                            const mediaParam = await parseMediaParam(imgVal);
                            reqComponents.push({ type: 'header', parameters: [{ type: 'image', image: mediaParam }] })
                          }
                        } else if (comp.format === 'VIDEO') {
                          const videoVal = mappedVars['header_video_url'] || mappedVars['header_link'] || mappedVars['header_media_url'] || comp.example?.header_handle?.[0] || '';
                          if (videoVal) {
                            const mediaParam = await parseMediaParam(videoVal);
                            reqComponents.push({ type: 'header', parameters: [{ type: 'video', video: mediaParam }] })
                          }
                        } else if (comp.format === 'DOCUMENT') {
                          const docVal = mappedVars['header_document_url'] || mappedVars['header_link'] || mappedVars['header_media_url'] || comp.example?.header_handle?.[0] || '';
                          if (docVal) {
                            const filename = mappedVars['header_document_filename'] || docVal.split('/').pop()?.split('?')[0] || comp.example?.header_handle?.[0]?.split('/').pop()?.split('?')[0] || 'document.pdf';
                            const mediaParam = await parseMediaParam(docVal);
                            reqComponents.push({ type: 'header', parameters: [{ type: 'document', document: { ...mediaParam, filename } }] })
                          }
                        } else if (comp.format === 'TEXT') {
                          const headerVal = mappedVars['header_text_1'] || mappedVars['header_1'] || comp.example?.header_text?.[0] || '';
                          if (headerVal) {
                            reqComponents.push({ type: 'header', parameters: [{ type: 'text', text: headerVal }] })
                          }
                        }
                      } else if (comp.type === 'BODY') {
                        const bodyText = comp.text || '';
                        let uniqueKeys: string[] = [];
                        const namedParams = comp.example?.body_text_named_params;
                        if (Array.isArray(namedParams) && namedParams.length > 0) {
                          uniqueKeys = namedParams.map((p: any) => p.param_name).filter(Boolean);
                        } else {
                          const placeholders = bodyText.match(/\{\{([^}]+)\}\}/g) || [];
                          const rawKeys = Array.from(new Set(placeholders.map((m: string) => m.replace(/[\{\}]/g, '')))) as string[];
                          uniqueKeys = rawKeys.filter(k => /^[a-zA-Z0-9_]+$/.test(k));
                          const isNumeric = uniqueKeys.every(k => !isNaN(Number(k)));
                          if (isNumeric) uniqueKeys.sort((a, b) => Number(a) - Number(b));
                        }

                        const isNamed = Array.isArray(namedParams) && namedParams.length > 0;
                        const parameters = uniqueKeys.map(key => {
                          const val = mappedVars[key] !== undefined ? mappedVars[key] : (mappedVars[key.toLowerCase()] !== undefined ? mappedVars[key.toLowerCase()] : '');
                          const paramObj: any = { type: 'text', text: String(val) };
                          if (isNamed && isNaN(Number(key))) paramObj.parameter_name = key;
                          return paramObj;
                        });

                        if (parameters.length > 0) reqComponents.push({ type: 'body', parameters });
                      } else if (comp.type === 'BUTTONS' && Array.isArray(comp.buttons)) {
                        comp.buttons.forEach((btn: any, idx: number) => {
                          if (btn.type === 'URL') {
                            const hasVar = btn.url && btn.url.includes('{{1}}');
                            if (hasVar) {
                              const val = mappedVars[`button_url_${idx + 1}`] || mappedVars['button_url_1'] || '';
                              reqComponents.push({ type: 'button', sub_type: 'url', index: String(idx), parameters: [{ type: 'text', text: val }] });
                            }
                          } else if (btn.type === 'COPY_CODE') {
                            const val = mappedVars[`button_copy_code_${idx + 1}`] || mappedVars['button_copy_code'] || '';
                            if (val) {
                              reqComponents.push({ type: 'button', sub_type: 'copy_code', index: String(idx), parameters: [{ type: 'text', text: val }] });
                            }
                          }
                        });
                      }
                    }

                    if (reqComponents.length > 0) payload.template.components = reqComponents
                  } else {
                    const placeholders = templateBody.match(/\{\{([^}]+)\}\}/g) || []
                    let uniqueKeys = Array.from(new Set(placeholders.map((m: string) => m.replace(/[\{\}]/g, '')))) as string[]
                    uniqueKeys = uniqueKeys.filter(k => /^[a-zA-Z0-9_]+$/.test(k))
                    const isNumeric = uniqueKeys.every(k => !isNaN(Number(k)))
                    if (isNumeric) uniqueKeys.sort((a, b) => Number(a) - Number(b))

                    const parameters = uniqueKeys.map((key, idx) => {
                      const positionalKey = String(idx + 1);
                      const val = mappedVars[key] !== undefined 
                        ? mappedVars[key] 
                        : (mappedVars[key.toLowerCase()] !== undefined 
                            ? mappedVars[key.toLowerCase()] 
                            : (mappedVars[positionalKey] !== undefined ? mappedVars[positionalKey] : ''));
                      return {
                        type: 'text',
                        text: String(val)
                      };
                    })

                    if (parameters.length > 0) payload.template.components = [{ type: 'body', parameters }]
                  }
                } else {
                  let body = campaign.template_body || ''
                  Object.entries(mappedVars).forEach(([key, val]) => {
                    body = body.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val))
                  })
                  payload.type = 'text'
                  payload.text = { body }
                }

                const fbRes = await fetch(`https://graph.facebook.com/${whatsappGraphApiVersion}/${whatsappPhoneNumberId}/messages`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${whatsappApiToken}` },
                  body: JSON.stringify(payload)
                })

                if (!fbRes.ok) {
                  const errData = await fbRes.json().catch(() => null)
                  const metaErrCode = errData?.error?.code
                  const metaErrMsg = errData?.error?.message || `HTTP ${fbRes.status}`
                  const metaDetails = errData?.error?.error_data?.details || ''

                  if (metaErrCode === 132001 || metaErrMsg.includes('132001') || metaErrMsg.includes('does not exist in the translation')) {
                    throw new Error(
                      `WhatsApp Meta Error #132001: Template '${templateName}' does not exist in translation '${templateLanguage}'. ` +
                      `Ensure the template is approved in Meta WhatsApp Business Manager with language code '${templateLanguage}' (e.g. en_US vs en) or update the template language.`
                    )
                  }

                  throw new Error(`Meta WhatsApp API error (${metaErrCode || fbRes.status}): ${metaErrMsg}${metaDetails ? ` - ${metaDetails}` : ''}`)
                }

                const fbData = await fbRes.json()
                twilioMessageSid = fbData.messages?.[0]?.id ? `FB_${fbData.messages[0].id}` : `FB_${Date.now()}`
                sentCount++
              } else {
                const twilioParams: any = { to: recipientPhone.startsWith('whatsapp:') ? recipientPhone : `whatsapp:${recipientPhone}` }
                if (campaignSender && campaignSender.startsWith('MG')) {
                  twilioParams.messagingServiceSid = campaignSender
                } else {
                  let fromNumber = campaignSender || `whatsapp:${TWILIO_WHATSAPP_NUMBER}`
                  if (!fromNumber.startsWith('whatsapp:')) fromNumber = `whatsapp:${fromNumber}`
                  twilioParams.from = fromNumber
                }
                const isRealTwilioSid = campaign.template_sid && /^HX[0-9a-f]{32}$/i.test(campaign.template_sid)
                if (isRealTwilioSid) {
                  twilioParams.contentSid = campaign.template_sid
                  twilioParams.contentVariables = JSON.stringify(mappedVars)
                } else {
                  let body = campaign.template_body || ''
                  Object.entries(mappedVars).forEach(([key, val]) => {
                    body = body.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val))
                  })
                  twilioParams.body = body
                }

                try {
                  const twilioClient = getTwilioClientForCampaign()
                  const messageResponse = await twilioClient.messages.create(twilioParams)
                  twilioMessageSid = messageResponse.sid
                  sentCount++
                } catch (twilioErr: any) {
                  const code = twilioErr.code || twilioErr.status
                  const msg = twilioErr.message || String(twilioErr)
                  
                  if (code === 63016 || msg.includes('63016') || msg.includes('132001') || msg.includes('translation') || msg.includes('Freeform message')) {
                    throw new Error(
                      `Twilio WhatsApp Error 63016 / Meta #132001: WhatsApp template could not be delivered. ` +
                      `If using a template, verify that the template is approved in Meta WhatsApp Business Manager and its language locale (e.g., en_US vs en) matches the Twilio Content Template SID (${campaign.template_sid || 'N/A'}). ` +
                      `Original error: ${msg}`
                    )
                  }
                  if (code === 21620 || msg.includes('21620')) {
                    throw new Error(
                      `Twilio Error 21620: Invalid Content SID or Content Variables mismatch for template (${campaign.template_sid || 'N/A'}). Original error: ${msg}`
                    )
                  }
                  throw new Error(`Twilio error (${code || 'Unknown'}): ${msg}`)
                }
              }
            } else if (channel === 'sms') {
              if (!recipientPhone) throw new Error('Recipient phone number is missing')
              if (!campaignSender) throw new Error('Campaign sender is required')
              const cleanTo = recipientPhone.replace('whatsapp:', '')
              let body = campaign.template_body || ''
              Object.entries(mappedVars).forEach(([key, val]) => {
                body = body.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val))
              })
              const twilioParams: any = { to: cleanTo, body }
              if (campaignSender.startsWith('MG')) twilioParams.messagingServiceSid = campaignSender
              else twilioParams.from = campaignSender

              const twilioClient = getTwilioClientForCampaign()
              const messageResponse = await twilioClient.messages.create(twilioParams)
              twilioMessageSid = messageResponse.sid
              sentCount++
            } else if (channel === 'email') {
              if (!recipientEmail) throw new Error('Recipient email is missing')
              const fromEmail = campaignSender || (emailProvider === 'smtp' ? smtpEmail : sendgridFromEmail)
              const subjectText = campaignSubject || `Campaign: ${campaign.name}`
              let body = campaign.template_body || ''
              Object.entries(mappedVars).forEach(([key, val]) => {
                body = body.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val))
              })
              const hasHtmlTags = /<[a-z][\s\S]*>/i.test(body)
              const htmlBody = hasHtmlTags ? body : `<div style="font-family: sans-serif; padding: 20px;">${body}</div>`
              const plainTextBody = hasHtmlTags ? body.replace(/<[^>]*>/g, '') : body

              if (emailProvider === 'smtp') {
                const transporter = nodemailer.createTransport({
                  host: smtpHost, port: smtpPort || 587, secure: smtpPort === 465,
                  auth: { user: smtpEmail, pass: smtpPassword }
                })
                const info = await transporter.sendMail({ from: fromEmail, to: recipientEmail, subject: subjectText, text: plainTextBody, html: htmlBody })
                twilioMessageSid = info.messageId || `SMTP_${Date.now()}`
              } else {
                const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sendgridKey}` },
                  body: JSON.stringify({ personalizations: [{ to: [{ email: recipientEmail }] }], from: { email: fromEmail }, subject: subjectText, content: [{ type: 'text/plain', value: plainTextBody }, { type: 'text/html', value: htmlBody }] })
                })
                if (!response.ok) throw new Error(`SendGrid API error: ${response.status}`)
                twilioMessageSid = `SG_${Date.now()}`
              }
              sentCount++
            }
          } catch (err: any) {
            console.warn(`[Campaign Worker] Dispatch failed:`, err)
            errorMessage = err.message || String(err)
            status = 'FAILED'
            failedCount++
          }

          await supabase.from('campaign_logs').update({ status, error_message: errorMessage, message_sid: twilioMessageSid }).eq('id', log.id)

          if (status === 'SENT') {
            try {
              // Extract contact names intelligently
              const explicitFirst = mappedVars['first_name'] || mappedVars['firstName']
              const explicitLast = mappedVars['last_name'] || mappedVars['lastName']
              let firstName = 'Campaign'
              let lastName = 'Contact'

              if (explicitFirst) {
                firstName = String(explicitFirst).trim()
                lastName = explicitLast ? String(explicitLast).trim() : ''
              } else {
                const rawFullName = mappedVars['name'] || 
                                    mappedVars['contact_name'] || 
                                    mappedVars['customer_name'] || 
                                    mappedVars['patient_name'] || 
                                    mappedVars['client_name'] || 
                                    mappedVars['full_name'] || 
                                    mappedVars['1'] || ''
                const cleanedName = String(rawFullName).trim()

                if (cleanedName) {
                  const explicitSecondVar = mappedVars['last_name'] || mappedVars['surname']
                  if (explicitSecondVar) {
                    firstName = cleanedName
                    lastName = String(explicitSecondVar).trim()
                  } else {
                    const parts = cleanedName.split(/\s+/).filter(Boolean)
                    if (parts.length === 1) {
                      firstName = parts[0]
                      lastName = ''
                    } else if (parts.length > 1) {
                      firstName = parts[0]
                      lastName = parts.slice(1).join(' ')
                    }
                  }
                }
              }

              const contactCompany = mappedVars['company'] || mappedVars['organization'] || 'Campaign Contact'

              // Extract contact tags
              const rawTags = mappedVars['tag'] || mappedVars['tags'] || mappedVars['category'] || mappedVars['group'] || mappedVars['segment']
              let contactTags: string[] = []
              if (rawTags) {
                if (Array.isArray(rawTags)) {
                  contactTags = rawTags.map(t => String(t).trim()).filter(Boolean)
                } else {
                  contactTags = String(rawTags).split(/[,;]/).map(t => t.trim()).filter(Boolean)
                }
              }
              if (campaign.name && !contactTags.includes(campaign.name)) {
                contactTags.push(campaign.name)
              }

              let contactId = null
              if (channel === 'email') {
                const cleanEmail = recipientEmail ? recipientEmail.toLowerCase().trim() : ''
                const { data: existingContact } = await supabase.from('contacts').select('id, first_name, last_name, tags').eq('email', cleanEmail).maybeSingle()
                if (existingContact) {
                  contactId = existingContact.id
                  const existingTags = Array.isArray(existingContact.tags) ? existingContact.tags : []
                  const mergedTags = Array.from(new Set([...existingTags, ...contactTags]))
                  const needsNameUpdate = (!existingContact.first_name || existingContact.first_name === 'Campaign') && firstName !== 'Campaign'

                  if (needsNameUpdate || mergedTags.length > existingTags.length) {
                    await supabase.from('contacts').update({ ...(needsNameUpdate ? { first_name: firstName, last_name: lastName } : {}), tags: mergedTags }).eq('id', existingContact.id)
                  }
                } else {
                  const { data: newContact } = await supabase.from('contacts').insert([{ organization_id: campaign.organization_id, first_name: firstName, last_name: lastName, email: cleanEmail, company: contactCompany, tags: contactTags }]).select().maybeSingle()
                  if (newContact) contactId = newContact.id
                }
              } else {
                const cleanPhone = recipientPhone ? recipientPhone.replace('whatsapp:', '') : ''
                const { data: existingContact } = await supabase.from('contacts').select('id, first_name, last_name, tags').eq('phone_number', cleanPhone).maybeSingle()
                if (existingContact) {
                  contactId = existingContact.id
                  const existingTags = Array.isArray(existingContact.tags) ? existingContact.tags : []
                  const mergedTags = Array.from(new Set([...existingTags, ...contactTags]))
                  const needsNameUpdate = (!existingContact.first_name || existingContact.first_name === 'Campaign') && firstName !== 'Campaign'

                  if (needsNameUpdate || mergedTags.length > existingTags.length) {
                    await supabase.from('contacts').update({ ...(needsNameUpdate ? { first_name: firstName, last_name: lastName } : {}), tags: mergedTags }).eq('id', existingContact.id)
                  }
                } else {
                  const { data: newContact } = await supabase.from('contacts').insert([{ organization_id: campaign.organization_id, first_name: firstName, last_name: lastName, phone_number: cleanPhone, company: contactCompany, tags: contactTags }]).select().maybeSingle()
                  if (newContact) contactId = newContact.id
                }
              }

              if (contactId) {
                let conversationId = null
                const { data: existingConv } = await supabase.from('conversations').select('id').eq('contact_id', contactId).eq('organization_id', campaign.organization_id).maybeSingle()
                if (existingConv) conversationId = existingConv.id
                else {
                  const { data: newConv } = await supabase.from('conversations').insert([{ organization_id: campaign.organization_id, contact_id: contactId, is_active: true, last_message_at: new Date().toISOString() }]).select().maybeSingle()
                  if (newConv) conversationId = newConv.id
                }

                if (conversationId) {
                  let finalBody = campaign.template_body || ''
                  Object.entries(mappedVars).forEach(([k, v]) => { finalBody = finalBody.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v)) })
                  const recordBody = channel === 'email' ? `[Email Subject: ${campaignSubject || `Campaign: ${campaign.name}`}]\n\n${finalBody}` : finalBody

                  await supabase.from('messages').insert([{ organization_id: campaign.organization_id, conversation_id: conversationId, sender_type: 'user', body: recordBody, twilio_message_sid: twilioMessageSid }])
                  await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId)
                }
              }
            } catch (syncError) {
              console.error('[Campaign Worker] Error syncing message to CRM logs:', syncError)
            }
          }
        })
      )

      await supabase
        .from('campaigns')
        .update({ sent_count: sentCount, failed_count: failedCount, updated_at: new Date().toISOString() })
        .eq('id', campaignId)
    }

    // Check remaining pending logs
    const { count: remainingPending } = await supabase
      .from('campaign_logs')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('status', 'PENDING')

    if (remainingPending && remainingPending > 0) {
      console.log(`[Campaign Worker] ${remainingPending} pending logs remaining for campaign ${campaignId}. Auto-triggering next chunk...`)
      const origin = request.nextUrl.origin
      fetch(`${origin}/api/campaigns/run/worker`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId })
      }).catch(err => console.error('[Campaign Worker] Error triggering next chunk:', err))
    } else {
      const { count: finalSent } = await supabase
        .from('campaign_logs')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .eq('status', 'SENT')

      const { count: finalFailed } = await supabase
        .from('campaign_logs')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .eq('status', 'FAILED')

      await supabase
        .from('campaigns')
        .update({
          status: 'COMPLETED',
          sent_count: finalSent || 0,
          failed_count: finalFailed || 0,
          updated_at: new Date().toISOString()
        })
        .eq('id', campaignId)
    }

    return NextResponse.json({ success: true, message: 'Chunk processed successfully.' })
  } catch (error: any) {
    console.error(`[Campaign Worker] General execution failure:`, error)
    return NextResponse.json({ error: error.message || 'Worker failure' }, { status: 500 })
  }
}
