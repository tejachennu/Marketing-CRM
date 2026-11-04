// The campaign worker and its route, against a fake database and a fake Meta: how the
// scheduler starts it in an invocation of its own, how it pauses when its time is up, and
// how it claims each batch before any message goes out. Nothing here reaches the network.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SECRET = 'a-long-random-cron-secret'
const EPOCH = '1970-01-01T00:00:00.000Z'
const T0 = Date.parse('2026-11-04T10:00:00.000Z')
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.example.com'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'
process.env.CRON_SECRET = SECRET

// In-memory stand-in for the parts of supabase-js the worker (and the rerun route) use:
// filters, ordering, limits, head counts, maybeSingle/single, inserts, and updates that return
// the rows they changed.
function createDb(tables) {
  const db = { tables, calls: [], beforeQuery: null, seq: 0 }
  // PostgREST's list syntax in .not('status', 'in', '("A","B")')
  const list = (value) => (Array.isArray(value) ? value : String(value).replace(/^\(|\)$/g, '').split(',').map((item) => item.replace(/^"|"$/g, '')))
  const test = (operator, actual, expected) => {
    switch (operator) {
      case 'eq': return actual === expected
      case 'neq': return actual !== expected
      case 'in': return list(expected).includes(actual)
      default: throw new Error(`Unsupported operator ${operator}`)
    }
  }
  const matches = (row, [op, column, ...args]) => (op === 'not' ? !test(args[0], row[column], args[1]) : test(op, row[column], args[0]))
  function execute(table, ops) {
    const error = db.beforeQuery && db.beforeQuery(table, ops)
    if (error) return { data: null, error }
    let action = 'select', values = null, count = false, single = false, limit = Infinity, order = null, returning = false
    const filters = []
    for (const [op, ...args] of ops) {
      if (op === 'select') { if (action === 'select') count = Boolean(args[1] && args[1].count && args[1].head); else returning = true }
      else if (op === 'update') { action = 'update'; values = args[0] }
      else if (op === 'insert') { action = 'insert'; values = args[0] }
      else if (op === 'order') order = { column: args[0], ascending: !(args[1] && args[1].ascending === false) }
      else if (op === 'limit') limit = args[0]
      else if (op === 'maybeSingle' || op === 'single') single = true
      else filters.push([op, ...args])
    }
    if (action === 'insert') {
      const rows = (Array.isArray(values) ? values : [values]).map((row) => ({ id: `${table}-${++db.seq}`, ...row }))
      ;(db.tables[table] = db.tables[table] || []).push(...rows)
      return { data: single ? rows[0] : rows, error: null }
    }
    let rows = (db.tables[table] || []).filter((row) => filters.every((filter) => matches(row, filter)))
    if (order) rows = [...rows].sort((a, b) => (a[order.column] < b[order.column] ? -1 : a[order.column] > b[order.column] ? 1 : 0) * (order.ascending ? 1 : -1))
    rows = rows.slice(0, limit)
    if (action === 'update') {
      rows.forEach((row) => Object.assign(row, values))
      return { data: returning ? rows.map(({ id }) => ({ id })) : null, error: null }
    }
    if (count) return { data: null, count: rows.length, error: null }
    if (single) return { data: rows[0] || null, error: null }
    return { data: rows, error: null }
  }
  db.from = (table) => {
    const ops = []
    db.calls.push({ table, ops })
    const query = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') return (resolve, reject) => Promise.resolve().then(() => execute(table, ops)).then(resolve, reject)
        return (...args) => { ops.push([prop, ...args]); return query }
      },
    })
    return query
  }
  return db
}

let db = null
stub(require.resolve('@supabase/supabase-js', { paths: [PROJECT] }), { createClient: () => db })

let authResult = { authorized: true }
let authChecks = []
stub(path.join(PROJECT, 'lib/api-auth-helper.ts'), {
  verifyRecordAccess: async (request, table, id, options) => { authChecks.push([table, id, options]); return authResult },
})

