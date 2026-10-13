import { cleanWhatsAppRecipient } from '@/lib/whatsapp-bsuid'

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
  referenceId: string // e.g. ORD_1001
  currency: string // 'INR'
  totalAmount: number // in major units, e.g. 1050.00
  subtotal: number
  shippingFee?: number
  taxAmount?: number
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
      body: { text: bodyText || 'Check out this product:' },
      ...(footerText ? { footer: { text: footerText } } : {}),
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
      body: { text: bodyText || 'Browse our catalog below and add items to your cart:' },
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
      body: { text: bodyText || 'Tap below to explore our entire catalog and place your order:' },
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
    totalAmount,
    subtotal,
    shippingFee = 0,
    taxAmount = 0,
    items,
    paymentGatewayType = 'razorpay',
    paymentGatewayConfigName,
    bodyText,
    footerText,
  } = params

  if (!referenceId) throw new Error('Reference ID is required for order details')
  if (!items || !items.length) throw new Error('Order items are required')

  // Convert amounts to smallest currency unit (e.g., paise for INR, cents for USD)
  const offset = 100
  const totalInCents = Math.round(totalAmount * offset)
  const subtotalInCents = Math.round(subtotal * offset)
  const shippingInCents = Math.round(shippingFee * offset)
  const taxInCents = Math.round(taxAmount * offset)

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
        text: bodyText || 'Your order has been prepared! Review your items and complete payment securely below:',
      },
      footer: {
        text: footerText || 'Secure checkout • Powered by WhatsApp Pay',
      },
      action: {
        name: 'review_and_pay',
        parameters: {
          reference_id: referenceId,
          type: 'physical-goods',
          ...(paymentSettings.length ? { payment_settings: paymentSettings } : {}),
          currency: currency || 'INR',
          total_amount: {
            value: totalInCents,
            offset: offset,
          },
          order: {
            status: 'pending',
            items: items.map((item) => {
              const itemTotalCents = Math.round(item.unit_price * item.quantity * offset)
              return {
                retailer_id: item.retailer_id,
                name: item.name.slice(0, 60),
                amount: {
                  value: itemTotalCents,
                  offset: offset,
                },
                quantity: item.quantity,
                sale_amount: {
                  value: itemTotalCents,
                  offset: offset,
                },
              }
            }),
            subtotal: {
              value: subtotalInCents,
              offset: offset,
            },
            tax: {
              value: taxInCents,
              offset: offset,
            },
            shipping: {
              value: shippingInCents,
              offset: offset,
            },
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
        text: description || 'Your order update is available.',
      },
      action: {
        name: 'review_order',
        parameters: {
          reference_id: referenceId,
          order: {
            status: status,
            description: description,
          },
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
