// The AI shopping assistant, with OpenAI scripted and WhatsApp faked. Nothing leaves the machine.
// The run limiter is in memory and shared by every test in this process: the tests below make
// well under the 30 runs an hour one customer ("c1" of "org") is allowed; tests that need several
// runs, and the limit tests, use customer ids of their own.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const { runShoppingAssistant, shoppingAssistantEnabled, searchTerms, scoreProduct, ilikePattern, wordFilter, rankFound, unverifiedClaim, modelHistory } = require('../lib/commerce/shopping-assistant.ts')
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

// ── A PostgREST-like query builder ──────────────────────────────────────────

/** The parts of a filter list, split on the commas outside parentheses and quotes. */
function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let quoted = false
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '\\') i++
      else if (ch === '"') quoted = false
    } else if (ch === '"') quoted = true
    else if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1 }
  }
  parts.push(text.slice(start))
  return parts
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A LIKE pattern, quoted the PostgREST way when it holds reserved characters, as a regex. */
function likePattern(value) {
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\(.)/g, '$1')
  let source = ''
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '\\' && i + 1 < value.length) source += escapeRegExp(value[++i])
    else if (ch === '%') source += '.*'
    else if (ch === '_') source += '.'
    else source += escapeRegExp(ch)
  }
  return new RegExp(`^${source}$`, 'is')
}

/** A PostgREST filter string as a row predicate. A plain list is an `or`, as `.or(...)` sends it. */
function parseFilter(text) {
  const group = text.match(/^(and|or)\((.*)\)$/s)
  if (group) {
    const parts = splitTopLevel(group[2]).map(parseFilter)
    return group[1] === 'and' ? (row) => parts.every((part) => part(row)) : (row) => parts.some((part) => part(row))
  }
  if (splitTopLevel(text).length > 1) return parseFilter(`or(${text})`)
  const [column, op, ...rest] = text.split('.')
  const value = rest.join('.')
  switch (op) {
    case 'eq': return (row) => String(row[column]) === value
    case 'is': return (row) => (value === 'null' ? row[column] == null : String(row[column]) === value)
    case 'ilike': { const pattern = likePattern(value); return (row) => pattern.test(String(row[column] ?? '')) }
    default: throw new Error(`Unsupported filter: ${text}`)
  }
}

/** A small query builder: filters as PostgREST would, orders, pages, records every query, inserts into messages. */
function fakeDb(extra = {}) {
  const tables = { commerce_products: [...PRODUCTS, ...(extra.products || [])], commerce_orders: [...ORDERS, ...(extra.orders || [])], messages: [] }
  const queries = []
  return {
    tables,
    queries,
    from(table) {
      const filters = []
      const query = { table, or: [], order: null, limit: null, range: null }
      const builder = {
        select() { return builder },
        eq(column, value) { filters.push((row) => row[column] === value); return builder },
        or(text) { query.or.push(text); filters.push(parseFilter(text)); return builder },
        lte(column, value) { filters.push((row) => row[column] <= value); return builder },
        gte(column, value) { filters.push((row) => row[column] >= value); return builder },
        order(column, options = {}) { query.order = [column, options.ascending === false ? -1 : 1]; return builder },
        limit(count) { query.limit = count; return builder },
        range(from, to) { query.range = [from, to]; return builder },
        insert: async (row) => { tables.messages.push(row); return { error: null } },
        then(resolve, reject) {
          queries.push(query)
          let rows = tables[table].filter((row) => filters.every((f) => f(row)))
          if (query.order) {
            const [column, direction] = query.order
            rows = [...rows].sort((a, b) => direction * String(a[column]).localeCompare(String(b[column])))
          }
          if (query.range) rows = rows.slice(query.range[0], query.range[1] + 1)
          else if (query.limit !== null) rows = rows.slice(0, query.limit)
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject)
        },
      }
      return builder
    },
  }
}

/** The product searches a run made, in order. */
const productQueries = (database) => database.queries.filter((query) => query.table === 'commerce_products')

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

