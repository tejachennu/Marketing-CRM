// Runs the Embedded Signup route against a fake Meta API and a fake database.
// Nothing here reaches the network or a real database: every fetch is answered below.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')

const ORG = '11111111-1111-4111-8111-111111111111'
const APP = '111'

// Fake database: records the update the route makes
let saved = null
let savedFor = null
const fakeDb = {
  from() {
    return {
      update(payload) { return { eq: async (_col, id) => { saved = payload; savedFor = id; return { error: null } } } },
      select() { return { eq: () => ({ maybeSingle: async () => ({ data: { meta_catalog_id: '' } }) }) } },
    }
  },
}
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }
stub(require.resolve('@supabase/supabase-js', { paths: [PROJECT] }), { createClient: () => fakeDb })
stub(path.join(PROJECT, 'lib/api-auth-helper.ts'), {
  getAuthenticatedUser: async () => ({ id: 'user-1', organization_id: ORG }),
  verifyOrgAccess: async () => ({ authorized: true }),
})

// Fake Meta: each scenario sets `meta`, a function from (method, url, body) to a JSON answer
let meta = null
let calls = []
global.fetch = async (input, init = {}) => {
  const url = new URL(String(input))
  const method = (init.method || 'GET').toUpperCase()
  const body = init.body ? JSON.parse(init.body) : undefined
  const auth = (init.headers && (init.headers.Authorization || init.headers.authorization)) || url.searchParams.get('access_token') || ''
  calls.push({ method, path: url.pathname.replace(/^\/v\d+\.\d+/, ''), query: Object.fromEntries(url.searchParams), body, auth })
  const answer = meta(method, url, body)
  if (answer === undefined) throw new Error('Unexpected Meta call: ' + method + ' ' + url.pathname + url.search)
  return new Response(JSON.stringify(answer), { status: answer && answer.error ? 400 : 200, headers: { 'Content-Type': 'application/json' } })
}

