/**
 * How a store page looks: product layouts and the Instagram posts it shows. Pure and browser-safe
 * (the Website settings screen uses it too).
 */

export const STORE_LAYOUTS = ['grid', 'big', 'list', 'compact'] as const
export type StoreLayout = (typeof STORE_LAYOUTS)[number]
export const STORE_LAYOUT_INFO: Record<StoreLayout, { title: string; hint: string }> = {
  grid: { title: 'Tiles', hint: 'Two on a phone, four on a computer. Suits most shops.' },
  big: { title: 'Big photos', hint: 'One large photo at a time on a phone. Clothes, jewellery, decor.' },
  list: { title: 'List', hint: 'Small photo, name, price and Add in a row. Groceries, medicines.' },
  compact: { title: 'Small tiles', hint: 'Three on a phone, six on a computer. Many small items.' },
}
export const MAX_INSTAGRAM_POSTS = 9

/** An Instagram handle without the @ (letters, numbers, . and _), or ''. */
export function cleanInstagramHandle(value: unknown): string {
  const handle = String(value ?? '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '')
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? handle : ''
}

/** A post or reel link → its short code ("https://www.instagram.com/p/Cx1aB2/" → "p/Cx1aB2"); '' when it is not one. */
export function instagramPost(value: unknown): string {
  const m = String(value ?? '').trim().match(/^https?:\/\/(?:www\.)?instagram\.com\/(?:[A-Za-z0-9._]+\/)?(p|reel|tv)\/([A-Za-z0-9_-]{5,40})/i)
  return m ? `${m[1].toLowerCase() === 'tv' ? 'p' : m[1].toLowerCase()}/${m[2]}` : ''
}
