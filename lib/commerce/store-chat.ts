/**
 * The store's AI chat (pure, browser-safe): products as knowledge for the AI, product cards for the answer, and a
 * clean chat history from the browser.
 */

import type { KnowledgeHit } from '../ai/knowledge-rules'
import { discountPercent, searchProducts, shownPrice, type BrowseProduct } from './store-browse'
import { moneyText } from '../money'

const rupees = (n: number, currency: string) => moneyText(n, currency)

export interface ChatProduct extends BrowseProduct {
  image?: string
  options?: { name: string; values: string[] }[]
}

/** The products matching a search text, written for the AI (price, saving, stock, options, short description). */
export function chatProductHits(products: ChatProduct[], search: string, currency = 'INR', max = 4): KnowledgeHit[] {
  const found = searchProducts(products, search, max)
  return found.map((p) => {
    const off = discountPercent(p)
    const facts = [
      `Price: ${p.variants?.length ? 'from ' : ''}${rupees(shownPrice(p), currency)}${off ? ` (MRP ${rupees(p.mrp!, currency)}, ${off}% off)` : ''}`,
      p.inStock ? 'In stock' : 'Out of stock right now',
      p.brand ? `Brand: ${p.brand}` : '',
      `Category: ${p.category}`,
      p.options?.length ? `Choices: ${p.options.map((o) => `${o.name} (${o.values.join(', ')})`).join('; ')}` : '',
      p.rating ? `Rated ${p.rating} from ${p.ratingCount || 0} reviews` : '',
      p.description ? `About: ${String(p.description).replace(/\s+/g, ' ').slice(0, 300)}` : '',
    ].filter(Boolean)
    return { id: p.id, title: p.title, content: facts.join('\n'), score: 1, similarity: null, wordScore: null, kind: 'product' as const }
  })
}

export interface ChatProductCard {
  id: string
  title: string
  price: number
  mrp: number | null
  image: string
  inStock: boolean
  hasOptions: boolean
}

/** The product cards under an answer: only the products the answer used (none on a hand-off or a "don't know"). */
export function chatProductCards(products: ChatProduct[], hits: KnowledgeHit[], answer: { handoff: boolean; status: string; used: number[] }): ChatProductCard[] {
  if (answer.handoff || (answer.status !== 'answered' && answer.status !== 'chat')) return []
  const ids = [...new Set(answer.used.map((n) => hits[n - 1]).filter((h) => h?.kind === 'product').map((h) => h!.id))]
  return ids.slice(0, 4).map((id) => products.find((p) => p.id === id)).filter(Boolean).map((p) => ({
    id: p!.id, title: p!.title, price: shownPrice(p!), mrp: p!.mrp && p!.mrp > shownPrice(p!) ? p!.mrp : null, image: p!.image || '', inStock: p!.inStock, hasOptions: Boolean(p!.variants?.length),
  }))
}

/** The last 8 turns the browser sent, cleaned (only user / assistant, ≤600 characters each). */
export function cleanChatHistory(raw: unknown): { role: 'user' | 'assistant'; content: string }[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-8)
    .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 600) }))
}
