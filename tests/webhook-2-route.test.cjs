// Runs the Meta webhook route end to end against an in-memory database, a fake Meta API and a fake
// OpenAI, with the flow engine, the commerce handlers and the shopping assistant replaced by stand-ins
// that record what reached them: payment captures while the store is off, the notice after an AI
// hand-off, how flow replies are stored, the FAQ chatbot's run budget and bot replies Meta refused.
// Nothing here reaches the network or a real database.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createHmac } = require('node:crypto')

const PROJECT = path.join(__dirname, '..')
const THIS_SECRET = 'this-app-secret'
const ORG = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG = '33333333-3333-4333-8333-333333333333'
const ACCOUNTS = { [ORG]: { waba: '500000000000001', phoneId: '600000000000001' }, [OTHER_ORG]: { waba: '500000000000009', phoneId: '600000000000009' } }
const CUSTOMER = '919000000000'
const HANDOFF_NOTICE = 'Thanks for your question — our team will reply here shortly.'
const GREETING = 'Hello! 👋 How can I help you today?'
const ANSWER = 'We open at 9am every day.'

process.env.NEXT_PUBLIC_META_APP_ID = '111'
process.env.META_APP_SECRET = THIS_SECRET
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.invalid'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'
delete process.env.OPENAI_API_KEY // a workspace without its own key has none

const logged = { log: [], warn: [], error: [] }
for (const level of ['log', 'warn', 'error']) {
  const original = console[level]
  console[level] = (...args) => { logged[level].push(args.map(String).join(' ')); if (!/^\[(Facebook|Flow|Commerce|Keyword Search|AI-Analytics)/.test(String(args[0]))) original(...args) }
}

/**
 * A small in-memory Postgres: eq/in filters, order, limit, insert, upsert with ON CONFLICT, update
 * and head counts. Every write is kept in `ops`, so a test can see what a row was updated with.
 * Ids never repeat across instances: the route's rate limiter remembers contacts by id.
 */
let nextId = 1
function fakeDb() {
  const tables = {}
  const ops = []
  const rows = (table) => (tables[table] ||= [])
  return {
    tables,
    ops,
    seed(table, list) { rows(table).push(...list) },
    rpc: async () => ({ data: null, error: null }),
    from(table) {
      const filters = []
      const state = { op: 'select', payload: null, options: {}, columns: '*', count: false, limit: null, order: null, single: false, maybeSingle: false }
      const builder = {
        select(requested = '*', options = {}) { if (state.op === 'select') { state.columns = requested; if (options.head && options.count) state.count = true } return builder },
        insert(data) { state.op = 'insert'; state.payload = [].concat(data); return builder },
        upsert(data, options) { state.op = 'upsert'; state.payload = [].concat(data); state.options = options || {}; return builder },
        update(data) { state.op = 'update'; state.payload = data; return builder },
        delete() { state.op = 'delete'; return builder },
        eq(column, value) { filters.push({ column, test: (row) => row[column] === value }); return builder },
        in(column, values) { filters.push({ column, test: (row) => values.includes(row[column]) }); return builder },
        order(column, options) { state.order = { column, ascending: options?.ascending !== false }; return builder },
        limit(count) { state.limit = count; return builder },
        single() { state.single = true; return builder },
        maybeSingle() { state.maybeSingle = true; return builder },
        then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject) },
      }
      const project = (row) => state.columns === '*' ? row : Object.fromEntries(state.columns.split(',').map((column) => column.trim()).map((column) => [column, row[column]]))
      function run() {
        const matching = () => rows(table).filter((row) => filters.every((filter) => filter.test(row)))
        const stamp = (row) => ({ id: `${table}-${nextId++}`, created_at: new Date().toISOString(), ...row })
        if (state.op !== 'select') ops.push({ table, op: state.op, payload: state.payload, filters: filters.map((filter) => filter.column) })
        let data
        if (state.op === 'select') {
          data = matching()
          if (state.order) {
            const { column, ascending } = state.order
            data = [...data].sort((a, b) => (a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0) * (ascending ? 1 : -1))
          }
          if (state.limit != null) data = data.slice(0, state.limit)
          if (state.count) return { data: null, error: null, count: data.length }
          data = data.map(project)
        } else if (state.op === 'insert') {
          data = state.payload.map(stamp)
          rows(table).push(...data)
        } else if (state.op === 'upsert') {
          const keys = String(state.options.onConflict || '').split(',')
          data = []
          for (const row of state.payload) {
            const existing = rows(table).find((candidate) => keys.every((key) => candidate[key] === row[key]))
            if (existing) { if (!state.options.ignoreDuplicates) { Object.assign(existing, row); data.push(existing) } continue }
            const inserted = stamp(row)
            rows(table).push(inserted)
            data.push(inserted)
          }
        } else if (state.op === 'update') {
          data = matching()
          for (const row of data) Object.assign(row, state.payload)
        } else if (state.op === 'delete') {
          data = matching()
          tables[table] = rows(table).filter((row) => !data.includes(row))
        }
        if (state.single || state.maybeSingle) return { data: data[0] ?? null, error: state.single && !data[0] ? { code: 'PGRST116', message: 'no rows' } : null, count: null }
        return { data, error: null, count: null }
      }
      return builder
    },
  }
}

