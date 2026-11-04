// Store setup settings: what /api/organization accepts for shipping amounts, the currency, the
// payment gateway, the Meta app secret and the order-update template; a column whose migration has
// not been applied; the address form checked against Meta before it is chosen; and the payment
// requests withdrawn when the store is switched off. Nothing here reaches the network or a real database.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const ORG = '77777777-7777-4777-8777-777777777777'
const OTHER_ORG = '66666666-6666-4666-8666-666666666666'
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

// A fake organizations row and commerce_orders table; `missingColumns` answers like PostgREST
// when a column does not exist, `ordersError` when the orders cannot be read at all. Like a real
// database, a read hands back a copy of the row as it is at that moment, not the row itself.
let row = {}
let orders = []
let ordersError = null
let missingColumns = []
let updates = []
function query(table) {
  const ops = []
  const run = () => {
    const update = ops.find(([op]) => op === 'update')
    if (table === 'organizations') {
      if (!update) return { data: { ...row }, error: null }
      const missing = Object.keys(update[1]).find((column) => missingColumns.includes(column))
      if (missing) return { data: null, error: { code: 'PGRST204', message: `Could not find the '${missing}' column of 'organizations' in the schema cache` } }
      updates.push(update[1])
      Object.assign(row, update[1])
      return { data: { ...row }, error: null }
    }
    if (table === 'commerce_orders') {
      if (ordersError) return { data: null, error: ordersError }
      let rows = orders
      for (const [op, ...args] of ops) {
        if (op === 'eq') rows = rows.filter((order) => order[args[0]] === args[1])
        else if (op === 'in') rows = rows.filter((order) => args[1].includes(order[args[0]]))
        else if (op === 'not' && args[1] === 'is' && args[2] === null) rows = rows.filter((order) => order[args[0]] != null)
        else if (op === 'limit') rows = rows.slice(0, args[0])
      }
      return { data: rows, error: null }
    }
    throw new Error(`Unexpected table ${table}`)
  }
  const builder = {
    then: (resolve, reject) => Promise.resolve().then(run).then(resolve, reject),
    maybeSingle: async () => run(),
  }
  for (const op of ['select', 'update', 'eq', 'in', 'not', 'order', 'limit']) builder[op] = (...args) => { ops.push([op, ...args]); return builder }
  return builder
}
const fakeDb = { from: query }
const actor = { id: 'u-admin', role: 'org_admin', organization_id: ORG }
stub(path.join(PROJECT, 'lib/api-auth-helper.ts'), { getSupabaseAdminClient: () => fakeDb, verifyOrgAccess: async () => ({ authorized: true, user: actor }) })

// Fake "withdraw the payment card" and "read the form from Meta"
let voided = []
let voidResult = async () => true
stub(path.join(PROJECT, 'lib/commerce/commerce-webhook-handler.ts'), {
  voidPaymentRequest: async (args) => { voided.push(args); return voidResult(args) },
})
let formReports = {}
let formReads = []
stub(path.join(PROJECT, 'app/api/commerce/meta-detect/route.ts'), {
  readAddressForm: async (credentials, flowId) => {
    formReads.push({ credentials, flowId })
    return formReports[flowId] || { id: flowId, expressLabel: null, collectsAddress: null, error: 'Meta did not answer in time.' }
  },
})
console.error = () => {}
console.warn = () => {}
console.log = () => {}

const {
  planOrganizationUpdate, isMissingColumnError, isSecretColumn, toSafeOrganization, checkStatusTemplate,
  ORGANIZATION_FIELD_PERMISSIONS, MAX_STORE_AMOUNT, STATUS_TEMPLATE_ERROR,
} = require(path.join(PROJECT, 'lib/organization-access.ts'))
const { SUPPORTED_PAYMENT_GATEWAYS } = require(path.join(PROJECT, 'lib/commerce/commerce-utils.ts'))
const { ADDRESS_FORM_ERROR } = require(path.join(PROJECT, 'lib/commerce/go-live-checks.ts'))
const route = require(path.join(PROJECT, 'app/api/organization/route.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))
const patch = async (updates) => {
  const res = await route.PATCH(new NextRequest('https://wamacrm.example.com/api/organization', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: ORG, updates }) }))
  return { status: res.status, body: await res.json() }
}

