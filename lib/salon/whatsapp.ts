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

/** Send a text to a customer and log it in their conversation. */
export async function sendCustomerText(db: any, organizationId: string, phone: string, body: string): Promise<SendOutcome> {
  const { data: organization } = await db.from('organizations')
    .select('id, whatsapp_provider, whatsapp_api_token, whatsapp_phone_number_id, whatsapp_graph_api_version').eq('id', organizationId).maybeSingle()
  if (!organization?.whatsapp_api_token || !organization?.whatsapp_phone_number_id || (organization.whatsapp_provider && organization.whatsapp_provider !== 'facebook')) {
    return { sent: false, error: 'WhatsApp is not connected for this workspace. Connect it in Settings.' }
  }
  const result = await sendWhatsAppMessage(organization, buildTextMessage(phone, body))
  if (!result.ok) return { sent: false, error: result.error, windowClosed: /24 hours/i.test(result.error || '') }

  // Show it in the chat with this customer, when there is one
  try {
    const { data: contacts } = await db.from('contacts').select('id').eq('organization_id', organizationId).ilike('phone_number', `%${phoneKey(phone)}`).limit(1)
    const contactId = contacts?.[0]?.id
    if (contactId) {
      const { data: conversations } = await db.from('conversations').select('id').eq('organization_id', organizationId).eq('contact_id', contactId).order('last_message_at', { ascending: false }).limit(1)
      const conversationId = conversations?.[0]?.id
      if (conversationId) {
        await db.from('messages').insert({ organization_id: organizationId, conversation_id: conversationId, sender_type: 'user', body, twilio_message_sid: result.messageId ? `FB_${result.messageId}` : null, status: 'sent' })
        await db.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId)
      }
    }
  } catch (error: any) {
    console.warn('[Salon WhatsApp] Sent, but could not log it in the chat:', error?.message)
  }
  return { sent: true }
}
