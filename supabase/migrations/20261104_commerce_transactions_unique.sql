-- One ledger row per gateway transaction and store. Meta redelivers payment webhooks, and two
-- deliveries at the same moment must not record the same payment twice: the webhook handler treats
-- a unique violation as "already recorded". Fails if duplicate rows already exist; remove those
-- (keep the earliest per organization_id, transaction_id) and run it again.
CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_transactions_transaction
  ON public.commerce_transactions (organization_id, transaction_id);
