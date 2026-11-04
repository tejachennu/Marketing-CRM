// The campaign dispatcher, against a fake database: it claims due campaigns exactly as the
// Campaigns page's poll did before it was extracted, and resumes stuck ones the same way.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NOW = new Date('2026-11-04T10:00:00.000Z')
const EPOCH = '1970-01-01T00:00:00.000Z'
const minutesAgo = (minutes) => new Date(NOW.getTime() - minutes * 60 * 1000).toISOString()
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

// The real worker sends messages; here the dispatcher only has to start it
stub(path.join(PROJECT, 'app/api/campaigns/run/worker/route.ts'), { runCampaignWorker: async () => ({ success: true, message: '' }) })
let warnings = []
for (const level of ['log', 'warn', 'error']) {
  const original = console[level]
  console[level] = (...args) => { if (String(args[0]).startsWith('[Campaign Dispatcher]')) warnings.push(String(args[0])); else original(...args) }
}

const { dispatchDueCampaigns } = require(path.join(PROJECT, 'lib/campaigns/dispatcher.ts'))
const { RESUME_REQUESTED_AT } = require(path.join(PROJECT, 'lib/scheduler/campaign-worker.ts'))

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
const logsOf = (db, id) => db.tables.campaign_logs.filter((row) => row.campaign_id === id).map((row) => row.status)
const updatesOf = (db, id) => db.calls.filter(({ table, ops }) => table === 'campaigns' && ops[0][0] === 'update' && ops.some(([op, column, value]) => op === 'eq' && column === 'id' && value === id))
const logUpdatesOf = (db, id) => db.calls.filter(({ table, ops }) => table === 'campaign_logs' && ops[0][0] === 'update' && ops.some(([op, column, value]) => op === 'eq' && column === 'campaign_id' && value === id))

