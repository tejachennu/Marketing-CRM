/**
 * Is the store ready to take orders on WhatsApp? Each check reads the store's settings and what
 * Meta reports for its WhatsApp account. Pure and client-safe: the Order flow tab and tests use it.
 */

import { SUPPORTED_PAYMENT_GATEWAYS, formatMoney, getCommerceSetup, getExpressFee, getPaymentGateway } from './commerce-utils'

export type CheckState = 'ok' | 'warning' | 'error' | 'skipped' | 'unknown'

export type CheckFix = 'settings' | 'store_settings' | 'enable_cart' | 'whatsapp_manager' | 'republish_address_form'

export interface GoLiveCheck {
  id: 'whatsapp' | 'store' | 'currency' | 'catalog' | 'cart' | 'address' | 'express_fee' | 'payment'
  title: string
  state: CheckState
  detail: string
  /** Blocks orders when not ok. Optional checks only warn. */
  required: boolean
  fix?: CheckFix
}

/** The store's address form as Meta stores it, read back by GET /api/commerce/meta-detect. */
export interface AddressFormReport {
  id: string
  /** What the form's express delivery choice says; null when the form offers no such choice. */
  expressLabel: string | null
  /** Why the form could not be read, in which case `expressLabel` means nothing. */
  error: string | null
}

/** What GET /api/commerce/meta-detect returns; null until it has been loaded. */
export interface MetaDetection {
  connectionError?: string | null
  catalogs?: Array<{ id: string; name?: string; product_count?: number }>
  catalogsError?: string | null
  paymentConfigs?: Array<{ configuration_name: string; provider_name?: string; status?: string }>
  paymentConfigsError?: string | null
  flows?: Array<{ id: string; name?: string; status?: string }>
  flowsError?: string | null
  commerceSettings?: { is_cart_enabled?: boolean; is_catalog_visible?: boolean } | null
  commerceSettingsError?: string | null
  /** The address form the store sends, when one is set. */
  addressForm?: AddressFormReport | null
  /**
   * The linked catalog as GET /api/commerce/catalog reports it (what Store settings shows). Preferred
   * over `catalogs`: Meta's list of the account's catalogs can be empty while one is connected.
   */
  catalogStatus?: {
    linked: { name?: string; product_count?: number } | null
    linkedError?: string | null
    /** null when Meta would not say which catalog is connected */
    connected: boolean | null
  } | null
}

// ── The standard address form ───────────────────────────────────────────────
// Meta never changes a published form, so the express charge written into it goes stale when the
// store changes the fee. A new version then needs a new name: Meta refuses one already used on
// the account.

export const STANDARD_ADDRESS_FORM_NAME = 'WhatsApp Store Delivery Address'
const STANDARD_ADDRESS_FORM = /^WhatsApp Store Delivery Address(?: v(\d+))?$/

export function isStandardAddressForm(name: unknown): boolean {
  return STANDARD_ADDRESS_FORM.test(String(name ?? '').trim())
}

/** The name for the next version of the standard form: the base name, then " v2", " v3", ... */
export function nextAddressFormName(existingNames: Iterable<unknown>): string {
  let highest = 0
  for (const name of existingNames) {
    const match = String(name ?? '').trim().match(STANDARD_ADDRESS_FORM)
    if (match) highest = Math.max(highest, match[1] ? Number(match[1]) : 1)
  }
  return highest === 0 ? STANDARD_ADDRESS_FORM_NAME : `${STANDARD_ADDRESS_FORM_NAME} v${highest + 1}`
}

/** Meta allows 30 characters for a choice's title. */
const MAX_OPTION_TITLE = 30

/** What the express choice says on the standard form. The amount is never the part cut off. */
export function expressOptionTitle(fee: number, currency: string | null | undefined): string {
  if (!(fee > 0)) return 'Express delivery'
  const amount = formatMoney(fee, currency)
  const titles = [`Express delivery (+${amount})`, `Express (+${amount})`, `Express +${amount}`]
  return titles.find((title) => title.length <= MAX_OPTION_TITLE) || titles[2].slice(0, MAX_OPTION_TITLE)
}

/**
 * The express delivery choice's title in a form, compiled for Meta (`data-source`) or as a
 * template (`options`); null when the form offers no such choice.
 */
