import { notifyTicketRaised } from '@/lib/push-events'
import { handleCodButton } from '@/lib/commerce/cod-check'
import { createClient } from '@supabase/supabase-js'
import { sendPush } from '@/lib/push'
import { findSharedNumber, handleSharedIncoming, handleSharedStatus } from '@/lib/shared-whatsapp'
import { answerFromKnowledge } from '@/lib/ai/faq-answer'
import { readHandoffSettings, wantsPerson } from '@/lib/ai/knowledge-rules'
import { handOffToTeam, recordKnowledgeGap } from '@/lib/ai/knowledge-store'
import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { verifyMetaSignature, ownsWhatsAppEvent, pickEventOwner } from '@/lib/meta-webhook'
import { executeFlowRuntime, saveUnownedSubmission } from '@/lib/flows/flow-executor'
import { buildWhatsAppFlowMessage } from '@/lib/flows/flow-messages'
import { isBsuid, canonicalizeBsuid, formatBsuidLabel } from '@/lib/whatsapp-bsuid'
import { trackChatbotEvent } from '@/lib/ai-analytics'
import { aiFetch, getAiAccess } from '@/lib/ai-access'
import { classifyGreeting } from '@/lib/greeting-classifier'
import { describeCart } from '@/lib/chat-commerce'
import { getMessagePreview } from '@/lib/chat-message-format'
import { runShoppingAssistant, shoppingAssistantEnabled } from '@/lib/commerce/shopping-assistant'
import { handleSlotPick, loadChatSetup, parseSlotButton, runSalonAssistant, salonChatReady } from '@/lib/salon/chat'
import { sessionFromToken } from '@/lib/salon/services-form'
import { activeBookingSession, cancelBooking, handleBookingFlowButton, isCancelWord, resumeBooking, handleBookingStepButton, handleBookingText, handleServicesForm, isBookingRequest, parseBookingFlow, parseFlowButton, parseStepButton, startBookingFlow, waitingForAnswer } from '@/lib/salon/booking-flow'
import { handleFeedbackReply, parseFeedbackButton } from '@/lib/salon/jobs'
import { formatMoney } from '@/lib/commerce/commerce-utils'
import {
  handleCheckoutButton,
  handleInboundCommerceOrder,
  orderIdFromFlowToken,
  handleInboundAddressSubmission,
  handleInboundPaymentConfirmation,
} from '@/lib/commerce/commerce-webhook-handler'

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

/** Which Meta app a workspace's saved token belongs to, remembered for an hour per token. */
const tokenAppCache = new Map<string, { appId: string | null; at: number }>()
const TOKEN_APP_CACHE_MS = 60 * 60 * 1000

/**
 * The Meta app ID when the workspace in the URL is connected to WhatsApp through its own Meta app
 * (not this one), otherwise null. Meta signs that app's webhooks with that app's secret.
 */
async function workspaceOwnMetaApp(context: { params: Promise<{ orgIdAndSlug: string }> | { orgIdAndSlug: string } }): Promise<string | null> {
  try {
    const resolvedParams = await (context.params as any)
    const orgId = String(resolvedParams?.orgIdAndSlug || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]
    if (!orgId) return null

    const { data: org } = await getSupabaseClient()
      .from('organizations')
      .select('whatsapp_provider, whatsapp_api_token')
      .eq('id', orgId)
      .maybeSingle()
    const token = String(org?.whatsapp_api_token || '')
    if (org?.whatsapp_provider !== 'facebook' || !token) return null

    const cacheKey = `${orgId}:${token.slice(-16)}`
    const cached = tokenAppCache.get(cacheKey)
    let appId = cached && Date.now() - cached.at < TOKEN_APP_CACHE_MS ? cached.appId : undefined
    if (appId === undefined) {
      const res = await fetch('https://graph.facebook.com/v25.0/app?fields=id', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.id) return null // Not known: refused, and Meta retries
      appId = String(data.id)
      tokenAppCache.set(cacheKey, { appId, at: Date.now() })
    }
    const thisApp = process.env.NEXT_PUBLIC_META_APP_ID || '1747554262928162'
    return appId && appId !== thisApp ? appId : null
  } catch (err) {
    console.error('[Facebook Webhook POST] Could not tell which Meta app this workspace uses:', err)
    return null
  }
}

/** The workspace that has this phone number or WhatsApp Business account connected, if exactly one does. */
async function findEventOwner(supabase: ReturnType<typeof getSupabaseClient>, wabaId: string, phoneNumberId: string) {
  // Meta IDs are digits only; anything else must not reach the filter
  const filters = [
    /^\d+$/.test(phoneNumberId) ? `whatsapp_phone_number_id.eq.${phoneNumberId}` : '',
    /^\d+$/.test(wabaId) ? `whatsapp_business_account_id.eq.${wabaId}` : '',
  ].filter(Boolean)
  if (filters.length === 0) return null

  const { data, error } = await supabase.from('organizations').select('*').or(filters.join(',')).limit(10)
  if (error) {
    console.error('[Facebook Webhook POST] Could not look up the workspace for this account:', error.message)
    return null
  }
  const owner = pickEventOwner(data, wabaId, phoneNumberId)
  if (!owner && (data || []).length > 1) console.error('[Facebook Webhook POST] Several workspaces have this account connected; event not delivered')
  return owner
}