// `after` only works inside a request; here the tasks are collected and run by the test
let afterTasks = []
const nextServerPath = require.resolve('next/server', { paths: [PROJECT] })
const nextServer = require(nextServerPath)
stub(nextServerPath, { ...nextServer, after: (task) => afterTasks.push(task) })

// Meta (and SendGrid) accept every message; the statuses of the batch are noted as it is called.
// `providerAnswer` overrides the answer.
let metaCalls = []
let providerAnswer = null
global.fetch = async (url, init) => {
  const sending = db.tables.campaign_logs.filter((row) => row.status === 'SENDING').map((row) => row.id)
  metaCalls.push({ url, init, body: JSON.parse(init.body), sending })
  if (metaCalls.onCall) metaCalls.onCall()
  if (providerAnswer) return providerAnswer(url, init)
  return new Response(JSON.stringify({ messages: [{ id: `wamid.${metaCalls.length}` }] }), { status: 200 })
}
let workerErrors = []
for (const level of ['log', 'warn', 'error']) {
  const original = console[level]
  console[level] = (...args) => {
    if (level === 'error' && /^\[Campaign Worker\]/.test(String(args[0]))) workerErrors.push(String(args[0]))
    if (!/^\[Campaign (Worker|Run|Dispatcher|Rerun)/.test(String(args[0]))) original(...args)
  }
}

const route = require(path.join(PROJECT, 'app/api/campaigns/run/worker/route.ts'))
const runRoute = require(path.join(PROJECT, 'app/api/campaigns/run/route.ts'))
const rerunRoute = require(path.join(PROJECT, 'app/api/campaigns/rerun/route.ts'))
const { NextRequest } = nextServer
const { runCampaignWorker } = route

const post = (body, headers = {}) => route.POST(new NextRequest('https://wamacrm.example.com/api/campaigns/run/worker', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }))

function fixtures({ pending = 20 } = {}) {
  const campaign = {
    id: 'camp-1', name: 'Diwali offer', organization_id: ORG_A, status: 'PROCESSING', channel: 'whatsapp',
    template_sid: null, template_body: 'Hello {{name}}, our Diwali sale is on!', sender: null, subject: null,
    sent_count: 0, failed_count: 0, updated_at: new Date(T0).toISOString(),
  }
  const logs = Array.from({ length: pending }, (_, i) => ({
    id: `log-${String(i).padStart(2, '0')}`, campaign_id: 'camp-1', status: 'PENDING', phone_number: `+9190000000${String(i).padStart(2, '0')}`,
    variables_mapped: { name: `Customer ${i}` }, created_at: new Date(T0 - 60000 + i * 1000).toISOString(),
  }))
  return createDb({
    campaigns: [campaign],
    campaign_logs: logs,
    organizations: [{ id: ORG_A, whatsapp_provider: 'facebook', whatsapp_api_token: 'TOKEN', whatsapp_phone_number_id: '600000000000001', whatsapp_graph_api_version: 'v25.0' }],
    contacts: [],
    conversations: [],
    messages: [],
  })
}
const campaign = () => db.tables.campaigns[0]
const statuses = () => db.tables.campaign_logs.reduce((tally, row) => ({ ...tally, [row.status]: (tally[row.status] || 0) + 1 }), {})
function reset() {
  db = fixtures()
  authResult = { authorized: true }
  authChecks = []
  afterTasks = []
  metaCalls = []
  providerAnswer = null
  workerErrors = []
  delete process.env.CAMPAIGN_WORKER_MAX_SECONDS
}

