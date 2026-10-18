/**
 * How a chat message is read and shown: reply markers, list previews, media kind,
 * WhatsApp text formatting, bubble grouping and the 24-hour service window.
 * Pure functions, shared by the inbox, the campaign workspace and their tests.
 */

import { describeCommerceMessage, parseCommerceMessage } from '@/lib/chat-commerce'

export interface ChatMessageLike {
  id: string
  sender_type: string
  body?: string | null
  media_url?: string | null
  created_at: string
}

// ── Reply markers ───────────────────────────────────────────────────────────

const REPLY_MARKER = /^\[reply:([^\]]+)\]([\s\S]*)$/

/** A reply is stored as "[reply:<message id>]text". Returns the two parts. */
export function parseReplyMarker(body: string | null | undefined): { replyToId: string | null; text: string } {
  const value = body ?? ''
  const match = value.match(REPLY_MARKER)
  if (!match) return { replyToId: null, text: value }
  return { replyToId: match[1], text: match[2] }
}

export function withReplyMarker(replyToId: string | null | undefined, text: string): string {
  return replyToId ? `[reply:${replyToId}]${text}` : text
}

// ── Media ───────────────────────────────────────────────────────────────────

export type MediaKind = 'image' | 'video' | 'audio' | 'document'

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'ico']
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', '3gp', 'm4v']
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'amr', 'opus']

function kindFromExtension(extension: string): MediaKind | null {
  const ext = extension.toLowerCase()
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video'
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio'
  return null
}

/** What kind of attachment a media URL points to, or null when there is none. */
export function getMediaType(url: string | null | undefined): MediaKind | null {
  if (!url) return null

  if (url.startsWith('data:image/')) return 'image'
  if (url.startsWith('data:video/')) return 'video'
  if (url.startsWith('data:audio/')) return 'audio'
  if (url.startsWith('data:')) return 'document'

  // The webhook appends "#media.<ext>" when the URL itself has no extension
  const hashPart = url.includes('#') ? url.split('#')[1] : ''
  const hashExtension = hashPart.match(/media\.([a-zA-Z0-9]+)/i)
  if (hashExtension) return kindFromExtension(hashExtension[1]) || 'document'

  try {
    const parsed = new URL(url, 'https://placeholder.invalid')
    const mime = parsed.searchParams.get('mime') || parsed.searchParams.get('type')
    if (mime?.startsWith('image/')) return 'image'
    if (mime?.startsWith('video/')) return 'video'
    if (mime?.startsWith('audio/')) return 'audio'
    const extParam = parsed.searchParams.get('ext')
    const fromParam = extParam ? kindFromExtension(extParam) : null
    if (fromParam) return fromParam
  } catch {
    // Not a parseable URL: fall through to the file extension
  }

  const path = url.split('?')[0].split('#')[0]
  return kindFromExtension(path.split('.').pop() || '') || 'document'
}

/** Twilio media needs the account credentials, so it is fetched through our proxy. */
export function getDisplayUrl(url: string | null | undefined): string {
  if (!url) return ''
  return url.startsWith('https://api.twilio.com') ? `/api/media/proxy?url=${encodeURIComponent(url)}` : url
}

export function getDownloadName(url: string | null | undefined): string {
  if (!url) return 'attachment'
  if (url.startsWith('data:')) {
    const mime = url.match(/^data:([^;,]+)/)?.[1] || 'application/octet-stream'
    return `attachment.${mime.split('/')[1] || 'bin'}`
  }
  const hashPart = url.includes('#') ? url.split('#')[1] : ''
  const hashExtension = hashPart.match(/media\.([a-zA-Z0-9]+)/i)
  if (hashExtension) return `attachment.${hashExtension[1]}`

  const lastPart = url.split('?')[0].split('#')[0].split('/').pop() || 'attachment'
  try {
    return decodeURIComponent(lastPart)
  } catch {
    return lastPart
  }
}

const MEDIA_LABELS: Record<MediaKind, string> = {
  image: '📷 Photo',
  video: '🎥 Video',
  audio: '🎵 Audio',
  document: '📄 Document',
}

const MEDIA_PLACEHOLDER = '[Media Attachment]'

/** The text of a message without its reply marker or the media placeholder. */
export function getMessageText(message: Pick<ChatMessageLike, 'body' | 'media_url'>): string {
  const { text } = parseReplyMarker(message.body)
  return message.media_url && text === MEDIA_PLACEHOLDER ? '' : text
}

/** One line describing a message, for the conversation list and quoted replies. */
export function getMessagePreview(message: Pick<ChatMessageLike, 'body' | 'media_url'> | null | undefined): string {
  if (!message) return ''
  const commerce = parseCommerceMessage(message.body)
  if (commerce) return describeCommerceMessage(commerce)
  const text = getMessageText(message).replace(/\s+/g, ' ').trim()
  if (text) return text
  const kind = getMediaType(message.media_url)
  return kind ? MEDIA_LABELS[kind] : ''
}

// ── Text formatting ─────────────────────────────────────────────────────────

export interface RichTextToken {
  text: string
  bold?: boolean
  italic?: boolean
  strike?: boolean
  code?: boolean
  /** Set when the token is a link; always an http(s) address. */
  href?: string
}

const URL_PATTERN = /((?:https?:\/\/|www\.)[^\s<>"']+)/gi
// Punctuation that usually ends the sentence rather than the link
const TRAILING_PUNCTUATION = /[.,!?;:)\]}'"]+$/

