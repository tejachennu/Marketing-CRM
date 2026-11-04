require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

// 1. Test Message Builders
test('WhatsApp Commerce: buildSingleProductMessage generates valid Meta envelope', () => {
  const { buildSingleProductMessage } = require('../lib/commerce/commerce-messages.ts')
  const msg = buildSingleProductMessage({
    phone: '+91 98765 43210',
    catalogId: 'CAT_12345',
    productRetailerId: 'SKU_SHIRT_01',
    bodyText: 'Check out this fresh arrival!',
    footerText: 'Free shipping today',
  })

  assert.equal(msg.messaging_product, 'whatsapp')
  assert.equal(msg.to, '919876543210')
  assert.equal(msg.type, 'interactive')
  assert.equal(msg.interactive.type, 'product')
  assert.equal(msg.interactive.action.catalog_id, 'CAT_12345')
  assert.equal(msg.interactive.action.product_retailer_id, 'SKU_SHIRT_01')
  assert.equal(msg.interactive.body.text, 'Check out this fresh arrival!')
  assert.equal(msg.interactive.footer.text, 'Free shipping today')
})

test('WhatsApp Commerce: buildSingleProductMessage throws on missing required fields', () => {
  const { buildSingleProductMessage } = require('../lib/commerce/commerce-messages.ts')
  assert.throws(() => {
    buildSingleProductMessage({
      phone: '919876543210',
      catalogId: '',
      productRetailerId: 'SKU_01',
      bodyText: 'test',
    })
  }, /Catalog ID is required/)

  assert.throws(() => {
    buildSingleProductMessage({
      phone: '919876543210',
      catalogId: 'CAT_1',
      productRetailerId: '',
      bodyText: 'test',
    })
  }, /Product retailer ID/)
})

test('WhatsApp Commerce: buildMultiProductMessage generates sections and enforces Meta limit', () => {
  const { buildMultiProductMessage } = require('../lib/commerce/commerce-messages.ts')
  const msg = buildMultiProductMessage({
    phone: '919876543210',
    catalogId: 'CAT_99',
    headerText: 'Summer Specials',
    bodyText: 'Select your preferred designs:',
    sections: [
      {
        title: 'Linen Shirts',
        productRetailerIds: ['SKU_1', 'SKU_2'],
      },
      {
        title: 'Trousers',
        productRetailerIds: ['SKU_3'],
      },
    ],
  })

  assert.equal(msg.interactive.type, 'product_list')
  assert.equal(msg.interactive.header.text, 'Summer Specials')
  assert.equal(msg.interactive.action.sections.length, 2)
  assert.equal(msg.interactive.action.sections[0].title, 'Linen Shirts')
  assert.equal(msg.interactive.action.sections[0].product_items.length, 2)
  assert.equal(msg.interactive.action.sections[1].product_items[0].product_retailer_id, 'SKU_3')

  // Throws if > 30 items
  assert.throws(() => {
    const tooMany = Array.from({ length: 31 }, (_, i) => `SKU_${i}`)
    buildMultiProductMessage({
      phone: '919876543210',
      catalogId: 'CAT_99',
      bodyText: 'test',
      sections: [{ title: 'All', productRetailerIds: tooMany }],
    })
  }, /at most 30 items/)
})

test('WhatsApp Commerce: buildCatalogMessage generates full catalog envelope', () => {
  const { buildCatalogMessage } = require('../lib/commerce/commerce-messages.ts')
  const msg = buildCatalogMessage({
    phone: '919876543210',
    bodyText: 'Browse our entire storefront:',
    thumbnailProductRetailerId: 'FEATURED_SKU',
  })

  assert.equal(msg.interactive.type, 'catalog_message')
  assert.equal(msg.interactive.action.name, 'catalog_message')
  assert.equal(msg.interactive.action.parameters.thumbnail_product_retailer_id, 'FEATURED_SKU')
})

test('WhatsApp Commerce: buildOrderDetailsMessage generates native In-Chat payment envelope', () => {
  const { buildOrderDetailsMessage } = require('../lib/commerce/commerce-messages.ts')
  const msg = buildOrderDetailsMessage({
    phone: '+91 99999 88888',
    referenceId: 'ORD-261013-AB12',
    currency: 'INR',
    shippingFee: 50.0,
    taxAmount: 0.0,
    items: [
      { retailer_id: 'SKU_A', name: 'Cotton Shirt', unit_price: 600, quantity: 2 },
    ],
    paymentGatewayType: 'razorpay',
    paymentGatewayConfigName: 'my_razorpay_meta_config',
  })

  assert.equal(msg.type, 'interactive')
  assert.equal(msg.interactive.type, 'order_details')
  const params = msg.interactive.action.parameters
  assert.equal(params.reference_id, 'ORD-261013-AB12')
  assert.equal(params.currency, 'INR')
  // Value in paise (100 offset)
  assert.equal(params.total_amount.value, 125000)
  assert.equal(params.total_amount.offset, 100)
  assert.equal(params.order.subtotal.value, 120000)
  assert.equal(params.order.shipping.value, 5000)
  assert.equal(params.payment_settings[0].payment_gateway.type, 'razorpay')
  assert.equal(params.payment_settings[0].payment_gateway.configuration_name, 'my_razorpay_meta_config')
})

test('WhatsApp payment request: item amounts are per unit, and the totals always add up', () => {
  const { buildOrderDetailsMessage } = require('../lib/commerce/commerce-messages.ts')
  const build = (overrides = {}) => buildOrderDetailsMessage({
    phone: '919876543210', referenceId: 'ORD-1', currency: 'INR', paymentGatewayConfigName: 'cfg',
    items: [
      { retailer_id: 'A', name: 'Shirt', unit_price: 499.5, quantity: 3 },
      { retailer_id: 'B', name: 'Cap', unit_price: 120, quantity: 1 },
    ],
    ...overrides,
  }).interactive.action.parameters

  const params = build({ shippingFee: 40, taxAmount: 12.5 })
  // WhatsApp multiplies amount by quantity itself: sending the line total would charge 3 x 3 shirts
  assert.deepEqual(params.order.items.map((item) => [item.amount.value, item.quantity]), [[49950, 3], [12000, 1]])
  assert.equal(params.order.items[0].sale_amount, undefined)

  const sumOfLines = params.order.items.reduce((sum, item) => sum + item.amount.value * item.quantity, 0)
  assert.equal(params.order.subtotal.value, sumOfLines)
  assert.equal(params.order.subtotal.value, 161850)
  assert.equal(params.total_amount.value, params.order.subtotal.value + params.order.tax.value + params.order.shipping.value)
  assert.equal(params.total_amount.value, 167100)

  // A total passed in by mistake cannot break the sum: the amount is always worked out from the lines
  assert.equal(build({ totalAmount: 1, subtotal: 2 }).total_amount.value, 161850)
  // No shipping line when shipping is free; tax is always present
  const free = build()
  assert.equal(free.order.shipping, undefined)
  assert.deepEqual(free.order.tax, { value: 0, offset: 100 })
  // A discount is taken off, and can never exceed the goods
  const discounted = build({ discountAmount: 100 })
  assert.equal(discounted.total_amount.value, discounted.order.subtotal.value - discounted.order.discount.value)
  const capped = build({ discountAmount: 999999, shippingFee: 40 })
  assert.deepEqual([capped.order.discount.value, capped.total_amount.value], [161850, 4000])
  // Discounted down to nothing: there is nothing to request
  assert.throws(() => build({ discountAmount: 999999 }), /above zero/)
})

test('WhatsApp payment request: the reference and texts respect WhatsApp limits', () => {
  const { buildOrderDetailsMessage } = require('../lib/commerce/commerce-messages.ts')
  const item = { retailer_id: 'A', name: 'N'.repeat(200), unit_price: 10, quantity: 1 }
  const build = (referenceId, extra = {}) => buildOrderDetailsMessage({ phone: '919876543210', referenceId, currency: 'INR', items: [item], ...extra })

  // A database id is 36 characters: one more than WhatsApp accepts
  assert.throws(() => build('3f2b8a52-7c1e-4d7a-9b1f-0a1b2c3d4e5f'), /not valid/)
  assert.throws(() => build('ORD 1'), /not valid/)
  assert.throws(() => build('ORD#1'), /not valid/)
  assert.throws(() => build(''), /Reference ID is required/)
  assert.equal(build('A'.repeat(35)).interactive.action.parameters.reference_id.length, 35)

  const message = build('ORD-1', { bodyText: 'B'.repeat(3000), footerText: 'F'.repeat(200) })
  assert.ok(message.interactive.body.text.length <= 1024)
  assert.ok(message.interactive.footer.text.length <= 60)
  assert.ok(message.interactive.action.parameters.order.items[0].name.length <= 60)

  // Nothing to charge: there is no such thing as a zero payment request
  assert.throws(() => buildOrderDetailsMessage({ phone: '1', referenceId: 'ORD-1', currency: 'INR', items: [{ retailer_id: 'A', name: 'Free', unit_price: 0, quantity: 1 }] }), /above zero/)
  assert.throws(() => buildOrderDetailsMessage({ phone: '1', referenceId: 'ORD-1', currency: 'INR', items: [] }), /items are required/)
})

test('WhatsApp Commerce: buildOrderStatusMessage formats status receipts correctly', () => {
  const { buildOrderStatusMessage } = require('../lib/commerce/commerce-messages.ts')
  const receipt = buildOrderStatusMessage({
    phone: '919876543210',
    referenceId: 'ORD_1001',
    status: 'completed',
    description: 'Order delivered successfully!',
  })

  assert.equal(receipt.interactive.type, 'order_status')
  assert.equal(receipt.interactive.action.parameters.order.status, 'completed')
  assert.equal(receipt.interactive.action.parameters.order.description, 'Order delivered successfully!')

  // The card's description is limited to 120 characters; the message body keeps the full text
  const long = buildOrderStatusMessage({ phone: '1', referenceId: 'ORD_1', status: 'shipped', description: 'x'.repeat(400) })
  assert.ok(long.interactive.action.parameters.order.description.length <= 120)
  assert.equal(long.interactive.body.text.length, 400)
})

test('WhatsApp Commerce: checkout messages (buttons, address form) are well formed', () => {
  const { buildButtonsMessage, buildAddressFlowMessage, buildTextMessage } = require('../lib/commerce/commerce-messages.ts')
  const buttons = buildButtonsMessage('+91 98765 43210', 'How would you like to pay?', [
    { id: 'pay_online_1', title: 'Pay online' },
    { id: 'cod_confirm_1', title: 'A title that is far longer than twenty characters' },
  ])
  assert.equal(buttons.to, '919876543210')
  assert.equal(buttons.interactive.type, 'button')
  assert.deepEqual(buttons.interactive.action.buttons.map((b) => b.reply.id), ['pay_online_1', 'cod_confirm_1'])
  assert.ok(buttons.interactive.action.buttons.every((b) => b.reply.title.length <= 20))
  assert.throws(() => buildButtonsMessage('1', 'x', []), /one to three/)
  assert.throws(() => buildButtonsMessage('1', 'x', [1, 2, 3, 4].map((n) => ({ id: `b${n}`, title: `B${n}` }))), /one to three/)

  const form = buildAddressFlowMessage({ phone: '919876543210', flowId: '555', orderId: 'abc', bodyText: 'Where to?' })
  const parameters = form.interactive.action.parameters
  assert.deepEqual([form.interactive.type, parameters.flow_id, parameters.flow_token, parameters.mode], ['flow', '555', 'order_abc', 'published'])
  assert.deepEqual(parameters.flow_action_payload, { screen: 'SHIPPING_DETAILS' })

  assert.deepEqual(buildTextMessage('+91 98765 43210', 'Hi').text, { body: 'Hi' })
})

test('WhatsApp Commerce: buildWebsiteRedirectUrl adds UTM tracking and attribution', () => {
  const { buildWebsiteRedirectUrl } = require('../lib/commerce/commerce-messages.ts')
  const url = buildWebsiteRedirectUrl({
    baseUrl: 'https://store.example.com/products/linen-shirt',
    productRetailerId: 'SHIRT_01',
    contactId: 'contact_abc123',
    campaignId: 'summer_promo',
    couponCode: 'SAVE20',
  })

  const parsed = new URL(url)
  assert.equal(parsed.searchParams.get('utm_source'), 'whatsapp')
  assert.equal(parsed.searchParams.get('utm_medium'), 'chat')
  assert.equal(parsed.searchParams.get('utm_campaign'), 'summer_promo')
  assert.equal(parsed.searchParams.get('ref_contact'), 'contact_abc123')
  assert.equal(parsed.searchParams.get('sku'), 'SHIRT_01')
  assert.equal(parsed.searchParams.get('discount'), 'SAVE20')
})

test('WhatsApp Commerce: calculateOrderTotals correctly applies shipping thresholds and taxes', () => {
  const { calculateOrderTotals } = require('../lib/commerce/meta-commerce.ts')
  const items = [
    { unit_price: 300, quantity: 2 }, // 600
    { unit_price: 200, quantity: 1 }, // 200 => Subtotal: 800
  ]

  // With shipping fee of 100, free shipping threshold of 1000
  const totals1 = calculateOrderTotals(items, {
    shippingFee: 100,
    freeShippingThreshold: 1000,
    taxRate: 0.05,
  })

  assert.equal(totals1.subtotal, 800)
  assert.equal(totals1.shippingFee, 100)
  assert.equal(totals1.taxAmount, 40)
  assert.equal(totals1.grandTotal, 940)

  // With free shipping threshold met (subtotal 800 >= 500)
  const totals2 = calculateOrderTotals(items, {
    shippingFee: 100,
    freeShippingThreshold: 500,
  })

  assert.equal(totals2.shippingFee, 0)
  assert.equal(totals2.grandTotal, 800)
})

// ── Checkout rules: order statuses, money, products and the webhook handlers ──────
const utils = require('../lib/commerce/commerce-utils.ts')
const handlers = require('../lib/commerce/commerce-webhook-handler.ts')

test('Commerce rules: orders only move forward, and finished orders are final', () => {
  assert.equal(utils.canTransitionOrder('payment_pending', 'paid'), true)
  assert.equal(utils.canTransitionOrder('paid', 'shipped'), true)
  assert.equal(utils.canTransitionOrder('shipped', 'delivered'), true)
  assert.equal(utils.canTransitionOrder('payment_pending', 'delivered'), false)
  assert.equal(utils.canTransitionOrder('delivered', 'paid'), false)
  assert.deepEqual(utils.getNextOrderStatuses('canceled'), [])
  assert.deepEqual(utils.getNextOrderStatuses('nonsense'), [])
  for (const status of utils.ORDER_STATUSES) assert.ok(utils.ORDER_STATUS_LABELS[status])
})

