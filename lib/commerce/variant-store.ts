/**
 * Product options in the database: commerce_products.options, commerce_product_variants, and the variant
 * kept on each order line (commerce_order_items.variant_id / variant_name). Rules live in variants.ts.
 */

import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'
import { buildVariants, cleanOptions, type ProductOption, type Variant } from './variants'

/** supabase/migrations/20261124_shop_product_options.sql word for word. */
export const VARIANT_SQL = `-- Product options (size, colour…) with a price and stock for each combination. Safe to run more than once.
-- The app runs it on its own when first needed.
ALTER TABLE commerce_products ADD COLUMN IF NOT EXISTS options JSONB;

CREATE TABLE IF NOT EXISTS commerce_product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES commerce_products(id) ON DELETE CASCADE,
  options JSONB NOT NULL DEFAULT '{}'::jsonb,
  name TEXT NOT NULL,
  sku TEXT,
  price NUMERIC(12,2),
  stock INTEGER,
  image_url TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_commerce_product_variants_product ON commerce_product_variants(product_id, position);
CREATE INDEX IF NOT EXISTS idx_commerce_product_variants_org ON commerce_product_variants(organization_id);
ALTER TABLE commerce_product_variants ENABLE ROW LEVEL SECURITY;

ALTER TABLE commerce_order_items ADD COLUMN IF NOT EXISTS variant_id UUID;
ALTER TABLE commerce_order_items ADD COLUMN IF NOT EXISTS variant_name TEXT;

NOTIFY pgrst, 'reload schema';
`

export const VARIANT_LOCK = 724519021
export const variantSchemaSetup = createAutoSetup('Product options', (connectionString) => runMigrationSql(connectionString, VARIANT_SQL, VARIANT_LOCK))
const VARIANT_SCHEMA = /commerce_product_variants|variant_id|variant_name|options/

export async function withVariantSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = variantSchemaSetup): Promise<any> {
  const first = await step()
  if (!isMissingSchemaError(first.error, VARIANT_SCHEMA)) return first
  if (!(await setup.ensure())) return first
  let result = await step()
  for (let attempt = 1; attempt < 4 && isMissingSchemaError(result.error, VARIANT_SCHEMA); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
    result = await step()
  }
  return result
}

/** The variants of these products, by product id (in their order). No table yet = no variants. */
export async function variantsFor(db: any, organizationId: string, productIds: string[]): Promise<Map<string, Variant[]>> {
  const out = new Map<string, Variant[]>()
  if (!productIds.length) return out
  const { data, error } = await db.from('commerce_product_variants').select('*').eq('organization_id', organizationId).in('product_id', productIds).order('position', { ascending: true })
  if (error) return out
  for (const row of data || []) {
    const list = out.get(row.product_id) || []
    list.push({ id: row.id, options: row.options || {}, name: row.name, sku: row.sku, price: row.price === null ? null : Number(row.price), stock: row.stock, image_url: row.image_url, active: row.active !== false, position: row.position })
    out.set(row.product_id, list)
  }
  return out
}

export function readOptions(raw: unknown): ProductOption[] {
  const cleaned = cleanOptions(raw)
  return 'options' in cleaned ? cleaned.options : []
}

/**
 * Save a product's options and the price / stock / SKU / photo of each combination. Combinations that no
 * longer exist are removed; those that stay keep their id (orders already placed still point at them).
 */
export async function saveProductOptions(db: any, organizationId: string, productId: string, rawOptions: unknown, edits: Partial<Variant>[] = []): Promise<{ options: ProductOption[]; variants: Variant[] } | { error: string }> {
  const cleaned = cleanOptions(rawOptions)
  if ('error' in cleaned) return cleaned
  const { data: product } = await db.from('commerce_products').select('id').eq('organization_id', organizationId).eq('id', productId).maybeSingle()
  if (!product) return { error: 'Product not found.' }
  const saved = await withVariantSchema(() => db.from('commerce_products').update({ options: cleaned.options.length ? cleaned.options : null, updated_at: new Date().toISOString() }).eq('id', productId).eq('organization_id', organizationId))
  if (saved.error) return { error: saved.error.message || 'Could not save the options.' }
  const existing = (await variantsFor(db, organizationId, [productId])).get(productId) || []
  const next = buildVariants(cleaned.options, existing, edits)
  const keep = new Set(next.map((v) => v.id).filter(Boolean))
  const gone = existing.filter((v) => v.id && !keep.has(v.id)).map((v) => v.id as string)
  if (gone.length) await db.from('commerce_product_variants').delete().eq('organization_id', organizationId).in('id', gone)
  const now = new Date().toISOString()
  for (const v of next) {
    const row = { organization_id: organizationId, product_id: productId, options: v.options, name: v.name, sku: v.sku, price: v.price, stock: v.stock, image_url: v.image_url, active: v.active, position: v.position ?? 0, updated_at: now }
    if (v.id) await db.from('commerce_product_variants').update(row).eq('id', v.id).eq('organization_id', organizationId)
    else {
      const { data } = await withVariantSchema(() => db.from('commerce_product_variants').insert(row).select('id').single())
      if (data?.id) v.id = data.id
    }
  }
  return { options: cleaned.options, variants: next }
}

/**
 * Take stock off (negative) or put it back (positive), only for variants that track stock. Never below 0.
 * Compare-and-set on the old value, so two orders at once both count.
 */
export async function changeVariantStock(db: any, organizationId: string, variantId: string, delta: number): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: v } = await db.from('commerce_product_variants').select('id, stock').eq('organization_id', organizationId).eq('id', variantId).maybeSingle()
    if (!v || v.stock === null || v.stock === undefined) return
    const next = Math.max(0, Number(v.stock) + delta)
    const { data: done } = await db.from('commerce_product_variants').update({ stock: next, updated_at: new Date().toISOString() }).eq('id', variantId).eq('stock', v.stock).select('id')
    if (done?.length) return
  }
}

export const isMissingVariants = (error: unknown) => isMissingSchemaError(error, VARIANT_SCHEMA)
