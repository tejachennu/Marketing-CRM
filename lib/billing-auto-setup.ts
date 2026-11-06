/**
 * Billing switches itself on: the first dashboard request after a deploy that finds the billing
 * tables missing creates them through the app's database connection (the same migration as the
 * Super Admin "Switch on billing" button). Set BILLING_AUTO_SETUP=off to turn this off.
 */

import { migrationConnectionString, runBillingMigration } from './billing-migration'

// At most one attempt per server instance every ten minutes, so a failing connection is not retried on every page view
const RETRY_AFTER_MS = 10 * 60 * 1000
let lastAttempt = 0
let running: Promise<boolean> | null = null

export function autoSetupEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.BILLING_AUTO_SETUP || '').trim().toLowerCase() !== 'off' && Boolean(migrationConnectionString(env))
}

/** Create the billing tables if they are missing. Returns true when the migration ran. */
export async function ensureBillingSwitchedOn(run: typeof runBillingMigration = runBillingMigration, now = Date.now()): Promise<boolean> {
  if (!autoSetupEnabled()) return false
  if (running) return running
  if (now - lastAttempt < RETRY_AFTER_MS) return false
  lastAttempt = now
  running = (async () => {
    try {
      await run(migrationConnectionString()!)
      console.log('[Billing] Switched on automatically: billing tables created')
      return true
    } catch (error: any) {
      console.error('[Billing] Could not switch billing on automatically:', error?.message)
      return false
    } finally {
      running = null
    }
  })()
  return running
}

/** Test seam: forget the last attempt. */
export function resetAutoSetup() {
  lastAttempt = 0
  running = null
}