test('Commerce rules: revenue counts paid orders that were not canceled', () => {
  assert.equal(utils.isRevenueOrder({ status: 'shipped', payment_status: 'paid' }), true)
  assert.equal(utils.isRevenueOrder({ status: 'cod_confirmed', payment_status: 'pending' }), false)
  assert.equal(utils.isRevenueOrder({ status: 'canceled', payment_status: 'paid' }), false)
})

test('Commerce rules: money is formatted in the order currency, not a fixed rupee sign', () => {
  assert.match(utils.formatMoney(1050, 'INR'), /₹\s?1,050/)
  assert.match(utils.formatMoney(12.5, 'USD'), /\$12\.50/)
  assert.equal(utils.formatMoney(5, 'not-a-code'), 'NOT-A-CODE 5.00')
  assert.match(utils.formatMoney(null, null), /0/)
})

test('Commerce rules: only gateways Meta supports are used for in-chat payment', () => {
  assert.deepEqual(utils.getPaymentGateway({ commerce_payment_gateway: 'payu', commerce_gateway_config_name: ' cfg ' }), { type: 'payu', configName: 'cfg' })
  assert.equal(utils.getPaymentGateway({ commerce_payment_gateway: 'link', commerce_gateway_config_name: 'cfg' }), null)
  assert.equal(utils.getPaymentGateway({ commerce_payment_gateway: 'razorpay', commerce_gateway_config_name: '' }), null)
  const setup = utils.getCommerceSetup({ whatsapp_api_token: 't', whatsapp_phone_number_id: '1', commerce_enable_cod: false })
  assert.equal(setup.canCheckout, false) // connected, but no way to pay
})

test('Commerce rules: product input is validated before it is saved', () => {
  const product = utils.parseProductInput({ title: ' Shirt ', retailer_id: ' SKU-1 ', price: '1499.999', inventory_count: '0', image_url: 'https://cdn.example.com/a.png' })
  assert.deepEqual([product.title, product.retailer_id, product.price, product.currency, product.inventory_count, product.is_available], ['Shirt', 'SKU-1', 1500, 'INR', 0, false])
  assert.equal(utils.parseProductInput({ title: 'A', retailer_id: 'B', price: 0 }).inventory_count, 100)
  assert.throws(() => utils.parseProductInput({ title: 'A', retailer_id: 'B', price: 'abc' }), /valid price/)
  assert.throws(() => utils.parseProductInput({ title: 'A', retailer_id: 'B', price: -1 }), /valid price/)
  assert.throws(() => utils.parseProductInput({ title: '', retailer_id: 'B', price: 1 }), /title/)
  assert.throws(() => utils.parseProductInput({ title: 'A', retailer_id: 'B', price: 1, website_url: 'javascript:alert(1)' }), /web address/)
})

// ── Rules added with the checkout rework ────────────────────────────────────

test('Payment references: the order number, with a counter when asked again', () => {
  assert.equal(utils.buildPaymentReference('ORD-261013-AB12'), 'ORD-261013-AB12')
  assert.equal(utils.buildPaymentReference('ORD-261013-AB12', 2), 'ORD-261013-AB12.2')
  assert.equal(utils.buildPaymentReference('ORD 26/10#13'), 'ORD261013')
  assert.ok(utils.buildPaymentReference('X'.repeat(80), 12).length <= utils.MAX_PAYMENT_REFERENCE_LENGTH)
  assert.throws(() => utils.buildPaymentReference(''), /order number is required/)

  assert.deepEqual(utils.parsePaymentReference('ORD-261013-AB12'), { kind: 'order_number', orderNumber: 'ORD-261013-AB12', attempt: 1 })
  assert.deepEqual(utils.parsePaymentReference('ORD-261013-AB12.3'), { kind: 'order_number', orderNumber: 'ORD-261013-AB12', attempt: 3 })
  // Requests sent before order numbers were used carried the order's database id
  assert.deepEqual(utils.parsePaymentReference('3F2B8A52-7C1E-4D7A-9B1F-0A1B2C3D4E5F'), { kind: 'order_id', orderId: '3f2b8a52-7c1e-4d7a-9b1f-0a1b2c3d4e5f' })
  for (const bad of ['', null, undefined, 'ORD 1', 'a/b']) assert.equal(utils.parsePaymentReference(bad), null)
})

test('Payment references: every new request for an order is different', () => {
  const order = { order_number: 'ORD-261013-AB12', meta_payment_reference: null }
  assert.equal(utils.hasPaymentRequest(order), false)
  const first = utils.nextPaymentReference(order)
  assert.equal(first, 'ORD-261013-AB12')

  const second = utils.nextPaymentReference({ ...order, meta_payment_reference: first })
  const third = utils.nextPaymentReference({ ...order, meta_payment_reference: second })
  assert.deepEqual([second, third], ['ORD-261013-AB12.2', 'ORD-261013-AB12.3'])
  assert.equal(utils.hasPaymentRequest({ ...order, meta_payment_reference: third }), true)

  // An old transaction id left in the column is not mistaken for a payment request
  assert.equal(utils.hasPaymentRequest({ ...order, meta_payment_reference: 'pay_ABC123' }), false)
  assert.equal(utils.nextPaymentReference({ ...order, meta_payment_reference: 'pay_ABC123' }), 'ORD-261013-AB12')
})

test('Commerce rules: order views, refunds, express charge, tracking and addresses', () => {
  assert.deepEqual(Object.keys(utils.ORDER_VIEWS), ['all', 'awaiting', 'to_ship', 'shipped', 'delivered', 'canceled'])
  for (const statuses of Object.values(utils.ORDER_VIEWS)) {
    for (const status of statuses || []) assert.ok(utils.ORDER_STATUSES.includes(status), status)
  }
  assert.equal(utils.needsRefund({ status: 'canceled', payment_status: 'paid' }), true)
  assert.equal(utils.needsRefund({ status: 'canceled', payment_status: 'pending' }), false)
  assert.equal(utils.needsRefund({ status: 'shipped', payment_status: 'paid' }), false)

  // 50 until the store sets its own; 0 is a real setting (express at no extra cost)
  assert.equal(utils.getExpressFee({}), 50)
  assert.equal(utils.getExpressFee({ commerce_express_fee: null }), 50)
  assert.equal(utils.getExpressFee({ commerce_express_fee: 0 }), 0)
  assert.equal(utils.getExpressFee({ commerce_express_fee: '75.5' }), 75.5)
  assert.equal(utils.getExpressFee({ commerce_express_fee: -5 }), 50)

  assert.equal(utils.toMinorUnits(499.5), 49950)
  assert.equal(utils.toMinorUnits('12.34'), 1234)
  assert.equal(utils.toMinorUnits(null), 0)

  assert.deepEqual(utils.getFulfillment({ shipping_address: { tracking_number: ' AWB123 ', carrier: 'Delhivery', tracking_url: ' https://track.example.com/AWB123 ', shipped_at: '2026-10-13T10:00:00Z' } }), { trackingNumber: 'AWB123', carrier: 'Delhivery', trackingUrl: 'https://track.example.com/AWB123', shippedAt: '2026-10-13T10:00:00Z' })
  assert.deepEqual(utils.getFulfillment({ shipping_address: null }), { trackingNumber: '', carrier: '', trackingUrl: '', shippedAt: null })
  assert.equal(utils.describeTracking({ carrier: 'Delhivery', trackingNumber: 'AWB123', trackingUrl: 'https://track.example.com/AWB123' }), 'Delhivery · AWB123 · https://track.example.com/AWB123')
  assert.equal(utils.describeTracking({ carrier: '', trackingNumber: 'AWB123', trackingUrl: '' }), 'AWB123')
  assert.equal(utils.describeTracking(utils.getFulfillment({})), '')
  // A tracking link the customer can open: http(s) only, and not absurdly long
  assert.equal(utils.parseTrackingUrl(' https://track.example.com/AWB123 '), 'https://track.example.com/AWB123')
  assert.equal(utils.parseTrackingUrl(''), '')
  assert.equal(utils.parseTrackingUrl(null), '')
  assert.throws(() => utils.parseTrackingUrl('javascript:alert(1)'), /web address/)
  assert.throws(() => utils.parseTrackingUrl('track.example.com/AWB123'), /web address/)
  assert.throws(() => utils.parseTrackingUrl(`https://track.example.com/${'A'.repeat(500)}`), /500 characters/)
  assert.equal(utils.formatAddress({ address_line_1: '1 MG Road', address_line_2: '', city: 'Mumbai', state: 'MH', pincode: '400001' }), '1 MG Road, Mumbai, MH 400001')
  assert.equal(utils.formatAddress({ city: 'Mumbai' }), '')
})

test('WhatsApp errors are explained in words the store can act on', () => {
  assert.match(utils.describeWhatsAppError({ code: 131047, message: 'Re-engagement message' }), /24 hours/)
  assert.match(utils.describeWhatsAppError({ code: 131026 }), /cannot receive/)
  assert.match(utils.describeWhatsAppError({ code: 190, message: 'Error validating access token' }), /Reconnect WhatsApp/)
  assert.equal(utils.describeWhatsAppError({ code: 100, message: 'Invalid parameter', error_data: { details: 'Product not found in catalog' } }), 'Product not found in catalog')
  assert.equal(utils.describeWhatsAppError(null, 'Fallback'), 'Fallback')
})

test('Catalog sync: Meta items become product rows', () => {
  const meta = require('../lib/commerce/meta-commerce.ts')
  assert.equal(meta.parseMetaPrice('₹1,299.00'), 1299)
  assert.equal(meta.parseMetaPrice('INR 500'), 500)
  assert.equal(meta.parseMetaPrice(749.5), 749.5)
  assert.equal(meta.parseMetaPrice(''), 0)
  assert.equal(meta.parseMetaPrice(null), 0)

  const row = meta.toCatalogProductRow({ id: '1', retailer_id: 'SKU-9', name: 'Kurta', price: '₹1,299.00', sale_price: '₹999.00', currency: 'inr', availability: 'in stock', inventory: 7, image_url: 'https://x/y.jpg', url: 'https://shop/kurta' })
  const { metadata, ...columns } = row
  assert.deepEqual(columns, { retailer_id: 'SKU-9', title: 'Kurta', description: '', price: 999, currency: 'INR', image_url: 'https://x/y.jpg', website_url: 'https://shop/kurta', is_available: true, inventory_count: 7 })
  assert.equal(metadata.source, 'meta')
  // No sale: the regular price. Not purchasable: marked unavailable.
  assert.equal(meta.toCatalogProductRow({ retailer_id: 'A', price: '₹500.00', sale_price: '₹0.00' }).price, 500)
  assert.equal(meta.toCatalogProductRow({ retailer_id: 'A', availability: 'out of stock' }).is_available, false)
  assert.equal(meta.toCatalogProductRow({ retailer_id: 'A', availability: 'available for order' }).is_available, true)
  assert.equal(meta.toCatalogProductRow({}), null)
})

