-- Stripe on a business's own account (store page and bookings), which online payment to use, and payment while
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
