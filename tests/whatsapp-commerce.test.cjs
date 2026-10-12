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
