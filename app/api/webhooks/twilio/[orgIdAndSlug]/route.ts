import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

const DEFAULT_BASE_PROMPT = `You are a strict automated customer service chatbot. Your task is to respond to the customer's message.

CLASSIFICATION AND RESPONSE RULES:
1. NORMAL COMMUNICATION MESSAGES (Greetings, thanks, simple politeness, acknowledgments):
   - If the customer's message is a standard greeting, thank you, or simple polite acknowledgment (e.g., "Hi", "Hello", "Hey", "Good morning", "Thanks", "Thank you", "Ok", "Great", "Awesome", "How are you"), reply with a brief, friendly, and natural response (e.g., greeting them back and asking how you can help, or saying you're welcome).
2. ALL OTHER CONTEXTS (Questions, topic queries, specific inquiries, or any other statements):
   - You must answer using ONLY the facts directly mentioned in the MATCHED FAQ ARTICLES. Do not assume, extrapolate, or refer to outside knowledge.
   - If you do not have the knowledge (i.e., the answer is not explicitly written in the matched FAQs, or no matched FAQs are provided), you MUST respond with EXACTLY this text: "Our support team will reply you soon."

ADDITIONAL CONSTRAINTS:
- Do not make up any facts, procedures, URLs, phone numbers, or fees. Only state what is explicitly written in the matched FAQs.
- Keep the reply helpful, direct, professional, and under 80 words. Do not add conversational filler to topic answers.`;

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
    const openAiKey = orgData.openai_api_key || process.env.OPENAI_API_KEY || ''

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

    // Standardize to E.164 with a leading plus symbol (e.g. +916303012453)
    let phoneNumber = from.replace('whatsapp:', '').trim()
    if (!phoneNumber.startsWith('+')) {
      phoneNumber = '+' + phoneNumber
    }

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

    // Step 7: Auto-Reply Chatbot Trigger
    const isWhatsApp = from.startsWith('whatsapp:')
    const twilioWhatsappNumber = orgData.twilio_whatsapp_number || process.env.TWILIO_WHATSAPP_NUMBER || ''

    if (
      orgData.enable_ai !== false &&
      conversation.auto_reply_enabled !== false &&
      messageBody &&
      openAiKey
    ) {
      console.log(`[Webhook Chatbot] Triggering auto-reply for conversation ${conversation.id}...`)
      try {
        // 1. Generate query embedding
        const embedRes = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openAiKey}`
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: messageBody.substring(0, 8000)
          })
        })

        if (embedRes.ok) {
          const embedData = await embedRes.json()
          const embedding = embedData.data?.[0]?.embedding

          if (embedding) {
            const embeddingStr = `[${embedding.join(',')}]`

            // 2. Query match_faqs similarity search
            const { data: matchedFaqs, error: rpcError } = await supabase.rpc('match_faqs', {
              query_embedding: embeddingStr,
              match_threshold: 0.60,
              match_count: 3,
              org_id: orgId
            })

            if (rpcError) {
              console.error('[Webhook Chatbot] match_faqs RPC error:', rpcError)
            }

            const faqs = matchedFaqs || []
            console.log(`[Webhook Chatbot] Found ${faqs.length} matching FAQs for auto-reply`)

            // 3. Format matched context
            const formattedContext = faqs.map((faq: any, i: number) => {
              return `[FAQ ${i + 1}]\nQuestion: ${faq.title}\nAnswer: ${faq.content}`
            }).join('\n\n---\n\n')

            // 4. Fetch last 6 messages for conversation context
            const { data: recentMessages } = await supabase
              .from('messages')
              .select('sender_type, body')
              .eq('conversation_id', conversation.id)
              .order('created_at', { ascending: false })
              .limit(6)

            const chatHistory = (recentMessages || [])
              .reverse()
              .filter((m: any) => m.body)
              .map((m: any) => ({
                role: m.sender_type === 'contact' ? 'user' as const : 'assistant' as const,
                content: m.body
              }))

            console.log(`[Webhook Chatbot] Including ${chatHistory.length} previous messages as context`)

            // 5. Construct System Prompt
            const basePrompt = orgData.chatbot_base_prompt || DEFAULT_BASE_PROMPT
            const systemPrompt = `${basePrompt}

MATCHED FAQ ARTICLES FROM KNOWLEDGE BASE (Use this as your source of truth):
${formattedContext || '(No matching FAQs found in the knowledge base)'}

CONVERSATION HISTORY:
The messages below are the recent conversation between you (assistant) and the customer (user).
Use this history to maintain context, avoid repeating information, and respond naturally as a continuation of the conversation.`

            // 6. Call GPT-4o-mini with conversation history
            const gptResponse = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openAiKey}`
              },
              body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                  { role: 'system', content: systemPrompt },
                  ...chatHistory,
                  { role: 'user', content: messageBody }
                ],
                temperature: 0.3,
                max_tokens: 300
              })
            })

            if (gptResponse.ok) {
              const gptData = await gptResponse.json()
              const botReply = gptData.choices?.[0]?.message?.content?.trim() || ''

              if (botReply) {
                console.log(`[Webhook Chatbot] Generated reply: "${botReply}"`)

                // 6. Send reply via Twilio
                let twilioMessageSid = null
                try {
                  const twilioClient = twilio(twilioAccountSid, twilioAuthToken)
                  const cleanFrom = twilioWhatsappNumber.replace('whatsapp:', '')
                  const cleanTo = phoneNumber

                  const twilioMsg = await twilioClient.messages.create({
                    body: botReply,
                    to: isWhatsApp ? `whatsapp:${cleanTo}` : cleanTo,
                    from: isWhatsApp ? `whatsapp:${cleanFrom}` : cleanFrom
                  })
                  twilioMessageSid = twilioMsg.sid
                  console.log(`[Webhook Chatbot] Sent Twilio message: ${twilioMessageSid}`)
                } catch (sendErr: any) {
                  console.error('[Webhook Chatbot] Failed to send Twilio message:', sendErr.message)
                }

                // 7. Save bot reply in messages table
                await supabase
                  .from('messages')
                  .insert([
                    {
                      organization_id: orgId,
                      conversation_id: conversation.id,
                      sender_type: 'user',
                      body: botReply,
                      twilio_message_sid: twilioMessageSid
                    }
                  ])

                // 8. Update conversation timestamp
                await supabase
                  .from('conversations')
                  .update({ last_message_at: new Date().toISOString() })
                  .eq('id', conversation.id)
              }
            } else {
              console.error('[Webhook Chatbot] GPT API call failed:', gptResponse.status)
            }
          }
        } else {
          console.error('[Webhook Chatbot] Embedding API call failed:', embedRes.status)
        }
      } catch (err: any) {
        console.error('[Webhook Chatbot] Error in auto-reply process:', err)
      }
    }

    return NextResponse.json({ success: true, messageId: savedMessage.id })
  } catch (error) {
    console.error('[Webhook] POST Webhook error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
