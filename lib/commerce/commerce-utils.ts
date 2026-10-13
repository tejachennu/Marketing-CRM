/**
 * Commerce rules shared by the API, the WhatsApp webhook and the dashboard.
 * Keep this file free of server-only imports: the dashboard page uses it too.
 */

export type OrderStatus =
  | 'cart_submitted'
  | 'awaiting_address'
  | 'payment_pending'
  | 'paid'
  | 'cod_confirmed'
  | 'shipped'
  | 'delivered'
  | 'canceled'

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded'

export const ORDER_STATUSES: OrderStatus[] = [
  'cart_submitted', 'awaiting_address', 'payment_pending', 'paid',
  'cod_confirmed', 'shipped', 'delivered', 'canceled',
]

export const PAYMENT_STATUSES: PaymentStatus[] = ['pending', 'paid', 'failed', 'refunded']

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  cart_submitted: 'Cart received',
  awaiting_address: 'Awaiting address',
  payment_pending: 'Payment pending',
  paid: 'Paid',
  cod_confirmed: 'COD confirmed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  canceled: 'Canceled',
}

/** Statuses in which the customer has not yet paid or confirmed the order. */
export const OPEN_CHECKOUT_STATUSES: OrderStatus[] = ['cart_submitted', 'awaiting_address', 'payment_pending']

/** What a team member may move an order to from each status. */
const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  cart_submitted: ['paid', 'cod_confirmed', 'canceled'],
  awaiting_address: ['paid', 'cod_confirmed', 'canceled'],
  payment_pending: ['paid', 'cod_confirmed', 'canceled'],
  paid: ['shipped', 'canceled'],
  cod_confirmed: ['shipped', 'canceled'],
  shipped: ['delivered', 'canceled'],
  delivered: [],
  canceled: [],
}

export function getNextOrderStatuses(status: string): OrderStatus[] {
  return ORDER_TRANSITIONS[status as OrderStatus] || []
}

export function canTransitionOrder(from: string, to: string): boolean {
  return getNextOrderStatuses(from).includes(to as OrderStatus)
}

/** Payment gateways Meta accepts in an `order_details` message (WhatsApp Payments, India). */
export const SUPPORTED_PAYMENT_GATEWAYS = ['razorpay', 'payu', 'billdesk', 'zaakpay'] as const
export type PaymentGateway = (typeof SUPPORTED_PAYMENT_GATEWAYS)[number]

/** The gateway to request payment through, or null when in-chat payment is not set up. */
export function getPaymentGateway(organization: Record<string, any> | null | undefined): { type: PaymentGateway; configName: string } | null {
  const configName = String(organization?.commerce_gateway_config_name || '').trim()
  const type = String(organization?.commerce_payment_gateway || 'razorpay')
  if (!configName || !SUPPORTED_PAYMENT_GATEWAYS.includes(type as PaymentGateway)) return null
  return { type: type as PaymentGateway, configName }
}

/** "₹1,050.00", "$12.50"; falls back to "XYZ 12.50" for a currency code Intl does not know. */
export function formatMoney(amount: number | string | null | undefined, currency?: string | null): string {
  const value = Number(amount) || 0
  const code = String(currency || 'INR').toUpperCase()
  try {
    return new Intl.NumberFormat(code === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${code} ${value.toFixed(2)}`
  }
}

/** Revenue only counts money actually received: paid orders that were not canceled. */
export function isRevenueOrder(order: { status: string; payment_status: string }): boolean {
  return order.payment_status === 'paid' && order.status !== 'canceled'
}

export interface ProductInput {
  retailer_id: string
  title: string
  description: string
  price: number
  currency: string
  image_url: string | null
  website_url: string | null
  category: string
  is_available: boolean
  inventory_count: number
}

function optionalHttpUrl(value: unknown, label: string): string | null {
  const text = String(value ?? '').trim()
  if (!text) return null
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('unsupported protocol')
    return url.toString()
  } catch {
    throw new Error(`${label} must be a full web address starting with https://`)
  }
}

/** Validate a product submitted from the dashboard. Throws a message suitable for the user. */
export function parseProductInput(raw: Record<string, any> | null | undefined): ProductInput {
  const title = String(raw?.title ?? '').trim()
  const retailerId = String(raw?.retailer_id ?? '').trim()
  if (!title) throw new Error('Enter a product title')
  if (title.length > 150) throw new Error('Product title must be at most 150 characters')
  if (!retailerId) throw new Error('Enter a SKU for the product')
  if (retailerId.length > 100) throw new Error('SKU must be at most 100 characters')

  const price = Number(raw?.price)
  if (raw?.price === '' || raw?.price === null || raw?.price === undefined || !Number.isFinite(price) || price < 0) {
    throw new Error('Enter a valid price (0 or more)')
  }

  const currency = String(raw?.currency || 'INR').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Currency must be a 3-letter code such as INR or USD')

  // An empty inventory field means "not tracked" (kept at 100); an explicit 0 means out of stock
  const hasInventory = raw?.inventory_count !== '' && raw?.inventory_count !== null && raw?.inventory_count !== undefined
  const inventory = hasInventory ? Number(raw?.inventory_count) : 100
  if (!Number.isInteger(inventory) || inventory < 0) throw new Error('Inventory must be a whole number (0 or more)')

  return {
    retailer_id: retailerId,
    title,
    description: String(raw?.description ?? '').trim().slice(0, 2000),
    price: Math.round(price * 100) / 100,
    currency,
    image_url: optionalHttpUrl(raw?.image_url, 'Image URL'),
    website_url: optionalHttpUrl(raw?.website_url, 'Website URL'),
    category: String(raw?.category ?? '').trim().slice(0, 60) || 'General',
    is_available: raw?.is_available !== false && inventory > 0,
    inventory_count: inventory,
  }
}

/** The steps a store has to complete, in the order they are usually done. */
export function getCommerceSetup(organization: Record<string, any> | null | undefined) {
  const connected = Boolean(organization?.whatsapp_api_token && organization?.whatsapp_phone_number_id)
  const gateway = getPaymentGateway(organization)
  const cod = organization?.commerce_enable_cod !== false
  return {
    whatsappConnected: connected,
    catalogLinked: Boolean(String(organization?.meta_catalog_id || '').trim()),
    addressFlow: Boolean(String(organization?.commerce_address_flow_id || '').trim()),
    paymentGateway: Boolean(gateway),
    cashOnDelivery: cod,
    /** A customer can complete an order when at least one way to pay is available. */
    canCheckout: connected && (Boolean(gateway) || cod),
  }
}
