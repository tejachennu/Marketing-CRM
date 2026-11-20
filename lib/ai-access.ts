/**
 * Which OpenAI key a workspace's AI features use, whether they may run, and charging each call to the
 * workspace's AI wallet.
 *
 * - Billed workspaces use WAMA CRM's own key: OPENAI_API_KEY when the server has it, else the global key the
 *   Super Admin saved on WAMA CRM's own workspace (Super Admin → Advanced → OpenAI API Key; `platformAiKey`).
 *   Each call is charged to the wallet at OpenAI's price (see lib/billing.ts); when the wallet is empty, AI
 *   features pause.
 * - Exempt workspaces (billing_exempt) keep working exactly as before: their own key if they set one,
 *   otherwise the platform key, and nothing is charged.
 * - Before the billing migration has run, every workspace behaves as before.
 */

import { aiCostInr, billingState, getBilling } from './billing'
import { MASTER_ORG_ID } from './constants'

/** WAMA CRM's own workspaces: the global AI key is the one saved on these (first one that has a key). */
export const PLATFORM_KEY_WORKSPACES = [MASTER_ORG_ID, 'b2acf062-c379-49f2-8905-267413c9c394']

let keyCache: { key: string; at: number } | null = null

/**
 * The global (platform) OpenAI key: the server's OPENAI_API_KEY, else the key the Super Admin saved on WAMA CRM's
 * own workspace. Kept for 5 minutes, so a key changed in Super Admin is used within minutes.
 */
export async function platformAiKey(db: any, now = Date.now()): Promise<string> {
  const env = String(process.env.OPENAI_API_KEY || '').trim()
  if (env) return env
  if (keyCache && now - keyCache.at < 5 * 60_000) return keyCache.key
  let key = ''
  try {
    const { data } = await db.from('organizations').select('id, openai_api_key').in('id', PLATFORM_KEY_WORKSPACES)
    const rows = (data || []) as { id: string; openai_api_key?: string | null }[]
    for (const id of PLATFORM_KEY_WORKSPACES) {
      const found = String(rows.find((r) => r.id === id)?.openai_api_key || '').trim()
      if (found) { key = found; break }
    }
  } catch (error: any) {
    console.error('[AI access] The global AI key could not be read:', error?.message)
  }
  keyCache = { key, at: now }
  return key
}

/** Forget the kept global key (after the Super Admin saves a new one). */
export function forgetPlatformAiKey() {
  keyCache = null
}

export interface AiAccess {
  organizationId: string
  apiKey: string
  /** Calls are charged to the AI wallet */
  billed: boolean
  /** AI may run (a key exists and, when billed, the wallet has credit) */
  allowed: boolean
  /** Why AI cannot run, in words for the workspace */
  reason?: string
}

export const AI_PAUSED_MESSAGE = 'AI credits are used up. Add credits in Billing to switch AI back on.'

/** The AI access for a workspace. `organization` may be passed when already loaded (needs openai_api_key). */
export async function getAiAccess(db: any, organizationId: string, organization?: { openai_api_key?: string | null } | null): Promise<AiAccess> {
  const platformKey = await platformAiKey(db)
  let billing = null
  try {
    billing = organizationId ? await getBilling(db, organizationId) : null
  } catch (error: any) {
    console.error('[AI access] Billing could not be read:', error?.message)
  }

  if (!billing || billing.billing_exempt) {
    let ownKey = organization?.openai_api_key
    if (ownKey === undefined && organizationId) {
      const { data } = await db.from('organizations').select('openai_api_key').eq('id', organizationId).maybeSingle()
      ownKey = data?.openai_api_key
    }
    const apiKey = String(ownKey || '').trim() || platformKey
    return { organizationId, apiKey, billed: false, allowed: Boolean(apiKey), reason: apiKey ? undefined : 'AI is not set up for this workspace.' }
  }

  if (!platformKey) return { organizationId, apiKey: '', billed: true, allowed: false, reason: 'AI is not available right now. Please contact support.' }
  const state = billingState(billing)
  if (state.aiPaused) return { organizationId, apiKey: platformKey, billed: true, allowed: false, reason: AI_PAUSED_MESSAGE }
  return { organizationId, apiKey: platformKey, billed: true, allowed: true }
}

/** Read the model and token usage from an OpenAI response body (chat completions, embeddings or transcriptions). */
export function readUsage(responseBody: any, requestModel?: string): { model: string; input: number; output: number } | null {
  const usage = responseBody?.usage
  if (!usage) return null
  const input = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0
  const output = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0
  return { model: String(responseBody?.model || requestModel || ''), input, output }
}

/** Charge one call to the workspace's wallet. Failures are logged, never thrown into the feature. */
export async function chargeAiUsage(db: any, access: AiAccess, feature: string, model: string, input: number, output: number): Promise<void> {
  if (!access.billed) return
  const amount = aiCostInr(model, input, output)
  if (!(amount > 0)) return
  try {
    const { error } = await db.rpc('ai_wallet_charge', { p_org: access.organizationId, p_amount: amount, p_feature: feature, p_model: model, p_tokens: input + output })
    if (error) console.error('[AI access] Could not charge AI usage:', error.message)
  } catch (error: any) {
    console.error('[AI access] Could not charge AI usage:', error?.message)
  }
}

const OPENAI = 'https://api.openai.com/v1'

/** Where an OpenAI call goes: OpenAI, or (on a development server only) a local stand-in set by OPENAI_API_BASE. */
export function openAiUrl(url: string, env: Record<string, string | undefined> = process.env): string {
  const base = env.NODE_ENV !== 'production' ? String(env.OPENAI_API_BASE || '').trim().replace(/\/+$/, '') : ''
  return base && url.startsWith(OPENAI) ? `${base}${url.slice(OPENAI.length)}` : url
}

/**
 * fetch() for OpenAI that charges the call to the wallet. Use it in place of fetch for
 * https://api.openai.com/... once getAiAccess has said the call is allowed.
 */
export async function aiFetch(db: any, access: AiAccess, feature: string, url: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<Response> {
  const headers = new Headers(init.headers || {})
  headers.set('Authorization', `Bearer ${access.apiKey}`)
  const response = await fetcher(openAiUrl(url), { ...init, headers })
  if (access.billed && response.ok) {
    let requestModel: string | undefined
    if (typeof FormData !== 'undefined' && init.body instanceof FormData) requestModel = String(init.body.get('model') || '') || undefined
    else try { requestModel = JSON.parse(String(init.body || '{}'))?.model } catch {}
    try {
      const usage = readUsage(await response.clone().json(), requestModel)
      if (usage) await chargeAiUsage(db, access, feature, usage.model, usage.input, usage.output)
    } catch {
      // Not JSON (or already consumed): nothing to charge
    }
  }
  return response
}
