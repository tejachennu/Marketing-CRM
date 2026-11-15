/**
 * Orders the team adds by hand: a sale in the shop, or an order a customer gave on a phone call.
 * They are normal orders (same list, totals, status steps and revenue), marked by `checkout_type`
 * ('in_store' or 'phone'). How the goods go to the customer is kept with the address (`handover`).
 */

import { normalizePhone } from '../public-api/keys'
import { contactByPhone } from '../public-api/contacts'
import { isUuid } from '../record-visibility'

export const ORDER_CHANNELS = { in_store: 'In the shop', phone: 'Phone call', website: 'Website' } as const
export type OrderChannel = keyof typeof ORDER_CHANNELS
export type Handover = 'now' | 'pickup' | 'delivery'
export const HAND_PAYMENT_METHODS = { cash: 'Cash', upi: 'UPI', card: 'Card' } as const
export type HandPaymentMethod = keyof typeof HAND_PAYMENT_METHODS

export interface ManualOrderInput {
  channel: OrderChannel
  customer: { contactId: string | null; name: string; phone: string | null }
  items: Array<{ productId: string | null; title: string; price: number | null; quantity: number }>
  handover: Handover
  paid: boolean
  paymentMethod: HandPaymentMethod | null
  shippingFee: number | null
  address: Record<string, string> | null
  note: string | null
}

const text = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const money = (value: unknown): number | null => {
  if (value === '' || value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN
}

/** Check what the team typed. Returns the order to save, or what to fix (in plain words). */
export function parseManualOrder(body: any): { order: ManualOrderInput } | { error: string; field?: string } {
  const channel = body?.channel
  if (!(channel in ORDER_CHANNELS) || channel === 'website') return { error: 'Say where the order came from: in the shop or a phone call.', field: 'channel' }
  const handover = body?.handover as Handover
  if (!['now', 'pickup', 'delivery'].includes(handover)) return { error: 'Say how the customer gets it: now, pick up later, or delivery.', field: 'handover' }
  if (handover === 'now' && channel !== 'in_store') return { error: 'A phone order cannot be handed over now. Choose pick up or delivery.', field: 'handover' }

  const rawItems: any[] = Array.isArray(body?.items) ? body.items : []
  if (!rawItems.length) return { error: 'Add at least one item.', field: 'items' }
  if (rawItems.length > 100) return { error: 'An order can have at most 100 lines.', field: 'items' }
  const items: ManualOrderInput['items'] = []
  for (const raw of rawItems) {
    const quantity = Number(raw?.quantity ?? 1)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999) return { error: 'Each quantity must be a whole number from 1.', field: 'items' }
    const productId = raw?.productId && isUuid(raw.productId) ? String(raw.productId) : null
    const price = money(raw?.price)
    if (Number.isNaN(price)) return { error: 'Each price must be 0 or more.', field: 'items' }
    const title = text(raw?.title, 150)
    if (!productId && (!title || price === null)) return { error: 'Give each item that is not from your products a name and a price.', field: 'items' }
    items.push({ productId, title, price, quantity })
  }

  const contactId = body?.customer?.contactId && isUuid(body.customer.contactId) ? String(body.customer.contactId) : null
  const name = text(body?.customer?.name, 120)
  const rawPhone = text(body?.customer?.phone, 30)
  const phone = rawPhone ? normalizePhone(rawPhone) : null
  if (rawPhone && !phone) return { error: 'Give the phone number with its country code, like +919876543210 (a 10-digit Indian number also works).', field: 'customer.phone' }
  if (channel === 'phone' && !contactId && !phone) return { error: 'Add the customer\'s phone number.', field: 'customer.phone' }
  if (handover === 'delivery' && !contactId && !name && !phone) return { error: 'Who is it for? Add the customer\'s name or number.', field: 'customer' }

  const paid = body?.paid === true
  const paymentMethod = paid ? (body?.paymentMethod in HAND_PAYMENT_METHODS ? body.paymentMethod as HandPaymentMethod : null) : null
  if (paid && !paymentMethod) return { error: 'Say how they paid: cash, UPI or card.', field: 'paymentMethod' }
  if (!paid && handover === 'now') return { error: 'Something handed over now must be paid now. Choose pick up later or delivery to take the money later.', field: 'paid' }

  let address: Record<string, string> | null = null
  if (handover === 'delivery') {
    const a = body?.address || {}
    address = {
      full_name: text(a.full_name, 120) || name,
      phone_number: text(a.phone_number, 30) || phone || '',
      address_line_1: text(a.address_line_1, 200),
      address_line_2: text(a.address_line_2, 200),
      city: text(a.city, 80),
      state: text(a.state, 80),
      pincode: text(a.pincode, 12),
    }
    if (!address.address_line_1 || !address.city) return { error: 'Add the delivery address (at least the street and the city).', field: 'address' }
  }
  const shippingFee = handover === 'delivery' ? money(body?.shippingFee) : 0
  if (Number.isNaN(shippingFee)) return { error: 'The delivery charge must be 0 or more.', field: 'shippingFee' }

  return { order: { channel, customer: { contactId, name, phone }, items, handover, paid, paymentMethod, shippingFee, address, note: text(body?.note, 1000) || null } }
}

