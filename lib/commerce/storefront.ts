/**
 * The online store page (/s/<workspace slug>): a business's own shop website, made from its products.
 * Banners that slide, categories, every product with photo and price, a cart, and ordering from the
 * page (pick up or delivery, paid when it reaches the customer). Orders land in Orders like any other
 * (checkout_type 'website') and pop up on the team's phones.
 *
 * Settings live in organizations.storefront (JSON), set up on their own the first time they are saved.
 */

import { readReturnSettings, type ReturnSettings } from './returns'
import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'
import { normalizePhone } from '../public-api/keys'
import { isUuid } from '../record-visibility'
import type { ManualOrderInput } from './manual-order'
import { readyPartners } from './shipping'
import { readOptions, variantsFor } from './variant-store'
import { listDiscounts, publicOffers } from './discount-store'
import { isOpen } from './discounts'
import { STORE_PAGES, cleanPages, pageText, type StorePageKey } from './store-pages'
import { cleanImages, readVideo, type ProductVideo } from './product-media'
import { priceRange, variantInStock, variantPrice, type ProductOption } from './variants'

/** supabase/migrations/20261119_storefront.sql word for word. */
export const STOREFRONT_SQL = `-- The online store page's settings (banners, categories, colour, delivery). Safe to run more than once.
-- The app runs it on its own when first needed.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS storefront JSONB;
-- The business's own Razorpay account, for online payment on the store page (server only; never sent to a page)
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS store_razorpay_key_id TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS store_razorpay_key_secret TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS store_razorpay_webhook_secret TEXT;

NOTIFY pgrst, 'reload schema';
`

export const STOREFRONT_LOCK = 724519016
export const storefrontSchemaSetup = createAutoSetup('Online store', (connectionString) => runMigrationSql(connectionString, STOREFRONT_SQL, STOREFRONT_LOCK))

