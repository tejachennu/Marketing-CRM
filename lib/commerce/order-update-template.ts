/**
 * Order updates (shipped, delivered, cancelled…) to a customer whose WhatsApp chat has closed (no message from
 * them in 24 hours): WhatsApp only delivers an approved template then, so the shop's "Order updates" template goes,
 * when the shop set one up (E-commerce → Store settings → WhatsApp messages). Server only.
 */

import { lastCustomerMessageAt, windowIsClosed } from '../salon/whatsapp'
import { readShopMessages } from './shop-messages'
import { sendShopTemplate } from './shop-messages-send'

/** The update sent through the shop's template, or null when the chat is open or no template is set up (send as usual). */
export async function sendOrderUpdateTemplate(db: any, organization: any, order: any, phone: string, text: string): Promise<{ ok: boolean; messageId?: string | null; error?: string } | null> {
  if (!organization?.id || !phone) return null
  if (!windowIsClosed(await lastCustomerMessageAt(db, organization.id, phone))) return null
  let settings = organization.shop_messages
  if (settings === undefined) {
    const { data } = await db.from('organizations').select('shop_messages').eq('id', organization.id).maybeSingle()
    settings = data?.shop_messages
  }
  const setting = readShopMessages(settings).order_update
  if (!setting.template) return null
  const first = String(order?.shipping_address?.full_name || order?.contact?.name || '').trim().split(/\s+/)[0] || 'there'
  return sendShopTemplate(organization, phone, 'order_update', setting, [first, String(order?.order_number || ''), text])
}
