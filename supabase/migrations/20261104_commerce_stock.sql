-- Stock for the WhatsApp store. When an order is paid or confirmed for Cash on Delivery, its
-- items are taken out of commerce_products.inventory_count (never below 0; a product that reaches
-- 0 is marked unavailable and the Meta catalog is told). When such an order is canceled, the
-- items go back. See adjustOrderStock in lib/commerce/commerce-webhook-handler.ts.
--
-- stock_adjusted_at records that an order's stock was taken, so a redelivered webhook, a second
-- tap or a second click never counts the same order twice; canceling clears it again.
-- Safe to apply more than once. Until it is applied, stock is left alone and the app logs
-- "Stock adjustments need the 20261104_commerce_stock migration" once; nothing else changes.
alter table public.commerce_orders
  add column if not exists stock_adjusted_at timestamptz;
