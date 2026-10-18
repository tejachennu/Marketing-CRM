require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  collectProductRefs,
  formFieldLabel,
  describeCart,
  describeCommerceMessage,
  formatSentProduct,
  parseCommerceMessage,
  whatsappMessageId,
} = require('../lib/chat-commerce.ts')
const { getMessagePreview } = require('../lib/chat-message-format.ts')

test('Chat commerce: a sent product is read back with its SKU, and older lines without one still work', () => {
  const body = formatSentProduct('Gitanjali – Rabindranath Tagore (Paperback)', 'BK-001')
  assert.equal(body, '[Sent product: Gitanjali – Rabindranath Tagore (Paperback) · SKU BK-001]')
  assert.deepEqual(parseCommerceMessage(body), { kind: 'product', title: 'Gitanjali – Rabindranath Tagore (Paperback)', sku: 'BK-001' })
  assert.deepEqual(parseCommerceMessage('[Sent product: Gitanjali – Rabindranath Tagore (Paperback)]'), { kind: 'product', title: 'Gitanjali – Rabindranath Tagore (Paperback)', sku: null })
  assert.deepEqual(parseCommerceMessage(formatSentProduct('', 'BK-9')), { kind: 'product', title: '', sku: 'BK-9' })
  assert.deepEqual(parseCommerceMessage('[reply:abc]' + body).kind, 'product')
})

test('Chat commerce: cart orders, with or without a total and a note', () => {
  assert.deepEqual(parseCommerceMessage('🛒 [WhatsApp Cart Order]: 1 item(s) selected'), { kind: 'order', itemCount: 1, note: null })
  assert.deepEqual(parseCommerceMessage('🛒 [WhatsApp Cart Order]: 2 item(s) selected · ₹398'), { kind: 'order', itemCount: 2, note: null })
  assert.deepEqual(parseCommerceMessage('🛒 [WhatsApp Cart Order]: 2 item(s) selected · ₹398 (Note: "Gift wrap please")'), { kind: 'order', itemCount: 2, note: 'Gift wrap please' })
  assert.deepEqual(parseCommerceMessage('🛒 [WhatsApp Cart Order]: 3 item(s) selected (Note: "COD")'), { kind: 'order', itemCount: 3, note: 'COD' })
})

test('Chat commerce: product lists, the catalog and website links; ordinary text is left alone', () => {
  assert.deepEqual(parseCommerceMessage('[Sent 4 products from the catalog]'), { kind: 'products', count: 4 })
  assert.deepEqual(parseCommerceMessage('[Sent 1 product from the catalog]'), { kind: 'products', count: 1 })
  assert.deepEqual(parseCommerceMessage('[Sent the full catalog]'), { kind: 'catalog' })
  assert.deepEqual(parseCommerceMessage('[Sent website link: Gitanjali]'), { kind: 'website', title: 'Gitanjali' })
  for (const body of ['Hi', '', null, 'I sent product: x', '[Sent product: ]x']) assert.equal(parseCommerceMessage(body), null)
})

test('Chat commerce: list previews read naturally', () => {
  assert.equal(getMessagePreview({ body: '[Sent product: Gitanjali · SKU BK-001]', media_url: null }), '🛍️ Gitanjali')
  assert.equal(getMessagePreview({ body: '🛒 [WhatsApp Cart Order]: 1 item(s) selected', media_url: null }), '🛒 Cart order · 1 item')
  assert.equal(describeCommerceMessage({ kind: 'order', itemCount: 2, note: null }), '🛒 Cart order · 2 items')
  assert.equal(getMessagePreview({ body: 'Hello there', media_url: null }), 'Hello there')
})

test('Chat commerce: helpers for matching and the webhook line', () => {
  assert.equal(whatsappMessageId('FB_wamid.ABC'), 'wamid.ABC')
  assert.equal(whatsappMessageId('wamid.ABC'), 'wamid.ABC')
  assert.equal(whatsappMessageId(null), null)
  assert.deepEqual(
    collectProductRefs([{ body: '[Sent product: A · SKU 1]' }, { body: '[Sent product: B]' }, { body: '[Sent product: B]' }, { body: 'hi' }]),
    { titles: ['B'], skus: ['1'] }
  )
  assert.deepEqual(describeCart([{ item_price: '199', quantity: 2, currency: 'inr' }, { item_price: 50.5, quantity: '1' }]), { quantity: 3, total: 448.5, currency: 'INR' })
})

