import { cleanWhatsAppRecipient } from '@/lib/whatsapp-bsuid'
import { MAX_PAYMENT_REFERENCE_LENGTH, toMinorUnits } from './commerce-utils'

// WhatsApp limits. Text longer than these is rejected, so everything is trimmed to fit.
const MAX_BODY = 1024
const MAX_FOOTER = 60
const MAX_BUTTON_TITLE = 20
const MAX_ITEM_NAME = 60
const MAX_STATUS_DESCRIPTION = 120

function clip(text: string, max: number): string {
  const value = String(text ?? '')
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`
}

export interface SingleProductMessageParams {
  phone: string
  catalogId: string
  productRetailerId: string
  bodyText: string
  footerText?: string
}

export interface MultiProductSection {
  title: string
  productRetailerIds: string[]
}

export interface MultiProductMessageParams {
  phone: string
  catalogId: string
  headerText?: string
  bodyText: string
  footerText?: string
  sections: MultiProductSection[]
}

export interface CatalogMessageParams {
  phone: string
  bodyText?: string
  thumbnailProductRetailerId?: string
}

export interface OrderDetailsItem {
  retailer_id: string
  name: string
  unit_price: number
  quantity: number
}

export interface OrderDetailsMessageParams {
  phone: string
  /** Unique per payment request: at most 35 characters of letters, digits, "_", "-" or ".". */
  referenceId: string
  currency: string // 'INR'
  /** Informational: the amount sent to WhatsApp is always worked out from the lines below. */
  totalAmount?: number // in major units, e.g. 1050.00
  subtotal?: number
  shippingFee?: number
  taxAmount?: number
  discountAmount?: number
  items: OrderDetailsItem[]
  paymentGatewayType?: 'razorpay' | 'payu' | 'billdesk' | 'zaakpay'
  paymentGatewayConfigName?: string
  bodyText?: string
  footerText?: string
}

export interface OrderStatusMessageParams {
  phone: string
  referenceId: string
  status: 'processing' | 'shipped' | 'completed' | 'canceled'
  description: string
}

/**
 * 1. Single Product Message (SPM)
 * Displays a specific product from the merchant's catalog.
 */
export function buildSingleProductMessage(params: SingleProductMessageParams) {
  const { phone, catalogId, productRetailerId, bodyText, footerText } = params
  if (!catalogId) throw new Error('Catalog ID is required for Single Product Message')
  if (!productRetailerId) throw new Error('Product retailer ID (SKU) is required for Single Product Message')

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanWhatsAppRecipient(phone),
    type: 'interactive',
    interactive: {
      type: 'product',
      body: { text: clip(bodyText || 'Check out this product:', MAX_BODY) },
      ...(footerText ? { footer: { text: clip(footerText, MAX_FOOTER) } } : {}),
      action: {
        catalog_id: catalogId,
        product_retailer_id: productRetailerId,
      },
    },
  }
}

/**
 * 2. Multi-Product Message (MPM)
 * Displays up to 30 products organized into sections (up to 10 sections) from the catalog.
 */
export function buildMultiProductMessage(params: MultiProductMessageParams) {
  const { phone, catalogId, headerText, bodyText, footerText, sections } = params
  if (!catalogId) throw new Error('Catalog ID is required for Multi-Product Message')
  if (!sections || !sections.length) throw new Error('At least one section is required for Multi-Product Message')

  let totalItems = 0
  const formattedSections = sections.map((sec) => {
    if (!sec.title) throw new Error('Section title is required')
    if (!sec.productRetailerIds || !sec.productRetailerIds.length) {
      throw new Error(`Section "${sec.title}" has no product items`)
    }
    totalItems += sec.productRetailerIds.length
    return {
      title: sec.title.slice(0, 24),
      product_items: sec.productRetailerIds.map((id) => ({ product_retailer_id: id })),
    }
  })

  if (totalItems > 30) throw new Error('WhatsApp Multi-Product Message supports at most 30 items total')

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanWhatsAppRecipient(phone),
    type: 'interactive',
    interactive: {
      type: 'product_list',
      header: { type: 'text', text: (headerText || 'Featured Collection').slice(0, 60) },
      body: { text: clip(bodyText || 'Browse our catalog below and add items to your cart:', MAX_BODY) },
      ...(footerText ? { footer: { text: footerText.slice(0, 60) } } : {}),
      action: {
        catalog_id: catalogId,
        sections: formattedSections,
      },
    },
  }
}

/**
 * 3. Full Catalog Message
 * Directs the customer to open the entire merchant catalog within WhatsApp.
 */
export function buildCatalogMessage(params: CatalogMessageParams) {
  const { phone, bodyText, thumbnailProductRetailerId } = params

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanWhatsAppRecipient(phone),
    type: 'interactive',
    interactive: {
      type: 'catalog_message',
      body: { text: clip(bodyText || 'Tap below to explore our entire catalog and place your order:', MAX_BODY) },
      action: {
        name: 'catalog_message',
        ...(thumbnailProductRetailerId
          ? { parameters: { thumbnail_product_retailer_id: thumbnailProductRetailerId } }
          : {}),
      },
    },
  }
}

/**
 * 4. Interactive Order Details Message (`order_details` / `review_and_pay`)
 * Meta's native in-chat payment checkout envelope for WhatsApp Pay / Razorpay / PayU.
 */
export function buildOrderDetailsMessage(params: OrderDetailsMessageParams) {
  const {
    phone,
    referenceId,
    currency,
    shippingFee = 0,
    taxAmount = 0,
    discountAmount = 0,
    items,
    paymentGatewayType = 'razorpay',
    paymentGatewayConfigName,
    bodyText,
    footerText,
  } = params

  if (!referenceId) throw new Error('Reference ID is required for order details')
  if (referenceId.length > MAX_PAYMENT_REFERENCE_LENGTH || !/^[A-Za-z0-9_.-]+$/.test(referenceId)) {
    throw new Error(`Payment reference "${referenceId}" is not valid: use at most ${MAX_PAYMENT_REFERENCE_LENGTH} letters, digits, "_", "-" or "."`)
  }
  if (!items || !items.length) throw new Error('Order items are required')

  // WhatsApp checks the arithmetic itself and rejects the message when it does not add up:
  //   subtotal = sum of (price of one unit x quantity)
  //   total    = subtotal + tax + shipping - discount
  // So every amount is derived here, in whole minor units, from the unit prices.
  const offset = 100
  const lines = items.map((item) => ({
    retailer_id: String(item.retailer_id || 'item'),
    name: clip(item.name || 'Item', MAX_ITEM_NAME),
    unit: toMinorUnits(item.unit_price),
    quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
  }))
  const subtotalMinor = lines.reduce((sum, line) => sum + line.unit * line.quantity, 0)
  const shippingMinor = Math.max(0, toMinorUnits(shippingFee))
  const taxMinor = Math.max(0, toMinorUnits(taxAmount))
  const discountMinor = Math.min(Math.max(0, toMinorUnits(discountAmount)), subtotalMinor)
  const totalMinor = subtotalMinor + taxMinor + shippingMinor - discountMinor
  if (totalMinor <= 0) throw new Error('A payment request needs a total above zero')

  const paymentSettings: any[] = []
  if (paymentGatewayConfigName) {
    paymentSettings.push({
      type: 'payment_gateway',
      payment_gateway: {
        type: paymentGatewayType,
        configuration_name: paymentGatewayConfigName,
      },
    })
  }

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanWhatsAppRecipient(phone),
    type: 'interactive',
    interactive: {
      type: 'order_details',
      body: {
        text: clip(bodyText || 'Your order is ready. Review it and pay securely below:', MAX_BODY),
      },
      footer: {
        text: clip(footerText || 'Secure payment inside WhatsApp', MAX_FOOTER),
      },
      action: {
        name: 'review_and_pay',
        parameters: {
          reference_id: referenceId,
          type: 'physical-goods',
          ...(paymentSettings.length ? { payment_settings: paymentSettings } : {}),
          currency: currency || 'INR',
          total_amount: { value: totalMinor, offset },
          order: {
            status: 'pending',
            items: lines.map((line) => ({
              retailer_id: line.retailer_id,
              name: line.name,
              // The price of ONE unit; WhatsApp multiplies it by the quantity
              amount: { value: line.unit, offset },
              quantity: line.quantity,
            })),
            subtotal: { value: subtotalMinor, offset },
            tax: { value: taxMinor, offset },
            ...(shippingMinor > 0 ? { shipping: { value: shippingMinor, offset } } : {}),
            ...(discountMinor > 0 ? { discount: { value: discountMinor, offset } } : {}),
          },
        },
      },
    },
  }
}

/**
 * 5. Interactive Order Status Message (`order_status` / `review_order`)
 * Meta's native receipt and fulfillment status update.
 */
export function buildOrderStatusMessage(params: OrderStatusMessageParams) {
  const { phone, referenceId, status, description } = params
  if (!referenceId) throw new Error('Reference ID is required')

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanWhatsAppRecipient(phone),
    type: 'interactive',
    interactive: {
      type: 'order_status',
      body: {
        text: clip(description || 'Your order update is available.', MAX_BODY),
      },
      action: {
        name: 'review_order',
        parameters: {
          // Must be the reference of the payment request this order was sent with
          reference_id: referenceId,
          order: {
            status: status,
            ...(description ? { description: clip(description, MAX_STATUS_DESCRIPTION) } : {}),
          },
        },
      },
    },
  }
}

/** A plain text message. */
export function buildTextMessage(phone: string, body: string) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanWhatsAppRecipient(phone),
    type: 'text',
    text: { body: clip(body, 4096) },
  }
}

/** Up to three quick-reply buttons under a short text. */
export function buildButtonsMessage(phone: string, bodyText: string, buttons: Array<{ id: string; title: string }>) {
  if (!buttons.length || buttons.length > 3) throw new Error('A button message needs one to three buttons')
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanWhatsAppRecipient(phone),
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: clip(bodyText, MAX_BODY) },
      action: {
        buttons: buttons.map((button) => ({ type: 'reply', reply: { id: button.id, title: clip(button.title, MAX_BUTTON_TITLE) } })),
      },
    },
  }
}

/** Opens the delivery address form (a published WhatsApp Flow) for one order. */
export function buildAddressFlowMessage(params: { phone: string; flowId: string; orderId: string; bodyText: string }) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanWhatsAppRecipient(params.phone),
    type: 'interactive',
    interactive: {
      type: 'flow',
      body: { text: clip(params.bodyText, MAX_BODY) },
      action: {
        name: 'flow',
        parameters: {
          flow_message_version: '3',
          mode: 'published',
          flow_id: params.flowId,
          // Comes back with the submitted form, so the address lands on the right order
          flow_token: `order_${params.orderId}`,
          flow_cta: 'Add delivery address',
          flow_action: 'navigate',
          flow_action_payload: { screen: 'SHIPPING_DETAILS' },
        },
      },
    },
  }
}

/**
 * 6. Website Redirection Link Generator (Type 1)
 * Builds tracked UTM checkout links with conversation attribution.
 */
export function buildWebsiteRedirectUrl(params: {
  baseUrl: string
  productRetailerId?: string
  contactId?: string
  campaignId?: string
  couponCode?: string
}) {
  const { baseUrl, productRetailerId, contactId, campaignId, couponCode } = params
  try {
    const url = new URL(baseUrl)
    url.searchParams.set('utm_source', 'whatsapp')
    url.searchParams.set('utm_medium', 'chat')
    if (campaignId) url.searchParams.set('utm_campaign', campaignId)
    if (contactId) url.searchParams.set('ref_contact', contactId)
    if (productRetailerId) url.searchParams.set('sku', productRetailerId)
    if (couponCode) url.searchParams.set('discount', couponCode)
    return url.toString()
  } catch {
    return baseUrl
  }
}