async function processEvent(
  request: NextRequest,
  { params }: { params: Promise<{ orgIdAndSlug: string }> | { orgIdAndSlug: string } },
  options: { signed: boolean; afterReply?: () => Promise<void> }
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
    
    let orgId = uuidMatch[0]

    const payload = await request.json()
    const entry = payload.entry?.[0]
    const change = entry?.changes?.[0]
    const value = change?.value
    const eventWabaId = String(entry?.id || '')
    const eventPhoneNumberId = String(value?.metadata?.phone_number_id || '')

    // Fetch credentials for this specific organization
    const supabase = getSupabaseClient()
    let { data: orgData } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .maybeSingle()

    if (!ownsWhatsAppEvent(orgData, eventWabaId, eventPhoneNumberId)) {
      // A Meta app has one callback address, so an account's events can arrive at another workspace's
      // address: the app's default one when the account's own could not be set, or a workspace that has
      // since disconnected. They go to the workspace that has the account connected, which is only
      // trusted when Meta signed the payload.
      const owner = options.signed ? await findEventOwner(supabase, eventWabaId, eventPhoneNumberId) : null
      if (!owner) {
        console.warn('[Facebook Webhook POST] No workspace has this account connected. WABA:', eventWabaId, 'phone number ID:', eventPhoneNumberId)
        // Acknowledged, or Meta would retry an event no workspace can take for a week
        return NextResponse.json({ success: true, ignored: true, reason: 'No workspace has this WhatsApp account connected' })
      }
      orgData = owner
      orgId = owner.id
    }

    // Verify if Facebook is the active provider
    const provider = orgData.whatsapp_provider || 'twilio'
    if (provider !== 'facebook') {
      console.log(`[Facebook Webhook] Ignoring webhook event for Org ${orgId} because active provider is ${provider}`)
      return NextResponse.json({ success: true, ignored: true, reason: `Active provider is ${provider}` })
    }

    console.log('[Facebook Webhook POST] Event received for organization:', orgId)

    // If it's a status callback, acknowledge and exit
    if (value?.statuses) {
      console.log('[Facebook Webhook POST] Received status callback, acknowledging...')

      // In-chat payment results arrive here, as a status of type "payment" (not as a message).
      // Without this, a customer could pay and the order would stay "payment pending" forever.
      const paymentStatuses = (Array.isArray(value.statuses) ? value.statuses : []).filter((item: any) => item?.type === 'payment')
      if (paymentStatuses.length > 0 && orgData.enable_commerce !== false) {
        try {
          for (const paymentStatus of paymentStatuses) {
            console.log('[Facebook Webhook POST] Processing payment status:', paymentStatus.status, 'for reference', paymentStatus.payment?.reference_id)
            await handleInboundPaymentConfirmation({
              organization: orgData,
              paymentPayload: paymentStatus,
              customerPhone: paymentStatus.recipient_id ? String(paymentStatus.recipient_id) : undefined,
            })
          }
        } catch (paymentErr) {
          // Ask Meta to redeliver: recording a payment is idempotent, losing one is not acceptable
          console.error('[Facebook Webhook POST] Failed to record payment status:', paymentErr)
          return NextResponse.json({ error: 'Payment status could not be recorded' }, { status: 500 })
        }
      }

      try {
        const statusObj = value.statuses[0]
        if (statusObj && statusObj.type !== 'payment') {
          const messageSid = statusObj.id
          const status = statusObj.status // 'sent' | 'delivered' | 'read' | 'failed'
          const errorDetail = statusObj.errors?.[0]?.error_data?.details || statusObj.errors?.[0]?.message || null
          const timestamp = statusObj.timestamp 
            ? new Date(Number(statusObj.timestamp) * 1000).toISOString() 
            : new Date().toISOString()
          
          console.log('[Facebook Webhook POST] Updating message status:', { messageSid, status, timestamp, errorDetail })
          
          // Match either FB_ prefixed SID or raw SID
          const sidsToMatch = [`FB_${messageSid}`, messageSid]
          
          // 1. Update messages table
          const updateMsgData: any = {
            status: status,
            error_message: errorDetail,
          }
          if (status === 'read') {
            updateMsgData.read_at = timestamp
          }

          const { error: msgErr } = await supabase
            .from('messages')
            .update(updateMsgData)
            .in('twilio_message_sid', sidsToMatch)
            .eq('organization_id', orgId)

          if (msgErr) {
            console.warn('[Facebook Webhook POST] Error updating messages:', msgErr)
          }

          // 2. Update campaign_logs table
          const campaignLogStatus = 
            status === 'read' ? 'READ' :
            status === 'delivered' ? 'DELIVERED' :
            status === 'failed' ? 'FAILED' : 'SENT'

          await supabase
            .from('campaign_logs')
            .update({
              status: campaignLogStatus,
              error_message: errorDetail,
            })
            .in('message_sid', sidsToMatch)
            .eq('organization_id', orgId)
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

    const whatsappApiToken = orgData.whatsapp_api_token || ''
    const whatsappGraphApiVersion = orgData.whatsapp_graph_api_version || process.env.WHATSAPP_GRAPH_API_VERSION || 'v25.0'
    const whatsappPhoneNumberId = orgData.whatsapp_phone_number_id || ''
    // WAMA CRM AI (charged to the AI credits) or, for exempt workspaces, their own key; paused when credits run out
    const ai = orgData.enable_ai !== false ? await getAiAccess(supabase, orgId, orgData) : null
    const openAiKey = ai?.allowed ? ai.apiKey : ''

    // Parse message type and content
    let messageBody = ''
    let mediaId = null
    let mediaType = null
    let mediaCaption = ''
    let contentType = null

    let interactiveButtonId: string | undefined
    let flowSubmissionData: Record<string, any> | undefined

    const type = message.type
    if (type === 'text') {
      messageBody = message.text?.body || ''
    } else if (type === 'order') {
      const orderData = message.order
      const cartItems = Array.isArray(orderData?.product_items) ? orderData.product_items : []
      const cart = describeCart(cartItems)
      const total = cart.total > 0 ? ` · ${formatMoney(cart.total, cart.currency)}` : ''
      const note = orderData?.text ? ` (Note: "${orderData.text}")` : ''
      messageBody = `🛒 [WhatsApp Cart Order]: ${cartItems.length} item(s) selected${total}${note}`
    } else if (type === 'payment') {
      const payData = message.payment
      messageBody = `💳 [WhatsApp In-Chat Payment]: Reference ${payData?.reference_id || 'N/A'}, Status: ${payData?.status || 'success'}`
    } else if (type === 'interactive') {
      const interactive = message.interactive
      if (interactive?.type === 'button_reply') {
        messageBody = interactive.button_reply?.title || ''
        interactiveButtonId = interactive.button_reply?.id
      } else if (interactive?.type === 'list_reply') {
        messageBody = interactive.list_reply?.title || ''
        interactiveButtonId = interactive.list_reply?.id
      } else if (interactive?.type === 'payment_status') {
        messageBody = `💳 [WhatsApp Payment Status]: Reference ${interactive.payment_status?.reference_id || 'N/A'}, Status: ${interactive.payment_status?.status || 'completed'}`
      } else if (interactive?.type === 'nfm_reply') {
        try {
          const respStr = interactive.nfm_reply?.response_json
          if (respStr) {
            flowSubmissionData = JSON.parse(respStr)
            // The booking flow's services form reads as a plain line in the chat
            messageBody = sessionFromToken(flowSubmissionData?.flow_token || interactive.nfm_reply?.flow_token) ? '[Ticked services in the booking form]' : `[Completed Native Form]: ${JSON.stringify(flowSubmissionData)}`
          }
        } catch (jsonErr) {
          console.warn('[Facebook Webhook] Error parsing nfm_reply response_json:', jsonErr)
        }
      }
    } else if (type === 'button') {
      messageBody = message.button?.text || ''
      interactiveButtonId = message.button?.payload
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

    // Handle Meta Business-Scoped User ID (BSUID) or standard E.164 phone numbers
    const rawSender = from.trim()
    const senderIsBsuid = isBsuid(rawSender)
    const phoneNumber = senderIsBsuid
      ? canonicalizeBsuid(rawSender)
      : (rawSender.startsWith('+') ? rawSender : '+' + rawSender)

    // Step 1: Find or create the Contact
    // If BSUID, search for both canonical "CA.xxx" and legacy "+CA.xxx" to prevent duplicate contact creation
    const lookupNumbers = senderIsBsuid ? [phoneNumber, `+${phoneNumber}`] : [phoneNumber]
    const { data: existingContact } = await supabase
      .from('contacts')
      .select('id, organization_id')
      .eq('organization_id', orgId)
      .in('phone_number', lookupNumbers)
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

      // Auto-heal legacy or raw BSUID display names
      const currentFirstName = (contact.first_name || '').trim()
      const newProfileName = contactObj?.profile?.name?.trim()
      if (newProfileName && (isBsuid(currentFirstName) || currentFirstName.startsWith('+CA.') || currentFirstName.startsWith('+'))) {
        await supabase
          .from('contacts')
          .update({ first_name: newProfileName })
          .eq('id', contact.id)
        contact.first_name = newProfileName
      } else if (senderIsBsuid && (currentFirstName.startsWith('+') || !currentFirstName || currentFirstName === phoneNumber)) {
        const friendlyName = formatBsuidLabel(phoneNumber)
        await supabase
          .from('contacts')
          .update({ first_name: friendlyName, phone_number: phoneNumber })
          .eq('id', contact.id)
        contact.first_name = friendlyName
        contact.phone_number = phoneNumber
      }
    } else {
      let contactName = contactObj?.profile?.name?.trim()
      if (!contactName) {
        contactName = senderIsBsuid ? formatBsuidLabel(phoneNumber) : phoneNumber
      }

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
    const { data: previousMessage } = await supabase.from('messages').select('id').eq('organization_id', orgId).eq('twilio_message_sid', `FB_${messageSid}`).limit(1).maybeSingle()
    const { data: savedMessage, error: messageError } = previousMessage ? { data: previousMessage, error: null } : await supabase
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
        unread_count: (existingConv?.unread_count || 0) + (previousMessage ? 0 : 1),
      })
      .eq('id', conversation.id)

    if (updateError) {
      console.error('[Facebook Webhook] Error updating conversation metadata:', updateError)
    }

    // Pop-up notification on the team's phones: the person the chat is assigned to, else everyone
    if (!previousMessage) {
      const who = [contact?.first_name, contact?.last_name].filter(Boolean).join(' ').trim() || phoneNumber
      const isOrder = type === 'order'
      await sendPush(supabase, { organizationId: orgId, userIds: [(conversation as any)?.assigned_to] }, isOrder
        ? { kind: 'order', title: 'New order', body: `${who} sent an order on WhatsApp`, open: 'orders', tag: `order:${conversation.id}` }
        : { kind: 'message', title: who, body: messageBody || (finalMediaUrl ? 'Sent a file' : 'New message'), open: `chat:${conversation.id}`, tag: `chat:${conversation.id}` })
    }

    // ── Commerce Wing: Process in-chat e-commerce events ───────────────
    if (orgData.enable_commerce !== false) {
      // A. Native cart order from WhatsApp
      if (type === 'order' && message.order) {
        try {
          console.log('[Facebook Webhook] Processing native WhatsApp cart order for contact:', contact.id)
          await handleInboundCommerceOrder({
            organization: orgData,
            contact,
            conversation,
            orderPayload: message.order,
            customerPhone: phoneNumber,
            messageId: messageSid,
          })
          return NextResponse.json({ success: true, handled_by: 'commerce_order_engine' })
        } catch (commErr: any) {
          // Ask Meta to redeliver: recording a cart is idempotent, losing a customer's order is not
          // acceptable. (A cart must never fall through to the chatbot as if it were a text.)
          console.error('[Facebook Webhook Commerce] Failed to handle cart order:', commErr)
          return NextResponse.json({ error: 'The order could not be recorded' }, { status: 500 })
        }
      }

      // B. Delivery address form. WhatsApp returns the form's token inside the submitted data;
      //    it names the order ("order_<id>"). A form without it only counts as an address when
      //    this customer has an order waiting for one, so other forms that happen to ask for an
      //    address or PIN code are left to the flow engine.
      if (flowSubmissionData) {
        const flowToken = String(flowSubmissionData.flow_token || message.interactive?.nfm_reply?.flow_token || '')
        // Forms from a workflow (a bare id) or a campaign button belong to the flow engine, even when they ask for an address
        const workflowForm = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(flowToken) || flowToken.startsWith('campaign:')
        const looksLikeAddress = Boolean(orderIdFromFlowToken(flowToken)) || (!flowToken.startsWith('order_') && !workflowForm && Boolean(flowSubmissionData.address_line_1))
        if (looksLikeAddress) {
          try {
            const addressOrder = await handleInboundAddressSubmission({
              organization: orgData,
              contact,
              conversation,
              submissionData: flowSubmissionData,
              flowToken,
              customerPhone: phoneNumber,
            })
            if (addressOrder) {
              return NextResponse.json({ success: true, handled_by: 'commerce_address_engine' })
            }
          } catch (commErr: any) {
            console.error('[Facebook Webhook Commerce] Failed to handle address submission:', commErr)
            return NextResponse.json({ error: 'The delivery address could not be saved' }, { status: 500 })
          }
        }
      }

      // C. Native in-chat payment authorization
      if (type === 'payment' || (type === 'interactive' && message.interactive?.type === 'payment_status')) {
        try {
          const paymentPayload = message.payment || message.interactive?.payment_status
          console.log('[Facebook Webhook] Processing payment update for contact:', contact.id)
          await handleInboundPaymentConfirmation({
            organization: orgData,
            contact,
            conversation,
            paymentPayload,
            customerPhone: phoneNumber,
          })
          return NextResponse.json({ success: true, handled_by: 'commerce_payment_engine' })
        } catch (commErr: any) {
          console.error('[Facebook Webhook Commerce] Failed to handle payment update:', commErr)
          return NextResponse.json({ error: 'Payment update could not be recorded' }, { status: 500 })
        }
      }

      // C2. The shop's Cash on Delivery check: "Yes, send it" / "Cancel order" (also from a template's buttons)
      if (interactiveButtonId && /^cod(ok|no):/i.test(interactiveButtonId)) {
        try {
          const cod = await handleCodButton(supabase, orgData, interactiveButtonId, phoneNumber)
          if (cod.handled) return NextResponse.json({ success: true, handled_by: 'shop_cod_check', outcome: cod.outcome })
        } catch (codErr: any) {
          console.error('[Facebook Webhook Shop] COD check failed:', codErr?.message)
        }
      }

      // D. Checkout buttons: "Pay online", "Cash on Delivery", "Confirm order"
      if (interactiveButtonId) {
        try {
          const button = await handleCheckoutButton({
            organization: orgData,
            contact,
            conversation,
            buttonId: interactiveButtonId,
            customerPhone: phoneNumber,
          })
          if (button.handled) {
            return NextResponse.json({ success: true, handled_by: 'commerce_checkout_engine', outcome: button.outcome })
          }
        } catch (commErr: any) {
          console.error('[Facebook Webhook Commerce] Failed to handle checkout button:', commErr)
          return NextResponse.json({ error: 'The checkout step could not be completed' }, { status: 500 })
        }
      }
    }

    // Step 4.5: Execute and deliver every automatic step in order.
    // With automation off (an agent has the chat) a submitted form is still saved, just not acted on
    // ── Spa & Salon: a time tapped in the list of free times. The customer chose it, so it is booked
    //    even when auto-reply is off for this chat. A redelivered message was handled the first time.
    if (interactiveButtonId && parseSlotButton(interactiveButtonId) && salonChatReady(orgData) && !previousMessage) {
      try {
        const salon = await handleSlotPick({ supabase, organization: orgData, contact, conversationId: conversation.id, customerPhone: phoneNumber, ai, message: messageBody, history: [], buttonId: interactiveButtonId })
        if (salon.handled) {
          await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id)
          return NextResponse.json({ success: true, messageId: savedMessage.id, handled_by: 'salon_booking', action: salon.action })
        }
      } catch (salonErr: any) {
        console.error('[Facebook Webhook] Salon booking failed:', salonErr?.message || salonErr)
      }
    }

    // ── Front Desk booking flow: the services ticked in the tick-box form (its token names the booking in progress)
    if (flowSubmissionData && salonChatReady(orgData) && !previousMessage) {
      const formToken = String(flowSubmissionData.flow_token || message.interactive?.nfm_reply?.flow_token || '')
      if (sessionFromToken(formToken)) {
        try {
          const step = await handleServicesForm({ supabase, organization: orgData, contact, conversationId: conversation.id, customerPhone: phoneNumber, ai, message: messageBody, history: [], token: formToken, response: flowSubmissionData })
          if (step.handled) {
            await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id)
            return NextResponse.json({ success: true, messageId: savedMessage.id, handled_by: 'salon_booking_flow', step: step.step })
          }
        } catch (flowErr: any) {
          console.error('[Facebook Webhook] Booking flow form failed:', flowErr?.message || flowErr)
        }
      }
    }

    // ── Front Desk booking flow (the business's own steps): a tap in one of its lists or buttons
    if (interactiveButtonId && parseStepButton(interactiveButtonId) && salonChatReady(orgData) && !previousMessage) {
      try {
        const step = await handleBookingStepButton({ supabase, organization: orgData, contact, conversationId: conversation.id, customerPhone: phoneNumber, ai, message: messageBody, history: [], buttonId: interactiveButtonId })
        if (step.handled) {
          await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id)
          return NextResponse.json({ success: true, messageId: savedMessage.id, handled_by: 'salon_booking_flow', step: step.step })
        }
      } catch (flowErr: any) {
        console.error('[Facebook Webhook] Booking flow step failed:', flowErr?.message || flowErr)
      }
    }

    // ── Front Desk booking flow: the answer to a question that asked for a typed answer
    if (!interactiveButtonId && messageBody && salonChatReady(orgData) && !previousMessage) {
      try {
        const sessionId = await waitingForAnswer(supabase, orgId, phoneNumber)
        if (sessionId) {
          const step = await handleBookingText({ supabase, organization: orgData, contact, conversationId: conversation.id, customerPhone: phoneNumber, ai, message: messageBody, history: [], sessionId })
          if (step.handled) {
            await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id)
            return NextResponse.json({ success: true, messageId: savedMessage.id, handled_by: 'salon_booking_flow', step: step.step })
          }
        }
      } catch (flowErr: any) {
        console.error('[Facebook Webhook] Booking flow answer failed:', flowErr?.message || flowErr)
      }
    }

    // ── Front Desk booking flow (first version, lists already sent): a service, person or day tapped. The customer
    //    chose it, so the next step goes even when auto-reply is off for this chat.
    if (interactiveButtonId && parseFlowButton(interactiveButtonId) && salonChatReady(orgData) && !previousMessage) {
      try {
        const step = await handleBookingFlowButton({ supabase, organization: orgData, contact, conversationId: conversation.id, customerPhone: phoneNumber, ai, message: messageBody, history: [], buttonId: interactiveButtonId })
        if (step.handled) {
          await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id)
          return NextResponse.json({ success: true, messageId: savedMessage.id, handled_by: 'salon_booking_flow', step: step.step })
        }
      } catch (flowErr: any) {
        console.error('[Facebook Webhook] Booking flow step failed:', flowErr?.message || flowErr)
      }
    }

    // ── Front Desk booking flow: "Book" (or another word the business chose) starts it. No AI needed.
    if (!interactiveButtonId && messageBody && conversation.auto_reply_enabled !== false && salonChatReady(orgData) && !previousMessage) {
      try {
        const setup = await loadChatSetup(supabase, orgId)
        const flow = parseBookingFlow(setup.settings.booking_flow)
        if (flow.enabled && isBookingRequest(messageBody, flow.triggers)) {
          const started = await startBookingFlow({ supabase, organization: orgData, contact, conversationId: conversation.id, customerPhone: phoneNumber, ai, message: messageBody, history: [] }, setup)
          if (started.handled) {
            await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id)
            return NextResponse.json({ success: true, messageId: savedMessage.id, handled_by: 'salon_booking_flow', step: started.step })
          }
        }
      } catch (flowErr: any) {
        console.error('[Facebook Webhook] Booking flow could not start:', flowErr?.message || flowErr)
      }
    }

    // ── Spa & Salon: a rating tapped after a visit (from the list or the feedback template)
    if (interactiveButtonId && parseFeedbackButton(interactiveButtonId) && salonChatReady(orgData) && !previousMessage) {
      try {
        const feedback = await handleFeedbackReply({ supabase, organization: orgData, contact, customerPhone: phoneNumber, buttonId: interactiveButtonId })
        if (feedback.handled) {
          await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id)
          return NextResponse.json({ success: true, messageId: savedMessage.id, handled_by: 'salon_feedback', rating: feedback.rating })
        }
      } catch (feedbackErr: any) {
        console.error('[Facebook Webhook] Salon feedback failed:', feedbackErr?.message || feedbackErr)
      }
    }

    // ── Front Desk booking flow in progress and the customer wrote something else: "cancel" stops it;
    //    anything else (a question) goes to the assistants below, then the step they were on is sent
    //    again so the booking carries on (see POST)
    if (!interactiveButtonId && !flowSubmissionData && messageBody && conversation.auto_reply_enabled !== false && salonChatReady(orgData) && !previousMessage) {
      try {
        const sessionId = await activeBookingSession(supabase, orgId, phoneNumber)
        if (sessionId) {
          const bookingInput = { supabase, organization: orgData, contact, conversationId: conversation.id, customerPhone: phoneNumber, ai, message: messageBody, history: [], sessionId }
          if (isCancelWord(messageBody)) {
            const cancelled = await cancelBooking(bookingInput)
            if (cancelled.handled) return NextResponse.json({ success: true, messageId: savedMessage.id, handled_by: 'salon_booking_flow', step: cancelled.step })
          }
          options.afterReply = async () => { await resumeBooking(bookingInput) }
        }
      } catch (flowErr: any) {
        console.error('[Facebook Webhook] Booking in progress could not be checked:', flowErr?.message || flowErr)
      }
    }

    if (conversation.auto_reply_enabled === false && flowSubmissionData) {
      try {
        await saveUnownedSubmission({ organizationId: orgId, contactPhone: phoneNumber, conversationId: conversation.id, flowSubmissionData, messageId: messageSid })
      } catch (error: any) {
        console.error('[Facebook Webhook Flow] Could not save the form answers:', error.message)
      }
    }
    if (conversation.auto_reply_enabled !== false) {
      try {
        const { count: inboundCount, error: countError } = await supabase.from('messages').select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId).eq('conversation_id', conversation.id).eq('sender_type', 'contact')
        if (countError) throw countError
        const contactName = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || phoneNumber
        const flowExec = await executeFlowRuntime({
          organizationId: orgId, contactPhone: phoneNumber, conversationId: conversation.id,
          userInput: messageBody, buttonId: interactiveButtonId, flowSubmissionData,
          messageId: messageSid, isFirstMessage: inboundCount === 1,
          contactData: { name: contactName, phone: phoneNumber, contact: { ...contact, name: contactName, phone: phoneNumber }, org: { name: orgData.name } },
          sendReply: async reply => {
            let sid: string | null = null
            let failure: string | null = null
            try {
              if (!whatsappPhoneNumberId || !whatsappApiToken) throw new Error('WhatsApp Cloud API credentials are missing in Settings')
              const response = await fetch(`https://graph.facebook.com/${whatsappGraphApiVersion}/${whatsappPhoneNumberId}/messages`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${whatsappApiToken}` },
                body: JSON.stringify(buildWhatsAppFlowMessage(phoneNumber, reply)), signal: AbortSignal.timeout(20000),
              })
              const data = await response.json()
              if (!response.ok || data.error || !data.messages?.[0]?.id) throw new Error(data.error?.message || 'Meta did not accept the flow message')
              sid = `FB_${data.messages[0].id}`
            } catch (error: any) { failure = error.message }
            const { error } = await supabase.from('messages').insert({ organization_id: orgId, conversation_id: conversation.id,
              sender_type: 'user', body: reply.body, twilio_message_sid: sid, status: failure ? 'failed' : 'sent', error_message: failure })
            if (error) throw error
            if (failure) throw new Error(failure)
          },
        })
        if (flowExec.handled) return NextResponse.json({ success: true, handled_by: 'whatsapp_flow_engine', action: flowExec.actionTaken })
      } catch (error: any) {
        console.error('[Facebook Webhook Flow] Execution failed:', error.message)
        return NextResponse.json({ error: 'Workflow execution failed', details: error.message }, { status: 503 })
      }
    }

    if (
      orgData.enable_ai !== false &&
      conversation.auto_reply_enabled !== false &&
      messageBody &&
      openAiKey &&
      !previousMessage
    ) {
      const greetingResult = classifyGreeting(messageBody)
      if (greetingResult.isGreeting) {
        console.log(`[Facebook Webhook Chatbot] Greeting detected (${greetingResult.category}), sent instant reply without OpenAI`)

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
                  body: greetingResult.suggestedReply
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

        await supabase
          .from('messages')
          .insert([
            {
              organization_id: orgId,
              conversation_id: conversation.id,
              sender_type: 'user',
              body: greetingResult.suggestedReply,
              twilio_message_sid: fbMessageSid
            }
          ])

        await supabase
          .from('conversations')
          .update({ last_message_at: new Date().toISOString() })
          .eq('id', conversation.id)

        return NextResponse.json({ success: true, messageId: savedMessage.id, handled_by: 'greeting_classifier' })
      }
    }

    // Step 5: Chatbot Auto-Reply Trigger (a redelivered message was answered the first time)
    if (
      orgData.enable_ai !== false &&
      conversation.auto_reply_enabled !== false &&
      messageBody &&
      openAiKey &&
      !previousMessage
    ) {
      console.log(`[Facebook Webhook Chatbot] Triggering auto-reply for conversation ${conversation.id}...`)
      const chatbotStartTime = Date.now()
      // "Talk to a person" goes straight to the team (the FAQ chatbot below hands it over)
      const askedPerson = wantsPerson(messageBody)

      // Product and order questions: the shopping assistant answers with the store's own products and
      // the customer's own orders. Everything else falls through to the FAQ chatbot below.
      // A redelivered message (Meta retries webhooks) was already answered the first time
      // Spa & Salon: questions about services, prices and timings, and bookings, answered from the
      // salon's own menu. Anything else passes to the shopping assistant and the FAQ chatbot.
      if (salonChatReady(orgData) && !previousMessage && !askedPerson) {
        try {
          const { data: recentForSalon } = await supabase
            .from('messages')
            .select('sender_type, body, media_url')
            .eq('conversation_id', conversation.id)
            .order('created_at', { ascending: false })
            .limit(9)
          const salonHistory = (recentForSalon || [])
            .slice(1)
            .reverse()
            .map((m: any) => ({ role: m.sender_type === 'contact' ? 'user' as const : 'assistant' as const, content: getMessagePreview(m) }))
            .filter((m: any) => m.content)
          const salon = await runSalonAssistant({ supabase, organization: orgData, contact, conversationId: conversation.id, customerPhone: phoneNumber, ai, message: messageBody, history: salonHistory })
          if (salon.handled) {
            await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id)
            console.log(`[Facebook Webhook Chatbot] Salon assistant answered (${salon.action}) in ${Date.now() - chatbotStartTime}ms`)
            return NextResponse.json({ success: true, messageId: savedMessage.id, handled_by: 'salon_assistant', action: salon.action })
          }
          console.log(`[Facebook Webhook Chatbot] Salon assistant passed it on: ${salon.reason}`)
        } catch (salonErr: any) {
          console.error('[Facebook Webhook Chatbot] Salon assistant failed:', salonErr?.message || salonErr)
        }
      }

      if (shoppingAssistantEnabled(orgData) && !previousMessage && !askedPerson) {
        try {
          const { data: recentForAssistant } = await supabase
            .from('messages')
            .select('sender_type, body, media_url')
            .eq('conversation_id', conversation.id)
            .order('created_at', { ascending: false })
            .limit(9)
          // The newest row is the message being answered; it is passed on its own
          const history = (recentForAssistant || [])
            .slice(1)
            .reverse()
            .map((m: any) => ({ role: m.sender_type === 'contact' ? 'user' as const : 'assistant' as const, content: getMessagePreview(m) }))
            .filter((m: any) => m.content)
          const assistant = await runShoppingAssistant({
            supabase,
            organization: orgData,
            contact,
            conversationId: conversation.id,
            customerPhone: phoneNumber,
            ai: ai!,
            message: messageBody,
            history,
          })
          if (assistant.handled) {
            await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id)
            console.log(`[Facebook Webhook Chatbot] Shopping assistant answered (${assistant.productsSent} product cards) in ${Date.now() - chatbotStartTime}ms`)
            return NextResponse.json({ success: true, messageId: savedMessage.id, handled_by: 'shopping_assistant' })
          }
          console.log(`[Facebook Webhook Chatbot] Shopping assistant passed to the FAQ chatbot: ${assistant.reason}`)
        } catch (assistantErr: any) {
          // The FAQ chatbot still answers
          console.error('[Facebook Webhook Chatbot] Shopping assistant failed:', assistantErr?.message || assistantErr)
        }
      }

      try {
        // The FAQ chatbot (lib/ai/faq-answer.ts): searches the knowledge base, answers only from it, and hands
        // the chat to the team when the customer asks for a person, complains, or the answer is not there.
        const { data: recentForFaq } = await supabase
          .from('messages')
          .select('sender_type, body, media_url')
          .eq('conversation_id', conversation.id)
          .order('created_at', { ascending: false })
          .limit(11)
        // The newest row is the message being answered; it is passed on its own
        const faqHistory = (recentForFaq || [])
          .slice(1)
          .reverse()
          .map((m: any) => ({ role: m.sender_type === 'contact' ? 'user' as const : 'assistant' as const, content: getMessagePreview(m) }))
          .filter((m: any) => m.content)
        const settings = readHandoffSettings(orgData.ai_handoff)
        const answer = await answerFromKnowledge({ db: supabase, ai: ai!, org: orgData, message: messageBody, history: faqHistory, channel: 'whatsapp', settings })

        if (answer?.reply) {
          let fbMessageSid: string | null = null
          let sendError: string | null = null
          if (whatsappPhoneNumberId && whatsappApiToken) {
            try {
              const fbRes = await fetch(`https://graph.facebook.com/${whatsappGraphApiVersion}/${whatsappPhoneNumberId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${whatsappApiToken}` },
                body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: phoneNumber.replace('+', '').trim(), type: 'text', text: { body: answer.reply } }),
                signal: AbortSignal.timeout(20000),
              })
              const fbData = await fbRes.json().catch(() => null)
              if (fbRes.ok && fbData?.messages?.[0]?.id) fbMessageSid = `FB_${fbData.messages[0].id}`
              else sendError = fbData?.error?.message || `WhatsApp did not accept the reply (${fbRes.status})`
            } catch (sendErr: any) {
              sendError = sendErr?.message || 'The reply could not be sent'
            }
          }
          if (sendError) console.error('[Facebook Webhook Chatbot] Reply not sent:', sendError)
          await supabase.from('messages').insert([{ organization_id: orgId, conversation_id: conversation.id, sender_type: 'user', body: answer.reply, twilio_message_sid: fbMessageSid, ...(sendError ? { status: 'failed', error_message: sendError } : {}) }])
          // The photos, videos and files of the FAQs the answer used, after the words
          for (const file of sendError ? [] : answer.attachments) {
            let fileSid: string | null = null
            let fileError: string | null = null
            try {
              const media = file.type === 'document' ? { link: file.url, filename: file.name || file.url.split('/').pop() } : { link: file.url }
              const res = await fetch(`https://graph.facebook.com/${whatsappGraphApiVersion}/${whatsappPhoneNumberId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${whatsappApiToken}` },
                body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: phoneNumber.replace('+', '').trim(), type: file.type, [file.type]: media }),
                signal: AbortSignal.timeout(20000),
              })
              const data = await res.json().catch(() => null)
              if (res.ok && data?.messages?.[0]?.id) fileSid = `FB_${data.messages[0].id}`
              else fileError = data?.error?.message || `WhatsApp did not accept the file (${res.status})`
            } catch (fileErr: any) {
              fileError = fileErr?.message || 'The file could not be sent'
            }
            await supabase.from('messages').insert([{ organization_id: orgId, conversation_id: conversation.id, sender_type: 'user', body: file.name || '[Media Attachment]', media_url: file.url, twilio_message_sid: fileSid, ...(fileError ? { status: 'failed', error_message: fileError } : {}) }])
          }
          await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id)
        }

        if (answer?.handoff) {
          const contactName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Unknown'
          await handOffToTeam(supabase, {
            organizationId: orgId, conversationId: conversation.id, contactId: contact.id, message: messageBody,
            reason: answer.reason || 'not_answered', summary: answer.summary, urgent: answer.urgent, channel: 'whatsapp', settings,
            contactName, contactPhone: contact.phone_number || contact.whatsapp_number || '',
          })
          if (answer.reason === 'not_answered') await recordKnowledgeGap(supabase, orgId, messageBody, conversation.id)
        }

        if (answer) {
          trackChatbotEvent({
            organization_id: orgId,
            conversation_id: conversation.id,
            query: messageBody,
            condensed_query: answer.searchQuery !== messageBody ? answer.searchQuery : null,
            confidence_level: answer.confidence === 'none' ? 'low' : answer.confidence,
            best_similarity: answer.hits.reduce((best, h) => Math.max(best, h.similarity ?? 0), 0) || null,
            matched_faq_count: answer.hits.length,
            matched_faq_titles: answer.hits.map((h) => h.title),
            was_escalated: answer.handoff,
            was_cached: false,
            was_greeting: answer.status === 'chat',
            response_time_ms: Date.now() - chatbotStartTime,
            model_used: answer.model,
            source: 'whatsapp',
          })
          console.log(`[Facebook Webhook Chatbot] ${answer.status}${answer.handoff ? ` → team (${answer.reason})` : ''}, ${answer.hits.length} FAQs (${answer.confidence}) in ${Date.now() - chatbotStartTime}ms`)
        } else {
          console.error('[Facebook Webhook Chatbot] The AI could not be reached; nothing sent')
        }
      } catch (err: any) {
        console.error('[Facebook Webhook Chatbot] Error in auto-reply process:', err)
      }
    }

    return NextResponse.json({ success: true, messageId: savedMessage.id })
  } catch (error: any) {
    console.error('[Facebook Webhook] POST Webhook error:', error)
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 })
  }
}