const admin = { id: 'u-admin', role: 'org_admin' }
const manager = { id: 'u-manager', role: 'org_manager' }
const employee = { id: 'u-employee', role: 'sales_employee' }
/** A row connected to WhatsApp Cloud API, so a form can be read from Meta. */
const connected = { whatsapp_provider: 'facebook', whatsapp_api_token: 'T', whatsapp_business_account_id: '200000000000001', whatsapp_phone_number_id: 'P', whatsapp_graph_api_version: 'v25.0' }

function reset() {
  row = { id: ORG, name: 'Asha Textiles', whatsapp_api_token: 'T', whatsapp_phone_number_id: 'P' }
  orders = []; ordersError = null; missingColumns = []; updates = []
  voided = []; voidResult = async () => true
  formReports = {}; formReads = []
}

test('Store settings: shipping amounts are checked on the server and stored as numbers', () => {
  const plan = planOrganizationUpdate(manager, { commerce_default_shipping_fee: '49.50', commerce_free_shipping_threshold: 999, commerce_express_fee: ' 80 ' })
  assert.deepEqual(plan, { ok: true, values: { commerce_default_shipping_fee: 49.5, commerce_free_shipping_threshold: 999, commerce_express_fee: 80 } })
  assert.deepEqual(planOrganizationUpdate(manager, { commerce_express_fee: 0 }), { ok: true, values: { commerce_express_fee: 0 } })
  assert.equal(planOrganizationUpdate(manager, { commerce_express_fee: MAX_STORE_AMOUNT }).ok, true)
  for (const bad of [-1, '', '  ', 'abc', null, true, NaN, Infinity, '1e400', MAX_STORE_AMOUNT + 1, [], {}]) {
    const refused = planOrganizationUpdate(manager, { commerce_default_shipping_fee: bad })
    assert.equal(refused.ok, false, JSON.stringify(bad))
    assert.equal(refused.status, 400)
    assert.equal(refused.error, 'The shipping fee must be a number between 0 and 1,000,000.')
  }
  assert.match(planOrganizationUpdate(manager, { commerce_express_fee: -5 }).error, /express delivery charge/)
  assert.match(planOrganizationUpdate(manager, { commerce_free_shipping_threshold: 'x' }).error, /free shipping threshold/)
  // Fractions of a paisa are not stored
  assert.equal(planOrganizationUpdate(manager, { commerce_express_fee: '12.3456' }).values.commerce_express_fee, 12.35)
  // One bad value refuses the whole save, so nothing is applied partially
  assert.equal(planOrganizationUpdate(manager, { commerce_enable_cod: true, commerce_express_fee: -1 }).ok, false)
})

test('Store settings: the currency is a 3-letter code, stored in capitals', () => {
  assert.deepEqual(planOrganizationUpdate(admin, { currency: 'inr ' }), { ok: true, values: { currency: 'INR' } })
  for (const bad of ['', 'rupees', 'IN', '₹', null, 12]) {
    const refused = planOrganizationUpdate(admin, { currency: bad })
    assert.equal(refused.status, 400, JSON.stringify(bad))
    assert.match(refused.error, /3-letter code/)
  }
})

test('Store settings: the payment gateway is one the store page offers', () => {
  for (const gateway of SUPPORTED_PAYMENT_GATEWAYS) {
    assert.deepEqual(planOrganizationUpdate(manager, { commerce_payment_gateway: gateway }), { ok: true, values: { commerce_payment_gateway: gateway } })
  }
  assert.equal(planOrganizationUpdate(manager, { commerce_payment_gateway: 'PayU' }).values.commerce_payment_gateway, 'payu')
  for (const bad of ['stripe', 'cashfree', '', null, 1]) {
    const refused = planOrganizationUpdate(manager, { commerce_payment_gateway: bad })
    assert.equal(refused.status, 400, JSON.stringify(bad))
    assert.match(refused.error, /razorpay, payu, billdesk, zaakpay/)
  }
})

