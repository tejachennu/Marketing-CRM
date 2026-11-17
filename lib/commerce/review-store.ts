/**
 * Reviews in the database (rules in reviews.ts): a review link per order (sent on WhatsApp when it is
 * delivered), the reviews themselves, and the published ones for each product page. Server only.
 */

import { randomBytes } from 'node:crypto'
import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'
import { publicName, type PublicReview, type ReviewInput } from './reviews'
import { sendShopMessage } from './shop-messages-send'

/** supabase/migrations/20261128_shop_reviews.sql word for word. */
export const REVIEW_SQL = `-- Shop product reviews with photos. Safe to run more than once. The app runs it on its own when first needed.
CREATE TABLE IF NOT EXISTS commerce_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES commerce_products(id) ON DELETE CASCADE,
  order_id UUID REFERENCES commerce_orders(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL,
  body TEXT,
  photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  customer_name TEXT,
  published BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_commerce_reviews_product ON commerce_reviews(product_id, published, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commerce_reviews_org ON commerce_reviews(organization_id, created_at DESC);
ALTER TABLE commerce_reviews ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
`
export const REVIEW_LOCK = 724519025
export const reviewSchemaSetup = createAutoSetup('Shop reviews', (connectionString) => runMigrationSql(connectionString, REVIEW_SQL, REVIEW_LOCK))

export async function withReviewSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = reviewSchemaSetup): Promise<any> {
  const first = await step()
  if (!isMissingSchemaError(first.error, /commerce_reviews/)) return first
  if (!(await setup.ensure())) return first
  let result = await step()
  for (let attempt = 1; attempt < 4 && isMissingSchemaError(result.error, /commerce_reviews/); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
    result = await step()
  }
  return result
}

/** The order's review link token (kept on the order; made the first time). */
export async function reviewToken(db: any, order: any): Promise<string> {
  const existing = order.shipping_address?.review_token
  if (existing) return String(existing)
  const token = randomBytes(15).toString('base64url')
  await db.from('commerce_orders').update({ shipping_address: { ...(order.shipping_address || {}), review_token: token } }).eq('id', order.id)
  return token
}

export async function orderByReviewToken(db: any, organizationId: string, token: string) {
  if (!/^[A-Za-z0-9_-]{16,30}$/.test(token)) return null
  const { data } = await db.from('commerce_orders').select('*, items:commerce_order_items(*)').eq('organization_id', organizationId).eq('shipping_address->>review_token', token).maybeSingle()
  return data || null
}

/** "How was it?" on WhatsApp when an order is delivered (once per order). */
export async function askForReview(db: any, org: any, order: any, storeLink: string) {
  if (order.shipping_address?.review_asked_at || order.shipping_address?.handover === 'now') return { sent: false }
  const phone = order.shipping_address?.phone_number || null
  if (!phone) return { sent: false }
  const token = await reviewToken(db, order)
  const link = `${storeLink.replace(/\/$/, '')}/review/${token}`
  const first = String(order.shipping_address?.full_name || '').split(' ')[0]
  const result = await sendShopMessage(db, org, phone, 'review_ask', {
    text: `${first ? `Hi ${first}` : 'Hi'}, how was your order #${order.order_number}? 😊\nA quick rating (and a photo, if you like) helps us and other customers: ${link}`,
    values: [first || 'there', order.order_number, link],
  }).catch(() => ({ sent: false }))
  const { data: fresh } = await db.from('commerce_orders').select('shipping_address').eq('id', order.id).maybeSingle()
  await db.from('commerce_orders').update({ shipping_address: { ...(fresh?.shipping_address || order.shipping_address || {}), review_asked_at: new Date().toISOString() } }).eq('id', order.id)
  return result
}

/** Save the customer's reviews for an order: one per product of that order, never twice. */
export async function saveReviews(db: any, organizationId: string, order: any, reviews: ReviewInput[]) {
  const inOrder = new Set((order.items || []).map((i: any) => i.product_id).filter(Boolean))
  const rows = reviews.filter((r) => inOrder.has(r.productId)).map((r) => ({
    organization_id: organizationId, product_id: r.productId, order_id: order.id, rating: r.rating, body: r.text || null, photos: r.photos,
    customer_name: order.shipping_address?.full_name || null,
  }))
  if (!rows.length) return { saved: 0 }
  const { data: done } = await withReviewSchema(() => db.from('commerce_reviews').select('product_id').eq('order_id', order.id))
  const already = new Set((done || []).map((d: any) => d.product_id))
  const fresh = rows.filter((r) => !already.has(r.product_id))
  if (fresh.length) await withReviewSchema(() => db.from('commerce_reviews').insert(fresh))
  return { saved: fresh.length }
}

/** Published reviews of one product, newest first (names shortened). No table yet = none. */
export async function productReviews(db: any, organizationId: string, productId: string, limit = 50): Promise<PublicReview[]> {
  const { data, error } = await db.from('commerce_reviews').select('rating, body, photos, customer_name, created_at').eq('organization_id', organizationId).eq('product_id', productId).eq('published', true).order('created_at', { ascending: false }).limit(limit)
  if (error) return []
  return (data || []).map((r: any) => ({ rating: Number(r.rating), text: String(r.body || ''), photos: Array.isArray(r.photos) ? r.photos.filter((u: unknown) => /^https:\/\//.test(String(u))) : [], name: publicName(r.customer_name), at: r.created_at }))
}

/** Ask for a review of a delivered order, loading what is needed (used by every place that marks Delivered). */
export async function askForReviewOf(db: any, organizationId: string, orderId: string, appUrl: string) {
  const [{ data: org }, { data: order }] = await Promise.all([
    db.from('organizations').select('*').eq('id', organizationId).maybeSingle(),
    db.from('commerce_orders').select('*').eq('organization_id', organizationId).eq('id', orderId).maybeSingle(),
  ])
  if (!org || !order || order.status !== 'delivered') return { sent: false }
  const link = org.store_domain ? `https://${org.store_domain}` : `${appUrl.replace(/\/$/, '')}/s/${org.slug}`
  return askForReview(db, org, order, link)
}
