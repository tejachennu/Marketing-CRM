import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { describeTwilioRefusal, verifyTwilioRequest } from '@/lib/twilio-webhook'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { isBsuid, canonicalizeBsuid } from '@/lib/whatsapp-bsuid'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseKey)
}

async function downloadTwilioMedia(
  twilioMediaUrl: string,
  twilioAccountSid: string,
  twilioAuthToken: string
): Promise<string | null> {
  try {
    const authHeader = 'Basic ' + Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64')
    
    // Fetch from Twilio with redirects manual
    let res = await fetch(twilioMediaUrl, {
      headers: {
        'Authorization': authHeader
      },
      redirect: 'manual'
    })
    
    // Check if it's a redirect
    if (res.status >= 300 && res.status < 400) {
      const redirectUrl = res.headers.get('location')
      if (redirectUrl) {
        console.log('[Webhook] Following redirect manually to S3 URL:', redirectUrl)
        // Fetch the S3 URL anonymously (without basic auth headers)
        res = await fetch(redirectUrl)
      } else {
        console.error('[Webhook] Redirect status received, but Location header is missing.')
        return null
      }
    }
    
    if (!res.ok) {
      console.error('[Webhook] Failed to fetch Twilio media:', res.statusText, 'status:', res.status)
      return null
    }

    const contentType = res.headers.get('content-type') || 'application/octet-stream'
    
    // Map content-type to file extension
    let ext = '.bin'
    if (contentType.includes('image/jpeg')) ext = '.jpg'
    else if (contentType.includes('image/png')) ext = '.png'
    else if (contentType.includes('image/gif')) ext = '.gif'
    else if (contentType.includes('image/webp')) ext = '.webp'
    else if (contentType.includes('audio/ogg') || contentType.includes('audio/x-ogg')) ext = '.ogg'
    else if (contentType.includes('audio/mpeg') || contentType.includes('audio/mp3')) ext = '.mp3'
    else if (contentType.includes('audio/wav') || contentType.includes('audio/x-wav')) ext = '.wav'
    else if (contentType.includes('audio/aac')) ext = '.aac'
    else if (contentType.includes('audio/amr')) ext = '.amr'
    else if (contentType.includes('video/mp4')) ext = '.mp4'
    else if (contentType.includes('video/webm')) ext = '.webm'
    else if (contentType.includes('application/pdf')) ext = '.pdf'
    
    const arrayBuffer = await res.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads')
    await mkdir(uploadsDir, { recursive: true })
    
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
    const filename = `incoming-${uniqueSuffix}${ext}`
    const filePath = path.join(uploadsDir, filename)
    
    await writeFile(filePath, buffer)
    console.log(`[Webhook] Twilio media downloaded and saved to: ${filePath}`)
    
    return `/uploads/${filename}`
  } catch (err) {
    console.error('[Webhook] Error downloading Twilio media:', err)
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseClient()

    // Parse the incoming Twilio webhook body
    const body = await request.text()
    const params = new URLSearchParams(body)
    const from = params.get('From') || ''
    const to = params.get('To') || ''
    const messageBody = params.get('Body') || ''
    const messageSid = params.get('MessageSid') || ''
    
    // Parse media attachments
    const numMedia = parseInt(params.get('NumMedia') || '0', 10)
    let mediaUrl = numMedia > 0 ? params.get('MediaUrl0') || null : null
    const contentType = numMedia > 0 ? params.get('MediaContentType0') || null : null

    // If we have a mediaUrl, map the extension in a hash fragment to allow client-side detection
    if (mediaUrl && contentType) {
      let ext = '.bin'
      if (contentType.includes('image/jpeg')) ext = '.jpg'
      else if (contentType.includes('image/png')) ext = '.png'
      else if (contentType.includes('image/gif')) ext = '.gif'
      else if (contentType.includes('image/webp')) ext = '.webp'
      else if (contentType.includes('audio/ogg') || contentType.includes('audio/x-ogg')) ext = '.ogg'
      else if (contentType.includes('audio/mpeg') || contentType.includes('audio/mp3')) ext = '.mp3'
      else if (contentType.includes('audio/wav') || contentType.includes('audio/x-wav')) ext = '.wav'
      else if (contentType.includes('audio/aac')) ext = '.aac'
      else if (contentType.includes('audio/amr')) ext = '.amr'
      else if (contentType.includes('video/mp4')) ext = '.mp4'
      else if (contentType.includes('video/webm')) ext = '.webm'
      else if (contentType.includes('application/pdf')) ext = '.pdf'
      
      mediaUrl = `${mediaUrl}#media${ext}`
    }

    console.log('[v0] Received WhatsApp message:', { from, to, messageBody, messageSid, mediaUrl, contentType })

    // Standardize to canonical BSUID (e.g. CA.1076013191946045) or E.164 phone (+916303012453)
    let phoneNumber = from.replace('whatsapp:', '').trim()
    if (isBsuid(phoneNumber)) {
      phoneNumber = canonicalizeBsuid(phoneNumber)
    } else if (!phoneNumber.startsWith('+')) {
      phoneNumber = '+' + phoneNumber
    }

    if (!phoneNumber || (!messageBody && !mediaUrl)) {
      console.error('[v0] Missing phone number, message body, or media')
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Step 1: Find the organization. This address names no workspace, so the workspace is the one
    // whose Twilio WhatsApp number the customer wrote to. Guessing (a contact with the same number in
    // any workspace, the most recently active user) would file one tenant's customer under another.
    let orgId: string | null = null
    const toNumber = to.replace('whatsapp:', '').trim()
    const toDigits = toNumber.replace(/\D/g, '')
    if (toDigits) {
      const { data: candidates } = await supabase
        .from('organizations')
        .select('id, twilio_whatsapp_number')
        .not('twilio_whatsapp_number', 'is', null)
      const owners = (candidates || []).filter((org: any) => String(org.twilio_whatsapp_number || '').replace(/\D/g, '') === toDigits)
      if (owners.length === 1) orgId = owners[0].id
    }

    if (!orgId) {
      // A single-workspace installation keeps working without the number saved in Settings
      const { data: orgs } = await supabase.from('organizations').select('id').limit(2)
      if (orgs && orgs.length === 1) {
        orgId = orgs[0].id
      } else {
        console.error(`[v0] No single workspace owns the Twilio number ${toNumber || '(none)'}; message ignored. Point Twilio at /api/webhooks/twilio/<workspace id> or save the number in Settings.`)
        // Acknowledged, so Twilio does not retry a message no workspace can take
        return NextResponse.json({ success: true, ignored: true, reason: 'No workspace owns this number' })
      }
    }

    // Step 1b: Check organization's WhatsApp provider and load org-scoped Twilio credentials
    // If the org uses Facebook for WhatsApp, ignore this Twilio webhook event
    let orgTwilioAccountSid = process.env.TWILIO_ACCOUNT_SID || ''
    let orgTwilioAuthToken = process.env.TWILIO_AUTH_TOKEN || ''

    if (orgId) {
      try {
        const { data: orgData } = await supabase
          .from('organizations')
          .select('whatsapp_provider, twilio_account_sid, twilio_auth_token')
          .eq('id', orgId)
          .single()

        if (orgData) {
          // If the org uses Facebook for WhatsApp, this Twilio webhook should not process the message
          const provider = orgData.whatsapp_provider || 'twilio'
          if (provider !== 'twilio') {
            console.log(`[v0] Ignoring Twilio webhook for org ${orgId} because active WhatsApp provider is ${provider}`)
            return NextResponse.json({ success: true, ignored: true, reason: `Active provider is ${provider}` })
          }

          // Use org-scoped Twilio credentials for media downloads
          if (orgData.twilio_account_sid) orgTwilioAccountSid = orgData.twilio_account_sid
          if (orgData.twilio_auth_token) orgTwilioAuthToken = orgData.twilio_auth_token
        }
      } catch (dbErr) {
        console.error('[v0] Error checking org WhatsApp provider:', dbErr)
        // Non-fatal, continue with defaults
      }
    }

    // Nothing is stored until Twilio is known to have sent this, signed with the account it belongs to
    const signed = verifyTwilioRequest(request, body, [orgTwilioAuthToken, process.env.TWILIO_AUTH_TOKEN])
    if (!signed.ok) {
      console.warn(`[v0] Refused a Twilio webhook: ${describeTwilioRefusal(signed.reason)}`)
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
    }

    // Download Twilio media using org-scoped credentials if available
    if (mediaUrl && numMedia > 0) {
      const rawMediaUrl = params.get('MediaUrl0') || null
      if (rawMediaUrl && rawMediaUrl.startsWith('https://api.twilio.com')) {
        try {
          const downloadedPath = await downloadTwilioMedia(rawMediaUrl, orgTwilioAccountSid, orgTwilioAuthToken)
          if (downloadedPath) {
            mediaUrl = contentType ? `${downloadedPath}#media${contentType.includes('image/jpeg') ? '.jpg' : contentType.includes('image/png') ? '.png' : '.bin'}` : downloadedPath
          }
        } catch (dlErr) {
          console.error('[v0] Error downloading Twilio media with org credentials:', dlErr)
        }
      }
    }

    // Step 2: Find or create the contact, in this workspace only
    let contact: any = null

    const { data: existingContact } = await supabase
      .from('contacts')
      .select('*')
      .eq('organization_id', orgId)
      .eq('phone_number', phoneNumber)
      .limit(1)
      .maybeSingle()

    if (existingContact) {
      contact = existingContact
    } else {
      // Auto-create a new contact for this unknown sender
      const { data: newContact, error: createError } = await supabase
        .from('contacts')
        .insert([
          {
            organization_id: orgId,
            phone_number: phoneNumber,
            whatsapp_number: from,
            first_name: phoneNumber, // Use phone number as name initially
          },
        ])
        .select()
        .single()

      if (createError) {
        console.error('[v0] Error creating contact:', createError)
        throw createError
      }

      contact = newContact
      console.log('[v0] Auto-created new contact:', contact.id, 'for phone:', phoneNumber)
    }

    // Step 3: Find or create an active conversation for this contact
    let conversation: any = null

    const { data: existingConvs } = await supabase
      .from('conversations')
      .select('*')
      .eq('organization_id', orgId)
      .eq('contact_id', contact.id)
      .eq('is_active', true)
      .order('last_message_at', { ascending: false })
      .limit(1)

    const existingConv = existingConvs?.[0] || null

    if (existingConv) {
      conversation = existingConv
    } else {
      const { data: newConv, error: convError } = await supabase
        .from('conversations')
        .insert([
          {
            organization_id: orgId,
            contact_id: contact.id,
            is_active: true,
            last_message_at: new Date().toISOString(),
          },
        ])
        .select()
        .single()

      if (convError) {
        console.error('[v0] Error creating conversation:', convError)
        throw convError
      }

      conversation = newConv
      console.log('[v0] Auto-created new conversation:', conversation.id)
    }

    // Step 4: Store the incoming message
    const { data: savedMessage, error: messageError } = await supabase
      .from('messages')
      .insert([
        {
          organization_id: orgId,
          conversation_id: conversation.id,
          sender_type: 'contact',
          body: messageBody,
          media_url: mediaUrl,
          twilio_message_sid: messageSid,
        },
      ])
      .select()
      .single()

    if (messageError) {
      console.error('[v0] Error storing message:', messageError)
      throw messageError
    }

    console.log('[v0] Message stored:', savedMessage.id, 'in conversation:', conversation.id)

    // Step 5: Update conversation metadata
    const { error: updateError } = await supabase
      .from('conversations')
      .update({
        last_message_at: new Date().toISOString(),
        unread_count: (existingConv?.unread_count || 0) + 1,
      })
      .eq('id', conversation.id)

    if (updateError) {
      console.error('[v0] Error updating conversation metadata:', updateError)
      // Non-fatal, continue
    }

    return NextResponse.json({ success: true, messageId: savedMessage.id })
  } catch (error) {
    console.error('[v0] Webhook error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
