/**
 * The database side of product photos and video (rules in product-media.ts). Server only.
 */

import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'

/** supabase/migrations/20261126_shop_product_media.sql word for word. */
export const MEDIA_SQL = `-- More photos and a video for each product. Safe to run more than once. The app runs it when first needed.
ALTER TABLE commerce_products ADD COLUMN IF NOT EXISTS images JSONB;
ALTER TABLE commerce_products ADD COLUMN IF NOT EXISTS video_url TEXT;
NOTIFY pgrst, 'reload schema';
`
export const MEDIA_LOCK = 724519023
export const mediaSchemaSetup = createAutoSetup('Product photos', (connectionString) => runMigrationSql(connectionString, MEDIA_SQL, MEDIA_LOCK))

export async function withMediaSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = mediaSchemaSetup): Promise<any> {
  const first = await step()
  if (!isMissingSchemaError(first.error, /images|video_url/)) return first
  if (!(await setup.ensure())) return first
  let result = await step()
  for (let attempt = 1; attempt < 4 && isMissingSchemaError(result.error, /images|video_url/); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
    result = await step()
  }
  return result
}
