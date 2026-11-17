/**
 * Cart reminder on WhatsApp: when a shopper types their phone at checkout the cart is saved; if no order comes
 * within an hour they get one WhatsApp message with a link that brings the same cart back. Never more than one
 * per cart; an order from that phone stops it. Server only.
 */

import { phoneKey, newCartToken, withSalesSchema } from './shop-sales-store'
import { sendShopMessage } from './shop-messages-send'
import type { StorePage } from './storefront'

export const REMIND_AFTER_MIN = 60
/** Carts older than this are not reminded any more. */
export const REMIND_WITHIN_H = 48

/** The cart as "productId[:variantId]" → quantity, only lines the store still sells; with a summary and total. */
export function readCart(page: Pick<StorePage, 'products'>, raw: unknown): { cart: Record<string, number>; summary: string; total: number } {
  const cart: Record<string, number> = {}
  const parts: string[] = []
  let total = 0
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, qty] of Object.entries(raw as Record<string, unknown>)) {
      const [pid, vid] = key.split(':')
      const product = page.products.find((p) => p.id === pid)
      if (!product) continue
      const variant = vid ? product.variants?.find((v) => v.id === vid) : null
      if (product.variants?.length ? !variant : Boolean(vid)) continue
      const n = Math.max(1, Math.min(99, Math.round(Number(qty) || 0)))
      if (!n) continue
      cart[key] = n
      total += (variant ? variant.price : product.price) * n
      parts.push(`${n} × ${product.title}${variant ? ` (${variant.name})` : ''}`)
      if (Object.keys(cart).length >= 60) break
    }
  }
  return { cart, summary: parts.slice(0, 4).join(', ') + (parts.length > 4 ? ` and ${parts.length - 4} more` : ''), total: Math.round(total * 100) / 100 }
}

/** Save (or update) the cart of the shopper with this phone. Returns its token. */
export async function saveCheckout(db: any, organizationId: string, page: StorePage, input: { phone: string; name?: string | null; cart: unknown }) {
  const key = phoneKey(input.phone)
  if (key.length < 10) return null
  const { cart, summary, total } = readCart(page, input.cart)
  if (!Object.keys(cart).length) return null
  const { data: existing } = await withSalesSchema(() => db.from('commerce_checkouts').select('id, token, reminded_at, recovered_order_id').eq('organization_id', organizationId).eq('phone_key', key).maybeSingle())
  const now = new Date().toISOString()
  const values = { phone: input.phone, name: String(input.name || '').slice(0, 120) || null, cart, summary, total, updated_at: now }
  if (existing) {
    // A new cart after an order (or long after the last reminder) can be reminded again
    const fresh = existing.recovered_order_id ? { reminded_at: null, recovered_order_id: null } : {}
    await db.from('commerce_checkouts').update({ ...values, ...fresh }).eq('id', existing.id)
    return existing.token as string
  }
  const token = newCartToken()
  await withSalesSchema(() => db.from('commerce_checkouts').insert({ organization_id: organizationId, phone_key: key, token, ...values }))
  return token
}

/** The saved cart behind a reminder link. */
export async function cartByToken(db: any, organizationId: string, token: string) {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) return null
  const { data } = await db.from('commerce_checkouts').select('cart, name, phone').eq('organization_id', organizationId).eq('token', token).maybeSingle()
  return data || null
}

/** An order from this phone: its cart is done, no reminder. */
export async function markRecovered(db: any, organizationId: string, phone: string | null, orderId: string) {
  const key = phoneKey(phone)
  if (key.length < 10) return
  await db.from('commerce_checkouts').update({ recovered_order_id: orderId, updated_at: new Date().toISOString() }).eq('organization_id', organizationId).eq('phone_key', key)
}

/** The reminder text (and the template's blanks, in order). */
export function reminderMessage(row: { name?: string | null; summary?: string | null }, shopName: string, link: string) {
  const first = String(row.name || '').split(' ')[0]
  const text = `${first ? `Hi ${first}` : 'Hi'}, you left ${row.summary || 'a few things'} in your cart at ${shopName}. They are still waiting for you 🛒\nFinish your order here: ${link}`
  return { text, values: [first || 'there', row.summary || 'your items', shopName, link] }
}

/** Remind every cart that is an hour old, not ordered and not reminded (run by the scheduled shop job). */
export async function sendDueReminders(db: any, opts: { now?: number; storeLink: (org: any) => string; loadOrg: (id: string) => Promise<any> }) {
  const now = opts.now ?? Date.now()
  const before = new Date(now - REMIND_AFTER_MIN * 60_000).toISOString()
  const after = new Date(now - REMIND_WITHIN_H * 3_600_000).toISOString()
  const { data, error } = await db.from('commerce_checkouts').select('*').is('reminded_at', null).is('recovered_order_id', null).lt('updated_at', before).gt('updated_at', after).limit(200)
  if (error) return { due: 0, sent: 0 }
  let sent = 0
  for (const row of data || []) {
    // Marked first, so a slow or failed send is never repeated
    await db.from('commerce_checkouts').update({ reminded_at: new Date(now).toISOString() }).eq('id', row.id).is('reminded_at', null)
    const org = await opts.loadOrg(row.organization_id)
    if (!org) continue
    const link = `${opts.storeLink(org)}?cart=${row.token}`
    const msg = reminderMessage(row, org.storefront?.title || org.name || 'our shop', link)
    const result = await sendShopMessage(db, org, row.phone, 'cart_reminder', msg).catch(() => ({ sent: false }))
    if (result.sent) sent++
  }
  return { due: (data || []).length, sent }
}
