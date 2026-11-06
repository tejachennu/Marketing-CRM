/**
 * Clear billing test data before going live: subscriptions, payments and AI credit history go back
 * to a fresh start (14-day trial from today, ₹300 of AI credit). Exempt flags are kept.
 *
 * A workspace with a real subscription is never touched: while live Razorpay keys are set, any
 * subscription Razorpay can find under those keys is real and its workspace is skipped. Test-mode
 * subscriptions do not exist under live keys, so they are cleared.
 */

import { Client } from 'pg'
import { FREE_AI_CREDIT, TRIAL_DAYS } from './billing'
import { fetchSubscription, razorpayKeys } from './razorpay'

export type RazorpayMode = 'live' | 'test' | 'off'

export function razorpayMode(env: Record<string, string | undefined> = process.env): RazorpayMode {
  const keyId = String(env.RAZORPAY_KEY_ID || '').trim()
  if (!keyId || !String(env.RAZORPAY_KEY_SECRET || '').trim()) return 'off'
  return keyId.startsWith('rzp_live_') ? 'live' : 'test'
}

/** Workspaces whose subscription is real (found under live keys): these keep their billing. */
export async function workspacesWithLiveSubscriptions(rows: { organization_id: string; razorpay_subscription_id: string | null }[], fetcher: typeof fetch = fetch): Promise<string[]> {
  if (razorpayMode() !== 'live' || !razorpayKeys()) return []
  const keep: string[] = []
  for (const row of rows) {
    if (!row.razorpay_subscription_id) continue
    try {
      const subscription = await fetchSubscription(row.razorpay_subscription_id, fetcher)
      if (subscription?.id) keep.push(row.organization_id)
    } catch (error: any) {
      // Unknown under live keys (400/404): a test subscription. Anything else: keep it, to be safe.
      if (!(error?.status === 400 || error?.status === 404)) keep.push(row.organization_id)
    }
  }
  return keep
}

/** The reset, statement by statement, each with its own parameters ($1 is always the workspaces to keep). */
export const RESET_STATEMENTS: [string, (keep: string[]) => unknown[]][] = [
  [`UPDATE organization_billing
      SET status = 'trialing', trial_ends_at = NOW() + make_interval(days => $2::int), current_period_end = NULL,
          cancel_at_period_end = FALSE, razorpay_subscription_id = NULL, razorpay_customer_id = NULL,
          ai_balance = $3::numeric, ai_allowance = $3::numeric, updated_at = NOW()
    WHERE NOT (organization_id = ANY($1::uuid[]))`, (keep) => [keep, TRIAL_DAYS, FREE_AI_CREDIT]],
  ['DELETE FROM billing_payments WHERE NOT (organization_id = ANY($1::uuid[]))', (keep) => [keep]],
  ['DELETE FROM ai_wallet_transactions WHERE NOT (organization_id = ANY($1::uuid[]))', (keep) => [keep]],
  [`INSERT INTO ai_wallet_transactions (organization_id, kind, amount)
    SELECT organization_id, 'free_grant', $2::numeric FROM organization_billing WHERE NOT (organization_id = ANY($1::uuid[]))`, (keep) => [keep, FREE_AI_CREDIT]],
]

/** Run the reset in one transaction, leaving `keep` untouched. Returns how many workspaces were reset. */
export async function resetBillingData(connectionString: string, keep: string[], ClientClass: typeof Client = Client): Promise<number> {
  const client = new ClientClass({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, statement_timeout: 60000 })
  await client.connect()
  try {
    await client.query('BEGIN')
    let reset = 0
    for (const [index, [sql, params]] of RESET_STATEMENTS.entries()) {
      const result = await client.query(sql, params(keep))
      if (index === 0) reset = result.rowCount || 0
    }
    await client.query('COMMIT')
    return reset
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end().catch(() => {})
  }
}