test('Worker route: with the cron secret the campaign is accepted at once and runs after the answer, for as long as the invocation allows', async () => {
  reset()
  assert.equal(route.maxDuration, 300)
  const res = await post({ campaignId: 'camp-1' }, { 'x-cron-secret': SECRET })
  assert.equal(res.status, 202)
  assert.deepEqual(await res.json(), { success: true, message: 'Campaign worker started.' })
  assert.deepEqual(authChecks, [], 'no session is needed')
  assert.equal(afterTasks.length, 1)
  assert.equal(metaCalls.length, 0, 'nothing is sent before the answer')

  await afterTasks[0]()
  assert.equal(metaCalls.length, 20)
  assert.equal(campaign().status, 'COMPLETED')
  assert.equal(campaign().sent_count, 20)
  assert.deepEqual(statuses(), { SENT: 20 })

  // The bearer form works as well
  reset()
  assert.equal((await post({ campaignId: 'camp-1' }, { authorization: `Bearer ${SECRET}` })).status, 202)
  assert.equal(afterTasks.length, 1)
})

test('Worker route: the cron path gives the worker the invocation\'s deadline, so it pauses instead of being cut off', async () => {
  reset()
  // A plan that allows (almost) nothing: the worker must stop before its first batch
  process.env.CAMPAIGN_WORKER_MAX_SECONDS = '0.001'
  assert.equal((await post({ campaignId: 'camp-1' }, { 'x-cron-secret': SECRET })).status, 202)
  await afterTasks[0]()
  assert.equal(metaCalls.length, 0)
  assert.equal(campaign().status, 'PROCESSING')
  assert.equal(campaign().updated_at, EPOCH, 'asks the watchdog to resume it at once')
})

test('Worker route: without the secret the session rules apply, as before, and the worker runs within the request', async () => {
  reset()
  authResult = { authorized: false, status: 403, error: 'Forbidden' }
  let res = await post({ campaignId: 'camp-1' }, { 'x-cron-secret': 'wrong' })
  assert.equal(res.status, 403)
  assert.deepEqual(authChecks, [['campaigns', 'camp-1', { permission: 'campaigns.manage' }]])
  assert.equal(afterTasks.length, 0)
  assert.equal(metaCalls.length, 0)

  reset()
  res = await post({ campaignId: 'camp-1' })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.success, true)
  assert.match(body.message, /COMPLETED/)
  assert.equal(afterTasks.length, 0, 'the result is the answer')
  assert.equal(metaCalls.length, 20)

  assert.equal((await post({})).status, 400)
  assert.equal((await post({ campaignId: 42 }, { 'x-cron-secret': SECRET })).status, 400)
})

test('Worker: each batch is claimed as SENDING before Meta is called, and settled to SENT after', async () => {
  reset()
  const result = await runCampaignWorker('camp-1')
  assert.equal(result.success, true)
  assert.equal(result.paused, undefined)
  assert.deepEqual(statuses(), { SENT: 20 })
  assert.equal(metaCalls.length, 20)
  assert.deepEqual(metaCalls[0].sending.length, 15, 'the whole first batch was claimed before the first message went out')
  assert.ok(metaCalls.slice(0, 15).every((call) => call.sending.length === 15))
  assert.ok(metaCalls.slice(15).every((call) => call.sending.length === 5))
  assert.equal(metaCalls[0].url, 'https://graph.facebook.com/v25.0/600000000000001/messages')
  assert.equal(metaCalls[0].body.text.body, 'Hello Customer 0, our Diwali sale is on!')
  assert.ok(metaCalls[0].init.signal instanceof AbortSignal, 'a provider that hangs cannot hold the batch')

  const claims = db.calls.filter(({ table, ops }) => table === 'campaign_logs' && ops[0][0] === 'update' && ops[0][1].status === 'SENDING')
  assert.equal(claims.length, 2)
  assert.deepEqual(claims[0].ops, [
    ['update', { status: 'SENDING' }],
    ['in', 'id', db.tables.campaign_logs.slice(0, 15).map((row) => row.id)],
    ['eq', 'status', 'PENDING'],
    ['select', 'id'],
  ])
  assert.equal(campaign().status, 'COMPLETED')
  assert.equal(campaign().sent_count, 20)
  assert.notEqual(campaign().updated_at, EPOCH)
})

