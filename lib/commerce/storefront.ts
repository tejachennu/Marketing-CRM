/**
 * The online store page (/s/<workspace slug>): a business's own shop website, made from its products.
 * Banners that slide, categories, every product with photo and price, a cart, and ordering from the
 * page (pick up or delivery, paid when it reaches the customer). Orders land in Orders like any other
 * (checkout_type 'website') and pop up on the team's phones.
 *
 * Settings live in organizations.storefront (JSON), set up on their own the first time they are saved.
 */

import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'
import { normalizePhone } from '../public-api/keys'
import { isUuid } from '../record-visibility'
import type { ManualOrderInput } from './manual-order'

/** supabase/migrations/20261119_storefront.sql word for word. */
export const STOREFRONT_SQL = `-- The online store page's settings (banners, categories, colour, delivery). Safe to run more than once.
-- The app runs it on its own when first needed.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS storefront JSONB;

NOTIFY pgrst, 'reload schema';
`

export const STOREFRONT_LOCK = 724519016
export const storefrontSchemaSetup = createAutoSetup('Online store', (connectionString) => runMigrationSql(connectionString, STOREFRONT_SQL, STOREFRONT_LOCK))

/** Run a database step; if the storefront column is missing, add it and try again. */
export async function withStorefrontSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = storefrontSchemaSetup): Promise<any> {
  const first = await step()
  if (!isMissingSchemaError(first.error, /storefront/)) return first
  if (!(await setup.ensure())) return first
  let result = await step()
  for (let attempt = 1; attempt < 4 && isMissingSchemaError(result.error, /storefront/); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
    result = await step()
  }
  return result
}

/** Colours a business can pick for its page (one main colour; the rest stays plain). */
export const STORE_COLOURS = ['#1D5BEA', '#0E1B3D', '#008069', '#B45309', '#BE185D', '#6D28D9', '#0F766E', '#B91C1C'] as const

export interface StoreBanner {
  image: string
  title: string
  text: string
  /** The button's words; empty = no button (a tap on the banner still works). */
  button: string
  /** Opens this category, or this web address. */
  category: string
  link: string
}

export interface StoreCategory {
  name: string
  image: string
}

export interface StorefrontSettings {
  enabled: boolean
  title: string
  tagline: string
  logo: string
  colour: string
  announcement: string
  banners: StoreBanner[]
  /** Category order and pictures. Categories not listed follow, in name order. */
  categories: StoreCategory[]
  pickup: boolean
  delivery: boolean
  /** Shown at checkout: delivery areas, times, charges. */
  delivery_note: string
  delivery_fee: number | null
  free_delivery_from: number | null
  min_order: number
  whatsapp: string
  phone: string
  address: string
  about: string
  show_out_of_stock: boolean
}

export const MAX_BANNERS = 8
export const MAX_CATEGORIES = 40

export function defaultStorefront(): StorefrontSettings {
  return {
    enabled: false, title: '', tagline: '', logo: '', colour: STORE_COLOURS[0], announcement: '',
    banners: [], categories: [], pickup: true, delivery: true, delivery_note: '', delivery_fee: null, free_delivery_from: null,
    min_order: 0, whatsapp: '', phone: '', address: '', about: '', show_out_of_stock: false,
  }
}

const text = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const longText = (value: unknown, max: number) => String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max)

/** A picture the page may show: a web address (https) of a photo. */
export function isImageUrl(value: unknown): boolean {
  const url = String(value ?? '').trim()
  if (!url || url.length > 2000) return false
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

function safeLink(value: unknown): string {
  const url = String(value ?? '').trim()
  if (!url) return ''
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString().slice(0, 500) : ''
  } catch {
    return ''
  }
}