test('Store settings: the Meta app secret is an admin setting that never leaves the server', () => {
  assert.equal(ORGANIZATION_FIELD_PERMISSIONS.whatsapp_app_secret, 'settings.manage')
  assert.equal(isSecretColumn('whatsapp_app_secret'), true)
  assert.deepEqual(planOrganizationUpdate(admin, { whatsapp_app_secret: 'abc' }), { ok: true, values: { whatsapp_app_secret: 'abc' } })
  assert.deepEqual(planOrganizationUpdate(admin, { whatsapp_app_secret: null }), { ok: true, values: { whatsapp_app_secret: null } })
  assert.equal(planOrganizationUpdate(manager, { whatsapp_app_secret: 'abc' }).status, 403)
  assert.equal('whatsapp_app_secret' in toSafeOrganization({ whatsapp_app_secret: 'abc', name: 'x' }), false)
})

test('Store settings: checkout reminders and the order-update template are store settings', () => {
  assert.equal(ORGANIZATION_FIELD_PERMISSIONS.commerce_reminders_enabled, 'automation.manage')
  assert.equal(ORGANIZATION_FIELD_PERMISSIONS.commerce_status_template, 'automation.manage')
  assert.deepEqual(planOrganizationUpdate(manager, { commerce_reminders_enabled: false }), { ok: true, values: { commerce_reminders_enabled: false } })
  assert.deepEqual(planOrganizationUpdate(admin, { commerce_reminders_enabled: true }), { ok: true, values: { commerce_reminders_enabled: true } })
  assert.equal(planOrganizationUpdate(employee, { commerce_reminders_enabled: false }).status, 403)
  assert.equal(planOrganizationUpdate(employee, { commerce_status_template: null }).status, 403)
})

test('Store settings: the order-update template is a template name and a language, or nothing', () => {
  const chosen = { name: 'order_update', language: 'en_US' }
  assert.deepEqual(planOrganizationUpdate(manager, { commerce_status_template: chosen }), { ok: true, values: { commerce_status_template: chosen } })
  assert.deepEqual(planOrganizationUpdate(manager, { commerce_status_template: null }), { ok: true, values: { commerce_status_template: null } })
  // Typed by hand: spaces and casing are put the way Meta wants them
  assert.deepEqual(checkStatusTemplate({ name: ' order_update ', language: 'EN_us' }), { ok: true, value: { name: 'order_update', language: 'en_US' } })
  assert.deepEqual(checkStatusTemplate({ name: 'order_update', language: 'fil' }), { ok: true, value: { name: 'order_update', language: 'fil' } })
  assert.deepEqual(checkStatusTemplate({ name: 'order_update', language: 'pt_BR', extra: 1 }), { ok: true, value: { name: 'order_update', language: 'pt_BR' } })
  assert.deepEqual(checkStatusTemplate(''), { ok: true, value: null })
  assert.equal(checkStatusTemplate({ name: 'x'.repeat(512), language: 'en' }).ok, true)
  for (const bad of [
    { name: '', language: 'en' }, { name: 'order_update', language: '' }, { language: 'en' }, { name: 'order_update' },
    { name: 'Order Update', language: 'en' }, { name: 'order-update', language: 'en' }, { name: 'x'.repeat(513), language: 'en' },
    { name: 'order_update', language: 'english' }, { name: 'order_update', language: 'en-US' }, { name: 'order_update', language: 'e' },
    'order_update', 12, true, [], ['order_update', 'en'],
  ]) {
    const refused = planOrganizationUpdate(manager, { commerce_status_template: bad })
    assert.equal(refused.ok, false, JSON.stringify(bad))
    assert.equal(refused.status, 400)
    assert.equal(refused.error, STATUS_TEMPLATE_ERROR)
  }
})

