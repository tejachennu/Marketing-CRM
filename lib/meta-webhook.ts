/**
 * Checks that a webhook really came from Meta. Meta signs every POST with the app secret:
 * `X-Hub-Signature-256: sha256=<HMAC-SHA256 of the raw body>`.
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

export interface SignatureCheck {
  valid: boolean
  /** Why it was refused, or what was skipped. For the server log only. */
  note?: string
}

/**
 * Whether the raw body was signed with this secret. Constant-time, so a wrong signature takes as
 * long to refuse as a nearly right one. Nothing can be checked without a secret or a header.
 */
export function verifyMetaSignatureWith(secret: string | null | undefined, rawBody: string, signatureHeader: string | null | undefined): boolean {
  if (!secret || !signatureHeader) return false
  const expected = Buffer.from('sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex'))
  const received = Buffer.from(signatureHeader)
  return expected.length === received.length && timingSafeEqual(expected, received)
}

export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  options: { secret?: string; production?: boolean; allowUnsigned?: boolean } = {}
): SignatureCheck {
  const secret = options.secret ?? process.env.META_APP_SECRET
  const production = options.production ?? process.env.NODE_ENV === 'production'
  const allowUnsigned = options.allowUnsigned ?? process.env.META_WEBHOOK_ALLOW_UNSIGNED === 'true'

  if (!secret) {
    // Without the secret nothing can be checked. On a live site that means anyone could post fake
    // messages into a workspace, so the request is refused; Meta retries it for up to 7 days.
    if (production && !allowUnsigned) return { valid: false, note: 'META_APP_SECRET is not set, so the webhook cannot be verified' }
    return { valid: true, note: 'META_APP_SECRET is not set: signature not checked' }
  }
  if (!signatureHeader) return { valid: false, note: 'Missing X-Hub-Signature-256 header' }
  if (!verifyMetaSignatureWith(secret, rawBody, signatureHeader)) return { valid: false, note: 'Signature does not match' }
  return { valid: true }
}

/** Delivery statuses in the order Meta reports them. Anything else (pending, queued, unknown) comes before "sent". */
const STATUS_ORDER: Record<string, number> = { sent: 1, delivered: 2, read: 3 }

/**
 * Whether a status callback moves a message forward: sent → delivered → read, and failed only from
 * sent or delivered (or from no status yet). Meta's callbacks can arrive out of order and are
 * redelivered, so "delivered" after "read" must not take the blue ticks away, and nothing goes back.
 */
export function isStatusProgress(from: string | null | undefined, to: string | null | undefined): boolean {
  const current = String(from || '').trim().toLowerCase()
  const next = String(to || '').trim().toLowerCase()
  if (current === 'failed' || next === current) return false
  if (next === 'failed') return current !== 'read'
  return (STATUS_ORDER[next] || 0) > (STATUS_ORDER[current] || 0)
}

/** One line on why Meta could not deliver a message, from a status callback's error: code, title and details. */
export function describeStatusError(error: any): string | null {
  if (!error || typeof error !== 'object') return null
  const parts = [error.code != null && error.code !== '' ? `Meta error ${error.code}` : '', error.title, error.error_data?.details || error.message]
  const unique = [...new Set(parts.map((part) => String(part || '').trim()).filter(Boolean))]
  return unique.length > 0 ? unique.join(': ') : null
}

const SENT_AT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * When a message was sent, from the payload's `timestamp` (seconds since the epoch), as an ISO time.
 * Null when it is missing, not a time, more than 7 days back (Meta retries a webhook for that long;
 * anything older is not trusted) or ahead of this clock by more than a minute.
 */
export function messageSentAt(timestamp: unknown, now: number = Date.now()): string | null {
  const seconds = Number(timestamp)
  if (timestamp === null || timestamp === undefined || timestamp === '' || !Number.isFinite(seconds) || seconds <= 0) return null
  const ms = seconds * 1000
  if (ms < now - SENT_AT_WINDOW_MS || ms > now + 60 * 1000) return null
  return new Date(ms).toISOString()
}

/** A PostgREST error about a column that a migration not yet applied adds. */
export function isMissingColumnError(error: { code?: string; message?: string } | null | undefined, column: string): boolean {
  if (!error) return false
  return error.code === '42703' || error.code === 'PGRST204' || String(error.message || '').includes(column)
}

/** A PostgREST error from an upsert whose ON CONFLICT target has no unique index yet (the migration that adds it is not applied). */
export function isMissingUniqueIndexError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return error.code === '42P10' || /on conflict/i.test(String(error.message || ''))
}

/** The WhatsApp account an organization has connected, as stored on the organization. */
export interface ConnectedWhatsAppAccount {
  whatsapp_business_account_id?: string | null
  whatsapp_phone_number_id?: string | null
}

/**
 * Whether an event for this WhatsApp Business account and phone number is the organization's.
 * An organization with no WhatsApp account connected owns none, so a workspace that disconnected
 * stops receiving the account's messages.
 */
export function ownsWhatsAppEvent(
  organization: ConnectedWhatsAppAccount | null | undefined,
  wabaId: string | null | undefined,
  phoneNumberId: string | null | undefined
): boolean {
  const waba = String(organization?.whatsapp_business_account_id || '').trim()
  const phone = String(organization?.whatsapp_phone_number_id || '').trim()
  if (!waba && !phone) return false
  return (!waba || String(wabaId || '') === waba) && (!phone || String(phoneNumberId || '') === phone)
}

/**
 * The one organization an event belongs to, from those that have its phone number or WhatsApp
 * Business account connected. Null when none does, or when several do and it cannot be told which.
 */
export function pickEventOwner<T extends ConnectedWhatsAppAccount>(
  candidates: T[] | null | undefined,
  wabaId: string | null | undefined,
  phoneNumberId: string | null | undefined
): T | null {
  const owners = (candidates || []).filter((organization) => ownsWhatsAppEvent(organization, wabaId, phoneNumberId))
  return owners.length === 1 ? owners[0] : null
}