/** What the first tool call returned to the model. */
const toolResult = (openai) => JSON.parse(openai.requests[1].messages.find((m) => m.role === 'tool').content)

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
  assert.doesNotMatch(openai.requests[0].messages[0].content, /delivery is free/)
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

// ── Searching ───────────────────────────────────────────────────────────────

test('Shopping assistant: a search word becomes an ilike filter with its wildcards escaped and reserved characters quoted', () => {
  assert.equal(ilikePattern('premchand'), '%premchand%')
  assert.equal(wordFilter('premchand'), 'title.ilike.%premchand%,description.ilike.%premchand%,category.ilike.%premchand%')
  // LIKE wildcards in the word stand for themselves
  assert.equal(ilikePattern('lot_42'), '%lot\\_42%')
  assert.equal(ilikePattern('100%'), '%100\\%%')
  assert.equal(ilikePattern('a\\b'), '%a\\\\b%')
  // A comma, parenthesis, quote or space would end the value in PostgREST's or(...) syntax: quoted, with the escapes doubled
  assert.equal(ilikePattern('tom,dick'), '"%tom,dick%"')
  assert.equal(ilikePattern('r(k)'), '"%r(k)%"')
  assert.equal(ilikePattern('say "hi"'), '"%say \\"hi\\"%"')
  assert.equal(ilikePattern('50%,off'), '"%50\\\\%,off%"')
  // Read back the way PostgREST reads them, the filters find the word as typed and nothing else
  const matches = (word, title) => parseFilter(wordFilter(word))({ title, description: '', category: '' })
  assert.equal(matches('lot_42', 'Lot_42 Notebook'), true)
  assert.equal(matches('lot_42', 'Lot 42 Notebook'), false)
  assert.equal(matches('tom,dick', 'Tom,Dick & Harry'), true)
  assert.equal(matches('50%,off', 'Big 50%,off sale'), true)
  assert.equal(matches('50%,off', 'Big 50,off sale'), false)
  assert.equal(matches('say "hi"', 'Say "Hi" Mug'), true)
  assert.equal(matches('premchand', 'Nothing by him'), false)
})

test('Shopping assistant: how the products a search found are ranked', () => {
  const row = (retailer_id, title, extra = {}) => ({ retailer_id, title, price: 100, currency: 'INR', ...extra })
  // More of the words first; a product with too few of them is left out
  const shirts = [row('C', 'Blue Shirt'), row('B', 'Red Shirt'), row('A', 'Red Cotton Shirt'), row('D', 'Red Socks')]
  assert.deepEqual(rankFound(shirts, ['red', 'cotton', 'shirt']).map((p) => p.retailer_id), ['A', 'B'])
  // A word found on few products outweighs one found on many
  const shelf = Array.from({ length: 20 }, (_, i) => row(`B${i}`, `Book ${i}`, { category: 'Books' }))
  const author = row('R', 'The Hindu View of Life – S. Radhakrishnan', { category: 'Books' })
  assert.deepEqual(rankFound([...shelf, author], ['radhakrishnan', 'books']).map((p) => p.retailer_id), ['R'])
  // A word in the title ranks ahead of the same word in the description, and both stay
  const byHim = row('BY', 'Indian Philosophy', { description: 'By S. Radhakrishnan' })
  const aboutHim = row('ABOUT', 'Radhakrishnan: A Biography')
  assert.deepEqual(rankFound([byHim, aboutHim], ['radhakrishnan']).map((p) => p.retailer_id), ['ABOUT', 'BY'])
  // A word flagged as misspelt counts by near spelling, and beats the broad word the others have
  const godaan = row('G', 'Godaan – Munshi Premchand', { category: 'Books' })
  assert.deepEqual(rankFound([...shelf, godaan], ['premchnd', 'books'], ['premchnd']).map((p) => p.retailer_id), ['G'])
  assert.equal(rankFound([...shelf, godaan], ['premchnd', 'books']).some((p) => p.retailer_id === 'G'), false)
  // The whole description counts, though the model only sees the start of it
  const long = row('L', 'Collected Stories', { description: `${'x'.repeat(200)} by Premchand` })
  assert.deepEqual(rankFound([long], ['premchand']).map((p) => [p.retailer_id, p.description.length]), [['L', 160]])
  // At most 10, and nothing for a word that is nowhere
  assert.equal(rankFound(shelf, ['books']).length, 10)
  assert.deepEqual(rankFound(shelf, ['cricket']), [])
})

