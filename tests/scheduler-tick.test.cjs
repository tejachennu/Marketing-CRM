// The cron tick: who may call it, how it reports its jobs, and how it starts campaign workers.
// The jobs themselves are faked here (each has its own test file); nothing reaches a database
// or the network.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const SECRET = 'a-long-random-cron-secret'
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

let calls = []
let failing = {}
let remindersSkipped = false
let databaseMissing = false
let campaignErrors = 0
let afterStarts = []
const fakeDb = { from() { throw new Error('the faked jobs never query') } }

stub(path.join(PROJECT, 'lib/api-auth-helper.ts'), {
  getSupabaseAdminClient: () => { if (databaseMissing) throw new Error('Missing Supabase environment variables'); return fakeDb },
})
stub(path.join(PROJECT, 'lib/campaigns/dispatcher.ts'), {
  dispatchDueCampaigns: async (args) => {
    calls.push(['campaigns', args])
    if (failing.campaigns) throw new Error('campaigns table is locked')
    return { claimed: 1, restarted: 0, errors: campaignErrors, campaigns: [] }
  },
  startWorkerAfterResponse: (id, context, options) => afterStarts.push([id, context, options]),
})
stub(path.join(PROJECT, 'lib/scheduler/checkout-reminders.ts'), {
  sendCheckoutReminders: async (args) => {
    calls.push(['checkout_reminders', args])
    if (failing.checkout_reminders) throw new Error('WhatsApp is down')
    if (remindersSkipped) return { skipped: true, scanned: 0, sent: 0, failed: 0, waiting: 0, held: 0 }
    return { scanned: 2, sent: 1, failed: 0, waiting: 1, held: 0 }
  },
})
stub(path.join(PROJECT, 'lib/scheduler/flow-sessions.ts'), {
  expireIdleFlowSessions: async (args) => {
    calls.push(['flow_sessions', args])
    if (failing.flow_sessions) throw new Error('flow_sessions is locked')
    return { expired: 3, batches: 1 }
  },
})
for (const level of ['warn', 'error']) {
  const original = console[level]
  console[level] = (...args) => { if (!/^\[(Cron Tick|Campaign Dispatcher)\]/.test(String(args[0]))) original(...args) }
}

// The hand-off of a campaign to its own invocation is an HTTP call to this deployment
let fetches = []
let fetchAnswer = () => new Response(JSON.stringify({ success: true }), { status: 202 })
global.fetch = async (url, init) => { fetches.push([url, init]); return fetchAnswer() }

const route = require(path.join(PROJECT, 'app/api/cron/tick/route.ts'))
const { authorizeCronRequest } = require(path.join(PROJECT, 'lib/scheduler/cron-auth.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))

const tick = (headers = {}, method = 'GET') => route[method](new NextRequest('https://wamacrm.example.com/api/cron/tick', { method, headers }))

function reset() {
  calls = []
  failing = {}
  remindersSkipped = false
  databaseMissing = false
  campaignErrors = 0
  afterStarts = []
  fetches = []
  fetchAnswer = () => new Response(JSON.stringify({ success: true }), { status: 202 })
  process.env.CRON_SECRET = SECRET
  delete process.env.PG_CRON_SECRET
  delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET
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
  assert.deepEqual(body.skipped, [])
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
  assert.equal(typeof calls[0][1].startWorker, 'function', 'campaign workers are started the tick\'s way, not in this invocation')
  assert.ok(calls[0][1].deadline > Date.now() && calls[0][1].deadline < calls[1][1].deadline, 'the dispatch stops claiming before the reminders need the time')
  assert.equal(calls[1][1].limit, 50, 'at most 50 reminders per tick')
  assert.ok(calls[1][1].deadline > Date.now() && calls[1][1].deadline < Date.now() + 60 * 1000, 'reminders stop well within the minute')
  assert.ok(calls[2][1].deadline > calls[1][1].deadline && calls[2][1].deadline < Date.now() + 60 * 1000, 'session expiry gets time of its own')
})

test('Cron tick: a campaign is handed to the worker route in an invocation of its own, with the cron secret', async () => {
  reset()
  await tick({ authorization: `Bearer ${SECRET}` })
  const { startWorker } = calls[0][1]
  assert.equal(fetches.length, 0, 'nothing is called until a campaign is claimed')

  await startWorker('campaign-1', 'Execution error')
  assert.equal(fetches.length, 1)
  const [url, init] = fetches[0]
  assert.equal(url, 'https://wamacrm.example.com/api/campaigns/run/worker')
  assert.equal(init.method, 'POST')
  assert.equal(init.headers['x-cron-secret'], SECRET)
  assert.equal(init.headers['Content-Type'], 'application/json')
  assert.equal(init.headers['x-vercel-protection-bypass'], undefined)
  assert.deepEqual(JSON.parse(init.body), { campaignId: 'campaign-1' })
  assert.ok(init.signal instanceof AbortSignal, 'the hand-off is bounded; the tick does not wait for the campaign')
  assert.deepEqual(afterStarts, [], 'the worker does not run in the tick')

  // A protected deployment needs the bypass header to let the call through
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'bypass-token'
  await tick({ authorization: `Bearer ${SECRET}` })
  await calls[calls.length - 3][1].startWorker('campaign-2', 'Execution error')
  assert.equal(fetches[1][1].headers['x-vercel-protection-bypass'], 'bypass-token')
})

test('Cron tick: when the worker route cannot take the campaign, it runs here with what is left of the minute', async () => {
  reset()
  fetchAnswer = () => new Response('<html>Authentication Required</html>', { status: 401 })
  await tick({ authorization: `Bearer ${SECRET}` })
  const { startWorker } = calls[0][1]
  await startWorker('campaign-1', 'Execution error')
  assert.equal(afterStarts.length, 1)
  const [id, context, options] = afterStarts[0]
  assert.equal(id, 'campaign-1')
  assert.equal(context, 'Execution error')
  assert.ok(options.deadline > Date.now() && options.deadline <= Date.now() + 60 * 1000, 'the fallback worker pauses before the tick is cut off')

  // The same for a network failure
  fetchAnswer = () => { throw new TypeError('fetch failed') }
  await startWorker('campaign-2', 'Failed to resume stuck campaign')
  assert.equal(afterStarts.length, 2)
  assert.equal(afterStarts[1][0], 'campaign-2')

  // A timeout means the request went out and the route needs no answer from us: no fallback, or the campaign would run twice
  fetchAnswer = () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }) }
  await startWorker('campaign-3', 'Execution error')
  assert.equal(afterStarts.length, 2)
})

