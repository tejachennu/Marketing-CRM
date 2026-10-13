import { createClient } from '@supabase/supabase-js'
import {
  buildOrderDetailsMessage,
  buildOrderStatusMessage,
  OrderDetailsItem,
} from './commerce-messages'
import { calculateOrderTotals } from './meta-commerce'
import { formatMoney, getPaymentGateway, OPEN_CHECKOUT_STATUSES } from './commerce-utils'
import { cleanWhatsAppRecipient } from '@/lib/whatsapp-bsuid'

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

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

export interface PaymentUpdate {
  referenceId: string
  /** Only "paid" marks an order as paid. Anything unrecognised is treated as still pending. */
  outcome: 'paid' | 'pending' | 'failed'
  transactionId: string | null
  /** Amount in major units (rupees, not paise); 0 when Meta did not report one. */
  amount: number
  currency: string | null
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
  }
}

const EXPRESS_DELIVERY_SURCHARGE = 50 // e.g. ₹50 express surcharge

type Database = any

interface CheckoutContext {
  supabase: Database
  organization: any
  conversation: any
  customerPhone: string
}

/**
 * Send a message through the WhatsApp Cloud API.
 * Returns false (and logs why) when Meta rejects it, so callers do not record a
 * "[Sent ...]" line in the conversation for a message the customer never received.
 */
async function sendWhatsAppMessage(organization: any, payload: unknown): Promise<boolean> {
  if (!organization.whatsapp_api_token || !organization.whatsapp_phone_number_id) {
    console.warn('[Commerce Webhook] Missing WhatsApp credentials; cannot message the customer')
    return false
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
    if (!res.ok) {
      const detail = await res.json().catch(() => null)
      console.error('[Commerce Webhook] WhatsApp send failed:', detail?.error?.message || `HTTP ${res.status}`)
      return false
    }
    return true
  } catch (err) {
    console.error('[Commerce Webhook] WhatsApp send error:', err)
    return false
  }
}

/** Send a message and, when it was delivered, note it in the CRM conversation. */
async function sendAndLog(context: CheckoutContext, payload: unknown, logLine: string): Promise<boolean> {
  const sent = await sendWhatsAppMessage(context.organization, payload)
  if (sent) {
    await context.supabase.from('messages').insert({
      organization_id: context.organization.id,
      conversation_id: context.conversation.id,
      sender_type: 'user',
      body: logLine,
      status: 'sent',
    })
  }
  return sent
}

function textMessage(phone: string, body: string) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanWhatsAppRecipient(phone),
    type: 'text',
    text: { body },
  }
}

export type CheckoutStep = 'address' | 'payment' | 'cod' | 'acknowledged' | 'not_sent'

/**
 * Tell the customer what happens next with their order. Exactly one step is sent, in this
 * order of preference, so an order never ends in silence:
 *   1. the delivery address form (when one is configured and no address is on file),
 *   2. an in-chat payment request (when a payment gateway is configured),
 *   3. a Cash on Delivery confirmation button (when COD is enabled),
 *   4. a plain acknowledgement that the team will follow up.
 */