let db = fakeDb()
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }
stub(require.resolve('@supabase/supabase-js', { paths: [PROJECT] }), { createClient: () => db })

// Another run holds this customer's flow lease (the route answers 503 so Meta retries)
class FlowLockBusyError extends Error {}
// The flow engine: each test says what it does with the message. `runs` is every message it saw
const flows = { runs: [], next: async () => ({ handled: false }) }
stub(require.resolve(path.join(PROJECT, 'lib/flows/flow-executor.ts')), {
  executeFlowRuntime: async (input) => { flows.runs.push(input); return flows.next(input) },
  saveUnownedSubmission: async () => ({ handled: true, actionTaken: 'saved_submission' }),
  FlowLockBusyError,
})
// The commerce handlers record what reached them
// (`address` and `button` say what the address form and checkout button handlers do)
const commerce = { payments: [], orders: [], addresses: [], buttons: [], paymentError: null, orderError: null, address: async () => null, button: async () => ({ handled: false }) }
stub(require.resolve(path.join(PROJECT, 'lib/commerce/commerce-webhook-handler.ts')), {
  handleInboundPaymentConfirmation: async (input) => { commerce.payments.push(input); if (commerce.paymentError) throw commerce.paymentError; return null },
  handleInboundCommerceOrder: async (input) => { commerce.orders.push(input); if (commerce.orderError) throw commerce.orderError },
  handleInboundAddressSubmission: async (input) => { commerce.addresses.push(input); return commerce.address(input) },
  handleCheckoutButton: async (input) => { commerce.buttons.push(input); return commerce.button(input) },
  orderIdFromFlowToken: (token) => (String(token || '').startsWith('order_') ? String(token).slice(6) : null),
})
// The shopping assistant: off unless a test turns it on, and then it answers as told
const assistant = { enabled: false, runs: 0, result: { handled: false, reason: 'not_shopping' } }
stub(require.resolve(path.join(PROJECT, 'lib/commerce/shopping-assistant.ts')), {
  shoppingAssistantEnabled: () => assistant.enabled,
  runShoppingAssistant: async () => { assistant.runs++; return assistant.result },
})

// Fake Meta and fake OpenAI. `meta.failures` is what the next sends do instead of succeeding: an
// HTTP status Meta answers with, or an error the call throws (a timeout)
let sent = []
let replies = 0
const meta = { failures: [], withoutId: 0 }
const openai = { calls: [], embeddings: true, answer: { reply: ANSWER, isRiseTicket: false } }
global.fetch = async (input, init = {}) => {
  const url = new URL(String(input))
  if (url.hostname === 'graph.facebook.com' && url.pathname.endsWith('/messages')) {
    const failure = meta.failures.shift()
    if (failure instanceof Error) throw failure
    if (failure) return new Response(JSON.stringify({ error: { message: 'Something went wrong', code: 1 } }), { status: failure })
    sent.push(JSON.parse(init.body))
    if (meta.withoutId > 0) { meta.withoutId--; return new Response(JSON.stringify({ messaging_product: 'whatsapp' }), { status: 200 }) }
    return new Response(JSON.stringify({ messages: [{ id: `wamid.reply.${++replies}` }] }), { status: 200 })
  }
  if (url.hostname === 'api.openai.com') {
    openai.calls.push(url.pathname)
    if (url.pathname === '/v1/embeddings') {
      return openai.embeddings ? new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), { status: 200 }) : new Response('{}', { status: 500 })
    }
    // The answer is asked for as JSON; the query rewrite before it is plain text
    const content = JSON.parse(init.body).response_format ? JSON.stringify(openai.answer) : 'the same question'
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
  }
  if (url.pathname === '/api/tickets/notify') return new Response('{}', { status: 200 })
  throw new Error('Unexpected call: ' + url.href)
}

