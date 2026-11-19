/**
 * How an AI answer is sent on each channel, like a business AI on WhatsApp and Instagram (pure, no imports):
 *  - WhatsApp: *bold* and • lists in WhatsApp's own style; quick buttons (up to 3) under the answer, or one link
 *    button ("Book online") instead of a long web address; plain text when neither fits (Meta's limits).
 *  - Instagram: no formatting marks (Instagram shows them as they are), at most 1,000 characters per message
 *    (longer answers go as two or three messages), quick replies (chips) under the last one, links as text.
 * A tapped quick button sends its full question back to us (id / payload "aq:<question>"), so a button title cut
 * to 20 characters never changes the question.
 * Every interactive message has a plain text twin, sent when Meta refuses the interactive one.
 */

export type Tone = 'friendly' | 'professional' | 'short'

export interface ReplyStyle {
  /** How the AI talks */
  tone: Tone
  /** A smiley now and then */
  emoji: boolean
  /** Quick buttons with follow-up questions and "Talk to a person" */
  buttons: boolean
  /** Show "typing…" while the AI writes */
  typing: boolean
}

export const DEFAULT_STYLE: ReplyStyle = { tone: 'friendly', emoji: true, buttons: true, typing: true }

export const TONE_LABELS: Record<Tone, string> = {
  friendly: 'Friendly and warm',
  professional: 'Polite and formal',
  short: 'Short and to the point',
}

export function readReplyStyle(raw: unknown): ReplyStyle {
  const v: any = raw && typeof raw === 'object' ? raw : {}
  return {
    tone: (['friendly', 'professional', 'short'] as const).find((t) => t === v.tone) || 'friendly',
    emoji: v.emoji !== false,
    buttons: v.buttons !== false,
    typing: v.typing !== false,
  }
}

/** The words for the AI about tone and each channel's look. */
export function styleRules(style: ReplyStyle, channel: string): string {
  const tone = style.tone === 'professional'
    ? 'Polite and formal, like a good front office. Full sentences.'
    : style.tone === 'short'
      ? 'Very short: the answer first, one or two sentences, no small talk.'
      : 'Friendly and warm, like a helpful shop assistant.'
  const look = channel === 'instagram'
    ? 'Instagram: casual and short. No formatting marks (no * or _). Use "•" for a short list.'
    : channel === 'website'
      ? 'Chat on the online store: short and clear, no formatting marks (no * or _), "•" for a short list. Products you mention are shown as cards under your reply, so do not paste links to them.'
    : 'WhatsApp: you may put a key fact in *bold* (one pair of stars) and use "•" for a short list.'
  return `- Tone: ${tone}\n- ${look}\n- ${style.emoji ? 'At most one emoji, only where it feels natural.' : 'No emoji.'}`
}

// ── Text in each channel's style ────────────────────────────────────────────

/** Markdown-ish text in WhatsApp's style: *bold*, _italic_, • lists, no headings or [link](url). */
export function forWhatsApp(text: string): string {
  return String(text || '')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '_$1_')
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1: $2')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The same text for Instagram: no * _ ~ marks (they would show as they are). */
export function forInstagram(text: string): string {
  return forWhatsApp(text)
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/(^|[\s(])~([^~\n]+)~(?=[\s).,!?:;]|$)/g, '$1$2')
}

const bytes = (s: string) => new TextEncoder().encode(s).length

/** Long text in parts of at most `max` bytes, on paragraphs, then sentences, then words. At most `most` parts. */
export function splitMessage(text: string, max = 1000, most = 3): string[] {
  const t = String(text || '').trim()
  if (!t) return []
  if (bytes(t) <= max) return [t]
  const out: string[] = []
  let current = ''
  const pieces = t.split(/(?<=\n\n)|(?<=[.!?।])\s+/)
  for (const raw of pieces) {
    let piece = raw
    while (bytes(piece) > max) {
      // One very long sentence: cut on a space
      let cut = piece.slice(0, Math.floor(max / 3))
      const space = cut.lastIndexOf(' ')
      if (space > 20) cut = cut.slice(0, space)
      if (current) { out.push(current.trim()); current = '' }
      out.push(cut.trim())
      piece = piece.slice(cut.length)
    }
    const next = current ? `${current}${current.endsWith('\n\n') ? '' : ' '}${piece}` : piece
    if (bytes(next) > max) { out.push(current.trim()); current = piece } else current = next
  }
  if (current.trim()) out.push(current.trim())
  if (out.length <= most) return out
  // Too many parts: the last one carries the rest, cut to fit
  const kept = out.slice(0, most - 1)
  let rest = out.slice(most - 1).join(' ')
  while (bytes(rest) > max) rest = rest.slice(0, -20)
  return [...kept, `${rest.replace(/\s+\S*$/, '')}…`]
}

