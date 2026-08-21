import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { verifyOrgAccess } from '@/lib/api-auth-helper'
import fs from 'fs'
import path from 'path'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseKey)
}



async function getMediaBufferAndType(mediaUrl: string): Promise<{ buffer: Buffer; mimeType: string; filename: string } | null> {
  try {
    if (mediaUrl.startsWith('data:')) {
      const match = mediaUrl.match(/^data:([^;]+);base64,(.+)$/)
      if (match) {
        const mimeType = match[1]
        const buffer = Buffer.from(match[2], 'base64')
        const ext = mimeType.split('/')[1] || 'bin'
        const filename = `file.${ext}`
        return { buffer, mimeType, filename }
      }
    }

    if (mediaUrl.startsWith('/uploads/')) {
      const filename = mediaUrl.replace('/uploads/', '');
      const filePath = path.join(process.cwd(), 'public', 'uploads', filename);
      if (fs.existsSync(filePath)) {
        const buffer = fs.readFileSync(filePath);
        // Determine mimeType from filename extension
        const ext = path.extname(filename).toLowerCase();
        let mimeType = 'image/png';
        if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
        else if (ext === '.gif') mimeType = 'image/gif';
        else if (ext === '.webp') mimeType = 'image/webp';
        else if (ext === '.mp4') mimeType = 'video/mp4';
        else if (ext === '.pdf') mimeType = 'application/pdf';
        
        return { buffer, mimeType, filename };
      }
    }

    // Fallback to fetch for external URLs or other paths
    let fullUrl = mediaUrl;
    if (!mediaUrl.startsWith('http')) {
      const runtimeUrl = process.env.V0_RUNTIME_URL || 'http://localhost:3000';
      fullUrl = `${runtimeUrl}${mediaUrl}`;
    }

    console.log(`[Messages Send] Fetching external media URL: ${fullUrl}`);
    const res = await fetch(fullUrl);
    if (!res.ok) {
      throw new Error(`Failed to download media: ${res.status} ${res.statusText}`);
    }

    const mimeType = res.headers.get('content-type') || 'image/png';
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const filename = fullUrl.split('/').pop()?.split('?')[0] || 'file';
    
    return { buffer, mimeType, filename };
  } catch (err) {
    console.error('[Messages Send] getMediaBufferAndType failed:', err);
    return null;
  }
}

