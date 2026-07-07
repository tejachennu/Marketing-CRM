import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { expandQueryWithSynonyms, SynonymGroup, getActiveSynonymRelationships } from '@/lib/query-expander'

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

async function downloadFacebookMedia(
  mediaId: string,
  whatsappApiToken: string,
  whatsappGraphApiVersion: string
): Promise<string | null> {
  try {
    // Step 1: Retrieve Media URL from Graph API
    const metaUrl = `https://graph.facebook.com/${whatsappGraphApiVersion}/${mediaId}`
    const res = await fetch(metaUrl, {
      headers: {
        'Authorization': `Bearer ${whatsappApiToken}`
      }
    })
    if (!res.ok) {
      console.error('[Facebook Media] Failed to get media URL:', res.statusText)
      return null
    }
    const metaData = await res.json()
    const downloadUrl = metaData.url
    const contentType = metaData.mime_type || 'application/octet-stream'

    if (!downloadUrl) {
      console.error('[Facebook Media] Download URL missing in response')
      return null
    }

    // Step 2: Download Media Content
    const mediaRes = await fetch(downloadUrl, {
      headers: {
        'Authorization': `Bearer ${whatsappApiToken}`
      }
    })
    if (!mediaRes.ok) {
      console.error('[Facebook Media] Failed to download binary:', mediaRes.statusText)
      return null
    }

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

    const arrayBuffer = await mediaRes.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Convert to base64 data URL to store persistently in DB and avoid Vercel filesystem constraints
    const base64 = buffer.toString('base64')
    const dataUrl = `data:${contentType};base64,${base64}`
    console.log(`[Facebook Webhook] Media downloaded and converted to data URL, size: ${dataUrl.length}`)
    return dataUrl
  } catch (err) {
    console.error('[Facebook Webhook] Error downloading media:', err)
    return null
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgIdAndSlug: string }> | { orgIdAndSlug: string } }
) {
  try {
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('hub.mode')
    const token = searchParams.get('hub.verify_token')
    const challenge = searchParams.get('hub.challenge')

    const resolvedParams = await (params as any)
    const orgIdAndSlug = resolvedParams.orgIdAndSlug || ''
    const uuidMatch = orgIdAndSlug.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)

    if (!uuidMatch) {
      console.error('[Facebook Webhook GET] Invalid organization context:', orgIdAndSlug)
      return new NextResponse('Invalid organization context', { status: 400 })
    }

    const orgId = uuidMatch[0]

    // Verify token defaults to the organization's ID
    if (mode === 'subscribe' && token === orgId) {
      console.log('[Facebook Webhook GET] Verification successful for org:', orgId)
      return new NextResponse(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      })
    }

    console.warn('[Facebook Webhook GET] Verification failed. Mode:', mode, 'Token matched:', token === orgId)
    return new NextResponse('Verification failed', { status: 403 })
  } catch (error) {
    console.error('[Facebook Webhook GET] error:', error)
    return new NextResponse('Internal server error', { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgIdAndSlug: string }> | { orgIdAndSlug: string } }
) {
  try {
    // Resolve dynamic path params and extract organization UUID
    const resolvedParams = await (params as any)
    const orgIdAndSlug = resolvedParams.orgIdAndSlug || ''
    const uuidMatch = orgIdAndSlug.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    
    if (!uuidMatch) {
      console.error('[Facebook Webhook POST] Invalid organization parameter:', orgIdAndSlug)
      return NextResponse.json({ error: 'Invalid organization context' }, { status: 400 })
    }
    
    const orgId = uuidMatch[0]

    // Fetch credentials for this specific organization
    const supabase = getSupabaseClient()
    const { data: orgData } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .single()

    if (!orgData) {
      console.error('[Facebook Webhook POST] Organization not found:', orgId)
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    // Verify if Facebook is the active provider
    const provider = orgData.whatsapp_provider || 'twilio'
    if (provider !== 'facebook') {
      console.log(`[Facebook Webhook] Ignoring webhook event for Org ${orgId} because active provider is ${provider}`)
      return NextResponse.json({ success: true, ignored: true, reason: `Active provider is ${provider}` })
    }

    const payload = await request.json()
    console.log('[Facebook Webhook POST] Payload received:', JSON.stringify(payload, null, 2))

    const entry = payload.entry?.[0]
    const change = entry?.changes?.[0]
    const value = change?.value

    // If it's a status callback, acknowledge and exit
    if (value?.statuses) {
      console.log('[Facebook Webhook POST] Received status callback, acknowledging...')
      try {
        const statusObj = value.statuses[0]
        if (statusObj) {
          const messageSid = statusObj.id
          const status = statusObj.status
          const errorDetail = statusObj.errors?.[0]?.error_data?.details || statusObj.errors?.[0]?.message || null
          
          console.log('[Facebook Webhook POST] Updating message status:', { messageSid, status, errorDetail })
          
          // Remember we prefixed it with FB_ in the database
          const dbSid = `FB_${messageSid}`
          
          await supabase
            .from('messages')
            .update({
              status: status,
              error_message: errorDetail
            })
            .eq('twilio_message_sid', dbSid)
        }
      } catch (err) {
        console.error('[Facebook Webhook POST] Error processing status callback:', err)
      }
      return NextResponse.json({ success: true, type: 'status_update' })
    }

    const messages = value?.messages
    if (!messages || messages.length === 0) {
      return NextResponse.json({ success: true, type: 'no_messages' })
    }

    const message = messages[0]
    const contactObj = value?.contacts?.[0]
    const from = message.from || '' // Contact phone number (e.g. 14168777529)
    const messageSid = message.id || '' // Meta message ID

    if (!from || !messageSid) {
      console.error('[Facebook Webhook POST] Missing from or message ID')
      return NextResponse.json({ error: 'Missing required message parameters' }, { status: 400 })
    }

    const whatsappApiToken = orgData.whatsapp_api_token || process.env.WHATSAPP_API_TOKEN || ''
    const whatsappGraphApiVersion = orgData.whatsapp_graph_api_version || process.env.WHATSAPP_GRAPH_API_VERSION || 'v25.0'
    const whatsappPhoneNumberId = orgData.whatsapp_phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID || ''
    const openAiKey = orgData.openai_api_key || process.env.OPENAI_API_KEY || ''

    // Parse message type and content
    let messageBody = ''
    let mediaId = null
    let mediaType = null
    let mediaCaption = ''
    let contentType = null

    const type = message.type
    if (type === 'text') {
      messageBody = message.text?.body || ''
    } else if (type === 'interactive') {
      const interactive = message.interactive
      if (interactive?.type === 'button_reply') {
        messageBody = interactive.button_reply?.title || ''
      } else if (interactive?.type === 'list_reply') {
        messageBody = interactive.list_reply?.title || ''
      }
    } else if (type === 'button') {
      messageBody = message.button?.text || ''
    } else if (['image', 'document', 'audio', 'video', 'sticker', 'voice'].includes(type)) {
      const mediaObj = message[type]
      if (mediaObj) {
        mediaId = mediaObj.id
        mediaType = type
        mediaCaption = mediaObj.caption || ''
        contentType = mediaObj.mime_type || null
        messageBody = mediaCaption || ''
      }
    }

    // Download media content locally if available
    let finalMediaUrl = null
    if (mediaId && whatsappApiToken) {
      console.log('[Facebook Webhook] Fetching incoming media for id:', mediaId)
      const downloadedPath = await downloadFacebookMedia(
        mediaId,
        whatsappApiToken,
        whatsappGraphApiVersion
      )
      if (downloadedPath) {
        if (contentType) {
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

          finalMediaUrl = `${downloadedPath}#media${ext}`
        } else {
          finalMediaUrl = downloadedPath
        }
      }
    }

    // Standardize to E.164 with a leading plus symbol (e.g. +916303012453)
    const phoneNumber = from.trim().startsWith('+') ? from.trim() : '+' + from.trim()

    // Step 1: Find or create the Contact
    const { data: existingContact } = await supabase
      .from('contacts')
      .select('id, organization_id')
      .eq('organization_id', orgId)
      .eq('phone_number', phoneNumber)
      .limit(1)
      .maybeSingle()

    let contact: any = null

    if (existingContact) {
      const { data: fullContact } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', existingContact.id)
        .single()

      contact = fullContact
    } else {
      const contactName = contactObj?.profile?.name || phoneNumber
      const { data: newContact, error: createError } = await supabase
        .from('contacts')
        .insert([
          {
            organization_id: orgId,
            phone_number: phoneNumber,
            whatsapp_number: `whatsapp:${phoneNumber}`,
            first_name: contactName,
          },
        ])
        .select()
        .single()

      if (createError) {
        console.error('[Facebook Webhook] Error creating contact:', createError)
        throw createError
      }

      contact = newContact
      console.log('[Facebook Webhook] Auto-created new contact:', contact.id, 'for phone:', phoneNumber)
    }

    // Step 2: Find or create an active Conversation
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
        console.error('[Facebook Webhook] Error creating conversation:', convError)
        throw convError
      }

      conversation = newConv
      console.log('[Facebook Webhook] Auto-created new conversation:', conversation.id)
    }

    // Step 3: Store incoming message
    const { data: savedMessage, error: messageError } = await supabase
      .from('messages')
      .insert([
        {
          organization_id: orgId,
          conversation_id: conversation.id,
          sender_type: 'contact',
          body: messageBody,
          media_url: finalMediaUrl,
          twilio_message_sid: `FB_${messageSid}`,
        },
      ])
      .select()
      .single()

    if (messageError) {
      console.error('[Facebook Webhook] Error storing message:', messageError)
      throw messageError
    }

    console.log('[Facebook Webhook] Message stored:', savedMessage.id)

    // Step 4: Update conversation metadata
    const { error: updateError } = await supabase
      .from('conversations')
      .update({
        last_message_at: new Date().toISOString(),
        unread_count: (existingConv?.unread_count || 0) + 1,
      })
      .eq('id', conversation.id)

    if (updateError) {
      console.error('[Facebook Webhook] Error updating conversation metadata:', updateError)
    }

    // Step 5: Chatbot Auto-Reply Trigger
    if (
      orgData.enable_ai !== false &&
      conversation.auto_reply_enabled !== false &&
      messageBody &&
      openAiKey
    ) {
      console.log(`[Facebook Webhook Chatbot] Triggering auto-reply for conversation ${conversation.id}...`)
      try {
        // 1. Expand query with synonym dictionary for better matching
        const synonyms: SynonymGroup[] = orgData.service_synonyms || []
        const { vectorQuery, keywordQuery } = expandQueryWithSynonyms(messageBody, synonyms)
        console.log(`[Facebook Webhook Chatbot] Synonym expansion - Vector query: "${vectorQuery}", Keyword query: "${keywordQuery}"`)

        // 2. Generate query embedding (using expanded vector query)
        const embedRes = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openAiKey}`
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: vectorQuery.substring(0, 8000)
          })
        })

        if (embedRes.ok) {
          const embedData = await embedRes.json()
          const embedding = embedData.data?.[0]?.embedding

          if (embedding) {
            const embeddingStr = `[${embedding.join(',')}]`

            // 2. Query match_faqs similarity search and fallback keyword search in parallel
            let faqs: { title: string; content: string }[] = []
            try {
              let vectorFaqs: any[] = []
              let keywordFaqs: any[] = []

              // Try vector similarity match
              try {
                const { data: matchedFaqs, error: rpcError } = await supabase.rpc('match_faqs', {
                  query_embedding: embeddingStr,
                  match_threshold: 0.45, // Lowered threshold for text-embedding-3-small
                  match_count: 3,
                  org_id: orgId
                })
                if (rpcError) {
                  console.error('[Facebook Webhook Chatbot] match_faqs RPC error:', rpcError)
                } else {
                  vectorFaqs = matchedFaqs || []
                }
              } catch (vecErr) {
                console.error('[Facebook Webhook Chatbot] Vector RPC error:', vecErr)
              }

              // Always fetch keyword matches as well to build a hybrid pool using keywordQuery
              try {
                keywordFaqs = await fallbackKeywordSearch(supabase, keywordQuery, orgId)
              } catch (kwErr) {
                console.error('[Facebook Webhook Chatbot] Keyword fallback search error:', kwErr)
              }

              // Combine and deduplicate
              const merged: any[] = []
              const seen = new Set<string>()

              for (const f of vectorFaqs) {
                const titleLower = f.title.toLowerCase().trim()
                if (!seen.has(titleLower)) {
                  seen.add(titleLower)
                  merged.push({ title: f.title, content: f.content })
                }
              }

              for (const f of keywordFaqs) {
                const titleLower = f.title.toLowerCase().trim()
                if (!seen.has(titleLower)) {
                  seen.add(titleLower)
                  merged.push({ title: f.title, content: f.content })
                }
              }

              faqs = merged.slice(0, 3)
              console.log(`[Facebook Webhook Chatbot] Hybrid search merged ${faqs.length} FAQs (vector: ${vectorFaqs.length}, keyword: ${keywordFaqs.length})`)
            } catch (err) {
              console.error('[Facebook Webhook Chatbot] Search failed, falling back to simple keyword search:', err)
              try {
                faqs = await fallbackKeywordSearch(supabase, keywordQuery, orgId)
              } catch (kwFallbackErr) {
                console.error('[Facebook Webhook Chatbot] Ultimate keyword fallback failed:', kwFallbackErr)
              }
            }

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

            console.log(`[Facebook Webhook Chatbot] Including ${chatHistory.length} previous messages as context`)

            // Context-filter synonyms for terminology note
            const faqsText = faqs.map((f: any) => `${f.title} ${f.content}`).join(' ')
            const activeRelationships = getActiveSynonymRelationships(messageBody || '', faqsText, synonyms)
            
            let synonymContext = ''
            if (activeRelationships.length > 0) {
              synonymContext = `\n\nTERMINOLOGY EQUIVALENCE NOTE (Use this to match customer terms to FAQ terms):
${activeRelationships.map(r => `- ${r}`).join('\n')}`
            }

            // 5. Construct System Prompt
            const basePrompt = orgData.chatbot_base_prompt || DEFAULT_BASE_PROMPT
            const systemPrompt = `${basePrompt}

MATCHED FAQ ARTICLES FROM KNOWLEDGE BASE (Use this as your source of truth):
${formattedContext || '(No matching FAQs found in the knowledge base)'}${synonymContext}

CONVERSATION HISTORY:
The messages below are the recent conversation between you (assistant) and the customer (user).
Use this history to maintain context, avoid repeating information, and respond naturally as a continuation of the conversation.

CRITICAL INSTRUCTIONS:
You MUST respond in JSON format. The JSON object must contain two keys:
1. "reply": (string) Your natural conversational reply to the customer. If you cannot answer the query using the matched FAQ articles, or if the user asks to connect with support/a human, or if you need to hand off to a human agent, set "reply" to a friendly notice indicating that the support team will get in touch soon.
2. "isRiseTicket": (boolean) Set this to true ONLY if you cannot answer the user's question, if they explicitly ask for human/agent/support assistance, if they are reporting a bug or raising an issue that requires agent intervention, or if you are giving the fallback reply. Otherwise, set it to false.`

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
                response_format: { type: 'json_object' },
                temperature: 0.3,
                max_tokens: 300
              })
            })

            if (gptResponse.ok) {
              const gptData = await gptResponse.json()
              const contentString = gptData.choices?.[0]?.message?.content?.trim() || '{}'

              let botReply = ''
              let isRiseTicket = false

              try {
                const parsed = JSON.parse(contentString)
                botReply = parsed.reply || ''
                isRiseTicket = !!parsed.isRiseTicket
              } catch (parseErr) {
                console.error('[Facebook Webhook Chatbot] Failed to parse JSON response from GPT:', parseErr, contentString)
                botReply = contentString
                isRiseTicket = false
              }

              // Safety check: if bot reply or incoming message suggests human agent or support team, raise ticket
              const lowerReply = botReply.toLowerCase()
              const lowerIncoming = messageBody ? messageBody.toLowerCase() : ''
              if (
                !isRiseTicket &&
                (lowerReply.includes('support team') ||
                 lowerReply.includes('reply you soon') ||
                 lowerReply.includes('reply soon') ||
                 lowerReply.includes('contact you') ||
                 lowerReply.includes('reach you') ||
                 lowerReply.includes('human agent') ||
                 lowerReply.includes('representative') ||
                 lowerIncoming.includes('support team') ||
                 lowerIncoming.includes('human') ||
                 lowerIncoming.includes('agent') ||
                 lowerIncoming.includes('connect to support') ||
                 lowerIncoming.includes('talk to a person') ||
                 lowerIncoming.includes('representative') ||
                 lowerIncoming.includes('raise ticket') ||
                 lowerIncoming.includes('create ticket') ||
                 lowerIncoming.includes('need help'))
              ) {
                isRiseTicket = true
                console.log('[Facebook Webhook Chatbot] Force-setting isRiseTicket to true based on text analysis. Incoming:', messageBody, 'Reply:', botReply)
              }

              if (botReply) {
                console.log(`[Facebook Webhook Chatbot] Generated reply: "${botReply}" (isRiseTicket: ${isRiseTicket})`)

                // 6. Send reply via Facebook Cloud API
                let fbMessageSid = null
                if (whatsappPhoneNumberId && whatsappApiToken) {
                  try {
                    const fbRes = await fetch(`https://graph.facebook.com/${whatsappGraphApiVersion}/${whatsappPhoneNumberId}/messages`, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${whatsappApiToken}`
                      },
                      body: JSON.stringify({
                        messaging_product: 'whatsapp',
                        recipient_type: 'individual',
                        to: phoneNumber.replace('+', '').trim(),
                        type: 'text',
                        text: {
                          body: botReply
                        }
                      })
                    })

                    if (fbRes.ok) {
                      const fbData = await fbRes.json()
                      fbMessageSid = fbData.messages?.[0]?.id ? `FB_${fbData.messages[0].id}` : `FB_${Date.now()}`
                      console.log(`[Facebook Webhook Chatbot] Sent Facebook message: ${fbMessageSid}`)
                    } else {
                      const errText = await fbRes.text()
                      console.error(`[Facebook Webhook Chatbot] Failed to send Facebook message: ${fbRes.status} ${errText}`)
                    }
                  } catch (sendErr: any) {
                    console.error('[Facebook Webhook Chatbot] Failed to send Facebook message:', sendErr.message)
                  }
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
                      twilio_message_sid: fbMessageSid
                    }
                  ])

                // 8. Update conversation timestamp
                await supabase
                  .from('conversations')
                  .update({ last_message_at: new Date().toISOString() })
                  .eq('id', conversation.id)

                // 9. Generate a ticket if chatbot fallbacks or isRiseTicket is true
                if (isRiseTicket) {
                  try {
                    const { data: existingTicket } = await supabase
                      .from('tickets')
                      .select('id')
                      .eq('conversation_id', conversation.id)
                      .eq('status', 'open')
                      .limit(1)
                      .maybeSingle()

                    if (!existingTicket) {
                      const { data: newTicket } = await supabase
                        .from('tickets')
                        .insert([
                          {
                            organization_id: orgId,
                            conversation_id: conversation.id,
                            contact_id: contact.id,
                            subject: messageBody ? (messageBody.length > 100 ? messageBody.substring(0, 97) + '...' : messageBody) : 'Support Request',
                            status: 'open'
                          }
                        ])
                        .select('id')
                        .maybeSingle()

                      console.log('[Facebook Webhook Chatbot] Created active support ticket for conversation:', conversation.id)

                      if (newTicket) {
                        const contactName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Unknown'
                        const contactPhone = contact.phone_number || contact.whatsapp_number || ''
                        const originUrl = request.nextUrl ? request.nextUrl.origin : new URL(request.url).origin

                        // Trigger notifications asynchronously without blocking the webhook execution
                        fetch(`${originUrl}/api/tickets/notify`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            organizationId: orgId,
                            ticketSubject: messageBody ? (messageBody.length > 100 ? messageBody.substring(0, 97) + '...' : messageBody) : 'Support Request',
                            contactName,
                            contactPhone,
                            ticketId: newTicket.id
                          })
                        }).catch(err => console.error('[Facebook Webhook Notification] Failed to trigger ticket notification:', err))
                      }
                    }
                  } catch (ticketErr: any) {
                    console.error('[Facebook Webhook Chatbot] Failed to create support ticket:', ticketErr.message)
                  }
                }
              }
            } else {
              console.error('[Facebook Webhook Chatbot] GPT API call failed:', gptResponse.status)
            }
          }
        } else {
          console.error('[Facebook Webhook Chatbot] Embedding API call failed:', embedRes.status)
        }
      } catch (err: any) {
        console.error('[Facebook Webhook Chatbot] Error in auto-reply process:', err)
      }
    }

    return NextResponse.json({ success: true, messageId: savedMessage.id })
  } catch (error) {
    console.error('[Facebook Webhook] POST Webhook error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function fallbackKeywordSearch(
  supabase: any,
  queryText: string,
  orgId: string
): Promise<{ title: string; content: string }[]> {
  try {
    // 1. Search title column first (since it matches user question headers directly)
    const { data: titleMatches } = await supabase
      .from('knowledge_base')
      .select('title, content')
      .eq('organization_id', orgId)
      .textSearch('title', queryText, { config: 'english', type: 'websearch' })
      .limit(3)

    // 2. Search content column (for detail matches)
    const { data: contentMatches } = await supabase
      .from('knowledge_base')
      .select('title, content')
      .eq('organization_id', orgId)
      .textSearch('content', queryText, { config: 'english', type: 'websearch' })
      .limit(3)

    // 3. Combine and deduplicate, prioritizing title matches
    const merged: any[] = []
    const seen = new Set<string>()

    if (titleMatches) {
      for (const item of titleMatches) {
        const titleLower = item.title.toLowerCase().trim()
        if (!seen.has(titleLower)) {
          seen.add(titleLower)
          merged.push({ title: item.title, content: item.content })
        }
      }
    }

    if (contentMatches) {
      for (const item of contentMatches) {
        const titleLower = item.title.toLowerCase().trim()
        if (!seen.has(titleLower)) {
          seen.add(titleLower)
          merged.push({ title: item.title, content: item.content })
        }
      }
    }

    if (merged.length > 0) {
      return merged.slice(0, 3)
    }
  } catch (err) {
    console.error('[Keyword Search] Websearch failed, trying ILIKE:', err)
  }

  // 4. Final fallback: ILIKE on both title and content
  try {
    const rawWords = queryText
      .replace(/OR/g, ' ')
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w: string) => w.length > 2)

    if (rawWords.length > 0) {
      const ilikeFilters = rawWords.flatMap((w: string) => [
        `content.ilike.%${w}%`,
        `title.ilike.%${w}%`
      ])
      const { data: fallbackKb } = await supabase
        .from('knowledge_base')
        .select('title, content')
        .eq('organization_id', orgId)
        .or(ilikeFilters.join(','))
        .limit(3)

      return (fallbackKb || []).map((a: any) => ({ title: a.title, content: a.content }))
    }
  } catch (e) {
    console.error('[Keyword Search] ILIKE fallback search failed:', e)
  }

  return []
}
