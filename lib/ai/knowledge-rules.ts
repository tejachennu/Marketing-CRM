/**
 * The rules of the AI chatbot that answers from the knowledge base, kept pure (no imports) so they are
 * tested on their own and can run in the browser:
 *  - joining the two searches (by meaning and by words) into one ranked list (reciprocal rank fusion),
 *  - how sure the search is,
 *  - spotting a customer who asks for a person (English, Tenglish, Hinglish, Telugu, Hindi),
 *  - reading the model's answer safely (never sends half a JSON to a customer),
 *  - the hand-off settings and the words the customer gets,
 *  - the key that groups the same unanswered question.
 * It works like a business AI on WhatsApp: it answers what the business told it, says so when it does not
 * know instead of guessing, and hands the chat to the team (AI pauses in that chat) when needed.
 */

export interface KnowledgeHit {
  id?: string | null
  title: string
  content: string
  /** Fused score (higher = better), from reciprocal rank fusion */
  score: number
  /** Similarity by meaning, 0–1, when the meaning search found it */
  similarity: number | null
  /** Strength of the word match, 0–1, when the word search found it */
  wordScore: number | null
  /** faq = typed by the business; part = a piece of a PDF, website or document */
  kind?: 'faq' | 'part'
  /** For parts: the source's name and the page address */
  sourceTitle?: string | null
  url?: string | null
  /** Photos, videos, files and links the FAQ carries, sent with the answer */
  media?: { type: 'image' | 'video' | 'document' | 'link'; url: string; name?: string }[]
}

export interface SearchRow {
  id?: string | null
  title: string
  content: string
  similarity?: number | null
  score?: number | null
}

const keyOf = (row: SearchRow) => (row.id ? `id:${row.id}` : `t:${String(row.title || '').toLowerCase().trim()}`)

