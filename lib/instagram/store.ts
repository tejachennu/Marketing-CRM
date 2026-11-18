/**
 * Instagram in the database and the calls to Meta (rules in rules.ts). Server only.
 *
 * - One connected Instagram professional account per workspace (`instagram_accounts`), with the Business
 *   Integration System User token from Unified Login. Tokens never leave the server.
 * - DMs land in the normal inbox: an Instagram contact (`contacts.instagram_id`, phone column "ig:<id>"),
 *   a conversation with `channel = 'instagram'`, messages with the Instagram message id.
 * - Comments are kept in `instagram_comments` for the Comments screen (reply, private reply, hide, delete).
 * - The latest posts are cached on the account for the store page (30 minutes).
 */

import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'
import { createHash } from 'node:crypto'
import { IG_FIELDS, IG_GRAPH, OLDEST_MS, PER_SYNC, SEND_TYPES, SLOW_DOWN_MS, apiAttachments, fileExtension, checkCaption, dmBodies, extensionForType, feedItem, igSendError, keepableKind, sendKind, igContactKey, isRateLimit, messageText, readIgAutomation, readSyncState, replyWindow, syncAllowed, type IgAutomation, type IgComment, type IgIncomingMessage, type IgMediaKind, type IgSyncState } from './rules'

/** supabase/migrations/20261204_instagram.sql word for word. */
export const INSTAGRAM_SQL = `-- Instagram (DMs in the inbox, comments, feed, posting). Safe to run more than once. The app runs it on its own when first needed.
CREATE TABLE IF NOT EXISTS instagram_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  ig_user_id TEXT NOT NULL UNIQUE,
  username TEXT,
  name TEXT,
  picture_url TEXT,
  access_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  client_business_id TEXT,
  subscribed BOOLEAN NOT NULL DEFAULT FALSE,
  feed JSONB NOT NULL DEFAULT '[]'::jsonb,
  feed_at TIMESTAMPTZ,
  last_error TEXT,
  connected_by UUID,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE instagram_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS instagram_id TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS instagram_username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_instagram ON contacts(organization_id, instagram_id) WHERE instagram_id IS NOT NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp';
CREATE TABLE IF NOT EXISTS instagram_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  comment_id TEXT NOT NULL UNIQUE,
  parent_id TEXT,
  media_id TEXT,
  media_type TEXT,
  from_id TEXT,
  from_username TEXT,
  text TEXT,
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  reply_text TEXT,
  replied_at TIMESTAMPTZ,
  private_reply_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_instagram_comments_org ON instagram_comments(organization_id, created_at DESC);
ALTER TABLE instagram_comments ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
`
/** supabase/migrations/20261205_instagram_automation.sql word for word. */
export const INSTAGRAM_AUTOMATION_SQL = `-- Instagram: keeping in step without webhooks, and automatic replies. Safe to run more than once.
ALTER TABLE instagram_accounts ADD COLUMN IF NOT EXISTS sync_state JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE instagram_accounts ADD COLUMN IF NOT EXISTS automation JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE instagram_comments ADD COLUMN IF NOT EXISTS auto_replied BOOLEAN NOT NULL DEFAULT FALSE;
NOTIFY pgrst, 'reload schema';
`
export const INSTAGRAM_LOCK = 724519031
export const instagramSchemaSetup = createAutoSetup('Instagram', (connectionString) => runMigrationSql(connectionString, INSTAGRAM_SQL + INSTAGRAM_AUTOMATION_SQL, INSTAGRAM_LOCK))
const IG_SCHEMA = /instagram_|channel/

export async function withInstagramSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = instagramSchemaSetup): Promise<any> {
  const first = await step()
  if (!isMissingSchemaError(first.error, IG_SCHEMA)) return first
  if (!(await setup.ensure())) return first
  let result = await step()
  for (let attempt = 1; attempt < 4 && isMissingSchemaError(result.error, IG_SCHEMA); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
    result = await step()
  }
  return result
}

type Fetcher = typeof fetch

