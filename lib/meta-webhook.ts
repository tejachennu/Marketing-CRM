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
