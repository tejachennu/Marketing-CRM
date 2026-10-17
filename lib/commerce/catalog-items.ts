/**
 * Products as Meta catalog items: the field mapping for the Catalog Batch API and where each
 * product stands in the WhatsApp catalog. Pure rules, shared by the API routes, the dashboard
 * and the tests.
 *
 * Field names and limits follow Meta's Catalog Batch API reference for `item_type=PRODUCT_ITEM`:
 * https://developers.facebook.com/docs/marketing-api/catalog-batch/reference
 */

export const PRODUCT_CONDITIONS = ['new', 'refurbished', 'used'] as const
export type ProductCondition = (typeof PRODUCT_CONDITIONS)[number]

/** Catalog fields the product table has no column for. Kept in `metadata.attributes`. */
export interface ProductAttributes {
  brand?: string
  condition?: ProductCondition
  /** ISO 3166-1 alpha-2. Meta asks for it on items sold in India. */
  origin_country?: string
  /** A service or digital item, which WhatsApp exempts from the country-of-origin fields. */
  is_service?: boolean
  importer_name?: string
  importer_address?: { street1: string; city: string; country: string; postal_code?: string }
  /** The full price while the item is on sale in the catalog; the product's `price` is then the sale price. */
  list_price?: number
}

/** The result of the last exchange with the Meta catalog. Kept in `metadata.catalog`. */
export interface CatalogSync {
  /** `pending`: sent, Meta is still processing it. */
  state: 'synced' | 'pending' | 'error'
  /** The batch the item was sent in, to ask Meta how it went. */
  handle?: string
  errors?: string[]
  warnings?: string[]
  /** WhatsApp's review of the item: approved, pending, rejected, outdated or empty. */
  review_status?: string
  synced_at?: string
  /** The catalog the item was sent to or found in, so a different catalog's sync never removes it. */
  catalog_id?: string
}

export type CatalogState = 'in_catalog' | 'in_review' | 'rejected' | 'sending' | 'error' | 'not_sent'

export const CATALOG_STATE_LABELS: Record<CatalogState, string> = {
  in_catalog: 'In WhatsApp catalog',
  in_review: 'In review by WhatsApp',
  rejected: 'Rejected by WhatsApp',
  sending: 'Sending to catalog',
  error: 'Not accepted',
  not_sent: 'Not in catalog',
}

interface CatalogProduct {
  retailer_id: string
  title: string
  description?: string | null
  price: number | string
  currency?: string | null
  image_url?: string | null
  website_url?: string | null
  category?: string | null
  is_available?: boolean | null
  inventory_count?: number | null
  metadata?: Record<string, any> | null
}

function text(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max)
}

export function getProductAttributes(product: { metadata?: Record<string, any> | null } | null | undefined): ProductAttributes {
  const attributes = product?.metadata?.attributes
  return attributes && typeof attributes === 'object' && !Array.isArray(attributes) ? attributes : {}
}

export function getCatalogSync(product: { metadata?: Record<string, any> | null } | null | undefined): CatalogSync | null {
  const sync = product?.metadata?.catalog
  if (sync && typeof sync === 'object' && typeof sync.state === 'string') return sync as CatalogSync
  // Copies made by a catalog sync before this field existed
  return product?.metadata?.source === 'meta' ? { state: 'synced' } : null
}

export function getCatalogState(product: { metadata?: Record<string, any> | null } | null | undefined): CatalogState {
  const sync = getCatalogSync(product)
  if (!sync) return 'not_sent'
  if (sync.state === 'pending') return 'sending'
  if (sync.state === 'error') return 'error'
  if (sync.review_status === 'rejected') return 'rejected'
  if (sync.review_status === 'pending') return 'in_review'
  return 'in_catalog'
}

/** The item exists in the Meta catalog (or is on its way there), so removing the product should remove it there too. */
export function isInCatalog(product: { metadata?: Record<string, any> | null } | null | undefined): boolean {
  const state = getCatalogSync(product)?.state
  // `source: 'meta'` is set once a catalog sync has seen the item, and survives a later rejected update
  return product?.metadata?.source === 'meta' || state === 'synced' || state === 'pending'
}

/** The label for a product's place in the catalog. A rejected change to an item that is already there reads differently. */
export function getCatalogStateLabel(product: { metadata?: Record<string, any> | null } | null | undefined): string {
  const state = getCatalogState(product)
  return state === 'error' && product?.metadata?.source === 'meta' ? 'Update not accepted' : CATALOG_STATE_LABELS[state]
}

/**
 * Validate the catalog details of a product submitted from the dashboard.
 * Throws a message suitable for the user.
 */
