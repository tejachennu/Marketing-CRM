/**
 * The AI chatbot's answer from the business's knowledge base, one function for every place that answers
 * (WhatsApp webhook, Instagram, the chatbot playground), so a test in the playground is what customers get.
 *
 * Like a business AI on WhatsApp:
 *  1. A customer who asks for a person is handed to the team at once.
 *  2. The question is turned into an English search text (it understands follow-ups and Telugu / Hindi /
 *     Tenglish / Hinglish), the knowledge base is searched by meaning and by words, ranked together.
 *  3. The AI answers only from the business's details and knowledge base. When the answer is not there it
 *     does not guess: it says the team will reply, and the chat is handed over (ticket, AI paused).
 * Server only. The caller sends the reply and runs the hand-off (handOffToTeam).
 */

import { aiFetch, type AiAccess } from '../ai-access'
import { LANGUAGE_RULES, SEARCH_QUERY_LANGUAGE_RULE } from '../chat-language'
import type { SynonymGroup } from '../query-expander'
import {
  answerExtras, decideHandoff, handoffText, knowledgeText, parseAnswer, readHandoffSettings, wantsPerson, withLinks,
  type AnswerStatus, type Attachment, type Confidence, type HandoffReason, type HandoffSettings, type KnowledgeHit,
} from './knowledge-rules'
import { searchKnowledge } from './knowledge-store'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AnswerInput {
  db: any
  ai: AiAccess
  org: any
  /** The customer's newest message */
  message: string
  /** The conversation before it (oldest first, without the newest message) */
  history: ChatTurn[]
  /** For the AI wallet: 'chatbot' (customers) or 'playground' */
  feature?: string
  channel?: 'whatsapp' | 'instagram' | 'playground'
  settings?: HandoffSettings
}

export interface AnswerResult {
  /** What to send the customer (empty = send nothing) */
  reply: string
  status: AnswerStatus
  handoff: boolean
  reason: HandoffReason | null
  /** One line for the team (the ticket) */
  summary: string
  urgent: boolean
  hits: KnowledgeHit[]
  confidence: Confidence
  searchQuery: string
  model: string
  /** Photos, videos and files of the FAQs the answer used: send them after the reply */
  attachments: Attachment[]
}

const MODEL = 'gpt-4o-mini'

/** The business's own details the AI may use as facts. */
export function businessFacts(org: any): string {
  const lines = [
    org?.name && `- Business name: ${org.name}`,
    org?.contact_phone && `- Phone: ${org.contact_phone}`,
    org?.contact_address && `- Address: ${org.contact_address}`,
    org?.website_url && `- Website: ${org.website_url}`,
  ].filter(Boolean)
  return lines.length ? lines.join('\n') : '(none given)'
}

