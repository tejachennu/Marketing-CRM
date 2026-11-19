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
  /** Instagram's API does not share this kind (some voice notes, GIFs…): shown as a note to open Instagram. */
  unsupported?: boolean
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
      if (m?.message && !m.message.is_deleted) {
        const echo = m.message.is_echo === true
        out.push({
          kind: 'message', accountId: accountId || (echo ? sender : recipient), senderId: echo ? recipient : sender,
          mid: str(m.message.mid), text: str(m.message.text).slice(0, 4000),
          attachments: (Array.isArray(m.message.attachments) ? m.message.attachments : []).map((a: any) => ({ type: str(a?.type), url: str(a?.payload?.url) })).filter((a: any) => a.type),
          timestamp: Number(m.timestamp) || Date.now(), echo, replyTo: m.message.reply_to?.mid ? str(m.message.reply_to.mid) : null,
          unsupported: m.message.is_unsupported === true,
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

export const UNSUPPORTED_TEXT = "[A message Instagram doesn't share with other apps (like some voice notes or GIFs). Open Instagram to see it.]"

/** What the inbox shows for a DM (text, or a word for what was sent). */
export function messageText(m: Pick<IgIncomingMessage, 'text' | 'attachments'> & { unsupported?: boolean }): string {
  if (m.text) return m.text
  if (m.unsupported) return UNSUPPORTED_TEXT
  const a = m.attachments[0]
  if (!a) return '[Message]'
  const words: Record<string, string> = { image: '[Photo]', animated_image: '[GIF]', sticker: '[Sticker]', video: '[Video]', audio: '[Voice message]', file: '[File]', ig_reel: '[Shared a reel]', reel: '[Shared a reel]', ig_post: '[Shared a post]', share: '[Shared a post]', story_mention: '[Mentioned you in a story]', ig_story: '[Replied to a story]', story: '[Replied to a story]' }
  return words[a.type] || '[Attachment]'
}

// ── Sending files ────────────────────────────────────────────────────────────

export type IgMediaKind = 'image' | 'video' | 'audio' | 'file'

/** The type a file must be served with for Instagram to take it (it goes by the type, not the ending). */
export const SEND_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', ogv: 'video/ogg', avi: 'video/x-msvideo',
  m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', pdf: 'application/pdf',
}

/** What Instagram accepts (Messaging API: photos PNG / JPEG ≤ 8 MB; video, audio, PDF ≤ 25 MB). */
const SEND_KINDS: Record<string, IgMediaKind> = {
  png: 'image', jpg: 'image', jpeg: 'image',
  mp4: 'video', mov: 'video', webm: 'video', ogv: 'video', avi: 'video',
  m4a: 'audio', aac: 'audio', wav: 'audio',
  pdf: 'file',
}
/** Photos in other formats are turned into JPEG before sending. */
export const CONVERT_TO_JPEG = ['webp', 'gif', 'heic', 'heif', 'bmp', 'tif', 'tiff', 'avif']
export const IG_SEND_HELP = 'Instagram takes photos (JPEG, PNG up to 8 MB), videos (MP4, MOV, WebM up to 25 MB), audio (M4A, AAC, WAV up to 25 MB) and PDF files.'

/** The file's extension from a link (our uploads keep it) or a data: link's type. */
export function fileExtension(url: string): string {
  const mime = /^data:([^;,]+)/.exec(url)?.[1]
  if (mime) return mime.split('/')[1]?.replace('jpeg', 'jpg').replace('quicktime', 'mov').replace('x-m4a', 'm4a').replace('mpeg', 'mp3') || ''
  const hash = /#media\.([a-z0-9]+)/i.exec(url)?.[1]
  if (hash) return hash.toLowerCase()
  return (url.split('?')[0].split('#')[0].split('/').pop() || '').split('.').slice(1).pop()?.toLowerCase() || ''
}

/** How a file goes to Instagram: as a kind it takes, after turning it into a JPEG, or not at all (why). */
export function sendKind(url: string): { kind: IgMediaKind } | { convert: true } | { error: string } {
  if (!/^https:\/\//.test(url)) return { error: 'The file did not upload. Please attach it again.' }
  const ext = fileExtension(url)
  if (SEND_KINDS[ext]) return { kind: SEND_KINDS[ext] }
  if (CONVERT_TO_JPEG.includes(ext)) return { convert: true }
  return { error: `Instagram can't take ${ext ? `.${ext} files` : 'this file'}. ${IG_SEND_HELP}` }
}

/**
 * The request bodies for one reply: the file first (Instagram sends a file and its words as two
 * messages), then the text (≤1000 bytes). Human Agent tag on each when a person answers after 24 hours.
 */
export function dmBodies(recipientId: string, input: { text?: string; media?: { url: string; kind: IgMediaKind }; humanAgent?: boolean }): Record<string, unknown>[] | { error: string } {
  const text = str(input.text).trim()
  if (!text && !input.media) return { error: 'Type a message.' }
  if (text && new TextEncoder().encode(text).length > 1000) return { error: 'Instagram takes at most 1,000 characters (fewer with emoji). Shorten the message.' }
  const tag = input.humanAgent ? { messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' } : {}
  const out: Record<string, unknown>[] = []
  if (input.media) out.push({ recipient: { id: recipientId }, message: { attachment: { type: input.media.kind, payload: { url: input.media.url } } }, ...tag })
  if (text) out.push({ recipient: { id: recipientId }, message: { text }, ...tag })
  return out
}

/** One body (text or a photo link), kept for callers that send one thing. */
export function dmBody(recipientId: string, input: { text?: string; imageUrl?: string; humanAgent?: boolean }): Record<string, unknown> | { error: string } {
  if (input.imageUrl && !/^https:\/\//.test(input.imageUrl)) return { error: 'The photo must be a web link (https).' }
  const bodies = dmBodies(recipientId, { text: input.imageUrl ? '' : input.text, media: input.imageUrl ? { url: input.imageUrl, kind: 'image' } : undefined, humanAgent: input.humanAgent })
  return 'error' in bodies ? bodies : bodies[0]
}

/** Meta's file errors in plain words. */
export function igSendError(message: string): string {
  if (/upload attachment|attachment.*(fail|invalid)|2534|file.*(large|size)/i.test(message)) return `Instagram could not take this file. ${IG_SEND_HELP}`
  return message
}

// ── Receiving files ──────────────────────────────────────────────────────────

/** A received attachment worth keeping a copy of (Instagram's links expire), and its kind. */
export function keepableKind(type: string): IgMediaKind | null {
  if (type === 'image' || type === 'animated_image' || type === 'sticker') return 'image'
  if (type === 'video') return 'video'
  if (type === 'audio') return 'audio'
  if (type === 'file') return 'file'
  return null
}

/** File extension for a downloaded file's type. */
export function extensionForType(contentType: string, kind: IgMediaKind): string {
  const t = contentType.split(';')[0].trim().toLowerCase()
  const known: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
    'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/webm': 'webm',
    'application/pdf': 'pdf',
  }
  return known[t] || { image: 'jpg', video: 'mp4', audio: 'm4a', file: 'bin' }[kind]
}

/** The attachments of a message read from the conversations API, in the webhook's shape. */
export function apiAttachments(x: any): { type: string; url: string }[] {
  const out: { type: string; url: string }[] = []
  for (const a of x?.attachments?.data || []) {
    if (a?.image_data?.url) out.push({ type: /gif/i.test(str(a.mime_type)) ? 'animated_image' : 'image', url: str(a.image_data.url) })
    else if (a?.video_data?.url) out.push({ type: /^audio\//i.test(str(a.mime_type)) ? 'audio' : 'video', url: str(a.video_data.url) })
    else if (a?.audio_data?.url) out.push({ type: 'audio', url: str(a.audio_data.url) })
    else if (a?.file_url) out.push({ type: /^audio\//i.test(str(a.mime_type)) ? 'audio' : /^video\//i.test(str(a.mime_type)) ? 'video' : /^image\//i.test(str(a.mime_type)) ? 'image' : 'file', url: str(a.file_url) })
  }
  const share = x?.shares?.data?.[0]
  if (share) out.push({ type: 'share', url: str(share.link || share.url) })
  if (x?.story) out.push({ type: x.story.mention ? 'story_mention' : 'ig_story', url: str(x.story.mention?.link || x.story.reply_to?.link) })
  return out
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

// ── Photos uploaded for a new post ───────────────────────────────────────────
// Instagram's posting API takes only a public photo link, so a photo picked on the device is saved as a JPEG
// in our storage under instagram-posts/<workspace>/, handed to Instagram, and deleted once the post is up.

export const POST_PHOTO_DIR = 'instagram-posts'
export const POST_PHOTO_MAX_BYTES = 15 * 1024 * 1024
/** Instagram feed photos must be between 4:5 (tall) and 1.91:1 (wide). */
export const POST_RATIO = { min: 4 / 5, max: 1.91 }

/** The storage path of a photo this workspace uploaded for a post, from its public link; null for any other link. */
export function postPhotoPath(url: unknown, organizationId: string): string | null {
  const match = String(url || '').match(/\/storage\/v1\/object\/public\/media-attachments\/(.+)$/)
  if (!match) return null
  const path = decodeURIComponent(match[1].split('?')[0])
  const dir = `${POST_PHOTO_DIR}/${organizationId}/`
  if (!path.startsWith(dir) || path.includes('..') || !/^[\w-]+\.jpg$/.test(path.slice(dir.length))) return null
  return path
}

/** The middle part to keep so a photo fits Instagram's 4:5 to 1.91:1 shape; null when it already fits. */
export function fitForInstagram(width: number, height: number): { left: number; top: number; width: number; height: number } | null {
  if (!(width > 0 && height > 0)) return null
  const ratio = width / height
  if (ratio < POST_RATIO.min) {
    const h = Math.floor(width / POST_RATIO.min)
    return { left: 0, top: Math.floor((height - h) / 2), width, height: h }
  }
  if (ratio > POST_RATIO.max) {
    const w = Math.floor(height * POST_RATIO.max)
    return { left: Math.floor((width - w) / 2), top: 0, width: w, height }
  }
  return null
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
  /** Chats cleared or deleted: messages with this person from before the time are never read in again. */
  forget?: Record<string, string>
}
export const SYNC_GAP_MS = 60_000
export const SLOW_DOWN_MS = 15 * 60_000
export const OLDEST_MS = 7 * 86_400_000
export const PER_SYNC = 5

export function readSyncState(raw: unknown): IgSyncState {
  const s = raw && typeof raw === 'object' ? (raw as any) : {}
  const map = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as any) : {})
  return { dmsAt: s.dmsAt || undefined, commentsAt: s.commentsAt || undefined, waitUntil: s.waitUntil || undefined, threads: map(s.threads), media: map(s.media), forget: map(s.forget) }
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
  return messageText({ text: str(x?.message).trim().slice(0, 4000), attachments: apiAttachments(x), unsupported: x?.is_unsupported === true })
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
