-- The shopping assistant searches a store's products word by word with ILIKE '%word%' on title,
-- description and category (lib/commerce/shopping-assistant.ts). Without trigram indexes each search
-- is a sequential scan of commerce_products; with them, stores with tens of thousands of products
-- answer quickly. The code works without this migration. Safe to run more than once.
-- On Supabase, pg_trgm is available as an extension (Database -> Extensions) and this statement enables it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS commerce_products_title_trgm
  ON public.commerce_products USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS commerce_products_description_trgm
  ON public.commerce_products USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS commerce_products_category_trgm
  ON public.commerce_products USING gin (category gin_trgm_ops);
