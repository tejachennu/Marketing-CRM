// The AI shopping assistant, with OpenAI scripted and WhatsApp faked. Nothing leaves the machine.
// The run limiter is in memory and shared by every test in this process: the tests below make
// well under the 30 runs an hour one customer ("c1" of "org") is allowed, and the limit tests use
// ids of their own.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const { runShoppingAssistant, shoppingAssistantEnabled, searchTerms, scoreProduct, unverifiedClaim, modelHistory } = require('../lib/commerce/shopping-assistant.ts')
const { checkRateLimit } = require('../lib/rate-limiter.ts')

const PRODUCTS = [
  { organization_id: 'org', retailer_id: 'BK-GODAAN', title: 'Godaan – Munshi Premchand (Hindi)', price: 249, currency: 'INR', category: 'Books', is_available: true },
  { organization_id: 'org', retailer_id: 'BK-GITANJALI', title: 'Gitanjali – Rabindranath Tagore', price: 199, currency: 'INR', category: 'Books', is_available: true },
  { organization_id: 'other', retailer_id: 'X-1', title: 'Another store product', price: 10, currency: 'INR' },
]
/** On sale: the row's price is the sale price and the catalog sync keeps the full price in the metadata. */
const SALE_PRODUCT = { organization_id: 'org', retailer_id: 'BK-MALGUDI', title: 'Malgudi Days – R. K. Narayan', price: 199, currency: 'INR', category: 'Books', is_available: true, metadata: { source: 'meta', attributes: { list_price: 299 } } }
const ORDERS = [
  { organization_id: 'org', contact_id: 'c1', order_number: 'ORD-261018-Q72T', status: 'shipped', payment_status: 'pending', payment_method: 'cod', subtotal: 1071, shipping_fee: 50, tax_amount: 0, total_amount: 1121, currency: 'INR', shipping_address: { carrier: 'Delhivery', tracking_number: 'DL123' }, created_at: '2026-10-18T12:00:00Z', items: [{ title: 'Godaan', quantity: 1, unit_price: 249 }, { title: 'Gitanjali', quantity: 2, unit_price: 411 }] },
  { organization_id: 'org', contact_id: 'someone-else', order_number: 'ORD-OTHER', status: 'paid', total_amount: 5, currency: 'INR', created_at: '2026-10-18T12:00:00Z', items: [] },
]

