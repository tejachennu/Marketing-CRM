// The campaign dispatcher, against a fake database: it claims due campaigns exactly as the
// Campaigns page's poll did before it was extracted, and resumes stuck ones the same way.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NOW = new Date('2026-11-04T10:00:00.000Z')
const minutesAgo = (minutes) => new Date(NOW.getTime() - minutes * 60 * 1000).toISOString()
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

// The real worker sends messages; here the dispatcher only has to start it
stub(path.join(PROJECT, 'app/api/campaigns/run/worker/route.ts'), { runCampaignWorker: async () => ({ success: true, message: '' }) })
for (const level of ['log', 'warn', 'error']) {
  const original = console[level]
  console[level] = (...args) => { if (!String(args[0]).startsWith('[Campaign Dispatcher]')) original(...args) }
}

const { dispatchDueCampaigns } = require(path.join(PROJECT, 'lib/campaigns/dispatcher.ts'))

// In-memory stand-in for the parts of supabase-js the dispatcher uses: filters, ordering,
// limits, head counts and updates that return the rows they changed.
function createDb(tables) {
  const db = { tables, calls: [], beforeQuery: null }
  const test = (operator, actual, expected) => {
    switch (operator) {
      case 'eq': return actual === expected
      case 'lte': return actual != null && actual <= expected
      case 'in': return expected.includes(actual)
      default: throw new Error(`Unsupported operator ${operator}`)
    }
  }
  function execute(table, ops) {
    const error = db.beforeQuery && db.beforeQuery(table, ops)
    if (error) return { data: null, error }
    let action = 'select', values = null, count = false, limit = Infinity, order = null, returning = false
    const filters = []
    for (const [op, ...args] of ops) {
      if (op === 'select') { if (action === 'select') count = Boolean(args[1] && args[1].count && args[1].head); else returning = true }
      else if (op === 'update') { action = 'update'; values = args[0] }
      else if (op === 'order') order = { column: args[0], ascending: !(args[1] && args[1].ascending === false) }
      else if (op === 'limit') limit = args[0]
      else filters.push([op, ...args])
    }
    let rows = (db.tables[table] || []).filter((row) => filters.every(([op, column, expected]) => test(op, row[column], expected)))
    if (order) rows = [...rows].sort((a, b) => (a[order.column] < b[order.column] ? -1 : a[order.column] > b[order.column] ? 1 : 0) * (order.ascending ? 1 : -1))
    rows = rows.slice(0, limit)
    if (action === 'update') {
      rows.forEach((row) => Object.assign(row, values))
      return { data: returning ? rows.map(({ id }) => ({ id })) : null, error: null }
    }
    if (count) return { data: null, count: rows.length, error: null }
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

function fixtures() {
  const campaigns = [
    { id: 'due', name: 'Diwali offer', status: 'SCHEDULED', scheduled_at: minutesAgo(5), organization_id: ORG_A, total_contacts: 120 },
    { id: 'later', name: 'Tomorrow', status: 'SCHEDULED', scheduled_at: minutesAgo(-30), organization_id: ORG_A, total_contacts: 10 },
    { id: 'stuck', name: 'Stuck one', status: 'PROCESSING', updated_at: minutesAgo(10), organization_id: ORG_A },
    { id: 'drained', name: 'All sent', status: 'PROCESSING', updated_at: minutesAgo(10), organization_id: ORG_A },
    { id: 'pending_old', name: 'Never started', status: 'PENDING', updated_at: minutesAgo(60), organization_id: ORG_A },
    { id: 'alive', name: 'Still sending', status: 'PROCESSING', updated_at: minutesAgo(1), organization_id: ORG_A },
  ]
  const campaign_logs = [
    ...Array.from({ length: 4 }, (_, i) => ({ id: `stuck-${i}`, campaign_id: 'stuck', status: 'PENDING' })),
    { id: 'stuck-sent', campaign_id: 'stuck', status: 'SENT' },
    { id: 'drained-sent', campaign_id: 'drained', status: 'SENT' },
    { id: 'pending_old-1', campaign_id: 'pending_old', status: 'PENDING' },
    { id: 'alive-1', campaign_id: 'alive', status: 'PENDING' },
  ]
  return createDb({ campaigns, campaign_logs })
}
const byId = (db, id) => db.tables.campaigns.find((row) => row.id === id)
const updatesOf = (db, id) => db.calls.filter(({ table, ops }) => table === 'campaigns' && ops[0][0] === 'update' && ops.some(([op, column, value]) => op === 'eq' && column === 'id' && value === id))

test('Dispatcher: due campaigns are claimed and started once; later ones wait', async () => {
  const db = fixtures()
  const started = []
  const result = await dispatchDueCampaigns({ supabase: db, origin: 'https://wamacrm.example.com', now: NOW, startWorker: (id, context) => started.push([id, context]) })

  assert.equal(result.claimed, 1)
  assert.equal(result.errors, 0)
  assert.deepEqual(result.campaigns, [{ id: 'due', name: 'Diwali offer', scheduled_at: minutesAgo(5), organization_id: ORG_A }])
  assert.equal(byId(db, 'due').status, 'PROCESSING')
  assert.equal(byId(db, 'later').status, 'SCHEDULED')
  assert.deepEqual(started.filter(([, context]) => context === 'Execution error'), [['due', 'Execution error']])

  // The same query and the same atomic claim as before the extraction
  const dueQuery = db.calls[0]
  assert.equal(dueQuery.table, 'campaigns')
  assert.deepEqual(dueQuery.ops, [
    ['select', 'id, name, scheduled_at, status, total_contacts, organization_id'],
    ['eq', 'status', 'SCHEDULED'],
    ['lte', 'scheduled_at', NOW.toISOString()],
    ['order', 'scheduled_at', { ascending: true }],
  ])
  const [claim] = updatesOf(db, 'due')
  assert.deepEqual(claim.ops, [
    ['update', { status: 'PROCESSING', updated_at: NOW.toISOString() }], // the claim refreshes the heartbeat
    ['eq', 'id', 'due'],
    ['eq', 'status', 'SCHEDULED'],
    ['select', 'id'],
  ])
})

test('Dispatcher: the watchdog resumes stuck campaigns with pending logs, at most three, with the heartbeat unchanged', async () => {
  const db = fixtures()
  const started = []
  const result = await dispatchDueCampaigns({ supabase: db, now: NOW, startWorker: (id, context) => started.push([id, context]) })

  assert.equal(result.restarted, 2)
  assert.deepEqual(started.filter(([, context]) => context !== 'Execution error'), [
    ['stuck', 'Failed to resume stuck campaign'],
    ['pending_old', 'Failed to resume stuck campaign'],
  ])
  assert.equal(byId(db, 'pending_old').status, 'PROCESSING')
  assert.equal(byId(db, 'drained').status, 'PROCESSING', 'nothing pending: left for the worker to finish')
  assert.equal(updatesOf(db, 'drained').length, 0)
  assert.equal(updatesOf(db, 'alive').length, 0, 'a worker that reported in a minute ago is not touched')

  const stuckQuery = db.calls.find(({ ops }) => ops.some(([op, column]) => op === 'in' && column === 'status'))
  assert.deepEqual(stuckQuery.ops, [
    ['select', 'id, name, status, updated_at'],
    ['in', 'status', ['PENDING', 'PROCESSING']],
    ['lte', 'updated_at', minutesAgo(2)],
    ['limit', 3],
  ])
  const pendingCount = db.calls.find(({ table, ops }) => table === 'campaign_logs' && ops.some(([, , value]) => value === 'stuck'))
  assert.deepEqual(pendingCount.ops, [['select', 'id', { count: 'exact', head: true }], ['eq', 'campaign_id', 'stuck'], ['eq', 'status', 'PENDING']])
  const [resume] = updatesOf(db, 'stuck')
  assert.deepEqual(resume.ops.slice(1), [['eq', 'id', 'stuck'], ['eq', 'status', 'PROCESSING'], ['eq', 'updated_at', minutesAgo(10)], ['select', 'id']])
})

test('Dispatcher: a campaign another poll claimed first is not started again', async () => {
  const db = fixtures()
  const started = []
  // The other poll flips the status between our read and our claim
  db.beforeQuery = (table, ops) => { if (ops[0][0] === 'update' && ops.some(([op, column, value]) => op === 'eq' && column === 'id' && value === 'due')) byId(db, 'due').status = 'PROCESSING' }
  const result = await dispatchDueCampaigns({ supabase: db, now: NOW, startWorker: (id) => started.push(id) })
  assert.equal(result.claimed, 0)
  assert.deepEqual(result.campaigns, [])
  assert.ok(!started.includes('due'))
})

test('Dispatcher: a stuck campaign whose worker just reported in is not resumed twice', async () => {
  const db = fixtures()
  const started = []
  db.beforeQuery = (table, ops) => { if (ops[0][0] === 'update' && ops.some(([op, column, value]) => op === 'eq' && column === 'id' && value === 'stuck')) byId(db, 'stuck').updated_at = NOW.toISOString() }
  const result = await dispatchDueCampaigns({ supabase: db, now: NOW, startWorker: (id) => started.push(id) })
  assert.equal(result.restarted, 1, 'only the other stuck campaign')
  assert.ok(!started.includes('stuck'))
})

test('Dispatcher: a failed read of due campaigns is an error for the caller; a watchdog failure only counts', async () => {
  let db = fixtures()
  db.beforeQuery = (table, ops) => (ops[0][0] === 'select' && ops.some(([op, , value]) => op === 'eq' && value === 'SCHEDULED') ? { message: 'db down' } : null)
  await assert.rejects(() => dispatchDueCampaigns({ supabase: db, now: NOW, startWorker: () => {} }), /db down/)

  db = fixtures()
  const started = []
  db.beforeQuery = (table, ops) => (ops.some(([op, column]) => op === 'in' && column === 'status') ? { message: 'db down' } : null)
  const result = await dispatchDueCampaigns({ supabase: db, now: NOW, startWorker: (id) => started.push(id) })
  assert.equal(result.claimed, 1)
  assert.equal(result.restarted, 0)
  assert.equal(result.errors, 1)
  assert.deepEqual(started, ['due'])
})

test('Dispatcher: a claim the database refuses is counted and the next campaign is still tried', async () => {
  const db = fixtures()
  db.tables.campaigns.push({ id: 'due2', name: 'Second', status: 'SCHEDULED', scheduled_at: minutesAgo(3), organization_id: ORG_A })
  const started = []
  db.beforeQuery = (table, ops) => (ops[0][0] === 'update' && ops.some(([op, column, value]) => op === 'eq' && column === 'id' && value === 'due') ? { message: 'deadlock' } : null)
  const result = await dispatchDueCampaigns({ supabase: db, now: NOW, startWorker: (id) => started.push(id) })
  assert.equal(result.claimed, 1)
  assert.equal(result.errors, 1)
  assert.deepEqual(started.slice(0, 1), ['due2'])
})
