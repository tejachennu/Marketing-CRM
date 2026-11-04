/**
 * Twilio signs every webhook it sends with the account's auth token (the X-Twilio-Signature
 * header, an HMAC of the URL it called and the form fields). Without the check, anyone who knows
 * a workspace's webhook address could post fake customer messages or delivery statuses into it.
 *
 * TWILIO_WEBHOOK_ALLOW_UNSIGNED=true turns the check off, for a local tunnel or while a workspace's
 * token is being fixed; it is logged once per process so it is not left on by accident.
 */

import type { NextRequest } from 'next/server'
import twilio from 'twilio'

/** The addresses Twilio may have signed: the one the request arrived at, and the public one a proxy forwarded. */
export function twilioSignedUrls(request: NextRequest): string[] {
  const received = new URL(request.url)
  const urls = [received.href]
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
  if (host) {
    const proto = (request.headers.get('x-forwarded-proto') || received.protocol.replace(':', '') || 'https').split(',')[0].trim()
    const forwarded = `${proto}://${host.split(',')[0].trim()}${received.pathname}${received.search}`
    if (!urls.includes(forwarded)) urls.push(forwarded)
  }
  return urls
}

let warnedUnsigned = false

export type TwilioCheck = { ok: true } | { ok: false; reason: 'missing_signature' | 'no_auth_token' | 'bad_signature' }

/**
 * Whether a form-encoded Twilio request was signed with one of `authTokens` (blank ones are
 * ignored). `rawBody` is the body as received.
 */
export function verifyTwilioRequest(request: NextRequest, rawBody: string, authTokens: Array<string | null | undefined>): TwilioCheck {
  if (process.env.TWILIO_WEBHOOK_ALLOW_UNSIGNED === 'true') {
    if (!warnedUnsigned) {
      warnedUnsigned = true
      console.warn('[twilio-webhook] TWILIO_WEBHOOK_ALLOW_UNSIGNED is on: Twilio webhook signatures are not checked.')
    }
    return { ok: true }
  }
  const signature = request.headers.get('x-twilio-signature')
  if (!signature) return { ok: false, reason: 'missing_signature' }
  const tokens = [...new Set(authTokens.map((token) => String(token || '').trim()).filter(Boolean))]
  if (tokens.length === 0) return { ok: false, reason: 'no_auth_token' }

  const params: Record<string, string> = {}
  for (const [key, value] of new URLSearchParams(rawBody)) params[key] = value
  const urls = twilioSignedUrls(request)
  const valid = tokens.some((token) => urls.some((url) => twilio.validateRequest(token, signature, url, params)))
  return valid ? { ok: true } : { ok: false, reason: 'bad_signature' }
}

/** The log line for a refused request; the response itself says nothing about why. */
export function describeTwilioRefusal(reason: Exclude<TwilioCheck, { ok: true }>['reason']): string {
  switch (reason) {
    case 'missing_signature': return 'no X-Twilio-Signature header'
    case 'no_auth_token': return 'no Twilio auth token is saved for this workspace (or TWILIO_AUTH_TOKEN), so the signature cannot be checked'
    default: return 'the signature does not match the auth token and the webhook address'
  }
}
