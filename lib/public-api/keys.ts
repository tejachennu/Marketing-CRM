/**
 * API keys: "wama_live_" and 32 random characters. Only a SHA-256 hash is stored, so a leaked
 * database never reveals a working key; the key is shown once, when it is created. Each key has
 * scopes: what it may do.
 */

import { createHash, randomBytes } from 'crypto'

export const KEY_PREFIX = 'wama_live_'
const KEY_FORMAT = /^wama_live_[A-Za-z0-9_-]{32}$/

export { API_SCOPES, ALL_SCOPES, type ApiScope } from './scopes'
import { ALL_SCOPES, type ApiScope } from './scopes'

export const MAX_KEYS_PER_WORKSPACE = 20

export function generateApiKey(random: (size: number) => Buffer = randomBytes): string {
  return `${KEY_PREFIX}${random(24).toString('base64url')}`
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/** What Settings shows of a key: its start, enough to recognise it. */
export function keyPreview(key: string): string {
  return `${key.slice(0, KEY_PREFIX.length + 4)}…`
}

export function looksLikeApiKey(value: unknown): value is string {
  return typeof value === 'string' && KEY_FORMAT.test(value)
}

/** The key sent with a request: "Authorization: Bearer <key>" or "X-API-Key: <key>". */
export function keyFromHeaders(headers: Headers): string | null {
  const auth = headers.get('authorization') || ''
  const bearer = /^Bearer\s+(\S+)$/i.exec(auth.trim())?.[1]
  const key = bearer || headers.get('x-api-key')?.trim() || ''
  return key || null
}

/** The scopes asked for when creating a key: known ones only; none means all. */
export function parseScopes(value: unknown): ApiScope[] {
  const asked = Array.isArray(value) ? value.map(String) : []
  const known = ALL_SCOPES.filter((scope) => asked.includes(scope))
  return known.length ? known : [...ALL_SCOPES]
}

/** A phone number in international form: "+919876543210". Ten-digit Indian numbers get +91. */
export function normalizePhone(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (raw.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`
  if (/^0[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(1)}`
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`
  return null
}