test('Shopping assistant: the first three words are each searched on their own, and products with more of the words come first', async () => {
  // 150 books of all kinds and one by the author asked for: one search for "radhakrishnan books" capped at 100 rows could miss it
  const shelf = Array.from({ length: 150 }, (_, i) => ({ organization_id: 'org', retailer_id: `BK-${String(i).padStart(3, '0')}`, title: `Book ${i}`, price: 100, currency: 'INR', category: 'Books', is_available: true }))
  const hindu = { organization_id: 'org', retailer_id: 'BK-HINDU', title: 'The Hindu View of Life – S. Radhakrishnan', price: 299, currency: 'INR', category: 'Books', is_available: true }
  const database = fakeDb({ products: [...shelf, hindu] })
  const openai = scriptedOpenAI([[['search_products', { query: 'radhakrishnan books hindu view' }]], [['not_a_shopping_question', { reason: 'done' }]]])
  await runShoppingAssistant(input(database, openai.fetcher, 'radhakrishnan books unnaya?', { contact: { id: 'c-search' } }))
  assert.deepEqual(toolResult(openai).map((product) => product.retailer_id), ['BK-HINDU'])
  // One query per word, each capped at 100 rows and finding the word anywhere on the product; the fourth word only ranks
  assert.deepEqual(productQueries(database).map((query) => [query.or, query.limit, query.range]), [
    [['is_available.is.null,is_available.eq.true', wordFilter('radhakrishnan')], 100, null],
    [['is_available.is.null,is_available.eq.true', wordFilter('books')], 100, null],
    [['is_available.is.null,is_available.eq.true', wordFilter('hindu')], 100, null],
  ])
})

test('Shopping assistant: a word spelt differently is compared by sound against the catalog, read in pages of 500 up to 2,000 products', async () => {
  // A large store: the notebooks sort after the books, so the pages reach Godaan; the pool stops at 2,000 rows although there are more
  const notebooks = Array.from({ length: 2600 }, (_, i) => ({ organization_id: 'org', retailer_id: `NB-${String(i).padStart(4, '0')}`, title: `Notebook ${i}`, price: 20, currency: 'INR', category: 'Stationery', is_available: true }))
  const database = fakeDb({ products: notebooks })
  const openai = scriptedOpenAI([[['search_products', { query: 'premchnd' }]], [['not_a_shopping_question', { reason: 'done' }]]])
  await runShoppingAssistant(input(database, openai.fetcher, 'premchnd books unnaya?', { contact: { id: 'c-pool' } }))
  assert.deepEqual(toolResult(openai).map((product) => product.retailer_id), ['BK-GODAAN'])
  const [search, ...pages] = productQueries(database)
  assert.deepEqual([search.or[1], search.limit], [wordFilter('premchnd'), 100])
  assert.deepEqual(pages.map((page) => [page.order, page.range]), [
    [['retailer_id', 1], [0, 499]],
    [['retailer_id', 1], [500, 999]],
    [['retailer_id', 1], [1000, 1499]],
    [['retailer_id', 1], [1500, 1999]],
  ])
  // Only the words found nowhere as typed are compared by sound, and a small catalog is read in one page
  const small = fakeDb()
  const mixed = scriptedOpenAI([[['search_products', { query: 'premchnd books' }]], [['not_a_shopping_question', { reason: 'done' }]]])
  await runShoppingAssistant(input(small, mixed.fetcher, 'premchnd books?', { contact: { id: 'c-pool' } }))
  assert.deepEqual(toolResult(mixed).map((product) => product.retailer_id), ['BK-GODAAN', 'BK-GITANJALI'])
  assert.deepEqual(productQueries(small).map((query) => [query.limit, query.range]), [[100, null], [100, null], [null, [0, 499]]])
  // Nothing to compare when every word was found as typed, and a number has no near spellings
  const typed = fakeDb()
  const exact = scriptedOpenAI([[['search_products', { query: 'premchand 2026' }]], [['not_a_shopping_question', { reason: 'done' }]]])
  await runShoppingAssistant(input(typed, exact.fetcher, 'premchand?', { contact: { id: 'c-pool' } }))
  assert.deepEqual(toolResult(exact).map((product) => product.retailer_id), ['BK-GODAAN'])
  assert.deepEqual(productQueries(typed).map((query) => query.range), [null, null])
})

