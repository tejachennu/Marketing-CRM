/**
 * Twilio's webhook signature (X-Twilio-Signature): base64 HMAC-SHA1, with the account's auth token, of the full URL
 * Twilio called followed by every POST parameter as name + value, sorted by name. It proves a message really came from
 * Twilio and not from someone posting fake customer messages (which would also run the AI and cost money).
 *
 * TWILIO_SIGNATURE_CHECK=enforce refuses unsigned or wrongly signed calls; any other value only logs them, so a live
 * workspace never stops receiving messages because of a URL mismatch before the logs have been checked.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

export function twilioSignature(authToken: string, url: string, params: URLSearchParams): string {
  const names = [...new Set([...params.keys()])].sort()
  const data = url + names.map((name) => params.getAll(name).map((v) => name + v).join('')).join('')
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64')
}

export function validTwilioSignature(authToken: string, url: string, params: URLSearchParams, header: string | null): boolean {
  if (!authToken || !header) return false
  const want = Buffer.from(twilioSignature(authToken, url, params))
  const given = Buffer.from(header)
  return want.length === given.length && timingSafeEqual(want, given)
}

/** The public URL Twilio called (Vercel and our nginx forward the original host and protocol). */
export function calledUrl(request: { url: string; headers: { get(name: string): string | null } }): string {
  const url = new URL(request.url)
  const host = request.headers.get('x-forwarded-host') || url.host
  const proto = (request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '')).split(',')[0].trim()
  return `${proto}://${host}${url.pathname}${url.search}`
}

/** true = go on. Logs a bad signature; refuses it only when TWILIO_SIGNATURE_CHECK=enforce. */
export function twilioCallAllowed(request: { url: string; headers: { get(name: string): string | null } }, authToken: string, params: URLSearchParams, where: string, env: Record<string, string | undefined> = process.env): boolean {
  const ok = validTwilioSignature(authToken, calledUrl(request), params, request.headers.get('x-twilio-signature'))
  if (ok) return true
  console.warn(`[${where}] Twilio signature did not match for ${calledUrl(request)}${authToken ? '' : ' (no auth token saved)'}`)
  return env.TWILIO_SIGNATURE_CHECK !== 'enforce'
}