const { POST } = require(path.join(PROJECT, 'app/api/webhooks/facebook/[orgIdAndSlug]/route.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))

const organization = (extra = {}) => ({
  id: ORG, name: 'Magnetora Books', whatsapp_provider: 'facebook', whatsapp_api_token: 'TOKEN', whatsapp_phone_number_id: ACCOUNTS[ORG].phoneId,
  whatsapp_business_account_id: ACCOUNTS[ORG].waba, openai_api_key: 'sk-test', enable_ai: true, enable_commerce: false, ...extra,
})
const nowSeconds = () => Math.floor(Date.now() / 1000)
const change = (value, org = ORG) => ({ object: 'whatsapp_business_account', entry: [{ id: ACCOUNTS[org].waba, changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '15550000000', phone_number_id: ACCOUNTS[org].phoneId }, ...value } }] }] })
const message = (id, from, body) => ({ contacts: [{ wa_id: from, profile: { name: 'Teja' } }], messages: [{ id, from, timestamp: String(nowSeconds()), ...body }] })
const inbound = (id, text, from = CUSTOMER, org = ORG) => change(message(id, from, { type: 'text', text: { body: text } }), org)
const deliver = async (payload, org = ORG) => {
  const body = JSON.stringify(payload)
  const signature = 'sha256=' + createHmac('sha256', THIS_SECRET).update(body).digest('hex')
  const res = await POST(
    new NextRequest(`https://wamacrm.example.com/api/webhooks/facebook/${org}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature }, body }),
    { params: { orgIdAndSlug: org } }
  )
  return res.status
}
const fresh = (extra) => {
  db = fakeDb()
  db.seed('organizations', [organization(extra)])
  sent = []; replies = 0; meta.failures = []; meta.withoutId = 0
  flows.runs = []; flows.next = async () => ({ handled: false })
  commerce.payments = []; commerce.orders = []; commerce.addresses = []; commerce.buttons = []; commerce.paymentError = null; commerce.orderError = null
  commerce.address = async () => null; commerce.button = async () => ({ handled: false })
  delete process.env.DISABLED_MODULES; delete process.env.NEXT_PUBLIC_DISABLED_MODULES
  assistant.enabled = false; assistant.runs = 0; assistant.result = { handled: false, reason: 'not_shopping' }
  openai.calls = []; openai.embeddings = true; openai.answer = { reply: ANSWER, isRiseTicket: false }
  logged.warn = []; logged.error = []
  return db
}
const messages = () => db.tables.messages || []
const botRows = () => messages().filter((row) => row.sender_type === 'user')
const texts = () => sent.map((item) => item.text?.body ?? item.interactive?.body?.text)
const conversationUpdates = () => db.ops.filter((op) => op.table === 'conversations' && op.op === 'update')
/** The flow delegated this message to the knowledge assistant (an AI node, or the question after "Ask a question"). */
const handedToAi = () => { flows.next = async () => ({ handled: false, isRagFallback: true, actionTaken: 'ai_answers_question' }) }

test('Payment statuses: a capture is recorded although the store is off, and a failure asks Meta to retry', async () => {
  fresh({ enable_commerce: false })
  const capture = { id: 'wamid.pay.1', status: 'captured', type: 'payment', timestamp: String(nowSeconds()), recipient_id: CUSTOMER, payment: { reference_id: 'MB-1001', amount: { value: 49900, offset: 100 }, currency: 'INR', transaction: { id: 'txn-1', status: 'success' } } }
  assert.equal(await deliver(change({ statuses: [capture] })), 200)
  assert.equal(commerce.payments.length, 1, 'the capture reached the payment ledger')
  assert.equal(commerce.payments[0].organization.id, ORG)
  assert.equal(commerce.payments[0].paymentPayload.payment.reference_id, 'MB-1001')
  assert.equal(commerce.payments[0].customerPhone, CUSTOMER)
  assert.equal(messages().length, 0, 'a status is not a message')
  // Recording it failed: the capture is not acknowledged, so Meta delivers it again
  commerce.paymentError = new Error('database unavailable')
  assert.equal(await deliver(change({ statuses: [capture] })), 500)
})

test('Cart orders: the store switch stops new cart orders, and nothing else', async () => {
  fresh({ enable_commerce: false, enable_ai: false })
  const cart = change(message('wamid.cart.1', CUSTOMER, { type: 'order', order: { catalog_id: '1', product_items: [{ product_retailer_id: 'SKU-1', quantity: 2, item_price: 250, currency: 'INR' }] } }))
  assert.equal(await deliver(cart), 200)
  assert.equal(commerce.orders.length, 0, 'not an order while the store is off')
  assert.match(messages()[0].body, /WhatsApp Cart Order/, 'kept as a plain message for the agent')
  // A payment that arrives as a message is still recorded: it is for an order placed while the store was on
  assert.equal(await deliver(change(message('wamid.pay.2', CUSTOMER, { type: 'payment', payment: { reference_id: 'MB-1001', status: 'captured' } }))), 200)
  assert.equal(commerce.payments.length, 1)
  assert.equal(commerce.payments[0].customerPhone, `+${CUSTOMER}`)
  // With the store on, the cart goes to the order engine
  fresh({ enable_commerce: true, enable_ai: false })
  assert.equal(await deliver(cart), 200)
  assert.equal(commerce.orders.length, 1)
})

test('Flow replies: the inbox shows what the customer was offered, and the chat moves up', async () => {
  fresh()
  const offered = [
    { type: 'interactive_buttons', body: 'Please choose an option:', buttons: [{ id: 'books', title: 'Books' }, { id: 'support', title: 'Support' }] },
    { type: 'list_menu', body: 'Pick a category:', buttonText: 'Browse', sections: [{ title: 'Fiction', rows: [{ id: 'novels', title: 'Novels' }, { id: 'poetry', title: 'Poetry' }] }, { title: 'Non-fiction', rows: [{ id: 'history', title: 'History' }] }] },
    { type: 'native_flow', body: 'Please complete the form below:', flowPayload: { flow_id: '123456', flow_cta: 'Fill in', flow_token: 'tok-1', flow_action: 'navigate', flow_action_payload: { screen: 'START' } } },
    { type: 'text', body: 'Thanks, we received your form.' },
  ]
  flows.next = async (input) => { for (const reply of offered) await input.sendReply(reply); return { handled: true, actionTaken: 'sent' } }
  assert.equal(await deliver(inbound('wamid.in.1', 'menu')), 200)
  assert.equal(sent.length, 4, 'every reply went to Meta')
  assert.equal(sent[0].interactive.type, 'button')
  assert.deepEqual(botRows().map((row) => row.body), [
    'Please choose an option: [Books | Support]',
    'Pick a category: [Fiction: Novels, Poetry | Non-fiction: History]',
    'Please complete the form below: [Form: Fill in]',
    'Thanks, we received your form.',
  ])
  assert.deepEqual(botRows().map((row) => row.status), ['sent', 'sent', 'sent', 'sent'])
  assert.deepEqual(botRows().map((row) => row.twilio_message_sid), ['FB_wamid.reply.1', 'FB_wamid.reply.2', 'FB_wamid.reply.3', 'FB_wamid.reply.4'])
  // After each reply the chat moved up the inbox: its time, and nothing else, was updated
  const bumps = conversationUpdates().slice(1) // the first is the customer's message
  assert.equal(bumps.length, 4)
  for (const bump of bumps) {
    assert.deepEqual(Object.keys(bump.payload), ['last_message_at'])
    assert.ok(bump.filters.includes('organization_id'), 'in this workspace')
  }
  assert.equal(db.tables.conversations[0].unread_count, 1, 'a bot reply is not unread for the agent')
  assert.equal(texts().length, 4, 'nothing else was sent: a handled flow gets no notice')
})

test('Flow replies: one Meta refused is stored as failed, and does not move the chat', async () => {
  fresh()
  flows.next = async (input) => { try { await input.sendReply({ type: 'text', body: 'Welcome!' }) } catch {} return { handled: true, actionTaken: 'failed' } }
  meta.failures.push(500)
  assert.equal(await deliver(inbound('wamid.in.1', 'menu')), 200)
  assert.equal(botRows().length, 1)
  assert.equal(botRows()[0].status, 'failed')
  assert.equal(botRows()[0].twilio_message_sid, null)
  assert.match(botRows()[0].error_message, /Something went wrong/)
  assert.equal(conversationUpdates().length, 1, 'only the customer\'s message moved the chat')
})

test('AI hand-off: a question the flow handed to the AI is never left unanswered', async () => {
  // No OpenAI key: the chatbot cannot run at all
  fresh({ openai_api_key: '' })
  handedToAi()
  assert.equal(await deliver(inbound('wamid.in.1', 'Do you ship to Goa?')), 200)
  assert.deepEqual(texts(), [HANDOFF_NOTICE])
  assert.deepEqual(botRows().map((row) => [row.body, row.status, row.twilio_message_sid]), [[HANDOFF_NOTICE, 'sent', 'FB_wamid.reply.1']])
  assert.equal(openai.calls.length, 0)
  assert.equal(conversationUpdates().length, 2, 'the notice moved the chat up the inbox')

  // AI switched off for the workspace
  fresh({ enable_ai: false })
  handedToAi()
  await deliver(inbound('wamid.in.2', 'Do you ship to Goa?'))
  assert.deepEqual(texts(), [HANDOFF_NOTICE])

  // The FAQ chatbot produced nothing (its embedding call failed)
  fresh()
  handedToAi()
  openai.embeddings = false
  await deliver(inbound('wamid.in.3', 'Do you ship to Goa?'))
  assert.deepEqual(texts(), [HANDOFF_NOTICE])
  assert.ok(openai.calls.includes('/v1/embeddings'), 'the chatbot was tried first')

  // The FAQ chatbot had an answer, but Meta refused it
  fresh()
  handedToAi()
  meta.failures.push(500)
  await deliver(inbound('wamid.in.4', 'Do you ship to Goa?'))
  assert.deepEqual(texts(), [HANDOFF_NOTICE])
  assert.deepEqual(botRows().map((row) => [row.body, row.status]), [[ANSWER, 'failed'], [HANDOFF_NOTICE, 'sent']])

  // The shopping assistant and the FAQ chatbot both declined
  fresh({ enable_commerce: true })
  handedToAi()
  assistant.enabled = true
  openai.answer = { reply: '', isRiseTicket: true }
  await deliver(inbound('wamid.in.5', 'Do you ship to Goa?'))
  assert.deepEqual(texts(), [HANDOFF_NOTICE])
})

test('AI hand-off: an answer gets no notice, and a message no flow handed over stays as it was', async () => {
  fresh()
  handedToAi()
  await deliver(inbound('wamid.in.1', 'What time do you open?'))
  assert.deepEqual(texts(), [ANSWER])
  assert.deepEqual(botRows().map((row) => [row.body, row.status]), [[ANSWER, 'sent']])

  // A greeting is answered without OpenAI
  fresh()
  handedToAi()
  await deliver(inbound('wamid.in.2', 'hi'))
  assert.deepEqual(texts(), [GREETING])

  // The shopping assistant answered (it sends its own messages)
  fresh({ enable_commerce: true })
  handedToAi()
  assistant.enabled = true
  assistant.result = { handled: true, productsSent: 2 }
  await deliver(inbound('wamid.in.3', 'Do you have Dune?'))
  assert.deepEqual(texts(), [])

  // Ordinary silence stays: no key and no hand-off means nothing is sent, as before
  fresh({ openai_api_key: '' })
  await deliver(inbound('wamid.in.4', 'Do you ship to Goa?'))
  assert.deepEqual(texts(), [])
  assert.equal(botRows().length, 0)

  // A chat an agent has taken over is not interrupted, even by a flow
  fresh()
  handedToAi()
  await deliver(inbound('wamid.in.5', 'hi'))
  db.tables.conversations[0].auto_reply_enabled = false
  sent = []
  await deliver(inbound('wamid.in.6', 'Do you ship to Goa?'))
  assert.deepEqual(texts(), [])
})

test('A message Meta delivers again goes through the flow engine, then stops before the assistants', async () => {
  fresh()
  handedToAi()
  await deliver(inbound('wamid.in.1', 'What time do you open?'))
  assert.deepEqual(texts(), [ANSWER])
  assert.equal(await deliver(inbound('wamid.in.1', 'What time do you open?')), 200)
  assert.equal(flows.runs.length, 2, 'the flow engine saw the redelivery: it keeps its own record of handled messages')
  assert.equal(sent.length, 1, 'no second answer, and no hand-off notice')
  assert.equal(messages().length, 2, 'stored once, answered once')
})

test('Bot replies: a greeting or FAQ answer Meta refused, or that timed out, is stored as failed', async () => {
  fresh()
  meta.failures.push(500)
  await deliver(inbound('wamid.in.1', 'hi'))
  assert.deepEqual(botRows().map((row) => [row.body, row.status, row.twilio_message_sid]), [[GREETING, 'failed', null]])
  assert.match(botRows()[0].error_message, /Meta refused the message: 500/)

  meta.failures.push(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))
  await deliver(inbound('wamid.in.2', 'What time do you open?'))
  assert.deepEqual(botRows().slice(1).map((row) => [row.body, row.status]), [[ANSWER, 'failed']])
  assert.match(botRows()[1].error_message, /timeout/)
  assert.ok(logged.error.some((line) => line.includes('Failed to send Facebook message (FAQ answer)')))

  // The Cloud API credentials are missing in Settings
  fresh({ whatsapp_api_token: '' })
  await deliver(inbound('wamid.in.3', 'hi'))
  assert.equal(botRows()[0].status, 'failed')
  assert.match(botRows()[0].error_message, /credentials are missing/)

  // One that went through is stored as sent, with Meta's id
  fresh()
  await deliver(inbound('wamid.in.4', 'hi'))
  assert.deepEqual(botRows().map((row) => [row.status, row.twilio_message_sid, row.error_message]), [['sent', 'FB_wamid.reply.1', null]])
})

test('FAQ chatbot: its hourly run budget is per customer and per workspace', async () => {
  // The limiter is in memory and shared with the route, so a budget can be used up from here
  const { checkRateLimit } = require(path.join(PROJECT, 'lib/rate-limiter.ts'))
  const HOUR_MS = 60 * 60 * 1000
  fresh()
  const asker = '919000000001'
  await deliver(inbound('wamid.in.1', 'What time do you open?', asker))
  assert.deepEqual(texts(), [ANSWER])
  const contact = db.tables.contacts.find((row) => row.phone_number === `+${asker}`)
  for (let run = 1; run < 60; run++) assert.equal(checkRateLimit(`faq:contact:${ORG}:${contact.id}`, 60, HOUR_MS).allowed, true, `run ${run}`)

  sent = []; openai.calls = []
  await deliver(inbound('wamid.in.2', 'What time do you open?', asker))
  assert.equal(openai.calls.length, 0, 'no OpenAI call')
  assert.equal(sent.length, 0, 'no customer message')
  assert.equal(botRows().length, 1, 'no reply row')
  assert.equal(messages().length, 3, 'the message itself is stored, for an agent')
  assert.ok(logged.warn.some((line) => line.includes('FAQ chatbot hourly limit reached')), 'one log line says why')
  // Another customer of the same workspace is still answered
  await deliver(inbound('wamid.in.3', 'What time do you open?', '919000000002'))
  assert.deepEqual(texts(), [ANSWER])
  // A customer whose question a flow handed to the AI is still told the team will reply
  handedToAi()
  sent = []
  await deliver(inbound('wamid.in.4', 'Do you ship to Goa?', asker))
  assert.deepEqual(texts(), [HANDOFF_NOTICE])

  // The workspace's own budget, used up by its other customers
  db.seed('organizations', [organization({ id: OTHER_ORG, whatsapp_phone_number_id: ACCOUNTS[OTHER_ORG].phoneId, whatsapp_business_account_id: ACCOUNTS[OTHER_ORG].waba })])
  for (let run = 0; run < 1200; run++) checkRateLimit(`faq:org:${OTHER_ORG}`, 1200, HOUR_MS)
  flows.next = async () => ({ handled: false }) // an ordinary question, no flow
  sent = []; openai.calls = []
  await deliver(inbound('wamid.in.5', 'What time do you open?', '919000000003', OTHER_ORG), OTHER_ORG)
  assert.equal(openai.calls.length, 0)
  assert.equal(sent.length, 0)
  // ...while this workspace's are unaffected
  await deliver(inbound('wamid.in.6', 'What time do you open?', '919000000004'))
  assert.deepEqual(texts(), [ANSWER])
})

test('Busy flow lock: a message refused with 503 is answered in full when Meta retries it', async () => {
  // The flow engine is busy with the customer's previous message, then free on the retry, where the
  // flow hands the question to the AI (or matches nothing)
  for (const onRetry of [async () => ({ handled: false, isRagFallback: true }), async () => ({ handled: false })]) {
    fresh()
    let busy = true
    flows.next = async (input) => { if (busy) throw new FlowLockBusyError('busy'); return onRetry(input) }
    assert.equal(await deliver(inbound('wamid.in.1', 'What time do you open?')), 503)
    assert.equal(messages().length, 0, 'the refused delivery took its message back')
    assert.equal(db.tables.conversations[0].unread_count, 0, 'and the unread count it added')
    busy = false
    assert.equal(await deliver(inbound('wamid.in.1', 'What time do you open?')), 200)
    assert.deepEqual(texts(), [ANSWER], 'the retry was answered')
    assert.equal(messages().filter((row) => row.sender_type === 'contact').length, 1, 'stored once')
    assert.equal(db.tables.conversations[0].unread_count, 1, 'unread once')
    // A third delivery of the same message is a real redelivery: nothing more is sent
    assert.equal(await deliver(inbound('wamid.in.1', 'What time do you open?')), 200)
    assert.equal(sent.length, 1)
  }

  // The hand-off notice is not lost either, when the AI cannot answer on the retry
  fresh({ openai_api_key: '' })
  let busy = true
  flows.next = async () => { if (busy) throw new FlowLockBusyError('busy'); return { handled: false, isRagFallback: true } }
  assert.equal(await deliver(inbound('wamid.in.2', 'Do you ship to Goa?')), 503)
  busy = false
  assert.equal(await deliver(inbound('wamid.in.2', 'Do you ship to Goa?')), 200)
  assert.deepEqual(texts(), [HANDOFF_NOTICE])
})

test('Redelivery: a checkout button or address form handled the first time is not handled again', async () => {
  fresh({ enable_commerce: true, enable_ai: false })
  commerce.button = async () => ({ handled: true, outcome: 'cod_confirmed' })
  const tap = change(message('wamid.tap.1', CUSTOMER, { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'cod_confirm_11111111-1111-4111-8111-111111111111', title: 'Cash on Delivery' } } }))
  assert.equal(await deliver(tap), 200)
  assert.equal(commerce.buttons.length, 1)
  assert.equal(await deliver(tap), 200)
  assert.equal(commerce.buttons.length, 1, 'the redelivered tap did not reach the checkout again')
  assert.equal(flows.runs.length, 0, 'nor the flow engine')

  const form = change(message('wamid.form.1', CUSTOMER, { type: 'interactive', interactive: { type: 'nfm_reply', nfm_reply: { response_json: JSON.stringify({ flow_token: 'order_11111111-1111-4111-8111-111111111111', address_line_1: '1 MG Road' }) } } }))
  commerce.address = async () => ({ id: '11111111-1111-4111-8111-111111111111' })
  assert.equal(await deliver(form), 200)
  assert.equal(await deliver(form), 200)
  assert.equal(commerce.addresses.length, 1, 'the redelivered form did not resend the next checkout step')
  assert.equal(flows.runs.length, 0)

  // A handler that failed asks Meta to retry, and the retry reaches it again
  commerce.address = async () => { throw new Error('database unavailable') }
  const second = change(message('wamid.form.2', CUSTOMER, { type: 'interactive', interactive: { type: 'nfm_reply', nfm_reply: { response_json: JSON.stringify({ flow_token: 'order_11111111-1111-4111-8111-111111111111', address_line_1: '2 MG Road' }) } } }))
  assert.equal(await deliver(second), 500)
  commerce.address = async () => ({ id: '11111111-1111-4111-8111-111111111111' })
  assert.equal(await deliver(second), 200)
  assert.equal(commerce.addresses.length, 3, 'the retry was handled')
  commerce.button = async () => { throw new Error('database unavailable') }
  const tap2 = change(message('wamid.tap.2', CUSTOMER, { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'pay_online_11111111-1111-4111-8111-111111111111', title: 'Pay online' } } }))
  assert.equal(await deliver(tap2), 500)
  commerce.button = async () => ({ handled: true, outcome: 'payment_requested' })
  assert.equal(await deliver(tap2), 200)
  assert.equal(commerce.buttons.length, 3, 'the retried tap was handled')
  assert.equal(messages().filter((row) => row.sender_type === 'contact').length, 4, 'every message stored once')

  // A payment status keeps its own idempotency and is passed on every time
  const capture = { id: 'wamid.pay.9', status: 'captured', type: 'payment', timestamp: String(nowSeconds()), recipient_id: CUSTOMER, payment: { reference_id: 'MB-1001' } }
  await deliver(change({ statuses: [capture] }))
  await deliver(change({ statuses: [capture] }))
  assert.equal(commerce.payments.length, 2)
})

test('Module switches: no flow runs for a workspace without the Flow Builder, or with flows switched off platform-wide', async () => {
  for (const setup of [
    () => fresh({ enable_flows: false }),
    () => { fresh(); process.env.DISABLED_MODULES = 'flows' },
    () => { fresh(); process.env.NEXT_PUBLIC_DISABLED_MODULES = 'flows' },
  ]) {
    setup()
    flows.next = async (input) => { await input.sendReply({ type: 'text', body: 'Welcome to the flow' }); return { handled: true, actionTaken: 'sent' } }
    assert.equal(await deliver(inbound('wamid.in.1', 'What time do you open?')), 200)
    assert.equal(flows.runs.length, 0, 'the flow engine was not run')
    assert.deepEqual(texts(), [ANSWER], 'the FAQ chatbot answered instead')
  }
  delete process.env.DISABLED_MODULES; delete process.env.NEXT_PUBLIC_DISABLED_MODULES

  // Flow Builder on (or its column not migrated yet): flows run as before
  fresh({ enable_flows: true })
  await deliver(inbound('wamid.in.2', 'menu'))
  assert.equal(flows.runs.length, 1)
  fresh()
  await deliver(inbound('wamid.in.3', 'menu'))
  assert.equal(flows.runs.length, 1)
})

test('Module switches: commerce switched off platform-wide takes no new cart orders, and still records payments', async () => {
  fresh({ enable_commerce: true, enable_ai: false })
  process.env.DISABLED_MODULES = ' Commerce '
  const cart = change(message('wamid.cart.9', CUSTOMER, { type: 'order', order: { catalog_id: '1', product_items: [{ product_retailer_id: 'SKU-1', quantity: 1, item_price: 250, currency: 'INR' }] } }))
  assert.equal(await deliver(cart), 200)
  assert.equal(commerce.orders.length, 0, 'not an order while commerce is switched off')
  assert.match(messages()[0].body, /WhatsApp Cart Order/, 'kept as a plain message for the agent')
  assert.equal(await deliver(change(message('wamid.pay.9', CUSTOMER, { type: 'payment', payment: { reference_id: 'MB-1001', status: 'captured' } }))), 200)
  assert.equal(commerce.payments.length, 1, 'a payment for an existing order is still recorded')
  commerce.button = async () => ({ handled: true, outcome: 'cod_confirmed' })
  await deliver(change(message('wamid.tap.9', CUSTOMER, { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'cod_confirm_11111111-1111-4111-8111-111111111111', title: 'Cash on Delivery' } } })))
  assert.equal(commerce.buttons.length, 1, 'a checkout tap for an existing order is still handled')
  delete process.env.DISABLED_MODULES

  // The shopping assistant is off with it: its product cards would lead to carts no longer taken
  fresh({ enable_commerce: true })
  assistant.enabled = true
  process.env.DISABLED_MODULES = 'commerce'
  assert.equal(await deliver(inbound('wamid.in.9', 'Do you have red shoes?')), 200)
  assert.equal(assistant.runs, 0, 'the shopping assistant was not run')
  assert.deepEqual(texts(), [ANSWER], 'the FAQ chatbot answered instead')
  delete process.env.DISABLED_MODULES
  assert.equal(await deliver(inbound('wamid.in.10', 'Do you have blue shoes?')), 200)
  assert.equal(assistant.runs, 1, 'with commerce on, the assistant runs')
})

test('Cart orders and payments: a handler that keeps failing leaves the message in the inbox while Meta retries', async () => {
  fresh({ enable_commerce: true, enable_ai: false })
  const cart = change(message('wamid.cart.5', CUSTOMER, { type: 'order', order: { catalog_id: '1', product_items: [{ product_retailer_id: 'SKU-1', quantity: 1, item_price: 250, currency: 'INR' }] } }))
  const carts = () => messages().filter((row) => row.twilio_message_sid === 'FB_wamid.cart.5')
  commerce.orderError = new Error('database unavailable')
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal(await deliver(cart), 500, 'Meta is asked to retry')
    assert.equal(carts().length, 1, 'the cart stays visible to an agent between attempts')
    assert.match(carts()[0].body, /WhatsApp Cart Order/)
  }
  commerce.orderError = null
  assert.equal(await deliver(cart), 200)
  assert.equal(commerce.orders.length, 3, 'every attempt reached the order engine, which keeps its own record')
  assert.equal(carts().length, 1, 'stored once')
  assert.equal(db.tables.conversations[0].unread_count, 1, 'unread once')

  // A payment that arrives as a message, likewise
  commerce.paymentError = new Error('database unavailable')
  const payment = change(message('wamid.pay.5', CUSTOMER, { type: 'payment', payment: { reference_id: 'MB-1001', status: 'captured' } }))
  assert.equal(await deliver(payment), 500)
  assert.equal(messages().filter((row) => row.twilio_message_sid === 'FB_wamid.pay.5').length, 1, 'the payment message stays')
  commerce.paymentError = null
  assert.equal(await deliver(payment), 200)
  assert.equal(commerce.payments.length, 2, 'the retry reached the payment ledger')
  assert.equal(messages().filter((row) => row.twilio_message_sid === 'FB_wamid.pay.5').length, 1)
})

test('Bot replies: a send Meta accepted without an id is stored without a made-up one', async () => {
  fresh()
  meta.withoutId = 2
  await deliver(inbound('wamid.in.1', 'hi'))
  await deliver(inbound('wamid.in.2', 'hello'))
  assert.deepEqual(botRows().map((row) => [row.status, row.twilio_message_sid]), [['sent', null], ['sent', null]])
})