/** One Graph API call with the account's token. Throws the Meta error message (code kept on the error). */
export async function igCall(token: string, path: string, init: { method?: string; query?: Record<string, string>; body?: unknown } = {}, fetcher: Fetcher = fetch): Promise<any> {
  const url = new URL(path.startsWith('http') ? path : `${IG_GRAPH}${path}`)
  for (const [k, v] of Object.entries(init.query || {})) url.searchParams.set(k, v)
  const res = await fetcher(url.toString(), {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(20000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.error) {
    const e = data?.error || {}
    throw Object.assign(new Error(e.error_user_msg || e.message || `Instagram answered ${res.status}`), { code: e.code, subcode: e.error_subcode, status: res.status })
  }
  return data
}

/** Account rows without the token, for screens. */
export function publicAccount(row: any) {
  if (!row) return null
  const wait = Date.parse(readSyncState(row.sync_state).waitUntil || '')
  return {
    igUserId: row.ig_user_id, username: row.username, name: row.name, picture: row.picture_url, subscribed: row.subscribed === true, connectedAt: row.connected_at,
    lastError: row.last_error || null, tokenExpiresAt: row.token_expires_at || null,
    slowDownMinutes: wait > Date.now() ? Math.ceil((wait - Date.now()) / 60_000) : 0,
  }
}

export async function accountFor(db: any, organizationId: string) {
  const { data, error } = await withInstagramSchema(() => db.from('instagram_accounts').select('*').eq('organization_id', organizationId).maybeSingle())
  if (error && !isMissingSchemaError(error, IG_SCHEMA)) throw new Error(error.message)
  return data || null
}

export async function accountByIgId(db: any, igUserId: string) {
  const { data } = await withInstagramSchema(() => db.from('instagram_accounts').select('*').eq('ig_user_id', igUserId).maybeSingle())
  return data || null
}

/**
 * Finish Unified Login: the code from the login window → the business's token → its Instagram account →
 * saved for this workspace and subscribed to webhooks. One Instagram account belongs to one workspace.
 */
export async function connectInstagram(db: any, organizationId: string, input: { code: string; redirectUri?: string; userId?: string | null }, fetcher: Fetcher = fetch) {
  const appId = String(process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID || '').trim()
  const secret = String(process.env.META_APP_SECRET || '').trim()
  if (!appId || !secret) return { error: 'Instagram is not set up on this server yet (META_APP_ID / META_APP_SECRET).' }
  const tokenUrl = new URL(`${IG_GRAPH}/oauth/access_token`)
  tokenUrl.searchParams.set('client_id', appId)
  tokenUrl.searchParams.set('client_secret', secret)
  tokenUrl.searchParams.set('code', input.code)
  if (input.redirectUri) tokenUrl.searchParams.set('redirect_uri', input.redirectUri)
  const res = await fetcher(tokenUrl.toString(), { signal: AbortSignal.timeout(20000) })
  const tokenData = await res.json().catch(() => ({}))
  if (!res.ok || !tokenData?.access_token) return { error: tokenData?.error?.message ? `Meta did not finish the login: ${tokenData.error.message}` : 'Meta did not finish the login. Please try again.' }
  const token = String(tokenData.access_token)
  const expiresAt = Number(tokenData.expires_in) > 0 ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString() : null

  const me = await igCall(token, '/me', { query: { fields: 'client_business_id' } }, fetcher).catch(() => ({}))
  const assigned = await igCall(token, '/me/assigned_instagram_accounts', { query: { fields: 'id,username' } }, fetcher)
  const ig = (assigned?.data || [])[0]
  if (!ig?.id) return { error: 'No Instagram account was shared. Log in again and pick your Instagram professional account.' }
  const profile = await igCall(token, `/${ig.id}`, { query: { fields: 'id,username,name,profile_picture_url' } }, fetcher).catch(() => ig)

  const taken = await accountByIgId(db, String(ig.id))
  if (taken && taken.organization_id !== organizationId) return { error: `@${ig.username || 'This account'} is already connected to another WAMA CRM workspace. Disconnect it there first.` }

  const row = {
    organization_id: organizationId, ig_user_id: String(ig.id), username: profile.username || ig.username || null, name: profile.name || null,
    picture_url: /^https:\/\//.test(String(profile.profile_picture_url || '')) ? profile.profile_picture_url : null,
    access_token: token, token_expires_at: expiresAt, client_business_id: me?.client_business_id || null, subscribed: false,
    last_error: null, connected_by: input.userId || null, connected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }
  const { data: saved, error } = await withInstagramSchema(() => db.from('instagram_accounts').upsert(row, { onConflict: 'organization_id' }).select('*').single())
  if (error) throw new Error(error.message)
  const subscribed = await subscribeWebhooks(db, saved, fetcher)
  return { account: publicAccount({ ...saved, subscribed }) }
}

/** Ask Meta to send this account's DMs and comments to our webhook. */
export async function subscribeWebhooks(db: any, account: any, fetcher: Fetcher = fetch): Promise<boolean> {
  try {
    await igCall(account.access_token, `/${account.ig_user_id}/subscribed_apps`, { method: 'POST', query: { subscribed_fields: IG_FIELDS.join(',') } }, fetcher)
    await db.from('instagram_accounts').update({ subscribed: true, last_error: null, updated_at: new Date().toISOString() }).eq('id', account.id)
    return true
  } catch (error: any) {
    await db.from('instagram_accounts').update({ subscribed: false, last_error: `Webhooks: ${error?.message || 'not subscribed'}`, updated_at: new Date().toISOString() }).eq('id', account.id)
    return false
  }
}

export async function disconnectInstagram(db: any, organizationId: string, fetcher: Fetcher = fetch) {
  const account = await accountFor(db, organizationId)
  if (!account) return
  await igCall(account.access_token, `/${account.ig_user_id}/subscribed_apps`, { method: 'DELETE' }, fetcher).catch(() => null)
  await db.from('instagram_accounts').delete().eq('id', account.id)
}

/** Save how far we have read from Instagram (the column is made on first use). */
async function saveSyncState(db: any, account: any, patch: Partial<IgSyncState>) {
  const next = { ...readSyncState(account.sync_state), ...patch }
  account.sync_state = next
  await withInstagramSchema(() => db.from('instagram_accounts').update({ sync_state: next }).eq('id', account.id))
  return next
}

/**
 * A token Meta no longer accepts (expired, removed): the screen asks to connect again. Meta saying "too
 * many calls" is not an error to show forever: we pause asking for 15 minutes instead.
 */
async function noteError(db: any, account: any, error: any, now: number = Date.now()) {
  if (isRateLimit(error)) {
    await saveSyncState(db, account, { waitUntil: new Date(now + SLOW_DOWN_MS).toISOString() }).catch(() => null)
    if (/request limit|rate limit|too many/i.test(String(account.last_error || ''))) await db.from('instagram_accounts').update({ last_error: null }).eq('id', account.id)
    return
  }
  const expired = Number(error?.code) === 190
  await db.from('instagram_accounts').update({ last_error: expired ? 'Instagram needs connecting again (the login has expired or was removed).' : String(error?.message || 'Instagram error').slice(0, 300), updated_at: new Date().toISOString() }).eq('id', account.id)
}

// ── DMs ──────────────────────────────────────────────────────────────────────

/** The Instagram customer as a contact (made the first time; name and username from Instagram when allowed). */
export async function igContact(db: any, account: any, igsid: string, fetcher: Fetcher = fetch) {
  const { data: found } = await withInstagramSchema(() => db.from('contacts').select('*').eq('organization_id', account.organization_id).eq('instagram_id', igsid).maybeSingle())
  if (found) return found
  const profile = await igCall(account.access_token, `/${igsid}`, { query: { fields: 'name,username' } }, fetcher).catch(() => ({}))
  const [first, ...rest] = String(profile?.name || profile?.username || 'Instagram user').split(' ')
  const { data: made, error } = await db.from('contacts').insert({
    organization_id: account.organization_id, phone_number: igContactKey(igsid), instagram_id: igsid, instagram_username: profile?.username || null,
    first_name: first, last_name: rest.join(' ') || null, tags: ['instagram'],
  }).select('*').single()
  if (!error) return made
  // Made at the same moment by another delivery
  const { data: again } = await db.from('contacts').select('*').eq('organization_id', account.organization_id).eq('instagram_id', igsid).maybeSingle()
  if (again) return again
  throw new Error(error.message)
}

export async function igConversation(db: any, organizationId: string, contactId: string) {
  const { data: found } = await withInstagramSchema(() => db.from('conversations').select('*').eq('organization_id', organizationId).eq('contact_id', contactId).eq('channel', 'instagram').order('last_message_at', { ascending: false }).limit(1))
  if (found?.[0]) return found[0]
  const { data: made, error } = await db.from('conversations').insert({ organization_id: organizationId, contact_id: contactId, channel: 'instagram', is_active: true, unread_count: 0 }).select('*').single()
  if (error) throw new Error(error.message)
  return made
}

const MEDIA_BUCKET = 'media-attachments'
const MAX_FILE = 25 * 1024 * 1024
/** The inbox hides this word when a message has a file and no text (same as WhatsApp). */
export const MEDIA_PLACEHOLDER = '[Media Attachment]'

/**
 * Keep our own copy of a file a customer sent: Instagram's links expire after a while. Saved in the
 * public media bucket under instagram/<workspace>/; if that fails, Instagram's link with "#media.<ext>"
 * so the inbox still knows how to show it.
 */
export async function keepIgMedia(db: any, organizationId: string, url: string, kind: IgMediaKind, key: string, fetcher: Fetcher = fetch): Promise<string> {
  let ext = extensionForType('', kind)
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) return `${url}#media.${ext}`
    const type = res.headers.get('content-type') || ''
    ext = extensionForType(type, kind)
    if (Number(res.headers.get('content-length')) > MAX_FILE || !db.storage) return `${url}#media.${ext}`
    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.length > MAX_FILE) return `${url}#media.${ext}`
    const path = `instagram/${organizationId}/${createHash('sha1').update(key).digest('hex').slice(0, 24)}.${ext}`
    const { error } = await db.storage.from(MEDIA_BUCKET).upload(path, buffer, { contentType: type || undefined, upsert: true })
    if (error) return `${url}#media.${ext}`
    return db.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl
  } catch {
    return `${url}#media.${ext}`
  }
}

