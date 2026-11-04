-- Untracked stock is NULL, not 100.
--
-- An empty stock field used to be stored as inventory_count = 100 (the column's default, the
-- product form and the Meta catalog import all wrote it), and 100 meant "not tracked". Now that
-- paid and Cash on Delivery orders take their items out of stock (20261104_commerce_stock.sql),
-- that placeholder would be counted down like real stock, and a product the store never limited
-- would sell out after 100 units. From now on the app writes NULL for untracked stock and never
-- counts it down (isStockTracked in lib/commerce/commerce-utils.ts).
--
-- A stored 100 cannot be told apart from a real stock of 100, so every 100 is taken as the old
-- placeholder and becomes NULL, once: a store that really held exactly 100 sees "Not tracked" on
-- the product and can enter the number again. Nothing is ever marked sold out by this.
--
-- stock_tracked is generated from inventory_count (the app never writes it). Its presence tells
-- the app that this conversion has run, so a 100 entered afterwards is real stock; until this file
-- is applied the app keeps treating 100 as untracked. The conversion only runs in the same step
-- that adds the column, so applying this file again never touches stock entered since.
--
-- Needs the commerce tables (scripts/db-migration-v33-commerce.js); without them this file only
-- prints a notice, so it can be applied in order with the others and again once they exist.
DO $guard$
BEGIN
  IF to_regclass('public.commerce_products') IS NULL THEN
    RAISE NOTICE 'public.commerce_products does not exist yet: run scripts/db-migration-v33-commerce.js, then apply this file again';
    RETURN;
  END IF;

  -- The table was created with a nullable column; this only matters for a database that differs
  ALTER TABLE public.commerce_products ALTER COLUMN inventory_count DROP NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'commerce_products' AND column_name = 'stock_tracked'
  ) THEN
    UPDATE public.commerce_products SET inventory_count = NULL WHERE inventory_count = 100;
    ALTER TABLE public.commerce_products
      ADD COLUMN stock_tracked boolean GENERATED ALWAYS AS (inventory_count IS NOT NULL) STORED;
  END IF;

  -- A product inserted without a stock value is untracked, not "100 in stock"
  ALTER TABLE public.commerce_products ALTER COLUMN inventory_count DROP DEFAULT;
END $guard$;