/** Run a database step; if the storefront column is missing, add it and try again. */
export async function withStorefrontSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = storefrontSchemaSetup): Promise<any> {
  const first = await step()
  if (!isMissingSchemaError(first.error, /storefront|store_razorpay/)) return first
  if (!(await setup.ensure())) return first
  let result = await step()
  for (let attempt = 1; attempt < 4 && isMissingSchemaError(result.error, /storefront|store_razorpay/); attempt++) {
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
  /** How customers pay: on delivery / pick up, online (Razorpay), or their choice. */
  payment: 'later' | 'online' | 'both'
  /** Customers may sign in with Google to see their orders, track them and keep their cart. */
  accounts: boolean
  /** Info and policy pages (About, Shipping, Returns, Terms, Privacy, Contact): the business's own words. */
  pages: Partial<Record<StorePageKey, string>>
}

export const MAX_BANNERS = 8
export const MAX_CATEGORIES = 40

export function defaultStorefront(): StorefrontSettings {
  return {
    enabled: false, title: '', tagline: '', logo: '', colour: STORE_COLOURS[0], announcement: '',
    banners: [], categories: [], pickup: true, delivery: true, delivery_note: '', delivery_fee: null, free_delivery_from: null,
    min_order: 0, whatsapp: '', phone: '', address: '', about: '', show_out_of_stock: false, payment: 'later', accounts: true, pages: {},
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
    pages: cleanPages(raw.pages),
    payment: raw.payment === 'online' || raw.payment === 'both' ? raw.payment : 'later',
    accounts: raw.accounts !== false,
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
  /** Size, Colour…: when set, the shopper picks one of `variants`. */
  options?: ProductOption[]
  variants?: StoreVariant[]
  /** Lowest price over the options (the card says "from"). */
  priceFrom?: number
  /** More photos after the main one, and a video to play on the product page. */
  images?: string[]
  video?: ProductVideo | null
}

export interface StoreVariant {
  id: string
  name: string
  options: Record<string, string>
  price: number
  inStock: boolean
  image: string
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
  organization: { id: string; name: string; slug: string; currency: string; domain: string | null }
  settings: StorefrontSettings
  products: StoreProduct[]
  categories: StoreCategory[]
  /** The delivery charge rule in force (the page's own, else the store's shipping settings). */
  fees: { fee: number; freeFrom: number }
  /** How customers can pay right now: online needs the business's Razorpay keys. */
  pay: { online: boolean; later: boolean }
  /** A courier partner is connected, so the page can check a PIN code. */
  pinCheck?: boolean
  /** Offers that apply by themselves ("Buy 2 get 1 free"), and whether any code exists. */
  offers?: { title: string; kind: string; min_order: number }[]
  hasCodes?: boolean
  /** Customers can ask for a return in My orders, within this many days of delivery */
  returns?: ReturnSettings
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,120}$/i
const DOMAIN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/

/** The store page for a slug, or null when there is none, it is switched off, or the store is off. */
export async function loadStore(db: any, slug: string): Promise<StorePage | null> {
  // A business's own domain (shop.theirname.com) comes here in place of the slug
  const domain = String(slug || '').toLowerCase()
  const byDomain = DOMAIN.test(domain)
  if (!byDomain && !SLUG.test(slug)) return null
  const { data: org } = byDomain
    ? await db.from('organizations').select('*').eq('store_domain', domain).maybeSingle()
    : await db.from('organizations').select('*').eq('slug', slug).maybeSingle()
  if (!org || org.enable_commerce === false) return null
  const settings = readStorefront(org.storefront)
  if (!settings.enabled) return null
  const { data: rows } = await db.from('commerce_products')
    .select('*')
    .eq('organization_id', org.id)
    .order('title', { ascending: true })
    .limit(1000)
  const products: StoreProduct[] = (rows || [])
    .map((p: any) => ({
      id: p.id, title: text(p.title, 150), description: longText(p.description, 2000), price: Number(p.price) || 0,
      currency: String(p.currency || org.currency || 'INR').toUpperCase(), image: isImageUrl(p.image_url) ? p.image_url : '',
      category: text(p.category, 60) || 'Other', inStock: p.is_available !== false && (p.inventory_count ?? 1) > 0,
      options: readOptions(p.options),
      images: cleanImages(p.images).filter((url) => isImageUrl(url)),
      video: readVideo(p.video_url),
    }))
  // Products with options: each combination's price, stock and photo
  const withOptions = products.filter((p) => p.options && p.options.length)
  const variantMap = withOptions.length ? await variantsFor(db, org.id, withOptions.map((p) => p.id)) : new Map()
  for (const p of products) {
    const variants = (variantMap.get(p.id) || []).filter((v: any) => v.active && v.id)
    if (!p.options?.length || !variants.length) { delete p.options; continue }
    const list: StoreVariant[] = variants.map((v: any) => ({ id: v.id, name: v.name, options: v.options, price: variantPrice(v, p.price), inStock: p.inStock && variantInStock(v), image: isImageUrl(v.image_url) ? v.image_url : '' }))
    p.variants = list
    p.inStock = list.some((v) => v.inStock)
    p.priceFrom = priceRange(p.price, variants).min
  }
  const shownProducts = products.filter((p: StoreProduct) => p.inStock || settings.show_out_of_stock)
  const discounts = await listDiscounts(db, org.id)
  return {
    organization: { id: org.id, name: settings.title || org.name || 'Store', slug: org.slug, currency: String(org.currency || 'INR').toUpperCase(), domain: org.store_domain || null },
    settings,
    products: shownProducts,
    categories: storeCategories(settings, shownProducts),
    pay: payOptions(settings, Boolean(String(org.store_razorpay_key_id || '').trim() && String(org.store_razorpay_key_secret || '').trim())),
    pinCheck: settings.delivery && readyPartners(org).length > 0,
    returns: readReturnSettings(org.shop_returns),
    offers: publicOffers(discounts),
    hasCodes: discounts.some((d) => d.code !== null && isOpen(d)),
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
    payOnline: page.pay.online, payLater: page.pay.later,
    accounts: s.accounts, domain: page.organization.domain, pinCheck: page.pinCheck === true,
    offers: page.offers || [], hasCodes: page.hasCodes === true,
    returns: page.returns || { on: false, days: 7 },
    // Which info pages have something to show (for the footer links)
    pages: STORE_PAGES.filter((key) => pageText(key, s.pages, { name: page.organization.name, about: s.about, phone: s.phone, whatsapp: s.whatsapp, address: s.address })),
  }
}
export type StoreView = ReturnType<typeof storeView>

/** Ways to pay on the page: online only when the business's Razorpay is connected; never none. */
export function payOptions(settings: Pick<StorefrontSettings, 'payment'>, razorpayConnected: boolean): { online: boolean; later: boolean } {
  const online = razorpayConnected && settings.payment !== 'later'
  return { online, later: !online || settings.payment !== 'online' }
}

/** The delivery charge for an order of this much, by the store page's own rule. */
export function deliveryCharge(settings: StorefrontSettings, subtotal: number, org: { commerce_default_shipping_fee?: unknown; commerce_free_shipping_threshold?: unknown } = {}): number {
  const fee = settings.delivery_fee ?? (Number(org.commerce_default_shipping_fee) || 0)
  const freeFrom = settings.free_delivery_from ?? (Number(org.commerce_free_shipping_threshold) || 0)
  return freeFrom > 0 && subtotal >= freeFrom ? 0 : fee
}

/** An order placed on the page: checked against what the page offers, prices from the product list. */
export function parseStoreOrder(body: any, page: StorePage): { order: ManualOrderInput; subtotal: number; pay: 'online' | 'later' } | { error: string } {
  const name = text(body?.name, 120)
  if (name.length < 2) return { error: 'Please enter your name.' }
  const phone = normalizePhone(body?.phone)
  if (!phone) return { error: 'Please enter your mobile number with its country code, like +91 98765 43210.' }
  const handover = body?.handover === 'delivery' ? 'delivery' : 'pickup'
  if (handover === 'delivery' && !page.settings.delivery) return { error: 'This store does not deliver. Please choose pick up.' }
  if (handover === 'pickup' && !page.settings.pickup) return { error: 'This store only delivers. Please add your address.' }
  const pay: 'online' | 'later' = body?.pay === 'online' ? 'online' : 'later'
  if (pay === 'online' && !page.pay.online) return { error: 'Online payment is not available here right now. Please choose to pay on delivery or pick up.' }
  if (pay === 'later' && !page.pay.later) return { error: 'Please pay online to place this order.' }
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
    if (product.variants?.length) {
      // A product with options is ordered as one of its combinations, at that combination's price
      const variant = product.variants.find((v) => v.id === line?.variantId)
      if (!variant) return { error: `Please choose the ${product.options!.map((o) => o.name.toLowerCase()).join(' and ')} for ${product.title}.` }
      if (!variant.inStock) return { error: `${product.title} (${variant.name}) is out of stock. Please remove it from your cart.` }
      items.push({ productId: product.id, variantId: variant.id, variantName: variant.name, title: `${product.title} · ${variant.name}`, price: variant.price, quantity })
      subtotal += variant.price * quantity
      continue
    }
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
    pay,
    order: { channel: 'website', customer: { contactId: null, name, phone }, items, handover, paid: false, paymentMethod: null, shippingFee: null, address, note: longText(body?.note, 500) || null },
  }
}

/** What the business already has, for filling a new store page. */
export interface StoreSuggestionInput {
  appUrl: string
  organization: {
    name?: string | null
    currency?: string | null
    contact_phone?: string | null
    contact_address?: string | null
    whatsapp_default_phone?: string | null
    commerce_default_shipping_fee?: unknown
    commerce_free_shipping_threshold?: unknown
  }
  /** Front Desk business details, when it has them. */
  salon?: { business_name?: string | null; address?: string | null; phone?: string | null; logo_url?: string | null } | null
  products: { title?: string | null; category?: string | null; image_url?: string | null }[]
  colour?: string
}

/** The web address of a picture made for a store page (drawn by lib/commerce/store-art.ts). */
export function artUrl(appUrl: string, kind: 'banner' | 'logo' | 'tile', options: { colour: string; name: string; design?: number }): string {
  const params = new URLSearchParams({ kind, c: options.colour.replace('#', ''), name: options.name.slice(0, 80) })
  if (options.design !== undefined) params.set('n', String(options.design))
  return `${appUrl.replace(/\/$/, '')}/api/public/store-art?${params.toString()}`
}

const money = (value: number, currency?: string | null) =>
  (String(currency || 'INR').toUpperCase() === 'INR' ? '₹' : `${String(currency).toUpperCase()} `) + value.toLocaleString('en-IN', { maximumFractionDigits: 2 })

/**
 * A full store page made from the business's own details: its name, logo, phone, address, WhatsApp,
 * delivery charges, and its products' categories and photos. Banners, a logo and category pictures
 * are made for it (store-art) wherever it has no photo. Nothing is saved until the business saves.
 */
export function suggestStorefront(input: StoreSuggestionInput): StorefrontSettings {
  const org = input.organization || {}
  const salon = input.salon || {}
  const colour = /^#[0-9A-F]{6}$/i.test(input.colour || '') ? input.colour!.toUpperCase() : STORE_COLOURS[0]
  const name = text(salon.business_name || org.name || 'Our store', 80)

  // Categories by how many products they have, each with its first photo
  const byCategory = new Map<string, { name: string; count: number; image: string }>()
  for (const p of input.products || []) {
    const category = text(p.category, 60) || 'Other'
    const key = category.toLowerCase()
    const entry = byCategory.get(key) || { name: category, count: 0, image: '' }
    entry.count++
    if (!entry.image && isImageUrl(p.image_url)) entry.image = String(p.image_url).trim()
    byCategory.set(key, entry)
  }
  const ranked = [...byCategory.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  const top = ranked.filter((c) => c.name !== 'Other').slice(0, 3)

  const fee = amount(org.commerce_default_shipping_fee)
  const freeFrom = amount(org.commerce_free_shipping_threshold)
  const whatsapp = normalizePhone(org.whatsapp_default_phone) || ''
  const phone = normalizePhone(org.contact_phone) || normalizePhone(salon.phone) || ''
  const address = longText(org.contact_address || salon.address || '', 300)

  const tagline = top.length ? `${top.map((c) => c.name).join(', ')}${ranked.length > top.length ? ' and more' : ''}. Order online in a few taps.` : `Order online from ${name} in a few taps.`
  const announcement = freeFrom ? `Free delivery on orders above ${money(freeFrom, org.currency)}` : whatsapp ? 'Order here or message us on WhatsApp' : ''
  const deliveryNote = [
    fee ? `Delivery charge ${money(fee, org.currency)}.` : '',
    freeFrom ? `Free delivery on orders above ${money(freeFrom, org.currency)}.` : '',
    'We call or message you to confirm the delivery time.',
  ].filter(Boolean).join(' ')

  const banners: StoreBanner[] = [
    { image: artUrl(input.appUrl, 'banner', { colour, name, design: 0 }), title: `Welcome to ${name}`, text: text(tagline, 140), button: 'Shop now', category: '', link: '' },
    ...top.map((c, i) => ({
      image: artUrl(input.appUrl, 'banner', { colour, name, design: i + 1 }),
      title: c.name,
      text: `${c.count} ${c.count === 1 ? 'product' : 'products'} to choose from`,
      button: 'See all',
      category: c.name,
      link: '',
    })),
  ]
  if (freeFrom && banners.length < 4) {
    banners.push({ image: artUrl(input.appUrl, 'banner', { colour, name, design: 3 }), title: 'Free delivery', text: `On orders above ${money(freeFrom, org.currency)}`, button: 'Start shopping', category: '', link: '' })
  }

  return readStorefront({
    enabled: false,
    title: name,
    tagline,
    logo: isImageUrl(salon.logo_url) ? salon.logo_url : artUrl(input.appUrl, 'logo', { colour, name }),
    colour,
    announcement,
    banners,
    categories: ranked.slice(0, MAX_CATEGORIES).map((c, i) => ({ name: c.name, image: c.image || artUrl(input.appUrl, 'tile', { colour, name: c.name, design: i }) })),
    pickup: true,
    delivery: true,
    delivery_note: deliveryNote,
    delivery_fee: fee,
    free_delivery_from: freeFrom,
    min_order: 0,
    whatsapp,
    phone,
    address,
    about: `Welcome to ${name}. Look through our products, add what you like to the cart and order right here${whatsapp ? ' or on WhatsApp' : ''}. ${address ? 'Pick up from our shop or get it delivered.' : 'We deliver to your door.'}`,
    show_out_of_stock: false,
    payment: 'later',
  })
}

/** The business's saved page with any blank part taken from the suggestion (nothing typed is replaced). */
export function fillStorefront(current: StorefrontSettings, suggested: StorefrontSettings): StorefrontSettings {
  const out: StorefrontSettings = { ...current }
  for (const key of ['title', 'tagline', 'logo', 'announcement', 'delivery_note', 'whatsapp', 'phone', 'address', 'about'] as const) {
    if (!String(out[key] || '').trim()) out[key] = suggested[key]
  }
  if (out.delivery_fee === null) out.delivery_fee = suggested.delivery_fee
  if (out.free_delivery_from === null) out.free_delivery_from = suggested.free_delivery_from
  if (!out.banners.length) out.banners = suggested.banners
  const names = new Set(out.categories.map((c) => c.name.toLowerCase()))
  out.categories = [
    ...out.categories.map((c) => ({ ...c, image: c.image || suggested.categories.find((s) => s.name.toLowerCase() === c.name.toLowerCase())?.image || '' })),
    ...suggested.categories.filter((s) => !names.has(s.name.toLowerCase())),
  ].slice(0, MAX_CATEGORIES)
  return out
}

/** The cart as the discount rules need it: each line's unit price (the option's, else the product's). */
export function cartForDiscount(page: StorePage, items: { productId: string | null; price: number | null; quantity: number }[], delivery: number) {
  const byId = new Map(page.products.map((p) => [p.id, p]))
  const lines = items.map((i) => ({ price: i.price ?? (i.productId ? byId.get(i.productId)?.price ?? 0 : 0), quantity: i.quantity }))
  const subtotal = Math.round(lines.reduce((sum, l) => sum + l.price * l.quantity, 0) * 100) / 100
  return { lines, subtotal, delivery }
}