test('Worker: out of time between batches, it pauses cleanly and asks for an immediate resume', async () => {
  reset()
  let clock = T0
  // The first batch runs; by the time it is done the deadline is within the stop margin
  metaCalls.onCall = () => { clock = T0 + 5 * 1000 }
  const result = await runCampaignWorker('camp-1', { deadline: T0 + 12 * 1000, now: () => clock })

  assert.equal(result.success, true)
  assert.equal(result.paused, true)
  assert.match(result.message, /paused with status: PROCESSING/)
  assert.equal(metaCalls.length, 15, 'one batch, never a message cut off halfway')
  assert.deepEqual(statuses(), { SENT: 15, PENDING: 5 }, 'nothing is left SENDING')
  assert.equal(campaign().status, 'PROCESSING')
  assert.equal(campaign().sent_count, 15)
  assert.equal(campaign().updated_at, EPOCH, 'the watchdog resumes a heartbeat this old at its next pass')

  // Resumed later, it finishes
  const resumed = await runCampaignWorker('camp-1', { deadline: Date.now() + 60 * 1000 })
  assert.equal(resumed.paused, undefined)
  assert.deepEqual(statuses(), { SENT: 20 })
  assert.equal(campaign().status, 'COMPLETED')
  assert.notEqual(campaign().updated_at, EPOCH)
})

test('Worker: with no time at all it pauses before the first batch; with no deadline it runs to the end', async () => {
  reset()
  const result = await runCampaignWorker('camp-1', { deadline: T0, now: () => T0 })
  assert.equal(result.paused, true)
  assert.equal(metaCalls.length, 0)
  assert.deepEqual(statuses(), { PENDING: 20 })
  assert.equal(campaign().updated_at, EPOCH)

  reset()
  assert.equal((await runCampaignWorker('camp-1', {})).paused, undefined)
  assert.deepEqual(statuses(), { SENT: 20 })
})

test('Worker: logs another worker holds are left to it, and keep the campaign from completing', async () => {
  reset()
  // Between our read and our claim, another worker takes one of the rows
  db.beforeQuery = (table, ops) => { if (table === 'campaign_logs' && ops[0][0] === 'update' && ops[0][1].status === 'SENDING' && db.tables.campaign_logs[3].status === 'PENDING') db.tables.campaign_logs[3].status = 'SENDING' }
  const result = await runCampaignWorker('camp-1')
  assert.equal(result.success, true)
  assert.equal(metaCalls.length, 19)
  assert.ok(!metaCalls.some((call) => call.body.to.endsWith('03')), 'the contested row was not sent by us')
  assert.deepEqual(statuses(), { SENT: 19, SENDING: 1 })
  assert.equal(campaign().status, 'PROCESSING', 'not complete while a message is still on its way')
  assert.notEqual(campaign().updated_at, EPOCH, 'a fresh heartbeat: the watchdog returns the row only once this is ten minutes old')

  // Started again with nothing pending but that row, it leaves the campaign alone
  const again = await runCampaignWorker('camp-1')
  assert.match(again.message, /still being sent/)
  assert.equal(campaign().status, 'PROCESSING')
})

