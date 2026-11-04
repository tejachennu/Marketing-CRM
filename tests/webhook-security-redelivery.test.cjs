// Runs the Meta webhook route end to end against an in-memory database and a fake Meta API:
// redelivered messages, out-of-order status callbacks and campaign delivery logs.
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
const WABA = '500000000000001'
const PHONE_ID = '600000000000001'
const CUSTOMER = '919000000000'

process.env.NEXT_PUBLIC_META_APP_ID = '111'
process.env.META_APP_SECRET = THIS_SECRET
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.invalid'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'

for (const level of ['log', 'warn', 'error']) {
  const original = console[level]
  console[level] = (...args) => { if (!/^\[(Facebook|Flow|Commerce)/.test(String(args[0]))) original(...args) }
}

/**
 * A small in-memory Postgres: eq/in filters, order, limit, insert, upsert with ON CONFLICT, update,
 * head counts and one level of embedded select ("campaign:campaigns(organization_id)").
 * `uniqueIndex: false` is the database before the messages index migration: the upsert fails as
 * PostgREST does. `columns` names a table's real columns, so filtering on another fails like Postgres.
 */
function fakeDb({ uniqueIndex = true, columns = {} } = {}) {
  const tables = {}
  let nextId = 1
  const rows = (table) => (tables[table] ||= [])
  const db = {
    tables,
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
        eq(column, value) { filters.push({ column, test: (row) => row[column] === value }); return builder },
        in(column, values) { filters.push({ column, test: (row) => values.includes(row[column]) }); return builder },
        order(column, options) { state.order = { column, ascending: options?.ascending !== false }; return builder },
        limit(count) { state.limit = count; return builder },
        single() { state.single = true; return builder },
        maybeSingle() { state.maybeSingle = true; return builder },
        then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject) },
      }
      const project = (row, requested) => {
        if (requested === '*') return row
        const out = {}
        for (const spec of requested.split(',').map((part) => part.trim())) {
          const embed = spec.match(/^(\w+):(\w+)\((\w+)\)$/)
          if (!embed) { out[spec] = row[spec]; continue }
          const [, alias, other, column] = embed
          const parent = rows(other).find((candidate) => candidate.id === row[`${alias}_id`])
          out[alias] = parent ? { [column]: parent[column] } : null
        }
        return out
      }
      function run() {
        const known = columns[table]
        const unknown = known && filters.find((filter) => !known.includes(filter.column))
        if (unknown) return { data: null, error: { code: '42703', message: `column ${table}.${unknown.column} does not exist` }, count: null }
        const matching = () => rows(table).filter((row) => filters.every((filter) => filter.test(row)))
        const stamp = (row) => ({ id: `${table}-${nextId++}`, created_at: new Date().toISOString(), ...row })
        let data
        if (state.op === 'select') {
          data = matching()
          if (state.order) {
            const { column, ascending } = state.order
            data = [...data].sort((a, b) => (a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0) * (ascending ? 1 : -1))
          }
          if (state.limit != null) data = data.slice(0, state.limit)
          if (state.count) return { data: null, error: null, count: data.length }
          data = data.map((row) => project(row, state.columns))
        } else if (state.op === 'insert') {
          data = state.payload.map(stamp)
          rows(table).push(...data)
        } else if (state.op === 'upsert') {
          if (!uniqueIndex) return { data: null, error: { code: '42P10', message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' }, count: null }
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
        }
        if (state.single || state.maybeSingle) return { data: data[0] ?? null, error: state.single && !data[0] ? { code: 'PGRST116', message: 'no rows' } : null, count: null }
        return { data, error: null, count: null }
      }
      return builder
    },
  }
  return db
}

let db = fakeDb()
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }
stub(require.resolve('@supabase/supabase-js', { paths: [PROJECT] }), { createClient: () => db })

// Fake Meta: every message sent through the Cloud API is recorded
let sent = []
let replies = 0
global.fetch = async (input, init = {}) => {
  const url = new URL(String(input))
  if (url.hostname === 'graph.facebook.com' && url.pathname.endsWith('/messages')) {
    sent.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ messages: [{ id: `wamid.reply.${++replies}` }] }), { status: 200 })
  }
  throw new Error('Unexpected call: ' + url.href)
}