test('Chat commerce: checkout steps the webhook notes become events', () => {
  assert.deepEqual(parseCommerceMessage('[Sent delivery address form for Order #ORD-261018-Q72T]'), { kind: 'checkout', event: 'address_requested', orderNumber: 'ORD-261018-Q72T', amount: null, detail: null })
  assert.deepEqual(parseCommerceMessage('[Sent Cash on Delivery confirmation for Order #ORD-261018-Q72T (₹1,121)]'), { kind: 'checkout', event: 'cod_requested', orderNumber: 'ORD-261018-Q72T', amount: '₹1,121', detail: null })
  assert.deepEqual(parseCommerceMessage('[Order #ORD-261018-Q72T confirmed for Cash on Delivery (₹1,121)]'), { kind: 'checkout', event: 'cod_confirmed', orderNumber: 'ORD-261018-Q72T', amount: '₹1,121', detail: null })
  assert.equal(parseCommerceMessage('[Asked how to pay for Order #A-1 (₹50): online or Cash on Delivery]').event, 'payment_choice')
  assert.equal(parseCommerceMessage('[Sent payment request for Order #A-1 (₹50)]').event, 'payment_requested')
  assert.equal(parseCommerceMessage('[Payment received for Order #A-1 (₹50); receipt sent]').event, 'paid')
  assert.equal(parseCommerceMessage('[Payment failed for Order #A-1; customer was told]').event, 'payment_failed')
  assert.equal(parseCommerceMessage('[Checkout message for Order #A-1 (₹50) could not be sent]').event, 'not_sent')
  assert.deepEqual(parseCommerceMessage('[Online payment for Order #A-1 could not be started: Gateway not active]'), { kind: 'checkout', event: 'online_failed', orderNumber: 'A-1', amount: null, detail: 'Gateway not active' })
  assert.deepEqual(parseCommerceMessage('[Told customer Order #A-1 is already shipped]'), { kind: 'checkout', event: 'told', orderNumber: 'A-1', amount: null, detail: 'already shipped' })
  assert.equal(getMessagePreview({ body: '[Order #A-1 confirmed for Cash on Delivery (₹50)]', media_url: null }), '✅ Confirmed for Cash on Delivery')
})

test('Chat commerce: a submitted address form is read as an address, without the form token', () => {
  const body = '[Completed Native Form]: {"full_name":"Teja Chennu","phone_number":"6303012453","address_line_1":"45","address_line_2":"Mogaltur vodayar street ","city":"Mogaltur ","state":"Andhra Pradesh ","pincode":"543281","delivery_speed":"standard","instructions":"Please leave at door step ","flow_token":"order_40e94fba-1d9d-4f20-b649-0cea3952b7ff"}'
  const parsed = parseCommerceMessage(body)
  assert.equal(parsed.kind, 'form')
  assert.equal(parsed.isAddress, true)
  assert.deepEqual(parsed.fields.map(([key]) => key), ['full_name', 'phone_number', 'address_line_1', 'address_line_2', 'city', 'state', 'pincode', 'delivery_speed', 'instructions'])
  assert.equal(Object.fromEntries(parsed.fields).city, 'Mogaltur')
  assert.equal(getMessagePreview({ body, media_url: null }), '📍 Delivery address submitted')
  // Any other form: a field list; broken JSON stays plain text
  const other = parseCommerceMessage('[Completed Native Form]: {"rating":"5","comments":"Great"}')
  assert.deepEqual([other.isAddress, other.fields], [false, [['rating', '5'], ['comments', 'Great']]])
  assert.equal(parseCommerceMessage('[Completed Native Form]: {not json'), null)
  assert.equal(formFieldLabel('delivery_speed'), 'Delivery speed')
  assert.equal(formFieldLabel('pincode'), 'PIN code')
})
