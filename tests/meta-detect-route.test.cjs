// Store settings read from Meta: the detection route and its helpers, against a fake Meta API and a
// fake database. Nothing here reaches the network or a real database.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const ORG = '66666666-6666-4666-8666-666666666666'
const WABA = '200000000000001'
const PHONE = '300000000000001'
const BUSINESS = '400000000000001'
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

let org = {}
const fakeDb = { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: org, error: null }) }) }) }) }
stub(require.resolve('@supabase/supabase-js', { paths: [PROJECT] }), { createClient: () => fakeDb })
stub(path.join(PROJECT, 'lib/api-auth-helper.ts'), { verifyOrgAccess: async () => ({ authorized: true }), getSupabaseAdminClient: () => fakeDb })

// Fake Meta, answering per path; `meta.expired` makes every call fail like an expired token
const meta = { expired: false, catalogRefused: false }
const calls = []
global.fetch = async (input, init = {}) => {
  const url = new URL(String(input))
  const auth = String((init.headers || {}).Authorization || '')
  calls.push({ path: url.pathname.replace(/^\/v\d+\.\d+/, ''), auth })
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status })
  if (meta.expired) return reply({ error: { code: 190, message: 'Error validating access token: Session has expired' } }, 400)
  const p = url.pathname
  if (p.endsWith(`/${WABA}`)) return reply({ id: WABA, name: 'Shop', owner_business_info: { id: BUSINESS, name: 'Asha Textiles' } })
  if (p.endsWith('/product_catalogs')) return meta.catalogRefused ? reply({ error: { code: 200, message: 'Permissions error' } }, 400) : reply({ data: [{ id: '700600500400300', name: 'Asha catalog', product_count: 12 }] })
  if (p.endsWith('/payment_configurations')) return reply({ data: [{ payment_configurations: [{ configuration_name: 'razorpay-prod', provider_name: 'razorpay', status: 'Active' }, { configuration_name: 'upi-test', provider_name: 'upi_vpa', status: 'Active' }] }] })
  if (p.endsWith('/flows')) return reply({ data: [{ id: '800700600500400', name: 'Delivery address', status: 'PUBLISHED' }] })
  if (p.endsWith('/whatsapp_commerce_settings')) return reply({ data: [{ is_cart_enabled: true, is_catalog_visible: false }] })
  throw new Error('Unexpected Meta call: ' + p)
}
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.invalid'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'
console.error = () => {}
console.warn = () => {}

const catalog = require(path.join(PROJECT, 'lib/commerce/meta-catalog.ts'))
const route = require(path.join(PROJECT, 'app/api/commerce/meta-detect/route.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))
const detect = async () => (await route.GET(new NextRequest(`https://wamacrm.example.com/api/commerce/meta-detect?organizationId=${ORG}`))).json()

function reset(overrides = {}) {
  meta.expired = false; meta.catalogRefused = false; calls.length = 0
  org = { id: ORG, whatsapp_provider: 'facebook', whatsapp_api_token: 'WHATSAPP_TOKEN', whatsapp_business_account_id: WABA, whatsapp_phone_number_id: PHONE, whatsapp_graph_api_version: 'v25.0', ...overrides }
}

test('Store settings from Meta: payment setups are one flat list, in either answer shape', () => {
  assert.deepEqual(catalog.flattenPaymentConfigurations({ data: [{ payment_configurations: [{ configuration_name: 'a' }, { configuration_name: 'b' }] }] }).map((c) => c.configuration_name), ['a', 'b'])
  assert.deepEqual(catalog.flattenPaymentConfigurations({ data: [{ configuration_name: 'old-shape' }] }).map((c) => c.configuration_name), ['old-shape'])
  assert.deepEqual(catalog.flattenPaymentConfigurations({ data: [{ payment_configurations: [] }] }), [])
  assert.deepEqual(catalog.flattenPaymentConfigurations(null), [])
})

test('Store settings from Meta: the business portfolio comes from the WhatsApp account, not from typing', async () => {
  reset()
  assert.equal(await catalog.getWabaOwnerId(org), BUSINESS)
  meta.expired = true
  assert.equal(await catalog.getWabaOwnerId(org), null)
  assert.equal(await catalog.getWabaOwnerId({ ...org, whatsapp_business_account_id: '' }), null)
})

test('Store settings from Meta: everything is read, with the business that owns the account', async () => {
  reset()
  const data = await detect()
  assert.equal(data.success, true)
  assert.equal(data.businessId, BUSINESS)
  assert.equal(data.businessName, 'Asha Textiles')
  assert.equal(data.catalogs[0].name, 'Asha catalog')
  assert.deepEqual(data.paymentConfigs.map((c) => c.configuration_name), ['razorpay-prod', 'upi-test'])
  assert.equal(data.flows[0].status, 'PUBLISHED')
  assert.deepEqual(data.commerceSettings, { is_cart_enabled: true, is_catalog_visible: false })
  assert.equal(data.catalogsError, null)
})

test('Store settings from Meta: an expired connection is said plainly, not shown as empty lists', async () => {
  reset()
  meta.expired = true
  const data = await detect()
  assert.equal(data.success, false)
  assert.match(data.connectionError, /expired or was removed/)
  assert.equal(data.catalogs, undefined)
})

test('Store settings from Meta: one refusal is explained and does not hide the rest', async () => {
  reset()
  meta.catalogRefused = true
  const data = await detect()
  assert.equal(data.success, true)
  assert.deepEqual(data.catalogs, [])
  assert.match(data.catalogsError, /Connect catalog with Meta/)
  assert.equal(data.paymentConfigs.length, 2)
  assert.equal(data.flows.length, 1)
})

test('Store settings from Meta: catalogs are listed with the catalog connection when the store has one', async () => {
  reset({ meta_catalog_token: 'CATALOG_TOKEN' })
  await detect()
  assert.equal(calls.find((call) => call.path.endsWith('/product_catalogs')).auth, 'Bearer CATALOG_TOKEN')
  assert.equal(calls.find((call) => call.path.endsWith('/payment_configurations')).auth, 'Bearer WHATSAPP_TOKEN')
})