export function parseProductAttributes(raw: Record<string, any> | null | undefined): ProductAttributes {
  const attributes: ProductAttributes = {}

  const brand = text(raw?.brand, 200)
  if (brand.length > 100) throw new Error('Brand must be at most 100 characters')
  if (brand) attributes.brand = brand

  const condition = text(raw?.condition, 20).toLowerCase()
  if (condition && !(PRODUCT_CONDITIONS as readonly string[]).includes(condition)) {
    throw new Error('Condition must be new, refurbished or used')
  }
  if (condition && condition !== 'new') attributes.condition = condition as ProductCondition

  const origin = text(raw?.origin_country, 10).toUpperCase()
  if (origin && !/^[A-Z]{2}$/.test(origin)) throw new Error('Country of origin must be a 2-letter country code such as IN')
  if (origin) attributes.origin_country = origin

  if (raw?.is_service === true) attributes.is_service = true

  // The importer is only meaningful for goods made abroad
  const importerName = text(raw?.importer_name, 200)
  const street = text(raw?.importer_street, 200)
  const city = text(raw?.importer_city, 100)
  const postalCode = text(raw?.importer_postal_code, 20)
  const importerCountry = text(raw?.importer_country, 10).toUpperCase() || 'IN'
  if (origin && !attributes.is_service && (importerName || street || city)) {
    if (!importerName || !street || !city) throw new Error('Enter the importer’s name, street address and city, or leave all three empty')
    if (!/^[A-Z]{2}$/.test(importerCountry)) throw new Error('Importer country must be a 2-letter country code such as IN')
    attributes.importer_name = importerName
    attributes.importer_address = { street1: street, city, country: importerCountry, ...(postalCode ? { postal_code: postalCode } : {}) }
  }

  return attributes
}

export interface CatalogItemDefaults {
  /** Used when the product names no brand. Meta requires one on every item. */
  brand: string
  /** Used when the product has no page of its own. Meta requires a link on every item. */
  link: string
}

/** What the store falls back to for the fields Meta requires and a product may leave empty. */
export function getCatalogItemDefaults(organization: Record<string, any> | null | undefined): CatalogItemDefaults {
  const digits = String(organization?.whatsapp_default_phone || '').replace(/\D/g, '')
  return {
    brand: text(organization?.name, 100) || 'Store',
    // A store without a website still needs a link: the product then opens a chat with the business
    link: digits.length >= 8 ? `https://wa.me/${digits}` : '',
  }
}

/** What stops a product from being sent to the catalog. Empty when it is ready. */
export function getCatalogProblems(product: CatalogProduct, defaults: CatalogItemDefaults): string[] {
  const problems: string[] = []
  if (!text(product.retailer_id, 200)) problems.push('Add a SKU.')
  if (!text(product.image_url, 2000)) problems.push('Add a photo. WhatsApp needs one for every catalog item.')
  if (!text(product.website_url, 2000) && !defaults.link) problems.push('Add the product’s page on your website.')
  return problems
}

/**
 * A product as the `data` of a Catalog Batch API request.
 * `endSale` is set when a product that was on sale no longer is, so the old sale price cannot linger.
 */
export function toCatalogItem(product: CatalogProduct, defaults: CatalogItemDefaults, options: { endSale?: boolean } = {}): Record<string, any> {
  const attributes = getProductAttributes(product)
  const currency = String(product.currency || 'INR').toUpperCase()
  // Meta's price format: the amount, a space and the ISO currency, e.g. "9.99 USD"
  const money = (amount: number) => `${amount.toFixed(2)} ${currency}`

  const price = Math.max(0, Number(product.price) || 0)
  const listPrice = Number(attributes.list_price) || 0
  const onSale = listPrice > price

  const inventory = product.inventory_count
  const hasStock = inventory === null || inventory === undefined || Number(inventory) > 0
  const title = text(product.title, 200)
  const image = text(product.image_url, 2000)

  const item: Record<string, any> = {
    id: text(product.retailer_id, 100),
    title,
    description: text(product.description, 5000) || title,
    availability: product.is_available !== false && hasStock ? 'in stock' : 'out of stock',
    condition: attributes.condition || 'new',
    price: money(onSale ? listPrice : price),
    link: text(product.website_url, 2000) || defaults.link,
    brand: text(attributes.brand, 100) || defaults.brand,
    // Always sent, so that unticking "service" puts the item back under the normal rules
    wa_compliance_category: attributes.is_service ? 'COUNTRY_ORIGIN_EXEMPT' : 'DEFAULT',
  }

  if (image) {
    item.image = [{ url: image }]
    // The older single-image field; Meta ignores it when `image` is present
    item.image_link = image
  }
  if (onSale || options.endSale) item.sale_price = money(price)
  if (Number.isInteger(inventory) && Number(inventory) > 0) item.quantity_to_sell_on_facebook = Number(inventory)

  const category = text(product.category, 750)
  if (category && category !== 'General') item.product_type = category

  if (!attributes.is_service) {
    if (attributes.origin_country) item.origin_country = attributes.origin_country
    if (attributes.importer_name && attributes.importer_address) {
      item.importer_name = attributes.importer_name
      item.importer_address = attributes.importer_address
    }
  }

  return item
}