/** A DM from the webhook (or an echo of one the business sent from the Instagram app). Saved once. */
export async function saveIncomingDm(db: any, account: any, m: IgIncomingMessage, fetcher: Fetcher = fetch, options: { countUnread?: boolean } = {}) {
  const sid = `IG_${m.mid}`
  const { data: dup } = await db.from('messages').select('id').eq('organization_id', account.organization_id).eq('twilio_message_sid', sid).limit(1)
  if (dup?.length) return null
  const contact = await igContact(db, account, m.senderId, fetcher)
  const conversation = await igConversation(db, account.organization_id, contact.id)
  const at = new Date(m.timestamp).toISOString()
  // Photos, GIFs, stickers, videos, voice notes and files: our own copy. Shared posts, reels and stories: the label and their link.
  const file = m.attachments.find((a) => keepableKind(a.type) && /^https:\/\//.test(a.url))
  const mediaUrl = file ? await keepIgMedia(db, account.organization_id, file.url, keepableKind(file.type)!, sid, fetcher) : null
  const link = !file ? m.attachments.find((a) => /^https:\/\//.test(a.url))?.url : undefined
  const body = m.text || (mediaUrl ? MEDIA_PLACEHOLDER : [messageText(m), link].filter(Boolean).join('\n'))
  const { data: saved, error } = await db.from('messages').insert({
    organization_id: account.organization_id, conversation_id: conversation.id, sender_type: m.echo ? 'user' : 'contact', sender_id: null,
    body, media_url: mediaUrl, twilio_message_sid: sid, status: m.echo ? 'sent' : null, created_at: at,
  }).select('*').single()
  if (error) throw new Error(error.message)
  const later = !conversation.last_message_at || Date.parse(conversation.last_message_at) <= Date.parse(at)
  await db.from('conversations').update({
    ...(later ? { last_message_at: at } : {}),
    ...(m.echo || options.countUnread === false ? {} : { unread_count: (Number(conversation.unread_count) || 0) + 1 }),
    updated_at: new Date().toISOString(),
  }).eq('id', conversation.id)
  return { message: saved, conversation, contact }
}

/** When this customer last wrote (for Instagram's reply window). */
export async function lastCustomerMessageAt(db: any, conversationId: string): Promise<string | null> {
  const { data } = await db.from('messages').select('created_at').eq('conversation_id', conversationId).eq('sender_type', 'contact').order('created_at', { ascending: false }).limit(1)
  return data?.[0]?.created_at || null
}

/** A photo Instagram will not take (WebP, GIF, HEIC…) as a JPEG copy in our media bucket. */
async function jpegCopy(db: any, organizationId: string, url: string, fetcher: Fetcher): Promise<string | { error: string }> {
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) return { error: 'The photo could not be read. Please attach it again.' }
    const sharp = (await import('sharp')).default
    const jpeg = await sharp(Buffer.from(await res.arrayBuffer())).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
    if (jpeg.length > 8 * 1024 * 1024) return { error: 'This photo is too big for Instagram (8 MB). Please send a smaller one.' }
    const path = `instagram/${organizationId}/out-${createHash('sha1').update(url).digest('hex').slice(0, 24)}.jpg`
    const { error } = await db.storage.from(MEDIA_BUCKET).upload(path, jpeg, { contentType: 'image/jpeg', upsert: true })
    if (error) return { error: 'The photo could not be prepared for Instagram. Please send it as a JPEG or PNG.' }
    return db.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl
  } catch {
    return { error: 'This photo type could not be turned into a JPEG. Please send it as a JPEG or PNG.' }
  }
}