/** Rank both lists together: an entry found by both searches, or high in either, comes first. */
export function fuseResults(meaning: SearchRow[], words: SearchRow[], limit = 5, k = 60): KnowledgeHit[] {
  const byKey = new Map<string, KnowledgeHit>()
  const add = (rows: SearchRow[], kind: 'meaning' | 'words') => {
    rows.forEach((row, rank) => {
      if (!row || !row.title || !row.content) return
      const key = keyOf(row)
      const hit = byKey.get(key) || { id: row.id ?? null, title: row.title, content: row.content, score: 0, similarity: null, wordScore: null }
      hit.score += 1 / (k + rank + 1)
      if (kind === 'meaning') hit.similarity = Math.max(hit.similarity ?? 0, Number(row.similarity) || 0)
      else hit.wordScore = Math.max(hit.wordScore ?? 0, Math.min(1, Number(row.score) || 0))
      byKey.set(key, hit)
    })
  }
  add(meaning, 'meaning')
  add(words, 'words')
  return [...byKey.values()]
    .sort((a, b) => b.score - a.score || (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, Math.max(1, limit))
}

export type Confidence = 'high' | 'medium' | 'low' | 'none'

/** How sure the search is that the knowledge base holds the answer. */
export function confidenceOf(hits: KnowledgeHit[]): Confidence {
  if (!hits.length) return 'none'
  const best = hits[0]
  const sim = Math.max(...hits.map((h) => h.similarity ?? 0))
  const both = hits.some((h) => h.similarity !== null && h.wordScore !== null)
  if (sim >= 0.6 || (both && sim >= 0.45)) return 'high'
  if (sim >= 0.45 || (best.wordScore ?? 0) >= 0.3 || both) return 'medium'
  return 'low'
}

/** The knowledge-base entries as the model reads them. */
export function knowledgeText(hits: (Pick<KnowledgeHit, 'title' | 'content'> & Partial<KnowledgeHit>)[]): string {
  if (!hits.length) return '(nothing in the knowledge base matched this question)'
  return hits.map((h, i) => {
    if (h.kind === 'part') return `[${i + 1}] From the business's ${h.sourceTitle ? `"${h.sourceTitle}"` : 'document'} (${h.title}):\n${h.content}`
    const extras = (h.media || []).map((m) => m.type === 'link' ? `link "${m.name || m.url}"` : (m.name ? `${m.type} "${m.name}"` : m.type))
    return `[${i + 1}] Question: ${h.title}\nAnswer: ${h.content}${extras.length ? `\n(Sent with this answer: ${extras.join(', ')})` : ''}`
  }).join('\n\n---\n\n')
}

// ── A customer asking for a person ──────────────────────────────────────────

const PERSON_PATTERNS: RegExp[] = [
  // English
  /\b(talk|speak|chat|connect)\s+(to|with)\s+(a\s+|an\s+|the\s+|some\s+|your\s+)?(human|person|people|someone|somebody|agent|staff|team|executive|manager|owner|representative|support|customer\s*care)\b/i,
  /\b(real|live)\s+(person|human|agent)\b/i,
  /\b(human|live)\s+(agent|support|help)\b/i,
  /\b(customer\s*(care|support|service))\b/i,
  /\b(call\s+me(\s+back)?|give\s+me\s+a\s+call|please\s+call)\b/i,
  /\b(not\s+a\s+bot|are\s+you\s+a\s+bot|stop\s+(the\s+)?bot|no\s+bot)\b/i,
  /\b(raise|create|open)\s+(a\s+)?(ticket|complaint)\b/i,
  // Tenglish
  /\b(manishi|evaraina|evarina|staff|manager|owner)\s*(tho|to)\s*(matladali|matladalanu|matladali|maatladali|matladataanu|matladtha)\b/i,
  /\b(call\s+cheyandi|call\s+cheyyandi|phone\s+cheyandi)\b/i,
  // Hinglish
  /\b(kisi|insaan|aadmi|staff|manager)\s*(se)\s*(baat|bat)\b/i,
  /\b(call\s+karo|call\s+kijiye|call\s+karein|phone\s+karo)\b/i,
  // Telugu and Hindi scripts
  /(మనిషి|ఎవరైనా|స్టాఫ్|మేనేజర్).{0,12}(మాట్లాడ)/,
  /(కాల్\s*చేయండి)/,
  /(किसी|इंसान|स्टाफ|मैनेजर).{0,12}(बात)/,
  /(कॉल\s*कर)/,
]

/** Does the message ask for a person (not just mention a word like "agent")? */
export function wantsPerson(text: string): boolean {
  const t = String(text || '').trim()
  if (!t) return false
  return PERSON_PATTERNS.some((p) => p.test(t))
}

// ── The model's answer ──────────────────────────────────────────────────────

export type AnswerStatus = 'answered' | 'chat' | 'unknown' | 'person' | 'complaint'

export interface ParsedAnswer {
  reply: string
  status: AnswerStatus
  summary: string
  urgent: boolean
  /** The knowledge items the answer used ([1] = 1) */
  used?: number[]
}

const readUsed = (v: unknown): number[] => (Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 20).slice(0, 5)

const STATUSES: AnswerStatus[] = ['answered', 'chat', 'unknown', 'person', 'complaint']

/**
 * The model's JSON answer read safely. A cut-off or broken JSON never reaches the customer: the reply is
 * pulled out of it, or the answer counts as "unknown" with no reply.
 */
export function parseAnswer(raw: string): ParsedAnswer {
  const text = String(raw || '').trim()
  let data: any = null
  try {
    data = JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try { data = JSON.parse(text.slice(start, end + 1)) } catch {}
    }
  }
  if (!data || typeof data !== 'object') {
    // A cut-off JSON: take the reply's words if they are there
    const m = text.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/)
    if (m) {
      let reply = ''
      try { reply = JSON.parse(`"${m[1]}"`) } catch { reply = m[1] }
      const status = /"status"\s*:\s*"(\w+)"/.exec(text)?.[1] as AnswerStatus | undefined
      return { reply: tidyReply(reply), status: status && STATUSES.includes(status) ? status : 'answered', summary: '', urgent: false }
    }
    // Plain words (no JSON at all) are fine to send; anything that looks like code is not
    if (text && !/[{}[\]]/.test(text.slice(0, 2))) return { reply: tidyReply(text), status: 'answered', summary: '', urgent: false }
    return { reply: '', status: 'unknown', summary: '', urgent: false }
  }
  const reply = String(data.reply ?? data.message ?? data.answer ?? '')
  let status = STATUSES.find((s) => s === String(data.status || '').toLowerCase()) || null
  // Older answers: {reply, isRiseTicket}
  if (!status) status = data.isRiseTicket === true || data.handOff === true ? 'unknown' : 'answered'
  return { reply: tidyReply(reply), status, summary: String(data.summary || '').replace(/\s+/g, ' ').trim().slice(0, 200), urgent: data.urgent === true, used: readUsed(data.used) }
}

