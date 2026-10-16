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

  const expected = Buffer.from('sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex'))
  const received = Buffer.from(signatureHeader)
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return { valid: false, note: 'Signature does not match' }
  return { valid: true }
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
