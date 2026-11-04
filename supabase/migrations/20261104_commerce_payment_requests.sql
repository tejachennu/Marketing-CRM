-- Every payment request sent for an order, oldest first:
--   [{ "reference": "ORD-261013-AB12.2", "amount": 1040, "currency": "INR", "requested_at": "...", "voided_at": null }]
-- Each "Pay online" tap and each dashboard reminder sends a new request under a new reference, and
-- the payment that comes back is checked against the amount asked for under that reference. Until
-- this is applied the app keeps only the latest reference (meta_payment_reference), as before.
ALTER TABLE public.commerce_orders ADD COLUMN IF NOT EXISTS payment_requests JSONB NOT NULL DEFAULT '[]'::jsonb;