const { POST } = require(path.join(PROJECT, 'app/api/whatsapp/embedded-signup/route.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))

async function run(name, body, answers, envOverrides = {}) {
  saved = null; savedFor = null; calls = []; meta = answers
  const env = { NEXT_PUBLIC_META_APP_ID: APP, META_APP_SECRET: 'test-secret', NEXT_PUBLIC_SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'x', NEXT_PUBLIC_APP_URL: 'https://wamacrm.example.com', WHATSAPP_PIN_SECRET: '', ...envOverrides }
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  const res = await POST(new NextRequest('https://wamacrm.example.com/api/whatsapp/embedded-signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: ORG, ...body }) }))
  const json = await res.json()
  return { name, status: res.status, json, saved, savedFor, calls }
}

// Meta answers shared by the scenarios
const exchange = (method, url) => {
  if (url.pathname.endsWith('/oauth/access_token') && url.searchParams.get('code')) {
    return url.searchParams.get('code') === 'GOOD' && url.searchParams.get('client_secret') === 'test-secret' && url.searchParams.get('client_id') === APP
      ? { access_token: 'BUSINESS_TOKEN' } : { error: { message: 'Invalid verification code format.' } }
  }
  // A business token is not a user token: the long-lived upgrade is refused and the route keeps it
  if (url.pathname.endsWith('/oauth/access_token') && url.searchParams.get('grant_type') === 'fb_exchange_token') return { error: { message: 'Not a user access token' } }
}
const phone = { id: '300000000000001', display_phone_number: '+91 90000 00000', verified_name: 'Shop' }
const accountAndNumber = (granted) => (method, url, body) => exchange(method, url)
  ?? (url.pathname.endsWith('/debug_token') ? { data: { is_valid: true, scopes: ['business_management', 'whatsapp_business_management', 'whatsapp_business_messaging'], granular_scopes: granted } } : undefined)
  ?? (method === 'GET' && url.pathname.endsWith('/300000000000001') ? phone : undefined)
  ?? (method === 'GET' && url.pathname.endsWith('/200000000000001/phone_numbers') ? { data: [phone] } : undefined)
  ?? (method === 'POST' && url.pathname.endsWith('/200000000000001/subscribed_apps') ? { success: true } : undefined)
  ?? (method === 'POST' && url.pathname.endsWith('/300000000000001/register') ? { success: true } : undefined)


for (const level of ['log', 'warn', 'error']) {
  const original = console[level]
  console[level] = (...args) => { if (!String(args[0]).startsWith('[Meta Embedded Signup]')) original(...args) }
}

test('Embedded Signup: IDs from the finished message are saved, subscribed and registered with the customer token', async () => {
  const r = await run('IDs from the finished message', { code: 'GOOD', wabaId: '200000000000001', phoneNumberId: '300000000000001', businessId: '400000000000001' }, accountAndNumber([]))
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.equal(r.savedFor, ORG)
  assert.deepEqual({ ...r.saved }, { whatsapp_provider: 'facebook', whatsapp_api_token: 'BUSINESS_TOKEN', whatsapp_graph_api_version: 'v25.0', whatsapp_business_account_id: '200000000000001', whatsapp_phone_number_id: '300000000000001', whatsapp_default_phone: '+91 90000 00000' })
  const subscribe = r.calls.find((c) => c.method === 'POST' && c.path === '/200000000000001/subscribed_apps')
  assert.equal(subscribe.auth, 'Bearer BUSINESS_TOKEN')
  assert.deepEqual(subscribe.body, { override_callback_uri: `https://wamacrm.example.com/api/webhooks/facebook/${ORG}`, verify_token: ORG })
  const register = r.calls.find((c) => c.method === 'POST' && c.path === '/300000000000001/register')
  assert.equal(register.auth, 'Bearer BUSINESS_TOKEN')
  assert.deepEqual(register.body, { messaging_product: 'whatsapp', pin: '123456' })
  assert.equal(r.json.data.webhook.routed, true)
  assert.ok(!r.calls.some((c) => c.query.client_secret && c.path !== '/oauth/access_token'), 'app secret only sent to the token endpoint')
})

test('Embedded Signup: without the finished message, the account comes from the token grant', async () => {
  const r = await run('IDs from the token grant', { code: 'GOOD' }, accountAndNumber([{ scope: 'whatsapp_business_management', target_ids: ['200000000000001'] }, { scope: 'whatsapp_business_messaging', target_ids: ['300000000000001'] }]))
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.equal(r.saved.whatsapp_business_account_id, '200000000000001')
  assert.equal(r.saved.whatsapp_phone_number_id, '300000000000001')
})

test('Embedded Signup: a business granted with no WhatsApp account saves nothing', async () => {
  const r = await run('No WhatsApp account shared', { code: 'GOOD' }, accountAndNumber([{ scope: 'business_management' }, { scope: 'whatsapp_business_management' }, { scope: 'whatsapp_business_messaging' }]))
  assert.equal(r.status, 422)
  assert.match(r.json.error, /without sharing a WhatsApp Business account/)
  assert.equal(r.saved, null, 'nothing saved')
  assert.ok(!r.calls.some((c) => c.method === 'POST'), 'no subscribe or register')
})

test('Embedded Signup: an account without a phone number saves nothing', async () => {
  const r = await run('Account without a number', { code: 'GOOD', wabaId: '200000000000001' }, (m, u, b) => (m === 'GET' && u.pathname.endsWith('/200000000000001/phone_numbers') ? { data: [] } : accountAndNumber([])(m, u, b)))
  assert.equal(r.status, 422)
  assert.match(r.json.error, /no phone number yet/)
  assert.equal(r.saved, null)
})

test('Embedded Signup: a refused webhook address still subscribes the app and tells the page', async () => {
  const r = await run('Webhook address refused', { code: 'GOOD', wabaId: '200000000000001', phoneNumberId: '300000000000001' }, (m, u, b) => (m === 'POST' && u.pathname.endsWith('/200000000000001/subscribed_apps') && b ? { error: { message: 'Callback verification failed' } } : accountAndNumber([])(m, u, b)))
  assert.equal(r.status, 200)
  assert.equal(r.json.data.webhook.routed, false)
  assert.match(r.json.data.webhook.reason, /Callback verification failed/)
  assert.equal(r.calls.filter((c) => c.method === 'POST' && c.path === '/200000000000001/subscribed_apps').length, 2)
})

test('Embedded Signup: an expired or reused code saves nothing', async () => {
  const r = await run('Bad or expired code', { code: 'EXPIRED', wabaId: '200000000000001', phoneNumberId: '300000000000001' }, accountAndNumber([]))
  assert.equal(r.status, 400)
  assert.equal(r.saved, null)
})

test('Embedded Signup: a server without the app secret saves nothing', async () => {
  const r = await run('No app secret on the server', { code: 'GOOD', wabaId: '200000000000001', phoneNumberId: '300000000000001' }, accountAndNumber([]), { META_APP_SECRET: undefined })
  assert.equal(r.status, 500)
  assert.equal(r.saved, null)
})

test('Embedded Signup: a number registered with another PIN is still connected', async () => {
  const r = await run('Number registered with another PIN', { code: 'GOOD', wabaId: '200000000000001', phoneNumberId: '300000000000001' }, (m, u, b) => (m === 'POST' && u.pathname.endsWith('/300000000000001/register') ? { error: { code: 133005, message: 'Two step verification PIN Mismatch' } } : accountAndNumber([])(m, u, b)))
  assert.equal(r.status, 200, 'registration problems do not lose the connection')
  assert.equal(r.saved.whatsapp_phone_number_id, '300000000000001')
})