// ── Quick buttons ───────────────────────────────────────────────────────────

export const PERSON_BUTTON = 'Talk to a person'
export const ASK_PREFIX = 'aq:'

/** A button title: at most 20 characters (Meta's limit), cut on a word. */
export function buttonTitle(question: string): string {
  const t = String(question || '').replace(/\s+/g, ' ').trim().replace(/[?.!]+$/, '')
  if (t.length <= 20) return t
  const cut = t.slice(0, 19)
  const space = cut.lastIndexOf(' ')
  return `${(space > 8 ? cut.slice(0, space) : cut).trim()}…`
}

export type FollowUp = string | { label?: string; question?: string }

/**
 * The quick buttons under an answer: the AI's follow-ups (≤2; a short label on the button, the full question
 * behind it) and "Talk to a person", no repeats.
 */
export function quickButtons(next: FollowUp[] | undefined, opts: { person: boolean; max?: number }): { title: string; id: string }[] {
  const max = opts.max ?? 3
  const out: { title: string; id: string }[] = []
  for (const item of next || []) {
    const question = String((typeof item === 'string' ? item : item?.question || item?.label) || '').replace(/\s+/g, ' ').trim().slice(0, 200)
    const label = typeof item === 'string' ? question : String(item?.label || question)
    if (question.length < 3 || out.length >= max - (opts.person ? 1 : 0) || out.length >= 2) continue
    const title = buttonTitle(label)
    if (out.some((b) => b.title.toLowerCase() === title.toLowerCase()) || title.toLowerCase() === PERSON_BUTTON.toLowerCase()) continue
    out.push({ title, id: `${ASK_PREFIX}${question}` })
  }
  if (opts.person && out.length < max) out.push({ title: PERSON_BUTTON, id: `${ASK_PREFIX}${PERSON_BUTTON}` })
  return out
}

/** A tapped quick button's question ("aq:<question>"), or null for other buttons. */
export function askedByButton(id: unknown): string | null {
  const s = String(id || '')
  if (!s.startsWith(ASK_PREFIX)) return null
  const q = s.slice(ASK_PREFIX.length).trim()
  return q ? q.slice(0, 500) : null
}

// ── Messages for each channel ───────────────────────────────────────────────

export interface ReplyPlan {
  text: string
  buttons?: { title: string; id: string }[]
  /** One link to show as a button ("Book online") */
  link?: { url: string; label: string } | null
}

/** The text with the link written out (for the plain twin and for channels without link buttons). */
export function plainText(plan: ReplyPlan): string {
  const link = plan.link && !plan.text.includes(plan.link.url) ? `\n\n${plan.link.label}: ${plan.link.url}` : ''
  return `${plan.text}${link}`.trim()
}

/** WhatsApp Cloud API message bodies (without messaging_product / to): the main one and its plain twin. */
export function whatsappMessage(plan: ReplyPlan): { message: Record<string, unknown>; plain: Record<string, unknown> } {
  const text = forWhatsApp(plan.text)
  const plain = { type: 'text', text: { body: plainText({ ...plan, text }).slice(0, 4096), preview_url: /https?:\/\//.test(plainText({ ...plan, text })) } }
  const buttons = (plan.buttons || []).slice(0, 3)
  // Quick buttons win; a link then stays in the words
  if (buttons.length && bytes(plainText({ ...plan, text })) <= 1024) {
    return {
      message: { type: 'interactive', interactive: { type: 'button', body: { text: plainText({ ...plan, text }) }, action: { buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) } })) } } },
      plain,
    }
  }
  if (plan.link && bytes(text) <= 1024 && /^https:\/\//.test(plan.link.url)) {
    return {
      message: { type: 'interactive', interactive: { type: 'cta_url', body: { text: text || plan.link.label }, action: { name: 'cta_url', parameters: { display_text: buttonTitle(plan.link.label || 'Open link'), url: plan.link.url } } } },
      plain,
    }
  }
  return { message: plain, plain }
}

/** Instagram message bodies (`message` objects): text in parts of ≤1,000 characters, chips under the last one. */
export function instagramMessages(plan: ReplyPlan): Record<string, unknown>[] {
  const parts = splitMessage(forInstagram(plainText(plan)), 1000, 3)
  const chips = (plan.buttons || []).slice(0, 13)
  return parts.map((text, i) => (i === parts.length - 1 && chips.length
    ? { text, quick_replies: chips.map((b) => ({ content_type: 'text', title: b.title.slice(0, 20), payload: b.id.slice(0, 1000) })) }
    : { text }))
}

/** WhatsApp: mark the customer's message read and show "typing…" (until the reply, at most about 25 seconds). */
export function whatsappTyping(messageId: string): Record<string, unknown> {
  return { messaging_product: 'whatsapp', status: 'read', message_id: messageId, typing_indicator: { type: 'text' } }
}
