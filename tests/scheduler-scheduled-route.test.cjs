// GET /api/campaigns/scheduled, which the Campaigns page polls every 25 seconds, keeps its
// answer after the dispatch moved to lib/campaigns/dispatcher.ts. The dispatcher is faked here
// (tests/scheduler-dispatcher.test.cjs covers it); the database is a fake too.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

// Fake database: only the upcoming-campaigns query and the manual send/cancel update reach it
let campaigns = []
const fakeDb = {
  from() {
    const filters = []
    let values = null
    let limit = Infinity
    const rows = () => campaigns.filter((row) => filters.every((f) => f(row))).slice(0, limit)
    const query = {
      select: () => query,
      update: (payload) => { values = payload; return query },
      eq: (column, value) => { filters.push((row) => row[column] === value); return query },
      gt: (column, value) => { filters.push((row) => row[column] > value); return query },
      order: () => query,
      limit: (n) => { limit = n; return query },
      then(resolve, reject) {
        const found = rows()
        if (values) found.forEach((row) => Object.assign(row, values))
        return Promise.resolve({ data: values ? found.map(({ id }) => ({ id })) : found, error: null }).then(resolve, reject)
      },
    }
    return query
  },
}
stub(require.resolve('@supabase/supabase-js', { paths: [PROJECT] }), { createClient: () => fakeDb })
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.example.com'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'

let viewer = null
stub(path.join(PROJECT, 'lib/api-auth-helper.ts'), {
  getAuthenticatedUser: async () => viewer,
  verifyRecordAccess: async () => ({ authorized: true }),
})

let dispatchArgs = null
let dispatchResult = null
let started = []
stub(path.join(PROJECT, 'lib/campaigns/dispatcher.ts'), {
  dispatchDueCampaigns: async (args) => { dispatchArgs = args; if (dispatchResult instanceof Error) throw dispatchResult; return dispatchResult },
  startWorkerAfterResponse: (id, context) => started.push([id, context]),
})
const originalError = console.error
console.error = (...args) => { if (!String(args[0]).startsWith('[Scheduled')) originalError(...args) }

const route = require(path.join(PROJECT, 'app/api/campaigns/scheduled/route.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))
const get = () => route.GET(new NextRequest('https://wamacrm.example.com/api/campaigns/scheduled'))
const post = (body) => route.POST(new NextRequest('https://wamacrm.example.com/api/campaigns/scheduled', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))

function reset() {
  viewer = null
  started = []
  dispatchArgs = null
  dispatchResult = {
    claimed: 2,
    restarted: 1,
    errors: 0,
    campaigns: [
      { id: 'a1', name: 'A offer', scheduled_at: '2026-11-04T09:55:00.000Z', organization_id: ORG_A },
      { id: 'b1', name: 'B offer', scheduled_at: '2026-11-04T09:56:00.000Z', organization_id: ORG_B },
    ],
  }
  campaigns = [
    { id: 'a2', name: 'A later', status: 'SCHEDULED', scheduled_at: '2099-01-01T00:00:00.000Z', organization_id: ORG_A, total_contacts: 5, channel: 'whatsapp' },
    { id: 'b2', name: 'B later', status: 'SCHEDULED', scheduled_at: '2099-01-02T00:00:00.000Z', organization_id: ORG_B, total_contacts: 7, channel: 'whatsapp' },
    { id: 'a3', name: 'A done', status: 'COMPLETED', scheduled_at: '2026-01-01T00:00:00.000Z', organization_id: ORG_A },
  ]
}

test('Scheduled route: the poll dispatches without a session and reports only the count', async () => {
  reset()
  const res = await get()
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.deepEqual(Object.keys(body), ['success', 'timestamp', 'triggeredCount', 'triggeredCampaigns', 'upcomingCount', 'upcomingCampaigns'])
  assert.equal(body.success, true)
  assert.equal(body.triggeredCount, 2)
  assert.deepEqual(body.triggeredCampaigns, [])
  assert.equal(body.upcomingCount, 0)
  assert.deepEqual(body.upcomingCampaigns, [])
  // The dispatcher gets the route's own client, clock and host
  assert.equal(dispatchArgs.supabase, fakeDb)
  assert.equal(dispatchArgs.origin, 'https://wamacrm.example.com')
  assert.equal(dispatchArgs.now.toISOString(), body.timestamp)
})

test('Scheduled route: a signed-in member sees the campaigns of their own organization', async () => {
  reset()
  viewer = { id: 'user-1', role: 'org_manager', organization_id: ORG_A }
  const body = await (await get()).json()
  assert.equal(body.triggeredCount, 2, 'the count covers every organization, as before')
  assert.deepEqual(body.triggeredCampaigns, [{ id: 'a1', name: 'A offer', scheduled_at: '2026-11-04T09:55:00.000Z' }])
  assert.deepEqual(body.upcomingCampaigns.map((c) => c.id), ['a2'])
  assert.equal(body.upcomingCount, 1)

  viewer = { id: 'root', role: 'superadmin', organization_id: null }
  const all = await (await get()).json()
  assert.deepEqual(all.triggeredCampaigns.map((c) => c.id), ['a1', 'b1'])
  assert.deepEqual(all.upcomingCampaigns.map((c) => c.id), ['a2', 'b2'])
})

test('Scheduled route: a dispatch failure is a 500 with the reason, as before', async () => {
  reset()
  dispatchResult = new Error('campaigns table is locked')
  const res = await get()
  assert.equal(res.status, 500)
  assert.equal((await res.json()).error, 'campaigns table is locked')
})

test('Scheduled route: "send now" starts the worker once the campaign is claimed; a second click is refused', async () => {
  reset()
  const res = await post({ campaignId: 'a2', action: 'send_now' })
  assert.equal(res.status, 200)
  assert.equal(campaigns.find((c) => c.id === 'a2').status, 'PROCESSING')
  assert.deepEqual(started, [['a2', 'Immediate dispatch error']])

  const again = await post({ campaignId: 'a2', action: 'send_now' })
  assert.equal(again.status, 409)
  assert.equal(started.length, 1)

  assert.equal((await post({ campaignId: 'b2', action: 'cancel_schedule' })).status, 200)
  assert.equal(campaigns.find((c) => c.id === 'b2').status, 'STOPPED')
  assert.equal(started.length, 1)
})
