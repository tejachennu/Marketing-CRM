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
    console.log(`[Campaign Worker] Cache hit for media URL: ${url} -> Media ID: ${mediaCache[url]}`);
    return mediaCache[url];
  }

  try {
    console.log(`[Campaign Worker] Downloading media from URL to re-upload to Meta: ${url}`);
    const downloadRes = await fetch(url);
    if (!downloadRes.ok) {
      throw new Error(`Failed to download media: ${downloadRes.status} ${downloadRes.statusText}`);
    }

    const contentType = downloadRes.headers.get('content-type') || 'image/png';
    const arrayBuffer = await downloadRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Create Blob and FormData dynamically
    const fileBlob = new Blob([buffer], { type: contentType });
    const formData = new FormData();
    const extension = contentType.split('/')[1] || 'png';
    formData.append('file', fileBlob, `file.${extension}`);
    formData.append('messaging_product', 'whatsapp');

    console.log(`[Campaign Worker] Uploading buffer to Meta /media for Phone ID ${phoneNumberId}...`);
    const uploadRes = await fetch(`https://graph.facebook.com/v25.0/${phoneNumberId}/media`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`
      },
      body: formData
    });

    const data = await uploadRes.json();
    if (!uploadRes.ok) {
      throw new Error(`Upload failed: ${JSON.stringify(data)}`);
    }

    console.log(`[Campaign Worker] Successfully uploaded media. Retrieved Media ID: ${data.id}`);
    mediaCache[url] = data.id;
    return data.id;
  } catch (err) {
    console.error(`[Campaign Worker] uploadMediaUrlToMeta failed:`, err);
    return null;
  }
}

// Background worker function (not awaited in POST response)
async function executeCampaign(campaignId: string) {
  const supabase = getSupabaseClient()
  
  try {
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
      .single()

    if (campaignError || !campaign) {
      console.error(`[Campaign Worker] Failed to fetch campaign ${campaignId}:`, campaignError)
      return
    }

    const channel = campaign.channel || 'whatsapp'
    const campaignSender = campaign.sender
    const campaignSubject = campaign.subject

    // 3. Fetch pending delivery logs
    const { data: logs, error: logsError } = await supabase
      .from('campaign_logs')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('status', 'PENDING')

    if (logsError || !logs) {
      console.error(`[Campaign Worker] Failed to fetch pending logs for campaign ${campaignId}:`, logsError)
      return
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
          .single()

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
    if (channel === 'whatsapp' && whatsappProvider === 'facebook' && campaign.template_sid && campaign.template_sid.startsWith('META_')) {
      const templateId = campaign.template_sid.replace('META_', '')
      try {
        const tplRes = await fetch(`https://graph.facebook.com/${whatsappGraphApiVersion}/${templateId}?access_token=${whatsappApiToken}`)
        if (tplRes.ok) {
          const tplData = await tplRes.json()
          metaTemplateComponents = tplData.components || []
          console.log(`[Campaign Worker] Successfully fetched template components:`, JSON.stringify(metaTemplateComponents))
        } else {
          const errText = await tplRes.text()
          console.warn(`[Campaign Worker] Failed to fetch template components for ${templateId}: ${tplRes.status} ${errText}`)
        }
      } catch (err) {
        console.error(`[Campaign Worker] Error fetching Meta template components:`, err)
      }
    }

    // Create Twilio client lazily — only when a Twilio-dependent channel needs it
    let _twilioClient: ReturnType<typeof twilio> | null = null
    function getTwilioClientForCampaign() {
      if (!_twilioClient) {
        if (!twilioAccountSid || !twilioAuthToken) {
          throw new Error('Twilio credentials (Account SID & Auth Token) must be configured in settings to send SMS or WhatsApp messages via Twilio')
        }
        _twilioClient = twilio(twilioAccountSid, twilioAuthToken)
      }
      return _twilioClient
    }    // Count initial sent and failed logs from DB so counters accumulate accurately
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

    const MAX_RUN_LOGS = 50
    const logsToProcess = logs.slice(0, MAX_RUN_LOGS)
    const BATCH_SIZE = 10

    for (let i = 0; i < logsToProcess.length; i += BATCH_SIZE) {
      // Check if campaign status was updated to STOPPED or CANCELLED
      const { data: latestCamp } = await supabase
        .from('campaigns')
        .select('status')
        .eq('id', campaignId)
        .maybeSingle()

      if (latestCamp && (latestCamp.status === 'STOPPED' || latestCamp.status === 'CANCELLED')) {
        console.log(`[Campaign Worker] Campaign ${campaignId} was STOPPED by user. Halting execution.`)
        return
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
              // WhatsApp Channel
              if (!recipientPhone) {
                throw new Error('Recipient phone number is missing in campaign log')
              }

              if (whatsappProvider === 'facebook') {
                if (!whatsappApiToken || !whatsappPhoneNumberId) {
                  throw new Error('Facebook WhatsApp API credentials (API Token & Phone ID) must be configured in settings')
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
                    // Meta template fetched from WhatsApp Business Cloud API
                    // The campaign.template_name contains "name (Meta Approved)" format
                    const rawName = campaign.template_name || campaign.template_sid.replace('META_', '')
                    templateName = rawName.replace(/\s*\(Meta Approved\)/i, '').trim()
                    templateLanguage = campaign.template_language || 'en'
                  } else if (campaign.template_sid.startsWith('HX_')) {
                    const matchedFallback = [
                      {
                        sid: 'HX_welcome_campaign',
                        name: 'welcome_campaign',
                        body: 'Hello {{1}}, welcome to {{2}}! We are thrilled to have you onboard.',
                        language: 'en'
                      },
                      {
                        sid: 'HX_promotion_discount',
                        name: 'promotion_discount',
                        body: 'Hey {{1}}! Get {{2}}% off on all our services this weekend. Use code {{3}} at checkout.',
                        language: 'en'
                      },
                      {
                        sid: 'HX_follow_up_lead',
                        name: 'follow_up_lead',
                        body: 'Hi {{1}}, this is {{2}} from {{3}}. Just following up on our previous conversation regarding your inquiry. Let us know if you have any questions!',
                        language: 'en'
                      }
                    ].find(t => t.sid === campaign.template_sid)

                    if (matchedFallback) {
                      templateName = matchedFallback.name
                      templateLanguage = matchedFallback.language || 'en'
                      templateBody = matchedFallback.body
                    }
                  } else if (campaign.template_sid.startsWith('HX')) {
                    // Ignore real Twilio Content SID prefix, fallback to direct text payload
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
                    language: {
                      code: templateLanguage
                    }
                  }

                  if (metaTemplateComponents && metaTemplateComponents.length > 0) {
                    const reqComponents: any[] = []
                    const parseMediaParam = async (val: string) => {
                      const cleaned = String(val || '').trim();

                      // Download and upload to Meta to get a valid live Media ID if it is a Facebook scontent/fbcdn URL
                      if (cleaned.includes('scontent.whatsapp.net') || cleaned.includes('fbcdn.net')) {
                        const uploadedId = await uploadMediaUrlToMeta(cleaned, whatsappApiToken, whatsappPhoneNumberId);
                        if (uploadedId) {
                          return { id: uploadedId };
                        }
                      }

                      if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
                        return { link: cleaned };
                      }
                      return { id: cleaned };
                    };

                    for (const comp of metaTemplateComponents) {
                      if (comp.type === 'HEADER') {
                        if (comp.format === 'IMAGE') {
                          const imgVal = mappedVars['header_image_url'] || mappedVars['header_link'] || mappedVars['header_media_url'] || comp.example?.header_handle?.[0] || '';
                          if (imgVal) {
                            const mediaParam = await parseMediaParam(imgVal);
                            reqComponents.push({
                              type: 'header',
                              parameters: [
                                {
                                  type: 'image',
                                  image: mediaParam
                                }
                              ]
                            })
                          }
                        } else if (comp.format === 'VIDEO') {
                          const videoVal = mappedVars['header_video_url'] || mappedVars['header_link'] || mappedVars['header_media_url'] || comp.example?.header_handle?.[0] || '';
                          if (videoVal) {
                            const mediaParam = await parseMediaParam(videoVal);
                            reqComponents.push({
                              type: 'header',
                              parameters: [
                                {
                                  type: 'video',
                                  video: mediaParam
                                }
                              ]
                            })
                          }
                        } else if (comp.format === 'DOCUMENT') {
                          const docVal = mappedVars['header_document_url'] || mappedVars['header_link'] || mappedVars['header_media_url'] || comp.example?.header_handle?.[0] || '';
                          if (docVal) {
                            const filename = mappedVars['header_document_filename'] || docVal.split('/').pop()?.split('?')[0] || comp.example?.header_handle?.[0]?.split('/').pop()?.split('?')[0] || 'document.pdf';
                            const mediaParam = await parseMediaParam(docVal);
                            reqComponents.push({
                              type: 'header',
                              parameters: [
                                {
                                  type: 'document',
                                  document: {
                                    ...mediaParam,
                                    filename: filename
                                  }
                                }
                              ]
                            })
                          }
                        } else if (comp.format === 'TEXT') {
                          const headerVal = mappedVars['header_text_1'] || mappedVars['header_1'] || comp.example?.header_text?.[0] || '';
                          if (headerVal) {
                            reqComponents.push({
                              type: 'header',
                              parameters: [
                                {
                                  type: 'text',
                                  text: headerVal
                                }
                              ]
                            })
                          }
                        }
                        
                      } else if (comp.type === 'BODY') {
                        const bodyText = comp.text || '';
                        let uniqueKeys: string[] = [];

                        // 1. If Meta explicitly defines named parameters in body_text_named_params, use that exact order
                        const namedParams = comp.example?.body_text_named_params;
                        if (Array.isArray(namedParams) && namedParams.length > 0) {
                          uniqueKeys = namedParams.map((p: any) => p.param_name).filter(Boolean);
                        } else {
                          // 2. Otherwise parse bodyText for {{...}} placeholders
                          const placeholders = bodyText.match(/\{\{([^}]+)\}\}/g) || [];
                          const rawKeys = Array.from(new Set(placeholders.map((m: string) => m.replace(/[\{\}]/g, '')))) as string[];
                          
                          // Filter out invalid Meta parameter names (e.g. containing spaces like {{event name}})
                          uniqueKeys = rawKeys.filter(k => /^[a-zA-Z0-9_]+$/.test(k));
                          
                          const isNumeric = uniqueKeys.every(k => !isNaN(Number(k)));
                          if (isNumeric) {
                            uniqueKeys.sort((a, b) => Number(a) - Number(b));
                          }
                        }

                        const isNamed = Array.isArray(namedParams) && namedParams.length > 0;
                        const parameters = uniqueKeys.map(key => {
                          const val = mappedVars[key] !== undefined 
                            ? mappedVars[key] 
                            : (mappedVars[key.toLowerCase()] !== undefined ? mappedVars[key.toLowerCase()] : '');
                          const paramObj: any = {
                            type: 'text',
                            text: String(val)
                          };
                          if (isNamed && isNaN(Number(key))) {
                            paramObj.parameter_name = key;
                          }
                          return paramObj;
                        });

                        if (parameters.length > 0) {
                          reqComponents.push({
                            type: 'body',
                            parameters: parameters
                          });
                        }
                      } else if (comp.type === 'BUTTONS' && Array.isArray(comp.buttons)) {
                        comp.buttons.forEach((btn: any, idx: number) => {
                          if (btn.type === 'URL') {
                            const hasVar = btn.url && btn.url.includes('{{1}}');
                            if (hasVar) {
                              const val = mappedVars[`button_url_${idx + 1}`] || mappedVars['button_url_1'] || '';
                              reqComponents.push({
                                type: 'button',
                                sub_type: 'url',
                                index: String(idx),
                                parameters: [
                                  {
                                    type: 'text',
                                    text: val
                                  }
                                ]
                              });
                            }
                          } else if (btn.type === 'COPY_CODE') {
                            const val = mappedVars[`button_copy_code_${idx + 1}`] || mappedVars['button_copy_code'] || '';
                            if (val) {
                              reqComponents.push({
                                type: 'button',
                                sub_type: 'copy_code',
                                index: String(idx),
                                parameters: [
                                  {
                                    type: 'text',
                                    text: val
                                  }
                                ]
                              });
                            }
                          }
                        });
                      }
                    }

                    if (reqComponents.length > 0) {
                      payload.template.components = reqComponents
                    }
                  } else {
                    const placeholders = templateBody.match(/\{\{([^}]+)\}\}/g) || []
                    let uniqueKeys = Array.from(new Set(placeholders.map((m: string) => m.replace(/[\{\}]/g, '')))) as string[]
                    
                    // Filter out invalid Meta parameter names (e.g. containing spaces like {{event name}})
                    uniqueKeys = uniqueKeys.filter(k => /^[a-zA-Z0-9_]+$/.test(k))
                    
                    const isNumeric = uniqueKeys.every(k => !isNaN(Number(k)))
                    if (isNumeric) {
                      uniqueKeys.sort((a, b) => Number(a) - Number(b))
                    }

                    const parameters = uniqueKeys.map(key => ({
                      type: 'text',
                      text: String(mappedVars[key] !== undefined ? mappedVars[key] : (mappedVars[key.toLowerCase()] !== undefined ? mappedVars[key.toLowerCase()] : ''))
                    }))

                    if (parameters.length > 0) {
                      payload.template.components = [
                        {
                          type: 'body',
                          parameters: parameters
                        }
                      ]
                    }
                  }
                } else {
                  let body = campaign.template_body || ''
                  Object.entries(mappedVars).forEach(([key, val]) => {
                    body = body.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val))
                  })

                  payload.type = 'text'
                  payload.text = {
                    body: body
                  }
                }

                const fbRes = await fetch(`https://graph.facebook.com/${whatsappGraphApiVersion}/${whatsappPhoneNumberId}/messages`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${whatsappApiToken}`
                  },
                  body: JSON.stringify(payload)
                })

                if (!fbRes.ok) {
                  const errText = await fbRes.text()
                  throw new Error(`Facebook API error: ${fbRes.status} ${errText}`)
                }

                const fbData = await fbRes.json()
                twilioMessageSid = fbData.messages?.[0]?.id ? `FB_${fbData.messages[0].id}` : `FB_${Date.now()}`
                sentCount++
              } else {
                const twilioParams: any = {
                  to: recipientPhone.startsWith('whatsapp:') ? recipientPhone : `whatsapp:${recipientPhone}`
                }

                if (campaignSender && campaignSender.startsWith('MG')) {
                  twilioParams.messagingServiceSid = campaignSender
                } else {
                  let fromNumber = campaignSender || `whatsapp:${TWILIO_WHATSAPP_NUMBER}`
                  if (!fromNumber.startsWith('whatsapp:')) {
                    fromNumber = `whatsapp:${fromNumber}`
                  }
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

                const twilioClient = getTwilioClientForCampaign()
                const messageResponse = await twilioClient.messages.create(twilioParams)
                twilioMessageSid = messageResponse.sid
                sentCount++
              }
            } else if (channel === 'sms') {
              // SMS Channel
              if (!recipientPhone) {
                throw new Error('Recipient phone number is missing in campaign log')
              }

              if (!campaignSender) {
                throw new Error('Campaign sender (phone number or messaging service SID) is required for SMS campaigns')
              }

              // If phone number starts with whatsapp:, remove it
              const cleanTo = recipientPhone.replace('whatsapp:', '')

              // Construct message body by replacing {{1}}, {{2}} locally
              let body = campaign.template_body || ''
              Object.entries(mappedVars).forEach(([key, val]) => {
                body = body.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val))
              })

              const twilioParams: any = {
                to: cleanTo,
                body: body
              }

              if (campaignSender.startsWith('MG')) {
                twilioParams.messagingServiceSid = campaignSender
              } else {
                twilioParams.from = campaignSender
              }

              const twilioClient = getTwilioClientForCampaign()
              const messageResponse = await twilioClient.messages.create(twilioParams)
              twilioMessageSid = messageResponse.sid
              sentCount++
            } else if (channel === 'email') {
              if (!recipientEmail) {
                throw new Error('Recipient email is missing in campaign log')
              }

              const fromEmail = campaignSender || (emailProvider === 'smtp' ? smtpEmail : sendgridFromEmail)
              const subjectText = campaignSubject || `Campaign: ${campaign.name}`

              // Construct HTML and Plain Text bodies
              let body = campaign.template_body || ''
              Object.entries(mappedVars).forEach(([key, val]) => {
                body = body.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val))
              })

              const hasHtmlTags = /<[a-z][\s\S]*>/i.test(body)
              const htmlBody = hasHtmlTags
                ? body
                : `<div style="font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif; font-size: 14px; color: #111b21; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e9edef; border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.02);">
                     <div style="margin-bottom: 20px; border-bottom: 1px solid #e9edef; padding-bottom: 15px;">
                       <h2 style="margin: 0; color: #008069; font-size: 18px; font-weight: bold;">Message from ${campaign.name}</h2>
                     </div>
                     <div style="white-space: pre-line;">
                       ${body}
                     </div>
                     <div style="margin-top: 30px; border-top: 1px solid #e9edef; padding-top: 15px; font-size: 11px; color: #8696a0; text-align: center; font-weight: 500;">
                       Sent from Consular Helpdesk campaigns.
                     </div>
                   </div>`

              const plainTextBody = hasHtmlTags ? body.replace(/<[^>]*>/g, '') : body

              if (emailProvider === 'smtp') {
                if (!smtpHost || !smtpEmail || !smtpPassword) {
                  throw new Error('SMTP Host, email username, and password must be configured in settings to run SMTP campaigns')
                }

                const transporter = nodemailer.createTransport({
                  host: smtpHost,
                  port: smtpPort || 587,
                  secure: smtpPort === 465, // true for 465, false for other ports
                  auth: {
                    user: smtpEmail,
                    pass: smtpPassword
                  }
                })

                const mailOptions = {
                  from: fromEmail,
                  to: recipientEmail,
                  subject: subjectText,
                  text: plainTextBody,
                  html: htmlBody
                }

                const info = await transporter.sendMail(mailOptions)
                twilioMessageSid = info.messageId || `SMTP_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
              } else {
                // Email Channel (SendGrid)
                if (!sendgridKey) {
                  throw new Error('SendGrid API key (SENDGRID_API_KEY) is not configured in environment')
                }

                const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${sendgridKey}`
                  },
                  body: JSON.stringify({
                    personalizations: [
                      {
                        to: [{ email: recipientEmail }]
                      }
                    ],
                    from: { email: fromEmail },
                    subject: subjectText,
                    content: [
                      {
                        type: 'text/plain',
                        value: plainTextBody
                      },
                      {
                        type: 'text/html',
                        value: htmlBody
                      }
                    ]
                  })
                })

                if (!response.ok) {
                  const errText = await response.text()
                  throw new Error(`SendGrid API error: ${response.status} ${errText}`)
                }

                twilioMessageSid = `SG_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
              }
              sentCount++
            } else {
              throw new Error(`Unsupported campaign channel: ${channel}`)
            }
          } catch (err: any) {
            console.warn(`[Campaign Worker] Dispatch failed for recipient:`, err)
            errorMessage = err.message || String(err)
            status = 'FAILED'
            failedCount++
          }

          // Update delivery log in DB
          await supabase
            .from('campaign_logs')
            .update({
              status,
              error_message: errorMessage,
              message_sid: twilioMessageSid
            })
            .eq('id', log.id)

          // If sent successfully, sync to CRM messages & conversations
          if (status === 'SENT') {
            try {
              // 1. Get or create Contact
              let contactId = null
              
              if (channel === 'email') {
                const cleanEmail = recipientEmail ? recipientEmail.toLowerCase().trim() : ''
                const { data: existingContact } = await supabase
                  .from('contacts')
                  .select('id')
                  .eq('email', cleanEmail)
                  .maybeSingle()

                if (existingContact) {
                  contactId = existingContact.id
                } else {
                  const firstName = mappedVars['1'] || 'Campaign'
                  const lastName = mappedVars['2'] || 'Contact'
                  const { data: newContact, error: createContactError } = await supabase
                    .from('contacts')
                    .insert([
                      {
                        organization_id: campaign.organization_id,
                        first_name: firstName,
                        last_name: lastName,
                        email: cleanEmail,
                        company: 'Campaign Contact'
                      }
                    ])
                    .select()
                    .maybeSingle()
                  
                  if (!createContactError && newContact) {
                    contactId = newContact.id
                  }
                }
              } else {
                const cleanPhone = recipientPhone ? recipientPhone.replace('whatsapp:', '') : ''
                const { data: existingContact } = await supabase
                  .from('contacts')
                  .select('id')
                  .eq('phone_number', cleanPhone)
                  .maybeSingle()

                if (existingContact) {
                  contactId = existingContact.id
                } else {
                  const firstName = mappedVars['1'] || 'Campaign'
                  const lastName = mappedVars['2'] || 'Contact'
                  const { data: newContact, error: createContactError } = await supabase
                    .from('contacts')
                    .insert([
                      {
                        organization_id: campaign.organization_id,
                        first_name: firstName,
                        last_name: lastName,
                        phone_number: cleanPhone,
                        company: 'Campaign Contact'
                      }
                    ])
                    .select()
                    .maybeSingle()
                  
                  if (!createContactError && newContact) {
                    contactId = newContact.id
                  }
                }
              }

              if (contactId) {
                // 2. Get or create Conversation
                let conversationId = null
                const { data: existingConv } = await supabase
                  .from('conversations')
                  .select('id')
                  .eq('contact_id', contactId)
                  .eq('organization_id', campaign.organization_id)
                  .maybeSingle()

                if (existingConv) {
                  conversationId = existingConv.id
                } else {
                  const { data: newConv, error: createConvError } = await supabase
                    .from('conversations')
                    .insert([
                      {
                        organization_id: campaign.organization_id,
                        contact_id: contactId,
                        is_active: true,
                        last_message_at: new Date().toISOString()
                      }
                    ])
                    .select()
                    .maybeSingle()

                  if (!createConvError && newConv) {
                    conversationId = newConv.id
                  }
                }

                if (conversationId) {
                  // Construct body for CRM records
                  let finalBody = campaign.template_body || ''
                  Object.entries(mappedVars).forEach(([key, val]) => {
                    finalBody = finalBody.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val))
                  })

                  const recordBody = channel === 'email'
                    ? `[Email Subject: ${campaignSubject || `Campaign: ${campaign.name}`}]\n\n${finalBody}`
                    : finalBody

                  // 3. Store message in DB
                  await supabase
                    .from('messages')
                    .insert([
                      {
                        organization_id: campaign.organization_id,
                        conversation_id: conversationId,
                        sender_type: 'user',
                        body: recordBody,
                        twilio_message_sid: twilioMessageSid
                      }
                    ])

                  // Update conversation timestamp
                  await supabase
                    .from('conversations')
                    .update({ last_message_at: new Date().toISOString() })
                    .eq('id', conversationId)
                }
              }
            } catch (syncError) {
              console.error('[Campaign Worker] Error syncing message to CRM logs:', syncError)
            }
          }
        })
      )

      // Update campaign progress incrementally per batch chunk
      await supabase
        .from('campaigns')
        .update({
          sent_count: sentCount,
          failed_count: failedCount,
          updated_at: new Date().toISOString()
        })
        .eq('id', campaignId)
    }

    // Check if there are still remaining PENDING logs for this campaign
    const { count: remainingPending } = await supabase
      .from('campaign_logs')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('status', 'PENDING')

    if (remainingPending && remainingPending > 0) {
      console.log(`[Campaign Worker] ${remainingPending} pending logs remaining for campaign ${campaignId}. Auto-triggering next chunk...`)
      // Self-trigger next chunk execution asynchronously
      executeCampaign(campaignId)
    } else {
      // All logs processed! Mark campaign as COMPLETED
      await supabase
        .from('campaigns')
        .update({
          status: 'COMPLETED',
          sent_count: sentCount,
          failed_count: failedCount,
          updated_at: new Date().toISOString()
        })
        .eq('id', campaignId)
      console.log(`[Campaign Worker] Campaign ${campaignId} fully COMPLETED! Sent: ${sentCount}, Failed: ${failedCount}`)
    }

  } catch (error) {
    console.error(`[Campaign Worker] General execution failure for campaign ${campaignId}:`, error)
    await supabase
      .from('campaigns')
      .update({
        status: 'FAILED',
        updated_at: new Date().toISOString()
      })
      .eq('id', campaignId)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { campaignId } = body

    if (!campaignId) {
      return NextResponse.json(
        { error: 'Campaign ID is required' },
        { status: 400 }
      )
    }

    const origin = request.nextUrl.origin
    // Trigger background worker via independent HTTP request for serverless production safety
    fetch(`${origin}/api/campaigns/run/worker`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaignId })
    }).catch(err => console.error('[API] Error triggering campaign worker:', err))

    return NextResponse.json({
      success: true,
      message: 'Campaign processing started in the background.'
    })
  } catch (error) {
    console.error('[API] Run campaign error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start campaign' },
      { status: 500 }
    )
  }
}
