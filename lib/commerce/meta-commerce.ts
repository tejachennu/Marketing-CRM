import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

/**
 * Configure WhatsApp Commerce settings on the phone number
 * Enables/disables the native in-chat Cart and Catalog icon.
 */
export async function configureWhatsAppCommerceSettings(
  phoneNumberId: string,
  accessToken: string,
  settings: { isCartEnabled: boolean; isCatalogVisible: boolean }
) {
  const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/whatsapp_commerce_settings`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      is_cart_enabled: settings.isCartEnabled,
      is_catalog_visible: settings.isCatalogVisible,
    }),
  })

  if (!res.ok) {
    const errorData = await res.json().catch(() => null)
    throw new Error(
      errorData?.error?.message || `Failed to update commerce settings: HTTP ${res.status}`
    )
  }

  return await res.json()
}

const MAX_CATALOG_PAGES = 50 // 5,000 products

/**
 * Fetch products from Meta Commerce Manager Catalog
 */
export async function fetchMetaCatalogProducts(
  catalogId: string,
  accessToken: string,
  graphVersion: string = 'v25.0'
) {
  const products: any[] = []
  let url: string | null = `https://graph.facebook.com/${graphVersion}/${catalogId}/products?fields=id,retailer_id,name,description,price,sale_price,currency,image_url,url,availability,inventory&limit=100`

  // Follow Graph API paging so catalogs with more than 100 products sync completely
  for (let page = 0; url && page < MAX_CATALOG_PAGES; page++) {
    const res: Response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!res.ok) {
      const errorData = await res.json().catch(() => null)
      throw new Error(
        errorData?.error?.message || `Failed to fetch Meta Catalog products: HTTP ${res.status}`
      )
    }

    const data = await res.json()
    products.push(...(data.data || []))
    url = data.paging?.next || null
  }

  return products
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
  /** Marks the row as a copy of a Meta catalog item, so a later sync may update or remove it. */
  metadata: { source: 'meta' }
}

/** A Meta catalog item as a `commerce_products` row. */
export function toCatalogProductRow(product: any): CatalogProductRow | null {
  const retailerId = String(product?.retailer_id || product?.id || '').trim()
  if (!retailerId) return null
  return {
    retailer_id: retailerId,
    title: String(product.name || 'Untitled product').slice(0, 150),
    description: String(product.description || '').slice(0, 2000),
    price: parseMetaPrice(product.sale_price) || parseMetaPrice(product.price),
    currency: String(product.currency || 'INR').toUpperCase(),
    image_url: product.image_url || null,
    website_url: product.url || null,
    is_available: AVAILABLE_STATES.has(String(product.availability || '').toLowerCase()),
    inventory_count: typeof product.inventory === 'number' ? product.inventory : 100,
    metadata: { source: 'meta' },
  }
}

/**
 * Look up a few products by SKU in the Meta catalog. Used when a cart names a product the
 * dashboard has not synced yet. Never throws: a slow or failing lookup returns what it has.
 */
export async function fetchMetaProductsBySku(
  catalogId: string,
  accessToken: string,
  skus: string[],
  graphVersion: string = 'v25.0'
): Promise<CatalogProductRow[]> {
  const rows: CatalogProductRow[] = []
  await Promise.all(
    skus.slice(0, 10).map(async (sku) => {
      try {
        const filter = encodeURIComponent(JSON.stringify({ retailer_id: { eq: sku } }))
        const res = await fetch(
          `https://graph.facebook.com/${graphVersion}/${catalogId}/products?fields=id,retailer_id,name,description,price,sale_price,currency,image_url,url,availability,inventory&filter=${filter}&limit=1`,
          { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(4000) }
        )
        if (!res.ok) return
        const data = await res.json()
        const row = toCatalogProductRow(data?.data?.[0])
        if (row && row.retailer_id === sku) rows.push(row)
      } catch {
        // Best effort only
      }
    })
  )
  return rows
}

/**
 * Sync Meta Catalog products to Supabase `commerce_products` table.
 * Products are written in batches, and items that have left the Meta catalog are removed
 * from the copy (products added by hand in the dashboard are never touched).
 */
export async function syncMetaCatalogToDatabase(
  organizationId: string,
  catalogId: string,
  accessToken: string,
  graphVersion: string = 'v25.0'
) {
  const products = await fetchMetaCatalogProducts(catalogId, accessToken, graphVersion)
  const supabase = getSupabase()
  const now = new Date().toISOString()

  const rows = new Map<string, CatalogProductRow>()
  for (const product of products) {
    const row = toCatalogProductRow(product)
    if (row) rows.set(row.retailer_id, row)
  }

  let syncedCount = 0
  let firstError: string | null = null
  const batch = [...rows.values()]
  for (let i = 0; i < batch.length; i += 200) {
    const chunk = batch.slice(i, i + 200)
    const { error } = await supabase
      .from('commerce_products')
      .upsert(chunk.map((row) => ({ organization_id: organizationId, ...row, updated_at: now })), { onConflict: 'organization_id,retailer_id' })
    if (error) firstError = firstError || error.message
    else syncedCount += chunk.length
  }

  // Remove copies of items that are no longer in the Meta catalog. Only done after a complete,
  // error-free read, so a partial sync can never empty the product list.
  let removed = 0
  if (!firstError && batch.length > 0) {
    const stale: string[] = []
    for (let from = 0; from < 50000; from += 1000) {
      const { data, error } = await supabase
        .from('commerce_products')
        .select('id, retailer_id')
        .eq('organization_id', organizationId)
        .eq('metadata->>source', 'meta')
        .order('id', { ascending: true })
        .range(from, from + 999)
      if (error || !data) break
      for (const product of data) if (!rows.has(product.retailer_id)) stale.push(product.id)
      if (data.length < 1000) break
    }
    for (let i = 0; i < stale.length; i += 100) {
      const { error } = await supabase.from('commerce_products').delete().eq('organization_id', organizationId).in('id', stale.slice(i, i + 100))
      if (!error) removed += Math.min(100, stale.length - i)
    }
  }

  return { total: batch.length, synced: syncedCount, removed, error: firstError }
}

/**
 * Calculates order subtotal, shipping fee, and grand total based on org rules
 */
export function calculateOrderTotals(
  items: Array<{ unit_price: number; quantity: number }>,
  rules?: {
    shippingFee?: number
    freeShippingThreshold?: number
    taxRate?: number // e.g. 0.05 for 5%
  }
) {
  const subtotal = items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0)
  const threshold = rules?.freeShippingThreshold || 0
  let shippingFee = rules?.shippingFee || 0

  if (threshold > 0 && subtotal >= threshold) {
    shippingFee = 0
  }

  const taxRate = rules?.taxRate || 0
  const taxAmount = Math.round(subtotal * taxRate * 100) / 100
  const grandTotal = Math.round((subtotal + shippingFee + taxAmount) * 100) / 100

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    shippingFee: Math.round(shippingFee * 100) / 100,
    taxAmount,
    grandTotal,
  }
}
