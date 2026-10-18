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

  assert.deepEqual(utils.getFulfillment({ shipping_address: { tracking_number: ' AWB123 ', carrier: 'Delhivery', shipped_at: '2026-10-13T10:00:00Z' } }), { trackingNumber: 'AWB123', carrier: 'Delhivery', shippedAt: '2026-10-13T10:00:00Z' })
  assert.deepEqual(utils.getFulfillment({ shipping_address: null }), { trackingNumber: '', carrier: '', shippedAt: null })
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
function commerceDb(seed = {}) {
  const tables = { commerce_orders: [], commerce_order_items: [], commerce_products: [], commerce_transactions: [], messages: [], contacts: [], ...structuredClone(seed) }
  let sequence = 0
  const from = table => {
    if (!tables[table]) tables[table] = []
    let filters = [], op = 'select', values, singular = false, sorts = [], max = Infinity
    const query = {
      select() { return this },
      eq(key, value) { filters.push(row => row[key] === value); return this },
      neq(key, value) { filters.push(row => row[key] !== value); return this },
      in(key, list) { filters.push(row => list.includes(row[key])); return this },
      order(key, options = {}) { sorts.push([key, options.ascending === false ? -1 : 1]); return this },
      limit(count) { max = count; return this },
      maybeSingle() { singular = true; return this }, single() { singular = true; return this },
      insert(data) { op = 'insert'; values = Array.isArray(data) ? data : [data]; return this },
      upsert(data) { op = 'upsert'; values = Array.isArray(data) ? data : [data]; return this },
      update(data) { op = 'update'; values = data; return this },
      delete() { op = 'delete'; return this },
      then(resolve, reject) {
        let rows = tables[table].filter(row => filters.every(filter => filter(row)))
        if (op === 'insert' || op === 'upsert') {
          // Ids are valid UUIDs because checkout buttons and form tokens carry them
          rows = values.map(value => ({ id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`, created_at: new Date(Date.now() + sequence).toISOString(), ...structuredClone(value) }))
          tables[table].push(...rows)
        } else if (op === 'update') {
          rows.forEach(row => Object.assign(row, structuredClone(values)))
        } else if (op === 'delete') {
          tables[table] = tables[table].filter(row => !rows.includes(row))
        } else {
          for (const [key, direction] of [...sorts].reverse()) rows = [...rows].sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * direction)
          rows = rows.slice(0, max)
        }
        // Like Supabase: items come back with an order when asked for
        if (table === 'commerce_orders' && op !== 'delete') {
          rows = rows.map(row => ({ ...row, items: tables.commerce_order_items.filter(item => item.order_id === row.id) }))
        }
        return Promise.resolve({ data: structuredClone(singular ? rows[0] || null : rows), error: null }).then(resolve, reject)
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
const seeded = (order = {}, extra = {}) => commerceDb({ commerce_orders: [openOrder(order)], commerce_order_items: orderLines, contacts: [{ id: CONTACT_ID, organization_id: 'org', phone_number: '+919876543210' }], ...extra })

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
  assert.equal(database.tables.messages.length, 1) // only the message that went out is in the chat
  assert.equal(database.tables.commerce_orders[0].meta_payment_reference, undefined) // the refused request is not remembered
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

  const paid = seeded({ status: 'paid', payment_status: 'paid' })
  const afterPaid = await withWhatsApp(async () => {
    await handlers.handleInboundAddressSubmission({ organization: store(), ...party, flowToken: `order_${ORDER_ID}`, submissionData: address({ delivery_speed: 'express' }), database: paid })
  })
  assert.equal(paid.tables.commerce_orders[0].status, 'paid')
  assert.equal(paid.tables.commerce_orders[0].shipping_fee, 40)
  assert.equal(afterPaid.length, 0)
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

test('Checkout buttons: Pay online sends a payment request under a fresh reference each time', async () => {
  const database = seeded()
  const sent = await withWhatsApp(async () => {
    assert.equal((await tap(database, `pay_online_${ORDER_ID}`)).outcome, 'payment_requested')
    assert.equal((await tap(database, `pay_online_${ORDER_ID}`)).outcome, 'payment_requested')
  })
  assert.deepEqual(sent.map(message => message.interactive.action.parameters.reference_id), ['ORD-261013-AB12', 'ORD-261013-AB12.2'])
  assert.equal(sent[0].interactive.action.parameters.total_amount.value, 104000)
  assert.equal(database.tables.commerce_orders[0].meta_payment_reference, 'ORD-261013-AB12.2')
  assert.equal(database.tables.commerce_orders[0].status, 'payment_pending')
})

test('Checkout buttons: a request that cannot be sent is not left in silence', async () => {
  const database = seeded()
  const sent = await withWhatsApp(async () => {
    assert.equal((await tap(database, `pay_online_${ORDER_ID}`)).outcome, 'failed')
  }, (count) => (count === 1 ? rejected(131009) : { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.2' }] }) }))
  assert.equal(sent[1].type, 'text')
  assert.match(sent[1].text.body, /could not start the online payment/)
  assert.equal(database.tables.commerce_orders[0].meta_payment_reference, undefined)
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
const metaPaymentStatus = (status, transactionStatus = 'success', reference = 'ORD-261013-AB12') => ({
  id: 'wamid.payment',
  recipient_id: '919876543210',
  type: 'payment',
  status,
  payment: {
    reference_id: reference,
    amount: { value: 104000, offset: 100 },
    currency: 'INR',
    transaction: { id: 'pay_ABC123', pg_transaction_id: 'pg_1', type: 'razorpay', status: transactionStatus },
  },
  timestamp: '1760000000',
})
const pay = (database, payload, organization = store()) => handlers.handleInboundPaymentConfirmation({ organization, paymentPayload: payload, database })

test('Commerce payments: only an explicit success is read as paid', () => {
  const read = payload => handlers.normalizePaymentUpdate(payload)
  assert.deepEqual(read(metaPaymentStatus('captured')), { referenceId: 'ORD-261013-AB12', outcome: 'paid', transactionId: 'pay_ABC123', amount: 1040, currency: 'INR' })
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

test('Commerce payments: a captured status marks the order paid and sends one receipt', async () => {
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
  assert.equal(sent.length, 1)
  assert.equal(sent[0].interactive.type, 'order_status')
  assert.equal(sent[0].interactive.action.parameters.reference_id, 'ORD-261013-AB12')
  assert.equal(sent[0].to, '919876543210')
  assert.equal(database.tables.messages[0].conversation_id, 'conversation-9')
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

  // Another store's reference, or one that matches nothing, changes nothing
  const untouched = seeded({ meta_payment_reference: 'ORD-261013-AB12' })
  await withWhatsApp(async () => {
    assert.equal(await pay(untouched, metaPaymentStatus('captured'), store({ id: 'someone-else' })), null)
    assert.equal(await pay(untouched, metaPaymentStatus('captured', 'success', 'ORD-999999-ZZZZ')), null)
  })
  assert.equal(untouched.tables.commerce_orders[0].payment_status, 'pending')
  assert.equal(untouched.tables.commerce_transactions.length, 0)
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

  // The address is on file and a payment request was already sent: a new one, under a new reference
  const needsPayment = seeded({ shipping_address: { address_line_1: '1 MG Road' }, meta_payment_reference: 'ORD-261013-AB12' })
  const second = await withWhatsApp(async () => { assert.equal((await remind(needsPayment, withGateway({ commerce_address_flow_id: '999', commerce_enable_cod: false }))).step, 'payment') })
  assert.equal(second[0].interactive.action.parameters.reference_id, 'ORD-261013-AB12.2')
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
  const card = await withWhatsApp(async () => { assert.deepEqual(await notify(withRequest, 'shipped', 'Shipped!'), { notified: true, error: null, viaCard: true }) })
  assert.deepEqual([card[0].interactive.type, card[0].interactive.action.parameters.reference_id, card[0].interactive.action.parameters.order.status], ['order_status', 'ORD-261013-AB12', 'shipped'])
  assert.equal(withRequest.tables.messages[0].body, 'Shipped!')

  // A Cash on Delivery order never had one: a normal message
  const cod = seeded({ status: 'cod_confirmed', payment_method: 'cod' })
  const plain = await withWhatsApp(async () => { assert.deepEqual(await notify(cod, 'shipped', 'Shipped!'), { notified: true, error: null, viaCard: false }) })
  assert.deepEqual([plain.length, plain[0].type, plain[0].text.body], [1, 'text', 'Shipped!'])

  // The card is refused: the customer still gets the text
  const fallback = await withWhatsApp(async () => { assert.equal((await notify(seeded({ meta_payment_reference: 'ORD-261013-AB12' }), 'delivered')).viaCard, false) },
    (count, message) => (message.type === 'interactive' ? rejected(131009) : { ok: true, status: 200, json: async () => ({ messages: [{ id: 'w' }] }) }))
  assert.deepEqual(fallback.map(message => message.type), ['interactive', 'text'])

  // A paid order cannot be canceled through the card (it has to be refunded): text only
  const paidCancel = await withWhatsApp(async () => { await notify(seeded({ status: 'paid', payment_status: 'paid', meta_payment_reference: 'ORD-261013-AB12' }), 'canceled') })
  assert.deepEqual(paidCancel.map(message => message.type), ['text'])

  // Nothing went out: say why, and do not write it into the chat
  const silent = seeded()
  await withWhatsApp(async () => {
    const result = await notify(silent, 'shipped')
    assert.equal(result.notified, false)
    assert.match(result.error, /24 hours/)
  }, () => rejected(131047))
  assert.equal(silent.tables.messages.length, 0)
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
