/**
 * WhatsApp messages from the Front Desk counter: the bill (with its link) and booking confirmations.
 * Sent through the workspace's own WhatsApp number and logged in the customer's conversation.
 * WhatsApp only delivers free-form messages within 24 hours of the customer's last message; when
 * that window is closed the counter is told so, and can share the link another way.
 */

import { buildTextMessage } from '../commerce/commerce-messages'
import { sendWhatsAppMessage } from '../commerce/commerce-webhook-handler'
import { sendShared } from '../shared-whatsapp'
import { formatRupees } from './invoice'
import { formatIstDay, formatIstTime, istDate, phoneKey } from './spoken'
import { chosenTemplatePayload, parseMessageTemplates, PURPOSES, type FieldKey, type MessagePurpose, type MessageTemplateChoice } from './message-templates'

export type SendOutcome = { sent: boolean; error?: string; windowClosed?: boolean }

export function invoiceLink(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/i/${token}`
}

export function invoiceMessage(invoice: any, link: string): string {
  const business = invoice.business?.name || 'us'
  const firstName = String(invoice.customer_name || '').split(' ')[0]
  const greeting = firstName && firstName !== 'Walk-in' ? `Hi ${firstName}` : 'Hi'
  const paid = invoice.status === 'paid' ? ' (paid, thank you!)' : ''
  return `${greeting}, thank you for visiting ${business}! 🙏\nYour bill ${invoice.number}: ${formatRupees(Number(invoice.total))}${paid}\nView or download: ${link}`
}

export function bookingMessage(appointment: any, businessName: string | null, staffName: string | null): string {
  const firstName = String(appointment.customer_name || '').split(' ')[0]
  const services = (appointment.services || []).map((service: any) => service.name).join(', ')
  const when = `${formatIstDay(istDate(appointment.starts_at))}, ${formatIstTime(appointment.starts_at)}`
  return `Hi ${firstName}, your appointment${businessName ? ` at ${businessName}` : ''} is booked for ${when}${services ? ` (${services}${staffName ? ` with ${staffName}` : ''})` : ''}. See you soon! ✨`
}

/** When the 24-hour window has closed: which message this is, and what can fill a template's blanks. */
export interface TemplateFallback {
  purpose: MessagePurpose
  values: Partial<Record<FieldKey, string>>
}

/** The template the business picked for this message, if any (else the built-in one is used). */
async function chosenTemplate(db: any, organizationId: string, purpose: MessagePurpose): Promise<MessageTemplateChoice | null> {
  try {
    const { data } = await db.from('salon_settings').select('message_templates').eq('organization_id', organizationId).maybeSingle()
    const parsed = parseMessageTemplates(data?.message_templates)
    return 'value' in parsed ? parsed.value[purpose] || null : null
  } catch {
    return null
  }
}

/** Send the template the business set up for this message. There is no default: none set up, nothing sent. */
export async function sendFallbackTemplate(db: any, organization: any, phone: string, template: TemplateFallback): Promise<{ ok: boolean; messageId?: string | null; error?: string }> {
  const choice = await chosenTemplate(db, organization.id, template.purpose)
  if (!choice) return { ok: false, error: `No ${PURPOSES[template.purpose].title.toLowerCase()} template is set up (Front Desk → Setup → Templates).` }
  return sendWhatsAppMessage(organization, chosenTemplatePayload(choice, phone, template.values))
}

async function connectedOrganization(db: any, organizationId: string) {
  const { data: organization } = await db.from('organizations')
    .select('id, name, whatsapp_provider, whatsapp_api_token, whatsapp_phone_number_id, whatsapp_graph_api_version').eq('id', organizationId).maybeSingle()
  if (!organization?.whatsapp_api_token || !organization?.whatsapp_phone_number_id || (organization.whatsapp_provider && organization.whatsapp_provider !== 'facebook')) return null
  return organization
}

/** Note a message in the customer's chat, when there is one. */
async function logInChat(db: any, organizationId: string, phone: string, body: string, messageId: string | null | undefined) {
  try {
    const { data: contacts } = await db.from('contacts').select('id').eq('organization_id', organizationId).ilike('phone_number', `%${phoneKey(phone)}`).limit(1)
    const contactId = contacts?.[0]?.id
    if (!contactId) return
    const { data: conversations } = await db.from('conversations').select('id').eq('organization_id', organizationId).eq('contact_id', contactId).order('last_message_at', { ascending: false }).limit(1)
    const conversationId = conversations?.[0]?.id
    if (!conversationId) return
    await db.from('messages').insert({ organization_id: organizationId, conversation_id: conversationId, sender_type: 'user', body, twilio_message_sid: messageId ? `FB_${messageId}` : null, status: 'sent' })
    await db.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId)
  } catch (error: any) {
    console.warn('[Front Desk WhatsApp] Sent, but could not log it in the chat:', error?.message)
  }
}

/** Does WAMA's number send this business's messages (Starter)? A billing read error means no. */
export async function usesSharedNumber(db: any, organizationId: string): Promise<boolean> {
  try {
    const { data } = await db.from('organization_billing').select('*').eq('organization_id', organizationId).maybeSingle()
    return data?.whatsapp_mode === 'shared' && data?.billing_exempt !== true
  } catch {
    return false
  }
}

const WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * When the customer last wrote to this number: a time, null when they never have, or undefined
 * when it could not be checked (then the message is tried as usual).
 */
export async function lastCustomerMessageAt(db: any, organizationId: string, phone: string): Promise<string | null | undefined> {
  try {
    const key = phoneKey(phone)
    if (key.length < 6) return undefined
    const { data: contacts, error } = await db.from('contacts').select('id').eq('organization_id', organizationId)
      .or(`phone_number.ilike.*${key},whatsapp_number.ilike.*${key}`).limit(5)
    if (error) return undefined
    const contactIds = (contacts || []).map((c: any) => c.id)
    // Not a saved contact: their chat cannot be found, so this cannot be told
    if (!contactIds.length) return undefined
    const { data: conversations, error: convError } = await db.from('conversations').select('id').eq('organization_id', organizationId).in('contact_id', contactIds).limit(20)
    if (convError) return undefined
    const conversationIds = (conversations || []).map((c: any) => c.id)
    if (!conversationIds.length) return null
    const { data: messages, error: msgError } = await db.from('messages').select('created_at').in('conversation_id', conversationIds).eq('sender_type', 'contact')
      .order('created_at', { ascending: false }).limit(1)
    if (msgError) return undefined
    return messages?.[0]?.created_at || null
  } catch {
    return undefined
  }
}

/** True when WhatsApp would refuse a free-form message: the customer has not written in 24 hours. */
export function windowIsClosed(lastAt: string | null | undefined, now = Date.now()): boolean {
  if (lastAt === undefined) return false
  if (lastAt === null) return true
  const at = Date.parse(lastAt)
  return Number.isFinite(at) ? now - at >= WINDOW_MS : false
}

/**
 * Send a message to a customer and log it in their chat. WhatsApp only delivers a free-form
 * message within 24 hours of the customer's last message, and it often accepts one first and
 * fails it later, so the window is checked before sending: when it is closed, the approved
 * template (if the business set one up) goes instead, and otherwise nothing is sent.
 */
export async function sendToCustomer(db: any, organizationId: string, phone: string, message: { text?: string; payload?: unknown; logBody: string }, template?: TemplateFallback): Promise<SendOutcome & { viaTemplate?: boolean }> {
  // Starter: the business has no WhatsApp of its own; WAMA's number sends the approved message for it
  if (await usesSharedNumber(db, organizationId)) {
    if (!template) return { sent: false, error: "On your plan, WAMA's number sends booking messages only. Connect your own WhatsApp (Growth or Pro) to chat with customers." }
    const shared = await sendShared(db, organizationId, phone, template.purpose, template.values)
    return shared.sent ? { sent: true, viaTemplate: true } : { sent: false, error: shared.error }
  }
  const organization = await connectedOrganization(db, organizationId)
  if (!organization) return { sent: false, error: 'WhatsApp is not connected for this workspace. Connect it in Settings.' }
  if (windowIsClosed(await lastCustomerMessageAt(db, organizationId, phone))) {
    const closed = 'This customer has not messaged you in the last 24 hours, so WhatsApp only delivers an approved template.'
    if (!template) return { sent: false, windowClosed: true, error: closed }
    const viaTemplate = await sendFallbackTemplate(db, organization, phone, template)
    if (viaTemplate.ok) {
      await logInChat(db, organizationId, phone, message.logBody, viaTemplate.messageId)
      return { sent: true, viaTemplate: true }
    }
    return { sent: false, windowClosed: true, error: `${closed} ${viaTemplate.error || ''}`.trim() }
  }
  const result = await sendWhatsAppMessage(organization, message.payload ?? buildTextMessage(phone, message.text || message.logBody))
  if (result.ok) {
    await logInChat(db, organizationId, phone, message.logBody, result.messageId)
    return { sent: true }
  }
  const windowClosed = /24 hours/i.test(result.error || '')
  if (windowClosed && template) {
    const viaTemplate = await sendFallbackTemplate(db, organization, phone, template)
    if (viaTemplate.ok) {
      await logInChat(db, organizationId, phone, message.logBody, viaTemplate.messageId)
      return { sent: true, viaTemplate: true }
    }
    console.warn(`[Front Desk WhatsApp] The ${template.purpose} template could not be sent:`, viaTemplate.error)
  }
  return { sent: false, error: result.error, windowClosed }
}

/** Send a text to a customer and log it in their conversation. */
export async function sendCustomerText(db: any, organizationId: string, phone: string, body: string, template?: TemplateFallback): Promise<SendOutcome> {
  return sendToCustomer(db, organizationId, phone, { text: body, logBody: body }, template)
}

const firstNameOf = (name: unknown) => {
  const first = String(name || '').trim().split(/\s+/)[0]
  return first && first !== 'Walk-in' ? first : 'there'
}

const servicesOf = (lines: any[]) => [...new Set((lines || []).map((line: any) => line?.name).filter(Boolean))].join(', ')
const staffOf = (lines: any[], fallback?: string | null) => [...new Set((lines || []).map((line: any) => line?.staff_name).filter(Boolean))].join(', ') || fallback || ''

/** What a bill can fill a template with: name, business, number, total, services, and the invoice token for the link button. */
export function billTemplate(invoice: any): TemplateFallback {
  return {
    purpose: 'bill',
    values: {
      first_name: firstNameOf(invoice.customer_name), customer_name: invoice.customer_name || 'Customer', business: invoice.business?.name || 'us',
      bill_number: invoice.number, amount: formatRupees(Number(invoice.total)), services: servicesOf(invoice.items) || 'your visit', staff: staffOf(invoice.items, invoice.staff_name),
      date: formatIstDay(istDate(invoice.issued_at || Date.now())), link: invoice.public_token,
    },
  }
}

/** What a booking can fill a template with. */
export function bookingTemplate(appointment: any, businessName: string | null, staffName: string | null): TemplateFallback {
  const services = (appointment.services || []).map((service: any) => service.name).join(', ')
  const day = formatIstDay(istDate(appointment.starts_at))
  const time = formatIstTime(appointment.starts_at)
  return {
    purpose: 'booking',
    values: {
      first_name: firstNameOf(appointment.customer_name), customer_name: appointment.customer_name || 'Customer', business: businessName || 'us',
      date_time: `${day} at ${time}`, date: day, time, services: services || 'your visit', staff: staffName || '', visit: `${services || 'your visit'}${staffName ? ` with ${staffName}` : ''}`,
    },
  }
}
