/** Sending WhatsApp messages through the public API: a text, or an approved template. */

import { cleanTemplateValue } from '../salon/message-templates'
import { phoneKey } from '../salon/spoken'
import { normalizePhone } from './keys'

export type MessageInput =
  | { to: string; text: string }
  | { to: string; template: { name: string; language: string; body_parameters: string[]; header_parameters: string[]; button_parameters: string[] } }

const NAME = /^[a-z0-9_]{1,512}$/
const LANGUAGE = /^[a-z]{2,3}(_[A-Z]{2})?$/

function strings(value: unknown, field: string): { list: string[] } | { error: string; field: string } {
  if (value === undefined || value === null) return { list: [] }
  if (!Array.isArray(value) || value.length > 20 || value.some((v) => typeof v !== 'string' && typeof v !== 'number')) return { error: `${field} must be a list of up to 20 texts, one for each blank in order.`, field }
  return { list: value.map((v) => String(v)) }
}

export function parseMessageInput(body: any): { value: MessageInput } | { error: string; field: string } {
  const to = normalizePhone(body?.to)
  if (!to) return { error: 'Give the WhatsApp number in "to", with its country code, like +919876543210.', field: 'to' }
  if (body?.template !== undefined) {
    const template = body.template || {}
    const name = String(template.name || '').trim()
    if (!NAME.test(name)) return { error: 'template.name must be the template\'s name on WhatsApp, like "wama_bill".', field: 'template.name' }
    const language = String(template.language || 'en').trim()
    if (!LANGUAGE.test(language)) return { error: 'template.language must be a code like "en", "en_US", "hi" or "te".', field: 'template.language' }
    const bodyParams = strings(template.body_parameters, 'template.body_parameters')
    if ('error' in bodyParams) return bodyParams
    const headerParams = strings(template.header_parameters, 'template.header_parameters')
    if ('error' in headerParams) return headerParams
    const buttonParams = strings(template.button_parameters, 'template.button_parameters')
    if ('error' in buttonParams) return buttonParams
    return { value: { to, template: { name, language, body_parameters: bodyParams.list, header_parameters: headerParams.list, button_parameters: buttonParams.list } } }
  }
  const text = String(body?.text ?? '').trim()
  if (!text) return { error: 'Send "text" for a message, or "template" for an approved template.', field: 'text' }
  if (text.length > 4096) return { error: 'A WhatsApp message can be at most 4096 characters.', field: 'text' }
  return { value: { to, text } }
}

/** What goes to the WhatsApp Cloud API. Button parameters fill the link of URL buttons, in order. */
export function whatsappPayload(input: MessageInput) {
  const to = input.to.replace(/\D/g, '')
  if ('text' in input) return { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: true, body: input.text } }
  const components: any[] = []
  if (input.template.header_parameters.length) components.push({ type: 'header', parameters: input.template.header_parameters.map((t) => ({ type: 'text', text: cleanTemplateValue(t) })) })
  if (input.template.body_parameters.length) components.push({ type: 'body', parameters: input.template.body_parameters.map((t) => ({ type: 'text', text: cleanTemplateValue(t) })) })
  input.template.button_parameters.forEach((t, index) => components.push({ type: 'button', sub_type: 'url', index: String(index), parameters: [{ type: 'text', text: cleanTemplateValue(t) }] }))
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template', template: { name: input.template.name, language: { code: input.template.language }, components } }
}

/** How the message reads in the inbox. */
export function inboxText(input: MessageInput): string {
  if ('text' in input) return input.text
  const values = input.template.body_parameters.length ? `: ${input.template.body_parameters.join(' · ')}` : ''
  return `[Template ${input.template.name}]${values}`
}

/**
 * Put the sent message in the customer's chat, so the team sees it in the inbox: the contact and
 * conversation are found, or created for a new number.
 */
export async function logSentMessage(db: any, organizationId: string, phone: string, body: string, messageId: string | null): Promise<{ contactId: string | null; conversationId: string | null }> {
  try {
    const key = phoneKey(phone)
    const { data: found } = await db.from('contacts').select('id').eq('organization_id', organizationId).or(`phone_number.ilike.*${key},whatsapp_number.ilike.*${key}`).limit(1)
    let contactId: string | null = found?.[0]?.id || null
    if (!contactId) {
      const { data: created } = await db.from('contacts').insert({ organization_id: organizationId, first_name: null, phone_number: phone, whatsapp_number: `whatsapp:${phone}`, tags: ['API'] }).select('id').single()
      contactId = created?.id || null
    }
    if (!contactId) return { contactId: null, conversationId: null }
    const now = new Date().toISOString()
    const { data: conversations } = await db.from('conversations').select('id').eq('organization_id', organizationId).eq('contact_id', contactId).order('last_message_at', { ascending: false }).limit(1)
    let conversationId: string | null = conversations?.[0]?.id || null
    if (!conversationId) {
      const { data: created } = await db.from('conversations').insert({ organization_id: organizationId, contact_id: contactId, is_active: true, last_message_at: now }).select('id').single()
      conversationId = created?.id || null
    }
    if (conversationId) {
      await db.from('messages').insert({ organization_id: organizationId, conversation_id: conversationId, sender_type: 'user', body, twilio_message_sid: messageId ? `FB_${messageId}` : null, status: 'sent' })
      await db.from('conversations').update({ last_message_at: now }).eq('id', conversationId)
    }
    return { contactId, conversationId }
  } catch (error: any) {
    console.warn('[API] Sent, but could not put it in the inbox:', error?.message)
    return { contactId: null, conversationId: null }
  }
}
