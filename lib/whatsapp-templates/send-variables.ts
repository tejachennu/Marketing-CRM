/**
 * The extra values a campaign needs for a template beyond its {{variables}}: products,
 * locations, offer end times, carousel cards, order amounts and codes. Their keys match
 * what lib/whatsapp-templates/send-components.ts reads when sending.
 */

export interface SendVariables {
  variables: string[]
  sampleValues: Record<string, string>
}

const LABELS: Array<[RegExp, string | ((match: RegExpMatchArray) => string)]> = [
  [/^header_image/, 'Header Image'],
  [/^header_video/, 'Header Video'],
  [/^header_document_filename/, 'Document Name'],
  [/^header_document/, 'Header Document'],
  [/^header_text/, 'Header Text'],
  [/^button_url/, 'Dynamic Button URL'],
  [/^button_copy_code/, 'Coupon Code'],
  [/^location_latitude$/, 'Location Latitude'],
  [/^location_longitude$/, 'Location Longitude'],
  [/^location_name$/, 'Location Name'],
  [/^location_address$/, 'Location Address'],
  [/^product_id$/, 'Product SKU'],
  [/^product_ids$/, 'Product SKUs (comma separated)'],
  [/^thumbnail_product_id$/, 'Thumbnail Product SKU'],
  [/^section_title$/, 'Product Section Title'],
  [/^offer_expires_at$/, 'Offer Ends At (date and time)'],
  [/^otp_code$/, 'One-time Code'],
  [/^order_amount$/, 'Order Amount'],
  [/^order_item_name$/, 'Order Item Name'],
  [/^order_reference_id$/, 'Order Reference'],
  [/^card_(\d+)_media_url$/, (match) => `Card ${match[1]} Image/Video`],
  [/^card_(\d+)_button_url$/, (match) => `Card ${match[1]} Button URL`],
  [/^card_(\d+)_(.+)$/, (match) => `Card ${match[1]} Variable ${match[2]}`],
]

/** A campaign variable's name for people. */
export function sendVariableLabel(key: string): string {
  for (const [pattern, label] of LABELS) {
    const match = key.match(pattern)
    if (match) return typeof label === 'string' ? label : label(match)
  }
  return `Variable ${key}`
}

function add(result: SendVariables, key: string, sample = '') {
  if (!result.variables.includes(key)) result.variables.push(key)
  if (sample && !result.sampleValues[key]) result.sampleValues[key] = sample
}

/** Values beyond the header text, body and URL/coupon variables that a send of this template takes. */
export function extraSendVariables(components: any[]): SendVariables {
  const result: SendVariables = { variables: [], sampleValues: {} }
  for (const component of components || []) {
    const type = String(component.type || '').toUpperCase()
    if (type === 'HEADER' && component.format === 'LOCATION') {
      add(result, 'location_latitude', '17.385044')
      add(result, 'location_longitude', '78.486671')
      add(result, 'location_name', 'Our store')
      add(result, 'location_address', 'Hyderabad, Telangana')
    } else if (type === 'HEADER' && component.format === 'PRODUCT') {
      add(result, 'product_id')
    } else if (type === 'LIMITED_TIME_OFFER' && component.limited_time_offer?.has_expiration) {
      add(result, 'offer_expires_at', new Date(Date.now() + 86_400_000).toISOString().slice(0, 16))
    } else if (type === 'CAROUSEL') {
      for (const [index, card] of (component.cards || []).entries()) {
        const n = index + 1
        for (const part of card.components || []) {
          if (part.type === 'HEADER' && part.format === 'PRODUCT') add(result, 'product_ids')
          else if (part.type === 'HEADER') add(result, `card_${n}_media_url`, part.example?.header_handle?.[0] || '')
          else if (part.type === 'BODY') {
            const examples: string[] = part.example?.body_text?.[0] || []
            const keys = [...new Set((String(part.text || '').match(/\{\{([^}]+)\}\}/g) || []).map((match) => match.replace(/[{}]/g, '').trim()))]
            keys.forEach((key, i) => add(result, `card_${n}_${key}`, examples[i] || ''))
          } else if (part.type === 'BUTTONS') {
            for (const button of part.buttons || []) if (button.type === 'URL' && String(button.url || '').includes('{{1}}')) add(result, `card_${n}_button_url`)
          }
        }
      }
    } else if (type === 'BUTTONS') {
      for (const button of component.buttons || []) {
        if (button.type === 'OTP') add(result, 'otp_code', '123456')
        else if (button.type === 'MPM') { add(result, 'product_ids'); add(result, 'section_title', 'Products') }
        else if (button.type === 'CATALOG') add(result, 'thumbnail_product_id')
        else if (button.type === 'ORDER_DETAILS') { add(result, 'order_amount', '499'); add(result, 'order_item_name', 'Order'); add(result, 'order_reference_id') }
      }
    }
  }
  return result
}
