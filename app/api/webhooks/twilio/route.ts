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

    // Standardize to E.164 with a leading plus symbol (e.g. +916303012453)
    let phoneNumber = from.replace('whatsapp:', '').trim()
    if (!phoneNumber.startsWith('+')) {
      phoneNumber = '+' + phoneNumber
    }

    if (!phoneNumber || (!messageBody && !mediaUrl)) {
      console.error('[v0] Missing phone number, message body, or media')
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Step 1: Find the organization
    // Try to find via existing contact with this phone number first
    let orgId: string | null = null

    const { data: existingContact } = await supabase
      .from('contacts')
      .select('id, organization_id')
      .eq('phone_number', phoneNumber)
      .limit(1)
      .maybeSingle()

    if (existingContact) {
      orgId = existingContact.organization_id
    } else {
      // No contact with this phone — find the most recently active real user (non-demo)
      const { data: realUsers } = await supabase
        .from('users')
        .select('organization_id')
        .not('email', 'like', '%@test.local')
        .order('updated_at', { ascending: false })
        .limit(1)

      if (realUsers && realUsers.length > 0) {
        orgId = realUsers[0].organization_id
      } else {
        // Fallback to the most recently active user overall
        const { data: anyUsers } = await supabase
          .from('users')
          .select('organization_id')
          .order('updated_at', { ascending: false })
          .limit(1)

        if (anyUsers && anyUsers.length > 0) {
          orgId = anyUsers[0].organization_id
        } else {
          // Absolute fallback: first organization in db
          const { data: orgs } = await supabase
            .from('organizations')
            .select('id')
            .limit(1)

          if (!orgs || orgs.length === 0) {
            console.error('[v0] No organization found in database')
            return NextResponse.json({ error: 'No organization found' }, { status: 400 })
          }
          orgId = orgs[0].id
        }
      }
    }

    // Step 2: Find or create the contact
    let contact: any = null

    if (existingContact) {
      // We already found the contact above
      const { data: fullContact } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', existingContact.id)
        .single()

      contact = fullContact
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