test('Dispatcher: due campaigns are claimed and started once; later ones wait', async () => {
  const db = fixtures()
  const started = []
  const result = await dispatchDueCampaigns({ supabase: db, origin: 'https://wamacrm.example.com', now: NOW, startWorker: (id, context) => started.push([id, context]) })

  assert.equal(result.claimed, 1)
  assert.equal(result.errors, 0)
  assert.equal(result.out_of_time, undefined)
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

test('Dispatcher: the watchdog resumes stuck campaigns with pending logs, oldest heartbeat first, at most three, with the heartbeat unchanged', async () => {
  const db = fixtures()
  const started = []
  const result = await dispatchDueCampaigns({ supabase: db, now: NOW, startWorker: (id, context) => started.push([id, context]) })

  assert.equal(result.restarted, 2)
  assert.deepEqual(started.filter(([, context]) => context !== 'Execution error'), [
    ['pending_old', 'Failed to resume stuck campaign'],
    ['stuck', 'Failed to resume stuck campaign'],
  ])
  assert.equal(byId(db, 'pending_old').status, 'PROCESSING')
  assert.equal(result.finished, 1)
  assert.equal(byId(db, 'drained').status, 'COMPLETED', 'nothing pending or in flight: its worker died before closing it')
  assert.equal(byId(db, 'drained').sent_count, 1)
  assert.equal(byId(db, 'drained').failed_count, 0)
  assert.equal(updatesOf(db, 'alive').length, 0, 'a worker that reported in a minute ago is not touched')

  // More candidates are read than resumed, so a drained campaign cannot block a stuck one
  const stuckQuery = db.calls.find(({ ops }) => ops.some(([op, column]) => op === 'in' && column === 'status'))
  assert.deepEqual(stuckQuery.ops, [
    ['select', 'id, name, status, updated_at'],
    ['in', 'status', ['PENDING', 'PROCESSING']],
    ['lte', 'updated_at', minutesAgo(2)],
    ['order', 'updated_at', { ascending: true }],
    ['limit', 10],
  ])
  const pendingCount = db.calls.find(({ table, ops }) => table === 'campaign_logs' && ops[0][0] === 'select' && ops.some(([, , value]) => value === 'stuck'))
  assert.deepEqual(pendingCount.ops, [['select', 'id', { count: 'exact', head: true }], ['eq', 'campaign_id', 'stuck'], ['in', 'status', ['PENDING']]])
  const [resume] = updatesOf(db, 'stuck')
  assert.deepEqual(resume.ops.slice(1), [['eq', 'id', 'stuck'], ['eq', 'status', 'PROCESSING'], ['eq', 'updated_at', minutesAgo(10)], ['select', 'id']])

  // At most three resumes per call, whatever is waiting
  const more = fixtures()
  for (let i = 0; i < 5; i++) {
    more.tables.campaigns.push({ id: `stuck-${i}`, name: `Stuck ${i}`, status: 'PROCESSING', updated_at: minutesAgo(30 + i), organization_id: ORG_A })
    more.tables.campaign_logs.push({ id: `stuck-${i}-1`, campaign_id: `stuck-${i}`, status: 'PENDING' })
  }
  const moreStarted = []
  assert.equal((await dispatchDueCampaigns({ supabase: more, now: NOW, startWorker: (id) => moreStarted.push(id) })).restarted, 3)
  assert.deepEqual(moreStarted, ['due', 'pending_old', 'stuck-4', 'stuck-3'])
})

test('Dispatcher: a worker that paused out of time (heartbeat at the epoch) is resumed by the very next call, ahead of the rest', async () => {
  const db = fixtures()
  db.tables.campaigns.push({ id: 'paused', name: 'Big one', status: 'PROCESSING', updated_at: RESUME_REQUESTED_AT, organization_id: ORG_A })
  db.tables.campaign_logs.push(...Array.from({ length: 3 }, (_, i) => ({ id: `paused-${i}`, campaign_id: 'paused', status: 'PENDING' })))
  const started = []
  const result = await dispatchDueCampaigns({ supabase: db, now: NOW, startWorker: (id) => started.push(id) })

  assert.equal(RESUME_REQUESTED_AT, EPOCH)
  assert.equal(result.restarted, 3)
  assert.deepEqual(started, ['due', 'paused', 'pending_old', 'stuck'])
  const [resume] = updatesOf(db, 'paused')
  assert.deepEqual(resume.ops, [
    ['update', { status: 'PROCESSING', updated_at: NOW.toISOString() }],
    ['eq', 'id', 'paused'],
    ['eq', 'status', 'PROCESSING'],
    ['eq', 'updated_at', EPOCH],
    ['select', 'id'],
  ])
  assert.equal(byId(db, 'paused').updated_at, NOW.toISOString(), 'the resume gives it a fresh heartbeat')
})

test('Dispatcher: logs a killed worker left SENDING go back to PENDING once the heartbeat is ten minutes old', async () => {
  const db = createDb({
    campaigns: [
      { id: 'killed', name: 'Cut off', status: 'PROCESSING', updated_at: minutesAgo(11), organization_id: ORG_A },
      { id: 'busy', name: 'Mid-batch', status: 'PROCESSING', updated_at: minutesAgo(5), organization_id: ORG_A },
      { id: 'live', name: 'Running', status: 'PROCESSING', updated_at: minutesAgo(1), organization_id: ORG_A },
    ],
    campaign_logs: [
      { id: 'k1', campaign_id: 'killed', status: 'SENDING' },
      { id: 'k2', campaign_id: 'killed', status: 'SENDING' },
      { id: 'k3', campaign_id: 'killed', status: 'SENT' },
      { id: 'b1', campaign_id: 'busy', status: 'SENDING' },
      { id: 'b2', campaign_id: 'busy', status: 'PENDING' },
      { id: 'l1', campaign_id: 'live', status: 'SENDING' },
    ],
  })
  const started = []
  const result = await dispatchDueCampaigns({ supabase: db, now: NOW, startWorker: (id) => started.push(id) })

  assert.deepEqual(result, { claimed: 0, restarted: 2, errors: 0, campaigns: [] })
  assert.equal(byId(db, 'live').updated_at, minutesAgo(1))
  assert.deepEqual(logsOf(db, 'killed'), ['PENDING', 'PENDING', 'SENT'], 'given back, then resumed')
  assert.deepEqual(logsOf(db, 'busy'), ['SENDING', 'PENDING'], 'a worker may still be on b1; only the pending log is a reason to resume')
  assert.deepEqual(logsOf(db, 'live'), ['SENDING'])
  assert.deepEqual(started, ['killed', 'busy'])
  assert.ok(warnings.some((line) => line.includes('returned 2 unsettled log(s)') && line.includes('Cut off')))

  const [reset] = logUpdatesOf(db, 'killed')
  assert.deepEqual(reset.ops, [['update', { status: 'PENDING' }], ['eq', 'campaign_id', 'killed'], ['eq', 'status', 'SENDING'], ['select', 'id']])
  assert.equal(logUpdatesOf(db, 'busy').length, 0)
  assert.equal(logUpdatesOf(db, 'live').length, 0)
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

test('Dispatcher: a worker that cannot be started is counted, the campaign stays claimed for the watchdog, and the next one is still tried', async () => {
  const db = fixtures()
  db.tables.campaigns.push({ id: 'due2', name: 'Second', status: 'SCHEDULED', scheduled_at: minutesAgo(3), organization_id: ORG_A })
  const started = []
  const result = await dispatchDueCampaigns({
    supabase: db, now: NOW,
    // The start may be asynchronous (a hand-off to another invocation); its failure is awaited and caught
    startWorker: async (id) => { if (id === 'due') throw new Error('worker route unreachable'); started.push(id) },
  })
  assert.equal(result.claimed, 2)
  assert.equal(result.errors, 1)
  assert.deepEqual(started.slice(0, 1), ['due2'])
  assert.equal(byId(db, 'due').status, 'PROCESSING')
  assert.equal(byId(db, 'due').updated_at, NOW.toISOString())
  assert.ok(warnings.some((line) => line.includes('could not start the worker for campaign due')))
})

test('Dispatcher: a call whose time is up claims nothing more', async () => {
  const db = fixtures()
  const started = []
  const result = await dispatchDueCampaigns({ supabase: db, now: NOW, startWorker: (id) => started.push(id), deadline: Date.now() - 1 })
  assert.deepEqual(result, { claimed: 0, restarted: 0, errors: 0, campaigns: [], out_of_time: true })
  assert.deepEqual(started, [])
  assert.equal(byId(db, 'due').status, 'SCHEDULED', 'left for the next call')
  assert.equal(byId(db, 'stuck').updated_at, minutesAgo(10))
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

test('Dispatcher: a paused worker\'s epoch heartbeat never gives back logs another worker is still sending', async () => {
  const db = createDb({
    campaigns: [
      // W1 paused on purpose while W2 still has a batch in flight; more is pending
      { id: 'shared', name: 'Two workers', status: 'PROCESSING', updated_at: EPOCH, organization_id: ORG_A },
      // Only W2's batch is left
      { id: 'tail', name: 'Last batch', status: 'PROCESSING', updated_at: EPOCH, organization_id: ORG_A },
    ],
    campaign_logs: [
      { id: 's1', campaign_id: 'shared', status: 'SENDING' },
      { id: 's2', campaign_id: 'shared', status: 'PENDING' },
      { id: 't1', campaign_id: 'tail', status: 'SENDING' },
      { id: 't2', campaign_id: 'tail', status: 'SENT' },
    ],
  })
  const started = []
  const result = await dispatchDueCampaigns({ supabase: db, now: NOW, startWorker: (id) => started.push(id) })

  assert.equal(result.errors, 0)
  assert.deepEqual(started, ['shared'], 'the pending log is a reason to resume')
  assert.deepEqual(logsOf(db, 'shared'), ['SENDING', 'PENDING'], 'W2\'s message is not handed to the resumed worker')
  assert.deepEqual(logsOf(db, 'tail'), ['SENDING', 'SENT'])
  assert.equal(logUpdatesOf(db, 'shared').length, 0)
  assert.equal(logUpdatesOf(db, 'tail').length, 0)
  // With nothing to resume, the paused campaign gets a real heartbeat: if W2 died, its log is
  // given back ten minutes from now; meanwhile it no longer sorts ahead of everything else
  assert.equal(byId(db, 'tail').status, 'PROCESSING')
  assert.equal(byId(db, 'tail').updated_at, NOW.toISOString())
  const [bump] = updatesOf(db, 'tail')
  assert.deepEqual(bump.ops, [['update', { updated_at: NOW.toISOString() }], ['eq', 'id', 'tail'], ['eq', 'status', 'PROCESSING'], ['eq', 'updated_at', EPOCH], ['select', 'id']])

  // Ten minutes later nobody settled it: the normal rule gives it back and the campaign resumes
  const later = new Date(NOW.getTime() + 11 * 60 * 1000)
  const again = await dispatchDueCampaigns({ supabase: db, now: later, startWorker: (id) => started.push(id) })
  assert.equal(again.restarted >= 1, true)
  assert.deepEqual(logsOf(db, 'tail'), ['PENDING', 'SENT'])
  assert.ok(started.includes('tail'))
})

test('Dispatcher: a stuck campaign with nothing left to send is closed, not left to block the watchdog', async () => {
  const campaigns = [
    // Ten zombies with the oldest heartbeats would otherwise fill every examined slot
    ...Array.from({ length: 10 }, (_, i) => ({ id: `zombie-${i}`, name: `Zombie ${i}`, status: i % 2 ? 'PENDING' : 'PROCESSING', updated_at: minutesAgo(600 - i), organization_id: ORG_A })),
    { id: 'killed', name: 'Killed mid-run', status: 'PROCESSING', updated_at: minutesAgo(30), organization_id: ORG_A },
    { id: 'in_flight', name: 'Mid-batch', status: 'PROCESSING', updated_at: minutesAgo(5), organization_id: ORG_A },
  ]
  const campaign_logs = [
    ...campaigns.slice(0, 10).flatMap((c, i) => [{ id: `${c.id}-a`, campaign_id: c.id, status: 'SENT' }, { id: `${c.id}-b`, campaign_id: c.id, status: i === 0 ? 'FAILED' : 'DELIVERED' }]),
    { id: 'killed-1', campaign_id: 'killed', status: 'PENDING' },
    { id: 'in_flight-1', campaign_id: 'in_flight', status: 'SENDING' },
  ]
  const db = createDb({ campaigns, campaign_logs })
  const started = []
  const first = await dispatchDueCampaigns({ supabase: db, now: NOW, startWorker: (id) => started.push(id) })
  assert.equal(first.finished, 10)
  assert.equal(first.errors, 0)
  assert.deepEqual(byId(db, 'zombie-0'), { id: 'zombie-0', name: 'Zombie 0', status: 'COMPLETED', updated_at: NOW.toISOString(), organization_id: ORG_A, sent_count: 1, failed_count: 1 })
  assert.equal(byId(db, 'zombie-1').sent_count, 2, 'DELIVERED and READ count as sent')
  const [close] = updatesOf(db, 'zombie-1')
  assert.deepEqual(close.ops.slice(1), [['eq', 'id', 'zombie-1'], ['eq', 'status', 'PENDING'], ['eq', 'updated_at', minutesAgo(599)], ['select', 'id']], 'guarded on the heartbeat that was read')

  const second = await dispatchDueCampaigns({ supabase: db, now: NOW, startWorker: (id) => started.push(id) })
  assert.equal(second.restarted, 1)
  assert.deepEqual(started, ['killed'], 'the next call reaches the campaign that really needs a worker')
  assert.equal(byId(db, 'in_flight').status, 'PROCESSING', 'a log may still be on its way: not closed')
  assert.equal(byId(db, 'in_flight').updated_at, minutesAgo(5), 'and its heartbeat is left to age, so the log is given back at ten minutes')
})

test('Dispatcher: a stopped campaign is not closed or resumed by a watchdog that read it before the Stop', async () => {
  const db = fixtures()
  // The Stop lands between the watchdog's read and its write
  db.beforeQuery = (table, ops) => { if (table === 'campaigns' && ops[0][0] === 'update' && ops.some(([op, , value]) => op === 'eq' && value === 'drained')) byId(db, 'drained').status = 'STOPPED' }
  const result = await dispatchDueCampaigns({ supabase: db, now: NOW, startWorker: () => {} })
  assert.equal(result.finished, undefined)
  assert.equal(byId(db, 'drained').status, 'STOPPED')
})

test('Dispatcher: a failed log count or resume claim is counted, not mistaken for "nothing to do"', async () => {
  let db = fixtures()
  db.beforeQuery = (table, ops) => (table === 'campaign_logs' && ops[0][0] === 'select' ? { message: 'campaign_logs timed out' } : null)
  let result = await dispatchDueCampaigns({ supabase: db, now: NOW, startWorker: () => {} })
  assert.equal(result.errors, 3, 'one per stuck campaign: pending_old, stuck and drained')
  assert.equal(result.restarted, 0)
  assert.equal(byId(db, 'drained').status, 'PROCESSING', 'not closed on a count it could not read')

  db = fixtures()
  db.beforeQuery = (table, ops) => (table === 'campaigns' && ops[0][0] === 'update' && ops.some(([op, , value]) => op === 'eq' && value === 'pending_old') ? { message: 'deadlock' } : null)
  const started = []
  result = await dispatchDueCampaigns({ supabase: db, now: NOW, startWorker: (id) => started.push(id) })
  assert.equal(result.errors, 1)
  assert.ok(!started.includes('pending_old'))
  assert.ok(started.includes('stuck'), 'the campaigns behind the refused claim are still resumed')
})

test('Dispatcher: a stuck campaign whose count fails on every call does not starve the ones behind it', async () => {
  const db = fixtures()
  // pending_old has the oldest heartbeat, so it is examined first on every call
  db.beforeQuery = (table, ops) => (table === 'campaign_logs' && ops[0][0] === 'select' && ops.some(([op, column, value]) => op === 'eq' && column === 'campaign_id' && value === 'pending_old') ? { message: 'canceling statement due to statement timeout' } : null)
  const started = []
  warnings = []
  const result = await dispatchDueCampaigns({ supabase: db, now: NOW, startWorker: (id, context) => { if (context !== 'Execution error') started.push(id) } })

  assert.equal(result.errors, 1)
  assert.deepEqual(started, ['stuck'], 'the next stuck campaign is still resumed')
  assert.equal(result.restarted, 1)
  assert.equal(result.finished, 1)
  assert.equal(byId(db, 'drained').status, 'COMPLETED')
  assert.equal(byId(db, 'pending_old').status, 'PENDING', 'left untouched for the next call')
  assert.equal(byId(db, 'pending_old').updated_at, minutesAgo(60))
  assert.ok(warnings.some((line) => line.includes('Watchdog could not handle campaign Never started (pending_old)')))
})
