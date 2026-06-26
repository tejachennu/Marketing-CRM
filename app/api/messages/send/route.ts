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

function getTwilioClient() {
  const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ''
  const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''
  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
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
    const { conversationId, messageBody, contactId, organizationId, message, phoneNumber, mediaUrl, media_url } = body

    // Support both old and new parameter formats
    const msgBody = messageBody || message || ''
    const contactPhone = phoneNumber
    const convId = conversationId
    let orgId = organizationId
    const msgMediaUrl = mediaUrl || media_url || null

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


    if (orgId) {
      try {
        const { data: orgData } = await supabase
          .from('organizations')
          .select('twilio_account_sid, twilio_auth_token, twilio_whatsapp_number, whatsapp_provider, whatsapp_api_token, whatsapp_default_phone, whatsapp_graph_api_version, whatsapp_phone_number_id, enable_sms')
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
        }
      } catch (dbErr) {
        console.error('[Messages Send] Error loading database credentials:', dbErr)
      }
    }

    const twilioClient = twilio(twilioAccountSid, twilioAuthToken)

    if (!msgBody && !msgMediaUrl) {
      return NextResponse.json(
        { error: 'Missing message body or media' },
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
    }    // Determine channel (WhatsApp vs SMS) dynamically
    let isWhatsApp = false
    if (contactPhone && contactPhone.startsWith('whatsapp:')) {
      isWhatsApp = true
    } else {
      try {
        if (conversation?.contact_id) {
          const { data: contact } = await supabase
            .from('contacts')
            .select('whatsapp_number')
            .eq('id', conversation.contact_id)
            .maybeSingle()
          if (contact?.whatsapp_number && contact.whatsapp_number.startsWith('whatsapp:')) {
            isWhatsApp = true
          }
        }
      } catch (err) {
        console.warn('[v0] Failed to fetch contact to resolve channel:', err)
      }
    }

    if (!isWhatsApp && !enableSms) {
      return NextResponse.json(
        { error: 'SMS Gateway is currently disabled. Please enable it in Settings.' },
        { status: 400 }
      )
    }

    // Send message via Twilio or Facebook WhatsApp API
    let twilioMessageSid = null
    let sendStatus = 'sent'
    let sendError: string | null = null
    try {
      const cleanToFb = contactPhone.replace('whatsapp:', '').replace('+', '').trim()

      if (whatsappProvider === 'facebook') {
        if (!whatsappApiToken || !whatsappPhoneNumberId) {
          throw new Error('Facebook WhatsApp API credentials (API Token & Phone ID) must be configured in settings')
        }

        const publicMediaUrl = msgMediaUrl
          ? (msgMediaUrl.startsWith('http')
              ? msgMediaUrl
              : `${process.env.V0_RUNTIME_URL || ''}${msgMediaUrl}`)
          : null

        let payload: any = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanToFb,
        }

        if (publicMediaUrl) {
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
              payload.image = {
                id: mediaId
              }
            } else {
              payload.image = {
                link: publicMediaUrl
              }
            }
            if (msgBody) {
              payload.image.caption = msgBody
            }
          } else {
            payload.type = 'document'
            if (mediaId) {
              payload.document = {
                id: mediaId,
                filename: 'Attachment'
              }
            } else {
              payload.document = {
                link: publicMediaUrl,
                filename: 'Attachment'
              }
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
        console.log('[v0] Message sent via Facebook:', twilioMessageSid)
      } else {
        // Send message via Twilio
        const cleanFrom = TWILIO_WHATSAPP_NUMBER.replace('whatsapp:', '')
        const cleanTo = contactPhone.replace('whatsapp:', '')

        const twilioParams: any = {
          body: msgBody,
          to: isWhatsApp ? `whatsapp:${cleanTo}` : cleanTo,
          from: isWhatsApp ? `whatsapp:${cleanFrom}` : cleanFrom,
        }

        if (msgMediaUrl) {
          const publicMediaUrl = msgMediaUrl.startsWith('http')
            ? msgMediaUrl
            : `${process.env.V0_RUNTIME_URL || ''}${msgMediaUrl}`
          twilioParams.mediaUrl = [publicMediaUrl]
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
