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

export async function runCampaignWorker(campaignId: string): Promise<{ success: boolean; message: string; error?: string }> {
  try {
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
      return { success: false, error: 'Campaign not found', message: 'Campaign not found' }
    }

    const channel = campaign.channel || 'whatsapp'
    const campaignSender = campaign.sender
    const campaignSubject = campaign.subject

    // 3. Check if there are any pending delivery logs before starting
    const { count: initialPendingCount } = await supabase
      .from('campaign_logs')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('status', 'PENDING')

    if (!initialPendingCount || initialPendingCount === 0) {
      const { count: finalSent } = await supabase
        .from('campaign_logs')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .in('status', ['SENT', 'DELIVERED', 'READ'])

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

      return { success: true, message: 'No pending logs remaining. Campaign marked as COMPLETED.' }
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

    // Graceful environment fallbacks if organization has missing or malformed credentials
    if ((!twilioAccountSid || !twilioAccountSid.startsWith('AC')) && process.env.TWILIO_ACCOUNT_SID) {
      twilioAccountSid = process.env.TWILIO_ACCOUNT_SID
      if (process.env.TWILIO_AUTH_TOKEN) twilioAuthToken = process.env.TWILIO_AUTH_TOKEN
    }
    if (!TWILIO_WHATSAPP_NUMBER && process.env.TWILIO_WHATSAPP_NUMBER) {
      TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER
    }
    if (!sendgridKey && process.env.SENDGRID_API_KEY) {
      sendgridKey = process.env.SENDGRID_API_KEY
    }
    if (!sendgridFromEmail || sendgridFromEmail === 'no-reply@example.com') {
      sendgridFromEmail = process.env.SENDGRID_FROM_EMAIL || 'support@consularhelpdesk.com'
    }
    if (!smtpHost && process.env.HOSTINGER_SMTP_HOST) {
      smtpHost = process.env.HOSTINGER_SMTP_HOST
      smtpPort = Number(process.env.HOSTINGER_SMTP_PORT || 587)
      smtpEmail = process.env.HOSTINGER_SMTP_USER || ''
      smtpPassword = process.env.HOSTINGER_SMTP_PASS || ''
      if (!sendgridKey) emailProvider = 'smtp'
    }
    if (!whatsappApiToken && process.env.META_SYSTEM_USER_TOKEN) {
      whatsappApiToken = process.env.META_SYSTEM_USER_TOKEN
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
      .in('status', ['SENT', 'DELIVERED', 'READ'])

    const { count: initialFailed } = await supabase
      .from('campaign_logs')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('status', 'FAILED')

    let sentCount = initialSent || 0
    let failedCount = initialFailed || 0

    const BATCH_SIZE = 15

    // Continuous processing loop: runs until all PENDING logs are sent or campaign is STOPPED
    while (true) {
      // 1. Check if campaign was STOPPED or CANCELLED by user
      const { data: latestCamp } = await supabase
        .from('campaigns')
        .select('status')
        .eq('id', campaignId)
        .maybeSingle()

      if (latestCamp && (latestCamp.status === 'STOPPED' || latestCamp.status === 'CANCELLED')) {
        console.log(`[Campaign Worker] Campaign ${campaignId} was ${latestCamp.status}. Ceasing worker execution cleanly.`)
        break
      }

      // 2. Fetch the next micro-batch of PENDING logs directly from DB
      const { data: batchChunk, error: batchErr } = await supabase
        .from('campaign_logs')
        .select('*')
        .eq('campaign_id', campaignId)
        .eq('status', 'PENDING')
        .order('created_at', { ascending: true })
        .limit(BATCH_SIZE)

      if (batchErr) {
        console.error(`[Campaign Worker] Error fetching batch for campaign ${campaignId}:`, batchErr)
        break
      }

      if (!batchChunk || batchChunk.length === 0) {
        console.log(`[Campaign Worker] All pending logs processed for campaign ${campaignId}. Finishing.`)
        break
      }

      let rateLimitEncountered = false

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

                let cleanToFb = recipientPhone.replace(/^whatsapp:/i, '').replace(/^\+/, '').trim()
                if (cleanToFb.length === 10 && /^[6-9]/.test(cleanToFb)) {
                  cleanToFb = `91${cleanToFb}`
                }
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
                      {
                        sid: 'HX_welcome_campaign',
                        name: 'welcome_campaign',
                        body: 'Hello {{1}}, welcome to {{2}}! We are thrilled to have you onboard.',
                        language: 'en'
                      },
                      {
                        sid: 'HX_promo_discount',
                        name: 'promo_discount',
                        body: 'Special offer! Get {{1}} off on your next purchase using code {{2}}.',
                        language: 'en'
                      },
                      {
                        sid: 'HX_order_update',
                        name: 'order_update',
                        body: 'Your order #{{1}} has been updated. Status: {{2}}.',
                        language: 'en'
                      }
                    ].find(t => t.sid === campaign.template_sid)

                    if (matchedFallback) {
                      templateName = matchedFallback.name
                      templateLanguage = matchedFallback.language
                      templateBody = matchedFallback.body
                    }
                  } else {
                    templateName = campaign.template_sid
                  }
                }

                if (templateName) {
                  templateName = templateName.replace(/\s*\(Meta Approved\)/i, '').trim()
                }

                const payload: any = {
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
                          const imgVal = mappedVars['header_image_url'] || mappedVars['header_link'] || mappedVars['header_media_url'] || campaign.media_url || comp.example?.header_handle?.[0] || '';
                          if (imgVal) {
                            const mediaParam = await parseMediaParam(imgVal);
                            reqComponents.push({ type: 'header', parameters: [{ type: 'image', image: mediaParam }] })
                          }
                        } else if (comp.format === 'VIDEO') {
                          const videoVal = mappedVars['header_video_url'] || mappedVars['header_link'] || mappedVars['header_media_url'] || campaign.media_url || comp.example?.header_handle?.[0] || '';
                          if (videoVal) {
                            const mediaParam = await parseMediaParam(videoVal);
                            reqComponents.push({ type: 'header', parameters: [{ type: 'video', video: mediaParam }] })
                          }
                        } else if (comp.format === 'DOCUMENT') {
                          const docVal = mappedVars['header_document_url'] || mappedVars['header_link'] || mappedVars['header_media_url'] || campaign.media_url || comp.example?.header_handle?.[0] || '';
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

                        const parameters = uniqueKeys.map((key, idx) => {
                          const positionalKey = String(idx + 1);
                          let val = mappedVars[key] !== undefined 
                            ? mappedVars[key] 
                            : (mappedVars[key.toLowerCase()] !== undefined 
                                ? mappedVars[key.toLowerCase()] 
                                : (mappedVars[positionalKey] !== undefined ? mappedVars[positionalKey] : ''));
                          let textVal = String(val ?? '').trim();
                          if (!textVal) textVal = '-';
                          const paramObj: any = { type: 'text', text: textVal };
                          if (isNaN(Number(key))) paramObj.parameter_name = key;
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
                            const val = mappedVars[`button_copy_code_${idx + 1}`] || mappedVars[`coupon_code_${idx + 1}`] || mappedVars['button_copy_code'] || mappedVars['coupon_code'] || '';
                            if (val) {
                              reqComponents.push({ type: 'button', sub_type: 'copy_code', index: String(idx), parameters: [{ type: 'coupon_code', coupon_code: val }] });
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
                      let val = mappedVars[key] !== undefined 
                        ? mappedVars[key] 
                        : (mappedVars[key.toLowerCase()] !== undefined 
                            ? mappedVars[key.toLowerCase()] 
                            : (mappedVars[positionalKey] !== undefined ? mappedVars[positionalKey] : ''));
                      let textVal = String(val ?? '').trim();
                      if (!textVal) textVal = '-';
                      const paramObj: any = { type: 'text', text: textVal };
                      if (isNaN(Number(key))) paramObj.parameter_name = key;
                      return paramObj;
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

                  // Rate-limit detection
                  if (metaErrCode === 130429 || metaErrCode === 131056 || fbRes.status === 429) {
                    rateLimitEncountered = true
                    console.warn(`[Campaign Worker] Meta API rate limit hit (#${metaErrCode || fbRes.status}) for campaign ${campaignId}`)
                  }

                  if (metaErrCode === 132001 || metaErrMsg.includes('132001') || metaErrMsg.includes('does not exist in the translation')) {
                    throw new Error(
                      `WhatsApp Meta Error #132001: Template '${templateName}' does not exist in translation '${templateLanguage}'. ` +
                      `Ensure the template is approved in Meta WhatsApp Business Manager with language code '${templateLanguage}' (e.g. en_US vs en) or update the template language.`
                    )
                  } else if (metaErrCode === 132012 || metaErrMsg.includes('132012') || metaErrMsg.includes('Parameter format does not match')) {
                    throw new Error(
                      `WhatsApp Meta Error #132012: Parameter format mismatch for template '${templateName}'. ` +
                      `Ensure that all required variables (header media, body parameters, or button URLs) match the format and count registered in Meta WhatsApp Business Manager.`
                    )
                  }

                  throw new Error(`Meta WhatsApp API error (${metaErrCode || fbRes.status}): ${metaErrMsg}${metaDetails ? ` - ${metaDetails}` : ''}`)
                }

                const fbData = await fbRes.json()
                twilioMessageSid = fbData.messages?.[0]?.id ? `FB_${fbData.messages[0].id}` : `FB_${Date.now()}`
                sentCount++
              } else {
                // Twilio WhatsApp
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
                  
                  if (code === 20429 || twilioErr.status === 429) {
                    rateLimitEncountered = true
                  }

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
                  else {
                    const { data: fallbackContact } = await supabase.from('contacts').select('id').eq('email', cleanEmail).maybeSingle()
                    if (fallbackContact) contactId = fallbackContact.id
                  }
                }
              } else {
                // Multi-variant phone number resolution to ensure CRM chat thread matching
                const cleanPhone = recipientPhone ? recipientPhone.replace(/^whatsapp:/i, '').trim() : ''
                const phoneVariants = Array.from(new Set([
                  cleanPhone,
                  cleanPhone.startsWith('+') ? cleanPhone.slice(1) : `+${cleanPhone}`,
                  `whatsapp:${cleanPhone}`,
                  cleanPhone.replace(/[\s\-\(\)]/g, ''),
                  cleanPhone.startsWith('+') ? cleanPhone.slice(1).replace(/[\s\-\(\)]/g, '') : `+${cleanPhone.replace(/[\s\-\(\)]/g, '')}`
                ])).filter(Boolean)

                const { data: matchedContacts } = await supabase
                  .from('contacts')
                  .select('id, first_name, last_name, tags')
                  .eq('organization_id', campaign.organization_id)
                  .in('phone_number', phoneVariants)
                  .limit(1)

                const existingContact = matchedContacts?.[0] || null

                if (existingContact) {
                  contactId = existingContact.id
                  const existingTags = Array.isArray(existingContact.tags) ? existingContact.tags : []
                  const mergedTags = Array.from(new Set([...existingTags, ...contactTags]))
                  const needsNameUpdate = (!existingContact.first_name || existingContact.first_name === 'Campaign') && firstName !== 'Campaign'

                  if (needsNameUpdate || mergedTags.length > existingTags.length) {
                    await supabase.from('contacts').update({ ...(needsNameUpdate ? { first_name: firstName, last_name: lastName } : {}), tags: mergedTags }).eq('id', existingContact.id)
                  }
                } else {
                  const stdPhone = cleanPhone.startsWith('+') ? cleanPhone : `+${cleanPhone}`
                  const { data: newContact } = await supabase.from('contacts').insert([{ organization_id: campaign.organization_id, first_name: firstName, last_name: lastName, phone_number: stdPhone, company: contactCompany, tags: contactTags }]).select().maybeSingle()
                  if (newContact) {
                    contactId = newContact.id
                  } else {
                    const { data: retryContact } = await supabase
                      .from('contacts')
                      .select('id')
                      .eq('organization_id', campaign.organization_id)
                      .in('phone_number', phoneVariants)
                      .maybeSingle()
                    if (retryContact) contactId = retryContact.id
                  }
                }
              }

              if (contactId) {
                let conversationId = null
                const { data: existingConv } = await supabase.from('conversations').select('id').eq('contact_id', contactId).eq('organization_id', campaign.organization_id).maybeSingle()
                if (existingConv) conversationId = existingConv.id
                else {
                  const { data: newConv } = await supabase.from('conversations').insert([{ organization_id: campaign.organization_id, contact_id: contactId, is_active: true, last_message_at: new Date().toISOString() }]).select().maybeSingle()
                  if (newConv) conversationId = newConv.id
                  else {
                    const { data: retryConv } = await supabase.from('conversations').select('id').eq('contact_id', contactId).eq('organization_id', campaign.organization_id).maybeSingle()
                    if (retryConv) conversationId = retryConv.id
                  }
                }

                if (conversationId) {
                  let finalBody = campaign.template_body || ''
                  Object.entries(mappedVars).forEach(([k, v]) => { finalBody = finalBody.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v)) })

                  // Reconstruct body text if empty so message in chat is never blank
                  if (!finalBody || finalBody.trim() === '') {
                    if (metaTemplateComponents && Array.isArray(metaTemplateComponents) && metaTemplateComponents.length > 0) {
                      const bodyComp = metaTemplateComponents.find((c: any) => c.type === 'BODY')
                      if (bodyComp && bodyComp.text) {
                        let tText = bodyComp.text
                        Object.entries(mappedVars).forEach(([k, v]) => {
                          tText = tText.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
                        })
                        finalBody = tText
                      }
                    }
                  }

                  if (!finalBody || finalBody.trim() === '') {
                    const tName = metaTemplateNameFromApi || campaign.template_name || campaign.name || 'Campaign WhatsApp Template'
                    const varSummary = Object.entries(mappedVars).filter(([_, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ')
                    finalBody = `[Template: ${tName}]${varSummary ? ` (${varSummary})` : ''}`
                  }

                  const recordBody = channel === 'email' ? `[Email Subject: ${campaignSubject || `Campaign: ${campaign.name}`}]\n\n${finalBody}` : finalBody

                  await supabase.from('messages').insert([{ organization_id: campaign.organization_id, conversation_id: conversationId, sender_type: 'user', body: recordBody, twilio_message_sid: twilioMessageSid, status: 'sent' }])
                  await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId)
                }
              }
            } catch (syncError) {
              console.error('[Campaign Worker] Error syncing message to CRM logs:', syncError)
            }
          }
        })
      )

      // Update campaign counts after each micro-batch
      await supabase
        .from('campaigns')
        .update({ sent_count: sentCount, failed_count: failedCount, updated_at: new Date().toISOString() })
        .eq('id', campaignId)

      // Anti-spam safe pacing delay with jitter
      if (rateLimitEncountered) {
        console.warn(`[Campaign Worker] Rate limit encountered. Anti-spam backoff pause for 3.5s...`)
        await new Promise((resolve) => setTimeout(resolve, 3500))
      } else {
        const jitterDelay = 70 + Math.floor(Math.random() * 50)
        await new Promise((resolve) => setTimeout(resolve, jitterDelay))
      }
    }

    // Final status verification and completion
    const { data: finalCamp } = await supabase
      .from('campaigns')
      .select('status')
      .eq('id', campaignId)
      .maybeSingle()

    const { count: finalPending } = await supabase
      .from('campaign_logs')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('status', 'PENDING')

    const { count: finalSent } = await supabase
      .from('campaign_logs')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .in('status', ['SENT', 'DELIVERED', 'READ'])

    const { count: finalFailed } = await supabase
      .from('campaign_logs')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('status', 'FAILED')

    let terminalStatus = 'COMPLETED'
    if (finalCamp && (finalCamp.status === 'STOPPED' || finalCamp.status === 'CANCELLED')) {
      terminalStatus = finalCamp.status
    } else if (finalPending && finalPending > 0) {
      terminalStatus = 'PROCESSING'
    }

    await supabase
      .from('campaigns')
      .update({
        status: terminalStatus,
        sent_count: finalSent || 0,
        failed_count: finalFailed || 0,
        updated_at: new Date().toISOString()
      })
      .eq('id', campaignId)

    return {
      success: true,
      message: `Campaign execution finished with status: ${terminalStatus}. Sent: ${finalSent || 0}, Failed: ${finalFailed || 0}`
    }
  } catch (error: any) {
    console.error(`[Campaign Worker] General execution failure:`, error)
    return { success: false, error: error.message || 'Worker failure', message: 'Worker failure' }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { campaignId } = body

    if (!campaignId) {
      return NextResponse.json({ error: 'Campaign ID is required' }, { status: 400 })
    }

    const result = await runCampaignWorker(campaignId)
    if (result.error && !result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('[Campaign Worker POST] Handler error:', error)
    return NextResponse.json({ error: error.message || 'Worker failure' }, { status: 500 })
  }
}
