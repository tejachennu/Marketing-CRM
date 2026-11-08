/**
 * Who is calling the public API: the API key in the request, the workspace it belongs to, and
 * whether it may do this (scope, rate limit, the workspace's plan). Every /api/v1 route starts here.
 */

import { NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '../api-auth-helper'
import { billingState, getBilling, isExemptOrganization } from '../billing'
import { RateLimiter } from '../rate-limiter'
import { isConsularHelpdesk } from '../workspace-modules'
import { hashApiKey, keyFromHeaders, looksLikeApiKey, type ApiScope } from './keys'
import { RATE_LIMIT_PER_MINUTE } from './scopes'
import { isMissingApiKeys, withApiKeys } from './schema'

export interface ApiContext {
  db: any
  organizationId: string
  organization: Record<string, any>
  key: { id: string; name: string; scopes: string[] }
}

export type ApiAuth = { ok: true; ctx: ApiContext } | { ok: false; response: NextResponse }

export { RATE_LIMIT_PER_MINUTE }
const limiter = new RateLimiter()

/** Every error has the same shape: { "error": { "code": "…", "message": "…" } } */
export function apiError(status: number, code: string, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json({ error: { code, message, ...extra } }, { status, headers })
}

export async function apiAuth(request: Request, scope: ApiScope | null, options: { db?: any; now?: number; limiter?: RateLimiter } = {}): Promise<ApiAuth> {
  const now = options.now ?? Date.now()
  const key = keyFromHeaders(request.headers)
  if (!key) return { ok: false, response: apiError(401, 'missing_api_key', 'Send your API key in the Authorization header: "Authorization: Bearer wama_live_…". Create one in Settings → API.') }
  if (!looksLikeApiKey(key)) return { ok: false, response: apiError(401, 'invalid_api_key', 'That is not a WAMA API key. Keys start with "wama_live_".') }
  const db = options.db || getSupabaseAdminClient()
  const { data: row, error } = await withApiKeys(() => db.from('api_keys').select('id, organization_id, name, scopes, revoked_at, last_used_at').eq('key_hash', hashApiKey(key)).maybeSingle())
  if (error && !isMissingApiKeys(error)) return { ok: false, response: apiError(500, 'server_error', 'Something went wrong. Please try again.') }
  if (!row || row.revoked_at) return { ok: false, response: apiError(401, 'invalid_api_key', 'This API key is not valid, or it was revoked.') }

  const limit = (options.limiter || limiter).checkRateLimit(`api:${row.id}`, RATE_LIMIT_PER_MINUTE, 60_000)
  if (!limit.allowed) {
    const seconds = Math.max(1, Math.ceil(limit.retryAfterMs / 1000))
    return { ok: false, response: apiError(429, 'rate_limited', `Too many requests. You can make ${RATE_LIMIT_PER_MINUTE} a minute with one key; try again in ${seconds} seconds.`, {}, { 'Retry-After': String(seconds) }) }
  }
  const scopes: string[] = Array.isArray(row.scopes) ? row.scopes : []
  if (scope && !scopes.includes(scope)) return { ok: false, response: apiError(403, 'insufficient_scope', `This key may not do that: it needs the "${scope}" permission. Create a key with it in Settings → API.`, { required_scope: scope }) }

  const { data: organization } = await db.from('organizations').select('*').eq('id', row.organization_id).maybeSingle()
  if (!organization) return { ok: false, response: apiError(401, 'invalid_api_key', 'This API key is not valid, or it was revoked.') }
  try {
    if (!isExemptOrganization(organization) && !billingState(await getBilling(db, row.organization_id), now).hasAccess) {
      return { ok: false, response: apiError(402, 'workspace_locked', 'This workspace\'s plan has ended. Renew it in Billing to use the API again.') }
    }
  } catch {
    // Billing not set up on this server: nothing to check
  }
  // Note when the key was last used, at most once a minute
  if (!row.last_used_at || now - Date.parse(row.last_used_at) > 60_000) {
    Promise.resolve(db.from('api_keys').update({ last_used_at: new Date(now).toISOString() }).eq('id', row.id)).catch(() => {})
  }
  return { ok: true, ctx: { db, organizationId: row.organization_id, organization, key: { id: row.id, name: row.name, scopes } } }
}

/** Front Desk endpoints need the connector switched on. */
export function frontDeskOff(organization: Record<string, any>): NextResponse | null {
  if (isConsularHelpdesk(organization) || !(organization.enabled_connectors || []).includes('salon')) {
    return apiError(403, 'front_desk_off', 'Front Desk is switched off for this workspace. An admin can switch it on in Connectors.')
  }
  return null
}

/** The JSON body, or an error response when it is not a JSON object. */
export async function jsonBody(request: Request): Promise<{ body: Record<string, any> } | { response: NextResponse }> {
  const body = await request.json().catch(() => undefined)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { response: apiError(400, 'invalid_json', 'Send a JSON object in the request body, with "Content-Type: application/json".') }
  return { body }
}

/** ?limit (1–100, default 50) and ?offset for list endpoints. */
export function paging(params: URLSearchParams): { limit: number; offset: number } {
  const limit = Math.min(100, Math.max(1, Math.floor(Number(params.get('limit')) || 50)))
  const offset = Math.max(0, Math.floor(Number(params.get('offset')) || 0))
  return { limit, offset }
}

/** A list, with paging: one extra row is read to know whether there are more. */
export function listResponse<T>(rows: T[], page: { limit: number; offset: number }) {
  return NextResponse.json({ data: rows.slice(0, page.limit), pagination: { limit: page.limit, offset: page.offset, has_more: rows.length > page.limit } })
}
