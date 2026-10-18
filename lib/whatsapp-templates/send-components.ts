/**
 * The "components" of a template message: the values a send fills into a template's
 * variables, for every template type WhatsApp Manager can create (media, location and
 * product headers, carousels, limited-time offers, coupon codes, catalogue and product
 * buttons, order details, Flows and one-time passwords).
 */

import { buildOrderDetailsMessage } from '@/lib/commerce/commerce-messages'

type Media = { id: string } | { link: string }

export interface SendContext {
  /** The recipient's values: contact fields and campaign columns, by name. */
  vars: Record<string, any>
  /** The campaign's own media, used when a contact has none. */
  mediaUrl?: string | null
  /** The organization's Meta catalogue, for product headers and product lists. */
  catalogId?: string | null
  /** Sent back with a Flow's response, to tell which send it answers. */
  flowToken?: string
  /** For order details buttons: the payment gateway set up in Store settings. */
  paymentGateway?: { type: string; configName: string } | null
  currency?: string
  /** For order details buttons: unique per message. */
  orderReference?: string
  /** A media URL or id as WhatsApp's media parameter (uploading it when needed). */
  resolveMedia?: (value: string) => Promise<Media>
  now?: number
}

const DAY_MS = 86_400_000

function lookup(vars: Record<string, any>, ...keys: string[]): string {
  for (const key of keys) {
    for (const candidate of [key, key.toLowerCase()]) {
      const value = vars[candidate]
      if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim()
    }
  }
  return ''
}

const defaultResolve = async (value: string): Promise<Media> => (/^https?:\/\//.test(value) ? { link: value } : { id: value })

/** The variable keys of a piece of text: {{1}}, {{2}}… in order, or {{named}} as written. */
function textKeys(text: string, namedParams?: Array<{ param_name?: string }>): string[] {
  if (Array.isArray(namedParams) && namedParams.length) return namedParams.map((param) => String(param.param_name || '')).filter(Boolean)
  const keys = [...new Set((String(text || '').match(/\{\{([^}]+)\}\}/g) || []).map((match) => match.replace(/[{}]/g, '').trim()))]
    .filter((key) => /^[a-zA-Z0-9_]+$/.test(key))
  if (keys.every((key) => !isNaN(Number(key)))) keys.sort((a, b) => Number(a) - Number(b))
  return keys
}

function textParameters(keys: string[], value: (key: string, index: number) => string) {
  return keys.map((key, index) => {
    const parameter: Record<string, string> = { type: 'text', text: value(key, index) || '-' }
    if (isNaN(Number(key))) parameter.parameter_name = key
    return parameter
  })
}

const productIds = (vars: Record<string, any>) => lookup(vars, 'product_ids', 'product_retailer_ids', 'products')
  .split(/[,\n;|]/).map((id) => id.trim()).filter(Boolean)

function productParameter(retailerId: string, catalogId: string | null | undefined) {
  if (!retailerId) throw new Error('This template shows a product: add a product_id (or product_ids) column with the product SKU from your catalogue.')
  if (!catalogId) throw new Error('This template shows a product: connect your Meta catalogue in Store settings.')
  return { type: 'product', product: { product_retailer_id: retailerId, catalog_id: catalogId } }
}

async function mediaHeader(format: string, value: string, context: SendContext, vars: Record<string, any>, filenameKey = 'header_document_filename') {
  const resolve = context.resolveMedia || defaultResolve
  const media = await resolve(value)
  const type = format.toLowerCase()
  if (type === 'document') {
    const filename = lookup(vars, filenameKey) || value.split('/').pop()?.split('?')[0] || 'document.pdf'
    return { type: 'document', document: { ...media, filename } }
  }
  return { type, [type]: media }
}

