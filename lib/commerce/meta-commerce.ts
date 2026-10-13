import { parseMetaPrice, toCatalogProductRow, type CatalogProductRow } from './catalog-items'
import { fetchCatalogItemsBySku } from './meta-catalog'

export { parseMetaPrice, toCatalogProductRow, type CatalogProductRow }

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
  const items = await fetchCatalogItemsBySku(
    { token: accessToken, version: /^v\d+\.\d+$/.test(graphVersion) ? graphVersion : 'v25.0', businessAccountId: '', phoneNumberId: '' },
    String(catalogId),
    skus
  )
  return items.map((item) => toCatalogProductRow(item)).filter((row): row is CatalogProductRow => row !== null)
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