// ── Orders ──────────────────────────────────────────────────────────────────

test('Shopping assistant: order dates are in the store\'s timezone, and delivery details come along once there are any', async () => {
  const shipped = { organization_id: 'org', contact_id: 'c-dates', order_number: 'ORD-DATES', status: 'shipped', payment_status: 'paid', payment_method: 'upi', subtotal: 249, shipping_fee: 0, tax_amount: 0, total_amount: 249, currency: 'INR', shipping_address: { carrier: 'Delhivery', tracking_number: 'DL123', tracking_url: 'https://track.example.com/DL123?ref=5%20', shipped_at: '2026-10-19T19:00:00Z' }, created_at: '2026-10-18T20:30:00Z', items: [{ title: 'Godaan', quantity: 1, unit_price: 249 }] }
  const waiting = { organization_id: 'org', contact_id: 'c-dates', order_number: 'ORD-NEW', status: 'paid', payment_status: 'paid', payment_method: 'upi', subtotal: 199, total_amount: 199, currency: 'INR', shipping_address: { city: 'Hyderabad' }, created_at: '2026-10-17T05:00:00Z', items: [] }
  const ordersFor = async (store) => {
    const openai = scriptedOpenAI([[['get_my_orders', {}]], [['reply_to_customer', { message: 'ORD-DATES shipped on 20 Oct 2026 with Delhivery, tracking DL123: https://track.example.com/DL123?ref=5%20' }]]])
    const sent = await withWhatsApp(async () => { await runShoppingAssistant(input(fakeDb({ orders: [shipped, waiting] }), openai.fetcher, 'Where is my order?', { organization: store, contact: { id: 'c-dates' } })) })
    return { orders: toolResult(openai), sent }
  }
  // 20:30 UTC on the 18th is already the 19th in India, the default
  const india = await ordersFor(organization)
  assert.deepEqual(india.orders.map((order) => [order.order_number, order.placed]), [['ORD-DATES', '19 Oct 2026'], ['ORD-NEW', '17 Oct 2026']])
  assert.deepEqual([india.orders[0].carrier, india.orders[0].tracking_number, india.orders[0].tracking_url, india.orders[0].shipped], ['Delhivery', 'DL123', 'https://track.example.com/DL123?ref=5%20', '20 Oct 2026'])
  // Nothing about delivery until the team enters it
  assert.deepEqual(Object.keys(india.orders[1]).filter((key) => ['carrier', 'tracking_number', 'tracking_url', 'shipped'].includes(key)), [])
  // The tracking link goes out as it is: its digits and "%20" are neither an amount nor a percentage
  assert.equal(india.sent.length, 1)
  assert.match(india.sent[0].text.body, /DL123\?ref=5%20$/)
  // The store's own timezone when it has one; a name Intl does not know falls back to India
  assert.equal((await ordersFor({ ...organization, timezone: 'America/New_York' })).orders[0].placed, '18 Oct 2026')
  assert.equal((await ordersFor({ ...organization, timezone: 'Mars/Olympus' })).orders[0].placed, '19 Oct 2026')
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
  // A quoted name inside another quoted name does not cut that one up
  assert.equal(unverifiedClaim('Track it at https://t.co/DL123?ref=5%20', [], ['DL123', 'https://t.co/DL123?ref=5%20']), null)
})