/** A carousel's cards: each card's header, its body variables and its button variables. */
async function carouselCards(component: any, context: SendContext) {
  const { vars } = context
  const products = productIds(vars)
  const cards: any[] = []
  for (const [index, card] of (component.cards || []).entries()) {
    const n = index + 1
    const parts: any[] = []
    for (const part of card.components || []) {
      if (part.type === 'HEADER') {
        if (part.format === 'PRODUCT') {
          parts.push({ type: 'header', parameters: [productParameter(lookup(vars, `card_${n}_product_id`) || products[index] || '', context.catalogId)] })
        } else if (['IMAGE', 'VIDEO'].includes(part.format)) {
          const value = lookup(vars, `card_${n}_media_url`, `card_${n}_header_url`, `card_${n}_image_url`, `card_${n}_video_url`) || part.example?.header_handle?.[0] || ''
          if (value) parts.push({ type: 'header', parameters: [await mediaHeader(part.format, value, context, vars)] })
        }
      } else if (part.type === 'BODY') {
        const examples: string[] = part.example?.body_text?.[0] || []
        const keys = textKeys(part.text, part.example?.body_text_named_params)
        if (keys.length) parts.push({ type: 'body', parameters: textParameters(keys, (key, i) => lookup(vars, `card_${n}_${key}`, `card_${n}_body_${i + 1}`) || examples[i] || '') })
      } else if (part.type === 'BUTTONS') {
        for (const [buttonIndex, button] of (part.buttons || []).entries()) {
          if (button.type === 'URL' && String(button.url || '').includes('{{1}}')) {
            const base = String(button.url).replace('{{1}}', '')
            const example = String(button.example?.[0] || '')
            const value = lookup(vars, `card_${n}_button_url`, `card_${n}_button_url_${buttonIndex + 1}`) || (example.startsWith(base) ? example.slice(base.length) : '')
            parts.push({ type: 'button', sub_type: 'url', index: buttonIndex, parameters: [{ type: 'text', text: value }] })
          } else if (button.type === 'QUICK_REPLY') {
            parts.push({ type: 'button', sub_type: 'quick_reply', index: buttonIndex, parameters: [{ type: 'payload', payload: lookup(vars, `card_${n}_payload`) || `card_${n}` }] })
          }
        }
      }
    }
    cards.push({ card_index: index, components: parts })
  }
  return cards
}

function orderDetailsAction(context: SendContext) {
  const { vars } = context
  if (!context.paymentGateway) throw new Error('Order details templates take payment: set up a payment gateway in Store settings.')
  const amount = Number(lookup(vars, 'order_amount', 'order_total', 'amount'))
  if (!(amount > 0)) throw new Error('Order details templates need an amount: add an order_amount column.')
  const message: any = buildOrderDetailsMessage({
    phone: '0000000',
    referenceId: (lookup(vars, 'order_reference_id', 'order_id', 'reference_id') || context.orderReference || `REF${Date.now()}`).slice(0, 35),
    currency: lookup(vars, 'currency') || context.currency || 'INR',
    items: [{
      retailer_id: lookup(vars, 'order_item_id', 'product_id') || 'item',
      name: lookup(vars, 'order_item_name', 'product_name') || 'Order',
      unit_price: amount,
      quantity: Number(lookup(vars, 'order_quantity', 'quantity')) || 1,
    }],
    shippingFee: Number(lookup(vars, 'shipping_fee')) || 0,
    taxAmount: Number(lookup(vars, 'tax_amount')) || 0,
    paymentGatewayType: context.paymentGateway.type as any,
    paymentGatewayConfigName: context.paymentGateway.configName,
  })
  return { order_details: message.interactive.action.parameters }
}

/** Meta's offer end time, in milliseconds: a date, a timestamp, or a day from now. */
function expirationMs(value: string, now: number): number {
  if (/^\d{12,}$/.test(value)) return Number(value)
  if (/^\d{9,11}$/.test(value)) return Number(value) * 1000
  const parsed = value ? Date.parse(value) : NaN
  return Number.isFinite(parsed) && parsed > now ? parsed : now + DAY_MS
}

/**
 * The components a send of this template needs, given the template as Meta returns it
 * (its `components`) and the recipient's values.
 */
