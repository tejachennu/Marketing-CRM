import { NextResponse } from 'next/server'
import { describeWhatsAppError } from '@/lib/commerce/commerce-utils'
import { apiAuth, apiError, jsonBody } from '@/lib/public-api/auth'
import { inboxText, logSentMessage, parseMessageInput, whatsappPayload } from '@/lib/public-api/messages'
import { RateLimiter } from '@/lib/rate-limiter'

export const runtime = 'nodejs'
export const maxDuration = 30

const sendLimiter = new RateLimiter()

// POST /api/v1/messages: send a WhatsApp text (within 24 hours of the customer's last message) or an approved template
export async function POST(request: Request) {
  const auth = await apiAuth(request, 'messages:send')
  if (!auth.ok) return auth.response
  const { db, organizationId, organization, key } = auth.ctx
  const read = await jsonBody(request)
  if ('response' in read) return read.response
  const parsed = parseMessageInput(read.body)
  if ('error' in parsed) return apiError(400, 'invalid_request', parsed.error, { field: parsed.field })
  if (!organization.whatsapp_api_token || !organization.whatsapp_phone_number_id || (organization.whatsapp_provider && organization.whatsapp_provider !== 'facebook')) {
    return apiError(400, 'whatsapp_not_connected', 'Connect WhatsApp (Meta Cloud API) in Settings to send messages through the API.')
  }
  const limit = sendLimiter.checkRateLimit(`api-send:${key.id}`, 60, 60_000)
  if (!limit.allowed) return apiError(429, 'rate_limited', 'At most 60 messages a minute with one key. For bulk sending, use Campaigns.', {}, { 'Retry-After': String(Math.ceil(limit.retryAfterMs / 1000)) })

  const graph = organization.whatsapp_graph_api_version || 'v25.0'
  try {
    const res = await fetch(`https://graph.facebook.com/${graph}/${organization.whatsapp_phone_number_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${organization.whatsapp_api_token}` },
      body: JSON.stringify(whatsappPayload(parsed.value)),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || data?.error) {
      const code = Number(data?.error?.code)
      if (code === 131047) return apiError(422, 'outside_24h_window', 'This customer has not messaged you in the last 24 hours, so WhatsApp only allows an approved template. Send "template" instead of "text".')
      if (code === 132001) return apiError(422, 'template_not_found', 'No approved template with that name and language. GET /api/v1/templates lists them.')
      if (code === 132000) return apiError(422, 'template_parameters', 'The number of parameters does not match the template\'s blanks.')
      return apiError(422, 'whatsapp_refused', describeWhatsAppError(data?.error, `WhatsApp refused the message (HTTP ${res.status}).`), { whatsapp_code: Number.isFinite(code) ? code : null })
    }
    const messageId: string | null = data?.messages?.[0]?.id || null
    const logged = await logSentMessage(db, organizationId, parsed.value.to, inboxText(parsed.value), messageId)
    return NextResponse.json({ data: { id: messageId, to: parsed.value.to, status: 'sent', contact_id: logged.contactId, conversation_id: logged.conversationId } }, { status: 201 })
  } catch {
    return apiError(502, 'whatsapp_unreachable', 'WhatsApp could not be reached. Please try again.')
  }
}