async function sendNextCheckoutStep(
  context: CheckoutContext,
  order: any,
  items: OrderDetailsItem[],
  intro: string
): Promise<CheckoutStep> {
  const { organization, customerPhone } = context
  const currency = order.currency || organization.currency || 'INR'
  const total = formatMoney(order.total_amount, currency)
  const hasAddress = Boolean(order.shipping_address?.address_line_1)

  if (organization.commerce_address_flow_id && !hasAddress) {
    const sent = await sendAndLog(context, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanWhatsAppRecipient(customerPhone),
      type: 'interactive',
      interactive: {
        type: 'flow',
        body: { text: `${intro}\n\nPlease enter your delivery address below:` },
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            mode: 'published',
            flow_id: organization.commerce_address_flow_id,
            flow_token: `order_${order.id}`,
            flow_cta: 'Add Delivery Address',
            flow_action: 'navigate',
            flow_action_payload: { screen: 'SHIPPING_DETAILS' },
          },
        },
      },
    }, `[Sent Address Flow for Order #${order.order_number}]`)
    if (sent) return 'address'
    // Fall through: if the form could not be sent, still give the customer a way forward
  }

  const gateway = getPaymentGateway(organization)
  if (gateway && items.length) {
    const sent = await sendAndLog(context, buildOrderDetailsMessage({
      phone: customerPhone,
      referenceId: order.id,
      currency,
      totalAmount: Number(order.total_amount),
      subtotal: Number(order.subtotal),
      shippingFee: Number(order.shipping_fee) || 0,
      taxAmount: Number(order.tax_amount) || 0,
      items,
      paymentGatewayType: gateway.type,
      paymentGatewayConfigName: gateway.configName,
      bodyText: `${intro}\n\nPlease review your order and complete the payment below:`,
    }), `[Sent WhatsApp Payment Request for Order #${order.order_number} (${total})]`)
    if (sent) return 'payment'
  }

  if (organization.commerce_enable_cod !== false) {
    const sent = await sendAndLog(context, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanWhatsAppRecipient(customerPhone),
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: `${intro}\n\nWould you like to confirm this order as Cash on Delivery?` },
        action: {
          buttons: [{ type: 'reply', reply: { id: `cod_confirm_${order.id}`, title: 'Confirm COD Order' } }],
        },
      },
    }, `[Sent Cash on Delivery confirmation for Order #${order.order_number} (${total})]`)
    if (sent) return 'cod'
  }

  const sent = await sendAndLog(
    context,
    textMessage(customerPhone, `${intro}\n\nOur team will contact you shortly to confirm payment and delivery.`),
    `[Sent order acknowledgement for Order #${order.order_number} (${total})]`
  )
  return sent ? 'acknowledged' : 'not_sent'
}

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
    console.warn('[Commerce Webhook] Ignoring cart with no items')
    return null
  }

  // A redelivered webhook must not create a second order or message the customer again
  if (messageId) {
    const { data: existing } = await supabase
      .from('commerce_orders')
      .select('*')
      .eq('organization_id', organization.id)
      .eq('meta_order_id', messageId)
      .maybeSingle()
    if (existing) {
      console.log(`[Commerce Webhook] Cart ${messageId} already recorded as Order ${existing.order_number}`)
      return { order: existing, items: [], duplicate: true }
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

  const items: OrderDetailsItem[] = rawItems.map((item) => {
    const retailerId = String(item.product_retailer_id || '')
    const product = productsBySku.get(retailerId)
    const cartPrice = parseFloat(item.item_price) || 0
    return {
      retailer_id: retailerId,
      name: product?.title || `Item #${retailerId}`,
      unit_price: cartPrice > 0 ? cartPrice : Number(product?.price) || 0,
      quantity: Math.max(1, parseInt(item.quantity, 10) || 1),
    }
  })

  // 2. Calculate totals
  const totals = calculateOrderTotals(items, {
    shippingFee: parseFloat(organization.commerce_default_shipping_fee) || 0,
    freeShippingThreshold: parseFloat(organization.commerce_free_shipping_threshold) || 0,
  })
  const currency = String(rawItems[0]?.currency || organization.currency || 'INR').toUpperCase()

  // 3. Create Commerce Order in DB
  const orderNumber = generateOrderNumber()
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
        customer_note: orderPayload.text || null,
        meta_order_id: messageId || null,
      },
    ])
    .select()
    .single()

  if (orderErr) {
    console.error('[Commerce Webhook] Error creating commerce order:', orderErr)
    throw orderErr
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
      total_price: Math.round(item.unit_price * item.quantity * 100) / 100,
      image_url: productsBySku.get(item.retailer_id)?.image_url || null,
    }))
  )
  if (itemsErr) console.error('[Commerce Webhook] Error saving order items:', itemsErr)

  console.log(`[Commerce Webhook] Created Order ${newOrder.order_number} for Contact ${contact.id}`)

  // 5. Tell the customer what happens next
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0)
  const step = await sendNextCheckoutStep(
    { supabase, organization, conversation, customerPhone },
    newOrder,
    items,
    `Thank you! We received your order #${newOrder.order_number} for ${itemCount} item${itemCount === 1 ? '' : 's'} (Total: ${formatMoney(totals.grandTotal, currency)}).`
  )

  return { order: newOrder, items, step }
}

