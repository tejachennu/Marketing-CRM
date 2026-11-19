/**
 * Knowledge from many kinds of sources: a website (one page or the whole site), PDFs, Word and text files, and
 * pasted text. Each source is read, split into parts (knowledge-text.ts `chunkText`), and every part is saved in
 * `knowledge_base` (kind "part", `source_id`) with its search vector, so the same knowledge search finds FAQs and
 * parts alike. Reading again replaces the parts; deleting the source deletes them. Server only.
 */

import { lookup } from 'node:dns/promises'
import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'
import { aiFetch, type AiAccess } from '../ai-access'
import {
  MAX_CHUNKS_PER_SOURCE, MAX_PAGES, MAX_SOURCE_BYTES, chunkText, chunkTitle, cleanWebsiteUrl, fileEnding, htmlToText,
  isPrivateAddress, readRobots, robotsAllow, sameSiteLinks, sitemapLinks, type Chunk,
} from './knowledge-text'
import { knowledgeSchemaSetup } from './knowledge-store'

/** supabase/migrations/20261207_knowledge_sources.sql word for word. */
export const SOURCES_SQL = `-- Knowledge from many kinds of sources (websites, PDFs, Word and text files, pasted text), split into parts the
-- AI searches, and the photos, videos, files and links an FAQ carries (sent with the answer).
-- Safe to run more than once. The app runs it on its own when first needed.
CREATE TABLE IF NOT EXISTS knowledge_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  file_path TEXT,
  file_name TEXT,
  options JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'processing',
  error TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  page_count INTEGER NOT NULL DEFAULT 0,
  char_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_org ON knowledge_sources(organization_id, created_at DESC);
ALTER TABLE knowledge_sources ENABLE ROW LEVEL SECURITY;

-- kind: faq (typed by the business) or part (a piece of a source; deleted with it)
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES knowledge_sources(id) ON DELETE CASCADE;
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'faq';
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS chunk_index INTEGER;
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS media JSONB;
CREATE INDEX IF NOT EXISTS idx_knowledge_base_source ON knowledge_base(source_id);
-- The word search's own expressions, so long documents stay fast
CREATE INDEX IF NOT EXISTS idx_knowledge_base_words_simple ON knowledge_base USING gin (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, '')));
CREATE INDEX IF NOT EXISTS idx_knowledge_base_words_english ON knowledge_base USING gin (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, '')));

-- Search vectors for many parts in one call: items = [{"id": "...", "e": "[0.1, ...]"}]
CREATE OR REPLACE FUNCTION set_knowledge_embeddings(org_id UUID, items JSONB)
RETURNS INTEGER
LANGUAGE plpgsql SET search_path = public, extensions AS $f$
DECLARE n INTEGER;
BEGIN
  UPDATE knowledge_base kb SET embedding = (x->>'e')::vector
  FROM jsonb_array_elements(items) x
  WHERE kb.id = (x->>'id')::UUID AND kb.organization_id = org_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $f$;
REVOKE ALL ON FUNCTION set_knowledge_embeddings(UUID, JSONB) FROM PUBLIC;
DO $$ BEGIN GRANT EXECUTE ON FUNCTION set_knowledge_embeddings(UUID, JSONB) TO service_role; EXCEPTION WHEN others THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';
`

export const SOURCES_LOCK = 724519033
export const sourcesSchemaSetup = createAutoSetup('Knowledge sources', async (connectionString) => {
  // The search functions come first (they are in the earlier set-up)
  await knowledgeSchemaSetup.ensure().catch(() => false)
  await runMigrationSql(connectionString, SOURCES_SQL, SOURCES_LOCK)
})
const SOURCES_SCHEMA = /knowledge_sources|source_id|chunk_index|set_knowledge_embeddings|'media'|"media"|column knowledge_base\.(media|kind)/

export function isMissingSourcesSchema(error: any): boolean {
  if (!error) return false
  return String(error.code || '') === 'PGRST202' || isMissingSchemaError(error, SOURCES_SCHEMA)
}

export async function withSourcesSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = sourcesSchemaSetup): Promise<any> {
  const first = await step()
  if (!isMissingSourcesSchema(first.error)) return first
  if (!(await setup.ensure())) return first
  let result = await step()
  for (let attempt = 1; attempt < 4 && isMissingSourcesSchema(result.error); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
    result = await step()
  }
  return result
}

