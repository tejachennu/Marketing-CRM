import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { getAiAccess } from '@/lib/ai-access'
import { answerFromKnowledge } from '@/lib/ai/faq-answer'
import { recordKnowledgeGap } from '@/lib/ai/knowledge-store'
import { asksAboutOrder, detailsGiven, orderReply, storeFacts } from '@/lib/ai/site-assistant'
import { checkRateLimit } from '@/lib/rate-limiter'
import { loadStore, type StorePage } from '@/lib/commerce/storefront'
import { STORE_PAGES, pageText } from '@/lib/commerce/store-pages'
import { gatewayMethods } from '@/lib/payments/gateway'
import { shopperFrom, shopperOrders, trackOrder } from '@/lib/commerce/store-accounts'
import { chatProductHits, cleanChatHistory, chatProductCards } from '@/lib/commerce/store-chat'

export const runtime = 'nodejs'
export const maxDuration = 60

/** The store's own settings as facts for the AI (delivery, paying, returns, offers, pages, contact). */
function factsFor(page: StorePage): string {
  const s = page.settings
  const pages: Record<string, string> = {}
  for (const key of STORE_PAGES) {
    const text = pageText(key, s.pages, { name: page.organization.name, about: s.about, phone: s.phone, whatsapp: s.whatsapp, address: s.address })
    if (text && key !== 'about' && key !== 'contact') pages[key] = text
  }
  return storeFacts({
    name: page.organization.name, currency: page.organization.currency, pickup: s.pickup, delivery: s.delivery, deliveryNote: s.delivery_note,
    fee: page.fees.fee, freeFrom: page.fees.freeFrom, minOrder: s.min_order, payOnline: page.pay.online, payLater: page.pay.later,
    payMethods: gatewayMethods(page.gateway || null), returns: page.returns, loyalty: page.loyalty, offers: page.offers, hasCodes: page.hasCodes,
    categories: page.categories.map((c) => c.name), productCount: page.products.length, phone: s.phone, whatsapp: s.whatsapp, address: s.address,
    about: s.about, pages, pinCheck: page.pinCheck,
  })
}

const reply = (body: Record<string, unknown>) => NextResponse.json({ products: [], buttons: [], attachments: [], handoff: false, ...body })

/**
 * POST { message, history: [{ role: 'user' | 'assistant', content }] }: the store's AI chat (Website settings →
 * AI chat on your website).
 *   - "Where is my order?": answered from the order itself, never by the AI (a signed-in shopper's own orders, or an
 *     order number with the phone it was placed with; else it asks for them, and the chat shows a small form).
 *   - Anything else: answered from the store's products, its settings (delivery, paying, returns, offers, pages) and
 *     the Knowledge Base, with product cards and quick follow-ups; amounts are checked against the data.
 * A shopper who wants a person is sent to the shop's WhatsApp. Limits: 20 messages per 10 minutes from one address,
 * 600 a day per store, 10 order look-ups an hour from one address.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params
  const body = await request.json().catch(() => ({}))
  const message = String(body?.message || '').replace(/\s+/g, ' ').trim().slice(0, 500)
  if (message.length < 1) return NextResponse.json({ error: 'Type your question.' }, { status: 400 })
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  if (!checkRateLimit(`store-chat:${ip}`, 20, 10 * 60_000).allowed) return NextResponse.json({ error: 'You have sent many messages. Please wait a few minutes, or message the shop on WhatsApp.' }, { status: 429 })

  const db = getSupabaseAdminClient()
  const page = await loadStore(db, slug)
  if (!page || !page.chat) return NextResponse.json({ error: 'Chat is not available in this store.' }, { status: 404 })
  if (!checkRateLimit(`store-chat-day:${page.organization.id}`, 600, 24 * 60 * 60_000).allowed) return NextResponse.json({ error: 'The chat is busy right now. Please message the shop on WhatsApp.' }, { status: 429 })
  const history = cleanChatHistory(body?.history)

  // ── "Where is my order?" — from the order itself ──
  const given = detailsGiven(message, history)
  const lastAskedOrder = history.at(-1)?.role === 'assistant' && /order number/i.test(history.at(-1)!.content)
  if (asksAboutOrder(message) || (lastAskedOrder && (given.orderNumber || given.phone))) {
    const shopper = page.settings.accounts ? await shopperFrom(request, db).catch(() => null) : null
    if (shopper && !given.orderNumber) {
      const mine = await shopperOrders(db, page.organization.id, shopper.id, 3).catch(() => [])
      if (mine.length) return reply({ reply: `${orderReply(mine[0])}${mine.length > 1 ? '\nYour other recent orders are below.' : ''}`, orders: mine })
    }
    if (given.orderNumber && given.phone) {
      if (!checkRateLimit(`store-chat-track:${ip}`, 10, 60 * 60_000).allowed) return reply({ reply: 'You have checked many orders. Please wait a little, or message the shop on WhatsApp.', handoff: true })
      const order = await trackOrder(db, page.organization.id, given.orderNumber, given.phone).catch(() => null)
      if (order) return reply({ reply: orderReply(order), orders: [order] })
      return reply({ reply: `I could not find order ${given.orderNumber} with that phone number. Please check both (the phone is the one you ordered with), or message the shop on WhatsApp.`, form: 'order', handoff: true })
    }
    return reply({
      reply: `Sure, I can check that. Please send your order number (like ORD-261118-ABCD, it is in your order message) and the phone number you ordered with.${page.settings.accounts ? ' Or sign in to see all your orders in My orders.' : ''}`,
      form: 'order',
    })
  }

  // ── Everything else: the AI, from the store's own data ──
  const { data: org } = await db.from('organizations').select('*').eq('id', page.organization.id).maybeSingle()
  if (!org || org.enable_ai === false) return NextResponse.json({ error: 'Chat is not available in this store.' }, { status: 404 })
  const ai = await getAiAccess(db, org.id, org)
  // AI cannot answer (for example the shop's AI credit ran out after the page opened): say so kindly and offer WhatsApp
  if (!ai.allowed) {
    console.warn(`[Store chat] ${slug}: ${ai.reason || 'AI not allowed'}`)
    return reply({ reply: 'Sorry, I cannot answer questions just now. Please message the shop on WhatsApp and they will help you.', handoff: true })
  }

  const answer = await answerFromKnowledge({
    db, ai, org: { ...org, name: page.organization.name }, message, history, channel: 'website', feature: 'website_chat',
    where: 'online store chat', facts: factsFor(page), strictAmounts: true,
    products: (search) => chatProductHits(page.products, search, page.organization.currency),
  })
  if (!answer) return NextResponse.json({ error: 'The chat could not answer just now. Please try again, or message the shop on WhatsApp.' }, { status: 502 })
  if (answer.handoff && answer.reason === 'not_answered') await recordKnowledgeGap(db, org.id, message, null)

  return reply({
    reply: answer.reply,
    // The products the answer talked about, as cards with Add to cart
    products: chatProductCards(page.products, answer.hits, answer),
    buttons: (answer.plan.buttons || []).map((b) => ({ title: b.title, question: b.id.replace(/^aq:/, '') })),
    attachments: answer.attachments,
    // "Talk to a person" on the website: the shop's WhatsApp
    handoff: answer.handoff,
  })
}
