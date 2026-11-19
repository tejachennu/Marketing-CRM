import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { getAiAccess } from '@/lib/ai-access'
import { answerFromKnowledge } from '@/lib/ai/faq-answer'
import { recordKnowledgeGap } from '@/lib/ai/knowledge-store'
import { checkRateLimit } from '@/lib/rate-limiter'
import { loadStore } from '@/lib/commerce/storefront'
import { chatProductHits, cleanChatHistory, chatProductCards } from '@/lib/commerce/store-chat'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST { message, history: [{ role: 'user' | 'assistant', content }] }: the store's AI chat (Website settings →
 * AI chat on your website). Answers from the store's products and the business's Knowledge Base, with product
 * cards and quick follow-ups. A shopper who wants a person is sent to the shop's WhatsApp (no ticket: the
 * website has no chat with the team). Limits: 20 messages per 10 minutes from one address, 600 a day per store.
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

  const { data: org } = await db.from('organizations').select('*').eq('id', page.organization.id).maybeSingle()
  if (!org || org.enable_ai === false) return NextResponse.json({ error: 'Chat is not available in this store.' }, { status: 404 })
  const ai = await getAiAccess(db, org.id, org)
  if (!ai.allowed) return NextResponse.json({ error: 'The chat is resting right now. Please message the shop on WhatsApp.' }, { status: 503 })

  const answer = await answerFromKnowledge({
    db, ai, org: { ...org, name: page.organization.name }, message, history: cleanChatHistory(body?.history), channel: 'website', feature: 'website_chat',
    products: (search) => chatProductHits(page.products, search, page.organization.currency),
  })
  if (!answer) return NextResponse.json({ error: 'The chat could not answer just now. Please try again, or message the shop on WhatsApp.' }, { status: 502 })
  if (answer.handoff && answer.reason === 'not_answered') await recordKnowledgeGap(db, org.id, message, null)

  return NextResponse.json({
    reply: answer.reply,
    // The products the answer talked about, as cards with Add to cart
    products: chatProductCards(page.products, answer.hits, answer),
    buttons: (answer.plan.buttons || []).map((b) => ({ title: b.title, question: b.id.replace(/^aq:/, '') })),
    attachments: answer.attachments,
    // "Talk to a person" on the website: the shop's WhatsApp
    handoff: answer.handoff,
  })
}