test('Shopping assistant: "offer" as a verb is not an offer, unless something priced follows it', () => {
  assert.equal(unverifiedClaim('Yes, we offer two sizes, S and M.', []), null)
  assert.equal(unverifiedClaim('We also offer Cash on Delivery. It ships in 2 days.', []), null)
  assert.equal(unverifiedClaim('The store currently offers gift wrapping', []), null)
  assert.equal(unverifiedClaim('We offer Godaan at ₹249 today', [249]), 'offer "offer"')
  assert.equal(unverifiedClaim('We offer it at 10% less', []), 'percentage')
  assert.equal(unverifiedClaim('We offer 2 sizes. Only ₹99 today!', [249]), 'amount 99')
  // The noun stays an offer, whoever is talking
  assert.equal(unverifiedClaim('We have offer on Godaan', []), 'offer "offer"')
  assert.equal(unverifiedClaim('We have an offer for you', []), 'offer "offer"')
  assert.equal(unverifiedClaim('Aaj special offers chal rahe hai', []), 'offer "offers"')
  // More everyday phrases that are not offers, and one that is
  assert.equal(unverifiedClaim('Your order code is ORD-1; scan the QR code at the counter.', []), null)
  assert.equal(unverifiedClaim('It is sugar-free, gluten free and comes in free size.', []), null)
  assert.equal(unverifiedClaim('Hassle free returns within 7 days.', []), null)
  assert.equal(unverifiedClaim('Free returns within 7 days.', []), 'offer "Free"')
})

test('Shopping assistant: prices without a currency sign and deal wording are checked too', async () => {
  const prices = [249, 199]
  // A whole number next to a price word is an amount, in English and in mixed languages
  assert.equal(unverifiedClaim('Godaan is just 179 today, hurry!', prices), 'amount 179')
  assert.equal(unverifiedClaim('Godaan costs 300.', prices), 'amount 300')
  assert.equal(unverifiedClaim('Godaan @ 150', prices), 'amount 150')
  assert.equal(unverifiedClaim('Godaan is only 1,500', prices, ['Godaan']), 'amount 1500')
  assert.equal(unverifiedClaim('Godaan 99 ki vastundi', prices), 'amount 99')
  assert.equal(unverifiedClaim('Godaan 99 mein milega', prices), 'amount 99')
  assert.equal(unverifiedClaim('Godaan is 120 only', prices, ['Godaan']), 'amount 120')
  assert.equal(unverifiedClaim('You can get it for only 120.', prices), 'amount 120')
  assert.equal(unverifiedClaim('Just 179 only, hurry!', prices), 'amount 179')
  assert.equal(unverifiedClaim('Godaan is just 249 today and Gitanjali costs 199.', prices), null)
  // Quantities, times and counts are not prices
  assert.equal(unverifiedClaim('Only 3 left in stock, and only 2 in the blue cover.', prices), null)
  assert.equal(unverifiedClaim('Just 2 days for delivery. We have only 10 colours.', prices), null)
  // Stock and quantity answers: "only N" with no product or price word in the sentence, "N each", "N ki/ku"
  assert.equal(unverifiedClaim('How many? Only 2.', prices), null)
  assert.equal(unverifiedClaim('Yes, only 1.', prices), null)
  assert.equal(unverifiedClaim('Order 2 only, stock is limited', prices), null)
  assert.equal(unverifiedClaim('We have 5 each in S, M and L.', prices), null)
  assert.equal(unverifiedClaim('Size 8 ki chappal available hai', prices), null)
  assert.equal(unverifiedClaim('Mee order 2 ki update ivvali', prices), null)
  assert.equal(unverifiedClaim('Rendu books 2 ku pampistham', prices), null)
  assert.equal(unverifiedClaim('Godaan is in stock. How many? Only 2.', prices, ['Godaan']), null)
  // A no-break space the model wrote is not taken for a product name
  assert.equal(unverifiedClaim('Yes,\u00a0only 1.', prices), null)
  // Deals in any wording
  assert.equal(unverifiedClaim('Flat 50 off on Godaan, now 199 only', prices), 'offer "Flat 50"')
  assert.equal(unverifiedClaim('Buy 2 get 1 on all books this week!', prices), 'offer "Buy 2 get 1"')
  assert.equal(unverifiedClaim('BOGO on all books', prices), 'offer "BOGO"')
  assert.equal(unverifiedClaim('Great deals on all books', prices), 'offer "deals"')
  assert.equal(unverifiedClaim('Get Godaan at half price today', prices), 'offer "half price"')
  assert.equal(unverifiedClaim('Save ₹50 on Godaan', prices), 'offer "Save ₹50"')
  assert.equal(unverifiedClaim('50 off on Godaan', prices), 'offer "50 off"')
  // Everyday words that are not deals
  assert.equal(unverifiedClaim('We deal in old and rare books. You can save it to your cart.', prices), null)
  assert.equal(unverifiedClaim('Yes, Godaan is for sale at ₹249.', prices), null)
  assert.equal(unverifiedClaim('After-sale support is available for every order, and pre-sales questions are welcome.', prices), null)
  // A sale only when a product the tools returned is on sale in the catalog
  assert.equal(unverifiedClaim('Ee roju sale lo Godaan', prices), 'offer "sale"')
  assert.equal(unverifiedClaim('Malgudi Days is on sale: ₹199 (was ₹299)', [199, 299]), 'offer "on sale"')
  assert.equal(unverifiedClaim('Malgudi Days is on sale: ₹199 (was ₹299)', [199, 299], [], { onSale: true }), null)

  // The assistant tells the check when a product it found is on sale
  const openai = scriptedOpenAI([
    [['search_products', { query: 'malgudi' }]],
    [['reply_to_customer', { message: 'Malgudi Days is on sale: ₹199 (was ₹299).', product_ids: ['BK-MALGUDI'] }]],
  ])
  let result
  const sent = await withWhatsApp(async () => { result = await runShoppingAssistant(input(fakeDb({ products: [SALE_PRODUCT] }), openai.fetcher, 'malgudi days?')) })
  assert.deepEqual(result, { handled: true, productsSent: 1 })
  assert.equal(openai.requests.length, 2)
  assert.match(JSON.stringify(sent[0]), /on sale/)
})