export async function buildSendComponents(templateComponents: any[], context: SendContext): Promise<any[]> {
  const { vars } = context
  const now = context.now ?? Date.now()
  const components: any[] = []
  const isAuthentication = (templateComponents || []).some((component) => component.type === 'BUTTONS' && (component.buttons || []).some((button: any) => button.type === 'OTP'))
  const otpCode = lookup(vars, 'otp_code', 'otp', 'code', '1')

  for (const component of templateComponents || []) {
    if (component.type === 'HEADER') {
      const format = String(component.format || 'TEXT')
      if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(format)) {
        const kind = format.toLowerCase()
        const value = lookup(vars, `header_${kind}_url`, 'header_link', 'header_media_url') || String(context.mediaUrl || '') || component.example?.header_handle?.[0] || ''
        if (value) components.push({ type: 'header', parameters: [await mediaHeader(format, value, context, vars)] })
      } else if (format === 'LOCATION') {
        const latitude = lookup(vars, 'location_latitude', 'latitude')
        const longitude = lookup(vars, 'location_longitude', 'longitude')
        if (!latitude || !longitude) throw new Error('This template has a location header: add location_latitude and location_longitude columns.')
        components.push({ type: 'header', parameters: [{ type: 'location', location: { latitude, longitude, name: lookup(vars, 'location_name'), address: lookup(vars, 'location_address') } }] })
      } else if (format === 'PRODUCT') {
        components.push({ type: 'header', parameters: [productParameter(lookup(vars, 'product_id', 'product_retailer_id') || productIds(vars)[0] || '', context.catalogId)] })
      } else {
        const examples: string[] = component.example?.header_text || []
        const keys = textKeys(component.text, component.example?.header_text_named_params)
        if (keys.length) components.push({ type: 'header', parameters: textParameters(keys, (key, index) => lookup(vars, ...(isNaN(Number(key)) ? [key] : []), `header_text_${index + 1}`, `header_${index + 1}`) || examples[index] || '') })
      }
    } else if (component.type === 'BODY') {
      if (isAuthentication) {
        components.push({ type: 'body', parameters: [{ type: 'text', text: otpCode || '-' }] })
        continue
      }
      const keys = textKeys(component.text, component.example?.body_text_named_params)
      if (keys.length) components.push({ type: 'body', parameters: textParameters(keys, (key, index) => lookup(vars, key, String(index + 1))) })
    } else if (component.type === 'LIMITED_TIME_OFFER') {
      if (component.limited_time_offer?.has_expiration) {
        components.push({ type: 'limited_time_offer', parameters: [{ type: 'limited_time_offer', limited_time_offer: { expiration_time_ms: expirationMs(lookup(vars, 'offer_expires_at', 'offer_expiration', 'expiration_time'), now) } }] })
      }
    } else if (component.type === 'CAROUSEL') {
      components.push({ type: 'carousel', cards: await carouselCards(component, context) })
    } else if (component.type === 'BUTTONS') {
      for (const [index, button] of (component.buttons || []).entries()) {
        const n = index + 1
        if (button.type === 'URL' && String(button.url || '').includes('{{1}}')) {
          components.push({ type: 'button', sub_type: 'url', index: String(index), parameters: [{ type: 'text', text: lookup(vars, `button_url_${n}`, 'button_url_1') }] })
        } else if (button.type === 'COPY_CODE') {
          const code = lookup(vars, `button_copy_code_${n}`, `coupon_code_${n}`, 'button_copy_code', 'coupon_code') || button.example?.[0] || ''
          if (code) components.push({ type: 'button', sub_type: 'copy_code', index: String(index), parameters: [{ type: 'coupon_code', coupon_code: code }] })
        } else if (button.type === 'OTP') {
          if (!otpCode) throw new Error('Authentication templates send a code: add an otp_code column.')
          components.push({ type: 'button', sub_type: 'url', index: String(index), parameters: [{ type: 'text', text: otpCode }] })
        } else if (button.type === 'FLOW') {
          components.push({ type: 'button', sub_type: 'flow', index: String(index), parameters: [{ type: 'action', action: { flow_token: context.flowToken || 'unused' } }] })
        } else if (button.type === 'CATALOG') {
          const thumbnail = lookup(vars, 'thumbnail_product_id') || productIds(vars)[0] || ''
          if (thumbnail) components.push({ type: 'button', sub_type: 'catalog', index: index, parameters: [{ type: 'action', action: { thumbnail_product_retailer_id: thumbnail } }] })
        } else if (button.type === 'MPM') {
          const ids = productIds(vars).slice(0, 30)
          if (!ids.length) throw new Error('Multi-product templates list products: add a product_ids column (SKUs separated by commas).')
          components.push({
            type: 'button', sub_type: 'mpm', index: index, parameters: [{
              type: 'action',
              action: {
                thumbnail_product_retailer_id: lookup(vars, 'thumbnail_product_id') || ids[0],
                sections: [{ title: (lookup(vars, 'section_title') || 'Products').slice(0, 24), product_items: ids.map((id) => ({ product_retailer_id: id })) }],
              },
            }],
          })
        } else if (button.type === 'ORDER_DETAILS') {
          components.push({ type: 'button', sub_type: 'order_details', index: index, parameters: [{ type: 'action', action: orderDetailsAction(context) }] })
        }
      }
    }
  }
  return components
}
