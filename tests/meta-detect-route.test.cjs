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
const FORM = '800700600500400'
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

let org = {}
let updates = []
const fakeDb = {
  from: () => ({
    select: () => ({ eq: () => ({ single: async () => ({ data: org, error: null }) }) }),
    update: (values) => ({ eq: async () => { updates.push(values); Object.assign(org, values); return { error: null } } }),
  }),
}
stub(require.resolve('@supabase/supabase-js', { paths: [PROJECT] }), { createClient: () => fakeDb })
stub(path.join(PROJECT, 'lib/api-auth-helper.ts'), { verifyOrgAccess: async () => ({ authorized: true }), getSupabaseAdminClient: () => fakeDb })

// Fake Meta, answering per path; `meta.expired` makes every call fail like an expired token. `meta.flows`
// holds the account's forms with the flow JSON each was given; `meta.publishFails` refuses publishing.
const meta = { expired: false, catalogRefused: false, publishFails: false, flows: [], nextId: 900000000000001 }
const calls = []
global.fetch = async (input, init = {}) => {
  const url = new URL(String(input))
  const method = String(init.method || 'GET').toUpperCase()
  const auth = String((init.headers || {}).Authorization || '')
  calls.push({ method, path: url.pathname.replace(/^\/v\d+\.\d+/, ''), auth })
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status })
  if (url.hostname === 'cdn.example.com') {
    // The form file Meta's asset list points at
    const flow = meta.flows.find((item) => item.id === url.searchParams.get('flow'))
    return flow?.json ? reply(flow.json) : reply({ error: 'gone' }, 404)
  }
  if (meta.expired) return reply({ error: { code: 190, message: 'Error validating access token: Session has expired' } }, 400)
  const p = url.pathname
  if (p.endsWith(`/${WABA}`)) return reply({ id: WABA, name: 'Shop', owner_business_info: { id: BUSINESS, name: 'Asha Textiles' } })
  if (p.endsWith('/product_catalogs')) return meta.catalogRefused ? reply({ error: { code: 200, message: 'Permissions error' } }, 400) : reply({ data: [{ id: '700600500400300', name: 'Asha catalog', product_count: 12 }] })
  if (p.endsWith('/payment_configurations')) return reply({ data: [{ payment_configurations: [{ configuration_name: 'razorpay-prod', provider_name: 'razorpay', status: 'Active' }, { configuration_name: 'upi-test', provider_name: 'upi_vpa', status: 'Active' }] }] })
  if (p.endsWith(`/${WABA}/flows`)) {
    if (method === 'POST') {
      const name = init.body.get('name')
      if (meta.flows.some((flow) => flow.name === name)) return reply({ error: { code: 100, message: `A flow with the name "${name}" already exists` } }, 400)
      const flow = { id: String(meta.nextId++), name, status: 'DRAFT', json: null }
      meta.flows.push(flow)
      return reply({ id: flow.id })
    }
    // Paged as Meta pages it: 25 a page unless a limit is asked for, newest first, with an `after` cursor
    const limit = Number(url.searchParams.get('limit')) || 25
    const start = Number(url.searchParams.get('after') || 0)
    const listed = [...meta.flows].reverse().slice(start, start + limit).map(({ id, name, status }) => ({ id, name, status }))
    const more = start + limit < meta.flows.length
    return reply({ data: listed, ...(more ? { paging: { cursors: { after: String(start + limit) }, next: 'https://graph.facebook.com/next' } } : {}) })
  }
  if (p.endsWith('/whatsapp_commerce_settings')) return reply({ data: [{ is_cart_enabled: true, is_catalog_visible: false }] })
  // One form: its record, its assets, its file upload and its publishing
  const flowMatch = p.match(/\/(\d{15})(?:\/(assets|publish))?$/)
  const flow = flowMatch && meta.flows.find((item) => item.id === flowMatch[1])
  if (flowMatch && !flow) return reply({ error: { code: 100, message: 'Unsupported get request. Object with ID does not exist' } }, 400)
  if (flow && !flowMatch[2]) {
    if (method === 'POST') { flow.name = init.body.get('name') || flow.name; return reply({ success: true }) }
    return reply({ id: flow.id, name: flow.name, status: flow.status })
  }
  if (flow && flowMatch[2] === 'assets') {
    if (method === 'POST') {
      flow.json = JSON.parse(await init.body.get('file').text())
      return reply({ success: true, validation_errors: [] })
    }
    return reply({ data: [{ name: 'flow.json', asset_type: 'FLOW_JSON', download_url: `https://cdn.example.com/flow.json?flow=${flow.id}` }] })
  }
  if (flow && flowMatch[2] === 'publish') {
    if (meta.publishFails) return reply({ error: { code: 100, message: 'Flow cannot be published' } }, 400)
    flow.status = 'PUBLISHED'
    return reply({ success: true })
  }
  throw new Error('Unexpected Meta call: ' + method + ' ' + p)
}
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.invalid'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'
console.error = () => {}
console.warn = () => {}
console.log = () => {}