export type CatalogBatchRequest =
  | { method: 'UPDATE'; data: Record<string, any> }
  | { method: 'DELETE'; data: { id: string } }

/** An UPDATE creates the item when the catalog does not have it yet (`allow_upsert`), so a retry is harmless. */
export function toUpsertRequest(product: CatalogProduct, defaults: CatalogItemDefaults, options: { endSale?: boolean } = {}): CatalogBatchRequest {
  return { method: 'UPDATE', data: toCatalogItem(product, defaults, options) }
}

export function toDeleteRequest(retailerId: string): CatalogBatchRequest {
  return { method: 'DELETE', data: { id: text(retailerId, 100) } }
}

const AVAILABLE_STATES = new Set(['in stock', 'available for order', 'preorder'])

/** "₹1,299.00", "INR 500", 500 -> 1299, 500, 500 */
export function parseMetaPrice(price: unknown): number {
  if (typeof price === 'number') return Number.isFinite(price) && price > 0 ? price : 0
  const match = String(price ?? '').match(/[\d.,]+/)
  if (!match) return 0
  const value = parseFloat(match[0].replace(/,/g, ''))
  return Number.isFinite(value) && value > 0 ? value : 0
}

export interface CatalogProductRow {
  retailer_id: string
  title: string
  description: string
  price: number
  currency: string
  image_url: string | null
  website_url: string | null
  is_available: boolean
  inventory_count: number
  /** `source: 'meta'` marks the row as a copy of a catalog item, so a later sync may update or remove it. */
  metadata: { source: 'meta'; attributes: ProductAttributes; catalog: CatalogSync }
}

/**
 * A Meta catalog item as a `commerce_products` row.
 * `kept` holds details Meta's item listing does not return (the importer), taken from the row being replaced.
 */
export function toCatalogProductRow(product: any, kept: ProductAttributes = {}, now: string = new Date().toISOString()): CatalogProductRow | null {
  const retailerId = String(product?.retailer_id || product?.id || '').trim()
  if (!retailerId) return null

  const fullPrice = parseMetaPrice(product.price)
  const salePrice = parseMetaPrice(product.sale_price)
  const onSale = salePrice > 0 && salePrice < fullPrice

  const attributes: ProductAttributes = {}
  const brand = text(product.brand, 100)
  if (brand) attributes.brand = brand
  const condition = String(product.condition || '').toLowerCase()
  if (condition !== 'new' && (PRODUCT_CONDITIONS as readonly string[]).includes(condition)) attributes.condition = condition as ProductCondition
  const origin = String(product.origin_country || '').toUpperCase()
  if (/^[A-Z]{2}$/.test(origin)) attributes.origin_country = origin
  if (product.wa_compliance_category === 'COUNTRY_ORIGIN_EXEMPT') attributes.is_service = true
  if (kept.importer_name && kept.importer_address && !attributes.is_service) {
    attributes.importer_name = kept.importer_name
    attributes.importer_address = kept.importer_address
  }
  if (onSale) attributes.list_price = fullPrice

  const issues: any[] = Array.isArray(product.errors) ? product.errors : Array.isArray(product.errors?.data) ? product.errors.data : []
  const warnings = issues
    .map((issue: any) => text(issue?.description || issue?.title || issue?.message, 300))
    .filter(Boolean)
    .slice(0, 5)
  const reviewStatus = String(product.review_status || '').toLowerCase()

  return {
    retailer_id: retailerId,
    title: String(product.name || 'Untitled product').slice(0, 150),
    description: String(product.description || '').slice(0, 2000),
    price: onSale ? salePrice : fullPrice || salePrice,
    currency: String(product.currency || 'INR').toUpperCase(),
    image_url: product.image_url || null,
    // A chat link is what a product without a page is given when it is sent to the catalog
    website_url: product.url && !/^https?:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(product.url) ? product.url : null,
    is_available: AVAILABLE_STATES.has(String(product.availability || '').toLowerCase()),
    inventory_count: typeof product.inventory === 'number' ? product.inventory : 100,
    metadata: {
      source: 'meta',
      attributes,
      catalog: {
        state: 'synced',
        synced_at: now,
        ...(reviewStatus ? { review_status: reviewStatus } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
      },
    },
  }
}
