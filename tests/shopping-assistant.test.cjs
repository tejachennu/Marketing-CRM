// The AI shopping assistant, with OpenAI scripted and WhatsApp faked. Nothing leaves the machine.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const { runShoppingAssistant, shoppingAssistantEnabled, searchTerms, scoreProduct } = require('../lib/commerce/shopping-assistant.ts')

const PRODUCTS = [
  { organization_id: 'org', retailer_id: 'BK-GODAAN', title: 'Godaan – Munshi Premchand (Hindi)', price: 249, currency: 'INR', category: 'Books', is_available: true },
  { organization_id: 'org', retailer_id: 'BK-GITANJALI', title: 'Gitanjali – Rabindranath Tagore', price: 199, currency: 'INR', category: 'Books', is_available: true },
  { organization_id: 'other', retailer_id: 'X-1', title: 'Another store product', price: 10, currency: 'INR' },
]
const ORDERS = [
  { organization_id: 'org', contact_id: 'c1', order_number: 'ORD-261018-Q72T', status: 'shipped', payment_status: 'pending', payment_method: 'cod', total_amount: 1121, currency: 'INR', shipping_address: { carrier: 'Delhivery', tracking_number: 'DL123' }, created_at: '2026-10-18T12:00:00Z', items: [{ title: 'Godaan', quantity: 1 }] },
  { organization_id: 'org', contact_id: 'someone-else', order_number: 'ORD-OTHER', status: 'paid', total_amount: 5, currency: 'INR', created_at: '2026-10-18T12:00:00Z', items: [] },
]

/** A small query builder: filters by eq, records what was asked, inserts into messages. */
function fakeDb() {
  const tables = { commerce_products: PRODUCTS, commerce_orders: ORDERS, messages: [] }
  return {
    tables,
    from(table) {
      const filters = []
      const builder = {
        select() { return builder },
        eq(column, value) { filters.push((row) => row[column] === value); return builder },
        or() { return builder },
        lte(column, value) { filters.push((row) => row[column] <= value); return builder },
        gte(column, value) { filters.push((row) => row[column] >= value); return builder },
        order() { return builder },
        limit() { return builder },
        insert: async (row) => { tables.messages.push(row); return { error: null } },
        then(resolve) { return Promise.resolve({ data: tables[table].filter((row) => filters.every((f) => f(row))), error: null }).then(resolve) },
      }
      return builder
    },
  }
}

/** OpenAI scripted: each entry is the tool calls of one round. Records what the model was sent. */
function scriptedOpenAI(rounds) {
  const requests = []
  let index = 0
  const fetcher = async (_url, init) => {
    requests.push(JSON.parse(init.body))
    const calls = rounds[index++] || []
    return { ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', tool_calls: calls.map(([name, args], i) => ({ id: `call_${index}_${i}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })) } }] }) }
  }
  return { fetcher, requests }
}

/** WhatsApp faked through global fetch (sendWhatsAppMessage uses it). */
async function withWhatsApp(run, respond = () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.ok' }] }) })) {
  const sent = []
  const original = global.fetch
  global.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return respond(sent.length, JSON.parse(init.body)) }
  try { await run() } finally { global.fetch = original }
  return sent
}

const organization = { id: 'org', name: 'Magnetora Books', currency: 'INR', enable_ai: true, enable_commerce: true, meta_catalog_id: 'CAT', whatsapp_api_token: 'tok', whatsapp_phone_number_id: '123' }
const input = (database, fetcher, message = 'Do you have Premchand books?') => ({
  supabase: database, organization, contact: { id: 'c1', first_name: 'Teja' }, conversationId: 'conv', customerPhone: '+916303012453',
  openAiKey: 'sk-test', message, history: [], fetcher,
})

test('Shopping assistant: searches, then sends real product cards with a short reply', async () => {
  const database = fakeDb()
  const openai = scriptedOpenAI([
    [['search_products', { query: 'books' }]],
    [['reply_to_customer', { message: 'Yes! Here are our books. Tap one to add it to your cart.', product_ids: ['BK-GODAAN', 'BK-GITANJALI'] }]],
  ])
  let result
  const sent = await withWhatsApp(async () => { result = await runShoppingAssistant(input(database, openai.fetcher)) })
  assert.deepEqual(result, { handled: true, productsSent: 2 })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].interactive.type, 'product_list')
  assert.deepEqual(sent[0].interactive.action.sections[0].product_items.map((item) => item.product_retailer_id), ['BK-GODAAN', 'BK-GITANJALI'])
  assert.equal(sent[0].interactive.body.text, 'Yes! Here are our books. Tap one to add it to your cart.')
  // The chat shows the reply and a product card line
  assert.deepEqual(database.tables.messages.map((row) => row.body), ['Yes! Here are our books. Tap one to add it to your cart.', '[Sent 2 products from the catalog]'])
  // The search result went back to the model, and only this store's products were in it
  const toolResult = openai.requests[1].messages.find((m) => m.role === 'tool')
  assert.ok(!toolResult.content.includes('X-1'))
})

