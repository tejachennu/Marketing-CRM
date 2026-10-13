/**
 * Rules for onboarding a business through Meta's Embedded Signup, kept apart from the route so
 * they can be tested. Follows "Onboarding business customers as a Tech Provider":
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider
 */

import { createHmac } from 'node:crypto'

/** The PIN every number was registered with before per-number PINs. Still tried for those numbers. */
export const LEGACY_REGISTRATION_PIN = '123456'

/** Meta's error for "this number already has a different two-step verification PIN". */
export const PIN_MISMATCH_ERROR_CODE = 133005

/**
 * The 6-digit PIN a number is registered with, which becomes its two-step verification PIN.
 * Derived from a server secret, so each number gets its own and it can be worked out again
 * without being stored. Without the secret, the old shared PIN is used.
 */
export function getRegistrationPin(phoneNumberId: string, secret: string | undefined = process.env.WHATSAPP_PIN_SECRET): string {
  if (!secret) return LEGACY_REGISTRATION_PIN
  const digest = createHmac('sha256', secret).update(`whatsapp-registration-pin:${phoneNumberId}`).digest()
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0')
}

const isNumericId = (value: unknown): value is string => typeof value === 'string' && /^\d{5,25}$/.test(value)

export interface SignupSession {
  wabaId: string
  phoneNumberId: string
  /** The customer's business portfolio. */
  businessId: string
  /** Catalogs the customer chose to share during signup. */
  catalogIds: string[]
}

/** What Embedded Signup reported about the finished flow, with anything that is not a Meta ID dropped. */
export function parseSignupSession(raw: Record<string, any> | null | undefined): SignupSession {
  const id = (value: unknown) => {
    const text = String(value ?? '').trim()
    return isNumericId(text) ? text : ''
  }
  const catalogs = Array.isArray(raw?.catalogIds) ? raw.catalogIds : []
  return {
    wabaId: id(raw?.wabaId),
    phoneNumberId: id(raw?.phoneNumberId),
    businessId: id(raw?.businessId),
    catalogIds: catalogs.map(id).filter(Boolean).slice(0, 10),
  }
}

/** Meta's limit on an alternate callback URL. */
const MAX_CALLBACK_URL_LENGTH = 200

/**
 * This site's public address, as Meta must be able to reach it: the configured one, otherwise the
 * address the request came in on. Null when that is not a public https address (a developer's machine).
 */
export function getPublicBaseUrl(
  request: { url: string; headers: { get(name: string): string | null } },
  configured: string | undefined = process.env.NEXT_PUBLIC_APP_URL
): string | null {
  const candidates = [(configured || '').trim()]
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  if (forwardedHost) candidates.push(`${request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https'}://${forwardedHost}`)
  candidates.push(request.url)

  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const url = new URL(candidate)
      const local = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|\[::1\])/.test(url.hostname) || !url.hostname.includes('.')
      if (url.protocol === 'https:' && !local) return url.origin
    } catch {
      // Not an address: try the next one
    }
    // A configured address that is not usable must not be silently replaced by the request's
    if (candidate === candidates[0]) return null
  }
  return null
}

export interface WebhookOverride {
  override_callback_uri: string
  verify_token: string
}

/**
 * Where Meta should deliver one organization's WhatsApp events. A Meta app has a single callback
 * address; this is set on the customer's WhatsApp Business account so its messages reach its own
 * workspace (see "Override the callback URL" in Meta's webhook docs).
 */
export function getWebhookOverride(organizationId: string, baseUrl: string | null): WebhookOverride | null {
  if (!baseUrl || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId)) return null
  const uri = `${baseUrl.replace(/\/+$/, '')}/api/webhooks/facebook/${organizationId}`
  if (uri.length > MAX_CALLBACK_URL_LENGTH) return null
  // The webhook route answers Meta's verification request when the token is the organization's ID
  return { override_callback_uri: uri, verify_token: organizationId }
}
