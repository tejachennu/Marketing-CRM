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
const OWN_APP_WORKSPACE = '22222222-2222-4222-8222-222222222222' // connected with its own Meta app, its app secret saved in Settings
const SIGNUP_WORKSPACE = '33333333-3333-4333-8333-333333333333' // connected through this app's signup
const EXPIRED_WORKSPACE = '44444444-4444-4444-8444-444444444444' // its token no longer works
const NO_SECRET_WORKSPACE = '55555555-5555-4555-8555-555555555555' // its own Meta app, but no app secret saved yet
const EXPIRED_OWN_APP_WORKSPACE = '66666666-6666-4666-8666-666666666666' // its own Meta app and its secret saved, but its token has expired

process.env.NEXT_PUBLIC_META_APP_ID = THIS_APP
process.env.META_APP_SECRET = THIS_SECRET
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.invalid'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'

const logged = { log: [], warn: [], error: [] }
for (const level of ['log', 'warn', 'error']) {
  const original = console[level]
  console[level] = (...args) => { logged[level].push(args.map(String).join(' ')); if (!String(args[0]).startsWith('[Facebook Webhook')) original(...args) }
}

const workspaces = {
  [OWN_APP_WORKSPACE]: { id: OWN_APP_WORKSPACE, whatsapp_provider: 'facebook', whatsapp_api_token: 'OWN_APP_TOKEN', whatsapp_app_secret: OWN_APP_SECRET, whatsapp_business_account_id: '500000000000001', whatsapp_phone_number_id: '600000000000001' },
  [SIGNUP_WORKSPACE]: { id: SIGNUP_WORKSPACE, whatsapp_provider: 'facebook', whatsapp_api_token: 'SIGNUP_TOKEN', whatsapp_business_account_id: '500000000000002', whatsapp_phone_number_id: '600000000000002' },
  [EXPIRED_WORKSPACE]: { id: EXPIRED_WORKSPACE, whatsapp_provider: 'facebook', whatsapp_api_token: 'EXPIRED_TOKEN', whatsapp_business_account_id: '500000000000003', whatsapp_phone_number_id: '600000000000003' },
  [NO_SECRET_WORKSPACE]: { id: NO_SECRET_WORKSPACE, whatsapp_provider: 'facebook', whatsapp_api_token: 'NO_SECRET_TOKEN', whatsapp_business_account_id: '500000000000004', whatsapp_phone_number_id: '600000000000004' },
  [EXPIRED_OWN_APP_WORKSPACE]: { id: EXPIRED_OWN_APP_WORKSPACE, whatsapp_provider: 'facebook', whatsapp_api_token: 'EXPIRED_TOKEN_2', whatsapp_app_secret: OWN_APP_SECRET, whatsapp_business_account_id: '500000000000006', whatsapp_phone_number_id: '600000000000006' },
}
let ownerLookups = 0
let secretColumnExists = true // false until supabase/migrations/20261104_whatsapp_app_secret.sql is applied
const fakeDb = {
  from() {
    let columns = '*'
    const query = {
      select: (requested = '*') => { columns = requested; return query },
      eq: (_col, id) => ({
        maybeSingle: async () => {
          if (secretColumnExists) return { data: workspaces[id] || null, error: null }
          if (columns.includes('whatsapp_app_secret')) return { data: null, error: { code: '42703', message: 'column organizations.whatsapp_app_secret does not exist' } }
          const { whatsapp_app_secret, ...row } = workspaces[id] || {}
          return { data: workspaces[id] ? row : null, error: null }
        },
      }),
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
    const answer = { OWN_APP_TOKEN: { id: '999' }, NO_SECRET_TOKEN: { id: '888' }, SIGNUP_TOKEN: { id: THIS_APP } }[token]
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

test("Webhook route: a workspace's own Meta app is accepted, with its saved app secret, for that workspace only", async () => {
  ownerLookups = 0
  const res = await deliver(OWN_APP_WORKSPACE, sign(OWN_APP_SECRET))
  assert.equal(res.status, 200)
  assert.equal(ownerLookups, 0, 'an event this app did not sign is never handed to another workspace')
})

test("Webhook route: a workspace's own Meta app is refused with a wrong signature, or without a saved app secret", async () => {
  assert.equal((await deliver(OWN_APP_WORKSPACE, sign('not-their-secret'))).status, 403)
  assert.equal((await deliver(OWN_APP_WORKSPACE, null)).status, 403)
  logged.error = []
  assert.equal((await deliver(NO_SECRET_WORKSPACE, sign(OWN_APP_SECRET))).status, 403)
  assert.ok(logged.error.some((line) => line.includes('Add the Meta app secret in Settings → WhatsApp')), 'the log says what to do')
})

test('Webhook route: before the app secret column exists there is no secret to check, and no crash', async () => {
  secretColumnExists = false
  try {
    assert.equal((await deliver(OWN_APP_WORKSPACE, sign(OWN_APP_SECRET))).status, 403)
    assert.equal((await deliver(SIGNUP_WORKSPACE, sign(THIS_SECRET))).status, 200, "this app's own events are unaffected")
  } finally { secretColumnExists = true }
})

test('Webhook route: META_WEBHOOK_ALLOW_UNSIGNED lets an own-app workspace through unverified, and nothing else', async () => {
  process.env.META_WEBHOOK_ALLOW_UNSIGNED = 'true'
  try {
    ownerLookups = 0
    assert.equal((await deliver(NO_SECRET_WORKSPACE, sign(OWN_APP_SECRET))).status, 200)
    assert.equal((await deliver(OWN_APP_WORKSPACE, null)).status, 200)
    assert.equal(ownerLookups, 0, 'still for that workspace only')
    assert.equal((await deliver(SIGNUP_WORKSPACE, sign(OWN_APP_SECRET))).status, 403, "a workspace on this app still needs this app's signature")
  } finally { delete process.env.META_WEBHOOK_ALLOW_UNSIGNED }
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

test("Webhook route: a workspace's saved app secret verifies its webhooks without asking Meta, even once its token has expired", async () => {
  appLookups = 0
  ownerLookups = 0
  // Payment captures and messages keep arriving after the workspace's WhatsApp token expired
  assert.equal((await deliver(EXPIRED_OWN_APP_WORKSPACE, sign(OWN_APP_SECRET))).status, 200)
  assert.equal(appLookups, 0, 'no Graph lookup with the dead token')
  assert.equal(ownerLookups, 0, 'still for that workspace only')
  // ...and a forged or unsigned payload is still refused
  logged.error = []
  assert.equal((await deliver(EXPIRED_OWN_APP_WORKSPACE, sign('not-their-secret'))).status, 403)
  assert.equal((await deliver(EXPIRED_OWN_APP_WORKSPACE, null)).status, 403)
  assert.ok(logged.error.some((line) => line.includes('may have expired')), 'the log says the token looks invalid')
  // A matching saved secret is proof whichever app the token names (a tenant can point its token at
  // its own app anyway), and this app's own signature still works for everyone
  appLookups = 0
  assert.equal((await deliver(OWN_APP_WORKSPACE, sign(OWN_APP_SECRET))).status, 200)
  assert.equal(appLookups, 0)
  assert.equal((await deliver(EXPIRED_OWN_APP_WORKSPACE, sign(THIS_SECRET))).status, 200)
})
