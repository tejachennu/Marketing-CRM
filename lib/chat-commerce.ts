/**
 * Commerce messages in a chat: products the team sent and carts the customer submitted.
 * They are stored as one-line text bodies; these helpers recognise them so the inbox can show
 * a product or order card, matched to the product and order records. Pure, shared with tests.
 */

// A reply stores "[reply:<message id>]" before the text (see chat-message-format)
const REPLY_PREFIX = /^\[reply:[^\]]+\]/

export type CommerceMessage =
  | { kind: 'product'; title: string; sku: string | null }
  | { kind: 'products'; count: number }
  | { kind: 'catalog' }
  | { kind: 'website'; title: string }
  | { kind: 'order'; itemCount: number; note: string | null }
  | { kind: 'checkout'; event: CheckoutEvent; orderNumber: string; amount: string | null; detail: string | null }
  | { kind: 'form'; fields: Array<[string, string]>; isAddress: boolean }

/** A step of the WhatsApp checkout, as the webhook notes it in the chat. */
export type CheckoutEvent =
  | 'address_requested' | 'payment_choice' | 'payment_requested' | 'cod_requested' | 'acknowledged'
  | 'cod_confirmed' | 'paid' | 'payment_failed' | 'not_sent' | 'online_failed' | 'told'
  | 'payment_review' | 'second_payment' | 'earlier_request_paid' | 'status_changed' | 'payment_status_changed'
  | 'address_updated' | 'address_unreadable' | 'paid_after_cod'

// Which capture group holds what; the default is (order, amount, detail)
type LineGroups = { order: number; amount?: number; detail?: number }

