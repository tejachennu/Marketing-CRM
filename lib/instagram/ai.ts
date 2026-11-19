/**
 * AI replies to Instagram DMs with the same answer as the WhatsApp FAQ chatbot (lib/ai/faq-answer.ts):
 * knowledge base only, the customer's language. When it cannot answer, the customer asks for a person or
 * complains, the chat goes to the team (ticket, AI off for that chat, pop-up).
 * Server only.
 */

import { aiFetch, getAiAccess } from '../ai-access'
import { answerFromKnowledge, type AnswerResult } from '../ai/faq-answer'
import { searchKnowledge } from '../ai/knowledge-store'
import { LANGUAGE_RULES } from '../chat-language'

/** Up to three knowledge-base entries for a comment (the shared search: meaning and words together). */
async function knowledgeFor(db: any, ai: any, org: any, text: string) {
  const found = await searchKnowledge(db, ai, org.id, { question: text, synonyms: Array.isArray(org?.service_synonyms) ? org.service_synonyms : [], limit: 3 }).catch(() => null)
  return found?.hits || []
}

const kbText = (faqs: { title: string; content: string }[]) => faqs.map((f, i) => `[${i + 1}] ${f.title}\n${f.content}`).join('\n\n') || '(nothing matched)'

/** The AI's answer to a DM, the same answer as on WhatsApp (lib/ai/faq-answer.ts). null = nothing to send. */
export async function instagramAiReply(db: any, org: any, conversationId: string, text: string): Promise<(AnswerResult & { handOff: boolean }) | null> {
  if (org?.enable_ai === false || !text.trim()) return null
  const ai = await getAiAccess(db, org.id, org)
  if (!ai.allowed) return null
  const { data: recent } = await db.from('messages').select('sender_type, body').eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(11)
  // The newest row is the message being answered
  const history = (recent || []).slice(1).reverse().filter((m: any) => m.body).map((m: any) => ({ role: m.sender_type === 'contact' ? 'user' as const : 'assistant' as const, content: String(m.body) }))
  const answer = await answerFromKnowledge({ db, ai, org, message: text, history, channel: 'instagram' })
  if (!answer || !answer.reply) return answer && answer.handoff ? { ...answer, handOff: true } : null
  return { ...answer, reply: answer.reply.slice(0, 900), handOff: answer.handoff }
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