/**
 * Handle address form submission via WhatsApp Flow (`nfm_reply`)
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

  // 1. Locate the order
  let orderQuery = supabase
    .from('commerce_orders')
    .select('*, items:commerce_order_items(*)')
    .eq('organization_id', organization.id)

  if (flowToken && flowToken.startsWith('order_')) {
    const extractedOrderId = flowToken.replace('order_', '').trim()
    orderQuery = orderQuery.eq('id', extractedOrderId)
  } else {
    // Fall back to latest pending order for this contact
    orderQuery = orderQuery
      .eq('contact_id', contact.id)
      .in('status', ['awaiting_address', 'cart_submitted'])
      .order('created_at', { ascending: false })
      .limit(1)
  }

  const { data: order } = await orderQuery.maybeSingle()
  if (!order) {
    console.log('[Commerce Webhook] No matching order found for address submission')
    return null
  }

  // A customer can reopen an old address form. Never pull a paid or fulfilled order
  // back to "payment pending" or send a second payment request for it.
  if (order.payment_status === 'paid' || !OPEN_CHECKOUT_STATUSES.includes(order.status)) {
    console.log(`[Commerce Webhook] Ignoring address submission for Order #${order.order_number} in status ${order.status}`)
    return order
  }

  // 2. Update order with address and advance status
  const shippingAddress = {
    full_name: submissionData.full_name || '',
    phone_number: submissionData.phone_number || customerPhone,
    address_line_1: submissionData.address_line_1 || '',
    address_line_2: submissionData.address_line_2 || '',
    city: submissionData.city || '',
    state: submissionData.state || '',
    pincode: submissionData.pincode || '',
    delivery_speed: submissionData.delivery_speed || 'standard',
    notes: submissionData.instructions || '',
  }

  // Apply the express surcharge relative to what the stored fee already includes, so
  // resubmitting the form (or switching back to standard) does not stack the surcharge.
  const wasExpress = order.shipping_address?.delivery_speed === 'express'
  const isExpress = shippingAddress.delivery_speed === 'express'
  let updatedShippingFee = Number(order.shipping_fee) || 0
  if (isExpress && !wasExpress) updatedShippingFee += EXPRESS_DELIVERY_SURCHARGE
  if (!isExpress && wasExpress) updatedShippingFee = Math.max(0, updatedShippingFee - EXPRESS_DELIVERY_SURCHARGE)
  const updatedTotal =
    Math.round((Number(order.subtotal) + updatedShippingFee + Number(order.tax_amount)) * 100) / 100

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

  console.log(`[Commerce Webhook] Updated Order #${order.order_number} with shipping address`)

  // 3. Ask for payment (or COD confirmation) now that the address is on file
  const updatedOrder = { ...order, shipping_address: shippingAddress, shipping_fee: updatedShippingFee, total_amount: updatedTotal, status: 'payment_pending' }
  const currency = order.currency || organization.currency || 'INR'
  await sendNextCheckoutStep(
    { supabase, organization, conversation, customerPhone },
    updatedOrder,
    (order.items || []).map((item: any) => ({
      retailer_id: item.retailer_id,
      name: item.title,
      unit_price: Number(item.unit_price),
      quantity: item.quantity,
    })),
    `Address saved! Your total with ${shippingAddress.delivery_speed} delivery is ${formatMoney(updatedTotal, currency)}.`
  )

  return updatedOrder
}

/**
 * Handle payment confirmation (`type: "payment"` or `payment_status` interactive update)
 */
export async function handleInboundPaymentConfirmation({
  organization,
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

  // 1. Find the order. It must belong to the organization that received the webhook;
  //    the reference id alone must never reach another tenant's order.
  const { data: order } = await supabase
    .from('commerce_orders')
    .select('*')
    .eq('id', update.referenceId)
    .eq('organization_id', organization.id)
    .maybeSingle()

  if (!order) return null

  // Meta retries webhooks: a repeat for an already-paid order must not add a second
  // transaction row or send the customer another receipt.
  if (order.payment_status === 'paid') {
    console.log(`[Commerce Webhook] Order #${order.order_number} is already paid; ignoring duplicate payment update`)
    return order
  }

  if (update.outcome !== 'paid') {
    console.log(`[Commerce Webhook] Payment for Order #${order.order_number} is ${update.outcome}; order left unpaid`)
    if (update.outcome === 'failed') {
      await supabase
        .from('commerce_orders')
        .update({ payment_status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', order.id)
      return { ...order, payment_status: 'failed' }
    }
    return order
  }

  const currency = update.currency || order.currency || organization.currency || 'INR'
  const transactionId = update.transactionId || `TXN_${Date.now()}`
  const { error: updateErr } = await supabase
    .from('commerce_orders')
    .update({
      // A canceled or already-fulfilled order keeps its status; only the payment is recorded
      ...(OPEN_CHECKOUT_STATUSES.includes(order.status) ? { status: 'paid' } : {}),
      payment_status: 'paid',
      payment_method: 'whatsapp_pay',
      meta_payment_reference: transactionId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id)
  if (updateErr) throw updateErr

  // 2. Record transaction
  await supabase.from('commerce_transactions').insert({
    order_id: order.id,
    organization_id: organization.id,
    gateway: organization.commerce_payment_gateway || 'razorpay',
    transaction_id: transactionId,
    amount: update.amount || order.total_amount,
    currency,
    status: 'captured',
    raw_payload: paymentPayload,
  })

  // 3. Send the customer a receipt, in the conversation the order came from
  const receiptConversationId = conversation?.id || order.conversation_id
  let receiptPhone = customerPhone || ''
  if (!receiptPhone && order.contact_id) {
    const { data: orderContact } = await supabase
      .from('contacts')
      .select('phone_number')
      .eq('id', order.contact_id)
      .eq('organization_id', organization.id)
      .maybeSingle()
    receiptPhone = orderContact?.phone_number || ''
  }

  if (receiptPhone) {
    const receipt = buildOrderStatusMessage({
      phone: receiptPhone,
      referenceId: order.id,
      status: 'processing',
      description: `Payment of ${formatMoney(update.amount || order.total_amount, currency)} received successfully! Order #${order.order_number} is being processed.`,
    })
    if (receiptConversationId) {
      await sendAndLog(
        { supabase, organization, conversation: { id: receiptConversationId }, customerPhone: receiptPhone },
        receipt,
        `[Sent WhatsApp Payment Receipt for Order #${order.order_number}]`
      )
    } else {
      await sendWhatsAppMessage(organization, receipt)
    }
  }

  return { ...order, status: OPEN_CHECKOUT_STATUSES.includes(order.status) ? 'paid' : order.status, payment_status: 'paid' }
}
