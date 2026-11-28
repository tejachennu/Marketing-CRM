/**
 * Saving the business's currency (lib/money.ts): organizations.business_currency, added the first time it is saved.
 * Reading never needs the column (organizations are read with select('*') and a missing value counts as INR).
 * Server only.
 */

import { createAutoSetup, isMissingSchemaError, runMigrationSql } from './schema-setup'
import { knownCurrency } from './money'

/** supabase/migrations/20261216_business_currency.sql word for word. */
export const BUSINESS_CURRENCY_SQL = `-- The business's currency, chosen in Settings (INR, USD, AED, SAR, QAR, GBP, EUR, SGD, AUD, CAD). Empty means it was
-- never chosen, which counts as INR. Front Desk, E-commerce and the Sales Pipeline show money in it. The older
-- organizations.currency column defaulted to 'USD', so it is not used on its own. Safe to run more than once.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS business_currency TEXT;

NOTIFY pgrst, 'reload schema';
`

export const BUSINESS_CURRENCY_LOCK = 724519043
export const businessCurrencySchemaSetup = createAutoSetup('Business currency', (connectionString) => runMigrationSql(connectionString, BUSINESS_CURRENCY_SQL, BUSINESS_CURRENCY_LOCK))

/**
 * Save the business's currency. The older `currency` column is kept in step, for the online payment code that still
 * reads it. Returns the saved code, or an error in plain words.
 */
export async function saveBusinessCurrency(db: any, organizationId: string, value: unknown, setup: { ensure: () => Promise<boolean> } = businessCurrencySchemaSetup): Promise<{ currency: string } | { error: string }> {
  const code = knownCurrency(value)
  if (!code) return { error: 'Choose a currency from the list.' }
  const write = () => db.from('organizations').update({ business_currency: code, currency: code }).eq('id', organizationId)
  const missing = (error: any) => isMissingSchemaError(error, /business_currency/)
  let result = await write()
  if (missing(result.error) && (await setup.ensure())) {
    result = await write()
    for (let attempt = 1; attempt < 4 && missing(result.error); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
      result = await write()
    }
  }
  if (result.error) return { error: missing(result.error) ? 'The currency could not be saved yet. Please try again in a minute.' : result.error.message }
  return { currency: code }
}
