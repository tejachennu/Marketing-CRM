/**
 * The AI shopping assistant: answers product and order questions in the WhatsApp chat.
 *
 * It runs before the FAQ chatbot. With OpenAI tool calls it searches the store's own products and
 * reads the customer's own orders, then replies with text and real product cards the customer can
 * add to a cart. It never invents a product or price: only products its searches returned can be
 * sent. Anything that is not about shopping, or a request for a person, is handed back to the FAQ
 * chatbot (which handles escalation to the team).
 */

import { formatSentProduct } from '@/lib/chat-commerce'
import { buildMultiProductMessage, buildSingleProductMessage, buildTextMessage } from './commerce-messages'
import { sendWhatsAppMessage } from './commerce-webhook-handler'
import { ORDER_STATUS_LABELS, formatMoney, getFulfillment, type OrderStatus } from './commerce-utils'

const MODEL = 'gpt-4o-mini'
const MAX_TOOL_ROUNDS = 4
const MAX_PRODUCTS_SENT = 10

export interface AssistantProduct {
  retailer_id: string
  title: string
  price: number
  currency: string
  description?: string | null
  category?: string | null
}

export interface ShoppingAssistantInput {
  supabase: any
  organization: any
  contact: { id: string; first_name?: string | null }
  conversationId: string
  customerPhone: string
  openAiKey: string
  /** The customer's latest message. */
  message: string
  /** Recent chat, oldest first, as the assistant should read it. */
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  /** Test seam for OpenAI. WhatsApp sends go through sendWhatsAppMessage. */
  fetcher?: typeof fetch
}

export type ShoppingAssistantResult =
  | { handled: true; productsSent: number }
  | { handled: false; reason: string }

/** Whether the assistant may answer for this store: AI on, store on, a catalog to sell from. */
export function shoppingAssistantEnabled(organization: any): boolean {
  return Boolean(
    organization &&
      organization.enable_ai !== false &&
      organization.enable_commerce !== false &&
      // A store that never had the column added is treated as on
      organization.commerce_ai_assistant !== false &&
      String(organization.meta_catalog_id || '').trim() &&
      organization.whatsapp_api_token &&
      organization.whatsapp_phone_number_id
  )
}

// ── Tools ───────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_products',
      description: 'Search the store catalog. Use English keywords from the product names (titles, authors, brands, categories), even if the customer wrote in another language.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keywords, e.g. "premchand novel". Empty to list popular products.' },
          max_price: { type: 'number', description: 'Upper price limit, if the customer gave a budget.' },
          min_price: { type: 'number' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_orders',
      description: "The customer's own recent orders with status, items, total and tracking. Use for order status, delivery or tracking questions.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reply_to_customer',
      description: 'Send the final answer. Optionally attach products from your searches as WhatsApp product cards the customer can add to the cart.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Short, friendly reply in the customer\'s language. At most 3 sentences.' },
          product_ids: { type: 'array', items: { type: 'string' }, description: 'retailer_id values from search_products results to show as product cards (best first, at most 10).' },
        },
        required: ['message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'not_a_shopping_question',
      description: 'Hand the message to the general assistant: anything not about finding products or about the customer\'s orders (store policies, returns, shipping times, greetings, complaints), or when the customer wants a human.',
      parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
    },
  },
]