export const KNOWLEDGE_BUCKET = 'media-attachments'

// ── Reading the web safely ──────────────────────────────────────────────────

const USER_AGENT = 'Mozilla/5.0 (compatible; WAMA-CRM-KnowledgeReader/1.0; +https://wamacrm.magnetora.in)'

/** Does this host lead only to public addresses? (A website must never reach our own or a private network.) */
export type Resolver = (hostname: string) => Promise<{ address: string }[]>

async function publicHost(hostname: string, resolve: Resolver = (h) => lookup(h, { all: true })): Promise<boolean> {
  if (isPrivateAddress(hostname)) return false
  try {
    const addresses = await resolve(hostname)
    return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a.address))
  } catch {
    return false
  }
}

export interface Fetched { url: string; type: string; body: Buffer }

/** A web address read with the checks: public address at every redirect, time and size limits. */
export async function fetchPublic(rawUrl: string, opts: { maxBytes?: number; timeoutMs?: number; fetcher?: typeof fetch; resolve?: Resolver } = {}): Promise<Fetched> {
  const fetcher = opts.fetcher || fetch
  const maxBytes = opts.maxBytes ?? 3 * 1024 * 1024
  let url = rawUrl
  for (let hop = 0; hop < 5; hop++) {
    const checked = cleanWebsiteUrl(url)
    if ('error' in checked) throw new Error(checked.error)
    const u = new URL(checked.url)
    if (!(await publicHost(u.hostname, opts.resolve))) throw new Error('That website could not be found, or it is not a public website.')
    const res = await fetcher(checked.url, { redirect: 'manual', headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5' }, signal: AbortSignal.timeout(opts.timeoutMs ?? 15000) })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, checked.url).toString()
      continue
    }
    if (!res.ok) throw new Error(`The website answered ${res.status}.`)
    const length = Number(res.headers.get('content-length') || 0)
    if (length > maxBytes) throw new Error('That page is too big to read.')
    const reader = res.body?.getReader()
    const parts: Uint8Array[] = []
    let size = 0
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > maxBytes) { await reader.cancel().catch(() => {}); throw new Error('That page is too big to read.') }
        parts.push(value)
      }
    }
    return { url: checked.url, type: String(res.headers.get('content-type') || '').toLowerCase(), body: Buffer.concat(parts) }
  }
  throw new Error('That address sends us round in circles (too many redirects).')
}

export interface ReadPage { url: string; title: string; text: string }

/**
 * A website's pages: only the page given, or the whole site (up to 25 pages) through its sitemap and links,
 * keeping out of what robots.txt closes. Stops after about two minutes.
 */
export async function readWebsite(startUrl: string, wholeSite: boolean, deps: { fetcher?: typeof fetch; resolve?: Resolver; now?: () => number } = {}): Promise<ReadPage[]> {
  const now = deps.now || Date.now
  const net = { fetcher: deps.fetcher, resolve: deps.resolve }
  const start = new URL(startUrl)
  const origin = start.origin
  const deadline = now() + 120_000
  let disallow: string[] = []
  const queue: string[] = [start.toString()]
  if (wholeSite) {
    let sitemaps: string[] = [`${origin}/sitemap.xml`]
    try {
      const robots = await fetchPublic(`${origin}/robots.txt`, { maxBytes: 200_000, timeoutMs: 8000, ...net })
      const rules = readRobots(robots.body.toString('utf8'))
      disallow = rules.disallow
      if (rules.sitemaps.length) sitemaps = rules.sitemaps.slice(0, 3)
    } catch {}
    for (let i = 0; i < sitemaps.length && i < 5 && queue.length < MAX_PAGES * 2; i++) {
      try {
        const map = await fetchPublic(sitemaps[i], { maxBytes: 5_000_000, timeoutMs: 10000, ...net })
        const found = sitemapLinks(map.body.toString('utf8'))
        sitemaps.push(...found.sitemaps.slice(0, 3))
        for (const page of sameSiteLinks(found.pages, startUrl)) if (!queue.includes(page)) queue.push(page)
      } catch {}
    }
  }
  const pages: ReadPage[] = []
  const seen = new Set<string>()
  while (queue.length && pages.length < (wholeSite ? MAX_PAGES : 1) && now() < deadline) {
    const next = queue.shift()!
    if (seen.has(next)) continue
    seen.add(next)
    if (wholeSite && !robotsAllow(next, disallow)) continue
    try {
      const got = await fetchPublic(next, net)
      if (!/html|text\/plain/.test(got.type) && got.type) continue
      const html = got.body.toString('utf8')
      const page = /html/.test(got.type) || /<html|<body/i.test(html) ? htmlToText(html, got.url) : { title: '', text: html, links: [] }
      if (page.text.replace(/\s/g, '').length >= 40) pages.push({ url: got.url, title: page.title, text: page.text })
      if (wholeSite) for (const link of sameSiteLinks(page.links, startUrl)) if (!seen.has(link) && !queue.includes(link)) queue.push(link)
    } catch (error) {
      // The first page must open; others are skipped
      if (!pages.length && next === start.toString()) throw error
    }
  }
  return pages
}