/** No markdown stars or headings on WhatsApp; at most 1,500 characters. */
export function tidyReply(text: string): string {
  return String(text || '')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/^#{1,6}\s+/gm, '')
    .trim()
    .slice(0, 1500)
}

// ── Hand-off to the team ────────────────────────────────────────────────────

export type HandoffReason = 'asked_person' | 'not_answered' | 'complaint' | 'flow' | 'ai_agent' | 'manual'

export const HANDOFF_REASON_LABELS: Record<HandoffReason, string> = {
  asked_person: 'Asked for a person',
  not_answered: 'AI could not answer',
  complaint: 'Complaint',
  flow: 'From a flow',
  ai_agent: 'AI agent',
  manual: 'Raised by the team',
}

export function readReason(value: unknown): HandoffReason | null {
  const v = String(value || '')
  return (Object.keys(HANDOFF_REASON_LABELS) as HandoffReason[]).find((r) => r === v) || null
}

export interface HandoffSettings {
  /** Stop the AI in a chat once it is handed to the team (like a business AI on WhatsApp) */
  pauseAi: boolean
  /** Turn the AI back on in that chat when its ticket is resolved */
  resumeOnResolve: boolean
  /** When the AI could not answer: keep it answering other questions in that chat (a ticket is still made) */
  keepAiWhenUnsure: boolean
  /** The business's own words for the hand-off message; empty = the AI writes it in the customer's language */
  message: string
}

export const DEFAULT_HANDOFF: HandoffSettings = { pauseAi: true, resumeOnResolve: true, keepAiWhenUnsure: false, message: '' }

export function readHandoffSettings(raw: unknown): HandoffSettings {
  const v: any = raw && typeof raw === 'object' ? raw : {}
  return {
    pauseAi: v.pauseAi !== false,
    resumeOnResolve: v.resumeOnResolve !== false,
    keepAiWhenUnsure: v.keepAiWhenUnsure === true,
    message: String(v.message || '').replace(/\s+/g, ' ').trim().slice(0, 300),
  }
}

export const DEFAULT_HANDOFF_TEXT = 'Thanks for your message. I have passed this to our team and someone will reply here soon.'

/** What should happen with this answer: send it, and/or hand the chat to the team (and why). */
export function decideHandoff(
  answer: ParsedAnswer,
  opts: { askedPerson: boolean },
): { handoff: boolean; reason: HandoffReason | null } {
  if (opts.askedPerson || answer.status === 'person') return { handoff: true, reason: 'asked_person' }
  if (answer.status === 'complaint') return { handoff: true, reason: 'complaint' }
  if (answer.status === 'unknown' || !answer.reply) return { handoff: true, reason: 'not_answered' }
  return { handoff: false, reason: null }
}

/** Does this hand-off stop the AI in the chat? */
export function pausesAi(reason: HandoffReason | null, settings: HandoffSettings): boolean {
  if (!settings.pauseAi) return false
  return !(reason === 'not_answered' && settings.keepAiWhenUnsure)
}