function systemPrompt(organization: any, customerName: string): string {
  const store = String(organization.name || 'our store')
  const currency = String(organization.currency || 'INR').toUpperCase()
  return `You are the WhatsApp shopping assistant of ${store}. Prices are in ${currency}.
${customerName ? `The customer's name is ${customerName}.` : ''}

Your job: help the customer find products from the catalog and answer questions about their own orders.

Rules:
- Only talk about products that search_products returned. Never invent products, prices, stock, discounts or delivery dates.
- When products match, call reply_to_customer with a short message and their product_ids, so the customer gets product cards. Tell them to tap a product, add it to the cart and send the cart to order.
- If nothing matches, say so briefly and suggest something close from the results, or ask one clarifying question.
- For order status, call get_my_orders and answer from it (status, items, tracking). If they have no orders, say so.
- Anything else (policies, returns, shipping times, payment methods, greetings, complaints) or a request for a person: call not_a_shopping_question.
- Reply in the customer's language. Keep it short: at most 3 sentences, no markdown.
- Always finish by calling reply_to_customer or not_a_shopping_question.`
}

// ── Tool implementations ────────────────────────────────────────────────────

/** Words worth searching for: three letters or more, without characters PostgREST filters treat specially. */
export function searchTerms(query: string): string[] {
  return [...new Set(
    String(query || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= 3)
  )].slice(0, 6)
}

/** How well a product matches the search words: title hits count most. */
export function scoreProduct(product: AssistantProduct, terms: string[]): number {
  const title = product.title.toLowerCase()
  const rest = `${product.description || ''} ${product.category || ''}`.toLowerCase()
  return terms.reduce((score, term) => score + (title.includes(term) ? 3 : 0) + (rest.includes(term) ? 1 : 0), 0)
}

async function searchProducts(supabase: any, organizationId: string, args: any): Promise<AssistantProduct[]> {
  const terms = searchTerms(args?.query)
  let query = supabase
    .from('commerce_products')
    .select('retailer_id, title, price, currency, description, category, is_available')
    .eq('organization_id', organizationId)
    .or('is_available.is.null,is_available.eq.true')
  const max = Number(args?.max_price)
  const min = Number(args?.min_price)
  if (Number.isFinite(max) && max > 0) query = query.lte('price', max)
  if (Number.isFinite(min) && min > 0) query = query.gte('price', min)
  if (terms.length > 0) {
    query = query.or(terms.flatMap((term) => [`title.ilike.%${term}%`, `description.ilike.%${term}%`, `category.ilike.%${term}%`]).join(','))
  }
  const { data } = await query.limit(40)
  const products: AssistantProduct[] = (data || []).map((row: any) => ({
    retailer_id: String(row.retailer_id),
    title: String(row.title || ''),
    price: Number(row.price) || 0,
    currency: String(row.currency || 'INR'),
    description: row.description ? String(row.description).slice(0, 160) : null,
    category: row.category || null,
  }))
  return products
    .map((product) => ({ product, score: scoreProduct(product, terms) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ product }) => product)
}

async function getMyOrders(supabase: any, organizationId: string, contactId: string) {
  const { data } = await supabase
    .from('commerce_orders')
    .select('order_number, status, payment_status, payment_method, total_amount, currency, shipping_address, created_at, items:commerce_order_items(title, quantity)')
    .eq('organization_id', organizationId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(3)
  return (data || []).map((order: any) => {
    const fulfillment = getFulfillment(order)
    return {
      order_number: order.order_number,
      placed: String(order.created_at || '').slice(0, 10),
      status: ORDER_STATUS_LABELS[order.status as OrderStatus] || order.status,
      payment: order.payment_method === 'cod' ? 'Cash on Delivery' : order.payment_status,
      total: formatMoney(order.total_amount, order.currency),
      items: (order.items || []).map((item: any) => `${item.quantity} × ${item.title}`),
      carrier: fulfillment.carrier || null,
      tracking_number: fulfillment.trackingNumber || null,
    }
  })
}

// ── Sending ─────────────────────────────────────────────────────────────────

async function logMessage(input: ShoppingAssistantInput, body: string, messageId: string | null) {
  await input.supabase.from('messages').insert({
    organization_id: input.organization.id,
    conversation_id: input.conversationId,
    sender_type: 'user',
    body,
    twilio_message_sid: messageId ? `FB_${messageId}` : null,
    status: 'sent',
  })
}

/** Send the reply, with product cards when there are products; falls back to a text list. */
async function sendReply(input: ShoppingAssistantInput, message: string, products: AssistantProduct[]): Promise<number> {
  const { organization, customerPhone } = input
  const catalogId = String(organization.meta_catalog_id || '').trim()
  const text = message.trim()

  if (products.length > 0) {
    const payload = products.length === 1
      ? buildSingleProductMessage({ phone: customerPhone, catalogId, productRetailerId: products[0].retailer_id, bodyText: text })
      : buildMultiProductMessage({
          phone: customerPhone,
          catalogId,
          headerText: 'Picked for you',
          bodyText: text,
          sections: [{ title: 'Products', productRetailerIds: products.map((product) => product.retailer_id) }],
        })
    const sent = await sendWhatsAppMessage(organization, payload)
    if (sent.ok) {
      await logMessage(input, text, sent.messageId || null)
      await logMessage(input, products.length === 1 ? formatSentProduct(products[0].title, products[0].retailer_id) : `[Sent ${products.length} products from the catalog]`, null)
      return products.length
    }
    // A product Meta does not have yet (not synced): still answer, with names and prices
    console.warn('[Shopping Assistant] Product cards were refused, sending a text list:', sent.error)
    const list = products.map((product) => `• ${product.title} — ${formatMoney(product.price, product.currency)}`).join('\n')
    const fallback = `${text}\n\n${list}`
    const textSent = await sendWhatsAppMessage(organization, buildTextMessage(customerPhone, fallback))
    if (!textSent.ok) throw new Error(textSent.error || 'WhatsApp did not accept the reply')
    await logMessage(input, fallback, textSent.messageId || null)
    return 0
  }

  const sent = await sendWhatsAppMessage(organization, buildTextMessage(customerPhone, text))
  if (!sent.ok) throw new Error(sent.error || 'WhatsApp did not accept the reply')
  await logMessage(input, text, sent.messageId || null)
  return 0
}

// ── The loop ────────────────────────────────────────────────────────────────

export async function runShoppingAssistant(input: ShoppingAssistantInput): Promise<ShoppingAssistantResult> {
  const { supabase, organization, contact, openAiKey } = input
  if (!shoppingAssistantEnabled(organization)) return { handled: false, reason: 'disabled' }
  const fetcher = input.fetcher || fetch

  const messages: any[] = [
    { role: 'system', content: systemPrompt(organization, String(contact.first_name || '').trim()) },
    ...input.history.slice(-8),
    { role: 'user', content: input.message },
  ]
  // Products the searches returned: the only ones that can be sent
  const seen = new Map<string, AssistantProduct>()

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetcher('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAiKey}` },
      body: JSON.stringify({ model: MODEL, messages, tools: TOOLS, tool_choice: 'required', temperature: 0.2, max_tokens: 400 }),
    })
    if (!res.ok) return { handled: false, reason: `openai_${res.status}` }
    const data = await res.json()
    const reply = data.choices?.[0]?.message
    const calls: any[] = reply?.tool_calls || []
    if (calls.length === 0) return { handled: false, reason: 'no_tool_call' }
    messages.push(reply)

    for (const call of calls) {
      let args: any = {}
      try {
        args = JSON.parse(call.function?.arguments || '{}')
      } catch {
        args = {}
      }
      const name = call.function?.name

      if (name === 'not_a_shopping_question') return { handled: false, reason: String(args.reason || 'not_shopping') }

      if (name === 'reply_to_customer') {
        const message = String(args.message || '').trim()
        if (!message) return { handled: false, reason: 'empty_reply' }
        const ids: string[] = Array.isArray(args.product_ids) ? args.product_ids.map(String) : []
        const products = [...new Set(ids)].map((id) => seen.get(id)).filter((product): product is AssistantProduct => Boolean(product)).slice(0, MAX_PRODUCTS_SENT)
        const productsSent = await sendReply(input, message, products)
        return { handled: true, productsSent }
      }

      let result: unknown
      if (name === 'search_products') {
        const found = await searchProducts(supabase, organization.id, args)
        found.forEach((product) => seen.set(product.retailer_id, product))
        result = found.length ? found : { note: 'No products matched. Try other keywords or an empty query to see what the store sells.' }
      } else if (name === 'get_my_orders') {
        const orders = await getMyOrders(supabase, organization.id, contact.id)
        result = orders.length ? orders : { note: 'This customer has no orders yet.' }
      } else {
        result = { error: `Unknown tool ${name}` }
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
    }
  }
  return { handled: false, reason: 'too_many_rounds' }
}
