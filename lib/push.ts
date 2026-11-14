/**
 * Pop-up notifications on phones through Firebase Cloud Messaging (FCM, HTTP v1).
 *
 * The app registers its phone (POST /api/mobile/devices); the server sends a notification when a
 * customer writes, a booking request or an order comes in, or a ticket is assigned. Android shows it
 * even when the app is closed. Nothing here ever fails the action that caused it: a notification that
 * cannot be sent is logged and dropped.
 *
 * Settings (Vercel only): FIREBASE_SERVICE_ACCOUNT (the service account JSON, for sending) and, for the
 * app, FIREBASE_PROJECT_ID, FIREBASE_ANDROID_APP_ID, FIREBASE_API_KEY, FIREBASE_SENDER_ID.
 */

import { createSign } from 'node:crypto'
import { createAutoSetup, isMissingSchemaError, runMigrationSql } from './schema-setup'

/** supabase/migrations/20261113_push_devices.sql word for word. */
export const PUSH_SQL = `-- Phones that get pop-up notifications (Firebase Cloud Messaging): one row per phone a person is
-- signed in on. Safe to run more than once. The app runs it on its own when first needed.
CREATE TABLE IF NOT EXISTS device_tokens (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- android | ios
  platform TEXT NOT NULL DEFAULT 'android',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_org ON device_tokens (organization_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens (user_id);
ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;
-- No policies: only the server (service role) reads and writes it.

NOTIFY pgrst, 'reload schema';
`

export const PUSH_LOCK = 724519014

export const pushSchemaSetup = createAutoSetup('Notifications', (connectionString) => runMigrationSql(connectionString, PUSH_SQL, PUSH_LOCK))

/** Run a database step; if the phones table is missing, set it up and try again. */
export async function withPushSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = pushSchemaSetup): Promise<any> {
  const first = await step()
  if (!isMissingSchemaError(first.error, /device_tokens/)) return first
  if (!(await setup.ensure())) return first
  let result = await step()
  for (let attempt = 1; attempt < 4 && isMissingSchemaError(result.error, /device_tokens/); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
    result = await step()
  }
  return result
}

/** What the app needs to receive notifications (public values, like the ones inside every Android app). */
export function firebaseAppConfig(env: Record<string, string | undefined> = process.env) {
  const value = (name: string) => String(env[name] || '').trim()
  const config = { projectId: value('FIREBASE_PROJECT_ID'), appId: value('FIREBASE_ANDROID_APP_ID'), apiKey: value('FIREBASE_API_KEY'), senderId: value('FIREBASE_SENDER_ID'), iosAppId: value('FIREBASE_IOS_APP_ID') || null }
  return config.projectId && config.appId && config.apiKey && config.senderId ? config : null
}

interface ServiceAccount { client_email: string; private_key: string; project_id: string }

/** The service account from FIREBASE_SERVICE_ACCOUNT (JSON, or base64 of it), or null when not set or not valid. */
export function serviceAccount(env: Record<string, string | undefined> = process.env): ServiceAccount | null {
  const raw = String(env.FIREBASE_SERVICE_ACCOUNT || '').trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'))
    if (!parsed.client_email || !parsed.private_key || !parsed.project_id) return null
    return { client_email: parsed.client_email, private_key: String(parsed.private_key).replace(/\\n/g, '\n'), project_id: parsed.project_id }
  } catch {
    return null
  }
}

const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64url')

/** The signed request Google swaps for an access token. */
export function signedAssertion(account: ServiceAccount, now = Date.now()): string {
  const seconds = Math.floor(now / 1000)
  const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64(JSON.stringify({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: seconds, exp: seconds + 3600 }))
  const signature = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(account.private_key)
  return `${head}.${claims}.${b64(signature)}`
}

let cached: { token: string; until: number; email: string } | null = null

