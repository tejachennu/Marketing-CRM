/**
 * Database for online payments on a business's own accounts: Stripe keys and which gateway to use (organizations),
 * payment while booking (salon_appointments), and an advance paid online taken off the bill (salon_invoices).
 * Server only.
 */

import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'

/** supabase/migrations/20261210_stripe_and_booking_payments.sql word for word. */
export const PAYMENTS_SQL = `-- Stripe on a business's own account (store page and bookings), which online payment to use, and payment while
-- booking: online in full or an advance, or at the shop. Safe to run more than once. The app runs it on its own.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_secret_key TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_webhook_secret TEXT;
-- 'razorpay' or 'stripe' when both are connected
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pay_gateway TEXT;

-- A booking paid online: status 'awaiting_payment' holds the time until payment_hold_until, then it lets go.
-- payment_status: pending, paid, at_shop, expired. payment_ref = Razorpay order id or Stripe Checkout Session id.
ALTER TABLE salon_appointments ADD COLUMN IF NOT EXISTS payment_status TEXT;
ALTER TABLE salon_appointments ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(12,2);
ALTER TABLE salon_appointments ADD COLUMN IF NOT EXISTS payment_paid NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE salon_appointments ADD COLUMN IF NOT EXISTS payment_gateway TEXT;
ALTER TABLE salon_appointments ADD COLUMN IF NOT EXISTS payment_ref TEXT;
ALTER TABLE salon_appointments ADD COLUMN IF NOT EXISTS payment_id TEXT;
ALTER TABLE salon_appointments ADD COLUMN IF NOT EXISTS payment_hold_until TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_salon_appointments_payment_ref ON salon_appointments(organization_id, payment_ref) WHERE payment_ref IS NOT NULL;

-- Paid online when booking, taken off the bill at the counter
ALTER TABLE salon_invoices ADD COLUMN IF NOT EXISTS advance_paid NUMERIC(12,2) NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
`

export const PAYMENTS_LOCK = 724519036
export const paymentsSchemaSetup = createAutoSetup('Online payments', (connectionString) => runMigrationSql(connectionString, PAYMENTS_SQL, PAYMENTS_LOCK))

const COLUMNS = /stripe_|pay_gateway|payment_(status|amount|paid|gateway|ref|id|hold_until)|advance_paid/

export async function withPaymentsSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = paymentsSchemaSetup): Promise<any> {
  const first = await step()
  if (!isMissingSchemaError(first.error, COLUMNS)) return first
  if (!(await setup.ensure())) return first
  let result = await step()
  for (let attempt = 1; attempt < 4 && isMissingSchemaError(result.error, COLUMNS); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
    result = await step()
  }
  return result
}
