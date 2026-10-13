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
    referenceId: 'ORD_1001',
    currency: 'INR',
    totalAmount: 1250.0,
    subtotal: 1200.0,
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
  assert.equal(params.reference_id, 'ORD_1001')
  assert.equal(params.currency, 'INR')
  // Value in paise (100 offset)
  assert.equal(params.total_amount.value, 125000)
  assert.equal(params.total_amount.offset, 100)
  assert.equal(params.order.subtotal.value, 120000)
  assert.equal(params.order.shipping.value, 5000)
  assert.equal(params.payment_settings[0].payment_gateway.type, 'razorpay')
  assert.equal(params.payment_settings[0].payment_gateway.configuration_name, 'my_razorpay_meta_config')
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

// Minimal in-memory Supabase adapter: every filter is applied, so tenant scoping is really exercised.
function commerceDb(seed = {}) {
  const tables = { commerce_orders: [], commerce_order_items: [], commerce_products: [], commerce_transactions: [], messages: [], ...seed }
  const from = table => {
    let filters = [], op = 'select', values, singular = false
    const query = {
      select() { return this }, eq(key, value) { filters.push(row => row[key] === value); return this },
      in(key, list) { filters.push(row => list.includes(row[key])); return this },
      order() { return this }, limit() { return this }, maybeSingle() { singular = true; return this }, single() { singular = true; return this },
      insert(data) { op = 'insert'; values = Array.isArray(data) ? data : [data]; return this },
      update(data) { op = 'update'; values = data; return this },
      then(resolve, reject) {
        let rows = tables[table].filter(row => filters.every(filter => filter(row)))
        if (op === 'insert') {
          rows = values.map(value => ({ id: `${table}-${tables[table].length + 1}`, ...structuredClone(value) }))
          tables[table].push(...rows)
        } else if (op === 'update') rows.forEach(row => Object.assign(row, structuredClone(values)))
        return Promise.resolve({ data: structuredClone(singular ? rows[0] || null : rows), error: null }).then(resolve, reject)
      },
    }
    return query
  }
  return { from, tables }
}

// Capture what would be sent to WhatsApp instead of calling Meta
async function withWhatsApp(run, respond = () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.1' }] }) })) {
  const sent = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return respond(sent.length) }
  try { await run(sent) } finally { globalThis.fetch = original }
  return sent
}

const store = (overrides = {}) => ({ id: 'org', currency: 'INR', whatsapp_api_token: 'token', whatsapp_phone_number_id: '111', commerce_enable_cod: true, ...overrides })
const cart = { catalog_id: 'CAT', product_items: [{ product_retailer_id: 'SKU-1', quantity: '2', item_price: '500', currency: 'INR' }] }
const party = { contact: { id: 'contact', first_name: 'Asha' }, conversation: { id: 'conversation' }, customerPhone: '+919876543210' }

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
    return { step, message: sent[0], status: database.tables.commerce_orders[0].status, logged: database.tables.messages.length }
  }

  const address = await stepFor(store({ commerce_address_flow_id: '999', commerce_gateway_config_name: 'cfg' }))
  assert.deepEqual([address.step, address.message.interactive.type, address.status], ['address', 'flow', 'awaiting_address'])
  assert.equal(address.message.interactive.action.parameters.flow_action_payload.data, undefined)

  const payment = await stepFor(store({ commerce_gateway_config_name: 'cfg', commerce_payment_gateway: 'razorpay' }))
  assert.deepEqual([payment.step, payment.message.interactive.type, payment.status], ['payment', 'order_details', 'payment_pending'])
  assert.equal(payment.message.interactive.action.parameters.total_amount.value, 100000)

  // An unsupported gateway value ("link") must not be sent to Meta; Cash on Delivery is offered instead
  const cod = await stepFor(store({ commerce_gateway_config_name: 'cfg', commerce_payment_gateway: 'link' }))
  assert.deepEqual([cod.step, cod.message.interactive.type], ['cod', 'button'])
  assert.match(cod.message.interactive.action.buttons[0].reply.id, /^cod_confirm_/)

  // Nothing configured at all: the customer still hears back
  const acknowledged = await stepFor(store({ commerce_enable_cod: false }))
  assert.deepEqual([acknowledged.step, acknowledged.message.type, acknowledged.logged], ['acknowledged', 'text', 1])
  assert.match(acknowledged.message.text.body, /ORD-/)
})