async function carryOnBooking(response: Response, afterReply: () => Promise<void>) {
  try {
    const result = await response.clone().json().catch(() => ({}))
    if (result?.handled_by === 'salon_assistant' && result?.action !== 'replied') return
    await afterReply()
  } catch (error: any) {
    console.error('[Facebook Webhook] Booking could not carry on after the answer:', error?.message || error)
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ orgIdAndSlug: string }> | { orgIdAndSlug: string } }) {
  // Read raw body for signature verification
  const rawBody = await request.text()

  // Verify X-Hub-Signature-256 HMAC (Meta signs every webhook POST)
  const signature = verifyMetaSignature(rawBody, request.headers.get('x-hub-signature-256'))
  if (!signature.valid) {
    // A workspace connected with its own Meta app gets that app's webhooks, signed with a secret this
    // server does not have. Those are taken for that workspace's own account only, as before signing
    // was checked; everything else must be signed with this app's secret.
    const ownApp = await workspaceOwnMetaApp(context)
    if (!ownApp) {
      console.error('[Facebook Webhook POST] Rejected:', signature.note)
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
    }
    console.warn(`[Facebook Webhook POST] ${signature.note}; accepted for this workspace only, which is connected through its own Meta app ${ownApp}`)
  } else if (signature.note) {
    console.warn('[Facebook Webhook POST]', signature.note)
  }
  // Signed by Meta with this app's secret, as opposed to unchecked (a developer's machine, or a
  // workspace's own Meta app): only a signed event may be delivered to another workspace
  const signed = signature.valid && !signature.note

  let payload: any
  try { payload = JSON.parse(rawBody) }
  catch { return NextResponse.json({ error: 'Invalid webhook JSON' }, { status: 400 }) }
  const shared = signed ? (await findSharedNumber(getSupabaseClient()).catch(() => null))?.config || null : null
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {}
      // WAMA's own number also sends booking messages for Starter businesses: a failure is given back
      // to their wallet, and their customers' replies get the business's phone number instead of the
      // platform's chatbot
      const sharedCustomers = new Set<string>()
      if (shared && value?.metadata?.phone_number_id === shared.phoneNumberId) {
        const db = getSupabaseClient()
        for (const status of value.statuses || []) await handleSharedStatus(db, status).catch((error: any) => console.error('[Shared number] status:', error?.message))
        for (const message of value.messages || []) {
          const result = await handleSharedIncoming(db, String(message?.from || '')).catch(() => ({ replied: false, known: false }))
          if (result.known) sharedCustomers.add(String(message.from))
        }
      }
      const events = [
        ...(value.statuses || []).map((status: any) => ({ ...value, messages: undefined, statuses: [status] })),
        ...(value.messages || []).filter((message: any) => !sharedCustomers.has(String(message?.from || ''))).map((message: any) => ({ ...value, statuses: undefined, messages: [message], contacts: (value.contacts || []).filter((contact: any) => contact.wa_id === message.from) })),
      ]
      for (const event of events) {
        const options: { signed: boolean; afterReply?: () => Promise<void> } = { signed }
        const response = await processEvent(new NextRequest(request.url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, entry: [{ ...entry, changes: [{ ...change, value: event }] }] }) }), context, options)
        if (!response.ok) return response
        if (options.afterReply) await carryOnBooking(response, options.afterReply)
      }
    }
  }
  return NextResponse.json({ success: true })
}
