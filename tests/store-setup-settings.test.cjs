// Store setup settings: what /api/organization accepts for shipping amounts, the currency and the
// payment gateway, the Meta app secret setting, and a column whose migration has not been applied.
// Nothing here reaches the network or a real database.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const ORG = '77777777-7777-4777-8777-777777777777'
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

// A fake organizations table; `missingColumns` answers like PostgREST when a column does not exist
let row = {}
let missingColumns = []
let updates = []
const fakeDb = {
  from: () => ({
    update: (values) => ({
      eq: () => ({
        select: () => ({
          maybeSingle: async () => {
            const missing = Object.keys(values).find((column) => missingColumns.includes(column))
            if (missing) return { data: null, error: { code: 'PGRST204', message: `Could not find the '${missing}' column of 'organizations' in the schema cache` } }
            updates.push(values)
            Object.assign(row, values)
            return { data: row, error: null }
          },
        }),
      }),
    }),
  }),
}
const actor = { id: 'u-admin', role: 'org_admin', organization_id: ORG }
stub(path.join(PROJECT, 'lib/api-auth-helper.ts'), { getSupabaseAdminClient: () => fakeDb, verifyOrgAccess: async () => ({ authorized: true, user: actor }) })
console.error = () => {}

const { planOrganizationUpdate, isMissingColumnError, isSecretColumn, toSafeOrganization, ORGANIZATION_FIELD_PERMISSIONS, MAX_STORE_AMOUNT } = require(path.join(PROJECT, 'lib/organization-access.ts'))
const { SUPPORTED_PAYMENT_GATEWAYS } = require(path.join(PROJECT, 'lib/commerce/commerce-utils.ts'))
const route = require(path.join(PROJECT, 'app/api/organization/route.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))
const patch = async (updates) => {
  const res = await route.PATCH(new NextRequest('https://wamacrm.example.com/api/organization', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: ORG, updates }) }))
  return { status: res.status, body: await res.json() }
}

const admin = { id: 'u-admin', role: 'org_admin' }
const manager = { id: 'u-manager', role: 'org_manager' }

function reset() { row = { id: ORG, name: 'Asha Textiles', whatsapp_api_token: 'T', whatsapp_phone_number_id: 'P' }; missingColumns = []; updates = [] }

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
})
