/**
 * The WhatsApp store checkout, step by step:
 *
 *   cart received ─▶ delivery address (if the store collects one)
 *                 ─▶ how to pay: online, Cash on Delivery, or a choice between them
 *                 ─▶ paid / confirmed ─▶ shipped ─▶ delivered
 *
 * Every function here is safe to run twice with the same input: Meta redelivers webhooks,
 * and customers tap old buttons.
 */

import { createClient } from '@supabase/supabase-js'
import { isBsuid } from '@/lib/whatsapp-bsuid'
import {
  buildAddressFlowMessage,
  buildButtonsMessage,
  buildOrderDetailsMessage,
  buildOrderStatusMessage,
  buildTextMessage,
  OrderDetailsItem,
} from './commerce-messages'
import { fetchMetaProductsBySku } from './meta-commerce'
import {
  ORDER_STATUS_LABELS,
  CHECKOUT_TEXT,
  OPEN_CHECKOUT_STATUSES,
  calculateOrderTotals,
  chooseUnitPrice,
  describeWhatsAppError,
  findPaymentRequest,
  formatAddress,
  formatMoney,
  fromMinorUnits,
  getExpressFee,
  getPaymentGateway,
  getPaymentRequests,
  hasPaymentRequest,
  isMissingColumnError,
  isUniqueViolation,
  lineTotal,
  nextPaymentReference,
  parseCampaignReference,
  parsePaymentReference,
  toMinorUnits,
  uuidHasPrefix,
  type OrderStatus,
  type PaymentRequestRecord,
} from './commerce-utils'

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

type Database = any

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isOpen = (status: string) => OPEN_CHECKOUT_STATUSES.includes(status as OrderStatus)

// ── Order numbers ───────────────────────────────────────────────────────────

const ORDER_NUMBER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O or 1/I look-alikes

/**
 * Human-readable order number: ORD-YYMMDD-XXXX.
 * The previous "last six digits of the timestamp" scheme repeated every ~17 minutes.
 */
export function generateOrderNumber(now: Date = new Date()): string {
  const datePart = now.toISOString().slice(2, 10).replace(/-/g, '')
  let suffix = ''
  for (let i = 0; i < 4; i++) {
    suffix += ORDER_NUMBER_ALPHABET[Math.floor(Math.random() * ORDER_NUMBER_ALPHABET.length)]
  }
  return `ORD-${datePart}-${suffix}`
}

/** An order number no other order of this store has. Payments are matched to orders by it. */
async function createOrderNumber(supabase: Database, organizationId: string): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = generateOrderNumber()
    const { data: taken } = await supabase
      .from('commerce_orders')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('order_number', candidate)
      .limit(1)
    if (!taken || taken.length === 0) return candidate
  }
  // Practically unreachable: six collisions in a million-wide space
  return `${generateOrderNumber()}${ORDER_NUMBER_ALPHABET[Math.floor(Math.random() * ORDER_NUMBER_ALPHABET.length)]}`
}

// ── Reading a payment update ────────────────────────────────────────────────

export interface PaymentUpdate {
  referenceId: string
  /** Only "paid" marks an order as paid. Anything unrecognised is treated as still pending. */
  outcome: 'paid' | 'pending' | 'failed'
  transactionId: string | null
  /** Amount in major units (rupees, not paise); 0 when Meta did not report one. */
  amount: number
  currency: string | null
  /** WhatsApp's id of the payment event (the order message it belongs to): the same on every redelivery. */
  eventId: string | null
}

const PAID_STATUSES = new Set(['captured', 'success', 'successful', 'completed', 'paid'])
const FAILED_STATUSES = new Set(['failed', 'failure', 'canceled', 'cancelled', 'declined', 'expired', 'error', 'rejected'])

/**
 * Read a payment update from WhatsApp.
 *
 * Meta reports gateway payments as a webhook *status* (`statuses[].type === "payment"`), with
 * `status: "captured" | "pending"` and the details under `payment` (reference_id, amount,
 * currency, transaction). The flatter shape found on a message is accepted as well.
 * An order must never be marked paid on a guess, so only an explicit success counts.
 */
export function normalizePaymentUpdate(raw: any): PaymentUpdate | null {
  if (!raw || typeof raw !== 'object') return null
  const payment = raw.payment && typeof raw.payment === 'object' ? raw.payment : raw
  const referenceId = String(payment.reference_id || raw.reference_id || '').trim()
  if (!referenceId) return null

  const status = String(raw.status || payment.status || '').toLowerCase()
  const transaction = payment.transaction && typeof payment.transaction === 'object' ? payment.transaction : {}
  const transactionStatus = String(transaction.status || '').toLowerCase()

  let outcome: PaymentUpdate['outcome'] = 'pending'
  if (FAILED_STATUSES.has(status) || FAILED_STATUSES.has(transactionStatus)) outcome = 'failed'
  else if (PAID_STATUSES.has(status)) outcome = 'paid'

  const value = Number(payment.amount?.value)
  const offset = Number(payment.amount?.offset) || 100
  return {
    referenceId,
    outcome,
    transactionId: String(transaction.id || transaction.pg_transaction_id || payment.transaction_id || raw.transaction_id || '').trim() || null,
    amount: Number.isFinite(value) && value > 0 ? value / offset : 0,
    currency: payment.currency ? String(payment.currency).toUpperCase() : null,
    eventId: String(raw.id || '').trim() || null,
  }
}

// ── Sending ─────────────────────────────────────────────────────────────────

export interface SendResult {
  ok: boolean
  /** Why WhatsApp refused, in words for the store owner. */
  error?: string
  messageId?: string | null
}

/**
 * Send a message through the WhatsApp Cloud API.
 * A refusal is returned, not thrown, so callers never record a "[Sent ...]" line in the
 * conversation for a message the customer did not receive.
 */
export async function sendWhatsAppMessage(organization: any, payload: unknown): Promise<SendResult> {
  if (!organization?.whatsapp_api_token || !organization?.whatsapp_phone_number_id) {
    return { ok: false, error: 'WhatsApp is not connected in Settings.' }
  }
  const graphVersion = organization.whatsapp_graph_api_version || 'v25.0'
  try {
    const res = await fetch(
      `https://graph.facebook.com/${graphVersion}/${organization.whatsapp_phone_number_id}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${organization.whatsapp_api_token}`,
        },
        body: JSON.stringify(payload),
      }
    )
    const data = await res.json().catch(() => null)
    if (!res.ok || data?.error) {
      const error = describeWhatsAppError(data?.error, `WhatsApp returned HTTP ${res.status}`)
      console.error('[Commerce] WhatsApp send failed:', data?.error?.code || res.status, data?.error?.message || '')
      return { ok: false, error }
    }
    return { ok: true, messageId: data?.messages?.[0]?.id || null }
  } catch (err: any) {
    console.error('[Commerce] WhatsApp send error:', err)
    return { ok: false, error: 'WhatsApp could not be reached. Check your connection and try again.' }
  }
}

interface CheckoutContext {
  supabase: Database
  organization: any
  conversationId: string | null
  customerPhone: string
}