test('Store settings: a column whose migration is not applied yet is a 400 with the reason, not a 500', async () => {
  reset()
  missingColumns = ['whatsapp_app_secret']
  const refused = await patch({ whatsapp_app_secret: 'abc' })
  assert.equal(refused.status, 400)
  assert.equal(refused.body.error, 'The database migration for this setting has not been applied yet.')
  assert.deepEqual(updates, [])
  // Postgres's own wording, when the schema cache is not involved
  assert.equal(isMissingColumnError({ code: '42703', message: 'column organizations.whatsapp_app_secret does not exist' }), true)
  assert.equal(isMissingColumnError({ message: "Could not find the 'commerce_express_fee' column of 'organizations' in the schema cache" }), true)
  assert.equal(isMissingColumnError({ code: '23505', message: 'duplicate key value' }), false)
  assert.equal(isMissingColumnError(null), false)
  // Once the migration is applied, the same request saves
  missingColumns = []
  const saved = await patch({ whatsapp_app_secret: 'abc' })
  assert.equal(saved.status, 200)
  assert.deepEqual(updates, [{ whatsapp_app_secret: 'abc' }])
  assert.equal('whatsapp_app_secret' in saved.body.organization, false, 'the secret is not echoed back')
  // The same for the new store columns
  missingColumns = ['commerce_status_template', 'commerce_reminders_enabled']
  assert.equal((await patch({ commerce_status_template: { name: 'order_update', language: 'en' } })).status, 400)
  assert.equal((await patch({ commerce_reminders_enabled: false })).status, 400)
  missingColumns = []
  assert.equal((await patch({ commerce_status_template: { name: 'order_update', language: 'en' }, commerce_reminders_enabled: false })).status, 200)
  assert.deepEqual(row.commerce_status_template, { name: 'order_update', language: 'en' })
  assert.equal(row.commerce_reminders_enabled, false)
})

test('Store settings: the API refuses a bad amount before touching the database', async () => {
  reset()
  const refused = await patch({ commerce_default_shipping_fee: '-10' })
  assert.equal(refused.status, 400)
  assert.match(refused.body.error, /shipping fee/)
  assert.deepEqual(updates, [])
  const saved = await patch({ commerce_default_shipping_fee: '10', currency: 'inr' })
  assert.equal(saved.status, 200)
  assert.deepEqual(updates, [{ commerce_default_shipping_fee: 10, currency: 'INR' }])
  assert.equal(saved.body.paymentRequestsWithdrawn, 0)
})

test('Store settings: switching the store off withdraws the payment requests still open in chats', async () => {
  reset()
  row.enable_commerce = true
  orders = [
    { id: 'o1', organization_id: ORG, order_number: 'ORD-1', status: 'payment_pending', payment_status: 'pending', meta_payment_reference: 'ORD-1', created_at: '2026-11-01' },
    { id: 'o2', organization_id: ORG, order_number: 'ORD-2', status: 'cart_submitted', payment_status: 'pending', meta_payment_reference: 'ORD-2', created_at: '2026-11-02' },
    // Not live: paid, no request sent, canceled, or another store's
    { id: 'o3', organization_id: ORG, order_number: 'ORD-3', status: 'paid', payment_status: 'paid', meta_payment_reference: 'ORD-3' },
    { id: 'o4', organization_id: ORG, order_number: 'ORD-4', status: 'awaiting_address', payment_status: 'pending', meta_payment_reference: null },
    { id: 'o5', organization_id: ORG, order_number: 'ORD-5', status: 'canceled', payment_status: 'pending', meta_payment_reference: 'ORD-5' },
    { id: 'o6', organization_id: OTHER_ORG, order_number: 'ORD-6', status: 'payment_pending', payment_status: 'pending', meta_payment_reference: 'ORD-6' },
  ]
  voidResult = async ({ order }) => order.order_number !== 'ORD-2' // WhatsApp refuses one
  const saved = await patch({ enable_commerce: false, commerce_enable_cod: true })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.paymentRequestsWithdrawn, 1)
  assert.deepEqual(voided.map((call) => call.order.order_number).sort(), ['ORD-1', 'ORD-2'])
  // Withdrawn with the store as saved and this request's database, so the customer's number can be read
  assert.equal(voided[0].organization.id, ORG)
  assert.equal(voided[0].organization.enable_commerce, false)
  assert.equal(voided[0].database, fakeDb)
  assert.match(voided[0].description, /ORD-1/)
  assert.equal(row.enable_commerce, false)

  // Saving the store while it is off does not message the customers again
  voided = []
  const again = await patch({ enable_commerce: false, commerce_enable_cod: false })
  assert.equal(again.status, 200)
  assert.equal(again.body.paymentRequestsWithdrawn, 0)
  assert.deepEqual(voided, [])
  // Switching it on withdraws nothing either
  assert.equal((await patch({ enable_commerce: true })).body.paymentRequestsWithdrawn, 0)
  assert.deepEqual(voided, [])
})

