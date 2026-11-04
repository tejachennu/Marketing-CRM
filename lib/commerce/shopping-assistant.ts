/**
 * The AI shopping assistant: answers product and order questions in the WhatsApp chat.
 *
 * It runs before the FAQ chatbot. With OpenAI tool calls it searches the store's own products and
 * reads the customer's own orders, then replies with text and real product cards the customer can
 * add to a cart. It never invents a product, price or offer: only products its searches returned
 * can be sent, and a reply that quotes an amount the tools did not return, or talks of discounts
 * and offers, is corrected once and otherwise not sent. Anything that is not about shopping, or a
 * request for a person, is handed back to the FAQ chatbot (which handles escalation to the team).
 */

import { formatSentProduct } from '@/lib/chat-commerce'
import { LANGUAGE_RULES, fuzzyWordMatch } from '@/lib/chat-language'
import { checkRateLimit } from '@/lib/rate-limiter'
import { buildMultiProductMessage, buildSingleProductMessage, buildTextMessage } from './commerce-messages'
import { sendWhatsAppMessage } from './commerce-webhook-handler'
import { ORDER_STATUS_LABELS, formatMoney, getFulfillment, type OrderStatus } from './commerce-utils'

const MODEL = 'gpt-4o-mini'
const MAX_TOOL_ROUNDS = 4
const MAX_PRODUCTS_SENT = 10
/** How many products the spelling-tolerant pass reads when the exact search finds nothing. */
const FUZZY_POOL = 300
/** How much of the chat the model reads: the last turns, and no more text than this in all. */
const MAX_HISTORY_TURNS = 8
const MAX_HISTORY_CHARS = 4_000
/** One OpenAI call may take this long; a slower one hands the message to the FAQ chatbot. */
const OPENAI_TIMEOUT_MS = 20_000
/**
 * Runs per hour, each up to MAX_TOOL_ROUNDS OpenAI calls. The limiter counts in memory, per server
 * instance: with several instances each one counts on its own, so the real ceiling is these times
 * the number of instances.
 */
const CONTACT_RUNS_PER_HOUR = 30
const ORG_RUNS_PER_HOUR = 600
const HOUR_MS = 60 * 60 * 1000

export interface AssistantProduct {
  retailer_id: string
  title: string
  price: number
  currency: string
  description?: string | null
  category?: string | null
  /** The full price while the product is on sale in the catalog; `price` is then the sale price. */
  list_price?: number
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
      description: 'Search the store catalog. Pass the names and words as they would appear on the product (titles, authors, brands, categories), in English letters, even if the customer wrote in Telugu, Hindi or mixed language. Spelling may be approximate: the search tolerates it.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keywords, e.g. "radhakrishnan" for "me degara radhakrishnan books vunaya". Empty to list what the store sells.' },
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
          message: { type: 'string', description: 'Short, friendly reply in the same language and style as the customer (Tenglish → Tenglish in English letters, Telugu script → Telugu script, English → English). At most 3 sentences.' },
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
- Quote prices, totals and order details exactly as the tools returned them. Never mention a discount, coupon, promo code, offer, cashback, percentage or anything free: the tools never return such things, and a reply that mentions them is not sent. Questions about offers, discounts or shipping charges go to not_a_shopping_question.
- When products match, call reply_to_customer with a short message and their product_ids, so the customer gets product cards. Tell them to tap a product, add it to the cart and send the cart to order.
- If nothing matches, say so briefly and suggest something close from the results, or ask one clarifying question.
- For order status, call get_my_orders and answer from it (status, items, tracking). If they have no orders, say so.
- Anything else (policies, returns, shipping times, payment methods, greetings, complaints) or a request for a person: call not_a_shopping_question.
- Always finish by calling reply_to_customer or not_a_shopping_question.

