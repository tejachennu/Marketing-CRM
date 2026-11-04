require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  getGoLiveChecks, isReadyToSell, expressOptionTitle, getExpressOptionTitle, getFeeShownInLabel,
  nextAddressFormName, isStandardAddressForm, STANDARD_ADDRESS_FORM_NAME,
  formCollectsAddress, getStatusTemplate, getStatusTemplateBodyProblem, getStorefrontLink, ADDRESS_FORM_ERROR,
} = require('../lib/commerce/go-live-checks.ts')
const { getPaymentStep, CHECKOUT_TEXT } = require('../lib/commerce/commerce-utils.ts')
const { compileMetaFlowJSON, NATIVE_FLOW_TEMPLATES } = require('../lib/flows/meta-flows-spec.ts')

const store = (extra = {}) => ({ whatsapp_connected: true, meta_catalog_id: 'CAT', commerce_enable_cod: true, currency: 'INR', ...extra })
const meta = (extra = {}) => ({
  catalogs: [{ id: 'CAT', name: 'Books', product_count: 12 }],
  paymentConfigs: [{ configuration_name: 'razor-live', provider_name: 'razorpay', status: 'Active' }],
  flows: [{ id: 'F1', name: 'Address', status: 'PUBLISHED' }],
  commerceSettings: { is_cart_enabled: true, is_catalog_visible: true },
  ...extra,
})
const byId = (checks) => Object.fromEntries(checks.map((check) => [check.id, check]))
/** Meta's answer with the standard form published and read back with the given express label. */
const withForm = (expressLabel, extra = {}) => meta({ flows: [{ id: 'F1', name: STANDARD_ADDRESS_FORM_NAME, status: 'PUBLISHED' }], addressForm: { id: 'F1', expressLabel, error: null }, ...extra })

