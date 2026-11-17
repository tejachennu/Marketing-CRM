/**
 * Sending the shop's own WhatsApp messages (rules in shop-messages.ts). Server only.
 */

import { buildButtonsMessage, buildTextMessage } from './commerce-messages'
import { sendWhatsAppMessage } from './commerce-webhook-handler'
import { lastCustomerMessageAt, logInChat, windowIsClosed } from '../salon/whatsapp'
import { readShopMessages, templatePayload, type ShopPurpose } from './shop-messages'

export interface ShopSendResult {
  sent: boolean
  viaTemplate?: boolean
  skipped?: 'off' | 'no_whatsapp' | 'window_closed_no_template'
  error?: string
}

/**
 * Send one shop message: switched off = nothing; inside 24 hours = free text (+ buttons); outside = the
 * business's template with `values` as its blanks (and the button ids as quick-reply payloads).
 */
export async function sendShopMessage(db: any, org: any, phone: string, purpose: ShopPurpose, message: { text: string; values: string[]; buttons?: { id: string; title: string }[] }): Promise<ShopSendResult> {
  const setting = readShopMessages(org?.shop_messages)[purpose]
  if (!setting.on) return { sent: false, skipped: 'off' }
  if (!org?.whatsapp_api_token || !org?.whatsapp_phone_number_id) return { sent: false, skipped: 'no_whatsapp' }
  const closed = windowIsClosed(await lastCustomerMessageAt(db, org.id, phone))
  let payload: unknown
  let viaTemplate = false
  if (!closed) payload = message.buttons?.length ? buildButtonsMessage(phone, message.text, message.buttons) : buildTextMessage(phone, message.text)
  else if (setting.template) { payload = templatePayload(phone, setting, message.values, (message.buttons || []).map((b) => b.id)); viaTemplate = true }
  else return { sent: false, skipped: 'window_closed_no_template' }
  const result = await sendWhatsAppMessage(org, payload)
  if (!result.ok) return { sent: false, viaTemplate, error: result.error || 'WhatsApp refused the message.' }
  await logInChat(db, org.id, phone, message.text, result.messageId)
  return { sent: true, viaTemplate }
}