${LANGUAGE_RULES}`
}

/** What the model is told when its reply quoted something the tools did not return. */
const CORRECTION = 'Do not mention prices, discounts, coupons, codes or offers that the tools did not return. Restate your reply using only tool results.'

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

/** How well a product matches the search words, spelling-tolerant: title matches count most. */
export function scoreProduct(product: AssistantProduct, terms: string[]): number {
  const rest = `${product.description || ''} ${product.category || ''}`
  return terms.reduce((score, term) => score + 3 * fuzzyWordMatch(term, product.title) + fuzzyWordMatch(term, rest), 0)
}

/** Rank products by the search words, best first; with words, only products that match at all. */
export function rankProducts(products: AssistantProduct[], terms: string[], minimum = 0): AssistantProduct[] {
  if (terms.length === 0) return products.slice(0, 10)
  const scored = products
    .map((product) => ({ product, score: scoreProduct(product, terms) }))
    .filter(({ score }) => score > minimum)
    .sort((a, b) => b.score - a.score)
  // A broad word ("books") matches everything; keep only what is close to the best match
  const best = scored[0]?.score || 0
  return scored.filter(({ score }) => score >= best / 2).slice(0, 10).map(({ product }) => product)
}

function toProduct(row: any): AssistantProduct {
  // While a product is on sale, the catalog sync keeps its full price in the row's metadata
  const listPrice = Number(row.metadata?.attributes?.list_price)
  return {
    retailer_id: String(row.retailer_id),
    title: String(row.title || ''),
    price: Number(row.price) || 0,
    currency: String(row.currency || 'INR'),
    description: row.description ? String(row.description).slice(0, 160) : null,
    category: row.category || null,
    ...(listPrice > 0 ? { list_price: listPrice } : {}),
  }
}

async function searchProducts(supabase: any, organizationId: string, args: any): Promise<AssistantProduct[]> {
  const terms = searchTerms(args?.query)
  const base = () => {
    let query = supabase
      .from('commerce_products')
      .select('retailer_id, title, price, currency, description, category, is_available, metadata')
      .eq('organization_id', organizationId)
      .or('is_available.is.null,is_available.eq.true')
    const max = Number(args?.max_price)
    const min = Number(args?.min_price)
    if (Number.isFinite(max) && max > 0) query = query.lte('price', max)
    if (Number.isFinite(min) && min > 0) query = query.gte('price', min)
    return query
  }

  // 1. The words as typed
  let exact = base()
  if (terms.length > 0) {
    exact = exact.or(terms.flatMap((term) => [`title.ilike.%${term}%`, `description.ilike.%${term}%`, `category.ilike.%${term}%`]).join(','))
  }
  const { data } = await exact.limit(40)
  const found = rankProducts((data || []).map(toProduct), terms)
  if (found.length > 0 || terms.length === 0) return found

  // 2. Nothing as typed: compare by sound and near spelling ("radakrishnan", "gitanjli", "premchnd")
  const { data: pool } = await base().limit(FUZZY_POOL)
  return rankProducts((pool || []).map(toProduct), terms, 2)
}

/** The customer's orders as the model reads them, with the amounts and item names a reply may quote. */
async function getMyOrders(supabase: any, organizationId: string, contactId: string): Promise<{ orders: any[]; amounts: number[]; titles: string[] }> {
  const { data } = await supabase
    .from('commerce_orders')
    .select('order_number, status, payment_status, payment_method, subtotal, shipping_fee, tax_amount, total_amount, currency, shipping_address, created_at, items:commerce_order_items(title, quantity, unit_price)')
    .eq('organization_id', organizationId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(3)
  const amounts: number[] = []
  const titles: string[] = []
  const orders = (data || []).map((order: any) => {
    const fulfillment = getFulfillment(order)
    const shipping = Number(order.shipping_fee) || 0
    const tax = Number(order.tax_amount) || 0
    amounts.push(Number(order.total_amount) || 0, Number(order.subtotal) || 0, shipping, tax)
    return {
      order_number: order.order_number,
      placed: String(order.created_at || '').slice(0, 10),
      status: ORDER_STATUS_LABELS[order.status as OrderStatus] || order.status,
      payment: order.payment_method === 'cod' ? 'Cash on Delivery' : order.payment_status,
      total: formatMoney(order.total_amount, order.currency),
      ...(shipping > 0 ? { shipping: formatMoney(shipping, order.currency) } : {}),
      ...(tax > 0 ? { tax: formatMoney(tax, order.currency) } : {}),
      items: (order.items || []).map((item: any) => {
        const quantity = Number(item.quantity) || 1
        const unit = Number(item.unit_price)
        titles.push(String(item.title || ''))
        if (!(unit > 0)) return `${quantity} × ${item.title}`
        amounts.push(unit, unit * quantity)
        return `${quantity} × ${item.title} @ ${formatMoney(unit, order.currency)}`
      }),
      carrier: fulfillment.carrier || null,
      tracking_number: fulfillment.trackingNumber || null,
    }
  })
  return { orders, amounts, titles }
}

// ── Checking the reply ──────────────────────────────────────────────────────
// The model is told to quote only what the tools returned; this is the check behind that rule.

/** Amounts: "₹249", "Rs. 1,121/-", "INR 500", "$12.50", "249 rupees", "499/-", "199.00". */
const AMOUNT = /(?:₹|\$|\b(?:rs\.?|inr)\s*)\s*(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s*(?:\/-|₹|rup(?:ees?|iya|iye|aya|aye|ay|ayalu)\b|rs\b|inr\b)|\b(\d[\d,]*\.\d{1,2})\b(?![.\d])/gi
const PERCENT = /\d\s*%|\bpercent(?:age)?\b/i
/** Everyday phrases that happen to contain an offer word; taken out before the check. */
const NOT_OFFERS = /\bfeel\s+free\b|\b(?:tracking|pin|postal|zip|area|country|otp|product)\s+codes?\b/gi
/**
 * Talk of deals: in English, in Hindi, Telugu and Tamil written in English letters ("chhoot",
 * "muft", "tagginpu", "offer hai"), and in Hindi and Telugu script.
 */
const OFFER_WORDS = /\b(?:discounts?|coupons?|promos?|promocodes?|offers?|cashback|freebies?|free|complimentary|codes?|chh?oot|muft|mufat|tagg?inpu|taggimpu|uchith?am|uchitanga|thallupadi|ilavasam)\b|छूट|ऑफ़?र|मुफ़?्त|कूपन|తగ్గింపు|ఆఫర్|ఉచితం|కూపన్/i

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Why a reply must not go out as it is, or null when it only restates tool results: it quotes an
 * amount the tools never returned (beyond ±1 for rounding), a percentage, or talks of offers.
 * Product and item names are quoted as they are, so numbers and words inside them do not count.
 */
export function unverifiedClaim(message: string, allowedAmounts: number[], quotedNames: string[] = []): string | null {
  let text = message.replace(NOT_OFFERS, ' ')
  for (const name of quotedNames) {
    if (name.trim()) text = text.replace(new RegExp(escapeRegExp(name.trim()), 'gi'), ' ')
  }
  if (PERCENT.test(text)) return 'percentage'
  const offer = text.match(OFFER_WORDS)
  if (offer) return `offer "${offer[0]}"`
  for (const match of text.matchAll(AMOUNT)) {
    const amount = Number((match[1] || match[2] || match[3] || '').replace(/,/g, ''))
    if (Number.isFinite(amount) && !allowedAmounts.some((allowed) => Math.abs(allowed - amount) <= 1)) return `amount ${amount}`
  }
  return null
}

// ── What the model reads ────────────────────────────────────────────────────

/**
 * The chat as the model reads it: the last turns within the character budget, without the chat's
 * bracketed log lines ("[Sent product: …]", "[Sent payment request …]"), which record what the
 * system did rather than what anyone said.
 */
export function modelHistory(history: ShoppingAssistantInput['history']): ShoppingAssistantInput['history'] {
  const turns = history
    .map((turn) => ({ role: turn.role, content: String(turn.content ?? '').trim() }))
    .filter((turn) => turn.content && !(turn.content.startsWith('[') && turn.content.endsWith(']')))
    .slice(-MAX_HISTORY_TURNS)
  // Newest first until the budget is spent; only the newest turn is clipped rather than dropped
  const kept: ShoppingAssistantInput['history'] = []
  let used = 0
  for (let i = turns.length - 1; i >= 0; i--) {
    const content = i === turns.length - 1 ? turns[i].content.slice(0, MAX_HISTORY_CHARS) : turns[i].content
    if (used + content.length > MAX_HISTORY_CHARS) break
    kept.unshift({ role: turns[i].role, content })
    used += content.length
  }
  return kept
}

/** Whether this customer and store are within their hourly run budgets; the run is counted. */
function withinRunBudget(organizationId: string, contactId: string): boolean {
  return (
    checkRateLimit(`assistant:contact:${organizationId}:${contactId}`, CONTACT_RUNS_PER_HOUR, HOUR_MS).allowed &&
    checkRateLimit(`assistant:org:${organizationId}`, ORG_RUNS_PER_HOUR, HOUR_MS).allowed
  )
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
  if (!withinRunBudget(String(organization.id), String(contact.id))) return { handled: false, reason: 'rate_limited' }
  const fetcher = input.fetcher || fetch

  const messages: any[] = [
    { role: 'system', content: systemPrompt(organization, String(contact.first_name || '').trim()) },
    ...modelHistory(input.history),
    { role: 'user', content: input.message },
  ]
  // Products the searches returned: the only ones that can be sent, and the only prices to quote
  const seen = new Map<string, AssistantProduct>()
  // Amounts and item names from the customer's orders, which a reply may quote too
  const orderAmounts: number[] = []
  const orderTitles: string[] = []
  // A reply that fails the check gets one more round to restate itself from tool results
  let rounds = MAX_TOOL_ROUNDS
  let corrected = false

  for (let round = 0; round < rounds; round++) {
    let res: Response
    try {
      res = await fetcher('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAiKey}` },
        body: JSON.stringify({ model: MODEL, messages, tools: TOOLS, tool_choice: 'required', temperature: 0.2, max_tokens: 400 }),
        signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
      })
    } catch (err: any) {
      // AbortSignal.timeout rejects with a TimeoutError (an AbortError on older runtimes)
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return { handled: false, reason: 'openai_timeout' }
      throw err
    }
    if (!res.ok) return { handled: false, reason: `openai_${res.status}` }
    const data = await res.json()
    const reply = data.choices?.[0]?.message
    const calls: any[] = reply?.tool_calls || []
    if (calls.length === 0) return { handled: false, reason: 'no_tool_call' }
    messages.push(reply)

    let restate = false
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
        const found = [...seen.values()]
        const claim = unverifiedClaim(
          message,
          [...orderAmounts, ...found.flatMap((product) => (product.list_price ? [product.price, product.list_price] : [product.price]))],
          [...orderTitles, ...found.map((product) => product.title)]
        )
        if (!claim) {
          const productsSent = await sendReply(input, message, products)
          return { handled: true, productsSent }
        }
        if (corrected) return { handled: false, reason: 'unverified_offer' }
        console.warn(`[Shopping Assistant] Reply held back (${claim}); asking the model to restate it from tool results`)
        corrected = true
        restate = true
        rounds += 1
        // Every tool call needs its result before the next request; the correction itself follows them
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: `Not sent (${claim}). ${CORRECTION}` }) })
        continue
      }

      let result: unknown
      if (name === 'search_products') {
        const found = await searchProducts(supabase, organization.id, args)
        found.forEach((product) => seen.set(product.retailer_id, product))
        result = found.length ? found : { note: 'No products matched. Try other keywords or an empty query to see what the store sells.' }
      } else if (name === 'get_my_orders') {
        const { orders, amounts, titles } = await getMyOrders(supabase, organization.id, contact.id)
        orderAmounts.push(...amounts)
        orderTitles.push(...titles)
        result = orders.length ? orders : { note: 'This customer has no orders yet.' }
      } else {
        result = { error: `Unknown tool ${name}` }
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
    }
    if (restate) messages.push({ role: 'system', content: CORRECTION })
  }
  return { handled: false, reason: 'too_many_rounds' }
}