// ── Reading files ───────────────────────────────────────────────────────────

/** The text of an uploaded file, page by page for PDFs. */
export async function readFileText(body: Buffer, fileName: string): Promise<{ pages: { text: string; page?: number }[]; pageCount: number }> {
  const ending = fileEnding(fileName)
  if (ending === 'pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(body))
    const { totalPages, text } = await extractText(pdf, { mergePages: false })
    const list = (Array.isArray(text) ? text : [text]).map((t, i) => ({ text: String(t || '').replace(/[ \t]+\n/g, '\n').trim(), page: i + 1 }))
    return { pages: list, pageCount: totalPages }
  }
  if (ending === 'docx') {
    const mammoth: any = await import('mammoth')
    const { value } = await (mammoth.convertToHtml || mammoth.default.convertToHtml)({ buffer: body })
    return { pages: [{ text: htmlToText(`<body>${value}</body>`, 'https://file.local/').text }], pageCount: 1 }
  }
  if (['txt', 'md', 'csv'].includes(ending)) {
    return { pages: [{ text: body.toString('utf8') }], pageCount: 1 }
  }
  throw new Error('This kind of file cannot be read. Use PDF, Word (.docx), .txt, .md or .csv.')
}

// ── Saving the parts ────────────────────────────────────────────────────────

export interface SourceRow {
  id: string
  organization_id: string
  kind: 'website' | 'pdf' | 'document' | 'text'
  title: string
  url?: string | null
  file_path?: string | null
  file_name?: string | null
  options?: any
}

export interface PartToSave { title: string; content: string; url?: string | null }

/** Search vectors for many texts at once (in groups of 64). null = the AI could not be reached. */
async function embedMany(db: any, ai: AiAccess, texts: string[]): Promise<(number[] | null)[]> {
  const out: (number[] | null)[] = []
  for (let i = 0; i < texts.length; i += 64) {
    const group = texts.slice(i, i + 64).map((t) => t.slice(0, 8000))
    try {
      const res = await aiFetch(db, ai, 'knowledge', 'https://api.openai.com/v1/embeddings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: group }),
        signal: AbortSignal.timeout(60000),
      })
      if (!res.ok) { out.push(...group.map(() => null)); continue }
      const data = await res.json()
      const rows: any[] = Array.isArray(data?.data) ? data.data : []
      for (let j = 0; j < group.length; j++) out.push(rows.find((r) => r.index === j)?.embedding || null)
    } catch {
      out.push(...group.map(() => null))
    }
  }
  return out
}

/** Replace a source's parts: new parts in, their search vectors set, the old parts out. */
export async function saveParts(db: any, ai: AiAccess | null, source: SourceRow, parts: PartToSave[]): Promise<{ saved: number; withVectors: number }> {
  const { data: old } = await db.from('knowledge_base').select('id').eq('source_id', source.id)
  const ids: string[] = []
  for (let i = 0; i < parts.length; i += 100) {
    const rows = parts.slice(i, i + 100).map((p, j) => ({ organization_id: source.organization_id, title: p.title, content: p.content, source_url: p.url || null, source_id: source.id, kind: 'part', chunk_index: i + j }))
    const { data, error } = await withSourcesSchema(() => db.from('knowledge_base').insert(rows).select('id'))
    if (error) throw new Error('The parts could not be saved. Try again.')
    ids.push(...(data || []).map((r: any) => r.id))
  }
  let withVectors = 0
  if (ai && ai.allowed !== false && ids.length) {
    const vectors = await embedMany(db, ai, parts.map((p) => `${p.title}\n${p.content}`))
    const items = ids.map((id, i) => (vectors[i] ? { id, e: `[${vectors[i]!.join(',')}]` } : null)).filter(Boolean)
    for (let i = 0; i < items.length; i += 40) {
      const { data, error } = await db.rpc('set_knowledge_embeddings', { org_id: source.organization_id, items: items.slice(i, i + 40) })
      if (!error) withVectors += Number(data) || 0
    }
  }
  const oldIds = (old || []).map((r: any) => r.id).filter((id: string) => !ids.includes(id))
  for (let i = 0; i < oldIds.length; i += 100) await db.from('knowledge_base').delete().in('id', oldIds.slice(i, i + 100))
  return { saved: ids.length, withVectors }
}

