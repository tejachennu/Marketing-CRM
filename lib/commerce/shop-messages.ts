/**
 * WhatsApp messages the shop sends by itself: cart reminder, Cash on Delivery check, review ask, back in stock,
 * order again. Inside WhatsApp's 24-hour window they go as free text (with buttons where useful); outside it
 * only with an approved template the business sets up once (E-commerce → Store settings → WhatsApp messages).
 * No template and the window closed = nothing is sent (WhatsApp would refuse it anyway).
 *
 * Settings: organizations.shop_messages = { <purpose>: { on, template, language } }.
 */

export const SHOP_PURPOSES = ['cart_reminder', 'cod_confirm', 'review_ask', 'back_in_stock'] as const
export type ShopPurpose = (typeof SHOP_PURPOSES)[number]

export const SHOP_MESSAGE_INFO: Record<ShopPurpose, { title: string; when: string; blanks: string[]; buttons?: string[]; defaultOn: boolean }> = {
  cart_reminder: { title: 'Cart reminder', when: 'An hour after a customer left items in the cart without ordering (once).', blanks: ['Customer name', 'What is in the cart', 'Shop name', 'Link back to the cart'], defaultOn: false },
  cod_confirm: { title: 'Cash on Delivery check', when: 'Right after a Cash on Delivery order, before you ship it.', blanks: ['Customer name', 'Order number', 'Amount to pay', 'Shop name'], buttons: ['Yes, send it', 'Cancel order'], defaultOn: true },
  review_ask: { title: '"How was it?" review ask', when: 'When the order is delivered.', blanks: ['Customer name', 'Order number', 'Link to write a review'], defaultOn: true },
  back_in_stock: { title: 'Back in stock', when: 'When a product someone asked about is back in stock.', blanks: ['Product name', 'Shop name', 'Link to the product'], defaultOn: true },
}

export interface ShopMessageSetting {
  on: boolean
  /** Approved WhatsApp template name and its language code (for outside the 24-hour window). */
  template: string
  language: string
}

export function readShopMessages(raw: any): Record<ShopPurpose, ShopMessageSetting> {
  const out = {} as Record<ShopPurpose, ShopMessageSetting>
  for (const p of SHOP_PURPOSES) {
    const r = raw?.[p] || {}
    out[p] = {
      on: r.on === undefined ? SHOP_MESSAGE_INFO[p].defaultOn : r.on === true,
      template: String(r.template || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 512),
      language: String(r.language || 'en').trim().replace(/[^A-Za-z_]/g, '').slice(0, 10) || 'en',
    }
  }
  return out
}

/** A WhatsApp template message with its blanks filled, and quick-reply buttons carrying our ids. */
export function templatePayload(phone: string, setting: ShopMessageSetting, values: string[], buttonIds: string[] = []) {
  const components: any[] = []
  if (values.length) components.push({ type: 'body', parameters: values.map((text) => ({ type: 'text', text: String(text || '-').slice(0, 1000) })) })
  buttonIds.forEach((id, index) => components.push({ type: 'button', sub_type: 'quick_reply', index: String(index), parameters: [{ type: 'payload', payload: id }] }))
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(phone).replace(/[^\d]/g, ''),
    type: 'template',
    template: { name: setting.template, language: { code: setting.language }, ...(components.length ? { components } : {}) },
  }
}

/** Button ids the shop puts on its messages (kept short: WhatsApp allows 256 characters). */
export function shopButton(kind: 'codok' | 'codno', orderId: string): string {
  return `${kind}:${orderId}`
}
export function readShopButton(id: unknown): { kind: 'codok' | 'codno'; orderId: string } | null {
  const m = String(id || '').match(/^(codok|codno):([0-9a-f-]{36})$/i)
  return m ? { kind: m[1].toLowerCase() as 'codok' | 'codno', orderId: m[2].toLowerCase() } : null
}

/** What the order screen says about the Cash on Delivery check (null = not asked). */
export function codCheckLabel(order: { shipping_address?: any }): { text: string; red: boolean } | null {
  const c = order.shipping_address?.cod_check
  if (!c) return null
  if (c.answer === 'yes') return { text: 'The customer said yes on WhatsApp', red: false }
  if (c.answer === 'cancel') return { text: 'The customer cancelled on WhatsApp', red: true }
  return { text: "Waiting for the customer's yes on WhatsApp", red: false }
}
