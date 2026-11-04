// The cron tick: who may call it, and how it reports its jobs. The jobs themselves are faked
// here (each has its own test file); nothing reaches a database or the network.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const SECRET = 'a-long-random-cron-secret'
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

let calls = []
let failing = {}
let databaseMissing = false
const fakeDb = { from() { throw new Error('the faked jobs never query') } }

stub(path.join(PROJECT, 'lib/api-auth-helper.ts'), {
  getSupabaseAdminClient: () => { if (databaseMissing) throw new Error('Missing Supabase environment variables'); return fakeDb },
})
stub(path.join(PROJECT, 'lib/campaigns/dispatcher.ts'), {
  dispatchDueCampaigns: async (args) => {
    calls.push(['campaigns', args])
    if (failing.campaigns) throw new Error('campaigns table is locked')
    return { claimed: 1, restarted: 0, errors: 0, campaigns: [] }
  },
})
stub(path.join(PROJECT, 'lib/scheduler/checkout-reminders.ts'), {
  sendCheckoutReminders: async (args) => {
    calls.push(['checkout_reminders', args])
    if (failing.checkout_reminders) throw new Error('WhatsApp is down')
    return { scanned: 2, sent: 1, failed: 0, waiting: 1 }
  },
})
stub(path.join(PROJECT, 'lib/scheduler/flow-sessions.ts'), {
  expireIdleFlowSessions: async (args) => {
    calls.push(['flow_sessions', args])
    if (failing.flow_sessions) throw new Error('flow_sessions is locked')
    return { expired: 3, batches: 1 }
  },
})
const originalError = console.error
console.error = (...args) => { if (!String(args[0]).startsWith('[Cron Tick]')) originalError(...args) }

const route = require(path.join(PROJECT, 'app/api/cron/tick/route.ts'))
const { authorizeCronRequest } = require(path.join(PROJECT, 'lib/scheduler/cron-auth.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))

const tick = (headers = {}, method = 'GET') => route[method](new NextRequest('https://wamacrm.example.com/api/cron/tick', { method, headers }))

function reset() {
  calls = []
  failing = {}
  databaseMissing = false
  process.env.CRON_SECRET = SECRET
}

test('Cron tick: without CRON_SECRET nothing runs and the answer says what is missing', async () => {
  reset()
  delete process.env.CRON_SECRET
  const res = await tick({ authorization: `Bearer ${SECRET}` })
  assert.equal(res.status, 503)
  assert.equal((await res.json()).error, 'CRON_SECRET is not configured')
  assert.equal(calls.length, 0)

  process.env.CRON_SECRET = '   '
  assert.equal((await tick({ authorization: `Bearer ${SECRET}` })).status, 503)
})

test('Cron tick: a missing or wrong secret is refused before any job runs', async () => {
  reset()
  for (const headers of [{}, { authorization: `Bearer ${SECRET}x` }, { authorization: SECRET }, { 'x-cron-secret': 'wrong' }, { authorization: 'Bearer wrong', 'x-cron-secret': 'also wrong' }]) {
    const res = await tick(headers)
    assert.equal(res.status, 401, JSON.stringify(headers))
    assert.equal((await res.json()).error, 'Unauthorized')
  }
  assert.equal(calls.length, 0)
})

test('Cron tick: the Vercel Cron bearer token runs every job and reports each one', async () => {
  reset()
  const res = await tick({ authorization: `Bearer ${SECRET}` })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.ok(!Number.isNaN(Date.parse(body.ran_at)), 'ran_at is a timestamp')
  assert.equal(typeof body.duration_ms, 'number')
  assert.deepEqual(Object.keys(body.jobs), ['campaigns', 'checkout_reminders', 'flow_sessions'])
  for (const job of Object.values(body.jobs)) {
    assert.equal(job.ok, true)
    assert.equal(typeof job.duration_ms, 'number')
  }
  assert.equal(body.jobs.campaigns.claimed, 1)
  assert.equal(body.jobs.checkout_reminders.sent, 1)
  assert.equal(body.jobs.flow_sessions.expired, 3)

  // Every job gets the same service-role client and the same clock
  assert.deepEqual(calls.map(([name]) => name), ['campaigns', 'checkout_reminders', 'flow_sessions'])
  for (const [, args] of calls) {
    assert.equal(args.supabase, fakeDb)
    assert.equal(args.now.toISOString(), body.ran_at)
  }
  assert.equal(calls[0][1].origin, 'https://wamacrm.example.com')
  assert.equal(calls[1][1].limit, 50, 'at most 50 reminders per tick')
  assert.ok(calls[1][1].deadline > Date.now() && calls[1][1].deadline < Date.now() + 60 * 1000, 'reminders stop well within the minute')
  assert.ok(calls[2][1].deadline > calls[1][1].deadline && calls[2][1].deadline < Date.now() + 60 * 1000, 'session expiry gets time of its own')
})

test('Cron tick: the x-cron-secret header works too, for GET and POST', async () => {
  reset()
  assert.equal((await tick({ 'x-cron-secret': SECRET })).status, 200)
  assert.equal((await tick({ 'x-cron-secret': SECRET }, 'POST')).status, 200)
  assert.equal((await tick({ authorization: 'Bearer wrong', 'x-cron-secret': SECRET })).status, 200)
  assert.equal(calls.length, 9)
})

test('Cron tick: one failing job is reported with its error and the others still run', async () => {
  reset()
  failing = { campaigns: true }
  const res = await tick({ authorization: `Bearer ${SECRET}` })
  assert.equal(res.status, 200, 'the tick itself did its job')
  const body = await res.json()
  assert.equal(body.ok, false)
  assert.equal(body.jobs.campaigns.ok, false)
  assert.equal(body.jobs.campaigns.error, 'campaigns table is locked')
  assert.equal(body.jobs.checkout_reminders.ok, true)
  assert.equal(body.jobs.flow_sessions.ok, true)
  assert.deepEqual(calls.map(([name]) => name), ['campaigns', 'checkout_reminders', 'flow_sessions'])
})

test('Cron tick: a database that is not configured is a 503, not a crash', async () => {
  reset()
  databaseMissing = true
  const res = await tick({ authorization: `Bearer ${SECRET}` })
  assert.equal(res.status, 503)
  assert.match((await res.json()).error, /Supabase/)
  assert.equal(calls.length, 0)
})

test('Cron tick: the function declares the minute Vercel allows it', () => {
  assert.equal(route.maxDuration, 60)
  assert.equal(route.GET, route.POST)
})

test('Cron tick: the secret check ignores surrounding spaces and the case of "Bearer"', () => {
  const headers = (entries) => new Headers(entries)
  assert.deepEqual(authorizeCronRequest(headers({ authorization: `bearer  ${SECRET} ` }), SECRET), { ok: true })
  assert.deepEqual(authorizeCronRequest(headers({ 'x-cron-secret': ` ${SECRET}` }), SECRET), { ok: true })
  assert.equal(authorizeCronRequest(headers({ authorization: `Bearer ${SECRET.slice(0, -1)}` }), SECRET).status, 401)
  assert.equal(authorizeCronRequest(headers({ 'x-cron-secret': '' }), SECRET).status, 401)
  assert.equal(authorizeCronRequest(headers({ 'x-cron-secret': SECRET }), undefined).status, 503)
})
