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
import { IG_FIELDS, IG_GRAPH, checkCaption, dmBody, feedItem, igContactKey, messageText, replyWindow, type IgComment, type IgIncomingMessage } from './rules'

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
export const INSTAGRAM_LOCK = 724519031
export const instagramSchemaSetup = createAutoSetup('Instagram', (connectionString) => runMigrationSql(connectionString, INSTAGRAM_SQL, INSTAGRAM_LOCK))
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
  return { igUserId: row.ig_user_id, username: row.username, name: row.name, picture: row.picture_url, subscribed: row.subscribed === true, connectedAt: row.connected_at, lastError: row.last_error || null, tokenExpiresAt: row.token_expires_at || null }
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

/** A token Meta no longer accepts (expired, removed): the screen asks to connect again. */
async function noteError(db: any, account: any, error: any) {
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

/** A DM from the webhook (or an echo of one the business sent from the Instagram app). Saved once. */
export async function saveIncomingDm(db: any, account: any, m: IgIncomingMessage, fetcher: Fetcher = fetch) {
  const sid = `IG_${m.mid}`
  const { data: dup } = await db.from('messages').select('id').eq('organization_id', account.organization_id).eq('twilio_message_sid', sid).limit(1)
  if (dup?.length) return null
  const contact = await igContact(db, account, m.senderId, fetcher)
  const conversation = await igConversation(db, account.organization_id, contact.id)
  const at = new Date(m.timestamp).toISOString()
  const image = m.attachments.find((a) => a.type === 'image' && /^https:\/\//.test(a.url))
  const { data: saved, error } = await db.from('messages').insert({
    organization_id: account.organization_id, conversation_id: conversation.id, sender_type: m.echo ? 'user' : 'contact', sender_id: null,
    body: messageText(m), media_url: image?.url || null, twilio_message_sid: sid, status: m.echo ? 'sent' : null, created_at: at,
  }).select('*').single()
  if (error) throw new Error(error.message)
  await db.from('conversations').update({ last_message_at: at, ...(m.echo ? {} : { unread_count: (Number(conversation.unread_count) || 0) + 1 }), updated_at: new Date().toISOString() }).eq('id', conversation.id)
  return { message: saved, conversation, contact }
}

/** When this customer last wrote (for Instagram's reply window). */
export async function lastCustomerMessageAt(db: any, conversationId: string): Promise<string | null> {
  const { data } = await db.from('messages').select('created_at').eq('conversation_id', conversationId).eq('sender_type', 'contact').order('created_at', { ascending: false }).limit(1)
  return data?.[0]?.created_at || null
}

/**
 * Send a reply in an Instagram chat (from the inbox, the app, or the AI). Inside 24 hours a normal
 * message; up to 7 days with the Human Agent tag when a person answers; never after.
 */
export async function sendDm(db: any, organizationId: string, conversation: any, input: { text?: string; imageUrl?: string; byPerson: boolean }, fetcher: Fetcher = fetch): Promise<{ ok: true; mid: string } | { ok: false; error: string }> {
  const account = await accountFor(db, organizationId)
  if (!account) return { ok: false, error: 'Instagram is not connected. Connect it in Settings → Instagram.' }
  const { data: contact } = await db.from('contacts').select('instagram_id').eq('id', conversation.contact_id).maybeSingle()
  if (!contact?.instagram_id) return { ok: false, error: 'This chat has no Instagram customer.' }
  const window = replyWindow(await lastCustomerMessageAt(db, conversation.id))
  if (!window.ok) return { ok: false, error: window.reason }
  if (window.humanAgent && !input.byPerson) return { ok: false, error: 'More than 24 hours since the customer wrote: only a person can reply now.' }
  const body = dmBody(contact.instagram_id, { text: input.text, imageUrl: input.imageUrl, humanAgent: window.humanAgent })
  if ('error' in body) return { ok: false, error: String(body.error) }
  try {
    const sent = await igCall(account.access_token, `/${account.ig_user_id}/messages`, { method: 'POST', body }, fetcher)
    return { ok: true, mid: String(sent?.message_id || '') }
  } catch (error: any) {
    await noteError(db, account, error)
    return { ok: false, error: `Instagram did not send it: ${error?.message || 'please try again'}` }
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