const catalog = require(path.join(PROJECT, 'lib/commerce/meta-catalog.ts'))
const { STANDARD_ADDRESS_FORM_NAME, getExpressOptionTitle } = require(path.join(PROJECT, 'lib/commerce/go-live-checks.ts'))
const { compileMetaFlowJSON, NATIVE_FLOW_TEMPLATES } = require(path.join(PROJECT, 'lib/flows/meta-flows-spec.ts'))
const route = require(path.join(PROJECT, 'app/api/commerce/meta-detect/route.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))
const detect = async () => (await route.GET(new NextRequest(`https://wamacrm.example.com/api/commerce/meta-detect?organizationId=${ORG}`))).json()
const post = async (action) => {
  const res = await route.POST(new NextRequest('https://wamacrm.example.com/api/commerce/meta-detect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: ORG, action }) }))
  return { status: res.status, body: await res.json() }
}

/** The standard address form as the route compiles it, with the given express choice. */
const formJson = (expressTitle) => {
  const screens = structuredClone(NATIVE_FLOW_TEMPLATES.SHIPPING_ADDRESS.screens)
  const speed = screens[0].layout.children.find((field) => field.name === 'delivery_speed')
  speed.options = [{ id: 'standard', title: 'Standard delivery' }, { id: 'express', title: expressTitle }]
  return compileMetaFlowJSON(screens)
}
const standardForm = (overrides = {}) => ({ id: FORM, name: STANDARD_ADDRESS_FORM_NAME, status: 'PUBLISHED', json: formJson('Express delivery (+₹50)'), ...overrides })

function reset(overrides = {}) {
  meta.expired = false; meta.catalogRefused = false; meta.publishFails = false; calls.length = 0; updates = []
  // The account has one published form of the store's own
  meta.flows = [{ id: FORM, name: 'Delivery address', status: 'PUBLISHED', json: formJson('Express delivery (+₹50)') }]
  org = { id: ORG, whatsapp_provider: 'facebook', whatsapp_api_token: 'WHATSAPP_TOKEN', whatsapp_business_account_id: WABA, whatsapp_phone_number_id: PHONE, whatsapp_graph_api_version: 'v25.0', currency: 'INR', ...overrides }
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
  assert.equal(data.addressForm, null)
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

test('Store settings from Meta: the account’s catalog is read with the WhatsApp connection, which has the account', async () => {
  reset({ meta_catalog_token: 'CATALOG_TOKEN' })
  await detect()
  assert.equal(calls.find((call) => call.path.endsWith('/product_catalogs')).auth, 'Bearer WHATSAPP_TOKEN')
  assert.equal(calls.find((call) => call.path.endsWith('/payment_configurations')).auth, 'Bearer WHATSAPP_TOKEN')
})

test('Address form: what the form in use says for express delivery is read back from Meta', async () => {
  reset({ commerce_address_flow_id: FORM })
  const data = await detect()
  assert.deepEqual(data.addressForm, { id: FORM, expressLabel: 'Express delivery (+₹50)', collectsAddress: true, error: null })
  // A form that is gone from the account is reported, and the rest is still read
  reset({ commerce_address_flow_id: '800700600500499' })
  const gone = await detect()
  assert.equal(gone.success, true)
  assert.equal(gone.addressForm.expressLabel, null)
  assert.equal(gone.addressForm.collectsAddress, null)
  assert.match(gone.addressForm.error, /does not exist/)
  assert.equal(gone.flows.length, 1)
})

test('Address form: every page of the account’s forms is read, so an older saved form is still found', async () => {
  // The saved form was published first; 140 forms of the Flow Builder came after it
  reset({ commerce_address_flow_id: FORM })
  for (let index = 0; index < 140; index++) meta.flows.push({ id: String(900000000100000 + index), name: `Flow ${index}`, status: 'PUBLISHED', json: null })
  const data = await detect()
  assert.equal(data.flowsError, null)
  assert.equal(data.flows.length, 141)
  assert.deepEqual(data.flows.find((flow) => flow.id === FORM), { id: FORM, name: 'Delivery address', status: 'PUBLISHED' })
  assert.equal(calls.filter((call) => call.method === 'GET' && call.path.endsWith(`/${WABA}/flows`)).length, 2)
})

test('Address form: whether a form collects an address is read from Meta, for choosing one', async () => {
  reset()
  const credentials = { token: 'WHATSAPP_TOKEN', version: 'v25.0', businessAccountId: WABA, phoneNumberId: PHONE }
  assert.equal((await route.readAddressForm(credentials, FORM)).collectsAddress, true)
  // A lead form published on the account has no address field
  const LEAD = '800700600500401'
  const leadJson = compileMetaFlowJSON([{ id: 'LEAD', title: 'Lead', layout: { type: 'SingleColumnLayout', children: [{ type: 'TextInput', name: 'full_name', label: 'Name', required: true }] } }])
  meta.flows.push({ id: LEAD, name: 'Lead form', status: 'PUBLISHED', json: leadJson })
  assert.deepEqual(await route.readAddressForm(credentials, LEAD), { id: LEAD, expressLabel: null, collectsAddress: false, error: null })
  // When Meta cannot be read, nothing is claimed either way
  meta.expired = true
  const unreachable = await route.readAddressForm(credentials, FORM)
  assert.equal(unreachable.collectsAddress, null)
  assert.match(unreachable.error, /expired/)
})

test('Address form: the standard form is created with the express charge and published', async () => {
  reset({ commerce_express_fee: 80 })
  meta.flows = []
  const { status, body } = await post('deploy_address_flow')
  assert.equal(status, 200)
  assert.equal(body.success, true)
  const created = meta.flows[0]
  assert.equal(created.name, STANDARD_ADDRESS_FORM_NAME)
  assert.equal(created.status, 'PUBLISHED')
  assert.equal(getExpressOptionTitle(created.json), 'Express delivery (+₹80)')
  assert.equal(body.flowId, created.id)
  assert.equal(org.commerce_address_flow_id, created.id)
  // Without a form in use, the draft is saved at once so a failed publish can be retried
  assert.equal(updates[0].commerce_address_flow_id, created.id)
  // The fixed default, until the fee becomes a setting
  reset()
  meta.flows = []
  await post('deploy_address_flow')
  assert.equal(getExpressOptionTitle(meta.flows[0].json), 'Express delivery (+₹50)')
})

test('Address form: a published form that shows the current charge is left alone', async () => {
  reset({ commerce_express_fee: 50, commerce_address_flow_id: FORM })
  meta.flows = [standardForm()]
  const { body } = await post('deploy_address_flow')
  assert.equal(body.unchanged, true)
  assert.equal(body.flowId, FORM)
  assert.equal(meta.flows.length, 1)
  assert.deepEqual(updates, [])
  // Asking for a new version with nothing to change is the same
  assert.equal((await post('republish_address_flow')).body.unchanged, true)
  assert.equal(meta.flows.length, 1)
})

test('Address form: when the charge changed, a new version replaces the published form', async () => {
  reset({ commerce_express_fee: 80, commerce_address_flow_id: FORM })
  meta.flows = [standardForm()]
  const { status, body } = await post('republish_address_flow')
  assert.equal(status, 200)
  assert.equal(body.replaced, FORM)
  const version = meta.flows.find((flow) => flow.id === body.flowId)
  assert.equal(version.name, `${STANDARD_ADDRESS_FORM_NAME} v2`)
  assert.equal(version.status, 'PUBLISHED')
  assert.equal(getExpressOptionTitle(version.json), 'Express delivery (+₹80)')
  assert.equal(org.commerce_address_flow_id, version.id)
  // The old form stays published on Meta; the store was pointed at the new one only once it was published
  assert.equal(meta.flows.find((flow) => flow.id === FORM).status, 'PUBLISHED')
  assert.equal(updates.length, 1)
  assert.ok(calls.findIndex((call) => call.path.endsWith(`/${version.id}/publish`)) < calls.length - 1 || updates.length === 1)
  // "Create the standard form" does the same once the form in use is stale
  org.commerce_express_fee = 100
  const again = await post('deploy_address_flow')
  assert.equal(meta.flows.find((flow) => flow.id === again.body.flowId).name, `${STANDARD_ADDRESS_FORM_NAME} v3`)
  assert.equal(org.commerce_address_flow_id, again.body.flowId)
})

test('Address form: a failed publish keeps the store on its published form, and the draft is finished next time', async () => {
  reset({ commerce_express_fee: 80, commerce_address_flow_id: FORM })
  meta.flows = [standardForm()]
  meta.publishFails = true
  const failed = await post('republish_address_flow')
  assert.equal(failed.status, 500)
  assert.match(failed.body.error, /cannot be published/)
  assert.equal(org.commerce_address_flow_id, FORM)
  assert.deepEqual(updates, [])
  const draft = meta.flows.find((flow) => flow.status === 'DRAFT')
  assert.equal(draft.name, `${STANDARD_ADDRESS_FORM_NAME} v2`)
  // The next attempt finishes that draft instead of creating "v3"
  meta.publishFails = false
  const retried = await post('republish_address_flow')
  assert.equal(retried.status, 200)
  assert.equal(retried.body.flowId, draft.id)
  assert.equal(meta.flows.length, 2)
  assert.equal(draft.status, 'PUBLISHED')
  assert.equal(org.commerce_address_flow_id, draft.id)
})

test('Address form: a store using its own form gets the standard one when it asks for it', async () => {
  reset({ commerce_express_fee: 80, commerce_address_flow_id: FORM })
  const { body } = await post('deploy_address_flow')
  const created = meta.flows.find((flow) => flow.id === body.flowId)
  assert.equal(created.name, STANDARD_ADDRESS_FORM_NAME)
  assert.equal(created.status, 'PUBLISHED')
  assert.equal(org.commerce_address_flow_id, created.id)
  assert.ok(!calls.some((call) => call.path.endsWith(`/${FORM}/assets`)), 'a custom form is not read for its express charge')
  // The store's own form is still on the account
  assert.equal(meta.flows.find((flow) => flow.id === FORM).status, 'PUBLISHED')
})
