import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgIdAndSlug: string }> | { orgIdAndSlug: string } }
) {
  try {
    const supabase = getSupabaseClient()

    // 1. Resolve dynamic path params and extract organization UUID
    const resolvedParams = await (params as any)
    const orgIdAndSlug = resolvedParams.orgIdAndSlug || ''
    const uuidMatch = orgIdAndSlug.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    
    if (!uuidMatch) {
      console.error('[Webhook] Invalid organization parameter:', orgIdAndSlug)
      return NextResponse.json({ error: 'Invalid organization context' }, { status: 400 })
    }
    
    const orgId = uuidMatch[0]

    // 2. Fetch credentials for this specific organization
    const { data: orgData } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .single()

    if (!orgData) {
      console.error('[Webhook] Organization not found:', orgId)
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    // 3. Fallback check for credentials
    const twilioAccountSid = orgData.twilio_account_sid || process.env.TWILIO_ACCOUNT_SID || ''
    const twilioAuthToken = orgData.twilio_auth_token || process.env.TWILIO_AUTH_TOKEN || ''

    // Parse the incoming Twilio webhook body
    const body = await request.text()
    const paramsMap = new URLSearchParams(body)
    const from = paramsMap.get('From') || ''
    const to = paramsMap.get('To') || ''
    const messageBody = paramsMap.get('Body') || ''
    const messageSid = paramsMap.get('MessageSid') || ''
    
    // Parse media attachments
    const numMedia = parseInt(paramsMap.get('NumMedia') || '0', 10)
    let mediaUrl = numMedia > 0 ? paramsMap.get('MediaUrl0') || null : null
    const contentType = numMedia > 0 ? paramsMap.get('MediaContentType0') || null : null

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

    console.log(`[Webhook] Received WhatsApp message for Org: ${orgId}`, { from, to, messageBody, messageSid, mediaUrl, contentType })

    // Extract phone number (remove 'whatsapp:' prefix if present)
    const phoneNumber = from.replace('whatsapp:', '')

    if (!phoneNumber || (!messageBody && !mediaUrl)) {
      console.error('[Webhook] Missing phone number, message body, or media')
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Step 1: Find contact
    const { data: existingContact } = await supabase
      .from('contacts')
      .select('id, organization_id')
      .eq('organization_id', orgId)
      .eq('phone_number', phoneNumber)
      .limit(1)
      .maybeSingle()

    // Step 2: Find or create the contact
    let contact: any = null

    if (existingContact) {
      const { data: fullContact } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', existingContact.id)
        .single()

      contact = fullContact
    } else {
      // Auto-create a new contact for this unknown sender under our specific organization
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
        console.error('[Webhook] Error creating contact:', createError)
        throw createError
      }

      contact = newContact
      console.log('[Webhook] Auto-created new contact:', contact.id, 'for phone:', phoneNumber)
    }

    // Step 3: Find or create an active conversation for this contact
    let conversation: any = null

    const { data: existingConv } = await supabase
      .from('conversations')
      .select('*')
      .eq('organization_id', orgId)
      .eq('contact_id', contact.id)
      .eq('is_active', true)
      .maybeSingle()

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
        console.error('[Webhook] Error creating conversation:', convError)
        throw convError
      }

      conversation = newConv
      console.log('[Webhook] Auto-created new conversation:', conversation.id)
    }

    // Step 4: Handle Twilio incoming media download dynamically using organization credentials
    let finalMediaUrl = mediaUrl
    if (mediaUrl && twilioAccountSid && twilioAuthToken) {
      console.log('[Webhook] Downloading incoming media...')
      const downloadedPath = await downloadTwilioMedia(
        mediaUrl.split('#')[0],
        twilioAccountSid,
        twilioAuthToken
      )
      if (downloadedPath) {
        // If we downloaded it, point to our local media path
        finalMediaUrl = downloadedPath
      }
    }

    // Step 5: Store the incoming message
    const { data: savedMessage, error: messageError } = await supabase
      .from('messages')
      .insert([
        {
          organization_id: orgId,
          conversation_id: conversation.id,
          sender_type: 'contact',
          body: messageBody,
          media_url: finalMediaUrl,
          twilio_message_sid: messageSid,
        },
      ])
      .select()
      .single()

    if (messageError) {
      console.error('[Webhook] Error storing message:', messageError)
      throw messageError
    }

    console.log('[Webhook] Message stored:', savedMessage.id, 'in conversation:', conversation.id)

    // Step 6: Update conversation metadata
    const { error: updateError } = await supabase
      .from('conversations')
      .update({
        last_message_at: new Date().toISOString(),
        unread_count: (existingConv?.unread_count || 0) + 1,
      })
      .eq('id', conversation.id)

    if (updateError) {
      console.error('[Webhook] Error updating conversation metadata:', updateError)
    }

    return NextResponse.json({ success: true, messageId: savedMessage.id })
  } catch (error) {
    console.error('[Webhook] POST Webhook error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