/**
 * A file served without its real type (some browsers upload .m4a as "application/octet-stream"): Instagram
 * refuses those, so a copy with the right type goes instead. Files already served right are sent as they are.
 */
async function typedFile(db: any, organizationId: string, url: string, fetcher: Fetcher): Promise<string | { error: string }> {
  const want = SEND_TYPES[fileExtension(url)]
  if (!want) return url
  try {
    const head = await fetcher(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) })
    const served = (head.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (head.ok && served && served !== 'application/octet-stream' && served !== 'binary/octet-stream') return url
    if (!db.storage) return url
    const res = await fetcher(url, { signal: AbortSignal.timeout(30000) })
    if (!res.ok) return { error: 'The file could not be read. Please attach it again.' }
    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.length > MAX_FILE) return { error: 'This file is too big for Instagram (25 MB).' }
    const path = `instagram/${organizationId}/out-${createHash('sha1').update(url).digest('hex').slice(0, 24)}.${fileExtension(url)}`
    const { error } = await db.storage.from(MEDIA_BUCKET).upload(path, buffer, { contentType: want, upsert: true })
    if (error) return url
    return db.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl
  } catch {
    return url
  }
}

/**
 * Send a reply in an Instagram chat (from the inbox, the app, or the AI): words, a photo, video, audio or
 * PDF (other photo types become JPEG). A file and its words go as two Instagram messages. Inside 24 hours
 * a normal message; up to 7 days with the Human Agent tag when a person answers; never after.
 */
export async function sendDm(db: any, organizationId: string, conversation: any, input: { text?: string; mediaUrl?: string; imageUrl?: string; byPerson: boolean }, fetcher: Fetcher = fetch): Promise<{ ok: true; mid: string; mids: string[]; mediaUrl?: string } | { ok: false; error: string; mids?: string[] }> {
  const account = await accountFor(db, organizationId)
  if (!account) return { ok: false, error: 'Instagram is not connected. Connect it in Settings → Instagram.' }
  const { data: contact } = await db.from('contacts').select('instagram_id').eq('id', conversation.contact_id).maybeSingle()
  if (!contact?.instagram_id) return { ok: false, error: 'This chat has no Instagram customer.' }
  const window = replyWindow(await lastCustomerMessageAt(db, conversation.id))
  if (!window.ok) return { ok: false, error: window.reason }
  if (window.humanAgent && !input.byPerson) return { ok: false, error: 'More than 24 hours since the customer wrote: only a person can reply now.' }

  let media: { url: string; kind: IgMediaKind } | undefined
  const fileUrl = input.mediaUrl || input.imageUrl
  if (fileUrl) {
    const how = sendKind(fileUrl)
    if ('error' in how) return { ok: false, error: how.error }
    if ('convert' in how) {
      const copy = await jpegCopy(db, organizationId, fileUrl, fetcher)
      if (typeof copy !== 'string') return { ok: false, error: copy.error }
      media = { url: copy, kind: 'image' }
    } else {
      const ready = await typedFile(db, organizationId, fileUrl, fetcher)
      if (typeof ready !== 'string') return { ok: false, error: ready.error }
      media = { url: ready, kind: how.kind }
    }
  }
  const bodies = dmBodies(contact.instagram_id, { text: input.text, media, humanAgent: window.humanAgent })
  if ('error' in bodies) return { ok: false, error: bodies.error }
  // One Instagram message id per part (file, then words), so each part is saved once and never fetched again
  const mids: string[] = []
  try {
    for (const [i, body] of bodies.entries()) {
      try {
        const sent = await igCall(account.access_token, `/${account.ig_user_id}/messages`, { method: 'POST', body }, fetcher)
        mids.push(String(sent?.message_id || ''))
      } catch (error: any) {
        // The file went but the words did not: say so, the customer already has the file
        if (i > 0) throw Object.assign(new Error(`The file was sent, but the words were not: ${error?.message || 'please send them again'}`), { code: error?.code })
        throw error
      }
    }
    return { ok: true, mid: mids[mids.length - 1] || '', mids, ...(media ? { mediaUrl: media.url } : {}) }
  } catch (error: any) {
    await noteError(db, account, error)
    if (isRateLimit(error)) return { ok: false, error: 'Instagram is busy (too many requests just now). Please send it again in a few minutes.', mids }
    return { ok: false, error: `Instagram did not send it: ${igSendError(error?.message || 'please try again')}`, mids }
  }
}

