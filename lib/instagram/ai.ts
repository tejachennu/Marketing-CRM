/**
 * AI replies to Instagram DMs, from the workspace's knowledge base, in the customer's language: the same
 * idea as the WhatsApp FAQ chatbot (vector + keyword search, recent chat, JSON answer). When it cannot
 * answer, or the customer asks for a person, the chat goes to the team (AI off for that chat, pop-up).
 * Server only.
 */

import { aiFetch, getAiAccess } from '../ai-access'
import { fallbackKeywordSearch } from '../ai-shared'
import { LANGUAGE_RULES } from '../chat-language'

const BASE = `You answer Instagram direct messages for a business. Be short, warm and clear (Instagram is casual). Use only the business information given. Never invent prices, stock or policies.`

/** Up to three knowledge-base entries for this text (meaning first, then words). */
async function knowledgeFor(db: any, ai: any, org: any, text: string) {
  let faqs: { title: string; content: string }[] = []
  try {
    const embedRes = await aiFetch(db, ai, 'chatbot', 'https://api.openai.com/v1/embeddings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000) }) })
    const embedding = embedRes.ok ? (await embedRes.json())?.data?.[0]?.embedding : null
    if (embedding) {
      const { data } = await db.rpc('match_faqs', { query_embedding: `[${embedding.join(',')}]`, match_threshold: 0.45, match_count: 3, org_id: org.id })
      faqs = data || []
    }
  } catch {}
  if (faqs.length < 3) {
    const more = await fallbackKeywordSearch(db, text, org.id).catch(() => [])
    const seen = new Set(faqs.map((f) => f.title.toLowerCase()))
    for (const f of more) if (!seen.has(f.title.toLowerCase()) && faqs.length < 3) faqs.push(f)
  }
  return faqs
}

const kbText = (faqs: { title: string; content: string }[]) => faqs.map((f, i) => `[${i + 1}] ${f.title}\n${f.content}`).join('\n\n') || '(nothing matched)'

export async function instagramAiReply(db: any, org: any, conversationId: string, text: string): Promise<{ reply: string; handOff: boolean } | null> {
  if (org?.enable_ai === false || !text.trim()) return null
  const ai = await getAiAccess(db, org.id, org)
  if (!ai.allowed) return null
  const faqs = await knowledgeFor(db, ai, org, text)
  const { data: recent } = await db.from('messages').select('sender_type, body').eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(7)
  const history = (recent || []).slice(1).reverse().filter((m: any) => m.body).map((m: any) => ({ role: m.sender_type === 'contact' ? 'user' : 'assistant', content: String(m.body) }))
  const system = `${org.chatbot_base_prompt || BASE}

BUSINESS: ${org.name || 'the business'}
KNOWLEDGE BASE (your only source of truth):
${kbText(faqs)}

Answer in JSON: {"reply": your message (under 900 characters), "handOff": true when you cannot answer from the knowledge base, or the customer asks for a person, wants to complain, or wants to place a custom order; then "reply" says politely that the team will reply soon}.
${LANGUAGE_RULES}`
  try {
    const res = await aiFetch(db, ai, 'chatbot', 'https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', response_format: { type: 'json_object' }, temperature: 0.3, max_tokens: 350, messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: text }] }),
    })
    if (!res.ok) return null
    const parsed = JSON.parse((await res.json())?.choices?.[0]?.message?.content || '{}')
    const reply = String(parsed.reply || '').trim().slice(0, 900)
    return reply ? { reply, handOff: parsed.handOff === true } : null
  } catch {
    return null
  }
}

/**
 * A short public reply to a comment, only when the knowledge base answers it. Prices and private details
 * go to a DM instead ("Sent you a DM"); nothing is posted when the AI is unsure.
 */
export async function instagramCommentAi(db: any, org: any, comment: string, username: string): Promise<string | null> {
  if (org?.enable_ai === false || !comment.trim()) return null
  const ai = await getAiAccess(db, org.id, org)
  if (!ai.allowed) return null
  const faqs = await knowledgeFor(db, ai, org, comment)
  const system = `You reply in public to comments on a business's Instagram posts. One or two friendly sentences, under 250 characters, at most one emoji. Use only the business information given; never invent prices, stock or policies. Greetings and praise get a warm thank-you.

BUSINESS: ${org.name || 'the business'}
KNOWLEDGE BASE (your only source of truth):
${kbText(faqs)}

Answer in JSON: {"reply": the public reply, or "" when the comment is spam, rude, a complaint, or needs information that is not above}.
${LANGUAGE_RULES}`
  try {
    const res = await aiFetch(db, ai, 'chatbot', 'https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', response_format: { type: 'json_object' }, temperature: 0.4, max_tokens: 150, messages: [{ role: 'system', content: system }, { role: 'user', content: `Comment by @${username || 'someone'}: ${comment.slice(0, 1000)}` }] }),
    })
    if (!res.ok) return null
    const reply = String(JSON.parse((await res.json())?.choices?.[0]?.message?.content || '{}').reply || '').trim().slice(0, 300)
    return reply || null
  } catch {
    return null
  }
}
