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