/** Send a message and, when it was delivered, note it in the CRM conversation. */
async function sendAndLog(context: CheckoutContext, payload: unknown, logLine: string): Promise<SendResult> {
  const result = await sendWhatsAppMessage(context.organization, payload)
  if (result.ok && context.conversationId) {
    await context.supabase.from('messages').insert({
      organization_id: context.organization.id,
      conversation_id: context.conversationId,
      sender_type: 'user',
      body: logLine,
      twilio_message_sid: result.messageId ? `FB_${result.messageId}` : null,
      status: 'sent',
    })
  }
  return result
}

/** A line for the team in the CRM conversation; nothing is sent to the customer. */
async function logSystemLine(context: CheckoutContext, body: string): Promise<void> {
  if (!context.conversationId) return
  await context.supabase.from('messages').insert({
    organization_id: context.organization.id,
    conversation_id: context.conversationId,
    sender_type: 'user',
    body,
    status: 'sent',
  })
}

/**
 * Write an order row that carries `payment_requests`, leaving the column out when the database
 * does not have it yet (migration 20261104_commerce_payment_requests.sql): then only the latest
 * reference is kept, as before.
 */
type WriteResult = { data?: any; error: any }
async function writeWithPaymentRequests(row: Record<string, any>, write: (row: Record<string, any>) => PromiseLike<WriteResult>): Promise<WriteResult> {
  const result = await write(row)
  if (!result.error || !('payment_requests' in row) || !isMissingColumnError(result.error, 'payment_requests')) return result
  const rest = { ...row }
  delete rest.payment_requests
  return write(rest)
}

function toOrderItems(rows: any[] | null | undefined): OrderDetailsItem[] {
  return (rows || []).map((item: any) => ({
    retailer_id: item.retailer_id,
    name: item.title,
    unit_price: Number(item.unit_price),
    quantity: item.quantity,
  }))
}

async function loadOrderItems(supabase: Database, orderId: string): Promise<OrderDetailsItem[]> {
  const { data } = await supabase.from('commerce_order_items').select('*').eq('order_id', orderId)
  return toOrderItems(data)
}

// ── Checkout steps ──────────────────────────────────────────────────────────

/**
 * Ask for payment inside the chat. Each request gets a fresh reference (WhatsApp refuses to
 * reuse one) and the order remembers every one it sent, with the amount asked for, so the
 * payment that comes back finds its order and is checked against the right amount. The earlier
 * card is withdrawn first (best effort: WhatsApp may have expired it already), so the customer
 * has one card to pay, not two.
 */