/** The status a hand-made order starts in. */
export function startStatus(order: Pick<ManualOrderInput, 'handover' | 'paid'>): 'delivered' | 'paid' | 'cod_confirmed' {
  if (order.handover === 'now') return 'delivered'
  return order.paid ? 'paid' : 'cod_confirmed'
}

/** The customer: the one picked, or found by number, or saved now. Null for a walk-in with no details. */
async function resolveCustomer(db: any, organizationId: string, customer: ManualOrderInput['customer']): Promise<{ id: string } | null | { error: string }> {
  if (customer.contactId) {
    const { data } = await db.from('contacts').select('id').eq('organization_id', organizationId).eq('id', customer.contactId).maybeSingle()
    return data ? { id: data.id } : { error: 'That customer is not in your contacts.' }
  }
  if (customer.phone) {
    const found = await contactByPhone(db, organizationId, customer.phone)
    if (found) return { id: found.id }
  }
  if (!customer.phone && !customer.name) return null
  const [first, ...rest] = (customer.name || 'Customer').split(' ')
  const { data, error } = await db.from('contacts').insert({
    organization_id: organizationId, first_name: first, last_name: rest.join(' ') || null,
    phone_number: customer.phone, whatsapp_number: customer.phone ? `whatsapp:${customer.phone}` : null, tags: ['Customer'],
  }).select('id').single()
  if (error) throw new Error(error.message)
  return { id: data.id }
}

/** Save the order and its lines. Prices of products come from your product list unless typed in. */
export async function createManualOrder(db: any, organization: { id: string; currency?: string | null; commerce_default_shipping_fee?: unknown; commerce_free_shipping_threshold?: unknown }, input: ManualOrderInput, createOrderNumber: (db: any, organizationId: string) => Promise<string>) {
  const productIds = [...new Set(input.items.map((item) => item.productId).filter(Boolean))] as string[]
  const { data: products } = productIds.length
    ? await db.from('commerce_products').select('id, retailer_id, title, price, image_url').eq('organization_id', organization.id).in('id', productIds)
    : { data: [] }
  const byId = new Map<string, any>((products || []).map((product: any) => [product.id, product]))
  const lines = []
  for (const item of input.items) {
    const product = item.productId ? byId.get(item.productId) : null
    if (item.productId && !product) return { error: 'One of the products is no longer in your list. Refresh and try again.' }
    const unit = item.price ?? Number(product?.price) ?? 0
    lines.push({
      product_id: product?.id || null,
      retailer_id: product?.retailer_id || 'SHOP-ITEM',
      title: item.title || product?.title || 'Item',
      quantity: item.quantity,
      unit_price: unit,
      total_price: Math.round(unit * item.quantity * 100) / 100,
      image_url: product?.image_url || null,
    })
  }
  const subtotal = Math.round(lines.reduce((sum, line) => sum + line.total_price, 0) * 100) / 100
  let shippingFee = 0
  if (input.handover === 'delivery') {
    if (input.shippingFee !== null) shippingFee = input.shippingFee
    else {
      const fee = Number(organization.commerce_default_shipping_fee) || 0
      const freeFrom = Number(organization.commerce_free_shipping_threshold) || 0
      shippingFee = freeFrom > 0 && subtotal >= freeFrom ? 0 : fee
    }
  }

  const customer = await resolveCustomer(db, organization.id, input.customer)
  if (customer && 'error' in customer) return { error: customer.error }
  let conversationId: string | null = null
  if (customer) {
    const { data: chats } = await db.from('conversations').select('id').eq('organization_id', organization.id).eq('contact_id', customer.id).order('last_message_at', { ascending: false }).limit(1)
    conversationId = chats?.[0]?.id || null
  }

  const status = startStatus(input)
  const now = new Date().toISOString()
  const shipping: Record<string, unknown> = { ...(input.address || {}), handover: input.handover }
  if (input.handover === 'delivery') shipping.delivery_speed = 'standard'
  if (status === 'delivered') shipping.delivered_at = now
  const { data: order, error } = await db.from('commerce_orders').insert({
    organization_id: organization.id,
    contact_id: customer?.id || null,
    conversation_id: conversationId,
    order_number: await createOrderNumber(db, organization.id),
    status,
    checkout_type: input.channel,
    subtotal,
    shipping_fee: shippingFee,
    tax_amount: 0,
    total_amount: Math.round((subtotal + shippingFee) * 100) / 100,
    currency: String(organization.currency || 'INR').toUpperCase(),
    payment_method: input.paid ? input.paymentMethod : 'cod',
    payment_status: input.paid ? 'paid' : 'pending',
    shipping_address: shipping,
    customer_note: input.note,
  }).select('*').single()
  if (error) throw new Error(error.message)
  const { error: linesError } = await db.from('commerce_order_items').insert(lines.map((line) => ({ ...line, order_id: order.id })))
  if (linesError) {
    await db.from('commerce_orders').delete().eq('id', order.id)
    throw new Error(linesError.message)
  }
  return { order }
}
