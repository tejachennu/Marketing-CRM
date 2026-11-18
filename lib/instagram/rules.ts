/**
 * Instagram for WAMA CRM (Instagram API with Unified Login: Facebook Login for Business with an Instagram
 * configuration, Business Integration System User token, graph.facebook.com). Pure and browser-safe:
 * webhook reading, message bodies, feed and caption rules. The database and Meta calls are in store.ts.
 *
 * Docs (read 18–19 Nov 2026): developers.facebook.com/documentation/instagram-platform/
 *   instagram-api-with-unified-login/get-started, webhooks/setup, webhooks/examples, messaging-api,
 *   private-replies, comment-moderation, content-publishing, reference/instagram-media.
 */

export const IG_GRAPH = 'https://graph.facebook.com/v27.0'

/** Permissions the Instagram configuration asks for (each needs Advanced Access before other businesses can connect). */
export const IG_PERMISSIONS = ['instagram_basic', 'instagram_manage_messages', 'instagram_manage_comments', 'instagram_content_publish'] as const

/** Webhook fields each connected account is subscribed to. */
export const IG_FIELDS = ['messages', 'messaging_postbacks', 'messaging_seen', 'comments'] as const

/** The phone column for an Instagram contact (contacts need one; campaigns skip "ig:"). */
export const igContactKey = (igsid: string) => `ig:${igsid}`

export interface IgIncomingMessage {
  kind: 'message'
  accountId: string
  senderId: string
  mid: string
  text: string
  attachments: { type: string; url: string }[]
  timestamp: number
  echo: boolean
  replyTo: string | null
}
export interface IgSeen { kind: 'seen'; accountId: string; senderId: string; mid: string | null; timestamp: number }
export interface IgComment {
  kind: 'comment'
  accountId: string
  commentId: string
  parentId: string | null
  text: string
  fromId: string
  fromUsername: string
  mediaId: string
  mediaType: string
  timestamp: number
}
export type IgEvent = IgIncomingMessage | IgSeen | IgComment

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v))

/**
 * Every event in an Instagram webhook delivery. DMs come in entry[].messaging[], comments in
 * entry[].changes[] (field "comments"; the comment id is value.id or value.comment_id, the docs show both).
 */
export function readIgWebhook(payload: any): IgEvent[] {
  if (payload?.object !== 'instagram') return []
  const out: IgEvent[] = []
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    const accountId = str(entry?.id)
    for (const m of Array.isArray(entry?.messaging) ? entry.messaging : []) {
      const sender = str(m?.sender?.id)
      const recipient = str(m?.recipient?.id)
      if (m?.message && !m.message.is_deleted && !m.message.is_unsupported) {
        const echo = m.message.is_echo === true
        out.push({
          kind: 'message', accountId: accountId || (echo ? sender : recipient), senderId: echo ? recipient : sender,
          mid: str(m.message.mid), text: str(m.message.text).slice(0, 4000),
          attachments: (Array.isArray(m.message.attachments) ? m.message.attachments : []).map((a: any) => ({ type: str(a?.type), url: str(a?.payload?.url) })).filter((a: any) => a.type),
          timestamp: Number(m.timestamp) || Date.now(), echo, replyTo: m.message.reply_to?.mid ? str(m.message.reply_to.mid) : null,
        })
      } else if (m?.postback) {
        out.push({ kind: 'message', accountId: accountId || recipient, senderId: sender, mid: str(m.postback.mid), text: str(m.postback.title || m.postback.payload), attachments: [], timestamp: Number(m.timestamp) || Date.now(), echo: false, replyTo: null })
      } else if (m?.read) {
        out.push({ kind: 'seen', accountId: accountId || recipient, senderId: sender, mid: m.read.mid ? str(m.read.mid) : null, timestamp: Number(m.timestamp) || Date.now() })
      }
    }
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (change?.field !== 'comments') continue
      const v = change.value || {}
      const commentId = str(v.comment_id || v.id)
      if (!commentId) continue
      out.push({
        kind: 'comment', accountId, commentId, parentId: v.parent_id ? str(v.parent_id) : null, text: str(v.text).slice(0, 2200),
        fromId: str(v.from?.id), fromUsername: str(v.from?.username), mediaId: str(v.media?.id), mediaType: str(v.media?.media_product_type),
        timestamp: Number(entry?.time) ? Number(entry.time) * (Number(entry.time) < 1e12 ? 1000 : 1) : Date.now(),
      })
    }
  }
  return out
}

/** What the inbox shows for a DM (text, or a word for what was sent). */
export function messageText(m: Pick<IgIncomingMessage, 'text' | 'attachments'>): string {
  if (m.text) return m.text
  const a = m.attachments[0]
  if (!a) return '[Message]'
  const words: Record<string, string> = { image: '[Photo]', video: '[Video]', audio: '[Voice message]', file: '[File]', ig_reel: '[Shared a reel]', reel: '[Shared a reel]', ig_post: '[Shared a post]', share: '[Shared a post]', story_mention: '[Mentioned you in a story]', ig_story: '[Replied to a story]', story: '[Replied to a story]' }
  return words[a.type] || '[Attachment]'
}