// The lines commerce-webhook-handler writes; each names its order as "Order #<number>"
const CHECKOUT_LINES: Array<[CheckoutEvent, RegExp, LineGroups?]> = [
  ['address_requested', /^\[Sent delivery address form for Order #(\S+)\]$/],
  ['payment_choice', /^\[Asked how to pay for Order #(\S+) \(([^)]+)\): online or Cash on Delivery\]$/],
  ['payment_requested', /^\[Sent payment request for Order #(\S+) \(([^)]+)\)\]$/],
  ['cod_requested', /^\[Sent Cash on Delivery confirmation for Order #(\S+) \(([^)]+)\)\]$/],
  ['acknowledged', /^\[Sent order acknowledgement for Order #(\S+) \(([^)]+)\)\]$/],
  ['cod_confirmed', /^\[Order #(\S+) confirmed for Cash on Delivery \(([^)]+)\)\]$/],
  ['paid', /^\[Payment received for Order #(\S+) \(([^)]+)\); receipt sent\]$/],
  ['payment_failed', /^\[Payment failed for Order #(\S+); customer was told\]$/],
  ['not_sent', /^\[Checkout message for Order #(\S+) \(([^)]+)\) could not be sent\]$/],
  ['online_failed', /^\[Online payment for Order #(\S+) could not be started: ()([\s\S]+)\]$/],
  ['told', /^\[Told customer Order #(\S+) is ()([\s\S]+)\]$/],
  ['address_updated', /^\[Delivery address updated for Order #(\S+)\]$/],
  ['address_unreadable', /^\[Address form for Order #(\S+) could not be read; ()([\s\S]+)\]$/],
  ['paid_after_cod', /^\[Order #(\S+) was paid online after Cash on Delivery was chosen; do not collect cash\]$/],
  // Payment review lines put the amount before the order number
  ['payment_review', /^\[Payment of (.+?) received for Order #(\S+) but the order total is (.+?); team to review\]$/, { amount: 1, order: 2, detail: 3 }],
  ['second_payment', /^\[Second payment of (.+?) received for Order #(\S+); refund due\]$/, { amount: 1, order: 2 }],
  ['earlier_request_paid', /^\[Payment of (.+?) received for Order #(\S+) against an earlier request; the order total is now (.+?)\]$/, { amount: 1, order: 2, detail: 3 }],
  // Dashboard changes, as /api/commerce/orders notes them
  ['status_changed', /^\[Order #(\S+) marked (.+?)\]$/, { order: 1, detail: 2 }],
  ['payment_status_changed', /^\[Order #(\S+) payment marked (.+?)\]$/, { order: 1, detail: 2 }],
]

// A completed WhatsApp form (the delivery address form, or any other flow)
const FORM_SUBMISSION = /^\[Completed Native Form\]: (\{[\s\S]*\})$/
// Field order for an address, so the card reads like an address label
const ADDRESS_FIELDS = ['full_name', 'phone_number', 'address_line_1', 'address_line_2', 'city', 'state', 'pincode', 'delivery_speed', 'instructions']

const SKU_SEPARATOR = ' · SKU '

/** How a sent product is logged: "[Sent product: <title> · SKU <retailer id>]". */
export function formatSentProduct(title: string, sku: string): string {
  return `[Sent product: ${title || `SKU ${sku}`}${title && sku ? `${SKU_SEPARATOR}${sku}` : ''}]`
}

const SENT_PRODUCT = /^\[Sent product: ([\s\S]+)\]$/
const SENT_PRODUCTS = /^\[Sent (\d+) products? from the catalog\]$/
const SENT_CATALOG = /^\[Sent the full catalog\]$/
const SENT_WEBSITE = /^\[Sent website link: ([\s\S]+)\]$/
// The webhook's cart line; the total and note after the count are optional
const CART_ORDER = /^🛒 \[WhatsApp Cart Order\]: (\d+) item\(s\) selected(?: · [^(]+?)?(?: \(Note: "([\s\S]*)"\))?$/

// The customer's own messages (sender_type "contact") are the cart and a completed form; every
// other line is a note the server stores as sent by the team. A customer typing a checkout line
// must stay plain text, or the inbox would show a "Payment received" card nobody paid for.
const CUSTOMER_KINDS: ReadonlySet<CommerceMessage['kind']> = new Set(['order', 'form'])

/** Whether a sender can have produced a kind of commerce message; any sender can when it is unknown. */
export function canSenderProduce(senderType: string | null | undefined, kind: CommerceMessage['kind']): boolean {
  if (!senderType) return true
  return (senderType === 'contact') === CUSTOMER_KINDS.has(kind)
}

/**
 * What commerce message a body is, or null for an ordinary message. With `senderType` (the
 * message's sender_type) a line that sender cannot legitimately have written is ordinary text.
 */
export function parseCommerceMessage(body: string | null | undefined, senderType?: string | null): CommerceMessage | null {
  const parsed = parseCommerceLine(body)
  return parsed && canSenderProduce(senderType, parsed.kind) ? parsed : null
}

function parseCommerceLine(body: string | null | undefined): CommerceMessage | null {
  const text = (body ?? '').replace(REPLY_PREFIX, '').trim()
  if (!text) return null

  let match = text.match(SENT_PRODUCT)
  if (match) {
    const value = match[1]
    const at = value.lastIndexOf(SKU_SEPARATOR)
    if (at > 0) return { kind: 'product', title: value.slice(0, at).trim(), sku: value.slice(at + SKU_SEPARATOR.length).trim() || null }
    const skuOnly = value.match(/^SKU (.+)$/)
    if (skuOnly) return { kind: 'product', title: '', sku: skuOnly[1].trim() }
    return { kind: 'product', title: value.trim(), sku: null }
  }
  match = text.match(SENT_PRODUCTS)
  if (match) return { kind: 'products', count: parseInt(match[1], 10) }
  if (SENT_CATALOG.test(text)) return { kind: 'catalog' }
  match = text.match(SENT_WEBSITE)
  if (match) return { kind: 'website', title: match[1].trim() }
  match = text.match(CART_ORDER)
  if (match) return { kind: 'order', itemCount: parseInt(match[1], 10), note: match[2] ?? null }

  for (const [event, pattern, groups] of CHECKOUT_LINES) {
    match = text.match(pattern)
    if (!match) continue
    const at = groups || { order: 1, amount: 2, detail: 3 }
    const part = (index: number | undefined) => (index ? match![index] : undefined)
    return { kind: 'checkout', event, orderNumber: match[at.order], amount: part(at.amount) || null, detail: part(at.detail)?.trim() || null }
  }

  match = text.match(FORM_SUBMISSION)
  if (match) {
    let data: unknown
    try {
      data = JSON.parse(match[1])
    } catch {
      return null
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    const entries = Object.entries(data as Record<string, unknown>)
      .filter(([key, value]) => key !== 'flow_token' && value !== null && value !== undefined && String(value).trim() !== '')
      .map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value).trim()] as [string, string])
    const isAddress = entries.some(([key]) => key === 'address_line_1')
    if (isAddress) entries.sort(([a], [b]) => (ADDRESS_FIELDS.indexOf(a) + 1 || 99) - (ADDRESS_FIELDS.indexOf(b) + 1 || 99))
    return { kind: 'form', fields: entries, isAddress }
  }
  return null
}

/** "delivery_speed" → "Delivery speed", for form fields without a nicer label. */
export function formFieldLabel(key: string): string {
  const labels: Record<string, string> = { full_name: 'Name', phone_number: 'Phone', address_line_1: 'Address', address_line_2: 'Address line 2', pincode: 'PIN code' }
  if (labels[key]) return labels[key]
  const words = key.replace(/[_-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export const CHECKOUT_EVENT_LABELS: Record<CheckoutEvent, string> = {
  address_requested: 'Delivery address form sent',
  payment_choice: 'Asked to choose: pay online or Cash on Delivery',
  payment_requested: 'Payment request sent',
  cod_requested: 'Asked to confirm Cash on Delivery',
  acknowledged: 'Order acknowledged; team to follow up',
  cod_confirmed: 'Confirmed for Cash on Delivery',
  paid: 'Payment received · receipt sent',
  payment_failed: 'Payment failed · customer was told',
  not_sent: 'Checkout message could not be sent',
  online_failed: 'Online payment could not be started',
  told: 'Customer was told about the order',
  payment_review: 'Payment does not match the order total · team to review',
  second_payment: 'Second payment received · refund due',
  earlier_request_paid: 'An earlier payment request was paid · total updated',
  status_changed: 'Order status changed by the team',
  payment_status_changed: 'Payment status changed by the team',
  address_updated: 'Delivery address updated · confirmed to the customer',
  address_unreadable: 'Address form could not be read · payment step sent',
  paid_after_cod: 'Paid online after choosing Cash on Delivery · do not collect cash',
}

/** One line for the chat list and quoted replies. */
export function describeCommerceMessage(parsed: CommerceMessage): string {
  switch (parsed.kind) {
    case 'product': return `🛍️ ${parsed.title || (parsed.sku ? `SKU ${parsed.sku}` : 'Product')}`
    case 'products': return `🛍️ ${parsed.count} ${parsed.count === 1 ? 'product' : 'products'} from the catalog`
    case 'catalog': return '🛍️ Catalog'
    case 'website': return `🔗 ${parsed.title}`
    case 'order': return `🛒 Cart order · ${parsed.itemCount} ${parsed.itemCount === 1 ? 'item' : 'items'}`
    case 'checkout': return `${parsed.event === 'cod_confirmed' || parsed.event === 'paid' || parsed.event === 'earlier_request_paid' ? '✅' : ['not_sent', 'payment_failed', 'online_failed', 'payment_review', 'second_payment', 'address_unreadable', 'paid_after_cod'].includes(parsed.event) ? '⚠️' : '🧾'} ${CHECKOUT_EVENT_LABELS[parsed.event]}`
    case 'form': return parsed.isAddress ? '📍 Delivery address submitted' : '📝 Form submitted'
  }
}

/** The WhatsApp message id behind a stored message ("FB_wamid…" → "wamid…"). */
export function whatsappMessageId(storedId: string | null | undefined): string | null {
  if (!storedId) return null
  return storedId.startsWith('FB_') ? storedId.slice(3) : storedId
}

/** The product titles and SKUs a list of messages refers to, to look them up in one request. */
export function collectProductRefs(messages: Array<{ body?: string | null; sender_type?: string | null }>): { titles: string[]; skus: string[] } {
  const titles = new Set<string>()
  const skus = new Set<string>()
  for (const message of messages) {
    const parsed = parseCommerceMessage(message.body, message.sender_type)
    if (parsed?.kind !== 'product') continue
    if (parsed.sku) skus.add(parsed.sku)
    else if (parsed.title) titles.add(parsed.title)
  }
  return { titles: [...titles].slice(0, 50), skus: [...skus].slice(0, 50) }
}

/** Quantity and total of a WhatsApp cart, for the line the webhook stores. */
export function describeCart(items: Array<{ item_price?: unknown; quantity?: unknown; currency?: unknown }>): { quantity: number; total: number; currency: string } {
  let quantity = 0
  let total = 0
  let currency = ''
  for (const item of items) {
    const qty = Math.max(1, parseInt(String(item.quantity ?? 1), 10) || 1)
    const price = parseFloat(String(item.item_price ?? 0)) || 0
    quantity += qty
    total += price * qty
    if (!currency && item.currency) currency = String(item.currency).toUpperCase()
  }
  return { quantity, total: Math.round(total * 100) / 100, currency: currency || 'INR' }
}

export interface ChatProductCard {
  retailer_id: string
  title: string
  price: number
  currency: string
  image_url: string | null
}

export interface ChatOrderCard {
  id: string
  order_number: string
  status: string
  payment_status: string
  total_amount: number
  currency: string
  meta_order_id: string | null
  created_at: string
  items: Array<{ title: string; quantity: number; unit_price: number; image_url: string | null }>
}
