/**
 * Is the store ready to take orders on WhatsApp? Each check reads the store's settings and what
 * Meta reports for its WhatsApp account. Pure and client-safe: the Order flow tab and tests use it.
 */

import { getCommerceSetup, getPaymentGateway } from './commerce-utils'

export type CheckState = 'ok' | 'warning' | 'error' | 'skipped' | 'unknown'

export type CheckFix = 'settings' | 'store_settings' | 'enable_cart' | 'whatsapp_manager'

export interface GoLiveCheck {
  id: 'whatsapp' | 'store' | 'catalog' | 'cart' | 'address' | 'payment'
  title: string
  state: CheckState
  detail: string
  /** Blocks orders when not ok. Optional checks only warn. */
  required: boolean
  fix?: CheckFix
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
}

export function getGoLiveChecks(organization: Record<string, any> | null | undefined, meta: MetaDetection | null): GoLiveCheck[] {
  const setup = getCommerceSetup(organization)
  const known = meta !== null
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

  // 3. Catalog
  const catalogId = String(organization?.meta_catalog_id || '').trim()
  const catalog = meta?.catalogs?.find((item) => String(item.id) === catalogId)
  if (!catalogId) {
    checks.push({ id: 'catalog', title: 'Catalog linked', state: 'error', required: true, fix: 'store_settings', detail: 'Link the Meta catalog customers shop from.' })
  } else if (!known) {
    checks.push({ id: 'catalog', title: 'Catalog linked', state: 'unknown', required: true, detail: 'Checking with Meta…' })
  } else if (meta?.catalogsError) {
    checks.push({ id: 'catalog', title: 'Catalog linked', state: 'warning', required: true, fix: 'store_settings', detail: `Meta did not list your catalogs: ${meta.catalogsError}` })
  } else if (!catalog) {
    checks.push({ id: 'catalog', title: 'Catalog linked', state: 'error', required: true, fix: 'store_settings', detail: 'The linked catalog is not connected to this WhatsApp account. Connect it in Commerce Manager, or pick another in Store settings.' })
  } else if (catalog.product_count === 0) {
    checks.push({ id: 'catalog', title: 'Catalog linked', state: 'error', required: true, fix: 'store_settings', detail: `“${catalog.name || catalogId}” has no products yet. Add products in the Products tab.` })
  } else {
    const count = typeof catalog.product_count === 'number' ? ` · ${catalog.product_count} product${catalog.product_count === 1 ? '' : 's'}` : ''
    checks.push({ id: 'catalog', title: 'Catalog linked', state: 'ok', required: true, detail: `${catalog.name || catalogId}${count}` })
  }

  // 4. Cart and catalog on for the number
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

  // 5. Delivery address form (optional)
  const flowId = String(organization?.commerce_address_flow_id || '').trim()
  const flow = meta?.flows?.find((item) => String(item.id) === flowId)
  if (!flowId) {
    checks.push({ id: 'address', title: 'Delivery address form', state: 'skipped', required: false, fix: 'store_settings', detail: 'Not used: customers are not asked for an address. Recommended for Cash on Delivery.' })
  } else if (!known) {
    checks.push({ id: 'address', title: 'Delivery address form', state: 'unknown', required: false, detail: 'Checking with Meta…' })
  } else if (flow && String(flow.status).toUpperCase() === 'PUBLISHED') {
    checks.push({ id: 'address', title: 'Delivery address form', state: 'ok', required: false, detail: `${flow.name || 'Address form'} is published.` })
  } else {
    // An unpublished form cannot be sent; the checkout then skips straight to payment
    checks.push({ id: 'address', title: 'Delivery address form', state: 'warning', required: false, fix: 'store_settings', detail: flow ? `The form is ${String(flow.status || 'not published').toLowerCase()} on Meta, so it cannot be sent. Use “Create the standard form” in Store settings.` : 'The saved form is not on this WhatsApp account. Use “Create the standard form” in Store settings.' })
  }

  // 6. Payment
  const gateway = getPaymentGateway(organization)
  const cod = organization?.commerce_enable_cod !== false
  const config = gateway ? meta?.paymentConfigs?.find((item) => item.configuration_name === gateway.configName) : undefined
  const configStatus = String(config?.status || '')
  const gatewayProblem = gateway && known && !meta?.paymentConfigsError
    ? !config ? `The payment setup “${gateway.configName}” is not on your WhatsApp account.`
      : configStatus && !/active/i.test(configStatus) ? `The payment setup “${gateway.configName}” is ${configStatus.replace(/_/g, ' ').toLowerCase()} in WhatsApp Manager.` : null
    : null
  const ways = [gateway && 'online payment', cod && 'Cash on Delivery'].filter(Boolean).join(' and ')
  if (!gateway && !cod) {
    checks.push({ id: 'payment', title: 'A way to pay', state: 'error', required: true, fix: 'store_settings', detail: 'No online payment and no Cash on Delivery: customers are only told your team will contact them.' })
  } else if (gatewayProblem) {
    checks.push({ id: 'payment', title: 'A way to pay', state: cod ? 'warning' : 'error', required: true, fix: 'whatsapp_manager', detail: `${gatewayProblem}${cod ? ' Customers can still choose Cash on Delivery.' : ''}` })
  } else {
    checks.push({ id: 'payment', title: 'A way to pay', state: gateway && !known ? 'unknown' : 'ok', required: true, detail: `Customers can pay by ${ways}.` })
  }

  return checks
}

/** Ready when every required check passed (warnings on optional ones do not block). */
export function isReadyToSell(checks: GoLiveCheck[]): boolean {
  return checks.every((check) => !check.required || check.state === 'ok' || check.state === 'warning')
}