/** A DM reply body: text (≤1000 bytes) or one image. */
export function dmBody(recipientId: string, input: { text?: string; imageUrl?: string; humanAgent?: boolean }): Record<string, unknown> | { error: string } {
  const text = str(input.text).trim()
  if (!text && !input.imageUrl) return { error: 'Type a message.' }
  if (text && new TextEncoder().encode(text).length > 1000) return { error: 'Instagram takes at most 1,000 characters (fewer with emoji). Shorten the message.' }
  if (input.imageUrl && !/^https:\/\//.test(input.imageUrl)) return { error: 'The photo must be a web link (https).' }
  const message = input.imageUrl ? { attachment: { type: 'image', payload: { url: input.imageUrl } } } : { text }
  return { recipient: { id: recipientId }, message, ...(input.humanAgent ? { messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' } : {}) }
}

/**
 * Instagram's reply window: 24 hours after the customer's last message, or up to 7 days with the Human
 * Agent tag (a person, not the AI, answering). Returns how this reply may go out, or why it cannot.
 */
export function replyWindow(lastCustomerAt: string | null | undefined, now: number = Date.now()): { ok: true; humanAgent: boolean } | { ok: false; reason: string } {
  const last = lastCustomerAt ? Date.parse(lastCustomerAt) : NaN
  if (!Number.isFinite(last)) return { ok: false, reason: 'Instagram lets you reply only after the customer writes to you.' }
  const hours = (now - last) / 3_600_000
  if (hours <= 24) return { ok: true, humanAgent: false }
  if (hours <= 24 * 7) return { ok: true, humanAgent: true }
  return { ok: false, reason: 'It is more than 7 days since this customer last wrote. Instagram does not allow a reply until they write again.' }
}

/** A post for the store feed or the dashboard (videos may come without media_url: then the thumbnail or nothing). */
export function feedItem(m: any): { id: string; type: string; image: string; link: string; caption: string; at: string } | null {
  const type = str(m?.media_type)
  const image = type === 'VIDEO' ? str(m?.thumbnail_url || m?.media_url) : str(m?.media_url || m?.children?.data?.[0]?.media_url)
  if (!m?.id || !/^https:\/\//.test(str(m?.permalink))) return null
  return { id: str(m.id), type, image: /^https:\/\//.test(image) ? image : '', link: str(m.permalink), caption: str(m.caption).slice(0, 300), at: str(m.timestamp) }
}

/** A caption checked against Instagram's limits (2,200 characters, 30 hashtags, 20 @tags). */
export function checkCaption(raw: unknown): { caption: string } | { error: string } {
  const caption = str(raw).trim()
  if (caption.length > 2200) return { error: 'Instagram captions can be at most 2,200 characters.' }
  if ((caption.match(/#[\p{L}\p{N}_]+/gu) || []).length > 30) return { error: 'Instagram allows at most 30 hashtags.' }
  if ((caption.match(/@[A-Za-z0-9._]+/g) || []).length > 20) return { error: 'Instagram allows at most 20 @mentions.' }
  return { caption }
}

/** A product's caption for "Post on Instagram". */
export function productCaption(p: { title: string; price?: number | null; description?: string | null }, link: string, currencySymbol = '₹'): string {
  const price = Number(p.price) > 0 ? ` · ${currencySymbol}${Number(p.price).toLocaleString('en-IN')}` : ''
  return [`${p.title}${price}`, str(p.description).slice(0, 600), link ? `Order: ${link}` : ''].filter(Boolean).join('\n\n')
}

// ── Limits ───────────────────────────────────────────────────────────────────

/** Meta's "too many calls" answers (app, user, page and Instagram business limits). */
export function isRateLimit(error: { code?: unknown } | null | undefined): boolean {
  return [4, 17, 32, 613, 80002, 80006].includes(Number(error?.code))
}

/** How we keep in step with Instagram without spending its small hourly call allowance. */
export interface IgSyncState {
  dmsAt?: string
  commentsAt?: string
  waitUntil?: string
  threads?: Record<string, string>
  media?: Record<string, number>
}
export const SYNC_GAP_MS = 60_000
export const SLOW_DOWN_MS = 15 * 60_000
export const OLDEST_MS = 7 * 86_400_000
export const PER_SYNC = 5

export function readSyncState(raw: unknown): IgSyncState {
  const s = raw && typeof raw === 'object' ? (raw as any) : {}
  const map = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as any) : {})
  return { dmsAt: s.dmsAt || undefined, commentsAt: s.commentsAt || undefined, waitUntil: s.waitUntil || undefined, threads: map(s.threads), media: map(s.media) }
}

/** Whether to ask Instagram now: never inside a slow-down, and at most once a minute per kind. */
export function syncAllowed(state: IgSyncState, kind: 'dms' | 'comments', now: number = Date.now()): { ok: true } | { ok: false; waitMinutes?: number } {
  const wait = state.waitUntil ? Date.parse(state.waitUntil) : 0
  if (wait > now) return { ok: false, waitMinutes: Math.max(1, Math.ceil((wait - now) / 60_000)) }
  const last = Date.parse(String(kind === 'dms' ? state.dmsAt : state.commentsAt || ''))
  if (Number.isFinite(last) && now - last < SYNC_GAP_MS) return { ok: false }
  return { ok: true }
}

/** What a message from the conversations API says when it has no text (shares, stories, photos…). */
export function apiMessageText(x: any): string {
  const text = str(x?.message).trim()
  if (text) return text.slice(0, 4000)
  if (x?.story) return x.story?.mention ? '[Mentioned you in a story]' : '[Replied to your story]'
  if (x?.shares?.data?.length) return '[Shared a post]'
  if (x?.sticker) return '[Sticker]'
  const a = x?.attachments?.data?.[0]
  if (a?.image_data) return '[Photo]'
  if (a?.video_data) return '[Video]'
  if (a?.audio_data) return '[Voice message]'
  if (a?.file_url) return '[File]'
  return '[Message]'
}

// ── Automatic replies ────────────────────────────────────────────────────────

export interface IgRule { keywords: string[]; reply: string; dm: string }
export interface IgAutomation {
  /** AI answers DMs from the knowledge base (a person can still turn it off in one chat). */
  dmAi: boolean
  /** AI writes a short public reply to comments it can answer from the knowledge base. */
  commentAi: boolean
  /** Comment contains one of the words → public reply and/or a DM. First match wins. */
  rules: IgRule[]
  /** For every other comment. */
  everyComment: { on: boolean; reply: string; dm: string }
  /** Comments with these words are hidden (spam, abuse). */
  hideWords: string[]
}
export const DEFAULT_AUTOMATION: IgAutomation = { dmAi: true, commentAi: false, rules: [], everyComment: { on: false, reply: '', dm: '' }, hideWords: [] }
const MAX_RULES = 20

const words = (v: unknown): string[] => {
  const list = Array.isArray(v) ? v : str(v).split(',')
  return [...new Set(list.map((w) => str(w).trim().toLowerCase()).filter(Boolean))].slice(0, 30).map((w) => w.slice(0, 40))
}
const short = (v: unknown, max: number) => str(v).trim().slice(0, max)

/** Saved settings, cleaned (anything odd falls back to the default). */
export function readIgAutomation(raw: unknown): IgAutomation {
  const a = raw && typeof raw === 'object' ? (raw as any) : {}
  const rules = (Array.isArray(a.rules) ? a.rules : []).map((r: any) => ({ keywords: words(r?.keywords), reply: short(r?.reply, 900), dm: short(r?.dm, 900) }))
    .filter((r: IgRule) => r.keywords.length && (r.reply || r.dm)).slice(0, MAX_RULES)
  const every = a.everyComment || {}
  return {
    dmAi: a.dmAi !== false,
    commentAi: a.commentAi === true,
    rules,
    everyComment: { on: every.on === true && Boolean(short(every.reply, 900) || short(every.dm, 900)), reply: short(every.reply, 900), dm: short(every.dm, 900) },
    hideWords: words(a.hideWords),
  }
}

/** Settings from the screen: what is wrong in plain words, or the clean settings. */
export function parseIgAutomation(body: any): { automation: IgAutomation } | { error: string } {
  const rules = Array.isArray(body?.rules) ? body.rules : []
  if (rules.length > MAX_RULES) return { error: `At most ${MAX_RULES} keyword replies.` }
  for (const [i, r] of rules.entries()) {
    if (!words(r?.keywords).length) return { error: `Reply ${i + 1}: add at least one word to look for.` }
    if (!short(r?.reply, 900) && !short(r?.dm, 900)) return { error: `Reply ${i + 1}: write a public reply, a DM, or both.` }
    if (str(r?.reply).length > 900 || str(r?.dm).length > 900) return { error: `Reply ${i + 1}: keep each message under 900 characters.` }
  }
  if (body?.everyComment?.on && !short(body.everyComment.reply, 900) && !short(body.everyComment.dm, 900)) return { error: 'Write the reply for every other comment, or switch it off.' }
  return { automation: readIgAutomation(body) }
}

const has = (text: string, list: string[]) => list.some((w) => text.includes(w))
const fill = (template: string, username: string) => template.replace(/\{name\}/g, username ? `@${username}` : '').replace(/\s{2,}/g, ' ').trim()

/** What to do with a new comment: hide it, answer it (words to send), ask the AI, or nothing. */
export function commentPlan(a: IgAutomation, comment: { text: string; fromUsername?: string | null }): { hide: true } | { reply: string; dm: string; ai: boolean } | null {
  const text = str(comment.text).toLowerCase()
  const who = str(comment.fromUsername)
  if (a.hideWords.length && has(text, a.hideWords)) return { hide: true }
  const rule = a.rules.find((r) => has(text, r.keywords))
  if (rule) return { reply: fill(rule.reply, who), dm: fill(rule.dm, who), ai: false }
  if (a.commentAi && text.trim()) return { reply: '', dm: a.everyComment.on ? fill(a.everyComment.dm, who) : '', ai: true }
  if (a.everyComment.on) return { reply: fill(a.everyComment.reply, who), dm: fill(a.everyComment.dm, who), ai: false }
  return null
}