// ── Comments ─────────────────────────────────────────────────────────────────

export async function saveComment(db: any, account: any, c: IgComment) {
  // The business's own replies come back as comments too: they are kept as replies, not as new comments
  if (c.fromId && c.fromId === account.ig_user_id) return null
  const { data, error } = await withInstagramSchema(() => db.from('instagram_comments').upsert({
    organization_id: account.organization_id, comment_id: c.commentId, parent_id: c.parentId, media_id: c.mediaId || null, media_type: c.mediaType || null,
    from_id: c.fromId || null, from_username: c.fromUsername || null, text: c.text, created_at: new Date(c.timestamp).toISOString(),
  }, { onConflict: 'comment_id', ignoreDuplicates: true }).select('*'))
  if (error) throw new Error(error.message)
  return data?.[0] || null
}

export async function listComments(db: any, organizationId: string, filter: 'open' | 'all' = 'open', limit = 100) {
  let q = db.from('instagram_comments').select('*').eq('organization_id', organizationId).is('deleted_at', null).order('created_at', { ascending: false }).limit(limit)
  if (filter === 'open') q = q.is('replied_at', null).is('private_reply_at', null)
  const { data, error } = await withInstagramSchema(() => q)
  return error ? [] : data || []
}

/** Reply in public, reply in a DM (once per comment, within 7 days), hide / show, or delete a comment. */
export async function actOnComment(db: any, organizationId: string, commentId: string, action: { type: 'reply' | 'private'; text: string } | { type: 'hide' | 'unhide' | 'delete' }, fetcher: Fetcher = fetch) {
  const account = await accountFor(db, organizationId)
  if (!account) return { error: 'Instagram is not connected.' }
  const { data: row } = await db.from('instagram_comments').select('*').eq('organization_id', organizationId).eq('comment_id', commentId).maybeSingle()
  if (!row) return { error: 'That comment is not here any more.' }
  const now = new Date().toISOString()
  try {
    if (action.type === 'reply' || action.type === 'private') {
      const text = String(action.text || '').trim()
      if (!text) return { error: 'Type the reply.' }
      if (text.length > 1000) return { error: 'Keep the reply under 1,000 characters.' }
      if (action.type === 'reply') {
        await igCall(account.access_token, `/${commentId}/replies`, { method: 'POST', query: { message: text } }, fetcher)
        await db.from('instagram_comments').update({ reply_text: text, replied_at: now }).eq('id', row.id)
      } else {
        if (row.private_reply_at) return { error: 'Instagram allows one private reply per comment, and it was already sent.' }
        if (Date.now() - Date.parse(row.created_at) > 7 * 86_400_000) return { error: 'Private replies are allowed only within 7 days of the comment.' }
        await igCall(account.access_token, `/${account.ig_user_id}/messages`, { method: 'POST', body: { recipient: { comment_id: commentId }, message: { text } } }, fetcher)
        await db.from('instagram_comments').update({ reply_text: text, private_reply_at: now }).eq('id', row.id)
      }
    } else if (action.type === 'hide' || action.type === 'unhide') {
      await igCall(account.access_token, `/${commentId}`, { method: 'POST', query: { hide: action.type === 'hide' ? 'true' : 'false' } }, fetcher)
      await db.from('instagram_comments').update({ hidden: action.type === 'hide' }).eq('id', row.id)
    } else {
      await igCall(account.access_token, `/${commentId}`, { method: 'DELETE' }, fetcher)
      await db.from('instagram_comments').update({ deleted_at: now }).eq('id', row.id)
    }
    return { ok: true }
  } catch (error: any) {
    await noteError(db, account, error)
    if (isRateLimit(error)) return { error: 'Instagram is busy (too many requests just now). Please try again in a few minutes.' }
    return { error: `Instagram did not do it: ${error?.message || 'please try again'}` }
  }
}

// ── Feed and posting ─────────────────────────────────────────────────────────

