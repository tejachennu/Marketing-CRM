// The catalog route's permissions, against a fake Meta API and a fake database with the real role
// rules. Nothing here reaches the network or a real database.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const ORG = '88888888-8888-4888-8888-888888888888'
const CATALOG = '700600500400300'
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

const rbac = require(path.join(PROJECT, 'lib/rbac.ts'))
let user = {}
let org = {}
const fakeDb = {
  from: () => ({
    select: () => ({ eq: () => ({ single: async () => ({ data: org, error: null }), order: () => ({ range: async () => ({ data: [], error: null }) }) }) }),
    update: (values) => ({ eq: async () => { Object.assign(org, values); return { error: null } } }),
  }),
}
// The real role rules decide, as verifyOrgAccess does
stub(path.join(PROJECT, 'lib/api-auth-helper.ts'), {
  getSupabaseAdminClient: () => fakeDb,
  verifyOrgAccess: async (request, organizationId, options = {}) => {
    if (options.permission && !rbac.can(user, options.permission)) return { authorized: false, status: 403, error: rbac.describeDenied(options.permission), user }
    return { authorized: true, user }
  },
})

// Fake Meta: every call succeeds and is recorded
const calls = []
global.fetch = async (input, init = {}) => {
  const url = new URL(String(input))
  calls.push({ path: url.pathname, method: init.method || 'GET' })
  return new Response(JSON.stringify({ success: true }), { status: 200 })
}
console.error = () => {}

const route = require(path.join(PROJECT, 'app/api/commerce/catalog/route.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))
const post = (body) => route.POST(new NextRequest('https://wamacrm.example.com/api/commerce/catalog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: ORG, ...body }) }))

function reset(role) {
  user = { id: 'u1', role, organization_id: ORG }
  org = { id: ORG, name: 'Asha Textiles', meta_catalog_id: CATALOG, whatsapp_api_token: 'TOKEN', whatsapp_graph_api_version: 'v25.0', whatsapp_business_account_id: '200000000000001', whatsapp_phone_number_id: '300000000000001' }
  calls.length = 0
}

test('Catalog: deleting the catalog in Meta takes an organization admin', async () => {
  reset('org_manager')
  const res = await post({ action: 'delete', confirm: CATALOG })
  assert.equal(res.status, 403)
  assert.match((await res.json()).error, /Only organization admins/)
  assert.equal(calls.length, 0, 'Meta was not asked')
  assert.equal(org.meta_catalog_id, CATALOG)

  reset('org_admin')
  const ok = await post({ action: 'delete', confirm: CATALOG })
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { success: true, deleted: CATALOG, productsReset: 0 })
  assert.deepEqual(calls, [{ path: `/v25.0/${CATALOG}`, method: 'DELETE' }])
  assert.equal(org.meta_catalog_id, null)

  // The account that created the organization is an admin under its legacy role name, and still has to confirm
  reset('owner')
  assert.equal((await post({ action: 'delete', confirm: 'wrong' })).status, 400)
  assert.equal(calls.length, 0)
  assert.equal((await post({ action: 'delete', confirm: CATALOG })).status, 200)
})

test('Catalog: a manager still looks after the catalog, short of deleting it', async () => {
  reset('org_manager')
  const res = await post({ action: 'rename', name: 'Summer catalog' })
  assert.equal(res.status, 200)
  assert.deepEqual(calls, [{ path: `/v25.0/${CATALOG}`, method: 'POST' }])
  assert.equal((await post({ action: 'unlink' })).status, 200)
  assert.equal(org.meta_catalog_id, null)

  reset('sales_employee')
  assert.equal((await post({ action: 'rename', name: 'Summer catalog' })).status, 403)
  assert.equal((await post({ action: 'delete', confirm: CATALOG })).status, 403)
  assert.equal(calls.length, 0)
})