/** A small query builder: filters by eq, records what was asked, inserts into messages. */
function fakeDb(extra = {}) {
  const tables = { commerce_products: [...PRODUCTS, ...(extra.products || [])], commerce_orders: ORDERS, messages: [] }
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
const input = (database, fetcher, message = 'Do you have Premchand books?', extra = {}) => ({
  supabase: database, organization, contact: { id: 'c1', first_name: 'Teja' }, conversationId: 'conv', customerPhone: '+916303012453',
  openAiKey: 'sk-test', message, history: [], fetcher, ...extra,
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
  // The model is told the rule the reply check enforces
  assert.match(openai.requests[0].messages[0].content, /Never mention a discount, coupon, promo code, offer, cashback, percentage or anything free/)
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
  // Item prices and charges are in the data, so the model can explain a total
  assert.deepEqual(orders[0].items, ['1 × Godaan @ ₹249', '2 × Gitanjali @ ₹411'])
  assert.equal(orders[0].shipping, '₹50')
  assert.equal('tax' in orders[0], false)
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

// ── Limits ──────────────────────────────────────────────────────────────────

test('Shopping assistant: a customer over 30 runs an hour is handed over without an OpenAI call; other customers are not', async () => {
  const busy = { organization: { ...organization, id: 'org-busy' }, contact: { id: 'c-busy' } }
  const handover = () => scriptedOpenAI([[['not_a_shopping_question', { reason: 'policy' }]]])
  for (let run = 0; run < 30; run++) {
    assert.deepEqual(await runShoppingAssistant(input(fakeDb(), handover().fetcher, 'hi', busy)), { handled: false, reason: 'policy' })
  }
  const openai = handover()
  assert.deepEqual(await runShoppingAssistant(input(fakeDb(), openai.fetcher, 'hi', busy)), { handled: false, reason: 'rate_limited' })
  assert.equal(openai.requests.length, 0)
  // The same store's other customers still get answers
  const other = handover()
  assert.deepEqual(await runShoppingAssistant(input(fakeDb(), other.fetcher, 'hi', { ...busy, contact: { id: 'c-other' } })), { handled: false, reason: 'policy' })
  assert.equal(other.requests.length, 1)
})

test('Shopping assistant: a store over 600 runs an hour is handed over, whoever is asking', async () => {
  for (let run = 0; run < 600; run++) checkRateLimit('assistant:org:org-flooded', 600, 60 * 60 * 1000)
  const openai = scriptedOpenAI([[['not_a_shopping_question', { reason: 'policy' }]]])
  const flooded = { organization: { ...organization, id: 'org-flooded' }, contact: { id: 'c-new' } }
  assert.deepEqual(await runShoppingAssistant(input(fakeDb(), openai.fetcher, 'hi', flooded)), { handled: false, reason: 'rate_limited' })
  assert.equal(openai.requests.length, 0)
})

test('Shopping assistant: a slow OpenAI answer is given up on; other failures still reach the caller', async () => {
  let signal
  const slow = async (_url, init) => { signal = init.signal; throw new DOMException('The operation was aborted due to timeout', 'TimeoutError') }
  assert.deepEqual(await runShoppingAssistant(input(fakeDb(), slow)), { handled: false, reason: 'openai_timeout' })
  assert.ok(signal instanceof AbortSignal)
  // The webhook logs anything else and lets the FAQ chatbot answer
  await assert.rejects(runShoppingAssistant(input(fakeDb(), async () => { throw new Error('ECONNRESET') })), /ECONNRESET/)
})

test('Shopping assistant: the model reads the chat without the log lines, and only the last turns within the budget', async () => {
  const history = [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: '[Sent product: Godaan – Munshi Premchand (Hindi) · SKU BK-GODAAN]' },
    { role: 'assistant', content: '[Sent payment request for Order #ORD-1 (₹249)]' },
    { role: 'assistant', content: '  ' },
    { role: 'assistant', content: 'Here is Godaan.' },
    { role: 'user', content: 'any tagore books?' },
  ]
  const openai = scriptedOpenAI([[['not_a_shopping_question', { reason: 'x' }]]])
  await runShoppingAssistant(input(fakeDb(), openai.fetcher, 'and premchand?', { history }))
  assert.deepEqual(openai.requests[0].messages.slice(1, -1), [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Here is Godaan.' }, { role: 'user', content: 'any tagore books?' }])
  assert.equal(openai.requests[0].messages.at(-1).content, 'and premchand?')
  // At most the last 8 turns
  const long = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turn ${i}` }))
  assert.deepEqual(modelHistory(long).map((turn) => turn.content), ['turn 4', 'turn 5', 'turn 6', 'turn 7', 'turn 8', 'turn 9', 'turn 10', 'turn 11'])
  // At most 4,000 characters in all: the oldest turns go first, the newest is clipped rather than dropped
  const big = [{ role: 'user', content: 'a'.repeat(3000) }, { role: 'assistant', content: 'b'.repeat(1500) }, { role: 'user', content: 'c'.repeat(1000) }]
  assert.deepEqual(modelHistory(big).map((turn) => [turn.role, turn.content.length]), [['assistant', 1500], ['user', 1000]])
  assert.deepEqual(modelHistory([{ role: 'user', content: 'x'.repeat(5000) }]).map((turn) => turn.content.length), [4000])
})

// ── Checking the reply ──────────────────────────────────────────────────────

test('Shopping assistant: a price the tools did not return is corrected once, and the restated reply is sent', async () => {
  const database = fakeDb()
  const openai = scriptedOpenAI([
    [['search_products', { query: 'godaan' }]],
    [['reply_to_customer', { message: 'Godaan is just ₹199 today!', product_ids: ['BK-GODAAN'] }]],
    [['reply_to_customer', { message: 'Godaan is ₹249. Tap it to add it to your cart.', product_ids: ['BK-GODAAN'] }]],
  ])
  let result
  const sent = await withWhatsApp(async () => { result = await runShoppingAssistant(input(database, openai.fetcher)) })
  assert.deepEqual(result, { handled: true, productsSent: 1 })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].interactive.action.product_retailer_id, 'BK-GODAAN')
  assert.equal(sent[0].interactive.body.text, 'Godaan is ₹249. Tap it to add it to your cart.')
  assert.equal(database.tables.messages[0].body, 'Godaan is ₹249. Tap it to add it to your cart.')
  // The model got the result its call was owed, then the correction, and was asked for a tool call again
  assert.equal(openai.requests.length, 3)
  const asked = openai.requests[2].messages
  assert.equal(asked.at(-2).role, 'tool')
  assert.match(asked.at(-2).content, /Not sent \(amount 199\)/)
  assert.deepEqual(asked.at(-1), { role: 'system', content: 'Do not mention prices, discounts, coupons, codes or offers that the tools did not return. Restate your reply using only tool results.' })
  assert.equal(openai.requests[2].tool_choice, 'required')
})

test('Shopping assistant: a reply that still quotes an unknown amount after the correction is never sent', async () => {
  const database = fakeDb()
  const openai = scriptedOpenAI([
    [['search_products', { query: 'godaan' }]],
    [['reply_to_customer', { message: 'Godaan is ₹199!', product_ids: ['BK-GODAAN'] }]],
    [['reply_to_customer', { message: 'Only ₹189 for Godaan!', product_ids: ['BK-GODAAN'] }]],
    [['reply_to_customer', { message: 'Godaan is ₹249.', product_ids: ['BK-GODAAN'] }]],
  ])
  let result
  const sent = await withWhatsApp(async () => { result = await runShoppingAssistant(input(database, openai.fetcher)) })
  assert.deepEqual(result, { handled: false, reason: 'unverified_offer' })
  assert.equal(sent.length, 0)
  assert.equal(database.tables.messages.length, 0)
  assert.equal(openai.requests.length, 3) // no second correction
})

test('Shopping assistant: the correction still gets its round when the bad reply came in the last one', async () => {
  const openai = scriptedOpenAI([
    [['search_products', { query: 'godaan' }]],
    [['search_products', { query: 'premchand' }]],
    [['search_products', { query: 'hindi' }]],
    [['reply_to_customer', { message: 'Godaan at ₹99 only!', product_ids: ['BK-GODAAN'] }]],
    [['reply_to_customer', { message: 'Godaan is ₹249.', product_ids: ['BK-GODAAN'] }]],
  ])
  let result
  const sent = await withWhatsApp(async () => { result = await runShoppingAssistant(input(fakeDb(), openai.fetcher)) })
  assert.deepEqual(result, { handled: true, productsSent: 1 })
  assert.equal(sent[0].interactive.body.text, 'Godaan is ₹249.')
  assert.equal(openai.requests.length, 5)
})

test('Shopping assistant: prices the tools returned go straight out, in any notation, with sale and order amounts', async () => {
  const database = fakeDb({ products: [SALE_PRODUCT] })
  const openai = scriptedOpenAI([
    [['search_products', { query: 'books' }]],
    [['reply_to_customer', { message: 'Godaan is Rs. 249/-, Gitanjali INR 199 and Malgudi Days ₹199 (was ₹299). Tap one to add it to your cart.', product_ids: ['BK-GODAAN', 'BK-GITANJALI', 'BK-MALGUDI'] }]],
  ])
  let result
  const sent = await withWhatsApp(async () => { result = await runShoppingAssistant(input(database, openai.fetcher)) })
  assert.deepEqual(result, { handled: true, productsSent: 3 })
  assert.equal(openai.requests.length, 2)
  assert.equal(sent[0].interactive.type, 'product_list')
  // The model sees the full price of a product on sale
  const found = JSON.parse(openai.requests[1].messages.find((m) => m.role === 'tool').content)
  assert.deepEqual(found.find((product) => product.retailer_id === 'BK-MALGUDI').list_price, 299)
  assert.equal('list_price' in found.find((product) => product.retailer_id === 'BK-GODAAN'), false)

  // Totals, item prices and charges from the customer's orders
  const orders = scriptedOpenAI([
    [['get_my_orders', {}]],
    [['reply_to_customer', { message: 'Your order ORD-261018-Q72T comes to ₹1,121.00: 1 × Godaan @ ₹249, 2 × Gitanjali @ ₹411 (₹822) and ₹50 shipping. It has shipped with Delhivery, tracking DL123.' }]],
  ])
  const text = await withWhatsApp(async () => { result = await runShoppingAssistant(input(fakeDb(), orders.fetcher, 'Why 1121?')) })
  assert.deepEqual(result, { handled: true, productsSent: 0 })
  assert.equal(text[0].type, 'text')
})

test('Shopping assistant: a percentage or an offer word is corrected, in English or Hinglish', async () => {
  const database = fakeDb()
  const openai = scriptedOpenAI([
    [['search_products', { query: 'godaan' }]],
    [['reply_to_customer', { message: 'Use code BOOK10 for 10% off Godaan!', product_ids: ['BK-GODAAN'] }]],
    [['reply_to_customer', { message: 'Here is Godaan at ₹249.', product_ids: ['BK-GODAAN'] }]],
  ])
  const sent = await withWhatsApp(async () => { await runShoppingAssistant(input(database, openai.fetcher)) })
  assert.equal(sent[0].interactive.body.text, 'Here is Godaan at ₹249.')
  assert.match(openai.requests[2].messages.at(-2).content, /Not sent \(percentage\)/)

  const offer = scriptedOpenAI([
    [['search_products', { query: 'godaan' }]],
    [['reply_to_customer', { message: 'Haan ji, Godaan par aaj offer hai: free delivery!', product_ids: ['BK-GODAAN'] }]],
    [['reply_to_customer', { message: 'Haan ji, Godaan ₹249 mein available hai.', product_ids: ['BK-GODAAN'] }]],
  ])
  const hinglish = await withWhatsApp(async () => { await runShoppingAssistant(input(fakeDb(), offer.fetcher, 'godaan hai kya?')) })
  assert.equal(hinglish[0].interactive.body.text, 'Haan ji, Godaan ₹249 mein available hai.')
  assert.match(JSON.parse(offer.requests[2].messages.at(-2).content).error, /^Not sent \(offer "offer"\)/)
})

test('Shopping assistant: what the reply check lets through and what it holds back', () => {
  const prices = [249, 199]
  // Amounts the tools returned, in any notation, give or take a rupee of rounding
  assert.equal(unverifiedClaim('Godaan is ₹249 and Gitanjali Rs.199/-', prices), null)
  assert.equal(unverifiedClaim('Godaan costs 249 rupees, Gitanjali 199 rupaye', prices), null)
  assert.equal(unverifiedClaim('Godaan: INR 249.00; Gitanjali: ₹ 1,99', prices), null)
  assert.equal(unverifiedClaim('Godaan costs ₹248.', prices), null)
  assert.equal(unverifiedClaim('Total ₹1,121.00', [1121]), null)
  assert.equal(unverifiedClaim('That is $12.50', [12.5]), null)
  // Amounts they did not
  assert.equal(unverifiedClaim('Godaan costs ₹260.', prices), 'amount 260')
  assert.equal(unverifiedClaim('Both for 448/-', prices), 'amount 448')
  assert.equal(unverifiedClaim('Only 1,500 rupees', prices), 'amount 1500')
  assert.equal(unverifiedClaim('Godaan is 199.00 now', [249]), 'amount 199')
  // Order numbers, tracking numbers, phone numbers, dates and counts are not amounts
  assert.equal(unverifiedClaim('Order ORD-261018-Q72T, placed 18.10.2026 and on 2026-10-18, tracking DL123, phone 6303012453, 3 books, 1.5L', []), null)
  // Percentages and offer talk, however it is written
  assert.equal(unverifiedClaim('Get 10% off today', prices), 'percentage')
  assert.equal(unverifiedClaim('20 percent off', prices), 'percentage')
  assert.equal(unverifiedClaim('Free delivery on Godaan!', prices), 'offer "Free"')
  assert.equal(unverifiedClaim('Use coupon BOOK10', prices), 'offer "coupon"')
  assert.equal(unverifiedClaim('Use code BOOK10 at checkout', prices), 'offer "code"')
  assert.equal(unverifiedClaim('Aaj Godaan par chhoot hai', prices), 'offer "chhoot"')
  assert.equal(unverifiedClaim('Delivery muft hai', prices), 'offer "muft"')
  assert.equal(unverifiedClaim('Offer hai bhai', prices), 'offer "Offer"')
  assert.equal(unverifiedClaim('Cashback milega', prices), 'offer "Cashback"')
  assert.equal(unverifiedClaim('ఈ రోజు తగ్గింపు ఉంది', prices), 'offer "తగ్గింపు"')
  assert.equal(unverifiedClaim('मुफ्त डिलीवरी', prices), 'offer "मुफ्त"')
  // Everyday phrases are not offers
  assert.equal(unverifiedClaim('Feel free to ask me anything.', prices), null)
  assert.equal(unverifiedClaim('Your tracking code is DL123 and the PIN code is 500081.', prices), null)
  // Product and item names are quoted as they are, whatever is in them
  assert.equal(unverifiedClaim('Sugar Free Biscuits 2.5 kg is ₹99.', [99], ['Sugar Free Biscuits 2.5 kg']), null)
  assert.equal(unverifiedClaim('Sugar Free Biscuits 2.5 kg is ₹99 with free delivery.', [99], ['Sugar Free Biscuits 2.5 kg']), 'offer "free"')
})