/** The latest posts (cached 30 minutes; the store page and the dashboard use this). */
export async function latestPosts(db: any, organizationId: string, options: { fresh?: boolean; now?: number } = {}, fetcher: Fetcher = fetch) {
  const account = await accountFor(db, organizationId)
  if (!account) return { posts: [], connected: false }
  const now = options.now ?? Date.now()
  if (!options.fresh && account.feed_at && now - Date.parse(account.feed_at) < 30 * 60_000) return { posts: account.feed || [], connected: true }
  try {
    const data = await igCall(account.access_token, `/${account.ig_user_id}/media`, { query: { fields: 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,children{media_url,media_type}', limit: '12' } }, fetcher)
    const posts = (data?.data || []).map(feedItem).filter(Boolean)
    await db.from('instagram_accounts').update({ feed: posts, feed_at: new Date(now).toISOString() }).eq('id', account.id)
    return { posts, connected: true }
  } catch (error: any) {
    await noteError(db, account, error)
    return { posts: account.feed || [], connected: true, error: error?.message }
  }
}

/**
 * Post photos on Instagram: one photo, or 2–10 as a carousel. Containers are made, checked until ready
 * (a few seconds; Instagram fetches the photos), then published.
 */
export async function publishPost(db: any, organizationId: string, input: { images: string[]; caption: string }, fetcher: Fetcher = fetch, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const account = await accountFor(db, organizationId)
  if (!account) return { error: 'Instagram is not connected.' }
  const images = [...new Set(input.images.filter((u) => /^https:\/\//.test(u)))].slice(0, 10)
  if (!images.length) return { error: 'Add at least one photo (a web link, JPEG works best).' }
  const caption = checkCaption(input.caption)
  if ('error' in caption) return { error: caption.error }
  const id = account.ig_user_id
  try {
    let container: string
    if (images.length === 1) {
      container = String((await igCall(account.access_token, `/${id}/media`, { method: 'POST', query: { image_url: images[0], caption: caption.caption } }, fetcher)).id)
    } else {
      const children: string[] = []
      for (const url of images) children.push(String((await igCall(account.access_token, `/${id}/media`, { method: 'POST', query: { image_url: url, is_carousel_item: 'true' } }, fetcher)).id))
      container = String((await igCall(account.access_token, `/${id}/media`, { method: 'POST', query: { media_type: 'CAROUSEL', children: children.join(','), caption: caption.caption } }, fetcher)).id)
    }
    for (let i = 0; i < 12; i++) {
      const status = await igCall(account.access_token, `/${container}`, { query: { fields: 'status_code,status' } }, fetcher)
      if (status?.status_code === 'FINISHED') break
      if (status?.status_code === 'ERROR' || status?.status_code === 'EXPIRED') return { error: `Instagram could not use the photo: ${status?.status || 'try a JPEG between 4:5 and 1.91:1'}` }
      await wait(2500)
    }
    const published = await igCall(account.access_token, `/${id}/media_publish`, { method: 'POST', query: { creation_id: container } }, fetcher)
    await db.from('instagram_accounts').update({ feed_at: null }).eq('id', account.id)
    return { ok: true, mediaId: String(published?.id || '') }
  } catch (error: any) {
    await noteError(db, account, error)
    if (Number(error?.subcode) === 2207042) return { error: 'You have reached Instagram\'s posts-per-day limit. Try again tomorrow.' }
    return { error: `Instagram did not post it: ${error?.message || 'please try again'}` }
  }
}

// ── Pulling from Instagram (works before webhooks do) ────────────────────────
// Instagram sends comment webhooks only to a Live app with Advanced Access (after App Review), so the
// screens also read comments and DMs straight from the API. Meta allows an app only a few hundred calls an
// hour, so we ask at most once a minute, open only threads and posts that changed (a few per visit), skip
// anything older than 7 days, and pause 15 minutes when Meta says "too many". Both paths save the same
// rows, once.

const isOwn = (account: any, id: unknown) => String(id || '') === String(account.ig_user_id)
const isDmsOff = (error: any) => Number(error?.code) === 200 && /messaging|direct/i.test(String(error?.message || ''))
type Pulled<T> = { added: number; fresh: T[]; skipped?: boolean; waitMinutes?: number; messagesOff?: boolean; error?: string }

/** New comments on posts whose comment count changed → `instagram_comments`; own replies mark them answered. */
export async function syncComments(db: any, organizationId: string, fetcher: Fetcher = fetch, now: number = Date.now()): Promise<Pulled<any>> {
  const account = await accountFor(db, organizationId)
  if (!account) return { added: 0, fresh: [] }
  const state = readSyncState(account.sync_state)
  const allowed = syncAllowed(state, 'comments', now)
  if (!allowed.ok) return { added: 0, fresh: [], skipped: true, waitMinutes: allowed.waitMinutes }
  await saveSyncState(db, account, { commentsAt: new Date(now).toISOString() })
  const counts = { ...(state.media || {}) }
  const fresh: any[] = []
  let added = 0
  try {
    const media = await igCall(account.access_token, `/${account.ig_user_id}/media`, { query: { fields: 'id,media_product_type,comments_count', limit: '20' } }, fetcher)
    const changed = (media?.data || []).filter((m: any) => Number(m?.comments_count) > 0 && counts[m.id] !== Number(m.comments_count)).slice(0, PER_SYNC)
    for (const m of changed) {
      const page = await igCall(account.access_token, `/${m.id}/comments`, { query: { fields: 'id,text,timestamp,from,username,replies{id,text,timestamp,from,username}', limit: '50' } }, fetcher)
      for (const c of page?.data || []) {
        const comment = (x: any, parentId: string | null): IgComment => ({
          kind: 'comment', accountId: account.ig_user_id, commentId: String(x.id), parentId, text: String(x.text || '').slice(0, 2200),
          fromId: String(x.from?.id || ''), fromUsername: String(x.from?.username || x.username || ''), mediaId: String(m.id), mediaType: String(m.media_product_type || ''),
          timestamp: Date.parse(x.timestamp) || now,
        })
        const ownReply = (c.replies?.data || []).find((r: any) => isOwn(account, r.from?.id))
        if (!isOwn(account, c.from?.id)) {
          const saved = await saveComment(db, account, comment(c, null))
          if (saved) added++
          if (saved && !ownReply) fresh.push(saved)
        }
        if (ownReply) {
          // Answered (here or in the Instagram app): keep the first reply on the comment
          await db.from('instagram_comments').update({ reply_text: String(ownReply.text || '').slice(0, 1000), replied_at: new Date(Date.parse(ownReply.timestamp) || now).toISOString() })
            .eq('organization_id', organizationId).eq('comment_id', String(c.id)).is('replied_at', null)
        }
        for (const r of c.replies?.data || []) {
          if (isOwn(account, r.from?.id)) continue
          const saved = await saveComment(db, account, comment(r, String(c.id)))
          if (saved) { added++; fresh.push(saved) }
        }
      }
      counts[m.id] = Number(m.comments_count)
    }
    await saveSyncState(db, account, { media: counts })
    if (account.last_error) await db.from('instagram_accounts').update({ last_error: null }).eq('id', account.id)
    return { added, fresh }
  } catch (error: any) {
    await saveSyncState(db, account, { media: counts }).catch(() => null)
    await noteError(db, account, error, now)
    if (isRateLimit(error)) return { added, fresh, waitMinutes: SLOW_DOWN_MS / 60_000 }
    return { added, fresh, error: error?.message || 'Instagram did not answer' }
  }
}

// Read 18 Nov 2026 against the live API: "sticker" is not a field (asking for it fails the whole call)
const RICH_FIELDS = 'messages.limit(20){id,created_time,from,to,message,is_unsupported,attachments{image_data,video_data,audio_data,file_url,mime_type,name},shares,story}'
const PLAIN_FIELDS = 'messages.limit(20){id,created_time,from,to,message,attachments{image_data}}'

/** Changed DM threads → the inbox (Instagram contact, chat, messages). Needs "Allow access to messages" in the Instagram app. */
export async function syncDms(db: any, organizationId: string, fetcher: Fetcher = fetch, now: number = Date.now()): Promise<Pulled<{ conversation: any; contact: any; message: any; text: string }>> {
  const account = await accountFor(db, organizationId)
  if (!account) return { added: 0, fresh: [] }
  const state = readSyncState(account.sync_state)
  const allowed = syncAllowed(state, 'dms', now)
  if (!allowed.ok) return { added: 0, fresh: [], skipped: true, waitMinutes: allowed.waitMinutes }
  await saveSyncState(db, account, { dmsAt: new Date(now).toISOString() })
  const seen = { ...(state.threads || {}) }
  const fresh: { conversation: any; contact: any; message: any; text: string }[] = []
  let added = 0
  try {
    const threads = await igCall(account.access_token, `/${account.ig_user_id}/conversations`, { query: { platform: 'instagram', fields: 'id,updated_time,participants', limit: '20' } }, fetcher)
    const changed: any[] = []
    for (const t of threads?.data || []) {
      if (!t?.id || seen[t.id] === t.updated_time) continue
      // Old threads nobody can answer any more are noted, never opened
      if (!seen[t.id] && now - (Date.parse(t.updated_time) || 0) > OLDEST_MS) { seen[t.id] = t.updated_time; continue }
      changed.push(t)
    }
    for (const t of changed.slice(0, PER_SYNC)) {
      const thread = await igCall(account.access_token, `/${t.id}`, { query: { fields: RICH_FIELDS } }, fetcher)
        .catch((e) => (Number(e?.code) === 100 ? igCall(account.access_token, `/${t.id}`, { query: { fields: PLAIN_FIELDS } }, fetcher) : Promise.reject(e)))
      const messages = [...(thread?.messages?.data || [])].reverse() // oldest first
      for (const x of messages) {
        const at = Date.parse(x.created_time) || now
        if (now - at > OLDEST_MS) continue
        const echo = isOwn(account, x.from?.id)
        const senderId = String(echo ? x.to?.data?.[0]?.id || '' : x.from?.id || '')
        if (!senderId || !x.id) continue
        const text = String(x.message || '').slice(0, 4000)
        const saved = await saveIncomingDm(db, account, {
          kind: 'message', accountId: account.ig_user_id, senderId, mid: String(x.id), text,
          attachments: apiAttachments(x), timestamp: at, echo, replyTo: null, unsupported: x.is_unsupported === true,
        }, fetcher, { countUnread: now - at < 86_400_000 })
        if (!saved) continue
        added++
        if (!echo) fresh.push({ ...saved, text })
        else for (let i = fresh.length - 1; i >= 0; i--) if (fresh[i].conversation.id === saved.conversation.id) fresh.splice(i, 1) // answered already
      }
      seen[t.id] = t.updated_time
    }
    await saveSyncState(db, account, { threads: seen })
    await fillUsernames(db, account, threads?.data || [])
    if (account.last_error) await db.from('instagram_accounts').update({ last_error: null }).eq('id', account.id)
    return { added, fresh }
  } catch (error: any) {
    await saveSyncState(db, account, { threads: seen }).catch(() => null)
    if (isDmsOff(error)) return { added, fresh, messagesOff: true }
    await noteError(db, account, error, now)
    if (isRateLimit(error)) return { added, fresh, waitMinutes: SLOW_DOWN_MS / 60_000 }
    return { added, fresh, error: error?.message || 'Instagram did not answer' }
  }
}

/**
 * The thread list carries each person's @username: chats saved as "Instagram user" (Instagram did not share
 * the name, or was busy) get it, at no extra call.
 */
async function fillUsernames(db: any, account: any, threads: any[]) {
  const people = new Map<string, string>()
  for (const t of threads) for (const p of t?.participants?.data || []) if (p?.id && p?.username && !isOwn(account, p.id)) people.set(String(p.id), String(p.username))
  if (!people.size) return
  const { data: contacts } = await db.from('contacts').select('id, instagram_id, instagram_username, first_name, last_name').eq('organization_id', account.organization_id).in('instagram_id', [...people.keys()])
  for (const c of contacts || []) {
    const given = people.get(String(c.instagram_id))
    if (!given) continue
    // Instagram names a removed account "__deleted__…": shown as such, never as a username
    const deleted = given.startsWith('__deleted__')
    const username = deleted ? null : given
    const name = deleted ? 'Deleted account' : given
    const unnamed = !c.first_name || (c.first_name === 'Instagram' && c.last_name === 'user') || String(c.first_name).startsWith('__deleted__')
    if (c.instagram_username === username && !unnamed) continue
    await db.from('contacts').update({ instagram_username: username, ...(unnamed ? { first_name: name, last_name: null } : {}) }).eq('id', c.id)
  }
}

/** Automatic-reply settings for the screen and the webhook. */
export function automationOf(account: any): IgAutomation {
  return readIgAutomation(account?.automation)
}

export async function saveAutomation(db: any, organizationId: string, automation: IgAutomation) {
  const account = await accountFor(db, organizationId)
  if (!account) return { error: 'Instagram is not connected.' }
  const { error } = await withInstagramSchema(() => db.from('instagram_accounts').update({ automation, updated_at: new Date().toISOString() }).eq('id', account.id))
  return error ? { error: error.message } : { ok: true }
}

/** Instagram chats for the Messages tab: who, last message, unread. */
export async function listIgChats(db: any, organizationId: string, options: { onlyAssignedTo?: string | null; limit?: number } = {}) {
  const limit = options.limit || 50
  const { data, error } = await withInstagramSchema(() => {
    let q = db.from('conversations')
      .select('id, contact_id, last_message_at, unread_count, auto_reply_enabled')
      .eq('organization_id', organizationId).eq('channel', 'instagram')
    if (options.onlyAssignedTo) q = q.eq('assigned_to', options.onlyAssignedTo)
    return q.order('last_message_at', { ascending: false, nullsFirst: false }).limit(limit)
  })
  if (error || !data?.length) return []
  const ids = data.map((c: any) => c.id)
  const { data: people } = await db.from('contacts').select('id, first_name, last_name, instagram_username').in('id', [...new Set(data.map((c: any) => c.contact_id))])
  const contactBy = new Map<string, any>((people || []).map((p: any) => [p.id, p]))
  const { data: last } = await db.from('messages').select('conversation_id, body, sender_type, created_at').in('conversation_id', ids).order('created_at', { ascending: false }).limit(ids.length * 5)
  const lastBy = new Map<string, any>()
  for (const m of last || []) if (!lastBy.has(m.conversation_id)) lastBy.set(m.conversation_id, m)
  return data.map((c: any) => {
    const m = lastBy.get(c.id)
    c = { ...c, contact: contactBy.get(c.contact_id) }
    const name = [c.contact?.first_name, c.contact?.last_name].filter(Boolean).join(' ')
    return { id: c.id, name: name || `@${c.contact?.instagram_username || 'instagram'}`, username: c.contact?.instagram_username || null, unread: Number(c.unread_count) || 0, at: c.last_message_at || m?.created_at || null, last: m ? `${m.sender_type === 'contact' ? '' : 'You: '}${m.body || ''}` : '', ai: c.auto_reply_enabled !== false }
  })
}

/**
 * What still blocks DMs and comments, in the owner's words: the Meta app has no Instagram webhook address,
 * or the Instagram app does not allow access to messages. Unknown checks are left out, never guessed.
 */
export async function instagramChecks(db: any, organizationId: string, fetcher: Fetcher = fetch): Promise<{ webhook: boolean | null; messages: boolean | null }> {
  const account = await accountFor(db, organizationId)
  if (!account) return { webhook: null, messages: null }
  const appId = String(process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID || '').trim()
  const secret = String(process.env.META_APP_SECRET || '').trim()
  const webhook = appId && secret
    ? await igCall(`${appId}|${secret}`, `/${appId}/subscriptions`, {}, fetcher).then((d) => (d?.data || []).some((s: any) => s?.object === 'instagram' && s?.active !== false)).catch(() => null)
    : null
  const messages = await igCall(account.access_token, `/${account.ig_user_id}/conversations`, { query: { platform: 'instagram', fields: 'id', limit: '1' } }, fetcher).then(() => true).catch((e) => (isDmsOff(e) ? false : null))
  return { webhook, messages }
}
