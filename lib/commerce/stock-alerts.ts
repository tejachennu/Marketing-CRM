/**
 * "Tell me on WhatsApp when it's back": a shopper leaves their number on a sold-out product (or one size /
 * colour of it); when the product is back in stock each waiting number gets one WhatsApp message with the
 * link. Server only.
 */

import { phoneKey, withSalesSchema } from './shop-sales-store'
import { sendShopMessage } from './shop-messages-send'
import { variantsFor } from './variant-store'
import { variantInStock } from './variants'

export async function addStockAlert(db: any, organizationId: string, input: { productId: string; variantId?: string | null; phone: string }) {
  const key = phoneKey(input.phone)
  if (key.length < 10) return { ok: false as const, reason: 'Type your WhatsApp number.' }
  const { data: waiting } = await withSalesSchema(() => db.from('commerce_stock_alerts').select('id, variant_id').eq('organization_id', organizationId).eq('product_id', input.productId).eq('phone_key', key).is('sent_at', null))
  if ((waiting || []).some((w: any) => (w.variant_id || null) === (input.variantId || null))) return { ok: true as const, already: true }
  const { error } = await withSalesSchema(() => db.from('commerce_stock_alerts').insert({ organization_id: organizationId, product_id: input.productId, variant_id: input.variantId || null, phone: input.phone, phone_key: key }))
  if (error) return { ok: false as const, reason: 'Could not save it. Please try again.' }
  return { ok: true as const, already: false }
}

/** Tell everyone waiting for this product (or one of its options) that is now in stock. */
export async function notifyBackInStock(db: any, organizationId: string, productId: string, storeLink: (org: any) => string) {
  const { data: alerts, error } = await db.from('commerce_stock_alerts').select('*').eq('organization_id', organizationId).eq('product_id', productId).is('sent_at', null).limit(500)
  if (error || !alerts?.length) return { sent: 0 }
  const { data: product } = await db.from('commerce_products').select('*').eq('organization_id', organizationId).eq('id', productId).maybeSingle()
  if (!product || product.is_available === false || (product.inventory_count ?? 1) <= 0) return { sent: 0 }
  const variants = (await variantsFor(db, organizationId, [productId])).get(productId) || []
  const { data: org } = await db.from('organizations').select('*').eq('id', organizationId).maybeSingle()
  if (!org) return { sent: 0 }
  const shop = org.storefront?.title || org.name || 'our shop'
  const link = `${storeLink(org).replace(/\/$/, '')}/p/${productId}`
  let sent = 0
  for (const alert of alerts) {
    const variant = alert.variant_id ? variants.find((v) => v.id === alert.variant_id) : null
    const inStock = alert.variant_id ? Boolean(variant && variantInStock(variant)) : variants.length ? variants.some(variantInStock) : true
    if (!inStock) continue
    const name = `${product.title}${variant ? ` (${variant.name})` : ''}`
    // Marked first: one message per request, even if WhatsApp is slow
    const { data: claimed } = await db.from('commerce_stock_alerts').update({ sent_at: new Date().toISOString() }).eq('id', alert.id).is('sent_at', null).select('id')
    if (!claimed?.length) continue
    const result = await sendShopMessage(db, org, alert.phone, 'back_in_stock', {
      text: `Good news! ${name} is back in stock at ${shop} 🎉\nOrder it here before it sells out: ${link}`,
      values: [name, shop, link],
    }).catch(() => ({ sent: false }))
    if (result.sent) sent++
  }
  return { sent }
}

export const storeLinkFor = (appUrl: string) => (org: any) => (org.store_domain ? `https://${org.store_domain}` : `${appUrl.replace(/\/$/, '')}/s/${org.slug}`)