test('Shopping assistant: a store that ships free above a threshold may say so; nothing else free gets through', async () => {
  const store = { freeShippingThreshold: 500 }
  assert.equal(unverifiedClaim('Godaan is ₹249. Free delivery on orders above ₹500!', [249], [], store), null)
  assert.equal(unverifiedClaim('Shipping is free above Rs. 500', [], [], store), null)
  assert.equal(unverifiedClaim('Order ₹500+ and delivery free hai', [], [], store), null)
  // Without the threshold the phrase is an offer like any other; with it, only that amount and that phrase
  assert.equal(unverifiedClaim('Free delivery on orders above ₹500!', [249]), 'offer "Free"')
  assert.equal(unverifiedClaim('Free delivery above ₹400', [249], [], store), 'amount 400')
  assert.equal(unverifiedClaim('Free delivery above ₹500 and a free bookmark', [249], [], store), 'offer "free"')
  assert.equal(unverifiedClaim('Free gift above ₹500', [], [], store), 'offer "Free"')
  assert.equal(unverifiedClaim('Delivery muft hai', [], [], store), 'offer "muft"')
  // The model is told, and its reply goes out as written
  const openai = scriptedOpenAI([
    [['search_products', { query: 'godaan' }]],
    [['reply_to_customer', { message: 'Godaan is ₹249. Free delivery on orders of ₹500 and above!', product_ids: ['BK-GODAAN'] }]],
  ])
  const withThreshold = { organization: { ...organization, commerce_free_shipping_threshold: '500' }, contact: { id: 'c-free' } }
  const sent = await withWhatsApp(async () => { await runShoppingAssistant(input(fakeDb(), openai.fetcher, 'godaan hai?', withThreshold)) })
  assert.match(openai.requests[0].messages[0].content, /delivery is free on orders of ₹500 and above/)
  assert.equal(openai.requests.length, 2)
  assert.equal(sent[0].interactive.body.text, 'Godaan is ₹249. Free delivery on orders of ₹500 and above!')
})