function splitLinks(text: string, style: Omit<RichTextToken, 'text' | 'href'>): RichTextToken[] {
  const tokens: RichTextToken[] = []
  let cursor = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    let link = match[0]
    const start = match.index ?? 0
    const trailing = link.match(TRAILING_PUNCTUATION)?.[0] || ''
    // Keep a closing bracket that belongs to the address, as in a Wikipedia URL
    const keepsBracket = trailing.startsWith(')') && link.slice(0, -trailing.length).includes('(')
    if (trailing && !keepsBracket) link = link.slice(0, -trailing.length)

    if (start > cursor) tokens.push({ ...style, text: text.slice(cursor, start) })
    tokens.push({ ...style, text: link, href: link.toLowerCase().startsWith('www.') ? `https://${link}` : link })
    cursor = start + link.length
  }
  if (cursor < text.length) tokens.push({ ...style, text: text.slice(cursor) })
  return tokens
}

// WhatsApp marks: *bold* _italic_ ~strike~ `code`. A mark needs a non-space right inside
// it and must not sit in the middle of a word, so "2 * 3 * 4" and "snake_case_name" stay as typed.
const FORMAT_PATTERN = /(^|[^\p{L}\p{N}])(\*([^\s*](?:[^*\n]*[^\s*])?)\*|_([^\s_](?:[^_\n]*[^\s_])?)_|~([^\s~](?:[^~\n]*[^\s~])?)~|`([^`\n]+)`)(?![\p{L}\p{N}])/gu

/** Split message text into runs carrying WhatsApp formatting and links. */
export function parseRichText(text: string | null | undefined): RichTextToken[] {
  const value = text ?? ''
  if (!value) return []

  const tokens: RichTextToken[] = []
  let cursor = 0

  for (const match of value.matchAll(FORMAT_PATTERN)) {
    const lead = match[1]
    const start = (match.index ?? 0) + lead.length
    if (start > cursor) tokens.push(...splitLinks(value.slice(cursor, start), {}))

    if (match[3] !== undefined) tokens.push(...splitLinks(match[3], { bold: true }))
    else if (match[4] !== undefined) tokens.push(...splitLinks(match[4], { italic: true }))
    else if (match[5] !== undefined) tokens.push(...splitLinks(match[5], { strike: true }))
    else if (match[6] !== undefined) tokens.push({ text: match[6], code: true })

    cursor = start + match[2].length
  }

  if (cursor < value.length) tokens.push(...splitLinks(value.slice(cursor), {}))
  return tokens
}

// ── Bubble grouping ─────────────────────────────────────────────────────────

const GROUP_GAP_MS = 5 * 60 * 1000

function isSameCalendarDay(a: string, b: string): boolean {
  const first = new Date(a)
  const second = new Date(b)
  return first.getFullYear() === second.getFullYear() && first.getMonth() === second.getMonth() && first.getDate() === second.getDate()
}

/**
 * Whether a message opens a new day and whether it starts a new run of bubbles
 * (different sender, a new day, or more than five minutes after the one before).
 */
export function getMessagePosition(messages: ChatMessageLike[], index: number): { startsDay: boolean; startsGroup: boolean } {
  const message = messages[index]
  const previous = index > 0 ? messages[index - 1] : null
  if (!previous) return { startsDay: true, startsGroup: true }

  const startsDay = !isSameCalendarDay(previous.created_at, message.created_at)
  const gap = new Date(message.created_at).getTime() - new Date(previous.created_at).getTime()
  const startsGroup = startsDay || previous.sender_type !== message.sender_type || gap > GROUP_GAP_MS
  return { startsDay, startsGroup }
}

// ── The 24-hour customer service window ─────────────────────────────────────

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000
const CLOSING_SOON_MS = 4 * 60 * 60 * 1000

export type ServiceWindow =
  /** The customer wrote within the last 24 hours: free-form replies are allowed. */
  | { state: 'open'; remainingMs: number; closingSoon: boolean }
  /** The customer's last message is older than 24 hours: only templates are delivered. */
  | { state: 'expired' }
  /** The customer has not written at all (in the loaded history): start with a template. */
  | { state: 'none' }

/**
 * WhatsApp only delivers free-form messages for 24 hours after the customer's last message.
 * `messages` is the loaded history, oldest first.
 */
export function getServiceWindow(messages: ChatMessageLike[], now: number = Date.now()): ServiceWindow {
  let lastInbound: ChatMessageLike | null = null
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].sender_type === 'contact') {
      lastInbound = messages[i]
      break
    }
  }
  if (!lastInbound) return { state: 'none' }

  const remainingMs = SERVICE_WINDOW_MS - (now - new Date(lastInbound.created_at).getTime())
  if (remainingMs <= 0) return { state: 'expired' }
  return { state: 'open', remainingMs, closingSoon: remainingMs < CLOSING_SOON_MS }
}

/** "23h 59m", "45m" — time left in an open window. */
export function formatWindowRemaining(remainingMs: number): string {
  const totalMinutes = Math.max(0, Math.floor(remainingMs / 60000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

// ── Small display helpers ───────────────────────────────────────────────────

/** "7", "42", "99+" — keeps a count inside a small badge. */
export function formatBadgeCount(count: number, max = 99): string {
  return count > max ? `${max}+` : String(count)
}

const AVATAR_TONES = [
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300',
  'bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300',
]

/** A stable avatar colour for a contact, so the same person always looks the same in the list. */
export function getAvatarTone(seed: string | null | undefined): string {
  const value = seed || ''
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  return AVATAR_TONES[hash % AVATAR_TONES.length]
}
