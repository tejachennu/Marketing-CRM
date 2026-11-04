// Expiry of idle chatbot sessions, against a fake database.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const NOW = new Date('2026-11-04T10:00:00.000Z')
const hoursAgo = (hours) => new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString()

let warnings = []
for (const level of ['log', 'warn', 'error']) {
  const original = console[level]
  console[level] = (...args) => { if (String(args[0]).startsWith('[Flow Sessions]')) warnings.push(String(args[0])); else original(...args) }
}

const { expireIdleFlowSessions } = require(path.join(PROJECT, 'lib/scheduler/flow-sessions.ts'))

// In-memory stand-in for the parts of supabase-js the job uses
function createDb(tables) {
  const db = { tables, calls: [], beforeQuery: null }
  const test = (operator, actual, expected) => {
    switch (operator) {
      case 'in': return expected.includes(actual)
      case 'lt': return actual != null && actual < expected
      default: throw new Error(`Unsupported operator ${operator}`)
    }
  }
  function execute(table, ops) {
    const error = db.beforeQuery && db.beforeQuery(table, ops)
    if (error) return { data: null, error }
    let action = 'select', values = null, limit = Infinity, order = null, returning = false
    const filters = []
    for (const [op, ...args] of ops) {
      if (op === 'select') { if (action !== 'select') returning = true }
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
    return { data: rows.map(({ id }) => ({ id })), error: null }
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
  const sessions = []
  for (let i = 0; i < 1200; i++) {
    sessions.push({ id: `idle-${i}`, organization_id: `org-${i % 7}`, status: i % 3 === 0 ? 'PAUSED_RAG' : 'IN_PROGRESS', last_interaction_at: hoursAgo(25 + (i % 50)) })
  }
  for (let i = 0; i < 5; i++) sessions.push({ id: `live-${i}`, organization_id: 'org-1', status: 'IN_PROGRESS', last_interaction_at: hoursAgo(23) })
  sessions.push({ id: 'done', organization_id: 'org-1', status: 'COMPLETED', last_interaction_at: hoursAgo(100) })
  sessions.push({ id: 'failed', organization_id: 'org-1', status: 'FAILED', last_interaction_at: hoursAgo(100) })
  sessions.push({ id: 'already', organization_id: 'org-1', status: 'EXPIRED', last_interaction_at: hoursAgo(100) })
  return createDb({ flow_sessions: sessions })
}
const count = (db, status) => db.tables.flow_sessions.filter((row) => row.status === status).length

test('Flow sessions: sessions idle for a day are expired 500 ids at a time, across organizations', async () => {
  warnings = []
  const db = fixtures()
  const result = await expireIdleFlowSessions({ supabase: db, now: NOW })
  assert.deepEqual(result, { expired: 1200, batches: 3 })
  assert.equal(count(db, 'EXPIRED'), 1201)
  assert.equal(count(db, 'IN_PROGRESS'), 5, 'sessions under a day old keep going')
  assert.equal(count(db, 'COMPLETED'), 1)
  assert.equal(count(db, 'FAILED'), 1)

  // Select 500, then update by id list in slices short enough for a URL; both only touch rows still idle
  const selects = db.calls.filter(({ ops }) => ops[0][0] === 'select')
  assert.equal(selects.length, 3)
  assert.deepEqual(selects[0].ops, [['select', 'id'], ['in', 'status', ['IN_PROGRESS', 'PAUSED_RAG']], ['lt', 'last_interaction_at', hoursAgo(24)], ['order', 'last_interaction_at', { ascending: true }], ['limit', 500]])
  const updates = db.calls.filter(({ ops }) => ops[0][0] === 'update')
  assert.equal(updates.length, 12)
  for (const { ops } of updates) {
    assert.deepEqual(ops[0], ['update', { status: 'EXPIRED' }])
    assert.equal(ops[1][0], 'in')
    assert.equal(ops[1][1], 'id')
    assert.equal(ops[1][2].length, 100)
    assert.deepEqual(ops.slice(2), [['in', 'status', ['IN_PROGRESS', 'PAUSED_RAG']], ['lt', 'last_interaction_at', hoursAgo(24)], ['select', 'id']])
  }
  const updatedIds = updates.flatMap(({ ops }) => ops[1][2])
  assert.equal(new Set(updatedIds).size, 1200, 'every idle session exactly once')
  assert.ok(warnings.some((line) => line.includes('Expired 1200')))
})

test('Flow sessions: nothing idle means one read and no write', async () => {
  const db = createDb({ flow_sessions: [{ id: 'live', status: 'IN_PROGRESS', last_interaction_at: hoursAgo(1) }] })
  assert.deepEqual(await expireIdleFlowSessions({ supabase: db, now: NOW }), { expired: 0, batches: 0 })
  assert.equal(db.calls.length, 1)
})

test('Flow sessions: a smaller batch size changes the batching, not the outcome', async () => {
  const db = fixtures()
  const result = await expireIdleFlowSessions({ supabase: db, now: NOW, batchSize: 100 })
  assert.deepEqual(result, { expired: 1200, batches: 12 })
})

test('Flow sessions: without the flow tables the job skips, saying so once', async () => {
  warnings = []
  const db = createDb({})
  db.beforeQuery = () => ({ code: '42P01', message: 'relation "public.flow_sessions" does not exist' })
  assert.deepEqual(await expireIdleFlowSessions({ supabase: db, now: NOW }), { skipped: true, expired: 0, batches: 0 })
  assert.deepEqual(await expireIdleFlowSessions({ supabase: db, now: NOW }), { skipped: true, expired: 0, batches: 0 })
  assert.equal(warnings.filter((line) => line.includes('does not exist yet')).length, 1)
})

test('Flow sessions: any other database error is raised for the tick to report', async () => {
  const db = fixtures()
  db.beforeQuery = (table, ops) => (ops[0][0] === 'update' ? { code: '57014', message: 'statement timeout' } : null)
  await assert.rejects(() => expireIdleFlowSessions({ supabase: db, now: NOW }), /statement timeout/)
})

test('Flow sessions: a run whose time is up stops between batches', async () => {
  const db = fixtures()
  assert.deepEqual(await expireIdleFlowSessions({ supabase: db, now: NOW, deadline: Date.now() - 1 }), { expired: 0, batches: 0, out_of_time: true })
  assert.equal(count(db, 'EXPIRED'), 1)
})