// In-memory Supabase adapter: every filter is applied, so tenant scoping is really exercised.
// `options` plays the database as production may have it: columns a migration has not added yet
// (PostgREST answers PGRST204), unique indexes (23505) and inserts that fail outright.
function commerceDb(seed = {}, options = {}) {
  const tables = { commerce_orders: [], commerce_order_items: [], commerce_products: [], commerce_transactions: [], messages: [], contacts: [], conversations: [], campaigns: [], campaign_logs: [], ...structuredClone(seed) }
  const { missingColumns = {}, uniqueIndexes = {}, failInsert = () => null } = options
  let sequence = 0
  const from = table => {
    if (!tables[table]) tables[table] = []
    let filters = [], op = 'select', values, singular = false, sorts = [], max = Infinity, offset = 0
    const answer = (data, error = null) => Promise.resolve({ data, error })
    const query = {
      select() { return this },
      eq(key, value) { filters.push(row => row[key] === value); return this },
      neq(key, value) { filters.push(row => row[key] !== value); return this },
      in(key, list) { filters.push(row => list.includes(row[key])); return this },
      // `.is(column, null)` and `.not(column, 'is', null)`: the claims the handlers make on a row
      is(key, value) { filters.push(row => (value === null ? row[key] === null || row[key] === undefined : row[key] === value)); return this },
      not(key, operator, value) { filters.push(row => (operator === 'is' && value === null ? row[key] !== null && row[key] !== undefined : row[key] !== value)); return this },
      order(key, sort = {}) { sorts.push([key, sort.ascending === false ? -1 : 1]); return this },
      limit(count) { max = count; return this },
      range(from, to) { offset = from; max = to - from + 1; return this },
      maybeSingle() { singular = true; return this }, single() { singular = true; return this },
      insert(data) { op = 'insert'; values = Array.isArray(data) ? data : [data]; return this },
      upsert(data) { op = 'upsert'; values = Array.isArray(data) ? data : [data]; return this },
      update(data) { op = 'update'; values = data; return this },
      delete() { op = 'delete'; return this },
      then(resolve, reject) {
        const written = op === 'update' ? [values] : op === 'insert' || op === 'upsert' ? values : []
        const unknown = (missingColumns[table] || []).find(column => written.some(value => column in value))
        if (unknown) return answer(null, { code: 'PGRST204', message: `Could not find the '${unknown}' column of '${table}' in the schema cache` }).then(resolve, reject)
        let rows = tables[table].filter(row => filters.every(filter => filter(row)))
        if (op === 'insert' || op === 'upsert') {
          const refused = failInsert(table, values)
          if (refused) return answer(null, refused).then(resolve, reject)
          const key = uniqueIndexes[table]
          if (key && values.some(value => tables[table].some(row => key.every(column => row[column] === value[column])))) {
            return answer(null, { code: '23505', message: `duplicate key value violates unique constraint "uq_${table}"` }).then(resolve, reject)
          }
          // Ids are valid UUIDs because checkout buttons and form tokens carry them
          rows = values.map(value => ({ id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`, created_at: new Date(Date.now() + sequence).toISOString(), ...structuredClone(value) }))
          tables[table].push(...rows)
        } else if (op === 'update') {
          rows.forEach(row => Object.assign(row, structuredClone(values)))
        } else if (op === 'delete') {
          tables[table] = tables[table].filter(row => !rows.includes(row))
        } else {
          for (const [key, direction] of [...sorts].reverse()) rows = [...rows].sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * direction)
          rows = rows.slice(offset, offset + max)
        }
        // Like Supabase: items come back with an order when asked for
        if (table === 'commerce_orders' && op !== 'delete') {
          rows = rows.map(row => ({ ...row, items: tables.commerce_order_items.filter(item => item.order_id === row.id) }))
        }
        return answer(structuredClone(singular ? rows[0] || null : rows)).then(resolve, reject)
      },
    }
    return query
  }
  return { from, get tables() { return tables } }
}

// Capture what would be sent to WhatsApp instead of calling Meta
async function withWhatsApp(run, respond = () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.1' }] }) })) {
  const sent = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    // Catalog lookups are reads; only messages are recorded
    if (!init || !init.body) return { ok: true, status: 200, json: async () => ({ data: [] }) }
    sent.push(JSON.parse(init.body))
    return respond(sent.length, sent[sent.length - 1])
  }
  try { await run(sent) } finally { globalThis.fetch = original }
  return sent
}
const rejected = (code = 131047) => ({ ok: false, status: 400, json: async () => ({ error: { code, message: 'rejected' } }) })

const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const CONTACT_ID = '22222222-2222-4222-8222-222222222222'
const store = (overrides = {}) => ({ id: 'org', currency: 'INR', whatsapp_api_token: 'token', whatsapp_phone_number_id: '111', commerce_enable_cod: true, ...overrides })
const withGateway = (overrides = {}) => store({ commerce_payment_gateway: 'razorpay', commerce_gateway_config_name: 'cfg', ...overrides })
const cart = { catalog_id: 'CAT', product_items: [{ product_retailer_id: 'SKU-1', quantity: '2', item_price: '500', currency: 'INR' }] }
const party = { contact: { id: CONTACT_ID, first_name: 'Asha' }, conversation: { id: 'conversation' }, customerPhone: '+919876543210' }
const openOrder = (overrides = {}) => ({
  id: ORDER_ID, organization_id: 'org', contact_id: CONTACT_ID, conversation_id: 'conversation', order_number: 'ORD-261013-AB12',
  status: 'payment_pending', payment_status: 'pending', subtotal: 1000, shipping_fee: 40, tax_amount: 0, total_amount: 1040, currency: 'INR',
  created_at: '2026-10-13T09:00:00.000Z', ...overrides,
})
const orderLines = [{ id: 'line-1', order_id: ORDER_ID, retailer_id: 'SKU-1', title: 'Shirt', unit_price: 500, quantity: 2 }]
const seeded = (order = {}, extra = {}, options = {}) => commerceDb({ commerce_orders: [openOrder(order)], commerce_order_items: orderLines, contacts: [{ id: CONTACT_ID, organization_id: 'org', phone_number: '+919876543210' }], ...extra }, options)

// ── 1. Cart ─────────────────────────────────────────────────────────────────

test('Commerce webhook: a redelivered cart creates one order and messages the customer once', async () => {
  const database = commerceDb()
  const sent = await withWhatsApp(async () => {
    const first = await handlers.handleInboundCommerceOrder({ organization: store(), ...party, orderPayload: cart, messageId: 'wamid.cart', database })
    const again = await handlers.handleInboundCommerceOrder({ organization: store(), ...party, orderPayload: cart, messageId: 'wamid.cart', database })
    assert.equal(again.duplicate, true)
    assert.equal(again.order.id, first.order.id)
  })
  assert.equal(database.tables.commerce_orders.length, 1)
  assert.equal(database.tables.commerce_order_items.length, 1)
  assert.equal(sent.length, 1)
  assert.match(database.tables.commerce_orders[0].order_number, /^ORD-\d{6}-[A-Z2-9]{4}$/)
})

test('Commerce webhook: two simultaneous deliveries of one cart leave a single order', async () => {
  const database = commerceDb()
  const sent = await withWhatsApp(async () => {
    const results = await Promise.all([
      handlers.handleInboundCommerceOrder({ organization: store(), ...party, orderPayload: cart, messageId: 'wamid.race', database }),
      handlers.handleInboundCommerceOrder({ organization: store(), ...party, orderPayload: cart, messageId: 'wamid.race', database }),
    ])
    assert.equal(results.filter(result => result.duplicate).length, 1)
    assert.equal(results[0].order.id, results[1].order.id)
  })
  assert.equal(database.tables.commerce_orders.length, 1)
  assert.equal(database.tables.commerce_order_items.length, 1)
  assert.equal(sent.length, 1)
})

test('Commerce webhook: the free-shipping threshold saved in settings is applied', async () => {
  const database = commerceDb()
  await withWhatsApp(async () => {
    await handlers.handleInboundCommerceOrder({ organization: store({ commerce_default_shipping_fee: 80, commerce_free_shipping_threshold: 900 }), ...party, orderPayload: cart, messageId: 'a', database })
    await handlers.handleInboundCommerceOrder({ organization: store({ commerce_default_shipping_fee: 80, commerce_free_shipping_threshold: 5000 }), ...party, orderPayload: cart, messageId: 'b', database })
  })
  assert.deepEqual(database.tables.commerce_orders.map(order => [order.shipping_fee, order.total_amount]), [[0, 1000], [80, 1080]])
})

test('Commerce webhook: every order gets a next step, chosen from what the store has set up', async () => {
  const stepFor = async organization => {
    const database = commerceDb()
    let step
    const sent = await withWhatsApp(async () => {
      step = (await handlers.handleInboundCommerceOrder({ organization, ...party, orderPayload: cart, messageId: 'm', database })).step
    })
    return { step, message: sent[0], order: database.tables.commerce_orders[0], logged: database.tables.messages.length }
  }

  const address = await stepFor(withGateway({ commerce_address_flow_id: '999' }))
  assert.deepEqual([address.step, address.message.interactive.type, address.order.status], ['address', 'flow', 'awaiting_address'])
  assert.equal(address.message.interactive.action.parameters.flow_token, `order_${address.order.id}`)
  assert.equal(address.message.interactive.action.parameters.flow_action_payload.data, undefined)

  // Online payment and Cash on Delivery are both offered: the customer chooses
  const choice = await stepFor(withGateway())
  assert.deepEqual([choice.step, choice.message.interactive.type, choice.order.status], ['choice', 'button', 'payment_pending'])
  assert.deepEqual(choice.message.interactive.action.buttons.map(b => b.reply.id), [`pay_online_${choice.order.id}`, `cod_confirm_${choice.order.id}`])
  assert.equal(choice.order.meta_payment_reference, undefined) // nothing requested yet

  // Online payment only: the request goes straight out, under the order number
  const payment = await stepFor(withGateway({ commerce_enable_cod: false }))
  assert.deepEqual([payment.step, payment.message.interactive.type, payment.order.status], ['payment', 'order_details', 'payment_pending'])
  const parameters = payment.message.interactive.action.parameters
  assert.equal(parameters.reference_id, payment.order.order_number)
  assert.ok(parameters.reference_id.length <= 35)
  assert.equal(parameters.total_amount.value, 100000)
  assert.deepEqual([parameters.order.items[0].amount.value, parameters.order.items[0].quantity], [50000, 2])
  assert.equal(payment.order.meta_payment_reference, payment.order.order_number)

  // An unsupported gateway value ("link") must not be sent to Meta; Cash on Delivery is offered instead
  const cod = await stepFor(store({ commerce_gateway_config_name: 'cfg', commerce_payment_gateway: 'link' }))
  assert.deepEqual([cod.step, cod.message.interactive.type], ['cod', 'button'])
  assert.deepEqual(cod.message.interactive.action.buttons.map(b => b.reply.id), [`cod_confirm_${cod.order.id}`])

  // Nothing configured at all: the customer still hears back
  const acknowledged = await stepFor(store({ commerce_enable_cod: false }))
  assert.deepEqual([acknowledged.step, acknowledged.message.type, acknowledged.logged], ['acknowledged', 'text', 1])
  assert.match(acknowledged.message.text.body, /ORD-/)
})

test('Commerce webhook: when a step cannot be sent, the next one is tried', async () => {
  // The payment request is refused (say, a wrong gateway name): fall back to Cash on Delivery
  const database = commerceDb()
  let step
  const sent = await withWhatsApp(async () => {
    step = (await handlers.handleInboundCommerceOrder({ organization: withGateway({ commerce_address_flow_id: '999' }), ...party, orderPayload: cart, messageId: 'm', database })).step
  }, (count, message) => (message.interactive?.type === 'button' && message.interactive.action.buttons.length === 1 ? { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.ok' }] }) } : rejected(131009)))
  assert.equal(step, 'cod')
  assert.deepEqual(sent.map(message => message.interactive?.type), ['flow', 'button', 'order_details', 'button'])
  // Only the message that went out is in the chat, plus a note for the team on why the customer
  // was not asked to pay online
  assert.deepEqual(database.tables.messages.map(message => message.body.replace(/\(.*\)/, '')), [
    `[Sent Cash on Delivery confirmation for Order #${database.tables.commerce_orders[0].order_number} ]`,
    `[Online payment for Order #${database.tables.commerce_orders[0].order_number} could not be started: rejected]`,
  ])
  assert.ok(!database.tables.commerce_orders[0].meta_payment_reference) // the refused request is not remembered
  assert.equal(database.tables.commerce_orders[0].status, 'payment_pending')
})

test('Commerce webhook: a message Meta rejects is not logged as sent', async () => {
  const database = commerceDb()
  let step
  await withWhatsApp(async () => {
    step = (await handlers.handleInboundCommerceOrder({ organization: store({ commerce_enable_cod: false }), ...party, orderPayload: cart, messageId: 'm', database })).step
  }, () => rejected())
  assert.equal(step, 'not_sent')
  // Nothing was sent, so the chat gets one "Not delivered" note with the reason, not a sent message
  assert.equal(database.tables.messages.length, 1)
  assert.equal(database.tables.messages[0].status, 'failed')
  assert.match(database.tables.messages[0].body, /could not be sent/)
  assert.ok(database.tables.messages[0].error_message)
  assert.equal(database.tables.commerce_orders.length, 1) // the order itself is still recorded
})

test('Commerce webhook: a cart of products not yet synced keeps working', async () => {
  const database = commerceDb({ commerce_products: [{ id: 'p1', organization_id: 'org', retailer_id: 'SKU-1', title: 'Linen Shirt', price: 450, image_url: 'https://x/shirt.jpg' }] })
  await withWhatsApp(async () => {
    await handlers.handleInboundCommerceOrder({
      organization: store(), ...party, messageId: 'm', database,
      orderPayload: { catalog_id: 'CAT', product_items: [
        { product_retailer_id: 'SKU-1', quantity: 1, item_price: 0 },      // no price in the cart: the catalog price is used
        { product_retailer_id: 'SKU-NEW', quantity: 3, item_price: 100 },  // unknown product: still ordered
      ] },
    })
  })
  const lines = database.tables.commerce_order_items
  assert.deepEqual(lines.map(line => [line.title, line.unit_price, line.quantity, line.total_price]), [['Linen Shirt', 450, 1, 450], ['Item #SKU-NEW', 100, 3, 300]])
  assert.equal(lines[0].image_url, 'https://x/shirt.jpg')
  assert.equal(database.tables.commerce_orders[0].total_amount, 750)
  assert.equal(await handlers.handleInboundCommerceOrder({ organization: store(), ...party, orderPayload: { product_items: [] }, database }), null)
})

// ── 2. Address ──────────────────────────────────────────────────────────────

const address = (overrides = {}) => ({ full_name: 'Asha Rao', address_line_1: '  1  MG Road ', city: 'Mumbai', state: 'MH', pincode: '400001', delivery_speed: 'standard', ...overrides })
const submitAddress = (database, data, options = {}) => handlers.handleInboundAddressSubmission({ organization: store(), ...party, submissionData: data, database, ...options })

test('Commerce address: the form token names the order, and only the customer\'s own', async () => {
  const database = seeded({ status: 'awaiting_address' }, {
    commerce_orders: [
      openOrder({ status: 'awaiting_address' }),
      openOrder({ id: '33333333-3333-4333-8333-333333333333', order_number: 'ORD-NEWER', status: 'awaiting_address', created_at: '2026-10-13T10:00:00.000Z' }),
      openOrder({ id: '44444444-4444-4444-8444-444444444444', order_number: 'ORD-OTHER', contact_id: 'someone-else', status: 'awaiting_address' }),
    ],
  })
  await withWhatsApp(async () => {
    // WhatsApp returns the token inside the submitted data
    const saved = await submitAddress(database, address({ flow_token: `order_${ORDER_ID}` }))
    assert.equal(saved.id, ORDER_ID)
    // Another customer's order can never be addressed, whatever the token says
    assert.equal(await submitAddress(database, address({ flow_token: 'order_44444444-4444-4444-8444-444444444444' })), null)
    // A token that is not an order id falls back to this customer's newest order awaiting an address
    const fallback = await submitAddress(database, address({ flow_token: 'something-else' }))
    assert.equal(fallback.order_number, 'ORD-NEWER')
  })
  const [first, newer, other] = database.tables.commerce_orders
  assert.deepEqual([first.status, first.shipping_address.address_line_1, first.shipping_address.city], ['payment_pending', '1 MG Road', 'Mumbai'])
  assert.equal(newer.status, 'payment_pending')
  assert.equal(other.shipping_address, undefined)
})

test('Commerce address: a form that is not a delivery address is left for other handlers', async () => {
  const database = seeded({ status: 'awaiting_address' })
  const sent = await withWhatsApp(async () => {
    // A lead form that happens to ask for a PIN code
    assert.equal(await submitAddress(database, { name: 'Asha', pincode: '400001' }), null)
    // An address, but this customer has no order waiting for one
    assert.equal(await submitAddress(commerceDb(), address()), null)
  })
  assert.equal(sent.length, 0)
  assert.equal(database.tables.commerce_orders[0].status, 'awaiting_address')
})

test('Commerce address: resubmitting never stacks the express charge or reopens a paid order', async () => {
  const database = seeded({ status: 'awaiting_address' })
  const submit = (speed, organization = store()) => handlers.handleInboundAddressSubmission({ organization, ...party, flowToken: `order_${ORDER_ID}`, submissionData: address({ delivery_speed: speed }), database })
  const amounts = () => [database.tables.commerce_orders[0].shipping_fee, database.tables.commerce_orders[0].total_amount]

  const sent = await withWhatsApp(async () => {
    await submit('express')
    await submit('express')
    assert.deepEqual(amounts(), [90, 1090])
    await submit('standard')
    assert.deepEqual(amounts(), [40, 1040])
    // The store changes its express charge between two submissions: the old one is taken off first
    await submit('express', store({ commerce_express_fee: 120 }))
    assert.deepEqual(amounts(), [160, 1160])
    await submit('express', store({ commerce_express_fee: 0 }))
    assert.deepEqual(amounts(), [40, 1040])
  })
  assert.match(sent[0].interactive.body.text, /Express delivery adds ₹\s?50/)

  // A paid order keeps its status and its totals: the address is corrected (see below), nothing else
  const paid = seeded({ status: 'paid', payment_status: 'paid' })
  const afterPaid = await withWhatsApp(async () => {
    await handlers.handleInboundAddressSubmission({ organization: store(), ...party, flowToken: `order_${ORDER_ID}`, submissionData: address({ delivery_speed: 'express' }), database: paid })
  })
  assert.deepEqual([paid.tables.commerce_orders[0].status, paid.tables.commerce_orders[0].payment_status, paid.tables.commerce_orders[0].shipping_fee, paid.tables.commerce_orders[0].total_amount], ['paid', 'paid', 40, 1040])
  assert.deepEqual(afterPaid.map(message => message.type), ['text']) // a confirmation, never a payment request
  assert.match(afterPaid[0].text.body, /keeps standard delivery/)
})

test('Commerce address: a corrected address on a paid or confirmed order counts until it ships; after that the team is asked', async () => {
  const onFile = { full_name: 'Asha Rao', address_line_1: '1 MG Road', city: 'Mumbai', state: 'MH', pincode: '400001', delivery_speed: 'express', express_fee: 50, notes: 'Ring twice' }
  const correction = address({ address_line_1: '2 Park Street', pincode: '400002', delivery_speed: 'standard', instructions: '' })
  const submit = database => handlers.handleInboundAddressSubmission({ organization: store(), ...party, flowToken: `order_${ORDER_ID}`, submissionData: correction, database })

  for (const state of [{ status: 'paid', payment_status: 'paid' }, { status: 'cod_confirmed', payment_method: 'cod' }]) {
    const database = seeded({ ...state, shipping_address: onFile, shipping_fee: 90, total_amount: 1090 })
    const sent = await withWhatsApp(async () => { assert.equal((await submit(database)).shipping_address.address_line_1, '2 Park Street') })
    const order = database.tables.commerce_orders[0]
    // The new address is on the order; the status, the totals and the paid-for delivery option are not touched
    assert.deepEqual([order.status, order.payment_status, order.shipping_fee, order.total_amount], [state.status, state.payment_status || 'pending', 90, 1090])
    assert.deepEqual([order.shipping_address.address_line_1, order.shipping_address.pincode, order.shipping_address.delivery_speed, order.shipping_address.express_fee, order.shipping_address.notes], ['2 Park Street', '400002', 'express', 50, 'Ring twice'])
    assert.equal(sent.length, 1)
    assert.match(sent[0].text.body, /delivery address for order #ORD-261013-AB12 is updated: 2 Park Street, Mumbai, MH 400002/)
    assert.deepEqual(bodies(database), ['[Delivery address updated for Order #ORD-261013-AB12]'])
  }

  // Too late: the parcel has left (or the order is gone). The customer is told, nothing changes.
  for (const status of ['shipped', 'delivered', 'canceled']) {
    const database = seeded({ status, payment_status: 'paid', shipping_address: onFile })
    const sent = await withWhatsApp(async () => { assert.equal((await submit(database)).id, ORDER_ID) })
    assert.equal(database.tables.commerce_orders[0].shipping_address.address_line_1, '1 MG Road')
    assert.equal(sent.length, 1)
    assert.match(sent[0].text.body, status === 'canceled' ? /#ORD-261013-AB12 was canceled; reply here and our team will help/ : /#ORD-261013-AB12 has already been shipped; reply here and our team will help/)
    assert.deepEqual(bodies(database), [`[Told customer Order #ORD-261013-AB12 is already ${status}; the new address was not applied]`])
  }
})

// ── 3. Checkout buttons ─────────────────────────────────────────────────────

const tap = (database, buttonId, organization = withGateway(), who = party) => handlers.handleCheckoutButton({ organization, ...who, buttonId, database })

test('Checkout buttons: Cash on Delivery confirms the order once and tells the customer', async () => {
  const database = seeded({ shipping_address: { address_line_1: '1 MG Road', city: 'Mumbai', pincode: '400001' } })
  const sent = await withWhatsApp(async () => {
    const first = await tap(database, `cod_confirm_${ORDER_ID}`)
    assert.deepEqual([first.handled, first.outcome], [true, 'cod_confirmed'])
    // The old button is tapped again
    const again = await tap(database, `cod_confirm_${ORDER_ID}`)
    assert.deepEqual([again.handled, again.outcome], [true, 'already_done'])
  })
  const order = database.tables.commerce_orders[0]
  assert.deepEqual([order.status, order.payment_method, order.payment_status], ['cod_confirmed', 'cod', 'pending'])
  assert.match(sent[0].text.body, /ORD-261013-AB12 is confirmed for Cash on Delivery/)
  assert.match(sent[0].text.body, /₹\s?1,040/)
  assert.match(sent[0].text.body, /1 MG Road, Mumbai/)
  assert.match(sent[1].text.body, /already cod confirmed/i)
  assert.equal(database.tables.messages.length, 2) // both replies are in the chat
})

// The last payment request went out a while ago: a new tap gets a new card (see RECENT_PAYMENT_REQUEST_MS)
function ageLastRequest(database) {
  const order = database.tables.commerce_orders[0]
  const earlier = new Date(Date.now() - handlers.RECENT_PAYMENT_REQUEST_MS - 60_000).toISOString()
  order.updated_at = earlier
  for (const request of order.payment_requests || []) request.requested_at = earlier
}

test('Checkout buttons: Pay online sends a payment request under a fresh reference each time, withdrawing the last one', async () => {
  const database = seeded()
  const sent = await withWhatsApp(async () => {
    assert.equal((await tap(database, `pay_online_${ORDER_ID}`)).outcome, 'payment_requested')
    // Tapped again moments later: the card is still fresh in the chat, so nothing is sent twice
    assert.equal((await tap(database, `pay_online_${ORDER_ID}`)).outcome, 'already_requested')
    ageLastRequest(database)
    assert.equal((await tap(database, `pay_online_${ORDER_ID}`)).outcome, 'payment_requested')
  })
  // The first card is withdrawn before the second request goes out, so only one card can be paid
  assert.deepEqual(sent.map(message => [message.interactive.type, message.interactive.action.parameters.reference_id]), [['order_details', 'ORD-261013-AB12'], ['order_status', 'ORD-261013-AB12'], ['order_details', 'ORD-261013-AB12.2']])
  assert.equal(sent[1].interactive.action.parameters.order.status, 'canceled')
  assert.match(sent[1].interactive.body.text, /replaced by a new one/)
  assert.equal(sent[0].interactive.action.parameters.total_amount.value, 104000)
  const order = database.tables.commerce_orders[0]
  assert.equal(order.meta_payment_reference, 'ORD-261013-AB12.2')
  assert.equal(order.status, 'payment_pending')
  // Every request is remembered with what it asked for; the withdrawn one says so
  assert.deepEqual(order.payment_requests.map(request => [request.reference, request.amount, request.currency, Boolean(request.voided_at)]), [['ORD-261013-AB12', 1040, 'INR', true], ['ORD-261013-AB12.2', 1040, 'INR', false]])
  assert.ok(order.payment_requests.every(request => Number.isFinite(Date.parse(request.requested_at))))
  // The requests are noted in the chat; the withdrawal is not a message to the customer
  assert.equal(database.tables.messages.length, 2)
  assert.ok(database.tables.messages.every(message => /^\[Sent payment request for Order #ORD-261013-AB12 \(₹\s?1,040\)\]$/.test(message.body)))
})

test('Checkout buttons: without the payment_requests column the latest reference is still kept', async () => {
  const database = seeded({}, {}, { missingColumns: { commerce_orders: ['payment_requests'] } })
  const sent = await withWhatsApp(async () => {
    await tap(database, `pay_online_${ORDER_ID}`)
    // Without the column, when the request went out is read from the order's own timestamp
    assert.equal((await tap(database, `pay_online_${ORDER_ID}`)).outcome, 'already_requested')
    ageLastRequest(database)
    await tap(database, `pay_online_${ORDER_ID}`)
  })
  assert.deepEqual(sent.map(message => message.interactive.type), ['order_details', 'order_status', 'order_details'])
  assert.equal(database.tables.commerce_orders[0].meta_payment_reference, 'ORD-261013-AB12.2')
  assert.equal(database.tables.commerce_orders[0].payment_requests, undefined)
})

test('Checkout buttons: the same Pay online tap delivered twice at once sends one payment request', async () => {
  const database = seeded()
  const sent = await withWhatsApp(async () => {
    const results = await Promise.all([tap(database, `pay_online_${ORDER_ID}`), tap(database, `pay_online_${ORDER_ID}`)])
    // One delivery claims the reference and sends; the other says nothing at all
    assert.deepEqual(results.map(result => result.outcome).sort(), ['already_requested', 'payment_requested'])
  })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].interactive.type, 'order_details')
  const order = database.tables.commerce_orders[0]
  assert.equal(order.meta_payment_reference, 'ORD-261013-AB12')
  assert.deepEqual(order.payment_requests.map(request => request.reference), ['ORD-261013-AB12'])
  assert.equal(database.tables.messages.length, 1)
})

test('Checkout buttons: choosing Cash on Delivery withdraws the live payment request; a payment that still arrives is noted', async () => {
  const database = seeded(requestedOrder({ shipping_address: { address_line_1: '1 MG Road', city: 'Mumbai' } }))
  const sent = await withWhatsApp(async () => {
    assert.equal((await tap(database, `cod_confirm_${ORDER_ID}`)).outcome, 'cod_confirmed')
  })
  // The "Review and pay" card is withdrawn before the confirmation, so the customer cannot pay twice
  assert.deepEqual(sent.map(message => (message.type === 'text' ? 'text' : [message.interactive.type, message.interactive.action.parameters.order.status])), [['order_status', 'canceled'], 'text'])
  assert.deepEqual([sent[0].interactive.action.parameters.reference_id, sent[0].interactive.body.text], ['ORD-261013-AB12', 'Online payment withdrawn: your order #ORD-261013-AB12 is confirmed for Cash on Delivery.'])
  const order = () => database.tables.commerce_orders[0]
  assert.deepEqual([order().status, order().payment_method, order().payment_status], ['cod_confirmed', 'cod', 'pending'])
  assert.ok(order().payment_requests[0].voided_at)

  // The card reached the customer before the withdrawal and they paid it anyway: paid online, and
  // the team must not collect cash on top
  const paid = await withWhatsApp(async () => { await pay(database, captured()) })
  assert.deepEqual([order().status, order().payment_status, order().payment_method], ['cod_confirmed', 'paid', 'whatsapp_pay'])
  assert.match(order().customer_note, /Paid online after Cash on Delivery was chosen; do not collect cash\./)
  assert.ok(bodies(database).includes('[Paid online after Cash on Delivery was chosen; do not collect cash]'))
  assert.equal(paid[0].interactive.type, 'order_status')
  assert.match(paid[0].interactive.body.text, /Nothing is due on delivery any more/)
})

test('Checkout buttons: a request that cannot be sent is not left in silence', async () => {
  const database = seeded()
  const sent = await withWhatsApp(async () => {
    assert.equal((await tap(database, `pay_online_${ORDER_ID}`)).outcome, 'failed')
  }, (count) => (count === 1 ? rejected(131009) : { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.2' }] }) }))
  assert.equal(sent[1].type, 'text')
  assert.match(sent[1].text.body, /could not start the online payment/)
  // The reference claimed for the refused request is given back, so the next tap is not held off
  assert.ok(!database.tables.commerce_orders[0].meta_payment_reference)
  assert.equal((await withWhatsApp(async () => { assert.equal((await tap(database, `pay_online_${ORDER_ID}`)).outcome, 'payment_requested') })).length, 1)
})

test('Checkout buttons: old buttons cannot reopen, hijack or resurrect an order', async () => {
  for (const [state, outcome, wording] of [
    [{ status: 'canceled' }, 'canceled', /was canceled/],
    [{ status: 'shipped', payment_status: 'paid' }, 'already_done', /already shipped/],
    [{ status: 'paid', payment_status: 'paid' }, 'already_done', /already paid/],
  ]) {
    const database = seeded(state)
    const sent = await withWhatsApp(async () => {
      assert.equal((await tap(database, `cod_confirm_${ORDER_ID}`)).outcome, outcome)
      assert.equal((await tap(database, `pay_online_${ORDER_ID}`)).outcome, outcome)
    })
    assert.equal(database.tables.commerce_orders[0].status, state.status)
    assert.match(sent[0].text.body, wording)
    assert.ok(sent.every(message => message.type === 'text')) // never a new payment request
  }

  // Someone else's order, another store's order, and ids that are not ids
  const database = seeded()
  const sent = await withWhatsApp(async () => {
    assert.equal((await tap(database, `cod_confirm_${ORDER_ID}`, withGateway(), { ...party, contact: { id: 'another-contact' } })).outcome, 'not_found')
    assert.equal((await tap(database, `cod_confirm_${ORDER_ID}`, withGateway({ id: 'another-store' }))).outcome, 'not_found')
    assert.equal((await tap(database, 'cod_confirm_not-an-id')).outcome, 'not_found')
    // Buttons that belong to something else are passed on
    assert.deepEqual(await tap(database, 'menu_support'), { handled: false })
    assert.deepEqual(await tap(database, undefined), { handled: false })
  })
  assert.equal(sent.length, 0)
  assert.equal(database.tables.commerce_orders[0].status, 'payment_pending')
})

test('Checkout buttons: Cash on Delivery that was switched off offers payment instead', async () => {
  const database = seeded()
  const sent = await withWhatsApp(async () => {
    assert.equal((await tap(database, `cod_confirm_${ORDER_ID}`, withGateway({ commerce_enable_cod: false }))).outcome, 'unavailable')
  })
  assert.equal(database.tables.commerce_orders[0].status, 'payment_pending')
  assert.equal(sent[0].interactive.type, 'order_details')
})

// ── 4. Payment ──────────────────────────────────────────────────────────────

// Payment results as Meta really sends them: a webhook status of type "payment"
const metaPaymentStatus = (status, transactionStatus = 'success', reference = 'ORD-261013-AB12', { amount = 104000, transactionId = 'pay_ABC123', id = 'wamid.payment' } = {}) => ({
  id,
  recipient_id: '919876543210',
  type: 'payment',
  status,
  payment: {
    reference_id: reference,
    amount: { value: amount, offset: 100 },
    currency: 'INR',
    transaction: { id: transactionId, pg_transaction_id: 'pg_1', type: 'razorpay', status: transactionStatus },
  },
  timestamp: '1760000000',
})
const pay = (database, payload, organization = store()) => handlers.handleInboundPaymentConfirmation({ organization, paymentPayload: payload, database })

test('Commerce payments: only an explicit success is read as paid', () => {
  const read = payload => handlers.normalizePaymentUpdate(payload)
  assert.deepEqual(read(metaPaymentStatus('captured')), { referenceId: 'ORD-261013-AB12', outcome: 'paid', transactionId: 'pay_ABC123', amount: 1040, currency: 'INR', eventId: 'wamid.payment' })
  assert.equal(read(metaPaymentStatus('pending', 'pending')).outcome, 'pending')
  assert.equal(read(metaPaymentStatus('pending', 'failed')).outcome, 'failed')
  // A failed transaction wins even if the outer status were to say captured
  assert.equal(read(metaPaymentStatus('captured', 'failed')).outcome, 'failed')
  // No status, or one we do not recognise, is never treated as money received
  assert.equal(read({ reference_id: 'ORD-1' }).outcome, 'pending')
  assert.equal(read({ reference_id: 'ORD-1', status: 'something_new' }).outcome, 'pending')
  assert.equal(read({ status: 'captured' }), null)
  assert.equal(read(null), null)
})

test('Commerce payments: a captured status marks the order paid and sends one receipt and a thank-you', async () => {
  const database = seeded({ meta_payment_reference: 'ORD-261013-AB12', conversation_id: 'conversation-9' })

  // The status webhook carries no conversation: the order's own conversation and phone are used
  const sent = await withWhatsApp(async () => {
    await pay(database, metaPaymentStatus('captured'))
    await pay(database, metaPaymentStatus('captured')) // Meta redelivery
  })

  const saved = database.tables.commerce_orders[0]
  assert.deepEqual([saved.status, saved.payment_status, saved.payment_method], ['paid', 'paid', 'whatsapp_pay'])
  // The reference stays the payment request's: later order updates are sent against it
  assert.equal(saved.meta_payment_reference, 'ORD-261013-AB12')
  assert.equal(database.tables.commerce_transactions.length, 1)
  assert.deepEqual([database.tables.commerce_transactions[0].amount, database.tables.commerce_transactions[0].transaction_id], [1040, 'pay_ABC123'])
  // Once only, despite the redelivery: the receipt card, then the thank-you
  assert.equal(sent.length, 2)
  assert.equal(sent[0].interactive.type, 'order_status')
  assert.equal(sent[0].interactive.action.parameters.reference_id, 'ORD-261013-AB12')
  assert.equal(sent[0].to, '919876543210')
  assert.equal(sent[1].type, 'text')
  assert.equal(sent[1].to, '919876543210')
  assert.match(sent[1].text.body, /^🎉 Thank you.*payment is successful and order #\S+ is confirmed/)
  assert.match(sent[1].text.body, /message you here when it ships/)
  assert.equal(database.tables.messages[0].conversation_id, 'conversation-9')
  assert.equal(database.tables.messages[1].body, sent[1].text.body)
})

test('Commerce payments: the order is found by any reference it was requested under', async () => {
  // The second request is the current one, but the customer paid the first card
  const earlier = seeded({ meta_payment_reference: 'ORD-261013-AB12.2' })
  await withWhatsApp(async () => { await pay(earlier, metaPaymentStatus('captured', 'success', 'ORD-261013-AB12')) })
  assert.equal(earlier.tables.commerce_orders[0].payment_status, 'paid')

  const current = seeded({ meta_payment_reference: 'ORD-261013-AB12.2' })
  const sent = await withWhatsApp(async () => { await pay(current, metaPaymentStatus('captured', 'success', 'ORD-261013-AB12.2')) })
  assert.equal(current.tables.commerce_orders[0].payment_status, 'paid')
  assert.equal(sent[0].interactive.action.parameters.reference_id, 'ORD-261013-AB12.2')

  // A request sent before order numbers were used carried the order's id
  const legacy = seeded()
  await withWhatsApp(async () => { await pay(legacy, metaPaymentStatus('captured', 'success', ORDER_ID)) })
  assert.equal(legacy.tables.commerce_orders[0].payment_status, 'paid')

  // Another store's reference, or one that matches nothing, changes no order. The money still goes
  // into the ledger of the store that received it, without an order, so it can be traced.
  const untouched = seeded({ meta_payment_reference: 'ORD-261013-AB12' })
  const nothingSent = await withWhatsApp(async () => {
    assert.equal(await pay(untouched, metaPaymentStatus('captured'), store({ id: 'someone-else' })), null)
    assert.equal(await pay(untouched, metaPaymentStatus('captured', 'success', 'ORD-999999-ZZZZ')), null)
    assert.equal(await pay(untouched, metaPaymentStatus('captured', 'success', 'ORD-999999-ZZZZ')), null) // redelivered
  })
  assert.equal(untouched.tables.commerce_orders[0].payment_status, 'pending')
  assert.deepEqual(
    untouched.tables.commerce_transactions.map(row => [row.organization_id, row.order_id, row.status, row.amount, row.transaction_id]),
    [['someone-else', null, 'unmatched', 1040, 'pay_ABC123'], ['org', null, 'unmatched', 1040, 'pay_ABC123']]
  )
  assert.equal(nothingSent.length, 0)
})

test('Commerce payments: pending never marks an order paid; a failure is recorded and explained once', async () => {
  for (const payload of [metaPaymentStatus('pending', 'pending'), { reference_id: 'ORD-261013-AB12' }]) {
    const database = seeded()
    const sent = await withWhatsApp(async () => { await pay(database, payload) })
    assert.deepEqual([database.tables.commerce_orders[0].status, database.tables.commerce_orders[0].payment_status], ['payment_pending', 'pending'])
    assert.equal(database.tables.commerce_transactions.length, 0)
    assert.equal(sent.length, 0)
  }

  const failed = seeded()
  const sent = await withWhatsApp(async () => {
    await pay(failed, metaPaymentStatus('pending', 'failed'))
    await pay(failed, metaPaymentStatus('pending', 'failed')) // redelivered
  })
  assert.deepEqual([failed.tables.commerce_orders[0].status, failed.tables.commerce_orders[0].payment_status], ['payment_pending', 'failed'])
  assert.equal(failed.tables.commerce_transactions.length, 0)
  assert.equal(sent.length, 1)
  assert.match(sent[0].text.body, /did not go through/)

  // A failed attempt can still be followed by a successful one
  await withWhatsApp(async () => { await pay(failed, metaPaymentStatus('captured')) })
  assert.deepEqual([failed.tables.commerce_orders[0].status, failed.tables.commerce_orders[0].payment_status], ['paid', 'paid'])
})

test('Commerce payments: money for a canceled or already confirmed order is recorded without changing its status', async () => {
  const canceled = seeded({ status: 'canceled' })
  const sent = await withWhatsApp(async () => { await pay(canceled, metaPaymentStatus('captured')) })
  const order = canceled.tables.commerce_orders[0]
  assert.deepEqual([order.status, order.payment_status], ['canceled', 'paid'])
  assert.equal(utils.needsRefund(order), true)
  assert.equal(canceled.tables.commerce_transactions.length, 1)
  assert.match(JSON.stringify(sent[0]), /refund/)

  // Confirmed for Cash on Delivery, then paid online after all
  const cod = seeded({ status: 'cod_confirmed', payment_method: 'cod' })
  await withWhatsApp(async () => { await pay(cod, metaPaymentStatus('captured')) })
  assert.deepEqual([cod.tables.commerce_orders[0].status, cod.tables.commerce_orders[0].payment_status, cod.tables.commerce_orders[0].payment_method], ['cod_confirmed', 'paid', 'whatsapp_pay'])
})

test('Commerce payments: the gateway list matches what Meta accepts', () => {
  assert.deepEqual([...utils.SUPPORTED_PAYMENT_GATEWAYS].sort(), ['billdesk', 'payu', 'razorpay', 'zaakpay'])
  assert.equal(utils.getPaymentGateway({ commerce_payment_gateway: 'cashfree', commerce_gateway_config_name: 'cfg' }), null)
})

// ── 5. From the dashboard ───────────────────────────────────────────────────

test('Dashboard reminder: the customer is sent the step the order is waiting on', async () => {
  const remind = (database, organization) => handlers.resendCheckoutStep({ organization, order: database.tables.commerce_orders[0], database })

  const needsAddress = seeded({ status: 'awaiting_address' })
  const first = await withWhatsApp(async () => { assert.equal((await remind(needsAddress, withGateway({ commerce_address_flow_id: '999' }))).step, 'address') })
  assert.equal(first[0].interactive.type, 'flow')
  assert.match(first[0].interactive.body.text, /reminder about your order #ORD-261013-AB12/)

  // The address is on file and a payment request was already sent: that card is withdrawn and a
  // new one goes out, under a new reference
  const needsPayment = seeded({ shipping_address: { address_line_1: '1 MG Road' }, meta_payment_reference: 'ORD-261013-AB12' })
  const second = await withWhatsApp(async () => { assert.equal((await remind(needsPayment, withGateway({ commerce_address_flow_id: '999', commerce_enable_cod: false }))).step, 'payment') })
  assert.deepEqual(second.map(message => [message.interactive.type, message.interactive.action.parameters.reference_id]), [['order_status', 'ORD-261013-AB12'], ['order_details', 'ORD-261013-AB12.2']])
  assert.equal(needsPayment.tables.commerce_orders[0].meta_payment_reference, 'ORD-261013-AB12.2')

  // Nothing is sent for an order that is no longer waiting on the customer
  for (const state of [{ status: 'paid', payment_status: 'paid' }, { status: 'shipped' }, { status: 'canceled' }]) {
    const done = seeded(state)
    const sent = await withWhatsApp(async () => { assert.equal((await remind(done, withGateway())).step, 'not_sent') })
    assert.equal(sent.length, 0)
  }

  // WhatsApp refuses (outside the 24-hour window): the reason comes back for the team
  const refused = seeded()
  await withWhatsApp(async () => {
    const result = await remind(refused, store())
    assert.equal(result.step, 'not_sent')
    assert.match(result.error, /24 hours/)
  }, () => rejected(131047))
})

test('Dashboard status updates: the order card when there is one, a message otherwise', async () => {
  const notify = (database, status, text = 'Order update') => handlers.notifyOrderStatus({ organization: store(), order: database.tables.commerce_orders[0], status, text, database })

  // An order that had a payment request: WhatsApp's own order card is updated
  const withRequest = seeded({ status: 'paid', payment_status: 'paid', meta_payment_reference: 'ORD-261013-AB12' })
  const card = await withWhatsApp(async () => { assert.deepEqual(await notify(withRequest, 'shipped', 'Shipped!'), { notified: true, error: null, viaCard: true, viaTemplate: false }) })
  assert.deepEqual([card[0].interactive.type, card[0].interactive.action.parameters.reference_id, card[0].interactive.action.parameters.order.status], ['order_status', 'ORD-261013-AB12', 'shipped'])
  assert.equal(withRequest.tables.messages[0].body, 'Shipped!')

  // A Cash on Delivery order never had one: a normal message
  const cod = seeded({ status: 'cod_confirmed', payment_method: 'cod' })
  const plain = await withWhatsApp(async () => { assert.deepEqual(await notify(cod, 'shipped', 'Shipped!'), { notified: true, error: null, viaCard: false, viaTemplate: false }) })
  assert.deepEqual([plain.length, plain[0].type, plain[0].text.body], [1, 'text', 'Shipped!'])

  // The card was just withdrawn (the order was confirmed for cash from the dashboard): text, not a "processing" card
  const withdrawn = seeded({ status: 'cod_confirmed', payment_method: 'cod', meta_payment_reference: 'ORD-261013-AB12' })
  const afterVoid = await withWhatsApp(async () => { assert.equal((await handlers.notifyOrderStatus({ organization: store(), order: withdrawn.tables.commerce_orders[0], status: 'cod_confirmed', text: 'Confirmed', card: false, database: withdrawn })).viaCard, false) })
  assert.deepEqual(afterVoid.map(message => message.type), ['text'])

  // The card is refused: the customer still gets the text
  const fallback = await withWhatsApp(async () => { assert.equal((await notify(seeded({ meta_payment_reference: 'ORD-261013-AB12' }), 'delivered')).viaCard, false) },
    (count, message) => (message.type === 'interactive' ? rejected(131009) : { ok: true, status: 200, json: async () => ({ messages: [{ id: 'w' }] }) }))
  assert.deepEqual(fallback.map(message => message.type), ['interactive', 'text'])

  // A paid order cannot be canceled through the card (it has to be refunded): text only
  const paidCancel = await withWhatsApp(async () => { await notify(seeded({ status: 'paid', payment_status: 'paid', meta_payment_reference: 'ORD-261013-AB12' }), 'canceled') })
  assert.deepEqual(paidCancel.map(message => message.type), ['text'])

  // Nothing went out (the customer's last message is too old and the store has no order-update
  // template): the chat shows the update as not delivered, and the dashboard is told what to set up
  const silent = seeded()
  await withWhatsApp(async () => {
    const result = await notify(silent, 'shipped')
    assert.equal(result.notified, false)
    assert.equal(result.error, handlers.NO_STATUS_TEMPLATE_ERROR)
    assert.match(result.error, /24 hours/)
  }, () => rejected(131047))
  assert.deepEqual(silent.tables.messages.map(message => [message.body, message.status, message.error_message]), [['Order update', 'failed', handlers.NO_STATUS_TEMPLATE_ERROR]])

  // Refused for another reason: that reason is recorded, and no template is tried
  const refused = seeded()
  const nothing = await withWhatsApp(async () => {
    const result = await notify(refused, 'shipped')
    assert.deepEqual([result.notified, result.viaTemplate], [false, false])
    assert.match(result.error, /cannot receive/)
  }, () => rejected(131026))
  assert.deepEqual(nothing.map(message => message.type), ['text'])
  assert.deepEqual(refused.tables.messages.map(message => message.status), ['failed'])
})

test('Dashboard status updates: after 24 hours the order-update template is sent, or the team is told to set one up', async () => {
  const hoursAgo = hours => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
  const withTemplate = store({ commerce_status_template: { name: 'order_update', language: 'en' } })
  const tracking = { address_line_1: '1 MG Road', carrier: 'Delhivery', tracking_number: 'AWB123', tracking_url: 'https://track.example.com/AWB123' }
  // A Cash on Delivery order (no card), whose customer last wrote `lastInbound`
  const codOrder = lastInbound => seeded(
    { status: 'cod_confirmed', payment_method: 'cod', shipping_address: tracking },
    { messages: [{ id: 'in-1', organization_id: 'org', conversation_id: 'conversation', sender_type: 'contact', body: 'hi', created_at: lastInbound }] }
  )
  const notify = (database, organization, status = 'shipped') => handlers.notifyOrderStatus({ organization, order: database.tables.commerce_orders[0], status, text: 'Shipped!', database })
  const logged = database => database.tables.messages.filter(message => message.sender_type === 'user').map(message => [message.body, message.status, message.error_message ?? null, message.twilio_message_sid ?? null])

  // The customer wrote yesterday: WhatsApp would refuse a text, so the template goes straight out
  // with the order number, the status and the tracking details
  const stale = codOrder(hoursAgo(30))
  const sent = await withWhatsApp(async () => {
    assert.deepEqual(await notify(stale, withTemplate), { notified: true, error: null, viaCard: false, viaTemplate: true })
  })
  assert.equal(sent.length, 1)
  assert.deepEqual([sent[0].type, sent[0].to], ['template', '919876543210'])
  assert.deepEqual(sent[0].template, {
    name: 'order_update',
    language: { code: 'en' },
    components: [{ type: 'body', parameters: [{ type: 'text', text: 'ORD-261013-AB12' }, { type: 'text', text: 'Shipped' }, { type: 'text', text: 'Delhivery · AWB123 · https://track.example.com/AWB123' }] }],
  })
  assert.deepEqual(logged(stale), [['Shipped!', 'sent', null, 'FB_wamid.1']])

  // No tracking yet: the template still has three values ("-" for the tracking)
  const bare = seeded({ status: 'cod_confirmed', payment_method: 'cod' }, { messages: [{ id: 'in-1', organization_id: 'org', conversation_id: 'conversation', sender_type: 'contact', body: 'hi', created_at: hoursAgo(30) }] })
  const dash = await withWhatsApp(async () => { await notify(bare, withTemplate, 'delivered') })
  assert.deepEqual(dash[0].template.components[0].parameters.map(parameter => parameter.text), ['ORD-261013-AB12', 'Delivered', '-'])

  // A template saved with its structure (named variables) is filled by name
  const named = store({ commerce_status_template: { name: 'order_update', language: 'en_US', components: [{ type: 'BODY', text: 'Order {{order_number}} is now {{status}}. Tracking: {{tracking}}', example: { body_text_named_params: [{ param_name: 'order_number' }, { param_name: 'status' }, { param_name: 'tracking' }] } }] } })
  const byName = await withWhatsApp(async () => { await notify(codOrder(hoursAgo(30)), named) })
  assert.equal(byName[0].template.language.code, 'en_US')
  assert.deepEqual(byName[0].template.components[0].parameters, [
    { type: 'text', text: 'ORD-261013-AB12', parameter_name: 'order_number' },
    { type: 'text', text: 'Shipped', parameter_name: 'status' },
    { type: 'text', text: 'Delhivery · AWB123 · https://track.example.com/AWB123', parameter_name: 'tracking' },
  ])

  // The customer wrote an hour ago, so a text is tried first; WhatsApp refuses it all the same
  // (131047): the template is the fallback
  const refusedText = codOrder(hoursAgo(1))
  const fallback = await withWhatsApp(async () => {
    assert.deepEqual(await notify(refusedText, withTemplate), { notified: true, error: null, viaCard: false, viaTemplate: true })
  }, (count, message) => (message.type === 'text' ? rejected(131047) : { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.t' }] }) }))
  assert.deepEqual(fallback.map(message => message.type), ['text', 'template'])
  assert.deepEqual(logged(refusedText), [['Shipped!', 'sent', null, 'FB_wamid.t']])

  // Within the window the text simply goes out; no template needed
  const fresh = codOrder(hoursAgo(1))
  const text = await withWhatsApp(async () => { assert.deepEqual(await notify(fresh, withTemplate), { notified: true, error: null, viaCard: false, viaTemplate: false }) })
  assert.deepEqual(text.map(message => message.type), ['text'])

  // No template set up: nothing goes out, the chat records the update as not delivered with
  // the reason, and the dashboard gets a clear error
  const none = codOrder(hoursAgo(30))
  const nothing = await withWhatsApp(async () => {
    assert.deepEqual(await notify(none, store()), { notified: false, error: handlers.NO_STATUS_TEMPLATE_ERROR, viaCard: false, viaTemplate: false })
  })
  assert.equal(nothing.length, 0)
  assert.deepEqual(logged(none), [['Shipped!', 'failed', handlers.NO_STATUS_TEMPLATE_ERROR, null]])

  // The template itself is refused by WhatsApp: the chat shows that, with WhatsApp's reason
  const refusedTemplate = codOrder(hoursAgo(30))
  await withWhatsApp(async () => {
    const result = await notify(refusedTemplate, withTemplate)
    assert.deepEqual([result.notified, result.viaTemplate, result.error], [false, false, 'rejected'])
  }, () => rejected(132001))
  assert.deepEqual(logged(refusedTemplate), [['Shipped!', 'failed', 'rejected', null]])
})

test('Canceling an order withdraws its unpaid payment request', async () => {
  const cancel = database => handlers.voidPaymentRequest({ organization: store(), order: database.tables.commerce_orders[0], database })

  const requested = seeded({ meta_payment_reference: 'ORD-261013-AB12.2' })
  const sent = await withWhatsApp(async () => { assert.equal(await cancel(requested), true) })
  assert.deepEqual([sent[0].interactive.type, sent[0].interactive.action.parameters.reference_id, sent[0].interactive.action.parameters.order.status], ['order_status', 'ORD-261013-AB12.2', 'canceled'])

  // Nothing to withdraw: no request was sent, or it is already paid (that needs a refund instead)
  for (const state of [{}, { meta_payment_reference: 'ORD-261013-AB12', payment_status: 'paid' }]) {
    const database = seeded(state)
    const none = await withWhatsApp(async () => { assert.equal(await cancel(database), false) })
    assert.equal(none.length, 0)
  }
})

// ── 6. Payment integrity ────────────────────────────────────────────────────

const requestedOrder = (overrides = {}) => ({
  meta_payment_reference: 'ORD-261013-AB12',
  payment_requests: [{ reference: 'ORD-261013-AB12', amount: 1040, currency: 'INR', requested_at: '2026-10-13T09:05:00.000Z' }],
  ...overrides,
})
const paidOrder = (overrides = {}) => requestedOrder({ status: 'paid', payment_status: 'paid', payment_method: 'whatsapp_pay', ...overrides })
const firstPayment = { id: 'txn-1', order_id: ORDER_ID, organization_id: 'org', transaction_id: 'pay_ABC123', amount: 1040, currency: 'INR', status: 'captured' }
const captured = (overrides = {}) => metaPaymentStatus('captured', 'success', 'ORD-261013-AB12', overrides)
const bodies = database => database.tables.messages.map(message => message.body)
const ledger = database => database.tables.commerce_transactions.map(row => [row.status, row.amount, row.transaction_id, row.order_id])

test('Commerce payments: money that is not the amount asked for is held for the team, not marked paid', async () => {
  const database = seeded(requestedOrder({ conversation_id: 'conversation-9' }))
  const sent = await withWhatsApp(async () => {
    await pay(database, captured({ amount: 50000 }))
    await pay(database, captured({ amount: 50000 })) // Meta redelivery: nothing is repeated
  })
  const order = () => database.tables.commerce_orders[0]
  assert.deepEqual([order().status, order().payment_status, order().payment_method], ['payment_pending', 'pending', undefined])
  // The money is in the ledger, the team sees why the order is not paid, the customer knows what happens next
  assert.deepEqual(ledger(database), [['captured', 500, 'pay_ABC123', ORDER_ID]])
  assert.match(order().customer_note, /^Payment of ₹\s?500 received on \d{4}-\d{2}-\d{2} \(reference ORD-261013-AB12\) but the order total is ₹\s?1,040; team to review\.$/)
  assert.equal(bodies(database).filter(body => /^\[Payment of ₹\s?500 received for Order #ORD-261013-AB12 but the order total is ₹\s?1,040; team to review\]$/.test(body)).length, 1)
  assert.ok(database.tables.messages.every(message => message.conversation_id === 'conversation-9'))
  assert.equal(sent.length, 1)
  assert.equal(sent[0].type, 'text')
  assert.match(sent[0].text.body, /received ₹\s?500 for order #ORD-261013-AB12\. The order total is ₹\s?1,040.*contact you/)

  // The right amount comes after all: paid as usual, the short payment stays on record for the refund
  const again = await withWhatsApp(async () => { await pay(database, captured({ transactionId: 'pay_DEF456', id: 'wamid.payment2' })) })
  assert.deepEqual([order().status, order().payment_status, order().payment_method], ['paid', 'paid', 'whatsapp_pay'])
  assert.deepEqual(ledger(database).map(row => row[0]), ['captured', 'captured'])
  assert.equal(again[0].interactive.type, 'order_status')

  // Too much is held too
  const over = seeded(requestedOrder())
  await withWhatsApp(async () => { await pay(over, captured({ amount: 200000 })) })
  assert.equal(over.tables.commerce_orders[0].payment_status, 'pending')
  assert.deepEqual(ledger(over), [['captured', 2000, 'pay_ABC123', ORDER_ID]])

  // An order from before amounts were kept is checked against its total
  const legacy = seeded({ meta_payment_reference: 'ORD-261013-AB12' })
  await withWhatsApp(async () => { await pay(legacy, captured({ amount: 103900 })) })
  assert.equal(legacy.tables.commerce_orders[0].payment_status, 'pending')
  // A paisa of rounding is not a short payment
  const rounding = seeded(requestedOrder())
  await withWhatsApp(async () => { await pay(rounding, captured({ amount: 103999 })) })
  assert.equal(rounding.tables.commerce_orders[0].payment_status, 'paid')
})

test('Commerce payments: a second payment for a paid order is recorded and the customer is told it will be refunded', async () => {
  const database = seeded(paidOrder(), { commerce_transactions: [firstPayment] })
  const sent = await withWhatsApp(async () => {
    await pay(database, captured()) // the first payment, delivered again: ignored
    await pay(database, captured({ transactionId: 'pay_XYZ789', id: 'wamid.payment2' }))
    await pay(database, captured({ transactionId: 'pay_XYZ789', id: 'wamid.payment2' })) // and that one again
  })
  const order = database.tables.commerce_orders[0]
  assert.deepEqual([order.status, order.payment_status], ['paid', 'paid'])
  assert.deepEqual(ledger(database), [['captured', 1040, 'pay_ABC123', ORDER_ID], ['duplicate', 1040, 'pay_XYZ789', ORDER_ID]])
  assert.match(order.customer_note, /^Second payment of ₹\s?1,040 received on \d{4}-\d{2}-\d{2} \(reference ORD-261013-AB12\); refund due\.$/)
  assert.equal(bodies(database).filter(body => /^\[Second payment of ₹\s?1,040 received for Order #ORD-261013-AB12; refund due\]$/.test(body)).length, 1)
  assert.equal(sent.length, 1)
  assert.match(sent[0].text.body, /second payment of ₹\s?1,040 for order #ORD-261013-AB12.*refunded/)

  // A payment without a gateway id is told apart by WhatsApp's own event id, so a redelivery is still one payment
  const anonymous = seeded(paidOrder(), { commerce_transactions: [firstPayment] })
  const payload = { ...captured({ id: 'wamid.payment3' }), payment: { ...captured().payment, transaction: {} } }
  await withWhatsApp(async () => { await pay(anonymous, payload); await pay(anonymous, payload) })
  assert.deepEqual(ledger(anonymous).map(row => row[2]), ['pay_ABC123', 'TXN_wamid.payment3'])
})

test('Commerce payments: a failure that arrives after the money never undoes the payment', async () => {
  const database = seeded(paidOrder(), { commerce_transactions: [firstPayment] })
  const sent = await withWhatsApp(async () => { await pay(database, metaPaymentStatus('pending', 'failed')) })
  assert.deepEqual([database.tables.commerce_orders[0].status, database.tables.commerce_orders[0].payment_status], ['paid', 'paid'])
  assert.equal(sent.length, 0)
  assert.equal(database.tables.messages.length, 0)
})

test('Commerce payments: the ledger is written before the order is marked paid', async () => {
  // The ledger cannot be written: nothing is marked paid and the error reaches Meta, which redelivers
  const broken = seeded(requestedOrder(), {}, { failInsert: table => (table === 'commerce_transactions' ? { code: '08006', message: 'connection failure' } : null) })
  // PostgREST errors are thrown as they come (plain objects), as everywhere in the handler
  const nothing = await withWhatsApp(async () => { await assert.rejects(() => pay(broken, captured()), error => error.message === 'connection failure') })
  assert.equal(broken.tables.commerce_orders[0].payment_status, 'pending')
  assert.equal(nothing.length, 0)

  // The unique index refuses the row: a parallel delivery got in first and finishes the order
  const parallel = seeded(requestedOrder(), {}, { failInsert: table => (table === 'commerce_transactions' ? { code: '23505', message: 'duplicate key value violates unique constraint "uq_commerce_transactions_transaction"' } : null) })
  const silent = await withWhatsApp(async () => { assert.equal((await pay(parallel, captured())).payment_status, 'pending') })
  assert.equal(parallel.tables.commerce_orders[0].payment_status, 'pending')
  assert.equal(silent.length, 0)

  // A crash between the ledger and the order: the redelivery finishes the order without a second ledger row
  const crashed = seeded(requestedOrder(), { commerce_transactions: [firstPayment] }, { uniqueIndexes: { commerce_transactions: ['organization_id', 'transaction_id'] } })
  const finished = await withWhatsApp(async () => { await pay(crashed, captured()) })
  assert.deepEqual([crashed.tables.commerce_orders[0].status, crashed.tables.commerce_orders[0].payment_status], ['paid', 'paid'])
  assert.equal(crashed.tables.commerce_transactions.length, 1)
  assert.equal(finished.length, 2) // receipt and thank-you
})

test('Commerce payments: the thank-you greets the customer by the name on the address form, never by a phone number', async () => {
  const greeting = async (order, contact) => {
    const database = seeded(requestedOrder(order), { contacts: [{ id: CONTACT_ID, organization_id: 'org', phone_number: '+919876543210', ...contact }] })
    const sent = await withWhatsApp(async () => { await pay(database, captured()) })
    return sent[1].text.body.split('!')[0]
  }
  assert.equal(await greeting({ shipping_address: { full_name: 'Asha Rao', address_line_1: '1 MG Road' } }, { first_name: 'Someone' }), '🎉 Thank you, Asha')
  assert.equal(await greeting({}, { first_name: 'Ravi Kumar' }), '🎉 Thank you, Ravi')
  assert.equal(await greeting({}, { first_name: '919876543210' }), '🎉 Thank you')
  assert.equal(await greeting({}, { first_name: '+91 98765 43210' }), '🎉 Thank you')
})

// ── 7. Payments for campaign "Order details" templates ───────────────────────

const CAMPAIGN_ID = 'aaaaaaaa-1111-4111-8111-111111111111'
const LOG_ID = 'bbbbbbbb-cccc-4ccc-8ccc-cccccccccccc'
// "C" + 8 hex digits of the campaign id + 12 of the log id, as the campaign worker sends it
const CAMPAIGN_REFERENCE = 'Caaaaaaaabbbbbbbbcccc'
const campaignDb = (log = {}, extra = {}, options = {}) => commerceDb({
  campaigns: [{ id: CAMPAIGN_ID, organization_id: 'org', name: 'Diwali offer' }, { id: 'dddddddd-2222-4222-8222-222222222222', organization_id: 'someone-else', name: 'Not ours' }],
  campaign_logs: [
    // A big send: the recipient's row is well past the first page of 1000
    ...Array.from({ length: 1100 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, campaign_id: CAMPAIGN_ID, phone_number: `+91900000${String(index).padStart(4, '0')}`, status: 'SENT' })),
    { id: LOG_ID, campaign_id: CAMPAIGN_ID, phone_number: '+919876543210', status: 'SENT', variables_mapped: { order_amount: '499', order_quantity: '2', shipping_fee: '42', order_item_name: 'Festive box', order_item_id: 'BOX-1' }, created_at: '2026-10-20T10:00:00.000Z', ...log },
  ],
  contacts: [{ id: CONTACT_ID, organization_id: 'org', phone_number: '+919876543210', first_name: 'Asha' }],
  conversations: [
    { id: 'conversation-old', organization_id: 'org', contact_id: CONTACT_ID, last_message_at: '2026-10-01T00:00:00.000Z' },
    { id: 'conversation-new', organization_id: 'org', contact_id: CONTACT_ID, last_message_at: '2026-10-21T00:00:00.000Z' },
  ],
  ...extra,
}, options)
const campaignPayment = (overrides = {}) => metaPaymentStatus('captured', 'success', CAMPAIGN_REFERENCE, overrides)

test('Campaign payments: a payment for an "Order details" template gets its own paid order and receipt', async () => {
  const database = campaignDb()
  const sent = await withWhatsApp(async () => {
    await pay(database, campaignPayment())
    await pay(database, campaignPayment()) // redelivered
  })
  assert.equal(database.tables.commerce_orders.length, 1)
  const order = database.tables.commerce_orders[0]
  assert.deepEqual(
    [order.status, order.payment_status, order.payment_method, order.checkout_type, order.contact_id, order.conversation_id, order.meta_payment_reference, order.currency],
    ['paid', 'paid', 'whatsapp_pay', 'campaign', CONTACT_ID, 'conversation-new', CAMPAIGN_REFERENCE, 'INR']
  )
  assert.deepEqual([order.subtotal, order.shipping_fee, order.tax_amount, order.total_amount], [998, 42, 0, 1040])
  assert.match(order.order_number, /^ORD-\d{6}-[A-Z2-9]{4}$/)
  assert.match(order.customer_note, /Diwali offer/)
  assert.deepEqual(order.payment_requests, [{ reference: CAMPAIGN_REFERENCE, amount: 1040, currency: 'INR', requested_at: '2026-10-20T10:00:00.000Z' }])
  assert.deepEqual(database.tables.commerce_order_items.map(line => [line.title, line.retailer_id, line.quantity, line.unit_price, line.total_price]), [['Festive box', 'BOX-1', 2, 499, 998]])
  assert.deepEqual(ledger(database), [['captured', 1040, 'pay_ABC123', order.id]])
  // The usual receipt and thank-you, once, in the customer's latest conversation
  assert.equal(sent.length, 2)
  assert.deepEqual([sent[0].interactive.type, sent[0].interactive.action.parameters.reference_id, sent[0].to], ['order_status', CAMPAIGN_REFERENCE, '919876543210'])
  assert.match(sent[1].text.body, /Thank you, Asha!.*Festive box × 2/s)
  assert.ok(database.tables.messages.every(message => message.conversation_id === 'conversation-new'))
})

test('Campaign payments: the whole amount is one line when the template numbers do not add up, and unknown customers are filed', async () => {
  // Nothing usable from the CSV, and nobody with that number yet: a contact and a conversation are made for the order
  const bare = campaignDb({ variables_mapped: null, phone_number: '+919999999999' }, { contacts: [], conversations: [] })
  const sent = await withWhatsApp(async () => { await pay(bare, campaignPayment({ amount: 25000 })) })
  const order = bare.tables.commerce_orders[0]
  assert.deepEqual([order.subtotal, order.shipping_fee, order.total_amount, order.payment_status], [250, 0, 250, 'paid'])
  assert.deepEqual(bare.tables.commerce_order_items.map(line => [line.title, line.quantity, line.unit_price]), [['Payment requested by campaign "Diwali offer"', 1, 250]])
  assert.deepEqual(bare.tables.contacts.map(contact => [contact.organization_id, contact.phone_number]), [['org', '+919999999999']])
  assert.equal(bare.tables.conversations.length, 1)
  assert.deepEqual([order.contact_id, order.conversation_id], [bare.tables.contacts[0].id, bare.tables.conversations[0].id])
  assert.equal(sent[0].to, '919999999999')

  // Numbers that do not add up to what was paid are not trusted for the lines
  const odd = campaignDb({ variables_mapped: { order_amount: '300', order_quantity: '2' } })
  await withWhatsApp(async () => { await pay(odd, campaignPayment({ amount: 100000 })) })
  assert.deepEqual(odd.tables.commerce_order_items.map(line => [line.quantity, line.unit_price, line.total_price]), [[1, 1000, 1000]])
  assert.equal(odd.tables.commerce_orders[0].total_amount, 1000)

  // The column from a later migration is missing: the order is still created
  const legacy = campaignDb({}, {}, { missingColumns: { commerce_orders: ['payment_requests'] } })
  await withWhatsApp(async () => { await pay(legacy, campaignPayment()) })
  assert.deepEqual([legacy.tables.commerce_orders[0].payment_status, legacy.tables.commerce_orders[0].payment_requests], ['paid', undefined])
})

test('Campaign payments: a reference that resolves to nothing is kept as an unmatched transaction, never dropped', async () => {
  // Another store's campaign, a log that is gone, a reference the CSV supplied
  for (const reference of ['Cdddddddd222222222222', 'Caaaaaaaa999999999999', 'INV-2026-0042']) {
    const database = campaignDb()
    const sent = await withWhatsApp(async () => { assert.equal(await pay(database, metaPaymentStatus('captured', 'success', reference)), null) })
    assert.equal(database.tables.commerce_orders.length, 0)
    assert.deepEqual(ledger(database), [['unmatched', 1040, 'pay_ABC123', null]])
    assert.equal(sent.length, 0)
  }
  // A pending or failed update for a campaign reference is nothing to record
  const database = campaignDb()
  await withWhatsApp(async () => { assert.equal(await pay(database, metaPaymentStatus('pending', 'pending', CAMPAIGN_REFERENCE)), null) })
  assert.deepEqual([database.tables.commerce_orders.length, database.tables.commerce_transactions.length], [0, 0])
})

// ── 8. Prices and money arithmetic ──────────────────────────────────────────

test('Commerce webhook: the store\'s catalog price wins over a cart price that differs by more than 1%', async () => {
  const database = commerceDb({ commerce_products: [
    { id: 'p1', organization_id: 'org', retailer_id: 'SKU-1', title: 'Linen Shirt', price: 450 },
    { id: 'p2', organization_id: 'org', retailer_id: 'SKU-2', title: 'Cap', price: 200 },
    { id: 'p3', organization_id: 'org', retailer_id: 'SKU-3', title: 'Unpriced', price: 0 },
  ] })
  await withWhatsApp(async () => {
    await handlers.handleInboundCommerceOrder({
      organization: store(), ...party, messageId: 'm', database,
      orderPayload: { catalog_id: 'CAT', product_items: [
        { product_retailer_id: 'SKU-1', quantity: 2, item_price: 400 },    // 11% under the catalog: the catalog price is charged
        { product_retailer_id: 'SKU-2', quantity: 1, item_price: 201.5 },  // within 1%: the price the customer saw
        { product_retailer_id: 'SKU-3', quantity: 1, item_price: 99.99 },  // no catalog price: the cart's
        { product_retailer_id: 'SKU-NEW', quantity: 3, item_price: 10.1 }, // never synced: the cart's
      ] },
    })
  })
  assert.deepEqual(database.tables.commerce_order_items.map(line => [line.retailer_id, line.unit_price, line.total_price]), [['SKU-1', 450, 900], ['SKU-2', 201.5, 201.5], ['SKU-3', 99.99, 99.99], ['SKU-NEW', 10.1, 30.3]])
  assert.deepEqual([database.tables.commerce_orders[0].subtotal, database.tables.commerce_orders[0].total_amount], [1231.79, 1231.79])
})

test('Money: totals and lines are worked out in paise and rounded once', () => {
  assert.equal(utils.lineTotal(10.1, 3), 30.3)
  assert.equal(utils.lineTotal(0.1, 3), 0.3)
  assert.equal(utils.lineTotal('12.34', '2'), 24.68)
  assert.equal(utils.fromMinorUnits(123179), 1231.79)
  assert.deepEqual(utils.calculateOrderTotals([{ unit_price: 10.1, quantity: 3 }, { unit_price: 0.1, quantity: 3 }], { shippingFee: 40, taxRate: 0.05 }), { subtotal: 30.6, shippingFee: 40, taxAmount: 1.53, grandTotal: 72.13 })
  assert.deepEqual(utils.calculateOrderTotals([{ unit_price: 500, quantity: '2' }], { shippingFee: 80, freeShippingThreshold: 900 }), { subtotal: 1000, shippingFee: 0, taxAmount: 0, grandTotal: 1000 })
  assert.deepEqual(utils.calculateOrderTotals([{ unit_price: 500, quantity: 1 }], { shippingFee: '80', freeShippingThreshold: 900 }), { subtotal: 500, shippingFee: 80, taxAmount: 0, grandTotal: 580 })
  assert.deepEqual(utils.calculateOrderTotals([], {}), { subtotal: 0, shippingFee: 0, taxAmount: 0, grandTotal: 0 })

  assert.equal(utils.chooseUnitPrice(400, 450), 450)
  assert.equal(utils.chooseUnitPrice(452, 450), 452)
  assert.equal(utils.chooseUnitPrice(455, 450), 450)
  assert.equal(utils.chooseUnitPrice(0, 450), 450)
  assert.equal(utils.chooseUnitPrice(99.99, 0), 99.99)
  assert.equal(utils.chooseUnitPrice('abc', null), 0)
})

test('Payment requests, campaign references and database errors are read safely', () => {
  const order = { payment_requests: [{ reference: 'ORD-1', amount: 10, currency: 'INR', requested_at: 't' }, null, 'junk', { amount: 5 }] }
  assert.deepEqual(utils.getPaymentRequests(order).map(request => request.reference), ['ORD-1'])
  assert.deepEqual(utils.getPaymentRequests({}), [])
  assert.deepEqual(utils.getPaymentRequests({ payment_requests: 'not a list' }), [])
  assert.equal(utils.findPaymentRequest(order, 'ORD-1').amount, 10)
  assert.equal(utils.findPaymentRequest(order, 'ORD-2'), null)

  assert.deepEqual(utils.parseCampaignReference('Caaaaaaaabbbbbbbbcccc'), { campaignPrefix: 'aaaaaaaa', logPrefix: 'bbbbbbbbcccc' })
  assert.deepEqual(utils.parseCampaignReference('C0123ABCD0123456789ab'), { campaignPrefix: '0123abcd', logPrefix: '0123456789ab' })
  for (const bad of ['ORD-261013-AB12', 'Caaaaaaaabbbbbbbbccc', 'Caaaaaaaabbbbbbbbccccc', 'Xaaaaaaaabbbbbbbbcccc', 'Caaaaaaaabbbbbbbbccgg', '', null]) assert.equal(utils.parseCampaignReference(bad), null)
  assert.equal(utils.uuidHasPrefix('AAAAAAAA-1111-4111-8111-111111111111', 'aaaaaaaa'), true)
  assert.equal(utils.uuidHasPrefix('bbbbbbbb-1111-4111-8111-111111111111', 'aaaaaaaa'), false)

  // What PostgREST says when a migration has not been applied, and when a unique index refuses a row
  assert.equal(utils.isMissingColumnError({ code: 'PGRST204', message: "Could not find the 'payment_requests' column of 'commerce_orders' in the schema cache" }, 'payment_requests'), true)
  assert.equal(utils.isMissingColumnError({ code: '42703', message: 'column commerce_orders.payment_requests does not exist' }, 'payment_requests'), true)
  assert.equal(utils.isMissingColumnError({ code: 'PGRST204', message: "Could not find the 'other' column" }, 'payment_requests'), false)
  assert.equal(utils.isMissingColumnError({ code: '23505', message: 'duplicate key value' }, 'payment_requests'), false)
  assert.equal(utils.isMissingColumnError(null, 'payment_requests'), false)
  assert.equal(utils.isUniqueViolation({ code: '23505' }), true)
  assert.equal(utils.isUniqueViolation({ message: 'duplicate key value violates unique constraint "x"' }), true)
  assert.equal(utils.isUniqueViolation({ code: '42703' }), false)
})

// ── 9. Checkout journeys: dead address forms, other currencies, late failures, stock ──

const accepted = () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.ok' }] }) })

test('Commerce webhook: the order status follows the step the customer actually got', async () => {
  assert.deepEqual(
    ['address', 'choice', 'payment', 'cod', 'acknowledged', 'not_sent'].map(step => handlers.statusForCheckoutStep(step)),
    ['awaiting_address', 'payment_pending', 'payment_pending', 'payment_pending', 'cart_submitted', null]
  )

  // The address form cannot be sent (an unpublished or deprecated form): the payment step goes
  // out instead, and the order waits on payment, not on an address nobody was asked for
  const database = commerceDb()
  let step
  const sent = await withWhatsApp(async () => {
    step = (await handlers.handleInboundCommerceOrder({ organization: withGateway({ commerce_address_flow_id: '999' }), ...party, orderPayload: cart, messageId: 'm', database })).step
  }, (count, message) => (message.interactive?.type === 'flow' ? rejected(131009) : accepted()))
  assert.equal(step, 'choice')
  assert.deepEqual(sent.map(message => message.interactive.type), ['flow', 'button'])
  assert.equal(database.tables.commerce_orders[0].status, 'payment_pending')

  // Nothing could be sent at all: the cart stays "received", not "awaiting address"
  const silent = commerceDb()
  await withWhatsApp(async () => {
    step = (await handlers.handleInboundCommerceOrder({ organization: withGateway({ commerce_address_flow_id: '999' }), ...party, orderPayload: cart, messageId: 'm', database: silent })).step
  }, () => rejected())
  assert.deepEqual([step, silent.tables.commerce_orders[0].status], ['not_sent', 'cart_submitted'])

  // Only Cash on Delivery: the confirmation button goes out and the order waits on it
  const cod = commerceDb()
  await withWhatsApp(async () => {
    step = (await handlers.handleInboundCommerceOrder({ organization: store(), ...party, orderPayload: cart, messageId: 'm', database: cod })).step
  })
  assert.deepEqual([step, cod.tables.commerce_orders[0].status], ['cod', 'payment_pending'])
})

test('Dashboard reminder: an address form that can no longer be sent moves the order on to payment', async () => {
  const database = seeded({ status: 'awaiting_address' })
  const sent = await withWhatsApp(async () => {
    const result = await handlers.resendCheckoutStep({ organization: withGateway({ commerce_address_flow_id: '999', commerce_enable_cod: false }), order: database.tables.commerce_orders[0], database })
    assert.equal(result.step, 'payment')
  }, (count, message) => (message.interactive?.type === 'flow' ? rejected(131009) : accepted()))
  assert.deepEqual(sent.map(message => message.interactive.type), ['flow', 'order_details'])
  assert.equal(database.tables.commerce_orders[0].status, 'payment_pending')
})

test('Commerce address: a form without an address (another form was chosen in Store settings) still moves the checkout on', async () => {
  const organization = withGateway({ commerce_address_flow_id: '999', commerce_enable_cod: false })
  const submit = (database, data) => handlers.handleInboundAddressSubmission({ organization, ...party, flowToken: `order_${ORDER_ID}`, submissionData: data, database })

  const database = seeded({ status: 'awaiting_address' })
  const sent = await withWhatsApp(async () => { assert.equal((await submit(database, { name: 'Asha', rating: '5' })).id, ORDER_ID) })
  assert.deepEqual(sent.map(message => message.interactive.type), ['order_details']) // the payment step, not the form again
  assert.match(sent[0].interactive.body.text, /could not read a delivery address from that form/)
  assert.deepEqual([database.tables.commerce_orders[0].status, database.tables.commerce_orders[0].shipping_address], ['payment_pending', undefined])
  assert.deepEqual(bodies(database).map(body => body.replace(/\(.*\)/, '')), ['[Address form for Order #ORD-261013-AB12 could not be read; the form in Store settings is not an address form]', '[Sent payment request for Order #ORD-261013-AB12 ]'])

  // On a confirmed order the customer is asked to send the address in the chat instead
  const paid = seeded({ status: 'paid', payment_status: 'paid' })
  const told = await withWhatsApp(async () => { assert.equal((await submit(paid, { name: 'Asha' })).id, ORDER_ID) })
  assert.deepEqual(told.map(message => message.type), ['text'])
  assert.match(told[0].text.body, /Reply here with your address/)
  assert.equal(paid.tables.commerce_orders[0].status, 'paid')
})

test('Commerce webhook: an order in another currency is not asked to pay in the chat, and the team sees why', async () => {
  const dollars = { catalog_id: 'CAT', product_items: [{ product_retailer_id: 'SKU-1', quantity: '2', item_price: '500', currency: 'USD' }] }
  const database = commerceDb()
  let step
  const sent = await withWhatsApp(async () => {
    step = (await handlers.handleInboundCommerceOrder({ organization: withGateway({ currency: 'USD' }), ...party, orderPayload: dollars, messageId: 'm', database })).step
  })
  // Straight to the Cash on Delivery confirmation: no "Pay online" button that could only fail
  assert.equal(step, 'cod')
  assert.deepEqual(sent.map(message => [message.interactive.type, message.interactive.action.buttons.length]), [['button', 1]])
  assert.match(sent[0].interactive.body.text, /\$1,000/)
  const order = database.tables.commerce_orders[0]
  assert.deepEqual([order.currency, order.status, order.meta_payment_reference], ['USD', 'payment_pending', undefined])
  const note = bodies(database).find(body => body.startsWith('[Online payment for Order #'))
  assert.equal(note, `[Online payment for Order #${order.order_number} could not be started: In-chat WhatsApp payments are only available in INR; this order is in USD. Offer Cash on Delivery or a payment link instead.]`)
  // The inbox reads the line as the usual "online payment could not be started" event
  const { parseCommerceMessage } = require('../lib/chat-commerce.ts')
  assert.equal(parseCommerceMessage(note, 'user').event, 'online_failed')

  // The same when the customer taps "Pay online" on an order in another currency
  const tapped = seeded({ currency: 'USD' })
  const replies = await withWhatsApp(async () => { assert.equal((await tap(tapped, `pay_online_${ORDER_ID}`)).outcome, 'failed') })
  assert.deepEqual(replies.map(message => message.type), ['text'])
  assert.ok(bodies(tapped).some(body => /could not be started: In-chat WhatsApp payments are only available in INR; this order is in USD/.test(body)))
})

test('Commerce payments: a failed attempt that times out after the order was settled another way is ignored', async () => {
  for (const state of [{ status: 'cod_confirmed', payment_method: 'cod' }, { status: 'shipped', payment_method: 'cod' }, { status: 'canceled' }]) {
    const database = seeded({ ...state, meta_payment_reference: 'ORD-261013-AB12' })
    const sent = await withWhatsApp(async () => { await pay(database, metaPaymentStatus('pending', 'failed')) })
    assert.deepEqual([database.tables.commerce_orders[0].status, database.tables.commerce_orders[0].payment_status], [state.status, 'pending'])
    assert.equal(sent.length, 0)
    assert.equal(database.tables.messages.length, 0)
  }
})

test('Commerce webhook: products the dashboard has not synced are looked up with the catalog connection, ten SKUs at a time', async () => {
  const skus = Array.from({ length: 12 }, (_, index) => `SKU-${index + 1}`)
  const lookups = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    if (init?.body) return accepted()
    const filter = JSON.parse(decodeURIComponent(String(url).match(/filter=([^&]+)/)[1]))
    lookups.push({ sku: filter.retailer_id.eq, token: init.headers.Authorization, version: String(url).match(/graph\.facebook\.com\/(v[\d.]+)\//)[1] })
    return { ok: true, status: 200, json: async () => ({ data: [{ id: `meta-${filter.retailer_id.eq}`, retailer_id: filter.retailer_id.eq, name: `Product ${filter.retailer_id.eq}`, price: '₹100.00', currency: 'INR', availability: 'in stock' }] }) }
  }
  const database = commerceDb()
  try {
    // The store connected its catalog through "Connect catalog with Meta": that token, not the WhatsApp one
    await handlers.handleInboundCommerceOrder({
      organization: store({ meta_catalog_id: '123456789', meta_catalog_token: 'catalog-token', whatsapp_graph_api_version: 'v23.0' }), ...party, messageId: 'm', database,
      orderPayload: { catalog_id: '123456789', product_items: skus.map(sku => ({ product_retailer_id: sku, quantity: 1, item_price: 100 })) },
    })
  } finally {
    globalThis.fetch = original
  }
  assert.deepEqual(lookups.map(lookup => lookup.sku), skus) // all twelve, in two chunks of ten and two
  assert.ok(lookups.every(lookup => lookup.token === 'Bearer catalog-token' && lookup.version === 'v23.0'))
  assert.deepEqual(database.tables.commerce_order_items.map(line => line.title).slice(0, 2), ['Product SKU-1', 'Product SKU-2'])
  assert.equal(database.tables.commerce_order_items.filter(line => line.title.startsWith('Item #')).length, 0)
  assert.equal(database.tables.commerce_products.length, 12)

  // Without a catalog token the WhatsApp token serves; without any, the cart's own names are kept
  const fallback = commerceDb()
  const tokens = []
  globalThis.fetch = async (url, init) => {
    if (init?.body) return accepted()
    tokens.push(init.headers.Authorization)
    return { ok: true, status: 200, json: async () => ({ data: [] }) }
  }
  try {
    await handlers.handleInboundCommerceOrder({ organization: store({ meta_catalog_id: '123456789' }), ...party, messageId: 'm', database: fallback, orderPayload: { catalog_id: '123456789', product_items: [{ product_retailer_id: 'SKU-9', quantity: 1, item_price: 100 }] } })
    await handlers.handleInboundCommerceOrder({ organization: store({ meta_catalog_id: '123456789', whatsapp_api_token: '' }), ...party, messageId: 'n', database: fallback, orderPayload: { catalog_id: '123456789', product_items: [{ product_retailer_id: 'SKU-9', quantity: 1, item_price: 100 }] } })
  } finally {
    globalThis.fetch = original
  }
  assert.deepEqual(tokens, ['Bearer token'])
  assert.deepEqual(fallback.tables.commerce_order_items.map(line => line.title), ['Item #SKU-9', 'Item #SKU-9'])
})

test('Stock: items leave stock once when the order is settled, and come back when it is canceled', async () => {
  const products = [
    { id: 'p1', organization_id: 'org', retailer_id: 'SKU-1', title: 'Shirt', price: 500, inventory_count: 2, is_available: true },
    { id: 'p2', organization_id: 'org', retailer_id: 'SKU-2', title: 'Cap', price: 200, inventory_count: 5, is_available: true },
    { id: 'other', organization_id: 'another-store', retailer_id: 'SKU-1', title: 'Not ours', price: 1, inventory_count: 50, is_available: true },
  ]
  const lines = [
    { id: 'line-1', order_id: ORDER_ID, product_id: 'p1', retailer_id: 'SKU-1', title: 'Shirt', unit_price: 500, quantity: 2 },
    { id: 'line-2', order_id: ORDER_ID, product_id: null, retailer_id: 'SKU-2', title: 'Cap', unit_price: 200, quantity: 1 }, // matched by SKU
    { id: 'line-3', order_id: ORDER_ID, product_id: null, retailer_id: 'SKU-GONE', title: 'Deleted', unit_price: 1, quantity: 1 },
  ]
  const database = seeded({}, { commerce_products: products, commerce_order_items: lines })
  const stock = () => database.tables.commerce_products.map(product => [product.retailer_id, product.inventory_count, product.is_available])

  await withWhatsApp(async () => { assert.equal((await tap(database, `cod_confirm_${ORDER_ID}`)).outcome, 'cod_confirmed') })
  // Two shirts: sold out and off sale. One cap. The other store's shirt is untouched.
  assert.deepEqual(stock(), [['SKU-1', 0, false], ['SKU-2', 4, true], ['SKU-1', 50, true]])
  const order = () => database.tables.commerce_orders[0]
  assert.ok(order().stock_adjusted_at)

  // The payment arriving after all, a redelivered webhook, a second click: nothing is counted twice
  assert.equal((await handlers.adjustOrderStock({ organization: store(), order: order(), action: 'take', database })).adjusted, false)
  await withWhatsApp(async () => { await pay(seeded(), captured()) }) // another order entirely
  assert.deepEqual(stock(), [['SKU-1', 0, false], ['SKU-2', 4, true], ['SKU-1', 50, true]])

  // Canceled: back in stock, and the sold-out shirt is on sale again; a second cancel gives nothing back twice
  const restored = await handlers.adjustOrderStock({ organization: store(), order: order(), action: 'restore', database })
  assert.deepEqual([restored.adjusted, order().stock_adjusted_at], [true, null])
  assert.deepEqual(stock(), [['SKU-1', 2, true], ['SKU-2', 5, true], ['SKU-1', 50, true]])
  assert.equal((await handlers.adjustOrderStock({ organization: store(), order: order(), action: 'restore', database })).adjusted, false)
  assert.deepEqual(stock(), [['SKU-1', 2, true], ['SKU-2', 5, true], ['SKU-1', 50, true]])

  // An in-chat payment takes stock too, and never below zero
  const short = seeded(requestedOrder(), { commerce_products: [{ id: 'p1', organization_id: 'org', retailer_id: 'SKU-1', title: 'Shirt', price: 500, inventory_count: 1, is_available: true }] })
  await withWhatsApp(async () => { await pay(short, captured()) })
  assert.deepEqual([short.tables.commerce_products[0].inventory_count, short.tables.commerce_products[0].is_available, Boolean(short.tables.commerce_orders[0].stock_adjusted_at)], [0, false, true])
})

test('Stock: a sold-out product is reported to the Meta catalog, best effort', async () => {
  const catalogProduct = { id: 'p1', organization_id: 'org', retailer_id: 'SKU-1', title: 'Shirt', price: 500, inventory_count: 2, is_available: true, image_url: 'https://x/shirt.jpg', website_url: 'https://shop/shirt', metadata: { source: 'meta', catalog: { state: 'synced', catalog_id: '123456789' } } }
  const batches = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/items_batch')) {
      const body = init.body instanceof URLSearchParams ? init.body : new URLSearchParams(String(init.body))
      batches.push(JSON.parse(body.get('requests')))
      return { ok: true, status: 200, json: async () => ({ handles: ['batch-1'] }) }
    }
    return accepted()
  }
  const database = seeded({}, { commerce_products: [catalogProduct] })
  try {
    await tap(database, `cod_confirm_${ORDER_ID}`, withGateway({ meta_catalog_id: '123456789', meta_catalog_token: 'catalog-token' }))
  } finally {
    globalThis.fetch = original
  }
  assert.equal(batches.length, 1)
  assert.deepEqual([batches[0][0].data.id, batches[0][0].data.availability], ['SKU-1', 'out of stock'])
  assert.deepEqual([database.tables.commerce_products[0].inventory_count, database.tables.commerce_products[0].is_available], [0, false])

  // Meta cannot be reached: the stock is still right here, and the order is still confirmed
  const offline = seeded({}, { commerce_products: [catalogProduct] })
  globalThis.fetch = async (url, init) => { if (String(url).includes('/items_batch')) throw new Error('network down'); return accepted() }
  try {
    assert.equal((await tap(offline, `cod_confirm_${ORDER_ID}`, withGateway({ meta_catalog_id: '123456789' }))).outcome, 'cod_confirmed')
  } finally {
    globalThis.fetch = original
  }
  assert.deepEqual([offline.tables.commerce_products[0].inventory_count, offline.tables.commerce_orders[0].status], [0, 'cod_confirmed'])
})

test('Stock: without the stock_adjusted_at column nothing is counted, with one warning', async () => {
  const products = [{ id: 'p1', organization_id: 'org', retailer_id: 'SKU-1', title: 'Shirt', price: 500, inventory_count: 2, is_available: true }]
  const warnings = []
  const warn = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  try {
    for (const run of [1, 2]) {
      const database = seeded({}, { commerce_products: products }, { missingColumns: { commerce_orders: ['stock_adjusted_at'] } })
      await withWhatsApp(async () => { assert.equal((await tap(database, `cod_confirm_${ORDER_ID}`)).outcome, 'cod_confirmed') })
      assert.deepEqual([database.tables.commerce_products[0].inventory_count, database.tables.commerce_orders[0].status, database.tables.commerce_orders[0].stock_adjusted_at], [2, 'cod_confirmed', undefined], `run ${run}`)
    }
  } finally {
    console.warn = warn
  }
  assert.deepEqual(warnings.filter(line => line.includes(handlers.STOCK_MIGRATION_HINT)).length, 1)
})