const amount = (value: unknown): number | null => {
  if (value === '' || value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

/** What is saved, from what was stored or typed: anything unusable is dropped or reset, never trusted. */
export function readStorefront(raw: any): StorefrontSettings {
  const base = defaultStorefront()
  if (!raw || typeof raw !== 'object') return base
  const colour = String(raw.colour || '').toUpperCase()
  const banners: StoreBanner[] = (Array.isArray(raw.banners) ? raw.banners : [])
    .filter((b: any) => b && isImageUrl(b.image))
    .slice(0, MAX_BANNERS)
    .map((b: any) => ({ image: String(b.image).trim(), title: text(b.title, 60), text: text(b.text, 140), button: text(b.button, 24), category: text(b.category, 60), link: safeLink(b.link) }))
  const seen = new Set<string>()
  const categories: StoreCategory[] = []
  for (const c of Array.isArray(raw.categories) ? raw.categories : []) {
    const name = text(c?.name, 60)
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    categories.push({ name, image: isImageUrl(c?.image) ? String(c.image).trim() : '' })
    if (categories.length >= MAX_CATEGORIES) break
  }
  const pickup = raw.pickup !== false
  const delivery = raw.delivery !== false
  return {
    enabled: raw.enabled === true,
    title: text(raw.title, 80),
    tagline: text(raw.tagline, 160),
    logo: isImageUrl(raw.logo) ? String(raw.logo).trim() : '',
    colour: /^#[0-9A-F]{6}$/.test(colour) ? colour : base.colour,
    announcement: text(raw.announcement, 140),
    banners,
    categories,
    // A shop always offers at least one way to get the order
    pickup: pickup || !delivery,
    delivery,
    delivery_note: longText(raw.delivery_note, 400),
    delivery_fee: amount(raw.delivery_fee),
    free_delivery_from: amount(raw.free_delivery_from),
    min_order: amount(raw.min_order) || 0,
    whatsapp: normalizePhone(raw.whatsapp) || '',
    phone: normalizePhone(raw.phone) || '',
    address: longText(raw.address, 300),
    about: longText(raw.about, 1200),
    show_out_of_stock: raw.show_out_of_stock === true,
  }
}

export interface StoreProduct {
  id: string
  title: string
  description: string
  price: number
  currency: string
  image: string
  category: string
  inStock: boolean
}

/** The categories in the page's order: the business's order first, then the rest by name. */
export function storeCategories(settings: StorefrontSettings, products: StoreProduct[]): StoreCategory[] {
  const counts = new Map<string, { name: string; image: string }>()
  for (const p of products) {
    const key = p.category.toLowerCase()
    if (!counts.has(key)) counts.set(key, { name: p.category, image: p.image })
    else if (!counts.get(key)!.image && p.image) counts.get(key)!.image = p.image
  }
  const ordered: StoreCategory[] = []
  for (const c of settings.categories) {
    const found = counts.get(c.name.toLowerCase())
    if (!found) continue
    ordered.push({ name: found.name, image: c.image || found.image })
    counts.delete(c.name.toLowerCase())
  }
  return [...ordered, ...[...counts.values()].sort((a, b) => a.name.localeCompare(b.name))]
}

export interface StorePage {
  organization: { id: string; name: string; slug: string; currency: string }
  settings: StorefrontSettings
  products: StoreProduct[]
  categories: StoreCategory[]
  /** The delivery charge rule in force (the page's own, else the store's shipping settings). */
  fees: { fee: number; freeFrom: number }
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,120}$/i

/** The store page for a slug, or null when there is none, it is switched off, or the store is off. */
export async function loadStore(db: any, slug: string): Promise<StorePage | null> {
  if (!SLUG.test(slug)) return null
  const { data: org } = await db.from('organizations').select('*').eq('slug', slug).maybeSingle()
  if (!org || org.enable_commerce === false) return null
  const settings = readStorefront(org.storefront)
  if (!settings.enabled) return null
  const { data: rows } = await db.from('commerce_products')
    .select('id, title, description, price, currency, image_url, category, is_available, inventory_count')
    .eq('organization_id', org.id)
    .order('title', { ascending: true })
    .limit(1000)
  const products: StoreProduct[] = (rows || [])
    .map((p: any) => ({
      id: p.id, title: text(p.title, 150), description: longText(p.description, 2000), price: Number(p.price) || 0,
      currency: String(p.currency || org.currency || 'INR').toUpperCase(), image: isImageUrl(p.image_url) ? p.image_url : '',
      category: text(p.category, 60) || 'Other', inStock: p.is_available !== false && (p.inventory_count ?? 1) > 0,
    }))
    .filter((p: StoreProduct) => p.inStock || settings.show_out_of_stock)
  return {
    organization: { id: org.id, name: settings.title || org.name || 'Store', slug: org.slug, currency: String(org.currency || 'INR').toUpperCase() },
    settings,
    products,
    categories: storeCategories(settings, products),
    fees: {
      fee: settings.delivery_fee ?? (Number(org.commerce_default_shipping_fee) || 0),
      freeFrom: settings.free_delivery_from ?? (Number(org.commerce_free_shipping_threshold) || 0),
    },
  }
}

/** What the page needs, and nothing more (no ids of the workspace, no settings it does not show). */
export function storeView(page: StorePage) {
  const s = page.settings
  return {
    name: page.organization.name, slug: page.organization.slug, currency: page.organization.currency,
    tagline: s.tagline, logo: s.logo, colour: s.colour, announcement: s.announcement, banners: s.banners,
    categories: page.categories, products: page.products, pickup: s.pickup, delivery: s.delivery,
    deliveryNote: s.delivery_note, deliveryFee: page.fees.fee, freeFrom: page.fees.freeFrom, minOrder: s.min_order,
    whatsapp: s.whatsapp, phone: s.phone, address: s.address, about: s.about,
  }
}
export type StoreView = ReturnType<typeof storeView>

/** The delivery charge for an order of this much, by the store page's own rule. */
export function deliveryCharge(settings: StorefrontSettings, subtotal: number, org: { commerce_default_shipping_fee?: unknown; commerce_free_shipping_threshold?: unknown } = {}): number {
  const fee = settings.delivery_fee ?? (Number(org.commerce_default_shipping_fee) || 0)
  const freeFrom = settings.free_delivery_from ?? (Number(org.commerce_free_shipping_threshold) || 0)
  return freeFrom > 0 && subtotal >= freeFrom ? 0 : fee
}

/** An order placed on the page: checked against what the page offers, prices from the product list. */
export function parseStoreOrder(body: any, page: StorePage): { order: ManualOrderInput; subtotal: number } | { error: string } {
  const name = text(body?.name, 120)
  if (name.length < 2) return { error: 'Please enter your name.' }
  const phone = normalizePhone(body?.phone)
  if (!phone) return { error: 'Please enter your mobile number with its country code, like +91 98765 43210.' }
  const handover = body?.handover === 'delivery' ? 'delivery' : 'pickup'
  if (handover === 'delivery' && !page.settings.delivery) return { error: 'This store does not deliver. Please choose pick up.' }
  if (handover === 'pickup' && !page.settings.pickup) return { error: 'This store only delivers. Please add your address.' }
  const raw: any[] = Array.isArray(body?.items) ? body.items : []
  if (!raw.length) return { error: 'Your cart is empty.' }
  if (raw.length > 60) return { error: 'Please order at most 60 different products at once.' }
  const byId = new Map(page.products.map((p) => [p.id, p]))
  const items: ManualOrderInput['items'] = []
  let subtotal = 0
  for (const line of raw) {
    const product = isUuid(line?.productId) ? byId.get(line.productId) : undefined
    if (!product) return { error: 'Something in your cart is no longer sold here. Please remove it and try again.' }
    if (!product.inStock) return { error: `${product.title} is out of stock. Please remove it from your cart.` }
    const quantity = Number(line?.quantity)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) return { error: 'Please choose between 1 and 99 of each product.' }
    items.push({ productId: product.id, title: '', price: null, quantity })
    subtotal += product.price * quantity
  }
  subtotal = Math.round(subtotal * 100) / 100
  if (page.settings.min_order > 0 && subtotal < page.settings.min_order) return { error: `The smallest order here is ${page.settings.min_order}. Please add a little more.` }
  let address: Record<string, string> | null = null
  if (handover === 'delivery') {
    const a = body?.address || {}
    address = { full_name: name, phone_number: phone, address_line_1: text(a.address_line_1, 200), address_line_2: text(a.address_line_2, 200), city: text(a.city, 80), state: text(a.state, 80), pincode: text(a.pincode, 12) }
    if (!address.address_line_1 || !address.city) return { error: 'Please add your delivery address (house, street and city).' }
  }
  return {
    subtotal,
    order: { channel: 'website', customer: { contactId: null, name, phone }, items, handover, paid: false, paymentMethod: null, shippingFee: null, address, note: longText(body?.note, 500) || null },
  }
}
