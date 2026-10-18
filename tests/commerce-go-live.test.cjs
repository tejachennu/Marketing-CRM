require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const { getGoLiveChecks, isReadyToSell } = require('../lib/commerce/go-live-checks.ts')
const { getPaymentStep, CHECKOUT_TEXT } = require('../lib/commerce/commerce-utils.ts')

const store = (extra = {}) => ({ whatsapp_connected: true, meta_catalog_id: 'CAT', commerce_enable_cod: true, ...extra })
const meta = (extra = {}) => ({
  catalogs: [{ id: 'CAT', name: 'Books', product_count: 12 }],
  paymentConfigs: [{ configuration_name: 'razor-live', provider_name: 'razorpay', status: 'Active' }],
  flows: [{ id: 'F1', name: 'Address', status: 'PUBLISHED' }],
  commerceSettings: { is_cart_enabled: true, is_catalog_visible: true },
  ...extra,
})
const byId = (checks) => Object.fromEntries(checks.map((check) => [check.id, check]))

test('Go live: a fully set-up store is ready', () => {
  const checks = getGoLiveChecks(store({ commerce_gateway_config_name: 'razor-live', commerce_address_flow_id: 'F1' }), meta())
  assert.ok(checks.every((check) => check.state === 'ok'), JSON.stringify(checks.filter((check) => check.state !== 'ok')))
  assert.equal(isReadyToSell(checks), true)
})

test('Go live: Cash on Delivery alone is enough; no address form is optional', () => {
  const checks = byId(getGoLiveChecks(store(), meta()))
  assert.equal(checks.payment.state, 'ok')
  assert.equal(checks.address.state, 'skipped')
  assert.equal(isReadyToSell(Object.values(checks)), true)
})

test('Go live: a cart that is off for the number blocks orders and offers the fix', () => {
  const checks = getGoLiveChecks(store(), meta({ commerceSettings: { is_cart_enabled: false, is_catalog_visible: true } }))
  const cart = byId(checks).cart
  assert.equal(cart.state, 'error')
  assert.equal(cart.fix, 'enable_cart')
  assert.match(cart.detail, /cart is off/)
  assert.equal(isReadyToSell(checks), false)
})

test('Go live: the catalog must be on the WhatsApp account and have products', () => {
  assert.equal(byId(getGoLiveChecks(store({ meta_catalog_id: 'OTHER' }), meta())).catalog.state, 'error')
  assert.match(byId(getGoLiveChecks(store(), meta({ catalogs: [{ id: 'CAT', product_count: 0 }] }))).catalog.detail, /no products/)
  assert.equal(byId(getGoLiveChecks(store({ meta_catalog_id: '' }), meta())).catalog.fix, 'store_settings')
})

test('Go live: payment problems', () => {
  // Nothing to pay with
  assert.equal(byId(getGoLiveChecks(store({ commerce_enable_cod: false }), meta())).payment.state, 'error')
  // A gateway that is not active: an error alone, a warning when COD still works
  const pending = meta({ paymentConfigs: [{ configuration_name: 'razor-live', status: 'Needs_Testing' }] })
  assert.equal(byId(getGoLiveChecks(store({ commerce_gateway_config_name: 'razor-live', commerce_enable_cod: false }), pending)).payment.state, 'error')
  const withCod = byId(getGoLiveChecks(store({ commerce_gateway_config_name: 'razor-live' }), pending)).payment
  assert.equal(withCod.state, 'warning')
  assert.match(withCod.detail, /needs testing/)
  assert.match(byId(getGoLiveChecks(store({ commerce_gateway_config_name: 'missing' }), meta())).payment.detail, /not on your WhatsApp account/)
})

test('Go live: switched-off store, missing WhatsApp, an unpublished form, and still checking', () => {
  assert.equal(byId(getGoLiveChecks(store({ enable_commerce: false }), meta())).store.state, 'error')
  assert.equal(byId(getGoLiveChecks(store({ whatsapp_connected: false }), meta())).whatsapp.fix, 'settings')
  assert.equal(byId(getGoLiveChecks(store(), meta({ connectionError: 'Token expired' }))).whatsapp.detail, 'Token expired')
  assert.equal(byId(getGoLiveChecks(store({ commerce_address_flow_id: 'F1' }), meta({ flows: [{ id: 'F1', status: 'DRAFT' }] }))).address.state, 'warning')
  const loading = getGoLiveChecks(store(), null)
  assert.equal(byId(loading).cart.state, 'unknown')
  assert.equal(isReadyToSell(loading), false)
})

test('Checkout: the payment step follows the settings', () => {
  assert.equal(getPaymentStep({ commerce_gateway_config_name: 'x', commerce_enable_cod: true }), 'choice')
  assert.equal(getPaymentStep({ commerce_gateway_config_name: 'x', commerce_enable_cod: false }), 'payment')
  assert.equal(getPaymentStep({}), 'cod')
  assert.equal(getPaymentStep({ commerce_enable_cod: false }), 'acknowledged')
  assert.equal(CHECKOUT_TEXT.received('ORD-1', 2, '₹398'), 'Thank you! We received your order #ORD-1 for 2 items (Total: ₹398).')
})

test('Go live: a connected catalog missing from Meta\'s account list is not reported as disconnected', () => {
  // What Store settings saw: the catalog lookup says it is linked with 5 products; Meta's account list is empty
  const reported = meta({ catalogs: [], catalogStatus: { linked: { name: 'Catalogue_Products', product_count: 5 }, linkedError: null, connected: null } })
  const catalog = byId(getGoLiveChecks(store(), reported)).catalog
  assert.equal(catalog.state, 'ok')
  assert.equal(catalog.detail, 'Catalogue_Products · 5 products')
  // Without the catalog lookup, an empty list with the catalog showing on the number is fine too
  assert.equal(byId(getGoLiveChecks(store(), meta({ catalogs: [] }))).catalog.state, 'ok')
  // Only a definite "not connected" is an error
  assert.equal(byId(getGoLiveChecks(store(), meta({ catalogStatus: { linked: { name: 'X', product_count: 5 }, connected: false } }))).catalog.state, 'error')
  assert.equal(byId(getGoLiveChecks(store(), meta({ catalogStatus: { linked: null, linkedError: 'Unsupported get request', connected: null } }))).catalog.state, 'error')
  assert.equal(byId(getGoLiveChecks(store(), meta({ catalogStatus: { linked: { name: 'X', product_count: 0 }, connected: true } }))).catalog.state, 'error')
})
