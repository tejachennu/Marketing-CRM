/**
 * WhatsApp messages the shop sends by itself: cart reminder, Cash on Delivery check, review ask, back in stock,
 * refunds and order updates. Inside WhatsApp's 24-hour window they go as free text (with buttons where useful);
 * outside it only with an approved template the business sets up once (E-commerce → Store settings → WhatsApp
 * messages: a suggested wording it can change and send to Meta for approval). No template and the window closed =
 * nothing is sent (WhatsApp would refuse it anyway).
 *
 * Settings: organizations.shop_messages = { <purpose>: { on, template, language, fields?, previous? } }.
 * `fields` says what fills each blank (made by the template editor); without it the blanks are filled in the
 * order of `blanks` below (a template typed in by name before the editor existed).
 */

import type { AutoMessageDef } from '../whatsapp-templates/auto-messages'

export const SHOP_PURPOSES = ['cart_reminder', 'cod_confirm', 'review_ask', 'back_in_stock', 'refund_update', 'order_update'] as const
export type ShopPurpose = (typeof SHOP_PURPOSES)[number]

export const SHOP_MESSAGE_INFO: Record<ShopPurpose, { title: string; when: string; blanks: string[]; buttons?: string[]; defaultOn: boolean; switchable?: false }> = {
  cart_reminder: { title: 'Cart reminder', when: 'An hour after a customer left items in the cart without ordering (once).', blanks: ['Customer name', 'What is in the cart', 'Shop name', 'Link back to the cart'], defaultOn: false },
  cod_confirm: { title: 'Cash on Delivery check', when: 'Right after a Cash on Delivery order, before you ship it.', blanks: ['Customer name', 'Order number', 'Amount to pay', 'Shop name'], buttons: ['Yes, send it', 'Cancel order'], defaultOn: true },
  review_ask: { title: '"How was it?" review ask', when: 'When the order is delivered.', blanks: ['Customer name', 'Order number', 'Link to write a review'], defaultOn: true },
  back_in_stock: { title: 'Back in stock', when: 'When a product someone asked about is back in stock.', blanks: ['Product name', 'Shop name', 'Link to the product'], defaultOn: true },
  refund_update: { title: 'Return and refund updates', when: 'When you accept or decline a return, and when you refund an order.', blanks: ['Customer name', 'Order number', 'What happened'], defaultOn: true },
  // Sent when the team changes an order's status and chooses to tell the customer, and when the courier moves the
  // parcel: always on (the order screen decides); the template only reaches customers whose chat has closed.
  order_update: { title: 'Order updates', when: 'When you change an order\'s status and tell the customer, and when the courier updates the parcel.', blanks: ['Customer name', 'Order number', 'The update'], defaultOn: true, switchable: false },
}

/** What fills each blank, in the same order as `blanks` above (the order the senders pass the values in). */
const SHOP_FIELDS: Record<ShopPurpose, { key: string; label: string; sample: string }[]> = {
  cart_reminder: [
    { key: 'first_name', label: 'Customer first name', sample: 'Asha' },
    { key: 'cart_items', label: 'What is in the cart', sample: '2 × Cotton kurta' },
    { key: 'shop', label: 'Shop name', sample: 'Glow Store' },
    { key: 'cart_link', label: 'Link back to the cart', sample: 'https://glowstore.in/?cart=Ab12Cd' },
  ],
  cod_confirm: [
    { key: 'first_name', label: 'Customer first name', sample: 'Asha' },
    { key: 'order_number', label: 'Order number', sample: 'W-1042' },
    { key: 'amount', label: 'Amount to pay', sample: '₹1,499' },
    { key: 'shop', label: 'Shop name', sample: 'Glow Store' },
  ],
  review_ask: [
    { key: 'first_name', label: 'Customer first name', sample: 'Asha' },
    { key: 'order_number', label: 'Order number', sample: 'W-1042' },
    { key: 'review_link', label: 'Link to write a review', sample: 'https://glowstore.in/review/Ab12Cd' },
  ],
  back_in_stock: [
    { key: 'product', label: 'Product name', sample: 'Cotton kurta (M)' },
    { key: 'shop', label: 'Shop name', sample: 'Glow Store' },
    { key: 'product_link', label: 'Link to the product', sample: 'https://glowstore.in/p/kurta' },
  ],
  refund_update: [
    { key: 'first_name', label: 'Customer first name', sample: 'Asha' },
    { key: 'order_number', label: 'Order number', sample: 'W-1042' },
    { key: 'update', label: 'What happened', sample: 'we have refunded ₹1,499 to your account.' },
  ],
  order_update: [
    { key: 'first_name', label: 'Customer first name', sample: 'Asha' },
    { key: 'order_number', label: 'Order number', sample: 'W-1042' },
    { key: 'update', label: 'The update', sample: 'Order #W-1042 has shipped with Delhivery.' },
  ],
}