test('Shopping assistant: a product the model invents is never sent', async () => {
  const database = fakeDb()
  const openai = scriptedOpenAI([[['search_products', { query: 'tagore' }]], [['reply_to_customer', { message: 'Here you go', product_ids: ['MADE-UP', 'BK-GITANJALI'] }]]])
  const sent = await withWhatsApp(async () => { await runShoppingAssistant(input(database, openai.fetcher)) })
  assert.equal(sent[0].interactive.type, 'product') // one real product left: a single product card
  assert.equal(sent[0].interactive.action.product_retailer_id, 'BK-GITANJALI')
  assert.equal(database.tables.messages[1].body, '[Sent product: Gitanjali – Rabindranath Tagore · SKU BK-GITANJALI]')
  // Products never searched cannot be sent either: a reply without a search sends plain text
  const noSearch = scriptedOpenAI([[['reply_to_customer', { message: 'We have Godaan', product_ids: ['BK-GODAAN'] }]]])
  const textOnly = await withWhatsApp(async () => { await runShoppingAssistant(input(fakeDb(), noSearch.fetcher)) })
  assert.equal(textOnly[0].type, 'text')
})

test('Shopping assistant: order status comes from this customer\'s own orders', async () => {
  const database = fakeDb()
  const openai = scriptedOpenAI([[['get_my_orders', {}]], [['reply_to_customer', { message: 'Your order ORD-261018-Q72T has shipped with Delhivery (tracking DL123).' }]]])
  const sent = await withWhatsApp(async () => { await runShoppingAssistant(input(database, openai.fetcher, 'Where is my order?')) })
  const orders = JSON.parse(openai.requests[1].messages.find((m) => m.role === 'tool').content)
  assert.deepEqual(orders.map((order) => order.order_number), ['ORD-261018-Q72T'])
  assert.deepEqual([orders[0].status, orders[0].payment, orders[0].carrier, orders[0].tracking_number, orders[0].total], ['Shipped', 'Cash on Delivery', 'Delhivery', 'DL123', '₹1,121'])
  assert.equal(sent[0].type, 'text')
})

test('Shopping assistant: other questions and requests for a person go to the FAQ chatbot', async () => {
  const openai = scriptedOpenAI([[['not_a_shopping_question', { reason: 'return policy' }]]])
  let result
  const sent = await withWhatsApp(async () => { result = await runShoppingAssistant(input(fakeDb(), openai.fetcher, 'What is your return policy?')) })
  assert.deepEqual(result, { handled: false, reason: 'return policy' })
  assert.equal(sent.length, 0)
  // OpenAI failing also hands over instead of leaving the customer unanswered
  const failing = async () => ({ ok: false, status: 500 })
  assert.equal((await runShoppingAssistant(input(fakeDb(), failing))).handled, false)
})

test('Shopping assistant: product cards Meta refuses become a text list with prices', async () => {
  const database = fakeDb()
  const openai = scriptedOpenAI([[['search_products', { query: 'godaan' }]], [['reply_to_customer', { message: 'Found it!', product_ids: ['BK-GODAAN'] }]]])
  const sent = await withWhatsApp(
    async () => { await runShoppingAssistant(input(database, openai.fetcher)) },
    (count) => (count === 1 ? { ok: false, status: 400, json: async () => ({ error: { code: 131009, message: 'Product not found' } }) } : { ok: true, status: 200, json: async () => ({ messages: [{ id: 'w2' }] }) })
  )
  assert.deepEqual(sent.map((message) => message.type), ['interactive', 'text'])
  assert.match(sent[1].text.body, /Godaan – Munshi Premchand \(Hindi\) — ₹249/)
})

test('Shopping assistant: when it runs, and how it searches', () => {
  assert.equal(shoppingAssistantEnabled(organization), true)
  assert.equal(shoppingAssistantEnabled({ ...organization, enable_ai: false }), false)
  assert.equal(shoppingAssistantEnabled({ ...organization, enable_commerce: false }), false)
  assert.equal(shoppingAssistantEnabled({ ...organization, commerce_ai_assistant: false }), false)
  assert.equal(shoppingAssistantEnabled({ ...organization, meta_catalog_id: '' }), false)
  assert.deepEqual(searchTerms('Premchand, books!! under 300 %_'), ['premchand', 'books', 'under', '300'])
  assert.ok(scoreProduct(PRODUCTS[0], ['premchand']) > scoreProduct(PRODUCTS[1], ['premchand']))
})

test('Shopping assistant: a Tenglish question reaches the model with the language rules, and a loose spelling still finds the book', async () => {
  const database = fakeDb()
  const openai = scriptedOpenAI([
    [['search_products', { query: 'premchnd' }]],
    [['reply_to_customer', { message: 'Avunu andi, maa daggara Premchand books unnayi. Product meeda tap chesi cart lo add cheyandi.', product_ids: ['BK-GODAAN'] }]],
  ])
  const sent = await withWhatsApp(async () => { await runShoppingAssistant(input(database, openai.fetcher, 'me degera premchand books vunaya')) })
  assert.match(openai.requests[0].messages[0].content, /Tenglish in → Tenglish out/)
  assert.equal(openai.requests[0].messages.at(-1).content, 'me degera premchand books vunaya')
  const found = JSON.parse(openai.requests[1].messages.find((m) => m.role === 'tool').content)
  assert.deepEqual(found.map((product) => product.retailer_id), ['BK-GODAAN'])
  assert.equal(sent[0].interactive.action.product_retailer_id, 'BK-GODAAN')
  assert.match(sent[0].interactive.body.text, /unnayi/)
})
