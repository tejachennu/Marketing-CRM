// "Connect catalog with Meta": the token rules and the route, against a fake Meta API and a fake
// database. Nothing here reaches the network or a real database.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const ORG = '55555555-5555-4555-8555-555555555555'
const CATALOG = '700600500400300'
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

let row = {}
let columnExists = true
let updates = []
const fakeDb = {
  from() {
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }),
      update: (values) => ({
        eq: async () => {
          if (!columnExists && 'meta_catalog_token' in values) return { error: { code: 'PGRST204', message: "Could not find the 'meta_catalog_token' column of 'organizations' in the schema cache" } }
          updates.push(values)
          Object.assign(row, values)
          return { error: null }
        },
      }),
    }
  },
}
stub(path.join(PROJECT, 'lib/api-auth-helper.ts'), { getSupabaseAdminClient: () => fakeDb, verifyOrgAccess: async () => ({ authorized: true }) })

// Fake Meta: the code exchange and what the token was granted
let granted = []
global.fetch = async (input) => {
  const url = new URL(String(input))
  if (url.pathname.endsWith('/oauth/access_token')) {
    return new Response(JSON.stringify(url.searchParams.get('code') === 'GOOD' ? { access_token: 'CATALOG_TOKEN' } : { error: { message: 'Invalid verification code' } }), { status: url.searchParams.get('code') === 'GOOD' ? 200 : 400 })
  }
  if (url.pathname.endsWith('/debug_token')) {
    return new Response(JSON.stringify({ data: { is_valid: true, scopes: granted.map((g) => g.scope), granular_scopes: granted } }))
  }
  throw new Error('Unexpected Meta call: ' + url.pathname)
}
process.env.NEXT_PUBLIC_META_APP_ID = '111'
process.env.META_APP_SECRET = 'test-secret'
console.error = () => {}

const { getCatalogCredentials, exchangeLoginCode } = require(path.join(PROJECT, 'lib/commerce/meta-catalog.ts'))
const route = require(path.join(PROJECT, 'app/api/commerce/catalog/access/route.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))
const post = (body) => route.POST(new NextRequest('https://wamacrm.example.com/api/commerce/catalog/access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: ORG, ...body }) }))

function reset() { row = { meta_catalog_id: null }; columnExists = true; updates = []; granted = [] }

test('Catalog access: catalog calls use the catalog connection when there is one', () => {
  const org = { whatsapp_api_token: 'WHATSAPP_TOKEN', whatsapp_business_account_id: '200000000000001' }
  assert.equal(getCatalogCredentials(org).token, 'WHATSAPP_TOKEN')
  assert.equal(getCatalogCredentials({ ...org, meta_catalog_token: 'CATALOG_TOKEN' }).token, 'CATALOG_TOKEN')
  assert.equal(getCatalogCredentials({ ...org, meta_catalog_token: 'CATALOG_TOKEN' }).businessAccountId, '200000000000001')
})

test('Catalog access: the login code is exchanged with the app secret', async () => {
  assert.equal(await exchangeLoginCode('GOOD', { id: '111', secret: 'test-secret' }), 'CATALOG_TOKEN')
  await assert.rejects(() => exchangeLoginCode('EXPIRED', { id: '111', secret: 'test-secret' }), /Invalid verification code/)
  await assert.rejects(() => exchangeLoginCode('GOOD', { id: '111', secret: '' }), /META_APP_SECRET/)
})

test('Catalog access: saved only when Meta granted catalog_management, linking the one catalog shared', async () => {
  reset()
  granted = [{ scope: 'business_management' }]
  let res = await post({ code: 'GOOD' })
  assert.equal(res.status, 422)
  assert.equal(updates.length, 0, 'nothing saved without catalog access')

  granted = [{ scope: 'business_management' }, { scope: 'catalog_management', target_ids: [CATALOG] }]
  res = await post({ code: 'GOOD' })
  assert.equal(res.status, 200)
  assert.equal(row.meta_catalog_token, 'CATALOG_TOKEN')
  assert.equal(row.meta_catalog_id, CATALOG)
  assert.deepEqual((await res.json()).catalogIds, [CATALOG])
})

test('Catalog access: a store that already has a catalog keeps it, and two shared catalogs pick none', async () => {
  reset()
  row.meta_catalog_id = '900800700600500'
  granted = [{ scope: 'catalog_management', target_ids: [CATALOG] }]
  await post({ code: 'GOOD' })
  assert.equal(row.meta_catalog_id, '900800700600500')

  reset()
  granted = [{ scope: 'catalog_management', target_ids: [CATALOG, '800700600500400'] }]
  await post({ code: 'GOOD' })
  assert.equal(row.meta_catalog_id, null)
  assert.equal(row.meta_catalog_token, 'CATALOG_TOKEN')
})

test('Catalog access: a bad code or a missing column is explained, and access can be removed', async () => {
  reset()
  assert.equal((await post({ code: 'EXPIRED' })).status, 400)

  columnExists = false
  granted = [{ scope: 'catalog_management', target_ids: [CATALOG] }]
  const res = await post({ code: 'GOOD' })
  assert.equal(res.status, 409)
  assert.match((await res.json()).error, /20261017_meta_catalog_token\.sql/)

  reset()
  row.meta_catalog_token = 'CATALOG_TOKEN'
  const removed = await route.DELETE(new NextRequest(`https://wamacrm.example.com/api/commerce/catalog/access?organizationId=${ORG}`, { method: 'DELETE' }))
  assert.equal(removed.status, 200)
  assert.equal(row.meta_catalog_token, null)
})