async function uploadDirectMediaToMeta(mediaUrl: string, apiToken: string, phoneNumberId: string): Promise<string | null> {
  const mediaInfo = await getMediaBufferAndType(mediaUrl);
  if (!mediaInfo) return null;

  try {
    const fileBlob = new Blob([mediaInfo.buffer], { type: mediaInfo.mimeType });
    const formData = new FormData();
    formData.append('file', fileBlob, mediaInfo.filename);
    formData.append('messaging_product', 'whatsapp');

    console.log(`[Messages Send] Uploading direct attachment ${mediaInfo.filename} to Meta...`);
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

    console.log(`[Messages Send] Direct media uploaded successfully. ID: ${data.id}`);
    return data.id;
  } catch (err) {
    console.error('[Messages Send] uploadDirectMediaToMeta failed:', err);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseClient()
    const body = await request.json()
    const { conversationId, messageBody, contactId, organizationId, message, phoneNumber, mediaUrl, media_url, templateSid, templateName, templateLanguage, templateComponents, templateVariables, templateMetaComponents } = body

    // Support both old and new parameter formats
    const msgBody = messageBody || message || ''
    const contactPhone = phoneNumber
    const convId = conversationId
    let orgId = organizationId
    const msgMediaUrl = mediaUrl || media_url || null
    const requestChannel = body.channel

    // Determine organization context
    if (!orgId && convId) {
      try {
        const { data: conv } = await supabase
          .from('conversations')
          .select('organization_id')
          .eq('id', convId)
          .single()
        if (conv) orgId = conv.organization_id
      } catch {}
    }

    if (!orgId && contactId) {
      try {
        const { data: c } = await supabase
          .from('contacts')
          .select('organization_id')
          .eq('id', contactId)
          .single()
        if (c) orgId = c.organization_id
      } catch {}
    }

    if (!orgId) {
      return NextResponse.json({ error: 'Missing organization context' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, orgId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const isMasterOrg = !orgId || orgId === '303b7a2d-281c-403c-b794-54d1e195ca69'

    // Resolve tenant credentials
    let twilioAccountSid = isMasterOrg ? (process.env.TWILIO_ACCOUNT_SID || '') : ''
    let twilioAuthToken = isMasterOrg ? (process.env.TWILIO_AUTH_TOKEN || '') : ''
    let TWILIO_WHATSAPP_NUMBER = isMasterOrg ? (process.env.TWILIO_WHATSAPP_NUMBER || '') : ''
    let whatsappProvider = isMasterOrg ? (process.env.WHATSAPP_PROVIDER || 'twilio') : 'twilio'
    let whatsappApiToken = isMasterOrg ? (process.env.WHATSAPP_API_TOKEN || '') : ''
    let whatsappDefaultPhone = isMasterOrg ? (process.env.WHATSAPP_DEFAULT_PHONE || '') : ''
    let whatsappGraphApiVersion = isMasterOrg ? (process.env.WHATSAPP_GRAPH_API_VERSION || 'v25.0') : 'v25.0'
    let whatsappPhoneNumberId = isMasterOrg ? (process.env.WHATSAPP_PHONE_NUMBER_ID || '') : ''
    let enableSms = true
    let enableMessages = true

    if (orgId) {
      try {
        const { data: orgData } = await supabase
          .from('organizations')
          .select('twilio_account_sid, twilio_auth_token, twilio_whatsapp_number, whatsapp_provider, whatsapp_api_token, whatsapp_default_phone, whatsapp_graph_api_version, whatsapp_phone_number_id, enable_sms, enable_messages')
          .eq('id', orgId)
          .single()

        if (orgData) {
          if (orgData.twilio_account_sid) twilioAccountSid = orgData.twilio_account_sid
          if (orgData.twilio_auth_token) twilioAuthToken = orgData.twilio_auth_token
          if (orgData.twilio_whatsapp_number) TWILIO_WHATSAPP_NUMBER = orgData.twilio_whatsapp_number
          if (orgData.whatsapp_provider) whatsappProvider = orgData.whatsapp_provider
          if (orgData.whatsapp_api_token) whatsappApiToken = orgData.whatsapp_api_token
          if (orgData.whatsapp_default_phone) whatsappDefaultPhone = orgData.whatsapp_default_phone
          if (orgData.whatsapp_graph_api_version) whatsappGraphApiVersion = orgData.whatsapp_graph_api_version
          if (orgData.whatsapp_phone_number_id) whatsappPhoneNumberId = orgData.whatsapp_phone_number_id
          if (orgData.enable_sms !== null && orgData.enable_sms !== undefined) {
            enableSms = orgData.enable_sms
          }
          if (orgData.enable_messages !== null && orgData.enable_messages !== undefined) {
            enableMessages = orgData.enable_messages
          }
        }
      } catch (dbErr) {
        console.error('[Messages Send] Error loading database credentials:', dbErr)
      }
    }

    if (!msgBody && !msgMediaUrl && !templateName && !templateSid) {
      return NextResponse.json(
        { error: 'Missing message body, media, or template selection' },
        { status: 400 }
      )
    }

    if (!contactPhone) {
      return NextResponse.json(
        { error: 'Missing phone number' },
        { status: 400 }
      )
    }

    // If we have a conversation ID, use it; otherwise get/create one
    let conversation
    if (convId) {
      const { data: conv, error: convError } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', convId)
        .single()

      if (convError || !conv) {
        return NextResponse.json(
          { error: 'Conversation not found' },
          { status: 404 }
        )
      }
      conversation = conv
    } else if (contactId && orgId) {
      // Create or get conversation for this contact
      const { data: existingConvs } = await supabase
        .from('conversations')
        .select('*')
        .eq('contact_id', contactId)
        .eq('organization_id', orgId)
        .order('last_message_at', { ascending: false })
        .limit(1)

      const existingConv = existingConvs?.[0] || null

      if (existingConv) {
        conversation = existingConv
      } else {
        const { data: newConv, error: createError } = await supabase
          .from('conversations')
          .insert([
            {
              organization_id: orgId,
              contact_id: contactId,
              is_active: true,
            },
          ])
          .select()
          .single()

        if (createError || !newConv) {
          throw createError || new Error('Failed to create conversation')
        }
        conversation = newConv
      }
    } else {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      )
    }

    // Determine channel (WhatsApp vs SMS) dynamically
    // In this CRM, WhatsApp is the primary messaging channel for chats & templates.
    let isWhatsApp = true
    if (requestChannel === 'sms') {
      isWhatsApp = false
    } else if (requestChannel === 'whatsapp' || templateName || templateSid) {
      isWhatsApp = true
    } else if (contactPhone && contactPhone.startsWith('whatsapp:')) {
      isWhatsApp = true
    } else if (whatsappProvider === 'facebook' || whatsappProvider === 'twilio') {
      // Default to WhatsApp when WhatsApp provider is enabled
      isWhatsApp = true
    } else if (!enableMessages && enableSms) {
      isWhatsApp = false
    }

    if (!isWhatsApp && !enableSms) {
      return NextResponse.json(
        { error: 'SMS Gateway is currently disabled. Please enable it in Settings.' },
        { status: 400 }
      )
    }

    // Send message via the appropriate provider
    // Strict isolation rule: 
    // - If whatsappProvider === 'facebook' AND isWhatsApp -> strictly Facebook WhatsApp Cloud API (never touch or require Twilio)
    // - If whatsappProvider === 'twilio' AND isWhatsApp -> Twilio WhatsApp API
    // - If channel === 'sms' -> Twilio SMS
    let twilioMessageSid = null
    let sendStatus = 'sent'
    let sendError: string | null = null
    try {
      const useFacebookForThisMessage = isWhatsApp && whatsappProvider === 'facebook'

      if (useFacebookForThisMessage) {
        // ── Facebook WhatsApp Cloud API path ──────────────────────
        if (!whatsappApiToken || !whatsappPhoneNumberId) {
          throw new Error('Facebook WhatsApp API credentials (API Token & Phone ID) must be configured in settings')
        }

        const cleanToFb = contactPhone.replace(/^whatsapp:/i, '').replace(/^\+/, '').trim()

        const publicMediaUrl = msgMediaUrl
          ? (msgMediaUrl.startsWith('http')
              ? msgMediaUrl
              : `${process.env.V0_RUNTIME_URL || ''}${msgMediaUrl}`)
          : null

        let tName = ''
        let tLang = 'en'

        let payload: any = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanToFb,
        }

        if (templateName || templateSid) {
          tName = templateName || templateSid || ''
          tLang = templateLanguage || 'en'
          if (tName.startsWith('META_')) {
            tName = tName.replace(/^META_/, '')
          }
          tName = tName.replace(/\s*\(Meta Approved\)/gi, '').replace(/\s*\(Twilio WhatsApp Approved\)/gi, '').replace(/\s*\[.*?\]/g, '').trim()

          // Auto-fetch components from Meta if templateSid is META_... and templateMetaComponents is missing
          let metaComponents = templateMetaComponents || []
          if ((!metaComponents || metaComponents.length === 0) && templateSid && templateSid.startsWith('META_') && whatsappApiToken) {
            const templateId = templateSid.replace('META_', '')
            try {
              const tplRes = await fetch(`https://graph.facebook.com/${whatsappGraphApiVersion}/${templateId}?access_token=${whatsappApiToken}`)
              if (tplRes.ok) {
                const tplData = await tplRes.json()
                if (tplData.components) metaComponents = tplData.components
                if (tplData.name) tName = tplData.name
                if (tplData.language) tLang = tplData.language
                console.log(`[Messages Send] Auto-fetched Meta template structure for '${tName}' (${tLang})`)
              }
            } catch (err) {
              console.warn('[Messages Send] Could not auto-fetch Meta template info:', err)
            }
          }

          payload.type = 'template'
          payload.template = {
            name: tName,
            language: {
              code: tLang
            }
          }

          if (templateComponents && Array.isArray(templateComponents) && templateComponents.length > 0) {
            // Pre-built components were passed directly (already in Meta API format)
            payload.template.components = templateComponents
          } else if (metaComponents && Array.isArray(metaComponents) && metaComponents.length > 0) {
            // We have the template's Meta component definitions (HEADER, BODY, BUTTONS etc.)
            // Build proper Meta API components from templateVariables using the structure
            const reqComponents: any[] = []
            const mappedVars = (templateVariables || {}) as Record<string, string>

            for (const comp of metaComponents) {
              if (comp.type === 'HEADER') {
                if (comp.format === 'IMAGE') {
                  const imgVal = mappedVars['header_image_url'] || mappedVars['header_link'] || mappedVars['header_media_url'] || comp.example?.header_handle?.[0] || msgMediaUrl || ''
                  if (imgVal) {
                    const mediaParam: any = imgVal.startsWith('http') ? { link: imgVal } : { id: imgVal }
                    reqComponents.push({
                      type: 'header',
                      parameters: [{ type: 'image', image: mediaParam }]
                    })
                  }
                } else if (comp.format === 'VIDEO') {
                  const videoVal = mappedVars['header_video_url'] || mappedVars['header_link'] || mappedVars['header_media_url'] || comp.example?.header_handle?.[0] || msgMediaUrl || ''
                  if (videoVal) {
                    const mediaParam: any = videoVal.startsWith('http') ? { link: videoVal } : { id: videoVal }
                    reqComponents.push({
                      type: 'header',
                      parameters: [{ type: 'video', video: mediaParam }]
                    })
                  }
                } else if (comp.format === 'DOCUMENT') {
                  const docVal = mappedVars['header_document_url'] || mappedVars['header_link'] || mappedVars['header_media_url'] || comp.example?.header_handle?.[0] || msgMediaUrl || ''
                  if (docVal) {
                    const filename = mappedVars['header_document_filename'] || 'document.pdf'
                    const mediaParam: any = docVal.startsWith('http') ? { link: docVal, filename } : { id: docVal, filename }
                    reqComponents.push({
                      type: 'header',
                      parameters: [{ type: 'document', document: mediaParam }]
                    })
                  }
                } else if (comp.format === 'TEXT') {
                  const headerVal = mappedVars['header_text_1'] || mappedVars['header_1'] || comp.example?.header_text?.[0] || ''
                  if (headerVal) {
                    reqComponents.push({
                      type: 'header',
                      parameters: [{ type: 'text', text: headerVal }]
                    })
                  }
                }
              } else if (comp.type === 'BODY') {
                const bodyText = comp.text || ''
                let uniqueKeys: string[] = []

                const namedParams = comp.example?.body_text_named_params
                if (Array.isArray(namedParams) && namedParams.length > 0) {
                  uniqueKeys = namedParams.map((p: any) => p.param_name).filter(Boolean)
                } else {
                  const placeholders = bodyText.match(/\{\{([^}]+)\}\}/g) || []
                  const rawKeys = Array.from(new Set(placeholders.map((m: string) => m.replace(/[\{\}]/g, '')))) as string[]
                  uniqueKeys = rawKeys.filter((k: string) => /^[a-zA-Z0-9_]+$/.test(k))
                  const isNumeric = uniqueKeys.every((k: string) => !isNaN(Number(k)))
                  if (isNumeric) {
                    uniqueKeys.sort((a, b) => Number(a) - Number(b))
                  }
                }

                const parameters = uniqueKeys.map((key, idx) => {
                  const positionalKey = String(idx + 1)
                  const val = mappedVars[key] !== undefined
                    ? mappedVars[key]
                    : (mappedVars[key.toLowerCase()] !== undefined
                        ? mappedVars[key.toLowerCase()]
                        : (mappedVars[positionalKey] !== undefined ? mappedVars[positionalKey] : ''))
                  const paramObj: any = { type: 'text', text: String(val) }
                  if (isNaN(Number(key))) {
                    paramObj.parameter_name = key
                  }
                  return paramObj
                })

                if (parameters.length > 0) {
                  reqComponents.push({ type: 'body', parameters })
                }
              } else if (comp.type === 'BUTTONS' && Array.isArray(comp.buttons)) {
                comp.buttons.forEach((btn: any, idx: number) => {
                  if (btn.type === 'URL' && btn.url?.includes('{{1}}')) {
                    const val = mappedVars[`button_url_${idx + 1}`] || mappedVars['button_url_1'] || ''
                    reqComponents.push({
                      type: 'button',
                      sub_type: 'url',
                      index: String(idx),
                      parameters: [{ type: 'text', text: val }]
                    })
                  } else if (btn.type === 'COPY_CODE') {
                    const val = mappedVars[`button_copy_code_${idx + 1}`] || mappedVars['button_copy_code'] || ''
                    if (val) {
                      reqComponents.push({
                        type: 'button',
                        sub_type: 'copy_code',
                        index: String(idx),
                        parameters: [{ type: 'text', text: val }]
                      })
                    }
                  }
                })
              }
            }

            if (reqComponents.length > 0) {
              payload.template.components = reqComponents
            }
          } else if (templateVariables && typeof templateVariables === 'object') {
            // Fallback: no component metadata — filter out header/button keys, send only body text params
            const headerButtonKeys = new Set([
              'header_image_url', 'header_video_url', 'header_document_url',
              'header_link', 'header_media_url', 'header_document_filename',
              'header_text_1', 'header_1',
              'button_url_1', 'button_url_2', 'button_copy_code', 'button_copy_code_1', 'button_copy_code_2'
            ])
            const bodyEntries = Object.entries(templateVariables)
              .filter(([key]) => !headerButtonKeys.has(key))
              .sort(([a], [b]) => {
                const numA = Number(a)
                const numB = Number(b)
                if (!isNaN(numA) && !isNaN(numB)) return numA - numB
                return a.localeCompare(b)
              })
            const parameters = bodyEntries.map(([key, val]) => {
              const paramObj: any = { type: 'text', text: String(val || '') }
              if (isNaN(Number(key))) {
                paramObj.parameter_name = key
              }
              return paramObj
            })
            if (parameters.length > 0) {
              payload.template.components = [{ type: 'body', parameters }]
            }
          }
        } else if (publicMediaUrl) {
          const lowerUrl = publicMediaUrl.toLowerCase()
          const isImage = lowerUrl.endsWith('.jpg') || lowerUrl.endsWith('.jpeg') || lowerUrl.endsWith('.png') || lowerUrl.endsWith('.gif') || lowerUrl.endsWith('.webp')
          
          let mediaId: string | null = null
          try {
            console.log(`[Messages Send] Attempting to upload direct media to Meta: ${msgMediaUrl}`)
            mediaId = await uploadDirectMediaToMeta(msgMediaUrl!, whatsappApiToken, whatsappPhoneNumberId)
          } catch (uploadErr) {
            console.error('[Messages Send] Direct media upload failed, will fallback to link:', uploadErr)
          }

          if (isImage) {
            payload.type = 'image'
            if (mediaId) {
              payload.image = { id: mediaId }
            } else {
              payload.image = { link: publicMediaUrl }
            }
            if (msgBody) {
              payload.image.caption = msgBody
            }
          } else {
            payload.type = 'document'
            if (mediaId) {
              payload.document = { id: mediaId, filename: 'Attachment' }
            } else {
              payload.document = { link: publicMediaUrl, filename: 'Attachment' }
            }
            if (msgBody) {
              payload.document.caption = msgBody
            }
          }
        } else {
          payload.type = 'text'
          payload.text = {
            body: msgBody
          }
        }

        console.log(`[Messages Send] Sending message via Meta Cloud API (${whatsappPhoneNumberId}):`, JSON.stringify(payload))

        const fbRes = await fetch(`https://graph.facebook.com/${whatsappGraphApiVersion}/${whatsappPhoneNumberId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${whatsappApiToken}`
          },
          body: JSON.stringify(payload)
        })

        if (!fbRes.ok) {
          const errData = await fbRes.json().catch(() => null)
          const metaErrMsg = errData?.error?.message || errData?.error?.error_user_msg || `Meta API HTTP ${fbRes.status}`
          const metaCode = errData?.error?.code
          const metaDetails = errData?.error?.error_data?.details || ''
          console.error(`[Messages Send] Facebook API error (${fbRes.status}, code ${metaCode}):`, errData)
          if (metaCode === 131047) {
            throw new Error(`Meta 24-hour service window has expired for this contact. You must send an approved WhatsApp Template message to re-initiate the conversation.`)
          } else if (metaCode === 132001) {
            throw new Error(`Template '${tName}' does not exist in translation '${tLang}'. Ensure the template language code matches Meta WhatsApp Manager.`)
          } else if (metaCode === 132012) {
            throw new Error(`Template '${tName}' parameter format mismatch (#132012). Ensure variable values (header media/text parameters) match the template in Meta WhatsApp Manager.`)
          }
          throw new Error(`Meta WhatsApp Cloud API error: ${metaErrMsg}${metaDetails ? ` - ${metaDetails}` : ''}`)
        }

        const fbData = await fbRes.json()
        twilioMessageSid = fbData.messages?.[0]?.id ? `FB_${fbData.messages[0].id}` : `FB_${Date.now()}`
        console.log('[Messages Send] Message sent successfully via Facebook Meta API:', twilioMessageSid)
      } else {
        // ── Twilio path (WhatsApp via Twilio OR SMS) ──────────────
        if (!twilioAccountSid || !twilioAuthToken) {
          throw new Error('Twilio credentials (Account SID & Auth Token) must be configured in settings to send ' + (isWhatsApp ? 'WhatsApp messages via Twilio' : 'SMS messages'))
        }

        const twilioClient = twilio(twilioAccountSid, twilioAuthToken)
        const cleanFrom = TWILIO_WHATSAPP_NUMBER.replace('whatsapp:', '')
        const cleanTo = contactPhone.replace('whatsapp:', '')

        const twilioParams: any = {
          to: isWhatsApp ? `whatsapp:${cleanTo}` : cleanTo,
          from: isWhatsApp ? `whatsapp:${cleanFrom}` : cleanFrom,
        }

        if (templateSid && /^HX[0-9a-f]{32}$/i.test(templateSid)) {
          twilioParams.contentSid = templateSid
          if (templateVariables) {
            twilioParams.contentVariables = typeof templateVariables === 'string' ? templateVariables : JSON.stringify(templateVariables)
          }
        } else {
          twilioParams.body = msgBody
        }

        if (msgMediaUrl) {
          let publicMediaUrl = '';
          if (msgMediaUrl.startsWith('http')) {
            publicMediaUrl = msgMediaUrl;
          } else if (msgMediaUrl.startsWith('data:')) {
            try {
              const mediaInfo = await getMediaBufferAndType(msgMediaUrl);
              if (mediaInfo) {
                const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
                const ext = mediaInfo.mimeType.split('/')[1] || 'bin';
                const storagePath = `${uniqueId}.${ext}`;
                
                // Try to upload. If bucket doesn't exist, we will create it in catch or check
                const { error: uploadError } = await supabase.storage
                  .from('media-attachments')
                  .upload(storagePath, mediaInfo.buffer, {
                    contentType: mediaInfo.mimeType,
                    upsert: true
                  });

                if (uploadError && uploadError.message?.includes('not found')) {
                  console.log('[Messages Send] Creating storage bucket media-attachments');
                  await supabase.storage.createBucket('media-attachments', { public: true });
                  const { error: retryError } = await supabase.storage
                    .from('media-attachments')
                    .upload(storagePath, mediaInfo.buffer, {
                      contentType: mediaInfo.mimeType,
                      upsert: true
                    });
                  if (retryError) throw retryError;
                } else if (uploadError) {
                  throw uploadError;
                }

                const { data: { publicUrl } } = supabase.storage
                  .from('media-attachments')
                  .getPublicUrl(storagePath);
                  
                publicMediaUrl = publicUrl;
                console.log('[Messages Send] Uploaded data URL to Supabase Storage. Public URL:', publicMediaUrl);
              }
            } catch (storageErr) {
              console.error('[Messages Send] Failed to upload media to Supabase storage:', storageErr);
            }
          }

          if (!publicMediaUrl) {
            publicMediaUrl = `${process.env.V0_RUNTIME_URL || ''}${msgMediaUrl}`;
          }
          twilioParams.mediaUrl = [publicMediaUrl];
        }

        const twilioMsg = await twilioClient.messages.create(twilioParams)
        twilioMessageSid = twilioMsg.sid
        console.log('[v0] Message sent via Twilio:', twilioMsg.sid)
      }
    } catch (twilioError) {
      console.warn('[v0] Message send error (continuing with local storage):', twilioError)
      sendStatus = 'failed'
      sendError = twilioError instanceof Error ? twilioError.message : String(twilioError)
    }
    // Store message in database
    const { data: savedMessage, error: messageError } = await supabase
      .from('messages')
      .insert([
        {
          organization_id: conversation.organization_id,
          conversation_id: conversation.id,
          sender_type: 'user',
          body: msgBody,
          media_url: msgMediaUrl,
          twilio_message_sid: twilioMessageSid,
          status: sendStatus,
          error_message: sendError,
        },
      ])
      .select()
      .single()

    if (messageError) throw messageError

    // Update conversation and disable auto-reply chatbot on human operator reply
    await supabase
      .from('conversations')
      .update({
        last_message_at: new Date().toISOString(),
        auto_reply_enabled: false,
      })
      .eq('id', conversation.id)

    if (sendStatus === 'failed') {
      return NextResponse.json(
        {
          success: false,
          error: sendError || 'WhatsApp message dispatch failed. Check Meta 24-hour policy window or provider configuration.',
          message: savedMessage,
          twilioSent: false,
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      message: savedMessage,
      twilioSent: !!twilioMessageSid,
    })
  } catch (error) {
    console.error('[v0] Send message error:', error)
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    )
  }
}