test('Store settings: many open cards are withdrawn a few at a time, so the save answers in time', async () => {
  reset()
  row.enable_commerce = true
  orders = Array.from({ length: 12 }, (_, index) => ({ id: `o${index}`, organization_id: ORG, order_number: `ORD-${index}`, status: 'payment_pending', payment_status: 'pending', meta_payment_reference: `ORD-${index}` }))
  let inFlight = 0
  let peak = 0
  voidResult = async () => {
    inFlight++
    peak = Math.max(peak, inFlight)
    await new Promise((resolve) => setTimeout(resolve, 2))
    inFlight--
    return true
  }
  const saved = await patch({ enable_commerce: false })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.paymentRequestsWithdrawn, 12)
  assert.equal(voided.length, 12)
  assert.ok(peak > 1 && peak <= 5, `withdrawn ${peak} at a time`)
})

test('Store settings: a card WhatsApp will not withdraw, or orders that cannot be read, never fail the save', async () => {
  reset()
  row.enable_commerce = true
  orders = [{ id: 'o1', organization_id: ORG, order_number: 'ORD-1', status: 'payment_pending', payment_status: 'pending', meta_payment_reference: 'ORD-1' }]
  voidResult = async () => { throw new Error('WhatsApp could not be reached') }
  const saved = await patch({ enable_commerce: false })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.paymentRequestsWithdrawn, 0)
  assert.equal(row.enable_commerce, false)
  // The orders could not be read at all
  reset()
  row.enable_commerce = true
  ordersError = { code: '42P01', message: 'relation "commerce_orders" does not exist' }
  const alsoSaved = await patch({ enable_commerce: false })
  assert.equal(alsoSaved.status, 200)
  assert.equal(alsoSaved.body.paymentRequestsWithdrawn, 0)
  assert.equal(row.enable_commerce, false)
})

test('Store settings: a form chosen for the address step has to collect an address', async () => {
  reset()
  Object.assign(row, connected)
  formReports = {
    F_ADDR: { id: 'F_ADDR', expressLabel: 'Express delivery (+₹50)', collectsAddress: true, error: null },
    F_LEAD: { id: 'F_LEAD', expressLabel: null, collectsAddress: false, error: null },
  }
  const refused = await patch({ commerce_address_flow_id: 'F_LEAD', commerce_enable_cod: true })
  assert.equal(refused.status, 400)
  assert.equal(refused.body.error, 'This form does not collect a delivery address (it needs an address_line_1 field)')
  assert.equal(refused.body.error, ADDRESS_FORM_ERROR)
  assert.deepEqual(updates, [], 'nothing of the save is applied')
  assert.equal(formReads.length, 1)
  assert.equal(formReads[0].flowId, 'F_LEAD')
  assert.equal(formReads[0].credentials.token, 'T')
  const saved = await patch({ commerce_address_flow_id: 'F_ADDR', commerce_enable_cod: true })
  assert.equal(saved.status, 200)
  assert.equal(row.commerce_address_flow_id, 'F_ADDR')
  // The form in use is not read again; clearing the step reads nothing
  formReads = []
  assert.equal((await patch({ commerce_address_flow_id: 'F_ADDR' })).status, 200)
  assert.equal((await patch({ commerce_address_flow_id: null })).status, 200)
  assert.equal(row.commerce_address_flow_id, null)
  assert.deepEqual(formReads, [])
})

test('Store settings: a form Meta cannot read right now is accepted, and the Order flow tab warns later', async () => {
  reset()
  Object.assign(row, connected)
  const saved = await patch({ commerce_address_flow_id: 'F_UNREACHABLE' })
  assert.equal(saved.status, 200)
  assert.equal(row.commerce_address_flow_id, 'F_UNREACHABLE')
  assert.equal(formReads.length, 1)
  // Without a WhatsApp Cloud API connection there is nothing to read with
  reset()
  formReports = { F_LEAD: { id: 'F_LEAD', expressLabel: null, collectsAddress: false, error: null } }
  const unchecked = await patch({ commerce_address_flow_id: 'F_LEAD' })
  assert.equal(unchecked.status, 200)
  assert.equal(row.commerce_address_flow_id, 'F_LEAD')
  assert.deepEqual(formReads, [])
})
