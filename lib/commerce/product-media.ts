/**
 * More photos and a short video for each product: commerce_products.images (up to 8 https links, besides the
 * main photo) and video_url (a YouTube link or a direct .mp4 / .webm link). Pure rules, safe in the browser;
 * the auto-migration is in product-media-store.ts.
 */

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
