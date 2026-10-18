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

/** Paid or confirmed for Cash on Delivery: the team has to pack and ship these. */
export const TO_SHIP_STATUSES: OrderStatus[] = ['paid', 'cod_confirmed']

/** The groups the dashboard filters orders by. */
export const ORDER_VIEWS = {
  all: null,
  awaiting: OPEN_CHECKOUT_STATUSES,
  to_ship: TO_SHIP_STATUSES,
  shipped: ['shipped'],
  delivered: ['delivered'],
  canceled: ['canceled'],
} as const satisfies Record<string, readonly OrderStatus[] | null>
export type OrderView = keyof typeof ORDER_VIEWS

/** Paid, then canceled: the money has to go back to the customer. */
export function needsRefund(order: { status: string; payment_status: string }): boolean {
  return order.status === 'canceled' && order.payment_status === 'paid'
}

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
  // The dashboard gets the organization without its token; /api/organization sends `whatsapp_connected` instead
  const connected = typeof organization?.whatsapp_connected === 'boolean'
    ? organization.whatsapp_connected
    : Boolean(organization?.whatsapp_api_token && organization?.whatsapp_phone_number_id)
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

// ── Checkout messages ───────────────────────────────────────────────────────

/**
 * What the customer is told at each checkout step. The webhook sends these and the dashboard's
 * Order flow tab previews them, so the two cannot drift apart.
 */
export const CHECKOUT_TEXT = {
  received: (orderNumber: string, itemCount: number, total: string) =>
    `Thank you! We received your order #${orderNumber} for ${itemCount} item${itemCount === 1 ? '' : 's'} (Total: ${total}).`,
  askAddress: 'Where should we deliver it? Tap below to add your address.',
  askHowToPay: (total: string) => `How would you like to pay ${total}?`,
  payOnline: 'Review your order and pay securely below.',
  confirmCod: (total: string) => `Pay ${total} in cash when your order arrives. Tap below to confirm it.`,
  acknowledge: 'Our team will contact you shortly to confirm payment and delivery.',
  codConfirmed: (orderNumber: string, total: string) => `Order #${orderNumber} is confirmed for Cash on Delivery. Please keep ${total} ready when it arrives.`,
  paid: (amount: string, orderNumber: string) => `Payment of ${amount} received. Order #${orderNumber} is confirmed and we are preparing it.`,
}

export type PaymentStep = 'choice' | 'payment' | 'cod' | 'acknowledged'

/** Which payment step a customer gets, from the store's settings (mirrors the webhook's order). */
export function getPaymentStep(organization: Record<string, any> | null | undefined): PaymentStep {
  const online = Boolean(getPaymentGateway(organization))
  const cod = organization?.commerce_enable_cod !== false
  if (online && cod) return 'choice'
  if (online) return 'payment'
  if (cod) return 'cod'
  return 'acknowledged'
}

// ── Money ───────────────────────────────────────────────────────────────────

/** An amount in the currency's minor unit (paise, cents). WhatsApp payments are sent this way. */
export function toMinorUnits(amount: number | string | null | undefined): number {
  const value = Number(amount)
  return Number.isFinite(value) ? Math.round(value * 100) : 0
}

/** Express delivery surcharge. 50 until the store sets its own; 0 means express costs nothing extra. */
export const DEFAULT_EXPRESS_FEE = 50
export function getExpressFee(organization: Record<string, any> | null | undefined): number {
  const raw = organization?.commerce_express_fee
  if (raw === null || raw === undefined || raw === '') return DEFAULT_EXPRESS_FEE
  const fee = Number(raw)
  return Number.isFinite(fee) && fee >= 0 ? Math.round(fee * 100) / 100 : DEFAULT_EXPRESS_FEE
}

// ── Payment references ──────────────────────────────────────────────────────
// WhatsApp identifies a payment request by its reference_id: at most 35 characters, only letters,
// digits, "_", "-" and ".", and never reused. The order number is used so the customer sees the
// same number the team does; asking again for the same order adds ".2", ".3", ...

