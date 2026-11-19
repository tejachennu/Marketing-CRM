import { after, NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { getAiAccess } from '@/lib/ai-access'
import { SOURCE_FILES, cleanWebsiteUrl, fileEnding } from '@/lib/ai/knowledge-text'
import { KNOWLEDGE_BUCKET, ingestSource, withSourcesSchema, type SourceRow } from '@/lib/ai/knowledge-sources'

export const runtime = 'nodejs'
// Reading a whole website or a long PDF takes a while (it runs after the answer is sent)
export const maxDuration = 300

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_SOURCES = 100
const FIELDS = 'id, kind, title, url, file_name, options, status, error, chunk_count, page_count, char_count, created_at, updated_at, read_at'

/** The source read after the answer goes back (the screen checks its status). */
function readLater(organizationId: string, source: SourceRow) {
  after(async () => {
    const db = getSupabaseAdminClient()
    const { data: org } = await db.from('organizations').select('*').eq('id', organizationId).maybeSingle()
    const ai = await getAiAccess(db, organizationId, org)
    await ingestSource(db, ai.allowed ? ai : null, source)
  })
}

const view = (row: any) => {
  if (!row) return row
  const { options, ...rest } = row
  return { ...rest, wholeSite: options?.wholeSite === true }
}

// GET ?organizationId=: every source and how it was read. &id=…&parts=1: the first parts of one source.
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const organizationId = params.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const db = getSupabaseAdminClient()
  const id = params.get('id')
  if (id && UUID.test(id) && params.get('parts') === '1') {
    const { data } = await db.from('knowledge_base').select('id, title, content, source_url, chunk_index').eq('organization_id', organizationId).eq('source_id', id).order('chunk_index').limit(50)
    return NextResponse.json({ parts: data || [] })
  }
  const { data, error } = await withSourcesSchema(() => db.from('knowledge_sources').select(FIELDS).eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(MAX_SOURCES))
  if (error) return NextResponse.json({ sources: [], setupNeeded: true })
  return NextResponse.json({ sources: (data || []).map(view) })
}

/**
 * POST { organizationId, kind: 'website', url, wholeSite }
 *      { organizationId, kind: 'file', path, fileName, title? }   (uploaded through /api/knowledge/upload-url)
 *      { organizationId, kind: 'text', title, text }
 *      { organizationId, action: 'refresh', id }                  (read it again)
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const organizationId = body?.organizationId
  const access = await verifyOrgAccess(request, organizationId, { permission: 'automation.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const db = getSupabaseAdminClient()

  if (body?.action === 'refresh') {
    if (!UUID.test(String(body?.id || ''))) return NextResponse.json({ error: 'Choose a source.' }, { status: 400 })
    const { data: row } = await db.from('knowledge_sources').select('*').eq('id', body.id).eq('organization_id', organizationId).maybeSingle()
    if (!row) return NextResponse.json({ error: 'That source is not there any more.' }, { status: 404 })
    if (row.status === 'processing' && Date.now() - Date.parse(row.updated_at) < 5 * 60_000) return NextResponse.json({ error: 'It is being read now. Wait a minute.' }, { status: 409 })
    await db.from('knowledge_sources').update({ status: 'processing', error: null, updated_at: new Date().toISOString() }).eq('id', row.id)
    readLater(organizationId, row)
    return NextResponse.json({ source: view({ ...row, status: 'processing', error: null }) })
  }

  const { count } = await withSourcesSchema(() => db.from('knowledge_sources').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId))
  if ((count || 0) >= MAX_SOURCES) return NextResponse.json({ error: `You can keep up to ${MAX_SOURCES} sources. Delete ones you no longer need.` }, { status: 400 })

  let row: Record<string, any>
  if (body?.kind === 'website') {
    const checked = cleanWebsiteUrl(body?.url)
    if ('error' in checked) return NextResponse.json({ error: checked.error, field: 'url' }, { status: 400 })
    const wholeSite = body?.wholeSite === true
    row = { kind: 'website', title: new URL(checked.url).host.replace(/^www\./, '') + (wholeSite ? '' : new URL(checked.url).pathname.replace(/\/$/, '')), url: checked.url, options: { wholeSite } }
  } else if (body?.kind === 'file') {
    const path = String(body?.path || '')
    const fileName = String(body?.fileName || '').slice(-120)
    const info = SOURCE_FILES[fileEnding(fileName)]
    if (!path.startsWith(`knowledge/${organizationId}/sources/`) || path.includes('..') || !info) return NextResponse.json({ error: 'Upload the file again.' }, { status: 400 })
    const title = String(body?.title || '').replace(/\s+/g, ' ').trim().slice(0, 120) || fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Document'
    row = { kind: info.kind, title, file_path: path, file_name: fileName, url: db.storage.from(KNOWLEDGE_BUCKET).getPublicUrl(path).data.publicUrl }
  } else if (body?.kind === 'text') {
    const title = String(body?.title || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    const text = String(body?.text || '').trim()
    if (!title) return NextResponse.json({ error: 'Give the text a name, like "Return policy".', field: 'title' }, { status: 400 })
    if (text.length < 20) return NextResponse.json({ error: 'Paste or type the text.', field: 'text' }, { status: 400 })
    if (text.length > 200_000) return NextResponse.json({ error: 'That is too long to paste. Upload it as a file.', field: 'text' }, { status: 400 })
    row = { kind: 'text', title, options: { text } }
  } else {
    return NextResponse.json({ error: 'Choose what to add.' }, { status: 400 })
  }

  const { data: saved, error } = await withSourcesSchema(() => db.from('knowledge_sources').insert({ ...row, organization_id: organizationId, status: 'processing', created_by: access.user?.id || null }).select('*').single())
  if (error || !saved) return NextResponse.json({ error: 'It could not be added. Try again.' }, { status: 500 })
  readLater(organizationId, saved)
  return NextResponse.json({ source: view(saved) })
}

// DELETE ?organizationId=&id=: the source, its parts and its uploaded file
export async function DELETE(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const organizationId = params.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId, { permission: 'automation.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const id = String(params.get('id') || '')
  if (!UUID.test(id)) return NextResponse.json({ error: 'Choose a source.' }, { status: 400 })
  const db = getSupabaseAdminClient()
  const { data: row } = await db.from('knowledge_sources').select('id, file_path').eq('id', id).eq('organization_id', organizationId).maybeSingle()
  if (!row) return NextResponse.json({ error: 'That source is not there any more.' }, { status: 404 })
  await db.from('knowledge_base').delete().eq('source_id', id).eq('organization_id', organizationId)
  const { error } = await db.from('knowledge_sources').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'It could not be deleted. Try again.' }, { status: 500 })
  if (row.file_path) await db.storage.from(KNOWLEDGE_BUCKET).remove([row.file_path]).catch(() => null)
  return NextResponse.json({ success: true })
}