test('Worker: a sent message is noted in the contact\'s latest conversation, never in a new one when some exist', async () => {
  reset()
  db = fixtures({ pending: 1 })
  db.tables.contacts.push({ id: 'contact-1', organization_id: ORG_A, phone_number: '+919000000000', first_name: 'Asha', last_name: 'R', tags: [] })
  db.tables.conversations.push(
    { id: 'conv-old', organization_id: ORG_A, contact_id: 'contact-1', last_message_at: '2026-01-01T00:00:00.000Z' },
    { id: 'conv-new', organization_id: ORG_A, contact_id: 'contact-1', last_message_at: '2026-11-01T00:00:00.000Z' },
  )
  await runCampaignWorker('camp-1')
  assert.deepEqual(statuses(), { SENT: 1 })
  assert.equal(db.tables.conversations.length, 2, 'no third conversation')
  assert.deepEqual(db.tables.messages.map((m) => m.conversation_id), ['conv-new'])

  const lookup = db.calls.find(({ table, ops }) => table === 'conversations' && ops[0][0] === 'select')
  assert.deepEqual(lookup.ops, [
    ['select', 'id'],
    ['eq', 'contact_id', 'contact-1'],
    ['eq', 'organization_id', ORG_A],
    ['order', 'last_message_at', { ascending: false, nullsFirst: false }],
    ['limit', 1],
  ])
})

