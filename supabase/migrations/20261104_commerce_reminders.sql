-- Checkout-abandonment reminders, sent by the cron tick (lib/scheduler/checkout-reminders.ts).
-- Safe to apply more than once. Until it is applied the tick skips reminders and logs
-- "Checkout reminders need the 20261104_commerce_reminders migration"; nothing else changes.

-- reminder_count: reminders sent for the order so far (at most 2).
-- next_reminder_at: the order is not looked at again before this time; null means as soon as
-- it qualifies. A run sets it 6 hours ahead while it works on the order and 20 hours ahead
-- once a reminder went out, so a customer hears from the store at most once a day.
alter table public.commerce_orders
  add column if not exists reminder_count integer not null default 0,
  add column if not exists next_reminder_at timestamptz;

-- The tick asks for open orders that are due; the partial index keeps that cheap as orders pile up.
create index if not exists commerce_orders_reminder_idx
  on public.commerce_orders (status, next_reminder_at)
  where reminder_count < 2;

-- The store's switch. Reminders stop for an organization when this is false.
alter table public.organizations
  add column if not exists commerce_reminders_enabled boolean not null default true;