/** Parts from read pages: each page split on its own, titled with the page (or source) and heading. */
export function partsFrom(sourceTitle: string, pages: { text: string; page?: number; title?: string; url?: string }[]): PartToSave[] {
  const parts: PartToSave[] = []
  for (const p of pages) {
    const chunks: Chunk[] = chunkText(p.text, { page: p.page })
    for (const c of chunks) {
      parts.push({ title: chunkTitle(p.title || sourceTitle, c), content: c.text, url: p.url || null })
      if (parts.length >= MAX_CHUNKS_PER_SOURCE) return parts
    }
  }
  return parts
}

const SCANNED = 'No text was found. If this is a scanned PDF (photos of pages), it has no words to read: use a PDF with text, or type the answers as FAQs.'

/**
 * Read a source and save its parts; the source row says how it went (ready / failed and why). Never throws.
 * `deps` lets tests read without the internet or storage.
 */
export async function ingestSource(
  db: any,
  ai: AiAccess | null,
  source: SourceRow,
  deps: { fetcher?: typeof fetch; resolve?: Resolver; download?: (path: string) => Promise<Buffer>; text?: string } = {},
): Promise<{ ok: boolean; error?: string; parts?: number }> {
  const finish = async (fields: Record<string, any>) => {
    await db.from('knowledge_sources').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', source.id)
  }
  try {
    let pages: { text: string; page?: number; title?: string; url?: string }[] = []
    let pageCount = 0
    if (source.kind === 'website') {
      const read = await readWebsite(String(source.url), source.options?.wholeSite === true, { fetcher: deps.fetcher, resolve: deps.resolve })
      pages = read.map((p) => ({ text: p.text, title: p.title || source.title, url: p.url }))
      pageCount = read.length
    } else if (source.kind === 'text') {
      const text = deps.text ?? String(source.options?.text || '')
      pages = [{ text }]
      pageCount = 1
    } else {
      const download = deps.download || (async (path: string) => {
        const { data, error } = await db.storage.from(KNOWLEDGE_BUCKET).download(path)
        if (error || !data) throw new Error('The file could not be opened. Upload it again.')
        return Buffer.from(await data.arrayBuffer())
      })
      const body = await download(String(source.file_path))
      if (body.length > MAX_SOURCE_BYTES) throw new Error('The file is bigger than 25 MB.')
      const read = await readFileText(body, String(source.file_name || source.file_path))
      pages = read.pages
      pageCount = read.pageCount
    }
    const chars = pages.reduce((n, p) => n + p.text.replace(/\s/g, '').length, 0)
    if (chars < 20) throw new Error(source.kind === 'website' ? 'No words were found on that website. If it is built only with pictures or needs a log-in, type the answers as FAQs.' : source.kind === 'text' ? 'Type some text first.' : SCANNED)
    const parts = partsFrom(source.title, pages)
    const saved = await saveParts(db, ai, source, parts)
    await finish({ status: 'ready', error: saved.withVectors < saved.saved && ai ? 'Some parts are found by words only (the AI could not be reached). Read it again later.' : null, chunk_count: saved.saved, page_count: pageCount, char_count: chars, read_at: new Date().toISOString() })
    return { ok: true, parts: saved.saved }
  } catch (error: any) {
    const message = String(error?.message || 'It could not be read.').slice(0, 300)
    await finish({ status: 'failed', error: message }).catch(() => {})
    return { ok: false, error: message }
  }
}
