/**
 * Turning a business's documents into knowledge the AI can search, kept pure (no imports; browser-safe):
 *  - web page HTML → readable text with its headings, plus the page's links (for reading a whole website),
 *  - robots.txt rules and sitemap links,
 *  - splitting long text into parts ("chunks") that keep their heading, with a small overlap,
 *  - the files and links an FAQ can carry (photo, video, document, link) and which ones WhatsApp can send,
 *  - web addresses that may be read (no local or private network addresses).
 */

// ── Kinds of knowledge ──────────────────────────────────────────────────────

export type SourceKind = 'website' | 'pdf' | 'document' | 'text'

export const SOURCE_LABELS: Record<SourceKind, string> = {
  website: 'Website',
  pdf: 'PDF',
  document: 'Document',
  text: 'Text',
}

/** File endings a business can upload as knowledge, and how each is read. */
export const SOURCE_FILES: Record<string, { kind: SourceKind; type: string }> = {
  pdf: { kind: 'pdf', type: 'application/pdf' },
  docx: { kind: 'document', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  txt: { kind: 'document', type: 'text/plain' },
  md: { kind: 'document', type: 'text/markdown' },
  csv: { kind: 'document', type: 'text/csv' },
}

export const MAX_SOURCE_BYTES = 25 * 1024 * 1024
export const MAX_PAGES = 25
export const MAX_CHUNKS_PER_SOURCE = 400

export const fileEnding = (name: string) => (String(name || '').toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1] || '')

// ── HTML → text ─────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', copy: '©', reg: '®', trade: '™', rupee: '₹', bull: '•' }

export function decodeEntities(text: string): string {
  return String(text || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' '
    }
    return ENTITIES[code.toLowerCase()] ?? m
  })
}

export interface PageText {
  title: string
  /** Readable text; headings start with "# " so chunks keep them */
  text: string
  /** Links on the page (absolute, without #fragments) */
  links: string[]
}

/** The readable words of a web page: no scripts, menus, footers or forms; headings kept as "# …". */
export function htmlToText(html: string, pageUrl: string): PageText {
  let h = String(html || '')
  const title = decodeEntities((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim()).slice(0, 200)
  const links: string[] = []
  const seen = new Set<string>()
  for (const m of h.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"'#][^"']*)["']/gi)) {
    try {
      const u = new URL(decodeEntities(m[1]), pageUrl)
      u.hash = ''
      const s = u.toString()
      if (!seen.has(s)) { seen.add(s); links.push(s) }
    } catch {}
  }
  // The main part when the page marks it
  const main = h.match(/<main\b[\s\S]*?<\/main>/i)?.[0] || h.match(/<article\b[\s\S]*?<\/article>/i)?.[0]
  if (main && main.replace(/<[^>]+>/g, '').trim().length > 200) h = main
  h = h
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head\b[\s\S]*?<\/head>/gi, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|canvas|form|select|button)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|footer|header|aside)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, _l, inner) => `\n\n# ${inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}\n\n`)
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/(p|div|section|ul|ol|tr|table|h[1-6]|blockquote|pre|dd|dt)>/gi, '\n\n')
    .replace(/<(td|th)\b[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
  const text = decodeEntities(h)
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter((line, i, all) => line !== '' || (i > 0 && all[i - 1] !== ''))
    .join('\n')
    .replace(/^# \s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { title, text, links }
}

/** Links worth reading on the same website: same host, pages (not files), no log-in or cart pages. */
export function sameSiteLinks(links: string[], startUrl: string): string[] {
  let host = ''
  try { host = new URL(startUrl).host.replace(/^www\./, '') } catch { return [] }
  const out: string[] = []
  for (const link of links) {
    try {
      const u = new URL(link)
      if (!/^https?:$/.test(u.protocol) || u.host.replace(/^www\./, '') !== host) continue
      if (/\.(jpe?g|png|gif|webp|svg|ico|css|js|json|xml|zip|rar|mp4|mp3|mov|avi|woff2?|ttf|pdf|docx?|xlsx?|pptx?)$/i.test(u.pathname)) continue
      if (/\/(wp-admin|wp-login|login|signin|sign-in|logout|cart|checkout|account|my-account|feed)(\/|$)/i.test(u.pathname)) continue
      u.search = ''
      const s = u.toString()
      if (!out.includes(s)) out.push(s)
    } catch {}
  }
  return out
}

/** The paths robots.txt keeps every robot out of ("User-agent: *"), and the sitemaps it names. */
export function readRobots(text: string): { disallow: string[]; sitemaps: string[] } {
  const disallow: string[] = []
  const sitemaps: string[] = []
  let forAll = false
  let lastWasAgent = false
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2].trim()
    if (key === 'sitemap') { if (value) sitemaps.push(value); continue }
    if (key === 'user-agent') {
      // Several user-agent lines in a row form one group
      forAll = (lastWasAgent && forAll) || value === '*'
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (key === 'disallow' && forAll && value) disallow.push(value)
  }
  return { disallow, sitemaps }
}

export function robotsAllow(url: string, disallow: string[]): boolean {
  let path = '/'
  try { const u = new URL(url); path = u.pathname + u.search } catch { return false }
  return !disallow.some((rule) => {
    const pattern = rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    return new RegExp(`^${pattern.endsWith('\\$') ? pattern.slice(0, -2) + '$' : pattern}`).test(path)
  })
}

/** Page addresses in a sitemap.xml (and other sitemaps it lists). */
export function sitemapLinks(xml: string): { pages: string[]; sitemaps: string[] } {
  const locs = [...String(xml || '').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1]))
  const isIndex = /<sitemapindex/i.test(xml)
  return isIndex ? { pages: [], sitemaps: locs } : { pages: locs, sitemaps: [] }
}