test('Go live: a fully set-up store is ready', () => {
  const checks = getGoLiveChecks(store({ commerce_gateway_config_name: 'razor-live', commerce_address_flow_id: 'F1', commerce_status_template: { name: 'order_update', language: 'en' } }), meta())
  assert.ok(checks.every((check) => check.state === 'ok'), JSON.stringify(checks.filter((check) => check.state !== 'ok')))
  assert.equal(isReadyToSell(checks), true)
  // Every check says what it is about and where to fix it when it fails
  for (const check of getGoLiveChecks(store({ whatsapp_connected: false, enable_commerce: false, currency: '', meta_catalog_id: '', commerce_enable_cod: false }), meta({ commerceSettings: { is_cart_enabled: false } }))) {
    assert.ok(check.id && check.title && check.detail, check.id)
    if (check.state === 'error') assert.ok(check.fix, `${check.id} has no fix`)
  }
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

test('Go live: the payment setup must run on the gateway the store sends requests for', () => {
  const payu = meta({ paymentConfigs: [{ configuration_name: 'payu-live', provider_name: 'payu', status: 'Active' }] })
  const wrong = byId(getGoLiveChecks(store({ commerce_gateway_config_name: 'payu-live', commerce_payment_gateway: 'razorpay' }), payu)).payment
  assert.equal(wrong.state, 'warning')
  assert.match(wrong.detail, /runs on PayU, but payment requests are sent for Razorpay/)
  assert.equal(wrong.fix, 'store_settings')
  assert.equal(byId(getGoLiveChecks(store({ commerce_gateway_config_name: 'payu-live', commerce_payment_gateway: 'payu' }), payu)).payment.state, 'ok')
  // A setup whose provider Meta does not name is not second-guessed
  assert.equal(byId(getGoLiveChecks(store({ commerce_gateway_config_name: 'x' }), meta({ paymentConfigs: [{ configuration_name: 'x', status: 'Active' }] }))).payment.state, 'ok')
})

test('Go live: the currency has to be set; in-chat payment needs rupees', () => {
  const missing = byId(getGoLiveChecks(store({ currency: null }), meta())).currency
  assert.equal(missing.state, 'error')
  assert.equal(missing.required, true)
  assert.equal(missing.fix, 'settings')
  assert.equal(isReadyToSell(getGoLiveChecks(store({ currency: '' }), meta())), false)
  assert.equal(byId(getGoLiveChecks(store({ currency: 'usd' }), meta())).currency.state, 'ok')
  // Cash on Delivery in dollars is fine; an online gateway is not
  assert.equal(byId(getGoLiveChecks(store({ currency: 'USD' }), meta())).payment.state, 'ok')
  const dollars = byId(getGoLiveChecks(store({ currency: 'USD', commerce_gateway_config_name: 'razor-live' }), meta())).payment
  assert.equal(dollars.state, 'warning')
  assert.match(dollars.detail, /rupees only/)
  assert.equal(dollars.fix, 'settings')
  assert.equal(byId(getGoLiveChecks(store({ currency: 'USD', commerce_gateway_config_name: 'razor-live', commerce_enable_cod: false }), meta())).payment.state, 'error')
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

test('Go live: the express charge on the published form is compared with the one charged', () => {
  const editable = { commerce_express_fee: 80, commerce_address_flow_id: 'F1' }
  const stale = byId(getGoLiveChecks(store(editable), withForm('Express delivery (+₹50)'))).express_fee
  assert.equal(stale.state, 'warning')
  assert.equal(stale.required, false)
  assert.equal(stale.fix, 'republish_address_form')
  assert.ok(stale.detail.startsWith('The address form shows an express fee of ₹50 but the store charges ₹80.'), stale.detail)
  assert.equal(byId(getGoLiveChecks(store(editable), withForm('Express delivery (+₹80)'))).express_fee.state, 'ok')
  // Free express on the form against a charge, and the other way round
  assert.match(byId(getGoLiveChecks(store(editable), withForm('Express delivery'))).express_fee.detail, /shows an express fee of nothing extra but the store charges ₹80/)
  assert.match(byId(getGoLiveChecks(store({ ...editable, commerce_express_fee: 0 }), withForm('Express delivery (+₹50)'))).express_fee.detail, /₹50 but the store charges nothing extra/)
  assert.equal(byId(getGoLiveChecks(store({ ...editable, commerce_express_fee: 0 }), withForm('Express delivery'))).express_fee.state, 'ok')
  // A change of currency shows too
  assert.equal(byId(getGoLiveChecks(store({ ...editable, currency: 'USD' }), withForm('Express delivery (+₹80)'))).express_fee.state, 'warning')
  // A store's own form cannot be republished from here
  const custom = byId(getGoLiveChecks(store(editable), withForm('Express delivery (+₹50)', { flows: [{ id: 'F1', name: 'My address form', status: 'PUBLISHED' }] }))).express_fee
  assert.equal(custom.fix, 'store_settings')
  assert.match(custom.detail, /Flow Builder/)
  // A stale label warns; it does not block orders
  assert.equal(isReadyToSell(getGoLiveChecks(store(editable), withForm('Express delivery (+₹50)'))), true)
})

test('Go live: the express check only appears when there is something to compare', () => {
  const ids = (org, answer) => getGoLiveChecks(org, answer).map((check) => check.id)
  // The fee is fixed until the optional database update: nothing to compare
  assert.ok(!ids(store({ commerce_address_flow_id: 'F1' }), withForm('Express delivery (+₹50)')).includes('express_fee'))
  const editable = { commerce_express_fee: 80, commerce_address_flow_id: 'F1' }
  assert.ok(ids(store(editable), withForm('Express delivery (+₹50)')).includes('express_fee'))
  // No form, a form that is not published, a form without an express choice, a form Meta could not read, still loading
  assert.ok(!ids(store({ commerce_express_fee: 80 }), withForm('Express delivery (+₹50)')).includes('express_fee'))
  assert.ok(!ids(store(editable), withForm('Express delivery (+₹50)', { flows: [{ id: 'F1', name: STANDARD_ADDRESS_FORM_NAME, status: 'DRAFT' }] })).includes('express_fee'))
  assert.ok(!ids(store(editable), withForm(null)).includes('express_fee'))
  assert.ok(!ids(store(editable), meta({ flows: [{ id: 'F1', name: STANDARD_ADDRESS_FORM_NAME, status: 'PUBLISHED' }], addressForm: { id: 'F1', expressLabel: null, error: 'Meta did not answer in time.' } })).includes('express_fee'))
  assert.ok(!ids(store(editable), null).includes('express_fee'))
  // A report about another form (the store was pointed elsewhere since) is ignored
  assert.ok(!ids(store({ ...editable, commerce_address_flow_id: 'F2' }), withForm('Express delivery (+₹50)', { flows: [{ id: 'F2', name: STANDARD_ADDRESS_FORM_NAME, status: 'PUBLISHED' }] })).includes('express_fee'))
})

test('Address form: the express choice carries the charge and is read back from the published form', () => {
  assert.equal(expressOptionTitle(50, 'INR'), 'Express delivery (+₹50)')
  assert.equal(expressOptionTitle(0, 'INR'), 'Express delivery')
  assert.equal(expressOptionTitle(12.5, 'USD'), 'Express delivery (+$12.50)')
  // Meta allows 30 characters: a long amount shortens the words, never the amount
  assert.equal(expressOptionTitle(999999.99, 'INR'), 'Express (+₹9,99,999.99)')
  const longest = expressOptionTitle(1000000, 'XYZ')
  assert.ok(longest.length <= 30, longest)
  assert.ok(getFeeShownInLabel(longest), longest)
  assert.equal(getFeeShownInLabel('Express delivery (+₹50)'), '₹50')
  assert.equal(getFeeShownInLabel('Express (+₹9,99,999.99)'), '₹9,99,999.99')
  assert.equal(getFeeShownInLabel('Express delivery (+₹1,23,456.7'), '₹1,23,456.7') // cut off by the old 30-character slice
  assert.equal(getFeeShownInLabel('Express delivery'), null)
  assert.equal(getFeeShownInLabel(null), null)
  // The compiled form, as uploaded to Meta, and the template it came from
  const screens = structuredClone(NATIVE_FLOW_TEMPLATES.SHIPPING_ADDRESS.screens)
  const speed = screens[0].layout.children.find((field) => field.name === 'delivery_speed')
  speed.options = [{ id: 'standard', title: 'Standard delivery' }, { id: 'express', title: expressOptionTitle(80, 'INR') }]
  assert.equal(getExpressOptionTitle(compileMetaFlowJSON(screens)), 'Express delivery (+₹80)')
  assert.equal(getExpressOptionTitle({ screens }), 'Express delivery (+₹80)')
  assert.equal(getExpressOptionTitle({ screens: [{ id: 'X', layout: { type: 'SingleColumnLayout', children: [{ type: 'TextInput', name: 'city' }] } }] }), null)
  assert.equal(getExpressOptionTitle(null), null)
})

test('Address form: a new version gets the next free name', () => {
  assert.equal(nextAddressFormName([]), STANDARD_ADDRESS_FORM_NAME)
  assert.equal(nextAddressFormName(['Lead form', STANDARD_ADDRESS_FORM_NAME]), `${STANDARD_ADDRESS_FORM_NAME} v2`)
  assert.equal(nextAddressFormName([`${STANDARD_ADDRESS_FORM_NAME} v3`, STANDARD_ADDRESS_FORM_NAME, `${STANDARD_ADDRESS_FORM_NAME} v2`]), `${STANDARD_ADDRESS_FORM_NAME} v4`)
  assert.equal(nextAddressFormName([`${STANDARD_ADDRESS_FORM_NAME} v7`]), `${STANDARD_ADDRESS_FORM_NAME} v8`)
  assert.equal(isStandardAddressForm(`${STANDARD_ADDRESS_FORM_NAME} v12`), true)
  assert.equal(isStandardAddressForm('WhatsApp Store Delivery Address copy'), false)
  assert.equal(isStandardAddressForm(null), false)
})

test('Checkout: the payment step follows the settings', () => {
  assert.equal(getPaymentStep({ commerce_gateway_config_name: 'x', commerce_enable_cod: true }), 'choice')
  assert.equal(getPaymentStep({ commerce_gateway_config_name: 'x', commerce_enable_cod: false }), 'payment')
  assert.equal(getPaymentStep({}), 'cod')
  assert.equal(getPaymentStep({ commerce_enable_cod: false }), 'acknowledged')
  assert.equal(CHECKOUT_TEXT.received('ORD-1', 2, '₹398'), 'Thank you! We received your order #ORD-1 for 2 items (Total: ₹398).')
})

test('Go live: payment setups Meta would not list are a warning, not a pass', () => {
  const refused = meta({ paymentConfigs: [], paymentConfigsError: 'Permissions error' })
  const check = byId(getGoLiveChecks(store({ commerce_gateway_config_name: 'razor-live' }), refused)).payment
  assert.equal(check.state, 'warning')
  assert.match(check.detail, /“razor-live” could not be checked: Permissions error/)
  assert.match(check.detail, /Cash on Delivery/)
  assert.equal(check.fix, 'store_settings')
  // Without Cash on Delivery too: nothing says the setup is broken, so it does not block
  const alone = byId(getGoLiveChecks(store({ commerce_gateway_config_name: 'razor-live', commerce_enable_cod: false }), refused)).payment
  assert.equal(alone.state, 'warning')
  assert.ok(!/Cash on Delivery/.test(alone.detail), alone.detail)
  assert.equal(isReadyToSell(getGoLiveChecks(store({ commerce_gateway_config_name: 'razor-live', commerce_enable_cod: false }), refused)), true)
  // Without a gateway the list does not matter, and rupees come before the list
  assert.equal(byId(getGoLiveChecks(store(), refused)).payment.state, 'ok')
  assert.match(byId(getGoLiveChecks(store({ currency: 'USD', commerce_gateway_config_name: 'razor-live' }), refused)).payment.detail, /rupees only/)
})

test('Go live: the currency fixes say where the currency is changed', () => {
  const missing = byId(getGoLiveChecks(store({ currency: null }), meta())).currency
  assert.match(missing.detail, /Settings → General → Regional Preferences/)
  assert.match(missing.detail, /Save Preferences/)
  const dollars = byId(getGoLiveChecks(store({ currency: 'USD', commerce_gateway_config_name: 'razor-live' }), meta())).payment
  assert.ok(dollars.detail.startsWith('Online payment in the chat works in Indian rupees only, and the store currency is USD.'), dollars.detail)
  assert.match(dollars.detail, /Settings → General → Regional Preferences/)
  assert.match(dollars.detail, /“No online payment” in Store settings/)
})

test('Go live: a published form that collects no address is pointed out', () => {
  const noAddress = meta({ flows: [{ id: 'F1', name: 'Lead form', status: 'PUBLISHED' }], addressForm: { id: 'F1', expressLabel: null, collectsAddress: false, error: null } })
  const check = byId(getGoLiveChecks(store({ commerce_address_flow_id: 'F1' }), noAddress)).address
  assert.equal(check.state, 'warning')
  assert.equal(check.required, false)
  assert.equal(check.fix, 'store_settings')
  assert.match(check.detail, /^Lead form is published, but it does not collect a delivery address \(it needs an address_line_1 field\)/)
  // A form that does, one Meta could not read, a report about another form, no report: published is enough
  const state = (addressForm) => byId(getGoLiveChecks(store({ commerce_address_flow_id: 'F1' }), meta({ addressForm }))).address.state
  assert.equal(state({ id: 'F1', expressLabel: null, collectsAddress: true, error: null }), 'ok')
  assert.equal(state({ id: 'F1', expressLabel: null, collectsAddress: null, error: 'Meta did not answer in time.' }), 'ok')
  assert.equal(state({ id: 'F2', expressLabel: null, collectsAddress: false, error: null }), 'ok')
  assert.equal(state(null), 'ok')
  // A warning on the optional step never blocks orders
  assert.equal(isReadyToSell(getGoLiveChecks(store({ commerce_address_flow_id: 'F1' }), noAddress)), true)
})

test('Go live: an order-update template is wanted for customers a day old', () => {
  const missing = byId(getGoLiveChecks(store({ commerce_status_template: null }), meta())).status_template
  assert.equal(missing.state, 'warning')
  assert.equal(missing.required, false)
  assert.equal(missing.fix, 'store_settings')
  assert.ok(missing.detail.startsWith('Customers who confirmed more than a day ago cannot be told about shipping or delivery until an order-update template is chosen'), missing.detail)
  assert.match(missing.detail, /in Store settings\.$/)
  // Without the column, the database update is named
  assert.match(byId(getGoLiveChecks(store(), meta())).status_template.detail, /20261104_commerce_status_template\.sql/)
  const chosen = byId(getGoLiveChecks(store({ commerce_status_template: { name: 'order_update', language: 'en_US' } }), meta())).status_template
  assert.equal(chosen.state, 'ok')
  assert.match(chosen.detail, /“order_update” \(en_US\)/)
  // The warning never blocks orders
  assert.equal(isReadyToSell(getGoLiveChecks(store(), meta())), true)
  assert.deepEqual(getStatusTemplate({ commerce_status_template: { name: ' order_update ', language: 'en' } }), { name: 'order_update', language: 'en' })
  assert.equal(getStatusTemplate({ commerce_status_template: { name: 'order_update' } }), null)
  assert.equal(getStatusTemplate({ commerce_status_template: 'order_update' }), null)
  assert.equal(getStatusTemplate({}), null)
  assert.equal(getStatusTemplate(null), null)
})

test('Order-update template: the body has to take the three numbered variables the update fills', () => {
  assert.equal(getStatusTemplateBodyProblem('Order {{1}} is {{2}}. Tracking: {{3}}'), null)
  // Spaces inside the braces and a variable used twice are fine; the order of appearance is not checked
  assert.equal(getStatusTemplateBodyProblem('{{ 3 }} for order {{2}}: {{1}} ({{1}})'), null)
  const two = getStatusTemplateBodyProblem('Order {{1}} is {{2}}.')
  assert.match(two, /^This template has 2 variables in its body \(\{\{1\}\}, \{\{2\}\}\), but the order update fills exactly three numbered ones/)
  assert.match(two, /\{\{1\}\} the order number, \{\{2\}\} the status, \{\{3\}\} the tracking details/)
  assert.match(getStatusTemplateBodyProblem('Your order has shipped.'), /^This template has no variables in its body, but/)
  assert.match(getStatusTemplateBodyProblem('Order {{1}} has shipped.'), /^This template has one variable in its body \(\{\{1\}\}\)/)
  assert.match(getStatusTemplateBodyProblem('{{1}} {{2}} {{3}} {{4}}'), /^This template has 4 variables/)
  // Meta's named variables are filled by name, which the update does not do
  assert.match(getStatusTemplateBodyProblem('Order {{order_number}} is {{status}}. Tracking: {{tracking}}'), /^This template uses named variables \(\{\{order_number\}\}, \{\{status\}\}, \{\{tracking\}\}\), but the order update fills numbered ones/)
  assert.match(getStatusTemplateBodyProblem(''), /no variables/)
  assert.match(getStatusTemplateBodyProblem(undefined), /no variables/)
})

test('Address form: whether a form hands back a delivery address is read from its fields', () => {
  assert.equal(formCollectsAddress(compileMetaFlowJSON(structuredClone(NATIVE_FLOW_TEMPLATES.SHIPPING_ADDRESS.screens))), true)
  assert.equal(formCollectsAddress({ screens: NATIVE_FLOW_TEMPLATES.SHIPPING_ADDRESS.screens }), true)
  // A lead form: the field is on no screen
  assert.equal(formCollectsAddress({ screens: [{ id: 'LEAD', layout: { type: 'SingleColumnLayout', children: [{ type: 'Form', name: 'form', children: [{ type: 'TextInput', name: 'full_name' }, { type: 'TextInput', name: 'city' }] }] } }] }), false)
  // The field may sit on a later screen
  assert.equal(formCollectsAddress({ screens: [{ id: 'A', layout: { children: [{ type: 'TextInput', name: 'full_name' }] } }, { id: 'B', layout: { children: [{ type: 'Form', name: 'form', children: [{ type: 'TextInput', name: 'address_line_1' }] }] } }] }), true)
  assert.equal(formCollectsAddress(null), false)
  assert.equal(formCollectsAddress({ screens: 'x' }), false)
  assert.equal(ADDRESS_FORM_ERROR, 'This form does not collect a delivery address (it needs an address_line_1 field)')
})

test('Storefront: the catalog link is Meta\'s wa.me/c/ address for the store\'s number', () => {
  assert.equal(getStorefrontLink({ whatsapp_default_phone: '+91 98765 43210' }), 'https://wa.me/c/919876543210')
  assert.equal(getStorefrontLink({ whatsapp_default_phone: 'whatsapp:+14155238886' }), 'https://wa.me/c/14155238886')
  // Too short to be a number, or no number yet
  assert.equal(getStorefrontLink({ whatsapp_default_phone: '1234' }), null)
  assert.equal(getStorefrontLink({ whatsapp_default_phone: '' }), null)
  assert.equal(getStorefrontLink({}), null)
  assert.equal(getStorefrontLink(null), null)
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

test('Order-update template: a header or button the update cannot fill is pointed out, as the body is', () => {
  const { getStatusTemplateStructureProblem, getStatusTemplateProblem } = require('../lib/commerce/go-live-checks.ts')
  const body = { type: 'BODY', text: 'Order {{1}} is {{2}}. Tracking: {{3}}' }
  // Fine: no header, a plain text header, quick replies, a phone number and a fixed link
  assert.equal(getStatusTemplateProblem([body]), null)
  assert.equal(getStatusTemplateProblem([{ type: 'HEADER', format: 'TEXT', text: 'Order update' }, body, { type: 'FOOTER', text: 'Thanks' }]), null)
  assert.equal(getStatusTemplateProblem([body, { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Help' }, { type: 'PHONE_NUMBER', text: 'Call', phone_number: '+91' }, { type: 'URL', text: 'Track', url: 'https://shop.example.com/track' }] }]), null)
  assert.equal(getStatusTemplateStructureProblem(undefined), null)

  // Every one of these goes out without its value, so Meta refuses every update
  for (const [components, wording] of [
    [[{ type: 'HEADER', format: 'IMAGE', example: { header_handle: ['h'] } }, body], /image header/],
    [[{ type: 'HEADER', format: 'DOCUMENT' }, body], /document header/],
    [[{ type: 'HEADER', format: 'LOCATION' }, body], /location header/],
    [[{ type: 'HEADER', format: 'TEXT', text: 'Order {{1}}' }, body], /header has a variable/],
    [[body, { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Track', url: 'https://shop.example.com/track/{{1}}' }] }], /link button with a variable/],
    [[body, { type: 'BUTTONS', buttons: [{ type: 'COPY_CODE', example: 'SAVE10' }] }], /copy-code button/],
    [[body, { type: 'BUTTONS', buttons: [{ type: 'FLOW', text: 'Open', flow_id: '1' }] }], /form button/],
  ]) {
    assert.match(getStatusTemplateProblem(components), wording)
    assert.match(getStatusTemplateProblem(components), /cannot fill, so Meta would refuse it\.$/)
  }
  // The body is checked first
  assert.match(getStatusTemplateProblem([{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Shipped' }]), /no variables in its body/)
})

test('Order-update template: a saved template whose header or buttons the update cannot fill is a warning once Meta lists it', () => {
  const saved = store({ commerce_status_template: { name: 'order_update', language: 'en' } })
  const body = { type: 'BODY', text: 'Order {{1}} is {{2}}. Tracking: {{3}}' }
  const listed = (components) => byId(getGoLiveChecks(saved, meta({ statusTemplateComponents: components }))).status_template
  assert.equal(listed([body]).state, 'ok')
  const media = listed([{ type: 'HEADER', format: 'IMAGE' }, body])
  assert.deepEqual([media.state, media.required, media.fix], ['warning', false, 'store_settings'])
  assert.match(media.detail, /“order_update” \(en\): This template has a image header/)
  // Not looked up: nothing to go on, so the saved template stands
  assert.equal(byId(getGoLiveChecks(saved, meta())).status_template.state, 'ok')
})