const { POST } = require(path.join(PROJECT, 'app/api/webhooks/facebook/[orgIdAndSlug]/route.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))

const organization = (extra = {}) => ({
  id: ORG, name: 'Magnetora Books', whatsapp_provider: 'facebook', whatsapp_api_token: 'TOKEN', whatsapp_phone_number_id: PHONE_ID,
  whatsapp_business_account_id: WABA, openai_api_key: 'sk-test', enable_ai: true, enable_commerce: false, ...extra,
})
const nowSeconds = () => Math.floor(Date.now() / 1000)
const change = (value) => ({ object: 'whatsapp_business_account', entry: [{ id: WABA, changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '15550000000', phone_number_id: PHONE_ID }, ...value } }] }] })
const inbound = (id, text, timestamp = nowSeconds()) => change({
  contacts: [{ wa_id: CUSTOMER, profile: { name: 'Teja' } }],
  messages: [{ id, from: CUSTOMER, timestamp: String(timestamp), type: 'text', text: { body: text } }],
})
const status = (id, state, extra = {}) => ({ id, status: state, timestamp: String(nowSeconds()), recipient_id: CUSTOMER, ...extra })
const deliver = async (payload) => {
  const body = JSON.stringify(payload)
  const signature = 'sha256=' + createHmac('sha256', THIS_SECRET).update(body).digest('hex')
  const res = await POST(
    new NextRequest(`https://wamacrm.example.com/api/webhooks/facebook/${ORG}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature }, body }),
    { params: { orgIdAndSlug: ORG } }
  )
  return res.status
}
const fresh = (options) => { db = fakeDb(options); db.seed('organizations', [organization()]); sent = []; return db }
const messages = () => db.tables.messages || []

for (const [name, options] of [['with the unique index', {}], ['before the unique index exists', { uniqueIndex: false }]]) {
  test(`Webhook route: a message Meta delivers again is stored once and answered once (${name})`, async () => {
    fresh(options)
    assert.equal(await deliver(inbound('wamid.in.1', 'hi')), 200)
    assert.equal(sent.length, 1, 'the greeting was answered')
    assert.deepEqual(messages().map((row) => row.sender_type), ['contact', 'user'])
    const conversation = db.tables.conversations[0]
    assert.equal(conversation.unread_count, 1)
    const lastMessageAt = conversation.last_message_at

    assert.equal(await deliver(inbound('wamid.in.1', 'hi')), 200)
    assert.equal(sent.length, 1, 'no second reply')
    assert.deepEqual(messages().map((row) => row.sender_type), ['contact', 'user'], 'no second message row')
    assert.equal(conversation.unread_count, 1, 'not counted as a new unread message')
    assert.equal(conversation.last_message_at, lastMessageAt)

    // A different message is still answered
    assert.equal(await deliver(inbound('wamid.in.2', 'hello')), 200)
    assert.equal(sent.length, 2)
    assert.equal(messages().length, 4)
    assert.equal(conversation.unread_count, 2)
  })
}

test('Webhook route: a message is placed in the chat by when the customer sent it', async () => {
  fresh()
  const sentAt = nowSeconds() - 3600
  await deliver(inbound('wamid.in.1', 'hi', sentAt))
  assert.equal(messages()[0].created_at, new Date(sentAt * 1000).toISOString())

  // A time Meta would never redeliver for (older than its 7-day retry window) is not trusted
  await deliver(inbound('wamid.in.2', 'hi', sentAt - 30 * 24 * 3600))
  assert.ok(Math.abs(Date.parse(messages()[2].created_at) - Date.now()) < 5000, 'stored with the time it arrived')
})

const campaignLogColumns = ['id', 'campaign_id', 'phone_number', 'status', 'error_message', 'variables_mapped', 'message_sid', 'created_at']
const seedOutbound = () => {
  fresh({ columns: { campaign_logs: campaignLogColumns } })
  db.seed('organizations', [organization({ id: OTHER_ORG, whatsapp_phone_number_id: '600000000000009', whatsapp_business_account_id: '500000000000009' })])
  db.seed('messages', [
    { id: 'out-1', organization_id: ORG, conversation_id: 'conv-1', sender_type: 'user', twilio_message_sid: 'FB_wamid.out.1', status: 'sent', error_message: null },
    { id: 'out-2', organization_id: ORG, conversation_id: 'conv-1', sender_type: 'user', twilio_message_sid: 'FB_wamid.out.2', status: 'sent', error_message: null },
    { id: 'elsewhere', organization_id: OTHER_ORG, conversation_id: 'conv-9', sender_type: 'user', twilio_message_sid: 'FB_wamid.out.1', status: 'sent', error_message: null },
  ])
  db.seed('campaigns', [{ id: 'camp-1', organization_id: ORG }, { id: 'camp-9', organization_id: OTHER_ORG }])
  db.seed('campaign_logs', [
    { id: 'log-1', campaign_id: 'camp-1', phone_number: `+${CUSTOMER}`, status: 'SENT', error_message: null, message_sid: 'FB_wamid.out.1' },
    { id: 'log-2', campaign_id: 'camp-1', phone_number: `+${CUSTOMER}`, status: 'SENT', error_message: null, message_sid: 'FB_wamid.out.2' },
    { id: 'log-9', campaign_id: 'camp-9', phone_number: `+${CUSTOMER}`, status: 'SENT', error_message: null, message_sid: 'FB_wamid.out.1' },
  ])
  const row = (table, id) => db.tables[table].find((candidate) => candidate.id === id)
  return { message: (id) => row('messages', id), log: (id) => row('campaign_logs', id) }
}
const META_ERROR = { code: 131047, title: 'Re-engagement message', message: 'Re-engagement message', error_data: { details: 'More than 24 hours have passed since the customer last replied to this number.' } }

test('Webhook route: a status only moves forward, for the message and its campaign log, in this workspace only', async () => {
  const { message, log } = seedOutbound()
  // Meta sends "read" and "delivered" in one batch, in that order
  assert.equal(await deliver(change({ statuses: [status('wamid.out.1', 'read'), status('wamid.out.1', 'delivered')] })), 200)
  assert.equal(message('out-1').status, 'read')
  assert.ok(message('out-1').read_at, 'read time recorded')
  assert.equal(log('log-1').status, 'READ', 'the campaign log followed, although campaign_logs has no organization_id column')
  // A late "delivered", or a "failed" for a message the customer has read, changes nothing
  await deliver(change({ statuses: [status('wamid.out.1', 'delivered')] }))
  await deliver(change({ statuses: [status('wamid.out.1', 'failed', { errors: [META_ERROR] })] }))
  assert.equal(message('out-1').status, 'read')
  assert.equal(message('out-1').error_message, null)
  assert.equal(log('log-1').status, 'READ')
  // The other workspace's message and campaign log with the same provider id are untouched
  assert.equal(message('elsewhere').status, 'sent')
  assert.equal(log('log-9').status, 'SENT')
})

test("Webhook route: a failed delivery keeps Meta's reason on the message and the campaign log", async () => {
  const { message, log } = seedOutbound()
  // Every status in a batch is processed, each for its own message
  assert.equal(await deliver(change({ statuses: [status('wamid.out.1', 'delivered'), status('wamid.out.2', 'failed', { errors: [META_ERROR] })] })), 200)
  assert.equal(message('out-1').status, 'delivered')
  assert.equal(log('log-1').status, 'DELIVERED')
  assert.equal(message('out-2').status, 'failed')
  assert.equal(message('out-2').error_message, 'Meta error 131047: Re-engagement message: More than 24 hours have passed since the customer last replied to this number.')
  assert.equal(log('log-2').status, 'FAILED')
  assert.equal(log('log-2').error_message, message('out-2').error_message)
  // Nothing comes back from failed
  await deliver(change({ statuses: [status('wamid.out.2', 'delivered')] }))
  assert.equal(message('out-2').status, 'failed')
  assert.equal(log('log-2').status, 'FAILED')
})
