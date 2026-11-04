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

// In-memory stand-in for the parts of supabase-js the worker uses: filters, ordering, limits,
// head counts, maybeSingle, inserts, and updates that return the rows they changed.
function createDb(tables) {
  const db = { tables, calls: [], beforeQuery: null, seq: 0 }
  const test = (operator, actual, expected) => {
    switch (operator) {
      case 'eq': return actual === expected
      case 'in': return expected.includes(actual)
      default: throw new Error(`Unsupported operator ${operator}`)
    }
  }
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
      else if (op === 'maybeSingle') single = true
      else filters.push([op, ...args])
    }
    if (action === 'insert') {
      const rows = (Array.isArray(values) ? values : [values]).map((row) => ({ id: `${table}-${++db.seq}`, ...row }))
      ;(db.tables[table] = db.tables[table] || []).push(...rows)
      return { data: single ? rows[0] : rows, error: null }
    }
    let rows = (db.tables[table] || []).filter((row) => filters.every(([op, column, expected]) => test(op, row[column], expected)))
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

// Meta accepts every message; the statuses of the batch are noted as it is called
let metaCalls = []
global.fetch = async (url, init) => {
  const sending = db.tables.campaign_logs.filter((row) => row.status === 'SENDING').map((row) => row.id)
  metaCalls.push({ url, init, body: JSON.parse(init.body), sending })
  if (metaCalls.onCall) metaCalls.onCall()
  return new Response(JSON.stringify({ messages: [{ id: `wamid.${metaCalls.length}` }] }), { status: 200 })
}
for (const level of ['log', 'warn', 'error']) {
  const original = console[level]
  console[level] = (...args) => { if (!/^\[Campaign (Worker|Run|Dispatcher)/.test(String(args[0]))) original(...args) }
}

const route = require(path.join(PROJECT, 'app/api/campaigns/run/worker/route.ts'))
const runRoute = require(path.join(PROJECT, 'app/api/campaigns/run/route.ts'))
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
