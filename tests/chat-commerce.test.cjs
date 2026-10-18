require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  collectProductRefs,
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