test('Run route: a campaign run from the dashboard also gets the invocation\'s deadline', async () => {
  reset()
  assert.equal(runRoute.maxDuration, 300)
  process.env.CAMPAIGN_WORKER_MAX_SECONDS = '0.001'
  const res = await runRoute.POST(new NextRequest('https://wamacrm.example.com/api/campaigns/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaignId: 'camp-1' }) }))
  assert.equal(res.status, 200)
  assert.deepEqual(authChecks, [['campaigns', 'camp-1', { permission: 'campaigns.manage' }]])
  assert.equal(afterTasks.length, 1)
  await afterTasks[0]()
  assert.equal(metaCalls.length, 0)
  assert.equal(campaign().updated_at, EPOCH, 'paused at once for the watchdog rather than cut off')
})

const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

/** An email campaign of organization A to the given addresses, sent through SendGrid. */
function emailFixtures(addresses) {
  const fresh = fixtures({ pending: addresses.length })
  Object.assign(fresh.tables.campaigns[0], { channel: 'email', template_body: 'Hello {{name}}', subject: 'Diwali' })
  fresh.tables.campaign_logs.forEach((log, i) => { log.email_address = addresses[i]; log.phone_number = null })
  Object.assign(fresh.tables.organizations[0], { email_provider: 'sendgrid', sendgrid_api_key: 'SG.test-key', sendgrid_from_email: 'shop@a.example.com' })
  return fresh
}

test('Worker: an email campaign only finds and changes contacts of its own organization', async () => {
  reset()
  db = emailFixtures(['shared@x.example.com', 'mine@x.example.com'])
  db.tables.contacts.push(
    // Another workspace's customer with the same address, never to be touched or linked
    { id: 'b-contact', organization_id: ORG_B, email: 'shared@x.example.com', first_name: 'Campaign', last_name: '', tags: ['B tag'], created_at: '2026-01-01T00:00:00.000Z' },
    // Two of our own for the second address: the oldest is used, no third is created
    { id: 'a-newer', organization_id: ORG_A, email: 'mine@x.example.com', first_name: 'Ravi', last_name: 'K', tags: [], created_at: '2026-06-01T00:00:00.000Z' },
    { id: 'a-older', organization_id: ORG_A, email: 'mine@x.example.com', first_name: 'Ravi', last_name: 'K', tags: [], created_at: '2026-02-01T00:00:00.000Z' },
  )
  const bBefore = JSON.stringify(db.tables.contacts[0])
  await runCampaignWorker('camp-1')

  assert.deepEqual(statuses(), { SENT: 2 })
  assert.equal(JSON.stringify(db.tables.contacts[0]), bBefore, 'the other organization\'s contact is unchanged')
  const created = db.tables.contacts.filter((c) => c.email === 'shared@x.example.com' && c.organization_id === ORG_A)
  assert.equal(created.length, 1, 'organization A gets a contact of its own')
  assert.equal(db.tables.contacts.length, 4)
  assert.deepEqual(db.tables.contacts.find((c) => c.id === 'a-older').tags, ['Diwali offer'])
  assert.deepEqual(db.tables.contacts.find((c) => c.id === 'a-newer').tags, [])

  // Every conversation and message stays inside organization A, on A's contacts
  assert.ok(db.tables.conversations.every((c) => c.organization_id === ORG_A && c.contact_id !== 'b-contact'))
  assert.deepEqual(db.tables.conversations.map((c) => c.contact_id).sort(), [created[0].id, 'a-older'].sort())
  assert.ok(db.tables.messages.every((m) => m.organization_id === ORG_A))

  const lookups = db.calls.filter(({ table, ops }) => table === 'contacts' && ops[0][0] === 'select')
  assert.ok(lookups.length >= 2)
  for (const { ops } of lookups) {
    assert.deepEqual(ops.find(([op, column]) => op === 'eq' && column === 'organization_id'), ['eq', 'organization_id', ORG_A])
    assert.ok(!ops.some(([op]) => op === 'maybeSingle'), 'two contacts with one address are not an error')
  }
  const updates = db.calls.filter(({ table, ops }) => table === 'contacts' && ops[0][0] === 'update')
  assert.ok(updates.length >= 1)
  for (const { ops } of updates) assert.ok(ops.some(([op, column, value]) => op === 'eq' && column === 'organization_id' && value === ORG_A))
})

test('Worker: every sent message gets an id of its own, even when the provider gives none', async () => {
  reset()
  db = emailFixtures(['one@x.example.com', 'two@x.example.com', 'three@x.example.com'])
  // SendGrid names the request in a header; without it the worker makes up a unique id
  providerAnswer = (url, init) => {
    const to = JSON.parse(init.body).personalizations[0].to[0].email
    return new Response('', { status: 202, headers: to === 'one@x.example.com' ? { 'X-Message-Id': 'sg-abc' } : {} })
  }
  await runCampaignWorker('camp-1')
  const ids = db.tables.campaign_logs.map((log) => log.message_sid)
  assert.equal(ids[0], 'SG_sg-abc')
  assert.match(ids[1], /^SG_[0-9a-f-]{36}$/)
  assert.equal(new Set(ids).size, 3, 'sends that finish in the same millisecond still differ')
  assert.deepEqual(db.tables.messages.map((m) => m.twilio_message_sid).sort(), [...ids].sort())

  // Meta without a message id
  reset()
  db = fixtures({ pending: 3 })
  providerAnswer = () => new Response(JSON.stringify({ messages: [] }), { status: 200 })
  await runCampaignWorker('camp-1')
  const metaIds = db.tables.campaign_logs.map((log) => log.message_sid)
  assert.ok(metaIds.every((id) => /^FB_local_[0-9a-f-]{36}$/.test(id)), metaIds.join())
  assert.equal(new Set(metaIds).size, 3)
})

test('Worker: a message that cannot be noted in the chat is logged; the send still counts', async () => {
  reset()
  db = fixtures({ pending: 1 })
  db.beforeQuery = (table, ops) => (table === 'messages' && ops[0][0] === 'insert' ? { code: '23505', message: 'duplicate key value violates unique constraint "messages_org_provider_sid_key"' } : null)
  const result = await runCampaignWorker('camp-1')
  assert.equal(result.success, true)
  assert.deepEqual(statuses(), { SENT: 1 })
  assert.ok(workerErrors.some((line) => line.includes('could not be recorded in conversation')), workerErrors.join('\n'))
})

test('Worker: a campaign stopped before its worker starts is not sent, and stays stopped', async () => {
  for (const status of ['STOPPED', 'CANCELLED', 'COMPLETED']) {
    reset()
    campaign().status = status
    const result = await runCampaignWorker('camp-1')
    assert.equal(result.success, true)
    assert.match(result.message, /not runnable/)
    assert.equal(metaCalls.length, 0, status)
    assert.equal(campaign().status, status)
    assert.deepEqual(statuses(), { PENDING: 20 })
  }
  // The start is a conditional update, so the Stop cannot be lost between the check and the write
  const [start] = db.calls.filter(({ table, ops }) => table === 'campaigns' && ops[0][0] === 'update')
  assert.deepEqual(start.ops.slice(1), [['eq', 'id', 'camp-1'], ['in', 'status', ['PENDING', 'PROCESSING']], ['select', 'id']])

  // A new campaign (PENDING) and a dispatched one (PROCESSING) run as before
  reset()
  campaign().status = 'PENDING'
  await runCampaignWorker('camp-1')
  assert.equal(campaign().status, 'COMPLETED')
})

test('Worker: a Stop that lands after the last batch is not overwritten by COMPLETED', async () => {
  reset()
  db.beforeQuery = (table, ops) => {
    // The user stops the campaign just as the worker writes its final status
    if (table === 'campaigns' && ops[0][0] === 'update' && ops[0][1].status === 'COMPLETED') campaign().status = 'STOPPED'
  }
  await runCampaignWorker('camp-1')
  assert.equal(campaign().status, 'STOPPED')
})

/** POST /api/campaigns/rerun, signed in. */
const rerun = (body) => rerunRoute.POST(new NextRequest('https://wamacrm.example.com/api/campaigns/rerun', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))

test('Rerun: logs a worker may still be sending are not handed to a second worker', async () => {
  for (const rerunType of ['failed_only', 'all']) {
    reset()
    // Just stopped: the old worker is finishing its batch (the Stop refreshed the heartbeat)
    Object.assign(campaign(), { status: 'STOPPED', updated_at: new Date().toISOString() })
    db.tables.campaign_logs.forEach((log, i) => { log.status = i < 3 ? 'SENDING' : i < 5 ? 'FAILED' : 'SENT' })
    const res = await rerun({ campaignId: 'camp-1', rerunType })
    assert.equal(res.status, 200)
    const expected = rerunType === 'all' ? { SENDING: 3, PENDING: 17 } : { SENDING: 3, PENDING: 2, SENT: 15 }
    assert.deepEqual(statuses(), expected, rerunType)
    assert.equal(campaign().status, 'PENDING')
  }

  // Long after the worker died, its unsettled logs are retried with the rest
  reset()
  Object.assign(campaign(), { status: 'STOPPED', updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() })
  db.tables.campaign_logs.forEach((log, i) => { log.status = i < 3 ? 'SENDING' : 'SENT' })
  await rerun({ campaignId: 'camp-1', rerunType: 'failed_only' })
  assert.deepEqual(statuses(), { PENDING: 3, SENT: 17 })

  // A paused worker's epoch heartbeat says nothing about another worker's batch
  reset()
  Object.assign(campaign(), { status: 'PROCESSING', updated_at: EPOCH })
  db.tables.campaign_logs.forEach((log, i) => { log.status = i < 3 ? 'SENDING' : 'SENT' })
  await rerun({ campaignId: 'camp-1', rerunType: 'failed_only' })
  assert.deepEqual(statuses(), { SENDING: 3, SENT: 17 })
})

test('Rerun: its worker knows when the invocation ends, and pauses instead of being cut off', async () => {
  reset()
  assert.equal(rerunRoute.maxDuration, 300)
  process.env.CAMPAIGN_WORKER_MAX_SECONDS = '0.001'
  campaign().status = 'STOPPED'
  const res = await rerun({ campaignId: 'camp-1', rerunType: 'failed_only' })
  assert.equal(res.status, 200)
  assert.deepEqual(authChecks, [['campaigns', 'camp-1', { permission: 'campaigns.manage' }]])
  assert.equal(afterTasks.length, 1)
  await afterTasks[0]()
  assert.equal(metaCalls.length, 0)
  assert.equal(campaign().status, 'PROCESSING')
  assert.equal(campaign().updated_at, EPOCH, 'paused at once for the watchdog')
})
