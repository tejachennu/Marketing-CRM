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

/** What commerce message a body is, or null for an ordinary message. */
export function parseCommerceMessage(body: string | null | undefined): CommerceMessage | null {
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
  return null
}

/** One line for the chat list and quoted replies. */
export function describeCommerceMessage(parsed: CommerceMessage): string {
  switch (parsed.kind) {
    case 'product': return `🛍️ ${parsed.title || (parsed.sku ? `SKU ${parsed.sku}` : 'Product')}`
    case 'products': return `🛍️ ${parsed.count} ${parsed.count === 1 ? 'product' : 'products'} from the catalog`
    case 'catalog': return '🛍️ Catalog'
    case 'website': return `🔗 ${parsed.title}`
    case 'order': return `🛒 Cart order · ${parsed.itemCount} ${parsed.itemCount === 1 ? 'item' : 'items'}`
  }
}

/** The WhatsApp message id behind a stored message ("FB_wamid…" → "wamid…"). */
export function whatsappMessageId(storedId: string | null | undefined): string | null {
  if (!storedId) return null
  return storedId.startsWith('FB_') ? storedId.slice(3) : storedId
}

/** The product titles and SKUs a list of messages refers to, to look them up in one request. */
export function collectProductRefs(messages: Array<{ body?: string | null }>): { titles: string[]; skus: string[] } {
  const titles = new Set<string>()
  const skus = new Set<string>()
  for (const message of messages) {
    const parsed = parseCommerceMessage(message.body)
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
