import { parseMetaPrice, toCatalogProductRow, type CatalogProductRow } from './catalog-items'
import { fetchCatalogItemsBySku } from './meta-catalog'

export { parseMetaPrice, toCatalogProductRow, type CatalogProductRow }

/** Meta is asked for this many SKUs at a time (one request each, in parallel). */
export const SKU_LOOKUP_CHUNK = 10

/**
 * Look up products by SKU in the Meta catalog. Used when a cart names products the dashboard
 * has not synced yet, so the order shows real names instead of "Item #SKU". Larger carts are
 * looked up ten SKUs at a time, chunk after chunk. Never throws: a slow or failing lookup
 * returns what it has.
 */
export async function fetchMetaProductsBySku(
  catalogId: string,
  accessToken: string,
  skus: string[],
  graphVersion: string = 'v25.0',
  fetcher: typeof fetch = fetch
): Promise<CatalogProductRow[]> {
  const credentials = { token: accessToken, version: /^v\d+\.\d+$/.test(graphVersion) ? graphVersion : 'v25.0', businessAccountId: '', phoneNumberId: '' }
  const unique = [...new Set(skus.map((sku) => String(sku || '').trim()).filter(Boolean))]
  const rows: CatalogProductRow[] = []
  for (let start = 0; start < unique.length; start += SKU_LOOKUP_CHUNK) {
    const items = await fetchCatalogItemsBySku(credentials, String(catalogId), unique.slice(start, start + SKU_LOOKUP_CHUNK), fetcher)
    for (const item of items) {
      const row = toCatalogProductRow(item)
      if (row) rows.push(row)
    }
  }
  return rows
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