/** The words the customer gets on a hand-off: the business's own, else the AI's, else a plain default. */
export function handoffText(answer: ParsedAnswer, settings: HandoffSettings): string {
  if (settings.message) return settings.message
  return answer.reply || DEFAULT_HANDOFF_TEXT
}

/** Ticket subject: the customer's own words, one line, at most 100 characters. */
export function ticketSubject(message: string): string {
  const t = String(message || '').replace(/\s+/g, ' ').trim()
  if (!t) return 'Support request'
  return t.length > 100 ? `${t.slice(0, 97)}...` : t
}

// ── Questions the AI could not answer ───────────────────────────────────────

const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'do', 'does', 'you', 'your', 'i', 'me', 'my', 'we', 'can', 'what', 'how', 'please', 'pls', 'plz', 'to', 'of', 'for', 'in', 'on', 'and', 'or', 'it', 'this', 'that', 'there', 'any', 'have', 'has', 'hi', 'hello', 'sir', 'madam', 'andi', 'ji'])

/** The same question asked in slightly different words gets the same key, so it is counted once. */
export function gapKey(question: string): string {
  const words = String(question || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
  return [...new Set(words)].sort().join(' ').slice(0, 200)
}

/** Worth logging as a question the AI could not answer (not "ok", "hmm", a number, a greeting). */
export function isRealQuestion(text: string): boolean {
  const key = gapKey(text)
  return key.replace(/\s/g, '').length >= 4 && key.split(' ').length >= 1 && String(text).trim().length >= 6
}

// ── Words for the word search ───────────────────────────────────────────────

const SEARCH_STOP = new Set([...STOP, 'is', 'be', 'was', 'were', 'will', 'would', 'could', 'should', 'with', 'from', 'at', 'by', 'about', 'tell', 'know', 'want', 'need', 'like', 'get', 'give', 'kya', 'hai', 'ka', 'ki', 'ke', 'ko', 'se', 'aur', 'nahi', 'em', 'emi', 'ela', 'enti', 'undi', 'unda', 'cheppandi', 'kavali', 'or', 'not', 'no', 'yes', 'ok'])

/**
 * The words of a question for the word search, as "word or word or …" (any word may match): letters and
 * numbers in any script, without small common words, at most 12.
 */
export function searchWords(text: string): string {
  const words = String(text || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !SEARCH_STOP.has(w))
  return [...new Set(words)].slice(0, 12).join(' or ')
}

// ── What is sent with an answer ─────────────────────────────────────────────

export type Attachment = { type: 'image' | 'video' | 'document'; url: string; name?: string }

/**
 * The photos, videos and files of the FAQs the answer used (at most 3), and their links as text lines for the
 * reply. Nothing when the chat goes to the team or the answer used no FAQ.
 */
export function answerExtras(hits: Pick<KnowledgeHit, 'media'>[], used: number[] | undefined, handoff: boolean): { attachments: Attachment[]; links: string[] } {
  const attachments: Attachment[] = []
  const links: string[] = []
  if (handoff || !used?.length) return { attachments, links }
  for (const n of used) {
    for (const m of hits[n - 1]?.media || []) {
      if (m.type === 'link') {
        if (links.length < 3 && !links.some((l) => l.endsWith(m.url))) links.push(m.name ? `${m.name}: ${m.url}` : m.url)
      } else if (attachments.length < 3 && !attachments.some((a) => a.url === m.url)) {
        attachments.push({ type: m.type, url: m.url, ...(m.name ? { name: m.name } : {}) })
      }
    }
  }
  return { attachments, links }
}

/** The reply with the used FAQs' links added (each once, only when not already in the words). */
export function withLinks(reply: string, links: string[]): string {
  const extra = links.filter((l) => !reply.includes(l.split(': ').pop() || l))
  return extra.length ? `${reply}\n\n${extra.join('\n')}` : reply
}
