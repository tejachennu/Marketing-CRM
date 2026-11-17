/**
 * Customer reviews with photos for the shop's products. Pure rules (safe in the browser): cleaning what a
 * customer sends, and the star summary shown on the product page.
 */

export const MAX_REVIEW_PHOTOS = 4

export interface ReviewInput {
  productId: string
  rating: number
  text: string
  photos: string[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** One product's review as sent by the customer, checked; null when it is not a real review. */
export function cleanReview(raw: any): ReviewInput | null {
  const productId = String(raw?.productId || '')
  const rating = Math.round(Number(raw?.rating))
  if (!UUID.test(productId) || !(rating >= 1 && rating <= 5)) return null
  const text = String(raw?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000)
  const photos = (Array.isArray(raw?.photos) ? raw.photos : []).map((u: unknown) => String(u || '').trim()).filter((u: string) => /^https:\/\/\S{8,1000}$/.test(u)).slice(0, MAX_REVIEW_PHOTOS)
  return { productId, rating, text, photos }
}

export interface PublicReview {
  rating: number
  text: string
  photos: string[]
  name: string
  at: string
}

/** First name and last initial only ("Asha R."): enough to be real, not enough to find someone. */
export function publicName(name: unknown): string {
  const parts = String(name ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  if (!parts.length) return 'A customer'
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0]
}

export function ratingSummary(reviews: { rating: number }[]): { average: number; count: number; stars: number[] } {
  const stars = [0, 0, 0, 0, 0]
  for (const r of reviews) if (r.rating >= 1 && r.rating <= 5) stars[r.rating - 1]++
  const count = stars.reduce((a, b) => a + b, 0)
  const average = count ? Math.round((reviews.reduce((s, r) => s + (r.rating >= 1 && r.rating <= 5 ? r.rating : 0), 0) / count) * 10) / 10 : 0
  return { average, count, stars }
}