export function getExpressOptionTitle(flowJson: any): string | null {
  const screens = Array.isArray(flowJson?.screens) ? flowJson.screens : []
  const pending: any[] = screens.map((screen: any) => screen?.layout)
  while (pending.length) {
    const node = pending.pop()
    if (!node || typeof node !== 'object') continue
    if (node.name === 'delivery_speed') {
      const options = Array.isArray(node['data-source']) ? node['data-source'] : Array.isArray(node.options) ? node.options : []
      const express = options.find((option: any) => option?.id === 'express')
      return express ? String(express.title ?? '') : null
    }
    if (Array.isArray(node.children)) pending.push(...node.children)
  }
  return null
}

/** "₹50" from "Express delivery (+₹50)"; null when the title shows no amount. */
export function getFeeShownInLabel(title: string | null | undefined): string | null {
  const match = String(title ?? '').match(/\+\s*([^()]+?)\s*\)?\s*$/)
  return match ? match[1].trim() : null
}

const GATEWAY_LABELS: Record<string, string> = { razorpay: 'Razorpay', payu: 'PayU', billdesk: 'BillDesk', zaakpay: 'Zaakpay' }

export function getGoLiveChecks(organization: Record<string, any> | null | undefined, meta: MetaDetection | null): GoLiveCheck[] {
  const setup = getCommerceSetup(organization)
  const known = meta !== null
  const currency = String(organization?.currency || '').trim().toUpperCase()
  const checks: GoLiveCheck[] = []

  // 1. WhatsApp connection
  if (!setup.whatsappConnected) {
    checks.push({ id: 'whatsapp', title: 'WhatsApp connected', state: 'error', required: true, fix: 'settings', detail: 'Connect your WhatsApp Business number in Settings. Carts arrive and replies go out through it.' })
  } else if (meta?.connectionError) {
    checks.push({ id: 'whatsapp', title: 'WhatsApp connected', state: 'error', required: true, fix: 'settings', detail: meta.connectionError })
  } else {
    checks.push({ id: 'whatsapp', title: 'WhatsApp connected', state: known ? 'ok' : 'unknown', required: true, detail: known ? 'Meta answered for your WhatsApp account.' : 'Checking with Meta…' })
  }

  // 2. Store switch
  checks.push(organization?.enable_commerce === false
    ? { id: 'store', title: 'Store switched on', state: 'error', required: true, fix: 'store_settings', detail: 'The store is off, so carts customers send are not turned into orders and nobody replies.' }
    : { id: 'store', title: 'Store switched on', state: 'ok', required: true, detail: 'Carts customers send become orders.' })

  // 3. Currency: every total and payment request is in it, so it is not guessed
  checks.push(/^[A-Z]{3}$/.test(currency)
    ? { id: 'currency', title: 'Currency set', state: 'ok', required: true, detail: `Order totals, shipping fees and payment requests are in ${currency}.` }
    : { id: 'currency', title: 'Currency set', state: 'error', required: true, fix: 'settings', detail: 'Choose the workspace currency in Settings → General. Order totals, shipping fees and payment requests use it.' })

  // 4. Catalog
  const catalogId = String(organization?.meta_catalog_id || '').trim()
  const status = meta?.catalogStatus
  const listed = meta?.catalogs?.find((item) => String(item.id) === catalogId)
  const catalog = status?.linked || listed
  // The cart and catalog buttons can only be on when a catalog is connected to the number
  const cartShowsCatalog = meta?.commerceSettings?.is_catalog_visible === true
  if (!catalogId) {
    checks.push({ id: 'catalog', title: 'Catalog linked', state: 'error', required: true, fix: 'store_settings', detail: 'Link the Meta catalog customers shop from.' })
  } else if (!known) {
    checks.push({ id: 'catalog', title: 'Catalog linked', state: 'unknown', required: true, detail: 'Checking with Meta…' })
  } else if (status) {
    const name = status.linked?.name || catalogId
    const count = typeof status.linked?.product_count === 'number' ? status.linked.product_count : null
    if (!status.linked) {
      checks.push({ id: 'catalog', title: 'Catalog linked', state: status.linkedError ? 'error' : 'warning', required: true, fix: 'store_settings', detail: status.linkedError ? `Meta could not read the linked catalog: ${status.linkedError}` : 'Meta did not return the linked catalog.' })
    } else if (status.connected === false) {
      checks.push({ id: 'catalog', title: 'Catalog linked', state: 'error', required: true, fix: 'store_settings', detail: `“${name}” is not the catalog connected to your WhatsApp account. Connect it in Store settings.` })
    } else if (count === 0) {
      checks.push({ id: 'catalog', title: 'Catalog linked', state: 'error', required: true, fix: 'store_settings', detail: `“${name}” has no products yet. Add products in the Products tab.` })
    } else {
      checks.push({ id: 'catalog', title: 'Catalog linked', state: 'ok', required: true, detail: `${name}${count !== null ? ` · ${count} product${count === 1 ? '' : 's'}` : ''}` })
    }
  } else if (meta?.catalogsError && !cartShowsCatalog) {
    checks.push({ id: 'catalog', title: 'Catalog linked', state: 'warning', required: true, fix: 'store_settings', detail: `Meta did not list your catalogs: ${meta.catalogsError}` })
  } else if (!listed && !meta?.catalogs?.length) {
    // Meta listed no catalog at all, which happens even when one is connected: nothing says it is wrong
    checks.push({ id: 'catalog', title: 'Catalog linked', state: cartShowsCatalog ? 'ok' : 'warning', required: true, fix: cartShowsCatalog ? undefined : 'store_settings', detail: cartShowsCatalog ? 'Linked, and the catalog shows on your WhatsApp number.' : 'Meta did not list the catalog connected to your WhatsApp account, so this could not be confirmed. Check it in Store settings.' })
  } else if (!catalog) {
    checks.push({ id: 'catalog', title: 'Catalog linked', state: 'error', required: true, fix: 'store_settings', detail: 'The linked catalog is not connected to this WhatsApp account. Connect it in Commerce Manager, or pick another in Store settings.' })
  } else if (catalog.product_count === 0) {
    checks.push({ id: 'catalog', title: 'Catalog linked', state: 'error', required: true, fix: 'store_settings', detail: `“${catalog.name || catalogId}” has no products yet. Add products in the Products tab.` })
  } else {
    const count = typeof catalog.product_count === 'number' ? ` · ${catalog.product_count} product${catalog.product_count === 1 ? '' : 's'}` : ''
    checks.push({ id: 'catalog', title: 'Catalog linked', state: 'ok', required: true, detail: `${catalog.name || catalogId}${count}` })
  }

  // 5. Cart and catalog on for the number
  const settings = meta?.commerceSettings
  if (!known) {
    checks.push({ id: 'cart', title: 'Cart turned on for your number', state: 'unknown', required: true, detail: 'Checking with Meta…' })
  } else if (meta?.commerceSettingsError && !settings) {
    checks.push({ id: 'cart', title: 'Cart turned on for your number', state: 'warning', required: true, fix: 'enable_cart', detail: `Meta did not report the cart setting: ${meta.commerceSettingsError}` })
  } else if (settings?.is_cart_enabled === true && settings?.is_catalog_visible === true) {
    checks.push({ id: 'cart', title: 'Cart turned on for your number', state: 'ok', required: true, detail: 'Customers see the catalog in your chat and can send a cart.' })
  } else {
    const missing = [settings?.is_catalog_visible !== true && 'the catalog is hidden', settings?.is_cart_enabled !== true && 'the cart is off'].filter(Boolean).join(' and ')
    checks.push({ id: 'cart', title: 'Cart turned on for your number', state: 'error', required: true, fix: 'enable_cart', detail: `On your WhatsApp number ${missing}, so customers cannot send an order.` })
  }

  // 6. Delivery address form (optional)
  const flowId = String(organization?.commerce_address_flow_id || '').trim()
  const flow = meta?.flows?.find((item) => String(item.id) === flowId)
  const published = Boolean(flow && String(flow.status).toUpperCase() === 'PUBLISHED')
  if (!flowId) {
    checks.push({ id: 'address', title: 'Delivery address form', state: 'skipped', required: false, fix: 'store_settings', detail: 'Not used: customers are not asked for an address. Recommended for Cash on Delivery.' })
  } else if (!known) {
    checks.push({ id: 'address', title: 'Delivery address form', state: 'unknown', required: false, detail: 'Checking with Meta…' })
  } else if (published) {
    checks.push({ id: 'address', title: 'Delivery address form', state: 'ok', required: false, detail: `${flow?.name || 'Address form'} is published.` })
  } else {
    // An unpublished form cannot be sent; the checkout then skips straight to payment
    checks.push({ id: 'address', title: 'Delivery address form', state: 'warning', required: false, fix: 'store_settings', detail: flow ? `The form is ${String(flow.status || 'not published').toLowerCase()} on Meta, so it cannot be sent. Use “Create the standard form” in Store settings.` : 'The saved form is not on this WhatsApp account. Use “Create the standard form” in Store settings.' })
  }

  // 7. The express charge the form shows (optional). The fee is a setting only after the optional
  // database update (scripts/db-migration-v34-commerce.js); before it, every form shows the fixed
  // default and there is nothing to compare.
  const form = meta?.addressForm
  if (organization && 'commerce_express_fee' in organization && flowId && published && form && form.id === flowId && !form.error && form.expressLabel !== null) {
    const shown = getFeeShownInLabel(form.expressLabel)
    const fee = getExpressFee(organization)
    const charged = fee > 0 ? formatMoney(fee, currency || undefined) : null
    if ((shown || '').replace(/\s/g, '') === (charged || '').replace(/\s/g, '')) {
      checks.push({ id: 'express_fee', title: 'Express charge on the form', state: 'ok', required: false, detail: charged ? `The form shows express delivery at +${charged}, which is what the store adds.` : 'The form offers express delivery at no extra charge, as the store does.' })
    } else {
      // Only the standard form can be republished from here; a custom one is the store's own
      const standard = isStandardAddressForm(flow?.name)
      checks.push({
        id: 'express_fee', title: 'Express charge on the form', state: 'warning', required: false, fix: standard ? 'republish_address_form' : 'store_settings',
        detail: `The address form shows an express fee of ${shown || 'nothing extra'} but the store charges ${charged || 'nothing extra'}. ${standard ? 'Meta never changes a published form, so publish a new version with the current charge.' : 'Publish a new version of your form in the Flow Builder and choose it in Store settings.'}`,
      })
    }
  }

  // 8. Payment
  const gateway = getPaymentGateway(organization)
  const cod = organization?.commerce_enable_cod !== false
  const config = gateway ? meta?.paymentConfigs?.find((item) => item.configuration_name === gateway.configName) : undefined
  const configStatus = String(config?.status || '')
  const provider = String(config?.provider_name || '').toLowerCase()
  let gatewayProblem: { detail: string; fix: CheckFix } | null = null
  if (gateway && currency && currency !== 'INR') {
    // WhatsApp's in-chat payments (Razorpay, PayU, BillDesk, Zaakpay) are for businesses in India
    gatewayProblem = { detail: `Online payment in the chat works in Indian rupees only, and the store currency is ${currency}.`, fix: 'settings' }
  } else if (gateway && known && !meta?.paymentConfigsError) {
    if (!config) {
      gatewayProblem = { detail: `The payment setup “${gateway.configName}” is not on your WhatsApp account.`, fix: 'whatsapp_manager' }
    } else if (configStatus && !/active/i.test(configStatus)) {
      gatewayProblem = { detail: `The payment setup “${gateway.configName}” is ${configStatus.replace(/_/g, ' ').toLowerCase()} in WhatsApp Manager.`, fix: 'whatsapp_manager' }
    } else if ((SUPPORTED_PAYMENT_GATEWAYS as readonly string[]).includes(provider) && provider !== gateway.type) {
      // A payment request names its gateway; Meta refuses one that is not the setup's
      gatewayProblem = { detail: `The payment setup “${gateway.configName}” runs on ${GATEWAY_LABELS[provider] || provider}, but payment requests are sent for ${GATEWAY_LABELS[gateway.type] || gateway.type}. Choose the setup again in Store settings.`, fix: 'store_settings' }
    }
  }
  const ways = [gateway && 'online payment', cod && 'Cash on Delivery'].filter(Boolean).join(' and ')
  if (!gateway && !cod) {
    checks.push({ id: 'payment', title: 'A way to pay', state: 'error', required: true, fix: 'store_settings', detail: 'No online payment and no Cash on Delivery: customers are only told your team will contact them.' })
  } else if (gatewayProblem) {
    checks.push({ id: 'payment', title: 'A way to pay', state: cod ? 'warning' : 'error', required: true, fix: gatewayProblem.fix, detail: `${gatewayProblem.detail}${cod ? ' Customers can still choose Cash on Delivery.' : ''}` })
  } else {
    checks.push({ id: 'payment', title: 'A way to pay', state: gateway && !known ? 'unknown' : 'ok', required: true, detail: `Customers can pay by ${ways}.` })
  }

  return checks
}

/** Ready when every required check passed (warnings on optional ones do not block). */
export function isReadyToSell(checks: GoLiveCheck[]): boolean {
  return checks.every((check) => !check.required || check.state === 'ok' || check.state === 'warning')
}
