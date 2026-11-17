/**
 * Cash on Delivery check on WhatsApp: right after a COD order the customer gets "Yes, send it" / "Cancel order".
 * The answer is kept on the order (shipping_address.cod_check) so the team ships only confirmed ones, and a
 * "Cancel" cancels the order before anything is shipped (stock of options goes back). Cuts COD parcels that
 * come back unopened. Server only.
 */

import { buildTextMessage } from './commerce-messages'
import { sendWhatsAppMessage } from './commerce-webhook-handler'
import { formatMoney } from './commerce-utils'
import { readShopButton, shopButton } from './shop-messages'
import { sendShopMessage } from './shop-messages-send'
import { changeVariantStock } from './variant-store'
import { logInChat } from '../salon/whatsapp'

/** A COD order that is still waiting to be shipped. */
export function needsCodCheck(order: { payment_method?: string | null; payment_status?: string | null; status?: string; shipping_address?: any }): boolean {
  return order.payment_method === 'cod' && order.payment_status !== 'paid' && ['cod_confirmed', 'cart_submitted', 'awaiting_address'].includes(String(order.status)) && order.shipping_address?.handover !== 'now'
}

export async function askCodCheck(db: any, org: any, order: any, phone: string) {
  if (!needsCodCheck(order)) return { sent: false }
  const first = String(order.shipping_address?.full_name || '').split(' ')[0]
  const amount = formatMoney(order.total_amount, order.currency)
  const shop = org?.storefront?.title || org?.name || 'our shop'
  const text = `${first ? `Hi ${first}` : 'Hi'}, thank you for your order #${order.order_number} at ${shop} 🙏\nYou will pay ${amount} in cash when it arrives. Shall we send it?`
  const result = await sendShopMessage(db, org, phone, 'cod_confirm', {
    text, values: [first || 'there', order.order_number, amount, shop],
    buttons: [{ id: shopButton('codok', order.id), title: 'Yes, send it' }, { id: shopButton('codno', order.id), title: 'Cancel order' }],
  })
  if (result.sent) {
    const shipping = { ...(order.shipping_address || {}), cod_check: { asked_at: new Date().toISOString() } }
    await db.from('commerce_orders').update({ shipping_address: shipping }).eq('id', order.id)
  }
  return result
}

/** A tap on "Yes, send it" / "Cancel order". Returns handled: false for any other button. */
export async function handleCodButton(db: any, org: any, buttonId: unknown, phone: string): Promise<{ handled: boolean; outcome?: string }> {
  const button = readShopButton(buttonId)
  if (!button) return { handled: false }
  const { data: order } = await db.from('commerce_orders').select('*, items:commerce_order_items(*)').eq('organization_id', org.id).eq('id', button.orderId).maybeSingle()
  if (!order) return { handled: true, outcome: 'order_not_found' }
  const reply = async (text: string) => {
    const sent = await sendWhatsAppMessage(org, buildTextMessage(phone, text)).catch(() => ({ ok: false } as any))
    if (sent?.ok) await logInChat(db, org.id, phone, text, sent.messageId)
  }
  const shipping = { ...(order.shipping_address || {}) }
  if (button.kind === 'codok') {
    if (shipping.cod_check?.answer === 'yes') return { handled: true, outcome: 'already_confirmed' }
    shipping.cod_check = { ...(shipping.cod_check || {}), answer: 'yes', answered_at: new Date().toISOString() }
    await db.from('commerce_orders').update({ shipping_address: shipping, updated_at: new Date().toISOString() }).eq('id', order.id)
    await reply(`Thank you! Order #${order.order_number} is confirmed. We will send it soon and share the tracking link here.`)
    return { handled: true, outcome: 'confirmed' }
  }
  // Cancel: only before it is shipped
  if (!['cod_confirmed', 'cart_submitted', 'awaiting_address', 'payment_pending'].includes(order.status)) {
    await reply(`Order #${order.order_number} is already on its way, so it cannot be cancelled here. Reply to this message and we will help you.`)
    return { handled: true, outcome: 'too_late' }
  }
  shipping.cod_check = { ...(shipping.cod_check || {}), answer: 'cancel', answered_at: new Date().toISOString() }
  const { data: done } = await db.from('commerce_orders').update({ status: 'canceled', shipping_address: shipping, updated_at: new Date().toISOString() }).eq('id', order.id).eq('status', order.status).select('id')
  if (done?.length) {
    for (const item of order.items || []) if (item.variant_id) await changeVariantStock(db, org.id, item.variant_id, Number(item.quantity) || 0).catch(() => null)
  }
  await reply(`Order #${order.order_number} is cancelled. We hope to see you again soon!`)
  return { handled: true, outcome: 'cancelled' }
}
