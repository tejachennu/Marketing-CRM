// Runs the Meta webhook route's signature gate against a fake database and a fake Meta API.
// Nothing here reaches the network or a real database.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createHmac } = require('node:crypto')

const PROJECT = path.join(__dirname, '..')
const THIS_APP = '111'
const THIS_SECRET = 'this-app-secret'
const OWN_APP_SECRET = 'their-own-app-secret'
const OWN_APP_WORKSPACE = '22222222-2222-4222-8222-222222222222' // connected with its own Meta app
const SIGNUP_WORKSPACE = '33333333-3333-4333-8333-333333333333' // connected through this app's signup
const EXPIRED_WORKSPACE = '44444444-4444-4444-8444-444444444444' // its token no longer works

process.env.NEXT_PUBLIC_META_APP_ID = THIS_APP
process.env.META_APP_SECRET = THIS_SECRET
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.invalid'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'

for (const level of ['log', 'warn', 'error']) {
  const original = console[level]
  console[level] = (...args) => { if (!String(args[0]).startsWith('[Facebook Webhook')) original(...args) }
}

const workspaces = {
  [OWN_APP_WORKSPACE]: { id: OWN_APP_WORKSPACE, whatsapp_provider: 'facebook', whatsapp_api_token: 'OWN_APP_TOKEN', whatsapp_business_account_id: '500000000000001', whatsapp_phone_number_id: '600000000000001' },
  [SIGNUP_WORKSPACE]: { id: SIGNUP_WORKSPACE, whatsapp_provider: 'facebook', whatsapp_api_token: 'SIGNUP_TOKEN', whatsapp_business_account_id: '500000000000002', whatsapp_phone_number_id: '600000000000002' },
  [EXPIRED_WORKSPACE]: { id: EXPIRED_WORKSPACE, whatsapp_provider: 'facebook', whatsapp_api_token: 'EXPIRED_TOKEN', whatsapp_business_account_id: '500000000000003', whatsapp_phone_number_id: '600000000000003' },
}
let ownerLookups = 0
const fakeDb = {
  from() {
    const query = {
      select: () => query,
      eq: (_col, id) => ({ maybeSingle: async () => ({ data: workspaces[id] || null }) }),
      or: () => { ownerLookups++; return { limit: async () => ({ data: [], error: null }) } },
    }
    return query
  },
}
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }
stub(require.resolve('@supabase/supabase-js', { paths: [PROJECT] }), { createClient: () => fakeDb })

// Fake Meta: which app each saved token belongs to
let appLookups = 0
global.fetch = async (input, init = {}) => {
  const url = new URL(String(input))
  if (url.pathname.endsWith('/app')) {
    appLookups++
    const token = String((init.headers || {}).Authorization || '').replace('Bearer ', '')
    const answer = { OWN_APP_TOKEN: { id: '999' }, SIGNUP_TOKEN: { id: THIS_APP } }[token]
    return new Response(JSON.stringify(answer || { error: { message: 'Error validating access token', code: 190 } }), { status: answer ? 200 : 400 })
  }
  throw new Error('Unexpected Meta call: ' + url.pathname)
}

const { POST } = require(path.join(PROJECT, 'app/api/webhooks/facebook/[orgIdAndSlug]/route.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))

/** A message event for an account that no workspace has connected, so it stops before any processing. */
const BODY = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ id: '599999999999999', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '699999999999999' }, messages: [{ id: 'wamid.1', from: '919000000000', type: 'text', text: { body: 'hi' } }] } }] }],
})
const sign = (secret) => 'sha256=' + createHmac('sha256', secret).update(BODY).digest('hex')
const deliver = (workspace, signature) => POST(
  new NextRequest(`https://wamacrm.example.com/api/webhooks/facebook/${workspace}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(signature ? { 'X-Hub-Signature-256': signature } : {}) }, body: BODY }),
  { params: { orgIdAndSlug: workspace } }
)

test('Webhook route: an event signed with this app may go to the workspace that has its account', async () => {
  ownerLookups = 0
  const res = await deliver(SIGNUP_WORKSPACE, sign(THIS_SECRET))
  assert.equal(res.status, 200)
  assert.equal(ownerLookups, 1, 'looked up the owning workspace')
})

test("Webhook route: a workspace's own Meta app is accepted for that workspace only", async () => {
  ownerLookups = 0
  const res = await deliver(OWN_APP_WORKSPACE, sign(OWN_APP_SECRET))
  assert.equal(res.status, 200)
  assert.equal(ownerLookups, 0, 'an event this server cannot verify is never handed to another workspace')
})

test('Webhook route: a workspace connected through this app only takes events signed by this app', async () => {
  assert.equal((await deliver(SIGNUP_WORKSPACE, sign(OWN_APP_SECRET))).status, 403)
  assert.equal((await deliver(SIGNUP_WORKSPACE, null)).status, 403)
  assert.equal((await deliver(EXPIRED_WORKSPACE, sign(OWN_APP_SECRET))).status, 403, 'unknown app: refused, Meta retries')
  assert.equal((await deliver('not-a-workspace', sign(OWN_APP_SECRET))).status, 403)
})

test("Webhook route: a workspace's app is looked up once, not for every message", async () => {
  appLookups = 0
  await deliver(OWN_APP_WORKSPACE, sign(OWN_APP_SECRET))
  await deliver(OWN_APP_WORKSPACE, sign(OWN_APP_SECRET))
  assert.ok(appLookups <= 1, `looked up ${appLookups} times`)
})
