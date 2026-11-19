/**
 * Browsing a store like a big marketplace: discounts, sort, filters, price ranges, deal and best-rated rails,
 * and a search that forgives spelling ("shampo", "radakrishnan", "kurthi") with suggestions as you type.
 * Pure and browser-safe (the store page runs it; the AI chat uses it to find products on the server too).
 */

import { editDistance, soundKey } from '../chat-language'

export interface BrowseProduct {
  id: string
  title: string
  description?: string
  category: string
  price: number
  priceFrom?: number
  mrp?: number
  brand?: string
  rating?: number
  ratingCount?: number
  inStock: boolean
  addedAt?: string
  variants?: unknown[]
}

/** The price a shopper pays (the lowest option's price for products with options). */
export function shownPrice(p: BrowseProduct): number {
  return p.variants?.length && p.priceFrom !== undefined ? p.priceFrom : p.price
}

/** Percent saved against the MRP, rounded down (0 when there is no MRP). */
export function discountPercent(p: Pick<BrowseProduct, 'mrp' | 'price' | 'priceFrom' | 'variants'>): number {
  const price = shownPrice(p as BrowseProduct)
  if (!p.mrp || !(p.mrp > price) || price <= 0) return 0
  return Math.floor((1 - price / p.mrp) * 100)
}

export type SortKey = 'popular' | 'price_low' | 'price_high' | 'newest' | 'discount'

export const SORT_LABELS: Record<SortKey, string> = {
  popular: 'Popular',
  price_low: 'Price: low to high',
  price_high: 'Price: high to low',
  newest: 'Newest first',
  discount: 'Biggest discount',
}

/** Popular = best rated with the most reviews, in stock first; ties keep the shop's own order. */
export function sortProducts<T extends BrowseProduct>(list: T[], sort: SortKey): T[] {
  const indexed = list.map((p, i) => ({ p, i }))
  const stock = (p: T) => (p.inStock ? 0 : 1)
  const score = (p: T) => (p.rating || 0) * Math.log2(2 + (p.ratingCount || 0))
  indexed.sort((a, b) => {
    const s = stock(a.p) - stock(b.p)
    if (s) return s
    let d = 0
    if (sort === 'price_low') d = shownPrice(a.p) - shownPrice(b.p)
    else if (sort === 'price_high') d = shownPrice(b.p) - shownPrice(a.p)
    else if (sort === 'newest') d = String(b.p.addedAt || '').localeCompare(String(a.p.addedAt || ''))
    else if (sort === 'discount') d = discountPercent(b.p) - discountPercent(a.p)
    else d = score(b.p) - score(a.p)
    return d || a.i - b.i
  })
  return indexed.map((x) => x.p)
}

export interface Filters {
  category?: string | null
  /** Price range [min, max]; max null = no top */
  price?: [number, number | null] | null
  inStock?: boolean
  minDiscount?: number
  minRating?: number
  brands?: string[]
}

export function filterProducts<T extends BrowseProduct>(list: T[], f: Filters): T[] {
  return list.filter((p) => {
    if (f.category && p.category !== f.category) return false
    const price = shownPrice(p)
    if (f.price && (price < f.price[0] || (f.price[1] !== null && price > f.price[1]))) return false
    if (f.inStock && !p.inStock) return false
    if (f.minDiscount && discountPercent(p) < f.minDiscount) return false
    if (f.minRating && (p.rating || 0) < f.minRating) return false
    if (f.brands?.length && !f.brands.includes(p.brand || '')) return false
    return true
  })
}

/** How many filters are on (for the "Filter (2)" button). */
export function filterCount(f: Filters): number {
  return [f.price, f.inStock, f.minDiscount, f.minRating, f.brands?.length].filter(Boolean).length
}

const NICE = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000]

