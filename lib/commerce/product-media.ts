/**
 * More photos and a short video for each product: commerce_products.images (up to 8 https links, besides the
 * main photo) and video_url (a YouTube link or a direct .mp4 / .webm link). Pure rules at the top (safe in the
 * browser), the auto-migration below.
 */

import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'

export const MAX_EXTRA_PHOTOS = 8

/** https links only, no repeats, at most 8. */
export function cleanImages(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : []
  const out: string[] = []
  for (const v of list) {
    const url = String(v ?? '').trim()
    if (/^https:\/\/\S{8,1000}$/.test(url) && !out.includes(url)) out.push(url)
    if (out.length >= MAX_EXTRA_PHOTOS) break
  }
  return out
}

export type ProductVideo = { kind: 'youtube'; id: string; url: string } | { kind: 'file'; src: string; url: string }

/** A video link the store page can play: YouTube (watch, youtu.be, shorts, embed) or a direct video file. */
export function readVideo(raw: unknown): ProductVideo | null {
  const url = String(raw ?? '').trim()
  if (!/^https:\/\//.test(url) || url.length > 1000) return null
  const yt = url.match(/^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/)
  if (yt) return { kind: 'youtube', id: yt[1], url }
  if (/\.(mp4|webm|mov)(\?.*)?$/i.test(url)) return { kind: 'file', src: url, url }
  return null
}

/** The values the product form sent for photos and video; null when it sent neither. */
export function productMediaValues(product: any): { images: string[]; video_url: string | null } | null {
  if (!product || (product.images === undefined && product.video_url === undefined)) return null
  const video = readVideo(product.video_url)
  return { images: cleanImages(product.images), video_url: video ? video.url : null }
}

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
