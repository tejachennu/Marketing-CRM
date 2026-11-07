/**
 * WhatsApp messages from the salon counter: the bill (with its link) and booking confirmations.
 * Sent through the workspace's own WhatsApp number and logged in the customer's conversation.
 * WhatsApp only delivers free-form messages within 24 hours of the customer's last message; when
 * that window is closed the counter is told so, and can share the link another way.
 */

import { buildTextMessage } from '../commerce/commerce-messages'
import { sendWhatsAppMessage } from '../commerce/commerce-webhook-handler'
import { formatRupees } from './invoice'
import { formatIstDay, formatIstTime, istDate, phoneKey } from './spoken'
import { sendSalonTemplate, type SalonTemplateKey } from './templates'

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

export interface TemplateFallback {
  key: SalonTemplateKey
  params: string[]
  extra?: { urlSuffix?: string; quickReplyPayloads?: string[] }
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
    console.warn('[Salon WhatsApp] Sent, but could not log it in the chat:', error?.message)
  }
}

/**
 * Send a message to a customer and log it in their chat. When WhatsApp refuses because the
 * customer has not messaged in 24 hours, the approved template (if any) goes instead.
 */
export async function sendToCustomer(db: any, organizationId: string, phone: string, message: { text?: string; payload?: unknown; logBody: string }, template?: TemplateFallback): Promise<SendOutcome & { viaTemplate?: boolean }> {
  const organization = await connectedOrganization(db, organizationId)
  if (!organization) return { sent: false, error: 'WhatsApp is not connected for this workspace. Connect it in Settings.' }
  const result = await sendWhatsAppMessage(organization, message.payload ?? buildTextMessage(phone, message.text || message.logBody))
  if (result.ok) {
    await logInChat(db, organizationId, phone, message.logBody, result.messageId)
    return { sent: true }
  }
  const windowClosed = /24 hours/i.test(result.error || '')
  if (windowClosed && template) {
    const viaTemplate = await sendSalonTemplate(organization, template.key, phone, template.params, template.extra)
    if (viaTemplate.ok) {
      await logInChat(db, organizationId, phone, message.logBody, viaTemplate.messageId)
      return { sent: true, viaTemplate: true }
    }
    console.warn(`[Salon WhatsApp] The ${template.key} template could not be sent:`, viaTemplate.error)
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

/** The bill template's values: name, business, number, total, and the invoice token for the button. */
export function billTemplate(invoice: any): TemplateFallback {
  return { key: 'bill', params: [firstNameOf(invoice.customer_name), invoice.business?.name || 'us', invoice.number, formatRupees(Number(invoice.total))], extra: { urlSuffix: invoice.public_token } }
}

export function bookingTemplate(appointment: any, businessName: string | null, staffName: string | null): TemplateFallback {
  const services = (appointment.services || []).map((service: any) => service.name).join(', ')
  const when = `${formatIstDay(istDate(appointment.starts_at))} at ${formatIstTime(appointment.starts_at)}`
  return { key: 'booking', params: [firstNameOf(appointment.customer_name), businessName || 'us', when, `${services || 'your visit'}${staffName ? ` with ${staffName}` : ''}`] }
}