test('Commerce webhook: a message Meta rejects is not logged as sent', async () => {
  const database = commerceDb()
  let step
  await withWhatsApp(async () => {
    step = (await handlers.handleInboundCommerceOrder({ organization: store({ commerce_enable_cod: false }), ...party, orderPayload: cart, messageId: 'm', database })).step
  }, () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'outside window' } }) }))
  assert.equal(step, 'not_sent')
  assert.equal(database.tables.messages.length, 0)
  assert.equal(database.tables.commerce_orders.length, 1) // the order itself is still recorded
})

test('Commerce webhook: only a successful payment for this store marks the order paid, once', async () => {
  const order = { id: 'order-1', organization_id: 'org', order_number: 'ORD-1', status: 'payment_pending', payment_status: 'pending', total_amount: 1000, currency: 'INR' }
  const pay = (database, payload, organization = store()) => handlers.handleInboundPaymentConfirmation({ organization, ...party, paymentPayload: payload, database })

  const failed = commerceDb({ commerce_orders: [{ ...order }] })
  await withWhatsApp(async sent => { await pay(failed, { reference_id: 'order-1', status: 'failed' }); assert.equal(sent.length, 0) })
  assert.deepEqual([failed.tables.commerce_orders[0].status, failed.tables.commerce_orders[0].payment_status], ['payment_pending', 'failed'])
  assert.equal(failed.tables.commerce_transactions.length, 0)

  const otherStore = commerceDb({ commerce_orders: [{ ...order }] })
  await withWhatsApp(async () => { assert.equal(await pay(otherStore, { reference_id: 'order-1', status: 'captured' }, store({ id: 'someone-else' })), null) })
  assert.equal(otherStore.tables.commerce_orders[0].payment_status, 'pending')

  const paid = commerceDb({ commerce_orders: [{ ...order }] })
  const sent = await withWhatsApp(async () => {
    await pay(paid, { reference_id: 'order-1', status: 'captured', transaction_id: 'txn', amount: { value: 100000, offset: 100 } })
    await pay(paid, { reference_id: 'order-1', status: 'captured', transaction_id: 'txn', amount: { value: 100000, offset: 100 } })
  })
  assert.deepEqual([paid.tables.commerce_orders[0].status, paid.tables.commerce_orders[0].payment_status], ['paid', 'paid'])
  assert.equal(paid.tables.commerce_transactions.length, 1)
  assert.equal(paid.tables.commerce_transactions[0].amount, 1000)
  assert.equal(sent.length, 1)
})

test('Commerce webhook: resubmitting the address form never stacks the express surcharge or reopens a paid order', async () => {
  const base = { id: 'order-1', organization_id: 'org', contact_id: 'contact', order_number: 'ORD-1', status: 'awaiting_address', payment_status: 'pending', subtotal: 1000, shipping_fee: 40, tax_amount: 0, total_amount: 1040, currency: 'INR', items: [{ retailer_id: 'SKU-1', title: 'Shirt', unit_price: 500, quantity: 2 }] }
  const submit = (database, speed) => handlers.handleInboundAddressSubmission({ organization: store(), ...party, flowToken: 'order_order-1', submissionData: { address_line_1: '1 MG Road', city: 'Mumbai', pincode: '400001', delivery_speed: speed }, database })

  const database = commerceDb({ commerce_orders: [structuredClone(base)] })
  await withWhatsApp(async () => {
    await submit(database, 'express')
    await submit(database, 'express')
    assert.deepEqual([database.tables.commerce_orders[0].shipping_fee, database.tables.commerce_orders[0].total_amount], [90, 1090])
    await submit(database, 'standard')
    assert.deepEqual([database.tables.commerce_orders[0].shipping_fee, database.tables.commerce_orders[0].total_amount], [40, 1040])
  })

  const paid = commerceDb({ commerce_orders: [{ ...structuredClone(base), status: 'paid', payment_status: 'paid' }] })
  const sent = await withWhatsApp(async () => { await submit(paid, 'express') })
  assert.equal(paid.tables.commerce_orders[0].status, 'paid')
  assert.equal(paid.tables.commerce_orders[0].shipping_fee, 40)
  assert.equal(sent.length, 0)
})