export const MAX_PAYMENT_REFERENCE_LENGTH = 35
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function buildPaymentReference(orderNumber: string, attempt: number = 1): string {
  const suffix = attempt > 1 ? `.${Math.floor(attempt)}` : ''
  const base = String(orderNumber || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, MAX_PAYMENT_REFERENCE_LENGTH - suffix.length)
  if (!base) throw new Error('An order number is required to request payment')
  return `${base}${suffix}`
}

export type ParsedPaymentReference =
  | { kind: 'order_number'; orderNumber: string; attempt: number }
  /** Requests sent before order numbers were used carried the order's database id. */
  | { kind: 'order_id'; orderId: string }

export function parsePaymentReference(reference: unknown): ParsedPaymentReference | null {
  const value = String(reference ?? '').trim()
  if (!value) return null
  if (UUID_PATTERN.test(value)) return { kind: 'order_id', orderId: value.toLowerCase() }
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) return null

  const match = value.match(/^(.+)\.(\d{1,3})$/)
  if (match) return { kind: 'order_number', orderNumber: match[1], attempt: Number(match[2]) }
  return { kind: 'order_number', orderNumber: value, attempt: 1 }
}

/** The reference to use for the next payment request of an order. */
export function nextPaymentReference(order: { order_number: string; meta_payment_reference?: string | null }): string {
  const last = parsePaymentReference(order.meta_payment_reference)
  const lastAttempt = last?.kind === 'order_number' && last.orderNumber === buildPaymentReference(order.order_number) ? last.attempt : 0
  return buildPaymentReference(order.order_number, lastAttempt + 1)
}

/** True when a payment request has been sent for the order (so WhatsApp knows its reference). */
export function hasPaymentRequest(order: { order_number: string; meta_payment_reference?: string | null }): boolean {
  const parsed = parsePaymentReference(order.meta_payment_reference)
  if (!parsed) return false
  if (parsed.kind === 'order_id') return true
  return parsed.orderNumber === buildPaymentReference(order.order_number)
}

// ── Delivery details ────────────────────────────────────────────────────────

export interface Fulfillment {
  trackingNumber: string
  carrier: string
  shippedAt: string | null
}

/** Tracking details are kept with the delivery address. */
export function getFulfillment(order: { shipping_address?: Record<string, any> | null }): Fulfillment {
  const address = order.shipping_address || {}
  return {
    trackingNumber: String(address.tracking_number || '').trim(),
    carrier: String(address.carrier || '').trim(),
    shippedAt: address.shipped_at ? String(address.shipped_at) : null,
  }
}

/** One line for an address, e.g. for copying or the order table. */
export function formatAddress(address: Record<string, any> | null | undefined): string {
  if (!address?.address_line_1) return ''
  return [address.address_line_1, address.address_line_2, address.city, [address.state, address.pincode].filter(Boolean).join(' ')]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(', ')
}

// ── WhatsApp errors, in words a store owner can act on ───────────────────────

export function describeWhatsAppError(error: any, fallback = 'WhatsApp did not accept the message.'): string {
  const code = Number(error?.code)
  const detail = String(error?.error_data?.details || error?.error_user_msg || error?.message || '').trim()

  if (code === 131047) return 'This customer has not messaged you in the last 24 hours, so WhatsApp only allows an approved template. Ask them to message you first, or send a template from the chat.'
  if (code === 131026) return 'This number cannot receive the message. It may not be on WhatsApp, or it uses an old version of the app.'
  if (code === 131030) return 'This number is not on the allowed list of your test WhatsApp number.'
  if (code === 190 || error?.type === 'OAuthException' && /access token|session/i.test(detail)) return 'The WhatsApp access token has expired or is not valid. Reconnect WhatsApp in Settings.'
  if (code === 131056 || code === 130429 || code === 80007) return 'WhatsApp is limiting how fast you can message right now. Try again in a minute.'
  if (code === 131031) return 'Your WhatsApp Business account is locked or restricted. Check WhatsApp Manager.'
  return detail || fallback
}