/** Suggested wording: the facts of the order only, so Meta approves it as a Utility message. */
const SHOP_SUGGESTIONS: Record<ShopPurpose, { baseName: string; body: string; fields: string[]; buttons?: { text: string; note: string }[] }> = {
  cart_reminder: { baseName: 'cart_reminder', body: 'Hi {{1}}, you left {{2}} in your cart at {{3}}. Open {{4}} to finish your order. Reply to this message if you need help.', fields: ['first_name', 'cart_items', 'shop', 'cart_link'] },
  cod_confirm: {
    baseName: 'cod_order_check',
    body: 'Hi {{1}}, thank you for your order {{2}} at {{3}}. You will pay {{4}} in cash when it arrives. Please confirm so we can send it.',
    fields: ['first_name', 'order_number', 'shop', 'amount'],
    buttons: [{ text: 'Yes, send it', note: 'The customer confirms the order' }, { text: 'Cancel order', note: 'Cancels it before you ship it' }],
  },
  review_ask: { baseName: 'order_review_request', body: 'Hi {{1}}, your order {{2}} was delivered. Please tell us how it was at {{3}} so we can serve you better.', fields: ['first_name', 'order_number', 'review_link'] },
  back_in_stock: { baseName: 'back_in_stock_alert', body: 'Hello, you asked us to tell you when {{1}} is back at {{2}}. It is in stock now. See it here: {{3}} or reply to this message.', fields: ['product', 'shop', 'product_link'] },
  refund_update: { baseName: 'return_refund_update', body: 'Hi {{1}}, an update on your return for order {{2}}: {{3}} Reply to this message if you have any questions.', fields: ['first_name', 'order_number', 'update'] },
  order_update: { baseName: 'order_status_update', body: 'Hi {{1}}, here is an update on your order: {{2}} Reply to this message if you have any questions.', fields: ['first_name', 'update'] },
}

/** Each shop message for the template editor: what it can fill, its suggested text and its buttons. */
export const SHOP_MESSAGE_DEFS: Record<ShopPurpose, AutoMessageDef> = Object.fromEntries(SHOP_PURPOSES.map((purpose) => {
  const s = SHOP_SUGGESTIONS[purpose]
  const def: AutoMessageDef = {
    purpose,
    title: SHOP_MESSAGE_INFO[purpose].title,
    when: SHOP_MESSAGE_INFO[purpose].when,
    baseName: s.baseName,
    fields: SHOP_FIELDS[purpose],
    suggestion: { body: s.body, fields: s.fields },
    buttons: (s.buttons || []).map((b) => ({ type: 'QUICK_REPLY' as const, text: b.text, note: b.note })),
    urlField: null,
  }
  return [purpose, def]
})) as Record<ShopPurpose, AutoMessageDef>

export interface ShopTemplateRef {
  /** Approved WhatsApp template name and its language code (for outside the 24-hour window). */
  template: string
  language: string
  /** What fills each blank (field keys); without it the values go in their usual order. */
  fields?: string[]
}

export interface ShopMessageSetting extends ShopTemplateRef {
  on: boolean
  /** The earlier approved template, used while a newer wording waits for Meta's approval. */
  previous?: ShopTemplateRef
}

const cleanName = (value: unknown) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 512)
const cleanLanguage = (value: unknown) => String(value || 'en').trim().replace(/[^A-Za-z_]/g, '').slice(0, 10) || 'en'
/** Field keys this message can fill; anything else makes the list unusable (then the usual order is used). */
function cleanFields(purpose: ShopPurpose, raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const keys = SHOP_FIELDS[purpose].map((f) => f.key)
  const fields = raw.map(String)
  return fields.length <= 20 && fields.every((f) => keys.includes(f)) ? fields : undefined
}

export function readShopMessages(raw: any): Record<ShopPurpose, ShopMessageSetting> {
  const out = {} as Record<ShopPurpose, ShopMessageSetting>
  for (const p of SHOP_PURPOSES) {
    const r = raw?.[p] || {}
    const setting: ShopMessageSetting = {
      on: SHOP_MESSAGE_INFO[p].switchable === false || r.on === undefined ? SHOP_MESSAGE_INFO[p].defaultOn : r.on === true,
      template: cleanName(r.template),
      language: cleanLanguage(r.language),
    }
    const fields = setting.template ? cleanFields(p, r.fields) : undefined
    if (fields) setting.fields = fields
    const previous = setting.template && r.previous && typeof r.previous === 'object' ? r.previous : null
    if (previous && cleanName(previous.template) && cleanName(previous.template) !== setting.template) {
      const prevFields = cleanFields(p, previous.fields)
      setting.previous = { template: cleanName(previous.template), language: cleanLanguage(previous.language), ...(prevFields ? { fields: prevFields } : {}) }
    }
    out[p] = setting
  }
  return out
}

/** The field keys of a message, in the order the senders pass its values. */
export function shopFieldKeys(purpose: ShopPurpose): string[] {
  return SHOP_FIELDS[purpose].map((f) => f.key)
}

/** The blanks' values for a template: by its field list when it has one, else in the usual order. */
export function shopTemplateValues(purpose: ShopPurpose, ref: ShopTemplateRef, values: string[]): string[] {
  if (!ref.fields) return values
  const keys = shopFieldKeys(purpose)
  return ref.fields.map((key) => values[keys.indexOf(key)] ?? '-')
}

/** A WhatsApp template message with its blanks filled, and quick-reply buttons carrying our ids. */
export function templatePayload(phone: string, setting: ShopTemplateRef, values: string[], buttonIds: string[] = []) {
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