// ── Payment results as Meta really sends them: a webhook status of type "payment" ──
const metaPaymentStatus = (status, transactionStatus = 'success') => ({
  id: 'wamid.payment',
  recipient_id: '919876543210',
  type: 'payment',
  status,
  payment: {
    reference_id: 'order-1',
    amount: { value: 104000, offset: 100 },
    currency: 'INR',
    transaction: { id: 'pay_ABC123', pg_transaction_id: 'pg_1', type: 'razorpay', status: transactionStatus },
  },
  timestamp: '1760000000',
})

test('Commerce payments: only an explicit success is read as paid', () => {
  const read = payload => handlers.normalizePaymentUpdate(payload)
  assert.deepEqual(read(metaPaymentStatus('captured')), { referenceId: 'order-1', outcome: 'paid', transactionId: 'pay_ABC123', amount: 1040, currency: 'INR' })
  assert.equal(read(metaPaymentStatus('pending', 'pending')).outcome, 'pending')
  assert.equal(read(metaPaymentStatus('pending', 'failed')).outcome, 'failed')
  // A failed transaction wins even if the outer status were to say captured
  assert.equal(read(metaPaymentStatus('captured', 'failed')).outcome, 'failed')
  // No status, or one we do not recognise, is never treated as money received
  assert.equal(read({ reference_id: 'order-1' }).outcome, 'pending')
  assert.equal(read({ reference_id: 'order-1', status: 'something_new' }).outcome, 'pending')
  assert.equal(read({ status: 'captured' }), null)
  assert.equal(read(null), null)
})

test('Commerce payments: a captured status from Meta marks the order paid and sends one receipt', async () => {
  const order = { id: 'order-1', organization_id: 'org', contact_id: 'contact', conversation_id: 'conversation-9', order_number: 'ORD-1', status: 'payment_pending', payment_status: 'pending', total_amount: 1040, currency: 'INR' }
  const database = commerceDb({ commerce_orders: [{ ...order }], contacts: [{ id: 'contact', organization_id: 'org', phone_number: '+919876543210' }] })

  // The status webhook carries no conversation: the order's own conversation and phone are used
  const sent = await withWhatsApp(async () => {
    await handlers.handleInboundPaymentConfirmation({ organization: store(), paymentPayload: metaPaymentStatus('captured'), customerPhone: '919876543210', database })
    await handlers.handleInboundPaymentConfirmation({ organization: store(), paymentPayload: metaPaymentStatus('captured'), database }) // Meta redelivery
  })

  const saved = database.tables.commerce_orders[0]
  assert.deepEqual([saved.status, saved.payment_status, saved.payment_method, saved.meta_payment_reference], ['paid', 'paid', 'whatsapp_pay', 'pay_ABC123'])
  assert.equal(database.tables.commerce_transactions.length, 1)
  assert.deepEqual([database.tables.commerce_transactions[0].amount, database.tables.commerce_transactions[0].transaction_id], [1040, 'pay_ABC123'])
  assert.equal(sent.length, 1)
  assert.equal(sent[0].interactive.type, 'order_status')
  assert.equal(sent[0].to, '919876543210')
  assert.equal(database.tables.messages[0].conversation_id, 'conversation-9')
})

test('Commerce payments: pending and failed statuses never mark an order paid', async () => {
  const order = { id: 'order-1', organization_id: 'org', order_number: 'ORD-1', status: 'payment_pending', payment_status: 'pending', total_amount: 1040, currency: 'INR' }
  for (const [payload, expected] of [[metaPaymentStatus('pending', 'pending'), 'pending'], [metaPaymentStatus('pending', 'failed'), 'failed'], [{ reference_id: 'order-1' }, 'pending']]) {
    const database = commerceDb({ commerce_orders: [{ ...order }] })
    const sent = await withWhatsApp(async () => { await handlers.handleInboundPaymentConfirmation({ organization: store(), paymentPayload: payload, database }) })
    assert.deepEqual([database.tables.commerce_orders[0].status, database.tables.commerce_orders[0].payment_status], ['payment_pending', expected])
    assert.equal(database.tables.commerce_transactions.length, 0)
    assert.equal(sent.length, 0)
  }
})

test('Commerce payments: the gateway list matches what Meta accepts', () => {
  assert.deepEqual([...utils.SUPPORTED_PAYMENT_GATEWAYS].sort(), ['billdesk', 'payu', 'razorpay', 'zaakpay'])
  assert.equal(utils.getPaymentGateway({ commerce_payment_gateway: 'cashfree', commerce_gateway_config_name: 'cfg' }), null)
})