/** The system prompt (exported for tests). */
export function answerPrompt(org: any, hits: (Pick<KnowledgeHit, 'title' | 'content'> & Partial<KnowledgeHit>)[], opts: { askedPerson?: boolean; channel?: string } = {}): string {
  const where = opts.channel === 'instagram' ? 'Instagram' : 'WhatsApp'
  const own = String(org?.chatbot_base_prompt || '').trim()
  return `You are the ${where} assistant of ${org?.name || 'this business'}. You answer customers for the business like a helpful, honest shop assistant.
${own ? `\nTHE BUSINESS'S OWN INSTRUCTIONS (follow them, but never invent facts):\n${own}\n` : ''}
BUSINESS DETAILS (true facts):
${businessFacts(org)}

KNOWLEDGE BASE (the business's own answers and documents; with the details above, your only source of truth):
${knowledgeText(hits)}

HOW TO ANSWER:
- Answer only with facts written above. Never guess or invent prices, timings, stock, offers, policies, links or phone numbers.
- If the answer is not written above, do not guess: status "unknown", and in "reply" say briefly that you will check with the team and they will reply here soon.
- Greetings, thanks, "ok", small talk: a short warm reply, status "chat".
- The customer asks for a person, a call back or a human: status "person"; reply briefly that someone from the team will reply here soon.
- The customer complains or is upset about a problem (late or wrong order, bad service, refund, payment taken): status "complaint"; say sorry briefly and that the team will look into it and reply here soon.
- Use the conversation to understand follow-ups like "how much is it?" or "and on Sunday?".
- When an item says a photo, video, file or link is sent with it and you use that item, you may say it is attached below (it is sent automatically).
- Keep it short (under 80 words), plain text, no markdown, no lists unless needed.
${opts.askedPerson ? '- This customer has asked for a person: status "person".\n' : ''}${LANGUAGE_RULES}

Answer in JSON only:
{"reply": "your message to the customer", "status": "answered" | "chat" | "unknown" | "person" | "complaint", "used": [the numbers of the knowledge items your reply used, e.g. [1, 3]; [] when none], "summary": "one short line for the team: what the customer wants", "urgent": true only when the customer is angry or money already paid is involved, else false}`
}

/** The customer's message as one English search text (follow-ups and other languages resolved). */
export async function searchTextFor(db: any, ai: AiAccess, feature: string, message: string, history: ChatTurn[]): Promise<string> {
  const recent = history.slice(-6).filter((m) => m.content?.trim())
  const prompt = `Rewrite the customer's latest message as one standalone search query for a business's FAQ.

Rules:
- Output ONLY the query, nothing else.
- Resolve "it", "that", "this", "there" from the conversation.
- Keep it under 25 words. Keep names, product and service names as they are.
${SEARCH_QUERY_LANGUAGE_RULE}
- A greeting or "thanks" stays as it is. Do not add facts.
${recent.length ? `\nConversation:\n${recent.map((m) => `${m.role === 'user' ? 'Customer' : 'Business'}: ${m.content.slice(0, 400)}`).join('\n')}\n` : ''}
Latest customer message: ${message.slice(0, 600)}

Search query:`
  try {
    const res = await aiFetch(db, ai, feature, 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 80 }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return message
    const text = String((await res.json())?.choices?.[0]?.message?.content || '').replace(/^["'\s]+|["'\s]+$/g, '').trim()
    return text && text.length <= 400 ? text : message
  } catch {
    return message
  }
}

/** The answer to the customer's newest message. null = the AI could not be reached (send nothing). */
export async function answerFromKnowledge(input: AnswerInput): Promise<AnswerResult | null> {
  const { db, ai, org } = input
  const feature = input.feature || 'chatbot'
  const message = String(input.message || '').trim()
  if (!message) return null
  const settings = input.settings || readHandoffSettings(org?.ai_handoff)
  const history = (input.history || []).filter((m) => m && m.content && m.content.trim()).slice(-10)
  const askedPerson = wantsPerson(message)

  let searchQuery = message
  let hits: KnowledgeHit[] = []
  let confidence: Confidence = 'none'
  if (!askedPerson) {
    searchQuery = await searchTextFor(db, ai, feature, message, history)
    const synonyms: SynonymGroup[] = Array.isArray(org?.service_synonyms) ? org.service_synonyms : []
    const found = await searchKnowledge(db, ai, org.id, { question: message, searchQuery, synonyms, feature, limit: 6 })
    hits = found.hits
    confidence = found.confidence
  }

  let raw = ''
  try {
    const res = await aiFetch(db, ai, feature, 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: answerPrompt(org, hits, { askedPerson, channel: input.channel }) },
          ...history.map((m) => ({ role: m.role, content: m.content.slice(0, 1500) })),
          { role: 'user', content: message },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 600,
      }),
      signal: AbortSignal.timeout(25000),
    })
    if (res.ok) raw = String((await res.json())?.choices?.[0]?.message?.content || '')
  } catch {}

  if (!raw) {
    // The AI could not be reached: a customer who asked for a person still gets the team
    if (!askedPerson) return null
    return { reply: handoffText({ reply: '', status: 'person', summary: '', urgent: false }, settings), status: 'person', handoff: true, reason: 'asked_person', summary: 'Asked to talk to a person', urgent: false, hits, confidence, searchQuery, model: MODEL, attachments: [] }
  }

  const answer = parseAnswer(raw)
  const decision = decideHandoff(answer, { askedPerson })
  const extras = answerExtras(hits, answer.used, decision.handoff)
  const reply = decision.handoff ? handoffText(answer, settings) : withLinks(answer.reply, extras.links)
  return {
    reply,
    attachments: extras.attachments,
    status: answer.status,
    handoff: decision.handoff,
    reason: decision.reason,
    summary: answer.summary || (decision.reason === 'asked_person' ? 'Asked to talk to a person' : ''),
    urgent: answer.urgent,
    hits,
    confidence,
    searchQuery,
    model: MODEL,
  }
}
