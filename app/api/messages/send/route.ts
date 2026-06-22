import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'

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

    // Resolve tenant credentials
    let twilioAccountSid = process.env.TWILIO_ACCOUNT_SID || ''
    let twilioAuthToken = process.env.TWILIO_AUTH_TOKEN || ''
    let TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || ''

    if (orgId) {
      try {
        const { data: orgData } = await supabase
          .from('organizations')
          .select('twilio_account_sid, twilio_auth_token, twilio_whatsapp_number')
          .eq('id', orgId)
          .single()

        if (orgData) {
          if (orgData.twilio_account_sid) twilioAccountSid = orgData.twilio_account_sid
          if (orgData.twilio_auth_token) twilioAuthToken = orgData.twilio_auth_token
          if (orgData.twilio_whatsapp_number) TWILIO_WHATSAPP_NUMBER = orgData.twilio_whatsapp_number
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
      const { data: existingConv } = await supabase
        .from('conversations')
        .select('*')
        .eq('contact_id', contactId)
        .eq('organization_id', orgId)
        .single()

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

    // Send message via Twilio
    let twilioMessageSid = null
    try {
      const cleanFrom = TWILIO_WHATSAPP_NUMBER.replace('whatsapp:', '')
      const cleanTo = contactPhone.replace('whatsapp:', '')

      const twilioParams: any = {
        body: msgBody,
        to: isWhatsApp ? `whatsapp:${cleanTo}` : cleanTo,
        from: isWhatsApp ? `whatsapp:${cleanFrom}` : cleanFrom,
      }

      if (msgMediaUrl) {
        // If mediaUrl is a relative path, resolve it with V0_RUNTIME_URL
        const publicMediaUrl = msgMediaUrl.startsWith('http')
          ? msgMediaUrl
          : `${process.env.V0_RUNTIME_URL || ''}${msgMediaUrl}`
        twilioParams.mediaUrl = [publicMediaUrl]
      }

      const twilioMsg = await twilioClient.messages.create(twilioParams)
      twilioMessageSid = twilioMsg.sid
      console.log('[v0] Message sent via Twilio:', twilioMsg.sid)
    } catch (twilioError) {
      console.warn('[v0] Twilio send error (continuing with local storage):', twilioError)
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
        },
      ])
      .select()
      .single()

    if (messageError) throw messageError

    // Update conversation
    await supabase
      .from('conversations')
      .update({
        last_message_at: new Date().toISOString(),
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
