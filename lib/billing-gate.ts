/**
 * When the free trial (or a paid plan) has ended, the workspace pauses until it subscribes (owner, 24 Nov 2026:
 * "14 days free trial, after they need to do payment"). The website already locks its pages; this makes the
 * server refuse too, so the mobile app (and anything else) cannot carry on without paying.
 *
 * Still open after the end: Billing (to pay), sign-in and sign-out, the app's own profile and settings calls,
 * and reading the workspace's basic details (the website's menu needs them). Nothing is deleted.
 */
import { billingState, getBilling, type BillingRow } from './billing'

/** What may still be used once the workspace has paused: [path prefix, methods or 'any'] */
const OPEN_WHEN_ENDED: [string, 'any' | string[]][] = [
  ['/api/billing', 'any'],
  ['/api/auth', 'any'],
  ['/api/mobile/me', 'any'],
  ['/api/mobile/config', 'any'],
  ['/api/mobile/devices', 'any'],
  ['/api/organization', ['GET']],
  ['/api/superadmin', 'any'],
]

/** Pure: may this call go through while the workspace is paused? */
export function openWhenEnded(path: string, method: string): boolean {
  const clean = path.replace(/\/+$/, '')
  return OPEN_WHEN_ENDED.some(([prefix, methods]) =>
    (clean === prefix || clean.startsWith(`${prefix}/`)) && (methods === 'any' || methods.includes(method.toUpperCase())))
}

export const ENDED_MESSAGE = 'Your free trial has ended. Choose a plan in Billing to carry on: nothing has been deleted.'
export const ENDED_PAID_MESSAGE = 'Your plan has ended. Renew it in Billing to carry on: nothing has been deleted.'

/** The words for a paused workspace: a trial that ended, or a plan that was not renewed */
export function endedMessage(onTrial: boolean) {
  return onTrial ? ENDED_MESSAGE : ENDED_PAID_MESSAGE
}

// A short memory per workspace, so every call does not read billing again (one Vercel instance, 30 seconds)
const remembered = new Map<string, { at: number; row: BillingRow | null }>()
const REMEMBER_MS = 30_000

/** The workspace's billing row, read at most once per half minute. Throws on a read error. */
export async function billingRowFor(db: any, organizationId: string, now = Date.now()): Promise<BillingRow | null> {
  const hit = remembered.get(organizationId)
  if (hit && now - hit.at < REMEMBER_MS) return hit.row
  const row = await getBilling(db, organizationId)
  remembered.set(organizationId, { at: now, row })
  if (remembered.size > 5000) remembered.clear()
  return row
}

/** Is this workspace paused right now? Never refuses on a read error (better to let a call through). */
export async function workspacePaused(db: any, organizationId: string, now = Date.now()): Promise<{ paused: boolean; onTrial: boolean }> {
  try {
    const state = billingState(await billingRowFor(db, organizationId, now), now)
    return { paused: !state.hasAccess, onTrial: state.onTrial }
  } catch (error: any) {
    console.error('[billing-gate] Billing could not be read:', error?.message)
    return { paused: false, onTrial: false }
  }
}

/** After a payment or a plan change, forget what was remembered so the workspace opens at once */
export function forgetWorkspace(organizationId: string) {
  remembered.delete(organizationId)
}