async function sendPaymentRequest(context: CheckoutContext, order: any, items: OrderDetailsItem[], intro: string): Promise<SendResult> {
  const gateway = getPaymentGateway(context.organization)
  if (!gateway) return { ok: false, error: 'No payment gateway is set up in Store settings.' }
  if (!items.length) return { ok: false, error: 'This order has no items to charge for.' }

  const currency = order.currency || context.organization.currency || 'INR'
  const reference = nextPaymentReference(order)

  let payload: ReturnType<typeof buildOrderDetailsMessage>
  try {
    payload = buildOrderDetailsMessage({
      phone: context.customerPhone,
      referenceId: reference,
      currency,
      shippingFee: Number(order.shipping_fee) || 0,
      taxAmount: Number(order.tax_amount) || 0,
      items,
      paymentGatewayType: gateway.type,
      paymentGatewayConfigName: gateway.configName,
      bodyText: `${intro}\n\n${CHECKOUT_TEXT.payOnline}`,
    })
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
  // What WhatsApp will ask for: worked out from the lines, the way WhatsApp checks it
  const requestedAmount = fromMinorUnits(payload.interactive.action.parameters.total_amount.value)

  const previousReference = hasPaymentRequest(order) ? String(order.meta_payment_reference) : null
  const withdrawn = previousReference
    ? await voidPaymentRequest({
        organization: context.organization,
        order,
        database: context.supabase,
        phone: context.customerPhone,
        description: `This payment request for Order #${order.order_number} was replaced by a new one.`,
      })
    : false

  const result = await sendAndLog(
    context,
    payload,
    `[Sent payment request for Order #${order.order_number} (${formatMoney(requestedAmount, currency)})]`
  )
  if (result.ok) {
    const now = new Date().toISOString()
    const requests: PaymentRequestRecord[] = getPaymentRequests(order).map((entry) =>
      withdrawn && entry.reference === previousReference && !entry.voided_at ? { ...entry, voided_at: now } : entry
    )
    requests.push({ reference, amount: requestedAmount, currency, requested_at: now })
    await writeWithPaymentRequests(
      { meta_payment_reference: reference, payment_requests: requests, updated_at: now },
      (row) => context.supabase.from('commerce_orders').update(row).eq('id', order.id)
    )
    order.meta_payment_reference = reference
    order.payment_requests = requests
  }
  return result
}

export type CheckoutStep = 'address' | 'choice' | 'payment' | 'cod' | 'acknowledged' | 'not_sent'

/**
 * Tell the customer what happens next with their order. Exactly one message is sent, so an
 * order never ends in silence:
 *   1. the delivery address form, when the store collects addresses and has none for this order;
 *   2. a choice between paying online and Cash on Delivery, when the store offers both;
 *   3. a payment request, when only online payment is offered (or the customer chose it);
 *   4. a Cash on Delivery confirmation button, when only COD is offered;
 *   5. a plain acknowledgement that the team will follow up.
 * If a step cannot be sent, the next one down is tried.
 */
async function sendNextCheckoutStep(
  context: CheckoutContext,
  order: any,
  items: OrderDetailsItem[],
  intro: string,
  options: { preferred?: 'payment' } = {}
): Promise<{ step: CheckoutStep; error?: string }> {
  const { organization, customerPhone } = context
  const currency = order.currency || organization.currency || 'INR'
  const total = formatMoney(order.total_amount, currency)
  const hasAddress = Boolean(order.shipping_address?.address_line_1)
  let lastError: string | undefined

  if (organization.commerce_address_flow_id && !hasAddress) {
    const result = await sendAndLog(
      context,
      buildAddressFlowMessage({
        phone: customerPhone,
        flowId: organization.commerce_address_flow_id,
        orderId: order.id,
        bodyText: `${intro}\n\n${CHECKOUT_TEXT.askAddress}`,
      }),
      `[Sent delivery address form for Order #${order.order_number}]`
    )
    if (result.ok) return { step: 'address' }
    lastError = result.error
    // Fall through: if the form could not be sent, still give the customer a way forward
  }

  const canPayOnline = Boolean(getPaymentGateway(organization)) && items.length > 0 && Number(order.total_amount) > 0
  const offersCod = organization.commerce_enable_cod !== false

  if (canPayOnline && offersCod && options.preferred !== 'payment') {
    const result = await sendAndLog(
      context,
      buildButtonsMessage(customerPhone, `${intro}\n\n${CHECKOUT_TEXT.askHowToPay(total)}`, [
        { id: `pay_online_${order.id}`, title: 'Pay online' },
        { id: `cod_confirm_${order.id}`, title: 'Cash on Delivery' },
      ]),
      `[Asked how to pay for Order #${order.order_number} (${total}): online or Cash on Delivery]`
    )
    if (result.ok) return { step: 'choice' }
    lastError = result.error
  }

  if (canPayOnline) {
    const result = await sendPaymentRequest(context, order, items, intro)
    if (result.ok) return { step: 'payment' }
    lastError = result.error
  }

  if (offersCod) {
    const result = await sendAndLog(
      context,
      buildButtonsMessage(customerPhone, `${intro}\n\n${CHECKOUT_TEXT.confirmCod(total)}`, [
        { id: `cod_confirm_${order.id}`, title: 'Confirm order' },
      ]),
      `[Sent Cash on Delivery confirmation for Order #${order.order_number} (${total})]`
    )
    if (result.ok) return { step: 'cod' }
    lastError = result.error
  }

  const result = await sendAndLog(
    context,
    buildTextMessage(customerPhone, `${intro}\n\n${CHECKOUT_TEXT.acknowledge}`),
    `[Sent order acknowledgement for Order #${order.order_number} (${total})]`
  )
  if (result.ok) return { step: 'acknowledged' }

  // Nothing reached the customer. Say so in the chat, with WhatsApp's reason, so the team sees a
  // stalled checkout instead of what looks like no reply at all.
  const error = result.error || lastError || 'WhatsApp did not accept the checkout messages.'
  if (context.conversationId) {
    await context.supabase.from('messages').insert({
      organization_id: organization.id,
      conversation_id: context.conversationId,
      sender_type: 'user',
      body: `[Checkout message for Order #${order.order_number} (${total}) could not be sent]`,
      status: 'failed',
      error_message: error,
    })
  }
  return { step: 'not_sent', error }
}

// ── 1. A cart arrives ───────────────────────────────────────────────────────

/**
 * Handle incoming native cart order (`type: "order"`) from WhatsApp
 */
export async function handleInboundCommerceOrder({
  organization,
  contact,
  conversation,
  orderPayload,
  customerPhone,
  messageId,
  database,
}: {
  organization: any
  contact: any
  conversation: any
  orderPayload: any
  customerPhone: string
  /** WhatsApp message id of the cart. Meta redelivers webhooks, so it is the idempotency key. */
  messageId?: string
  /** Test seam; production uses the service-role client. */
  database?: Database
}) {
  const supabase = database || getSupabase()
  const rawItems: any[] = Array.isArray(orderPayload?.product_items) ? orderPayload.product_items : []
  if (!rawItems.length) {
    console.warn('[Commerce] Ignoring cart with no items')
    return null
  }

  // A redelivered webhook must not create a second order or message the customer again
  if (messageId) {
    const { data: existing } = await supabase
      .from('commerce_orders')
      .select('*')
      .eq('organization_id', organization.id)
      .eq('meta_order_id', messageId)
      .order('created_at', { ascending: true })
      .limit(1)
    if (existing && existing.length > 0) {
      console.log(`[Commerce] Cart ${messageId} already recorded as Order ${existing[0].order_number}`)
      return { order: existing[0], items: [], duplicate: true as const }
    }
  }

  // 1. Resolve product titles and fallback prices from the local catalog in one query
  const retailerIds = [...new Set(rawItems.map((item) => String(item.product_retailer_id || '')).filter(Boolean))]
  const { data: dbProducts } = retailerIds.length
    ? await supabase
        .from('commerce_products')
        .select('id, retailer_id, title, price, image_url')
        .eq('organization_id', organization.id)
        .in('retailer_id', retailerIds)
    : { data: [] }
  const productsBySku = new Map<string, any>((dbProducts || []).map((product: any) => [product.retailer_id, product]))

  // Products the dashboard has not synced yet are looked up in the Meta catalog, so the order
  // shows real names instead of "Item #SKU". Best effort: an order is never delayed for it.
  const unknownSkus = retailerIds.filter((sku) => !productsBySku.has(sku))
  const catalogId = orderPayload.catalog_id || organization.meta_catalog_id
  if (unknownSkus.length > 0 && catalogId && organization.whatsapp_api_token) {
    const found = await fetchMetaProductsBySku(catalogId, organization.whatsapp_api_token, unknownSkus, organization.whatsapp_graph_api_version || 'v25.0')
    for (const product of found) {
      const { data: saved } = await supabase
        .from('commerce_products')
        .upsert({ organization_id: organization.id, ...product, updated_at: new Date().toISOString() }, { onConflict: 'organization_id,retailer_id' })
        .select('id, retailer_id, title, price, image_url')
        .maybeSingle()
      productsBySku.set(product.retailer_id, saved || product)
    }
  }

  // The store's catalog sets the price of a product it knows; the cart's own price only counts
  // for products that were never synced (see chooseUnitPrice)
  const items: OrderDetailsItem[] = rawItems.map((item) => {
    const retailerId = String(item.product_retailer_id || '')
    const product = productsBySku.get(retailerId)
    return {
      retailer_id: retailerId,
      name: product?.title || `Item #${retailerId}`,
      unit_price: chooseUnitPrice(parseFloat(item.item_price), product?.price),
      quantity: Math.max(1, parseInt(item.quantity, 10) || 1),
    }
  })

  // 2. Calculate totals, in paise, rounded once
  const totals = calculateOrderTotals(items, {
    shippingFee: parseFloat(organization.commerce_default_shipping_fee) || 0,
    freeShippingThreshold: parseFloat(organization.commerce_free_shipping_threshold) || 0,
  })
  const currency = String(rawItems[0]?.currency || organization.currency || 'INR').toUpperCase()

  // 3. Create Commerce Order in DB
  const orderNumber = await createOrderNumber(supabase, organization.id)
  const { data: newOrder, error: orderErr } = await supabase
    .from('commerce_orders')
    .insert([
      {
        organization_id: organization.id,
        contact_id: contact.id,
        conversation_id: conversation.id,
        order_number: orderNumber,
        status: organization.commerce_address_flow_id ? 'awaiting_address' : 'payment_pending',
        checkout_type: 'in_chat',
        catalog_id: orderPayload.catalog_id || null,
        subtotal: totals.subtotal,
        shipping_fee: totals.shippingFee,
        tax_amount: totals.taxAmount,
        total_amount: totals.grandTotal,
        currency,
        payment_status: 'pending',
        customer_note: orderPayload.text ? String(orderPayload.text).slice(0, 1000) : null,
        meta_order_id: messageId || null,
      },
    ])
    .select()
    .single()

  if (orderErr) {
    console.error('[Commerce] Error creating commerce order:', orderErr)
    throw orderErr
  }

  // Two deliveries of the same cart can arrive at the same moment and both pass the check above.
  // The earliest order wins; the other one removes itself before the customer is messaged twice.
  if (messageId) {
    const { data: sameCart } = await supabase
      .from('commerce_orders')
      .select('*')
      .eq('organization_id', organization.id)
      .eq('meta_order_id', messageId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
    if (sameCart && sameCart.length > 1 && sameCart[0].id !== newOrder.id) {
      await supabase.from('commerce_orders').delete().eq('id', newOrder.id)
      return { order: sameCart[0], items: [], duplicate: true as const }
    }
  }

  // 4. Create Order Items
  const { error: itemsErr } = await supabase.from('commerce_order_items').insert(
    items.map((item) => ({
      order_id: newOrder.id,
      product_id: productsBySku.get(item.retailer_id)?.id || null,
      retailer_id: item.retailer_id,
      title: item.name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: lineTotal(item.unit_price, item.quantity),
      image_url: productsBySku.get(item.retailer_id)?.image_url || null,
    }))
  )
  if (itemsErr) {
    // An order without its lines cannot be fulfilled or charged; undo it so the retry starts clean
    await supabase.from('commerce_orders').delete().eq('id', newOrder.id)
    console.error('[Commerce] Error saving order items:', itemsErr)
    throw itemsErr
  }

  console.log(`[Commerce] Created Order ${newOrder.order_number} for Contact ${contact.id}`)

  // 5. Tell the customer what happens next
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0)
  const { step } = await sendNextCheckoutStep(
    { supabase, organization, conversationId: conversation.id, customerPhone },
    newOrder,
    items,
    CHECKOUT_TEXT.received(newOrder.order_number, itemCount, formatMoney(totals.grandTotal, currency))
  )

  return { order: newOrder, items, step }
}

// ── 2. The delivery address comes back ──────────────────────────────────────

const clean = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** The order id carried by an address form's token ("order_<uuid>"), or null. */
export function orderIdFromFlowToken(flowToken: string | null | undefined): string | null {
  const match = String(flowToken || '').match(/^order_(.+)$/)
  return match && UUID_PATTERN.test(match[1].trim()) ? match[1].trim() : null
}

/**
 * Handle address form submission via WhatsApp Flow (`nfm_reply`).
 * Returns the order the address was saved to, or null when the form does not belong to an
 * order of this customer (so the caller can pass it on to whatever else handles forms).
 */
export async function handleInboundAddressSubmission({
  organization,
  contact,
  conversation,
  submissionData,
  flowToken,
  customerPhone,
  database,
}: {
  organization: any
  contact: any
  conversation: any
  submissionData: Record<string, any>
  flowToken?: string
  customerPhone: string
  database?: Database
}) {
  const supabase = database || getSupabase()
  const addressLine = clean(submissionData?.address_line_1, 200)
  if (!addressLine) return null

  // 1. Locate the order: the one named by the form's token, otherwise the customer's latest
  //    order that is still waiting for an address.
  const tokenOrderId = orderIdFromFlowToken(flowToken || submissionData?.flow_token)
  let order: any = null
  if (tokenOrderId) {
    const { data } = await supabase
      .from('commerce_orders')
      .select('*, items:commerce_order_items(*)')
      .eq('organization_id', organization.id)
      .eq('contact_id', contact.id)
      .eq('id', tokenOrderId)
      .maybeSingle()
    order = data
  } else {
    const { data } = await supabase
      .from('commerce_orders')
      .select('*, items:commerce_order_items(*)')
      .eq('organization_id', organization.id)
      .eq('contact_id', contact.id)
      .in('status', ['awaiting_address', 'cart_submitted'])
      .order('created_at', { ascending: false })
      .limit(1)
    order = data?.[0] || null
  }

  if (!order) {
    console.log('[Commerce] No matching order found for address submission')
    return null
  }

  // A customer can reopen an old address form. Never pull a paid or fulfilled order
  // back to "payment pending" or send a second payment request for it.
  if (order.payment_status === 'paid' || !isOpen(order.status)) {
    console.log(`[Commerce] Ignoring address submission for Order #${order.order_number} in status ${order.status}`)
    return order
  }

  // 2. Update order with address and advance status
  const isExpress = String(submissionData.delivery_speed || '').toLowerCase() === 'express'
  const previous = order.shipping_address || {}
  // Take off whatever express surcharge the stored fee already includes before adding the new
  // one, so resubmitting the form (or switching back to standard) never stacks the surcharge.
  const previousExpressFee = previous.delivery_speed === 'express' ? Number(previous.express_fee ?? getExpressFee(organization)) || 0 : 0
  const expressFee = isExpress ? getExpressFee(organization) : 0
  const updatedShippingFee = fromMinorUnits(Math.max(0, toMinorUnits(order.shipping_fee) - toMinorUnits(previousExpressFee) + toMinorUnits(expressFee)))
  const updatedTotal = fromMinorUnits(toMinorUnits(order.subtotal) + toMinorUnits(updatedShippingFee) + toMinorUnits(order.tax_amount))

  const shippingAddress = {
    ...previous,
    full_name: clean(submissionData.full_name, 100),
    phone_number: clean(submissionData.phone_number, 30) || customerPhone,
    address_line_1: addressLine,
    address_line_2: clean(submissionData.address_line_2, 200),
    city: clean(submissionData.city, 80),
    state: clean(submissionData.state, 80),
    pincode: clean(submissionData.pincode, 12),
    delivery_speed: isExpress ? 'express' : 'standard',
    express_fee: expressFee,
    notes: clean(submissionData.instructions, 300),
  }

  const { error: updateErr } = await supabase
    .from('commerce_orders')
    .update({
      shipping_address: shippingAddress,
      shipping_fee: updatedShippingFee,
      total_amount: updatedTotal,
      status: 'payment_pending',
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id)
  if (updateErr) throw updateErr

  console.log(`[Commerce] Updated Order #${order.order_number} with shipping address`)

  // 3. Ask for payment (or COD confirmation) now that the address is on file
  const updatedOrder = { ...order, shipping_address: shippingAddress, shipping_fee: updatedShippingFee, total_amount: updatedTotal, status: 'payment_pending' }
  const currency = order.currency || organization.currency || 'INR'
  const deliveryNote = isExpress
    ? expressFee > 0 ? ` Express delivery adds ${formatMoney(expressFee, currency)}.` : ' You chose express delivery.'
    : ''
  await sendNextCheckoutStep(
    { supabase, organization, conversationId: conversation?.id || order.conversation_id || null, customerPhone },
    updatedOrder,
    toOrderItems(order.items),
    `Thanks, your delivery address is saved.${deliveryNote} Order #${order.order_number} total: ${formatMoney(updatedTotal, currency)}.`
  )

  return updatedOrder
}

// ── 3. The customer taps a checkout button ──────────────────────────────────

export type CheckoutButtonOutcome =
  | 'cod_confirmed'
  | 'payment_requested'
  | 'already_done'
  | 'canceled'
  | 'unavailable'
  | 'not_found'
  | 'failed'

/**
 * Handle the buttons this checkout sends: "Cash on Delivery" / "Confirm order"
 * (`cod_confirm_<order id>`) and "Pay online" (`pay_online_<order id>`).
 * Returns `handled: false` for any other button so the caller can pass it on.
 */
export async function handleCheckoutButton({
  organization,
  contact,
  conversation,
  buttonId,
  customerPhone,
  database,
}: {
  organization: any
  contact: any
  conversation: any
  buttonId: string | null | undefined
  customerPhone: string
  database?: Database
}): Promise<{ handled: boolean; outcome?: CheckoutButtonOutcome; order?: any }> {
  const match = String(buttonId || '').match(/^(cod_confirm|pay_online)_(.+)$/)
  if (!match) return { handled: false }
  const [, action, orderId] = match

  const supabase = database || getSupabase()
  const context: CheckoutContext = { supabase, organization, conversationId: conversation?.id || null, customerPhone }
  const reply = (text: string, logLine: string) => sendAndLog(context, buildTextMessage(customerPhone, text), logLine)

  // Only this customer's own order in this organization
  const { data: order } = UUID_PATTERN.test(orderId)
    ? await supabase
        .from('commerce_orders')
        .select('*')
        .eq('id', orderId)
        .eq('organization_id', organization.id)
        .eq('contact_id', contact.id)
        .maybeSingle()
    : { data: null }
  if (!order) return { handled: true, outcome: 'not_found' }

  const currency = order.currency || organization.currency || 'INR'
  const total = formatMoney(order.total_amount, currency)

  // An old button tapped again must not reopen an order that is already paid, shipped or canceled
  if (order.status === 'canceled') {
    await reply(`Order #${order.order_number} was canceled. To order again, send us a new cart.`, `[Told customer Order #${order.order_number} is canceled]`)
    return { handled: true, outcome: 'canceled', order }
  }
  if (!isOpen(order.status) || order.payment_status === 'paid') {
    const label = (ORDER_STATUS_LABELS[order.status as OrderStatus] || order.status).toLowerCase()
    await reply(`Order #${order.order_number} is already ${label}. There is nothing more you need to do.`, `[Told customer Order #${order.order_number} is already ${label}]`)
    return { handled: true, outcome: 'already_done', order }
  }

  if (action === 'pay_online') {
    const items = await loadOrderItems(supabase, order.id)
    const result = await sendPaymentRequest(context, order, items, `Order #${order.order_number}: ${total}.`)
    if (result.ok) {
      await supabase.from('commerce_orders').update({ status: 'payment_pending', updated_at: new Date().toISOString() }).eq('id', order.id).in('status', OPEN_CHECKOUT_STATUSES)
      return { handled: true, outcome: 'payment_requested', order }
    }
    console.error(`[Commerce] Payment request for Order #${order.order_number} failed: ${result.error}`)
    await reply(
      `We could not start the online payment for order #${order.order_number}. Our team will contact you shortly to help.`,
      `[Online payment for Order #${order.order_number} could not be started: ${result.error}]`
    )
    return { handled: true, outcome: 'failed', order }
  }

  // Cash on Delivery
  if (organization.commerce_enable_cod === false) {
    const items = await loadOrderItems(supabase, order.id)
    await sendNextCheckoutStep(context, order, items, `Cash on Delivery is not available for order #${order.order_number}.`, { preferred: 'payment' })
    return { handled: true, outcome: 'unavailable', order }
  }

  // The status condition makes two quick taps (or a redelivered webhook) confirm the order once
  const { data: confirmed, error: confirmErr } = await supabase
    .from('commerce_orders')
    .update({ status: 'cod_confirmed', payment_method: 'cod', payment_status: 'pending', updated_at: new Date().toISOString() })
    .eq('id', order.id)
    .eq('organization_id', organization.id)
    .in('status', OPEN_CHECKOUT_STATUSES)
    .select('id')
  if (confirmErr) throw confirmErr
  if (!confirmed || confirmed.length === 0) return { handled: true, outcome: 'already_done', order }

  const address = formatAddress(order.shipping_address)
  await reply(
    `${CHECKOUT_TEXT.codConfirmed(order.order_number, total)}${address ? `\n\nDelivering to: ${address}` : ''}`,
    `[Order #${order.order_number} confirmed for Cash on Delivery (${total})]`
  )
  return { handled: true, outcome: 'cod_confirmed', order: { ...order, status: 'cod_confirmed', payment_method: 'cod' } }
}

// ── 4. A payment result arrives ─────────────────────────────────────────────

/** Find the order a payment reference belongs to, inside one organization. */
async function findOrderByReference(supabase: Database, organizationId: string, referenceId: string) {
  const { data: exact } = await supabase
    .from('commerce_orders')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('meta_payment_reference', referenceId)
    .limit(1)
  if (exact && exact.length > 0) return exact[0]

  const parsed = parsePaymentReference(referenceId)
  if (!parsed) return null
  // An earlier request for the same order ("ORD-...-AB12" after "ORD-...-AB12.2" was sent) is
  // still that order; requests from before order numbers were used carried the order id.
  const query = supabase.from('commerce_orders').select('*').eq('organization_id', organizationId)
  const { data } = parsed.kind === 'order_id'
    ? await query.eq('id', parsed.orderId).limit(1)
    : await query.eq('order_number', parsed.orderNumber).limit(1)
  return data?.[0] || null
}

/** The ledger row of a gateway transaction, inside one organization. */
async function findTransaction(supabase: Database, organizationId: string, transactionId: string) {
  const { data } = await supabase
    .from('commerce_transactions')
    .select('id, order_id, status')
    .eq('organization_id', organizationId)
    .eq('transaction_id', transactionId)
    .limit(1)
  return data?.[0] || null
}

/**
 * Write a payment to the ledger. Returns null when the same transaction is already there (Meta
 * delivered it twice, or a parallel delivery got in first; migration
 * 20261104_commerce_transactions_unique.sql). Anything else is thrown so Meta redelivers: money
 * must never go unrecorded.
 */
async function recordTransaction(supabase: Database, row: Record<string, any>): Promise<{ id: string | null } | null> {
  const { data, error } = await supabase.from('commerce_transactions').insert(row).select('id').maybeSingle()
  if (!error) return { id: data?.id || null }
  if (isUniqueViolation(error)) return null
  console.error(`[Commerce] Transaction ${row.transaction_id} could not be recorded:`, error)
  throw error
}

/** The gateway's id of a payment; without one, the webhook's own id, which is the same on every redelivery. */
const transactionIdOf = (update: PaymentUpdate) => update.transactionId || (update.eventId ? `TXN_${update.eventId}` : `TXN_${Date.now()}`)

/** A note on the order for the team. The same note is never added twice. */
async function noteOnOrder(supabase: Database, order: any, note: string): Promise<void> {
  const existing = String(order.customer_note || '')
  if (existing.includes(note)) return
  const customer_note = [existing, note].filter(Boolean).join('\n')
  await supabase.from('commerce_orders').update({ customer_note, updated_at: new Date().toISOString() }).eq('id', order.id)
  order.customer_note = customer_note
}

const today = () => new Date().toISOString().slice(0, 10)

/** The customer's first name for a thank-you, unless it is really a phone number or a WhatsApp id. */
function firstNameOf(value: unknown): string | undefined {
  const word = String(value || '').trim().split(/\s+/)[0] || ''
  return word && /[^0-9+\-().\s]/.test(word) && !/^\+?\d/.test(word) && !isBsuid(word) ? word : undefined
}

// ── Payments for campaign "Order details" templates ─────────────────────────
// The campaign worker sends order_details templates under a reference made of the campaign id and
// the recipient's campaign_logs id. No order exists for those, so one is created when the money
// arrives, from what the template asked for (order_amount, order_item_name, ...).

const PAGE = 1000

/** The first row whose id starts with `prefix`, read a page at a time: PostgREST cannot filter a uuid by prefix. */
async function findRowByIdPrefix(prefix: string, page: (from: number, to: number) => PromiseLike<{ data: any[] | null }>) {
  for (let from = 0; from < 500 * PAGE; from += PAGE) {
    const { data } = await page(from, from + PAGE - 1)
    const rows = data || []
    const hit = rows.find((row: any) => uuidHasPrefix(row.id, prefix))
    if (hit) return hit
    if (rows.length < PAGE) return null
  }
  return null
}

/** The ways one number may be stored on a contact (the campaign worker matches the same variants). */
function phoneVariants(value: unknown): string[] {
  const raw = String(value || '').replace(/^whatsapp:/i, '').trim()
  if (!raw) return []
  const digits = raw.replace(/[\s\-()]/g, '')
  const bare = digits.replace(/^\+/, '')
  return [...new Set([raw, digits, bare, `+${bare}`, `whatsapp:${bare}`, `whatsapp:+${bare}`])]
}

/** A value the campaign's CSV supplied for the recipient, under any of the names the template send accepts. */
function campaignVar(vars: Record<string, any>, ...keys: string[]): string {
  for (const key of keys) {
    const name = Object.keys(vars).find((candidate) => candidate.toLowerCase() === key)
    const value = name ? String(vars[name] ?? '').trim() : ''
    if (value) return value
  }
  return ''
}

/**
 * The order for a campaign payment, created unpaid: the caller records the money and marks it
 * paid like any other order. Null when the reference is not a campaign's, or the campaign is gone.
 */
async function createOrderForCampaignPayment(supabase: Database, organization: any, update: PaymentUpdate, customerPhone: string) {
  const parsed = parseCampaignReference(update.referenceId)
  if (!parsed) return null

  const campaign = await findRowByIdPrefix(parsed.campaignPrefix, (from, to) =>
    supabase.from('campaigns').select('id, name').eq('organization_id', organization.id).order('id', { ascending: true }).range(from, to)
  )
  if (!campaign) return null
  // campaign_logs has no organization column: its rows are reached through this organization's
  // campaign. A send can be large, so the pages carry ids only and the one row is read after.
  const logId = await findRowByIdPrefix(parsed.logPrefix, (from, to) =>
    supabase.from('campaign_logs').select('id').eq('campaign_id', campaign.id).order('id', { ascending: true }).range(from, to)
  )
  const { data: log } = logId
    ? await supabase.from('campaign_logs').select('id, phone_number, variables_mapped, created_at').eq('id', logId.id).eq('campaign_id', campaign.id).maybeSingle()
    : { data: null }
  if (!log) return null

  // What was asked for. The captured amount is the truth; the template's lines describe it when they add up.
  const vars: Record<string, any> = log.variables_mapped && typeof log.variables_mapped === 'object' ? log.variables_mapped : {}
  const quantity = Math.max(1, Math.floor(Number(campaignVar(vars, 'order_quantity', 'quantity')) || 1))
  const unitPrice = Number(campaignVar(vars, 'order_amount', 'order_total', 'amount')) || 0
  const shippingFee = Math.max(0, Number(campaignVar(vars, 'shipping_fee')) || 0)
  const taxAmount = Math.max(0, Number(campaignVar(vars, 'tax_amount')) || 0)
  const templateTotal = fromMinorUnits(toMinorUnits(unitPrice) * quantity + toMinorUnits(shippingFee) + toMinorUnits(taxAmount))
  const paid = update.amount > 0 ? update.amount : templateTotal
  if (!(paid > 0)) return null
  const linesAddUp = unitPrice > 0 && Math.abs(templateTotal - paid) <= 0.01
  const item = {
    retailer_id: campaignVar(vars, 'order_item_id', 'product_id') || 'campaign',
    title: campaignVar(vars, 'order_item_name', 'product_name') || `Payment requested by campaign "${campaign.name}"`,
    quantity: linesAddUp ? quantity : 1,
    unit_price: linesAddUp ? unitPrice : paid,
  }

  // The customer: the campaign's recipient, whom the worker filed as a contact before sending
  const numbers = [...new Set([...phoneVariants(log.phone_number), ...phoneVariants(customerPhone)])]
  let contact: any = null
  if (numbers.length > 0) {
    const { data } = await supabase.from('contacts').select('id, first_name, phone_number').eq('organization_id', organization.id).in('phone_number', numbers).limit(1)
    contact = data?.[0] || null
    if (!contact) {
      const phone = String(customerPhone || log.phone_number).replace(/^whatsapp:/i, '').trim()
      const { data: created } = await supabase
        .from('contacts')
        .insert([{ organization_id: organization.id, phone_number: phone, whatsapp_number: `whatsapp:${phone}`, first_name: phone }])
        .select('id, first_name, phone_number')
        .maybeSingle()
      contact = created || null
    }
  }
  let conversationId: string | null = null
  if (contact) {
    const { data: latest } = await supabase
      .from('conversations')
      .select('id')
      .eq('organization_id', organization.id)
      .eq('contact_id', contact.id)
      .order('last_message_at', { ascending: false })
      .limit(1)
    conversationId = latest?.[0]?.id || null
    if (!conversationId) {
      const { data: created } = await supabase
        .from('conversations')
        .insert([{ organization_id: organization.id, contact_id: contact.id, is_active: true, last_message_at: new Date().toISOString() }])
        .select('id')
        .maybeSingle()
      conversationId = created?.id || null
    }
  }

  const currency = update.currency || organization.currency || 'INR'
  const orderNumber = await createOrderNumber(supabase, organization.id)
  const { data: order, error: orderErr } = await writeWithPaymentRequests(
    {
      organization_id: organization.id,
      contact_id: contact?.id || null,
      conversation_id: conversationId,
      order_number: orderNumber,
      status: 'payment_pending',
      checkout_type: 'campaign',
      subtotal: lineTotal(item.unit_price, item.quantity),
      shipping_fee: linesAddUp ? shippingFee : 0,
      tax_amount: linesAddUp ? taxAmount : 0,
      total_amount: paid,
      currency,
      payment_status: 'pending',
      customer_note: `Paid through the "${campaign.name}" campaign.`,
      meta_payment_reference: update.referenceId,
      payment_requests: [{ reference: update.referenceId, amount: paid, currency, requested_at: log.created_at || new Date().toISOString() }],
    },
    (row) => supabase.from('commerce_orders').insert([row]).select().single()
  )
  if (orderErr || !order) {
    console.error('[Commerce] Error creating the order for a campaign payment:', orderErr)
    throw orderErr || new Error('The order for the campaign payment could not be created')
  }

  // Two deliveries of the same payment can both get here; the earliest order wins
  const { data: sameReference } = await supabase
    .from('commerce_orders')
    .select('*')
    .eq('organization_id', organization.id)
    .eq('meta_payment_reference', update.referenceId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (sameReference && sameReference.length > 1 && sameReference[0].id !== order.id) {
    await supabase.from('commerce_orders').delete().eq('id', order.id)
    return sameReference[0]
  }

  const { error: itemsErr } = await supabase.from('commerce_order_items').insert([
    { order_id: order.id, product_id: null, retailer_id: item.retailer_id, title: item.title, quantity: item.quantity, unit_price: item.unit_price, total_price: lineTotal(item.unit_price, item.quantity), image_url: null },
  ])
  if (itemsErr) {
    await supabase.from('commerce_orders').delete().eq('id', order.id)
    throw itemsErr
  }
  console.log(`[Commerce] Created Order ${order.order_number} for a payment from campaign "${campaign.name}"`)
  return order
}

/**
 * Money that arrived for no order this store knows (a reference from elsewhere, a campaign that
 * was deleted): written to the ledger without an order, so it can be traced, and logged.
 */
async function recordUnmatchedPayment(supabase: Database, organization: any, update: PaymentUpdate, paymentPayload: any): Promise<void> {
  const transactionId = transactionIdOf(update)
  console.warn(`[Commerce] Payment ${transactionId} of ${update.amount} ${update.currency || ''} under reference "${update.referenceId}" matches no order; recorded as unmatched`)
  if (await findTransaction(supabase, organization.id, transactionId)) return
  try {
    await recordTransaction(supabase, {
      order_id: null,
      organization_id: organization.id,
      gateway: organization.commerce_payment_gateway || 'razorpay',
      transaction_id: transactionId,
      amount: update.amount,
      currency: update.currency || organization.currency || 'INR',
      status: 'unmatched',
      raw_payload: paymentPayload,
    })
  } catch (err: any) {
    // A database that insists on an order for every row cannot hold it: say so loudly rather than have Meta retry for days
    if (String(err?.code) === '23502') {
      console.error('[Commerce] UNRECORDED PAYMENT (commerce_transactions.order_id does not allow NULL):', JSON.stringify(paymentPayload))
      return
    }
    throw err
  }
}

/**
 * Handle payment confirmation (`type: "payment"` or `payment_status` interactive update)
 */
export async function handleInboundPaymentConfirmation({
  organization,
  contact,
  conversation,
  paymentPayload,
  customerPhone,
  database,
}: {
  organization: any
  contact?: any
  /** Optional: a payment status webhook carries no conversation, so the order's own is used. */
  conversation?: any
  paymentPayload: any
  customerPhone?: string
  database?: Database
}) {
  const supabase = database || getSupabase()
  const update = normalizePaymentUpdate(paymentPayload)
  if (!update) return null

  // 1. Find the order. It must belong to the organization that received the webhook; the
  //    reference alone must never reach another tenant's order. A payment for a campaign template
  //    has no order yet, so one is made for it; money that matches nothing is still recorded.
  let order = await findOrderByReference(supabase, organization.id, update.referenceId)
  if (!order && update.outcome === 'paid') {
    order = await createOrderForCampaignPayment(supabase, organization, update, customerPhone || '')
    if (!order) await recordUnmatchedPayment(supabase, organization, update, paymentPayload)
  }
  if (!order) return null

  const receiptConversationId = conversation?.id || order.conversation_id || null
  let receiptPhone = customerPhone || ''
  let customerName = String(contact?.first_name || '').trim()
  if ((!receiptPhone || !customerName) && order.contact_id) {
    const { data: orderContact } = await supabase
      .from('contacts')
      .select('phone_number, first_name')
      .eq('id', order.contact_id)
      .eq('organization_id', organization.id)
      .maybeSingle()
    receiptPhone = receiptPhone || orderContact?.phone_number || ''
    customerName = customerName || String(orderContact?.first_name || '').trim()
  }
  const context: CheckoutContext = { supabase, organization, conversationId: receiptConversationId, customerPhone: receiptPhone }
  const currency = update.currency || order.currency || organization.currency || 'INR'
  const money = (amount: number) => formatMoney(amount, currency)

  if (update.outcome !== 'paid') {
    console.log(`[Commerce] Payment for Order #${order.order_number} is ${update.outcome}; order left unpaid`)
    if (update.outcome === 'failed') {
      // Only a payment still awaited can fail: a capture that got in first is never overwritten
      const { data: failed, error: failErr } = await supabase
        .from('commerce_orders')
        .update({ payment_status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', order.id)
        .in('payment_status', ['pending'])
        .select('id')
      if (failErr) throw failErr
      if (failed && failed.length > 0) {
        // Say it once, so the customer is not left wondering whether the money went through
        if (receiptPhone && isOpen(order.status)) {
          await sendAndLog(
            context,
            buildTextMessage(receiptPhone, `The payment for order #${order.order_number} did not go through, and you have not been charged for this order. You can tap "Review and pay" above to try again, or reply here for help.`),
            `[Payment failed for Order #${order.order_number}; customer was told]`
          )
        }
        return { ...order, payment_status: 'failed' }
      }
    }
    return order
  }

  // 2. Money arrived. It is checked against the amount asked for under its reference (or the
  //    order total, for requests sent before amounts were kept).
  const transactionId = transactionIdOf(update)
  const requested = findPaymentRequest(order, update.referenceId)
  const expected = requested ? requested.amount : Number(order.total_amount)
  // Meta did not report an amount: taken as the amount asked for
  const paidAmount = update.amount > 0 ? update.amount : expected
  const differs = (a: number, b: number) => Math.abs(a - b) > 0.01
  const recorded = await findTransaction(supabase, organization.id, transactionId)
  const ledgerRow = (status: 'captured' | 'duplicate') => ({
    order_id: order.id,
    organization_id: organization.id,
    gateway: organization.commerce_payment_gateway || 'razorpay',
    transaction_id: transactionId,
    amount: paidAmount,
    currency,
    status,
    raw_payload: paymentPayload,
  })

  // 2a. Already paid: the same transaction again is Meta redelivering it; a different one is a
  //     second payment, which has to go back to the customer.
  if (order.payment_status === 'paid') {
    if (recorded) {
      console.log(`[Commerce] Order #${order.order_number} is already paid; ignoring duplicate payment update`)
      return order
    }
    if (!(await recordTransaction(supabase, ledgerRow('duplicate')))) return order
    await noteOnOrder(supabase, order, `Second payment of ${money(paidAmount)} received on ${today()} (reference ${update.referenceId}); refund due.`)
    await logSystemLine(context, `[Second payment of ${money(paidAmount)} received for Order #${order.order_number}; refund due]`)
    if (receiptPhone) {
      await sendAndLog(
        context,
        buildTextMessage(receiptPhone, `We received a second payment of ${money(paidAmount)} for order #${order.order_number}, which was already paid. It will be refunded; our team will contact you shortly.`),
        `[Told customer Order #${order.order_number} is already paid; the second payment will be refunded]`
      )
    }
    return order
  }

  // 2b. The ledger comes first: a crash can leave a transaction without a paid order (finished on
  //     redelivery), never a paid order without its transaction.
  const inserted = recorded ? null : await recordTransaction(supabase, ledgerRow('captured'))
  if (!recorded && !inserted) {
    // A parallel delivery recorded it a moment ago and is finishing the order
    return order
  }

  // 2c. Not the amount asked for: the order is not marked paid. The team decides, the customer is told.
  if (differs(paidAmount, expected)) {
    if (!recorded) {
      await noteOnOrder(supabase, order, `Payment of ${money(paidAmount)} received on ${today()} (reference ${update.referenceId}) but the order total is ${money(expected)}; team to review.`)
      await logSystemLine(context, `[Payment of ${money(paidAmount)} received for Order #${order.order_number} but the order total is ${money(expected)}; team to review]`)
      if (receiptPhone) {
        await sendAndLog(
          context,
          buildTextMessage(receiptPhone, `We received ${money(paidAmount)} for order #${order.order_number}. The order total is ${money(expected)}, so our team will contact you shortly to sort it out.`),
          `[Told customer Order #${order.order_number} is under review: paid ${money(paidAmount)} of ${money(expected)}]`
        )
      }
    }
    return order
  }

  // 3. Mark the order paid. The condition on payment_status makes two deliveries record it once.
  const { data: marked, error: updateErr } = await supabase
    .from('commerce_orders')
    .update({
      // A canceled or already-fulfilled order keeps its status; only the payment is recorded
      ...(isOpen(order.status) ? { status: 'paid' } : {}),
      payment_status: 'paid',
      payment_method: 'whatsapp_pay',
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id)
    .in('payment_status', ['pending', 'failed'])
    .select('id')
  if (updateErr) throw updateErr
  if (!marked || marked.length === 0) {
    // Another delivery marked it paid in between; our copy of the transaction is marked as such
    if (inserted?.id) await supabase.from('commerce_transactions').update({ status: 'duplicate' }).eq('id', inserted.id).eq('organization_id', organization.id)
    return { ...order, payment_status: 'paid' }
  }
  if (requested && differs(paidAmount, Number(order.total_amount))) {
    // Paid what an earlier request asked for; the order changed after it was sent (say, express delivery)
    await logSystemLine(context, `[Payment of ${money(paidAmount)} received for Order #${order.order_number} against an earlier request; the order total is now ${money(Number(order.total_amount))}]`)
  }

  // 4. Send the customer a receipt, in the conversation the order came from
  if (receiptPhone) {
    const text = order.status === 'canceled'
      ? `We received ${money(paidAmount)} for order #${order.order_number}, but this order was canceled. Our team will contact you about your refund.`
      : CHECKOUT_TEXT.paid(money(paidAmount), order.order_number)
    // The receipt card belongs to the payment request that was paid
    const card = await sendAndLog(
      context,
      buildOrderStatusMessage({ phone: receiptPhone, referenceId: update.referenceId, status: 'processing', description: text }),
      `[Payment received for Order #${order.order_number} (${money(paidAmount)}); receipt sent]`
    )
    if (!card.ok) {
      await sendAndLog(context, buildTextMessage(receiptPhone, text), `[Payment received for Order #${order.order_number} (${money(paidAmount)}); receipt sent]`)
    }
    // Then a warm thank-you, as a normal message the customer can reply to
    if (order.status !== 'canceled') {
      const items = await loadOrderItems(supabase, order.id)
      const thanks = CHECKOUT_TEXT.thankYou({
        // The address form stores the customer's name as full_name
        name: firstNameOf(order.shipping_address?.full_name) || firstNameOf(customerName),
        store: String(organization.name || '').trim() || undefined,
        orderNumber: order.order_number,
        items: items.map((item) => ({ name: item.name, quantity: item.quantity })),
        address: formatAddress(order.shipping_address),
      })
      await sendAndLog(context, buildTextMessage(receiptPhone, thanks), thanks)
    }
  }

  return { ...order, status: isOpen(order.status) ? 'paid' : order.status, payment_status: 'paid', payment_method: 'whatsapp_pay' }
}

// ── Actions from the dashboard ──────────────────────────────────────────────

/** WhatsApp's own order states, used by the native order card. */
const META_ORDER_STATUS: Partial<Record<OrderStatus, 'processing' | 'shipped' | 'completed' | 'canceled'>> = {
  paid: 'processing',
  cod_confirmed: 'processing',
  shipped: 'shipped',
  delivered: 'completed',
  canceled: 'canceled',
}

async function loadCustomerPhone(supabase: Database, organizationId: string, order: any): Promise<string> {
  if (order.contact?.phone_number) return order.contact.phone_number
  if (!order.contact_id) return ''
  const { data } = await supabase
    .from('contacts')
    .select('phone_number')
    .eq('id', order.contact_id)
    .eq('organization_id', organizationId)
    .maybeSingle()
  return data?.phone_number || ''
}

/**
 * Tell the customer about a status change. Orders that had a payment request get WhatsApp's
 * order card updated (which also keeps "Review and pay" in step with the order); everything
 * else, and any card WhatsApp refuses, is sent as a normal message.
 */
export async function notifyOrderStatus({
  organization,
  order,
  status,
  text,
  database,
}: {
  organization: any
  order: any
  status: OrderStatus
  text: string
  database?: Database
}): Promise<{ notified: boolean; error: string | null; viaCard: boolean }> {
  const supabase = database || getSupabase()
  const phone = await loadCustomerPhone(supabase, organization.id, order)
  if (!phone) return { notified: false, error: 'This order has no customer phone number.', viaCard: false }

  const context: CheckoutContext = { supabase, organization, conversationId: order.conversation_id || null, customerPhone: phone }
  const metaStatus = META_ORDER_STATUS[status]
  // WhatsApp does not allow a paid order to be canceled through the card (it has to be refunded)
  const cardAllowed = Boolean(metaStatus) && hasPaymentRequest(order) && !(status === 'canceled' && order.payment_status === 'paid')

  if (cardAllowed) {
    const card = await sendAndLog(
      context,
      buildOrderStatusMessage({ phone, referenceId: order.meta_payment_reference, status: metaStatus!, description: text }),
      text
    )
    if (card.ok) return { notified: true, error: null, viaCard: true }
  }

  const message = await sendAndLog(context, buildTextMessage(phone, text), text)
  return { notified: message.ok, error: message.ok ? null : message.error || 'WhatsApp did not accept the message.', viaCard: false }
}

/**
 * Withdraw the current payment request of an order, so the customer can no longer pay it from
 * the chat: the order is being canceled, or a new request replaces it. Nothing happens when no
 * request was sent or it is paid.
 */
export async function voidPaymentRequest({ organization, order, database, phone, description }: {
  organization: any
  order: any
  database?: Database
  /** The customer's number, when the caller already has it. */
  phone?: string
  /** What the withdrawn card says; the order was canceled unless told otherwise. */
  description?: string
}): Promise<boolean> {
  if (!hasPaymentRequest(order) || order.payment_status === 'paid') return false
  const supabase = database || getSupabase()
  const customerPhone = phone || (await loadCustomerPhone(supabase, organization.id, order))
  if (!customerPhone) return false
  const result = await sendWhatsAppMessage(
    organization,
    buildOrderStatusMessage({
      phone: customerPhone,
      referenceId: order.meta_payment_reference,
      status: 'canceled',
      description: description || `Order #${order.order_number} was canceled.`,
    })
  )
  return result.ok
}

/**
 * Send the customer the step their order is waiting on again (address form, payment request,
 * payment choice or Cash on Delivery confirmation). Used by "Send reminder" in the dashboard.
 */
export async function resendCheckoutStep({
  organization,
  order,
  database,
}: {
  organization: any
  order: any
  database?: Database
}): Promise<{ step: CheckoutStep; error?: string }> {
  if (!isOpen(order.status) || order.payment_status === 'paid') {
    return { step: 'not_sent', error: 'This order is not waiting on the customer any more.' }
  }
  const supabase = database || getSupabase()
  const phone = await loadCustomerPhone(supabase, organization.id, order)
  if (!phone) return { step: 'not_sent', error: 'This order has no customer phone number.' }

  const items = order.items ? toOrderItems(order.items) : await loadOrderItems(supabase, order.id)
  const currency = order.currency || organization.currency || 'INR'
  return sendNextCheckoutStep(
    { supabase, organization, conversationId: order.conversation_id || null, customerPhone: phone },
    order,
    items,
    `A reminder about your order #${order.order_number} (${formatMoney(order.total_amount, currency)}).`
  )
}