async function accessToken(account: ServiceAccount, fetcher: typeof fetch): Promise<string> {
  if (cached && cached.email === account.client_email && cached.until > Date.now() + 60_000) return cached.token
  const response = await fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signedAssertion(account) }).toString(),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || `Google returned HTTP ${response.status}`)
  cached = { token: data.access_token, until: Date.now() + (Number(data.expires_in) || 3600) * 1000, email: account.client_email }
  return cached.token
}

/** Test seam: forget the access token. */
export function resetPushToken() {
  cached = null
}

export type PushKind = 'message' | 'booking' | 'order' | 'ticket' | 'deal' | 'review'

export interface PushNotice {
  kind: PushKind
  title: string
  body: string
  /** What the app opens when tapped: 'chat:<conversation id>', 'bookings', 'orders', 'tickets', 'deals' or 'reviews' */
  open: string
  /** Notifications with the same tag replace each other (one per chat, not one per message) */
  tag?: string
}

const CHANNELS: Record<PushKind, string> = { message: 'messages', booking: 'bookings', order: 'orders', ticket: 'tickets', deal: 'deals', review: 'reviews' }

/** The FCM message for one phone. */
export function fcmMessage(token: string, notice: PushNotice) {
  const title = notice.title.slice(0, 120)
  const body = notice.body.replace(/\s+/g, ' ').trim().slice(0, 240)
  return {
    message: {
      token,
      notification: { title, body },
      data: { open: notice.open, kind: notice.kind },
      android: { priority: 'HIGH', notification: { channel_id: CHANNELS[notice.kind], ...(notice.tag ? { tag: notice.tag } : {}), color: '#008069', icon: 'ic_notification', sound: 'default' } },
      apns: { payload: { aps: { sound: 'default', ...(notice.tag ? { 'thread-id': notice.tag } : {}) } } },
    },
  }
}

export interface PushTarget {
  organizationId: string
  /** Only these people; empty or missing = everyone in the workspace with the app */
  userIds?: (string | null | undefined)[]
  /** Not this person (the one who did it) */
  exceptUserId?: string | null
}

/**
 * Send a notification to the phones of a workspace (or of some of its people). Returns how many were
 * sent. Phones Firebase no longer knows are forgotten. Never throws.
 */
export async function sendPush(db: any, target: PushTarget, notice: PushNotice, fetcher: typeof fetch = fetch, problems?: string[]): Promise<number> {
  try {
    const account = serviceAccount()
    if (!account) return 0
    const only = (target.userIds || []).filter(Boolean) as string[]
    let query = db.from('device_tokens').select('token, user_id').eq('organization_id', target.organizationId)
    if (only.length) query = query.in('user_id', only)
    const { data, error } = await query.limit(200)
    if (error) return 0
    const phones = (data || []).filter((row: any) => row.user_id !== target.exceptUserId)
    if (!phones.length) return 0
    const token = await accessToken(account, fetcher)
    const results = await Promise.all(phones.map(async (phone: any) => {
      try {
        const response = await fetcher(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(fcmMessage(phone.token, notice)),
        })
        if (response.ok) return true
        const failure = await response.json().catch(() => ({}))
        const code = failure?.error?.details?.[0]?.errorCode || failure?.error?.status
        // The app was removed or signed out on that phone
        if (response.status === 404 || code === 'UNREGISTERED') await db.from('device_tokens').delete().eq('token', phone.token)
        else console.warn('[Push] Not sent:', response.status, code || failure?.error?.message || '')
        problems?.push(String(failure?.error?.message || code || `Firebase returned HTTP ${response.status}`))
        return false
      } catch (sendError: any) {
        console.warn('[Push] Not sent:', sendError?.message)
        problems?.push(String(sendError?.message || 'Firebase could not be reached'))
        return false
      }
    }))
    return results.filter(Boolean).length
  } catch (error: any) {
    console.warn('[Push] Could not send:', error?.message)
    problems?.push(String(error?.message || 'The notification could not be sent'))
    return 0
  }
}
