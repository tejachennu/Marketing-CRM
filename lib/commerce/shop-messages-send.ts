/**
 * Sending the shop's own WhatsApp messages (rules in shop-messages.ts). Server only.
 */

import { buildButtonsMessage, buildTextMessage } from './commerce-messages'
import { sendWhatsAppMessage } from './commerce-webhook-handler'
import { lastCustomerMessageAt, logInChat, windowIsClosed } from '../salon/whatsapp'
import { readShopMessages, shopTemplateValues, templatePayload, type ShopMessageSetting, type ShopPurpose } from './shop-messages'

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
  if (closed && !setting.template) return { sent: false, skipped: 'window_closed_no_template' }
  const result = closed
    ? await sendShopTemplate(org, phone, purpose, setting, message.values, (message.buttons || []).map((b) => b.id))
    : await sendWhatsAppMessage(org, message.buttons?.length ? buildButtonsMessage(phone, message.text, message.buttons) : buildTextMessage(phone, message.text))
  if (!result.ok) return { sent: false, viaTemplate: closed, error: result.error || 'WhatsApp refused the message.' }
  await logInChat(db, org.id, phone, message.text, result.messageId)
  return { sent: true, viaTemplate: closed }
}

/**
 * Send the shop's template for a message. While a newer wording waits for Meta's approval WhatsApp refuses it, so
 * the earlier approved one (kept as `previous`) is sent instead.
 */
export async function sendShopTemplate(org: any, phone: string, purpose: ShopPurpose, setting: ShopMessageSetting, values: string[], buttonIds: string[] = []): Promise<{ ok: boolean; messageId?: string | null; error?: string }> {
  const first = await sendWhatsAppMessage(org, templatePayload(phone, setting, shopTemplateValues(purpose, setting, values), buttonIds))
  if (first.ok || !setting.previous?.template) return first
  const fallback = await sendWhatsAppMessage(org, templatePayload(phone, setting.previous, shopTemplateValues(purpose, setting.previous, values), buttonIds))
  return fallback.ok ? fallback : first
}