/** Three or four price ranges that split this shop's products sensibly ("Under ₹500", "₹500 – ₹1,000", "₹1,000 and above"). */
export function priceRanges(list: BrowseProduct[]): [number, number | null][] {
  const prices = list.map(shownPrice).filter((n) => n > 0).sort((a, b) => a - b)
  if (prices.length < 4) return []
  const cut = (q: number) => {
    const v = prices[Math.floor(q * (prices.length - 1))]
    return NICE.reduce((best, n) => (Math.abs(n - v) < Math.abs(best - v) ? n : best), NICE[0])
  }
  const edges = [...new Set([cut(0.33), cut(0.66)])].sort((a, b) => a - b)
  const out: [number, number | null][] = [[0, edges[0]]]
  for (let i = 1; i < edges.length; i++) out.push([edges[i - 1], edges[i]])
  out.push([edges[edges.length - 1], null])
  return out
}

// ── Rails on the home page ──────────────────────────────────────────────────

/** Deals: in stock, at least 10% off, biggest saving first. */
export function dealProducts<T extends BrowseProduct>(list: T[], max = 12): T[] {
  return sortProducts(list.filter((p) => p.inStock && discountPercent(p) >= 10), 'discount').slice(0, max)
}

/** Best rated: in stock, 4 stars or more from at least 2 reviews. */
export function topRated<T extends BrowseProduct>(list: T[], max = 12): T[] {
  return sortProducts(list.filter((p) => p.inStock && (p.rating || 0) >= 4 && (p.ratingCount || 0) >= 2), 'popular').slice(0, max)
}

/** One rail per category with at least 3 products, most products first. */
export function categoryRails<T extends BrowseProduct>(list: T[], maxRails = 4, perRail = 12): { category: string; products: T[] }[] {
  const groups = new Map<string, T[]>()
  for (const p of list) groups.set(p.category, [...(groups.get(p.category) || []), p])
  return [...groups.entries()]
    .filter(([, items]) => items.length >= 3)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, maxRails)
    .map(([category, items]) => ({ category, products: sortProducts(items, 'popular').slice(0, perRail) }))
}

// ── Search that forgives spelling ───────────────────────────────────────────

const words = (text: string) => String(text || '').toLowerCase().normalize('NFKC').split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => w.length >= 2)

/** How well one typed word matches a product word: 3 same, 2 starts with it / sounds the same, 1 one letter off. */
function wordMatch(typed: string, word: string): number {
  if (typed === word) return 3
  if (word.startsWith(typed) && typed.length >= 2) return 2.5
  if (typed.length >= 4 && soundKey(typed) && soundKey(typed) === soundKey(word)) return 2
  if (typed.length >= 4 && Math.abs(typed.length - word.length) <= 1 && editDistance(typed, word) <= (typed.length >= 7 ? 2 : 1)) return 1.5
  if (typed.length >= 4 && word.length > typed.length && editDistance(typed, word.slice(0, typed.length)) <= 1) return 1
  return 0
}

/**
 * Products for a typed search, best first. Every typed word must match the title, brand, category or
 * description (spelling mistakes allowed); title matches count most.
 */
export function searchProducts<T extends BrowseProduct>(list: T[], query: string, max = 200): T[] {
  const typed = [...new Set(words(query))]
  if (!typed.length) return list.slice(0, max)
  const scored: { p: T; score: number; i: number }[] = []
  list.forEach((p, i) => {
    const fields: [string[], number][] = [[words(p.title), 3], [words(p.brand || ''), 2], [words(p.category), 2], [words(p.description || '').slice(0, 300), 1]]
    let total = 0
    for (const t of typed) {
      let best = 0
      for (const [ws, weight] of fields) for (const w of ws) best = Math.max(best, wordMatch(t, w) * weight)
      if (!best) return
      total += best
    }
    scored.push({ p, score: total + (p.inStock ? 0.5 : 0), i })
  })
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).slice(0, max).map((x) => x.p)
}

/** Suggestions under the search box: matching categories, then products. */
export function searchSuggestions<T extends BrowseProduct>(list: T[], query: string, max = 6): ({ kind: 'category'; name: string } | { kind: 'product'; product: T })[] {
  const q = query.trim()
  if (q.length < 2) return []
  const cats = [...new Set(list.map((p) => p.category))]
    .filter((c) => words(c).some((w) => words(q).some((t) => wordMatch(t, w) >= 1.5)))
    .slice(0, 2)
    .map((name) => ({ kind: 'category' as const, name }))
  const products = searchProducts(list, q, max - cats.length).map((product) => ({ kind: 'product' as const, product }))
  return [...cats, ...products]
}
