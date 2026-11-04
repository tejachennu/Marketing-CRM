// What ships with the scheduler: the Vercel cron schedule, the pg_cron template, the
// migrations the jobs rely on, and the hand-off helper the tick starts campaign workers with.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(PROJECT, file), 'utf8')
const squash = (sql) => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').trim().toLowerCase()

const { startWorkerInOwnInvocation, workerDeadline, START_TIMEOUT_MS, STOP_MARGIN_MS, SENDING_RESET_AFTER_MS } = require(path.join(PROJECT, 'lib/scheduler/campaign-worker.ts'))
const { configuredCronSecret, cronSecretsFromEnv } = require(path.join(PROJECT, 'lib/scheduler/cron-auth.ts'))
let warnings = []
const originalWarn = console.warn
console.warn = (...args) => { if (String(args[0]).startsWith('[Campaign Dispatcher]')) warnings.push(String(args[0])); else originalWarn(...args) }

test('Deployment: vercel.json ships a schedule every plan accepts, on the tick', () => {
  const { crons } = JSON.parse(read('vercel.json'))
  assert.deepEqual(crons, [{ path: '/api/cron/tick', schedule: '30 3 * * *' }])
})

test('Deployment: the README tells Pro projects to go to 10 minutes and Hobby projects to pg_cron', () => {
  const readme = read('README.md')
  const section = readme.slice(readme.indexOf('## ⏰ Scheduled jobs'), readme.indexOf('## 🧩 Feature switches'))
  assert.ok(section.includes('`30 3 * * *`'))
  assert.ok(section.includes('`*/10 * * * *`'))
  assert.match(section, /within the hour/)
  assert.match(section, /pg_cron/)
  assert.match(section, /PG_CRON_SECRET/)
  assert.match(section, /timeout_milliseconds := 60000/)
  assert.match(section, /CAMPAIGN_WORKER_MAX_SECONDS/)
  assert.match(section, /500/)
})

test('Deployment: the pg_cron template changes nothing as it is, and its call waits long enough for a real tick', () => {
  const template = read('supabase/migrations/20261104_scheduler_pg_cron.sql')
  assert.ok(template.split('\n').every((line) => line.trim() === '' || line.trim().startsWith('--')), 'every statement is commented out')
  assert.match(template, /timeout_milliseconds := 60000/)
  assert.match(template, /YOUR_PG_CRON_SECRET/)
  assert.match(template, /'\*\/10 \* \* \* \*'/)
  assert.match(template, /x-cron-secret/)
})

test('Deployment: the reminders migration marks the old open carts as already reminded', () => {
  const migration = squash(read('supabase/migrations/20261104_commerce_reminders.sql'))
  assert.ok(migration.includes(
    "update public.commerce_orders set reminder_count = 2 where reminder_count = 0 and status in ('cart_submitted','awaiting_address','payment_pending') and created_at < now() - interval '7 days';"
  ), migration)
  assert.ok(migration.includes('add column if not exists reminder_count integer not null default 0'))
  assert.ok(migration.includes('add column if not exists next_reminder_at timestamptz'))
  assert.ok(migration.includes('add column if not exists commerce_reminders_enabled boolean not null default true'))
})

test('Deployment: the idle-session sweep has its partial index', () => {
  const migration = squash(read('supabase/migrations/20261104_flow_sessions_idle_index.sql'))
  assert.equal(migration, "create index if not exists flow_sessions_idle_idx on public.flow_sessions (last_interaction_at) where status in ('in_progress','paused_rag');")
})

test('Hand-off: the worker gets the plan\'s limit, or the configured one', () => {
  const before = Date.now()
  assert.ok(workerDeadline(300, {}) >= before + 300 * 1000)
  assert.ok(workerDeadline(300, { CAMPAIGN_WORKER_MAX_SECONDS: '60' }) <= Date.now() + 60 * 1000)
  assert.ok(workerDeadline(300, { CAMPAIGN_WORKER_MAX_SECONDS: 'soon' }) >= before + 300 * 1000)
  assert.ok(workerDeadline(300, { CAMPAIGN_WORKER_MAX_SECONDS: '-5' }) >= before + 300 * 1000)
  assert.equal(STOP_MARGIN_MS, 10 * 1000)
  assert.equal(SENDING_RESET_AFTER_MS, 10 * 60 * 1000)
  assert.equal(START_TIMEOUT_MS, 5 * 1000)
})

test('Hand-off: the tick presents the first configured secret; either one is accepted', () => {
  assert.equal(configuredCronSecret({ CRON_SECRET: ' vercel ', PG_CRON_SECRET: 'pg' }), 'vercel')
  assert.equal(configuredCronSecret({ CRON_SECRET: '', PG_CRON_SECRET: ' pg ' }), 'pg')
  assert.equal(configuredCronSecret({}), undefined)
  assert.deepEqual(cronSecretsFromEnv({ CRON_SECRET: 'a', PG_CRON_SECRET: 'b' }), ['a', 'b'])
})

test('Hand-off: the campaign is posted to the worker route with the secret, and a timeout is not a failure', async () => {
  const requests = []
  let answer = () => new Response('', { status: 202 })
  const fetcher = async (url, init) => { requests.push([url, init]); return answer() }
  const start = startWorkerInOwnInvocation({ origin: 'https://wamacrm.example.com/', secret: 's3cret', fetcher, env: {} })

  await start('camp-1', 'Execution error')
  assert.equal(requests.length, 1)
  assert.equal(requests[0][0], 'https://wamacrm.example.com/api/campaigns/run/worker', 'one slash, whatever the origin ends with')
  assert.deepEqual(requests[0][1].headers, { 'Content-Type': 'application/json', 'x-cron-secret': 's3cret' })
  assert.equal(requests[0][1].method, 'POST')
  assert.deepEqual(JSON.parse(requests[0][1].body), { campaignId: 'camp-1' })
  assert.ok(requests[0][1].signal instanceof AbortSignal)

  warnings = []
  answer = () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }) }
  await start('camp-2', 'Execution error')
  assert.ok(warnings.some((line) => line.includes('camp-2') && line.includes('assuming it started')))

  // Without a fallback, any other failure is the caller's to count
  answer = () => new Response('Authentication Required', { status: 401 })
  await assert.rejects(() => start('camp-3', 'Execution error'), /answered 401: Authentication Required/)
  answer = () => { throw new TypeError('fetch failed') }
  await assert.rejects(() => start('camp-4', 'Execution error'), /could not be reached: fetch failed/)

  // With one, the failure is logged and the fallback runs the campaign
  const fallbacks = []
  const withFallback = startWorkerInOwnInvocation({ origin: 'https://wamacrm.example.com', secret: 's3cret', fetcher, env: { VERCEL_AUTOMATION_BYPASS_SECRET: 'bypass' }, fallback: (id, context) => fallbacks.push([id, context]) })
  await withFallback('camp-5', 'Failed to resume stuck campaign')
  assert.deepEqual(fallbacks, [['camp-5', 'Failed to resume stuck campaign']])
  assert.equal(requests[requests.length - 1][1].headers['x-vercel-protection-bypass'], 'bypass')
  answer = () => new Response('', { status: 202 })
  await withFallback('camp-6', 'Execution error')
  assert.equal(fallbacks.length, 1, 'no fallback when the route took the campaign')
})