test('Cron tick: the x-cron-secret header works too, for GET and POST', async () => {
  reset()
  assert.equal((await tick({ 'x-cron-secret': SECRET })).status, 200)
  assert.equal((await tick({ 'x-cron-secret': SECRET }, 'POST')).status, 200)
  assert.equal((await tick({ authorization: 'Bearer wrong', 'x-cron-secret': SECRET })).status, 200)
  assert.equal(calls.length, 9)
})

test('Cron tick: PG_CRON_SECRET is a second, separately rotated secret for the pg_cron path', async () => {
  reset()
  process.env.PG_CRON_SECRET = 'the-database-side-secret'
  assert.equal((await tick({ 'x-cron-secret': 'the-database-side-secret' })).status, 200)
  assert.equal((await tick({ authorization: `Bearer ${SECRET}` })).status, 200, 'Vercel Cron still works')
  assert.equal((await tick({ 'x-cron-secret': 'neither' })).status, 401)

  // With only the pg_cron secret configured, that is the one the hand-off presents
  delete process.env.CRON_SECRET
  assert.equal((await tick({ 'x-cron-secret': 'the-database-side-secret' })).status, 200)
  await calls[calls.length - 3][1].startWorker('campaign-1', 'Execution error')
  assert.equal(fetches[0][1].headers['x-cron-secret'], 'the-database-side-secret')
})

test('Cron tick: a failing job makes the answer a 500 with its error, and the other jobs still run', async () => {
  reset()
  failing = { campaigns: true }
  const res = await tick({ authorization: `Bearer ${SECRET}` })
  assert.equal(res.status, 500, 'the scheduler\'s monitoring must see a failed run')
  const body = await res.json()
  assert.equal(body.ok, false)
  assert.deepEqual(body.skipped, [])
  assert.equal(body.jobs.campaigns.ok, false)
  assert.equal(body.jobs.campaigns.error, 'campaigns table is locked')
  assert.equal(body.jobs.checkout_reminders.ok, true)
  assert.equal(body.jobs.flow_sessions.ok, true)
  assert.deepEqual(calls.map(([name]) => name), ['campaigns', 'checkout_reminders', 'flow_sessions'])

  reset()
  failing = { flow_sessions: true }
  assert.equal((await tick({ authorization: `Bearer ${SECRET}` })).status, 500)
})

test('Cron tick: dispatch errors the dispatcher carried on past (a failed claim or watchdog query) make the answer a 500', async () => {
  reset()
  campaignErrors = 2
  const res = await tick({ authorization: `Bearer ${SECRET}` })
  assert.equal(res.status, 500)
  const body = await res.json()
  assert.equal(body.ok, false)
  assert.equal(body.jobs.campaigns.ok, false)
  assert.equal(body.jobs.campaigns.errors, 2)
  assert.equal(body.jobs.campaigns.claimed, 1, 'what did work is still reported')
  assert.match(body.jobs.campaigns.error, /2 campaign dispatch error/)
  assert.equal(body.jobs.checkout_reminders.ok, true)
  assert.equal(body.jobs.flow_sessions.ok, true)
})

test('Cron tick: a reminder started at the end of its budget still finishes inside the minute', async () => {
  reset()
  const startedAt = Date.now()
  await tick({ authorization: `Bearer ${SECRET}` })
  // 20 s: the reminders' SEND_TIMEOUT_MS, pinned in tests/scheduler-checkout-reminders.test.cjs
  assert.ok(calls[1][1].deadline - startedAt + 20 * 1000 <= 55 * 1000, 'budget plus one send leaves the tick time to answer')
})

test('Cron tick: a job that skips (its migration is not applied yet) is a 200, and is listed', async () => {
  reset()
  remindersSkipped = true
  const res = await tick({ authorization: `Bearer ${SECRET}` })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.deepEqual(body.skipped, ['checkout_reminders'])
  assert.equal(body.jobs.checkout_reminders.skipped, true)
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
  // Several secrets: any configured one is accepted, unconfigured ones are ignored
  assert.deepEqual(authorizeCronRequest(headers({ 'x-cron-secret': 'second' }), [SECRET, 'second']), { ok: true })
  assert.deepEqual(authorizeCronRequest(headers({ 'x-cron-secret': SECRET }), [undefined, SECRET]), { ok: true })
  assert.equal(authorizeCronRequest(headers({ 'x-cron-secret': '' }), ['', undefined]).status, 503)
})