// ── Splitting into parts ────────────────────────────────────────────────────

export interface Chunk {
  /** The heading this part sits under ("" when none) */
  heading: string
  text: string
  /** Page number for PDFs (1-based), when known */
  page?: number
}

const splitSentences = (text: string) => text.match(/[^.!?।\n]+[.!?।]*\s*/g) || [text]

/**
 * Long text split into parts of about `size` characters (never more than 1.5×), on paragraph and then sentence
 * boundaries, each keeping its heading, with about `overlap` characters of the previous part repeated so an
 * answer that sits across two parts is still found.
 */
export function chunkText(text: string, opts: { size?: number; overlap?: number; page?: number } = {}): Chunk[] {
  const size = Math.max(300, opts.size ?? 1100)
  const overlap = Math.min(Math.floor(size / 3), Math.max(0, opts.overlap ?? 150))
  const max = Math.floor(size * 1.5)
  const chunks: Chunk[] = []
  let heading = ''
  let buffer = ''
  let bufferHeading = ''
  const push = () => {
    const t = buffer.trim()
    if (t.replace(/\s/g, '').length >= 8) chunks.push({ heading: bufferHeading, text: t, ...(opts.page ? { page: opts.page } : {}) })
    buffer = ''
  }
  const pieces: string[] = []
  for (const para of String(text || '').replace(/\r/g, '').split(/\n\s*\n/)) {
    const p = para.trim()
    if (!p) continue
    if (p.length <= max) { pieces.push(p); continue }
    // A very long paragraph: by sentences, then hard cuts
    let part = ''
    for (const s of splitSentences(p)) {
      if ((part + s).length > size && part) { pieces.push(part.trim()); part = '' }
      if (s.length > max) { for (let i = 0; i < s.length; i += size) pieces.push(s.slice(i, i + size).trim()) }
      else part += s
    }
    if (part.trim()) pieces.push(part.trim())
  }
  for (const piece of pieces) {
    const head = piece.match(/^#{1,6}\s+(.{1,150})$/)
    if (head) {
      // A new heading starts a new part
      if (buffer.trim()) push()
      heading = head[1].trim()
      bufferHeading = heading
      continue
    }
    if (buffer && (buffer + '\n\n' + piece).length > size) {
      const tail = overlap ? buffer.slice(-overlap).replace(/^\S*\s/, '') : ''
      push()
      buffer = tail ? `${tail}\n\n` : ''
    }
    if (!buffer.trim()) bufferHeading = heading
    buffer += (buffer && !buffer.endsWith('\n\n') ? '\n\n' : '') + piece
  }
  push()
  return chunks
}

/** The words a part is searched by: the source's name and the heading go with it. */
export function chunkTitle(sourceTitle: string, chunk: Chunk): string {
  const parts = [sourceTitle.trim() || 'Document', chunk.heading, chunk.page ? `page ${chunk.page}` : ''].filter(Boolean)
  return parts.join(' — ').slice(0, 300)
}

// ── Files and links an FAQ carries ──────────────────────────────────────────

export type MediaType = 'image' | 'video' | 'document' | 'link'

export interface KnowledgeMedia {
  type: MediaType
  url: string
  /** File name or link words */
  name?: string
}

export const MAX_MEDIA = 5

export const MEDIA_LABELS: Record<MediaType, string> = { image: 'Photo', video: 'Video', document: 'File', link: 'Link' }

/** What kind of attachment a file is, from its ending; null = not one WhatsApp can send. */
export function mediaTypeOf(name: string): Exclude<MediaType, 'link'> | null {
  const e = fileEnding(name)
  if (['jpg', 'jpeg', 'png', 'webp'].includes(e)) return 'image'
  if (['mp4', '3gp'].includes(e)) return 'video'
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv'].includes(e)) return 'document'
  return null
}

/** WhatsApp's size limits per kind (bytes). */
export const MEDIA_MAX_BYTES: Record<Exclude<MediaType, 'link'>, number> = { image: 5 * 1024 * 1024, video: 16 * 1024 * 1024, document: 100 * 1024 * 1024 }

/** An FAQ's attachments as typed: https only, known kinds, at most 5, no repeats. */
export function cleanMedia(raw: unknown): KnowledgeMedia[] {
  const list = Array.isArray(raw) ? raw : []
  const out: KnowledgeMedia[] = []
  for (const item of list) {
    const type = (['image', 'video', 'document', 'link'] as const).find((t) => t === item?.type)
    const url = String(item?.url || '').trim()
    if (!type || !/^https:\/\/[^\s]{4,1000}$/i.test(url)) continue
    try { new URL(url) } catch { continue }
    if (out.some((m) => m.url === url)) continue
    const name = String(item?.name || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    out.push({ type, url, ...(name ? { name } : {}) })
    if (out.length >= MAX_MEDIA) break
  }
  return out
}

// ── Web addresses that may be read ──────────────────────────────────────────

/** A private, local or reserved IP address (never read: it could reach our own servers). */
export function isPrivateAddress(ip: string): boolean {
  const a = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (/^\d+\.\d+\.\d+\.\d+$/.test(a)) {
    const [p, q] = a.split('.').map(Number)
    return p === 10 || p === 127 || p === 0 || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 100 && q >= 64 && q <= 127) || p >= 224
  }
  if (a.includes(':')) {
    if (a === '::1' || a === '::') return true
    if (a.startsWith('::ffff:')) return isPrivateAddress(a.slice(7))
    return /^(fc|fd|fe8|fe9|fea|feb)/.test(a)
  }
  return false
}

/** The website address as typed, ready to read; or what is wrong with it. */
export function cleanWebsiteUrl(raw: unknown): { url: string } | { error: string } {
  let text = String(raw || '').trim()
  if (!text) return { error: 'Type the website address, like www.yourshop.com.' }
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`
  let u: URL
  try { u = new URL(text) } catch { return { error: 'That does not look like a website address.' } }
  if (!/^https?:$/.test(u.protocol)) return { error: 'Only http and https addresses can be read.' }
  if (u.username || u.password) return { error: 'Remove the name and password from the address.' }
  const host = u.hostname.toLowerCase()
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || isPrivateAddress(host)) {
    return { error: 'That address cannot be read. Use your public website address.' }
  }
  u.hash = ''
  return { url: u.toString() }
}
