import { createClient } from '@supabase/supabase-js'
import {
  buildOrderDetailsMessage,
  buildOrderStatusMessage,
  OrderDetailsItem,
} from './commerce-messages'
import { calculateOrderTotals } from './meta-commerce'

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

// Payment updates that must not mark an order as paid
const UNSUCCESSFUL_PAYMENT_STATUSES = new Set([
  'pending', 'failed', 'failure', 'canceled', 'cancelled', 'declined', 'expired', 'error', 'rejected',
])

// An address may only be (re)submitted before the order has been paid or fulfilled
const ADDRESS_EDITABLE_STATUSES = new Set(['cart_submitted', 'awaiting_address', 'payment_pending'])

const EXPRESS_DELIVERY_SURCHARGE = 50 // e.g. ₹50 express surcharge

/**
 * Send a message through the WhatsApp Cloud API.
 * Returns false (and logs why) when Meta rejects it, so callers do not record a
 * "[Sent ...]" line in the conversation for a message the customer never received.
 */
async function sendWhatsAppMessage(organization: any, payload: unknown): Promise<boolean> {
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

/**
 * Handle incoming native cart order (`type: "order"`) from WhatsApp
 */
export async function handleInboundCommerceOrder({
  organization,
  contact,
  conversation,
  orderPayload,
  customerPhone,
}: {
  organization: any
  contact: any
  conversation: any
  orderPayload: any
  customerPhone: string
}) {
  const supabase = getSupabase()
  const rawItems = orderPayload.product_items || []
  const catalogId = orderPayload.catalog_id
  const customerNote = orderPayload.text || null

  const orderNumber = generateOrderNumber()

  // 1. Resolve product titles and details from database if available
  const items: OrderDetailsItem[] = []
  for (const item of rawItems) {
    const retailerId = item.product_retailer_id
    const qty = parseInt(item.quantity, 10) || 1
    const price = parseFloat(item.item_price) || 0

    // Try to get product info from DB
    const { data: dbProduct } = await supabase
      .from('commerce_products')
      .select('title, price, image_url')
      .eq('organization_id', organization.id)
      .eq('retailer_id', retailerId)
      .maybeSingle()

    const title = dbProduct?.title || `Item #${retailerId}`
    const unitPrice = price > 0 ? price : dbProduct?.price || 0

    items.push({
      retailer_id: retailerId,
      name: title,
      unit_price: unitPrice,
      quantity: qty,
    })
  }

  // 2. Calculate totals
  const totals = calculateOrderTotals(items, {
    shippingFee: parseFloat(organization.commerce_default_shipping_fee) || 0,
    freeShippingThreshold: parseFloat(organization.free_shipping_threshold) || 0,
  })

  // 3. Create Commerce Order in DB
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
        catalog_id: catalogId,
        subtotal: totals.subtotal,
        shipping_fee: totals.shippingFee,
        tax_amount: totals.taxAmount,
        total_amount: totals.grandTotal,
        currency: organization.currency || 'INR',
        payment_status: 'pending',
        customer_note: customerNote,
      },
    ])
    .select()
    .single()

  if (orderErr) {
    console.error('[Commerce Webhook] Error creating commerce order:', orderErr)
    throw orderErr
  }

  // 4. Create Order Items
  if (items.length) {
    const itemRows = items.map((it) => ({
      order_id: newOrder.id,
      retailer_id: it.retailer_id,
      title: it.name,
      quantity: it.quantity,
      unit_price: it.unit_price,
      total_price: Math.round(it.unit_price * it.quantity * 100) / 100,
    }))
    await supabase.from('commerce_order_items').insert(itemRows)
  }

  console.log(`[Commerce Webhook] Created Order ${newOrder.order_number} for Contact ${contact.id}`)

  // 5. Send automated reply to customer
  if (!organization.whatsapp_api_token || !organization.whatsapp_phone_number_id) {
    console.warn('[Commerce Webhook] Missing WhatsApp credentials; cannot send automated response')
    return { order: newOrder, items }
  }

  // If organization has configured an address collection Flow:
  if (organization.commerce_address_flow_id) {
    const addressFlowMsg = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: customerPhone.replace('+', '').trim(),
      type: 'interactive',
      interactive: {
        type: 'flow',
        body: {
          text: `Thank you for choosing us! We received your order for ${items.length} item(s) (Total: ${organization.currency || 'INR'} ${totals.grandTotal}).\n\nPlease enter your delivery address below:`,
        },
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            mode: 'published',
            flow_id: organization.commerce_address_flow_id,
            flow_token: `order_${newOrder.id}`,
            flow_cta: 'Add Delivery Address',
            flow_action_payload: {
              screen: 'SHIPPING_DETAILS',
              data: {
                full_name: [contact.first_name, contact.last_name].filter(Boolean).join(' ') || '',
                phone_number: customerPhone,
              },
            },
          },
        },
      },
    }

    if (await sendWhatsAppMessage(organization, addressFlowMsg)) {
      await supabase.from('messages').insert({
        organization_id: organization.id,
        conversation_id: conversation.id,
        sender_type: 'user',
        body: `[Sent Address Flow for Order #${orderNumber}]`,
      })
    }
  } else if (organization.commerce_gateway_config_name) {
    // If no address flow is needed, send native order_details (Review & Pay) right away!
    const orderDetailsMsg = buildOrderDetailsMessage({
      phone: customerPhone,
      referenceId: newOrder.id,
      currency: organization.currency || 'INR',
      totalAmount: totals.grandTotal,
      subtotal: totals.subtotal,
      shippingFee: totals.shippingFee,
      taxAmount: totals.taxAmount,
      items,
      paymentGatewayType: organization.commerce_payment_gateway || 'razorpay',
      paymentGatewayConfigName: organization.commerce_gateway_config_name,
    })

    if (await sendWhatsAppMessage(organization, orderDetailsMsg)) {
      await supabase.from('messages').insert({
        organization_id: organization.id,
        conversation_id: conversation.id,
        sender_type: 'user',
        body: `[Sent WhatsApp Payment Request for Order #${orderNumber} (${organization.currency || 'INR'} ${totals.grandTotal})]`,
      })
    }
  }

  return { order: newOrder, items }
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
}: {
  organization: any
  contact: any
  conversation: any
  submissionData: Record<string, any>
  flowToken?: string
  customerPhone: string
}) {
  const supabase = getSupabase()

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
  if (order.payment_status === 'paid' || !ADDRESS_EDITABLE_STATUSES.has(order.status)) {
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

  await supabase
    .from('commerce_orders')
    .update({
      shipping_address: shippingAddress,
      shipping_fee: updatedShippingFee,
      total_amount: updatedTotal,
      status: 'payment_pending',
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id)

  console.log(`[Commerce Webhook] Updated Order #${order.order_number} with shipping address`)

  // 3. Send WhatsApp Native In-Chat Payment (`order_details` / `review_and_pay`)
  if (organization.whatsapp_api_token && organization.whatsapp_phone_number_id) {
    if (organization.commerce_gateway_config_name) {
      const orderDetailsMsg = buildOrderDetailsMessage({
        phone: customerPhone,
        referenceId: order.id,
        currency: order.currency || 'INR',
        totalAmount: updatedTotal,
        subtotal: Number(order.subtotal),
        shippingFee: updatedShippingFee,
        taxAmount: Number(order.tax_amount),
        items: (order.items || []).map((i: any) => ({
          retailer_id: i.retailer_id,
          name: i.title,
          unit_price: Number(i.unit_price),
          quantity: i.quantity,
        })),
        paymentGatewayType: organization.commerce_payment_gateway || 'razorpay',
        paymentGatewayConfigName: organization.commerce_gateway_config_name,
        bodyText: `Address saved! Your total with ${shippingAddress.delivery_speed} shipping is ${order.currency || 'INR'} ${updatedTotal}. Please complete your payment below:`,
      })

      if (await sendWhatsAppMessage(organization, orderDetailsMsg)) {
        await supabase.from('messages').insert({
          organization_id: organization.id,
          conversation_id: conversation.id,
          sender_type: 'user',
          body: `[Sent WhatsApp In-Chat Payment Request for Order #${order.order_number}]`,
        })
      }
    } else if (organization.commerce_enable_cod) {
      // Send interactive COD confirmation button
      const codMsg = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: customerPhone.replace('+', '').trim(),
        type: 'interactive',
        interactive: {
          type: 'button',
          body: {
            text: `Address saved! Your order total is ${order.currency || 'INR'} ${updatedTotal}.\n\nWould you like to confirm this order as Cash on Delivery?`,
          },
          action: {
            buttons: [
              {
                type: 'reply',
                reply: {
                  id: `cod_confirm_${order.id}`,
                  title: 'Confirm COD Order',
                },
              },
            ],
          },
        },
      }

      await sendWhatsAppMessage(organization, codMsg)
    }
  }

  return order
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
}: {
  organization: any
  contact: any
  conversation: any
  paymentPayload: any
  customerPhone: string
}) {
  const supabase = getSupabase()
  const referenceId = paymentPayload.reference_id
  const transactionId = paymentPayload.transaction_id || paymentPayload.id || `TXN_${Date.now()}`
  const amount = paymentPayload.amount?.value ? paymentPayload.amount.value / (paymentPayload.amount.offset || 100) : 0
  const currency = paymentPayload.currency || organization.currency || 'INR'

  if (!referenceId) return null

  // 1. Find the order. It must belong to the organization that received the webhook;
  //    the reference id alone must never reach another tenant's order.
  const { data: order } = await supabase
    .from('commerce_orders')
    .select('*')
    .eq('id', referenceId)
    .eq('organization_id', organization.id)
    .maybeSingle()

  if (!order) return null

  // Meta retries webhooks: a repeat for an already-paid order must not add a second
  // transaction row or send the customer another receipt.
  if (order.payment_status === 'paid') {
    console.log(`[Commerce Webhook] Order #${order.order_number} is already paid; ignoring duplicate payment update`)
    return order
  }

  // Only a successful payment marks the order as paid
  const paymentStatus = String(paymentPayload.status || '').toLowerCase()
  if (UNSUCCESSFUL_PAYMENT_STATUSES.has(paymentStatus)) {
    console.log(`[Commerce Webhook] Payment for Order #${order.order_number} reported "${paymentStatus}"; order left unpaid`)
    if (paymentStatus !== 'pending') {
      await supabase
        .from('commerce_orders')
        .update({ payment_status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', order.id)
    }
    return order
  }

  await supabase
    .from('commerce_orders')
    .update({
      status: 'paid',
      payment_status: 'paid',
      payment_method: 'whatsapp_pay',
      meta_payment_reference: transactionId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id)

  // 2. Record transaction
  await supabase.from('commerce_transactions').insert({
    order_id: order.id,
    organization_id: organization.id,
    gateway: organization.commerce_payment_gateway || 'razorpay',
    transaction_id: transactionId,
    amount: amount || order.total_amount,
    currency,
    status: 'captured',
    raw_payload: paymentPayload,
  })

  // 3. Send Order Status Receipt message
  if (organization.whatsapp_api_token && organization.whatsapp_phone_number_id) {
    const statusMsg = buildOrderStatusMessage({
      phone: customerPhone,
      referenceId: order.id,
      status: 'processing',
      description: `Payment of ${currency} ${amount || order.total_amount} received successfully! Order #${order.order_number} is being processed.`,
    })

    if (await sendWhatsAppMessage(organization, statusMsg)) {
      await supabase.from('messages').insert({
        organization_id: organization.id,
        conversation_id: conversation.id,
        sender_type: 'user',
        body: `[Sent WhatsApp Payment Receipt for Order #${order.order_number}]`,
      })
    }
  }

  return order
}
