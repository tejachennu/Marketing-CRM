// The products route against a fake Meta API and a fake database: removing a product that the
// catalog keeps, changing a SKU, and saving while the catalog is being copied back. Nothing here
// reaches the network or a real database.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const ORG = '77777777-7777-4777-8777-777777777777'
const CATALOG = '700600500400300'
const P1 = '11111111-1111-4111-8111-111111111111'
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

/** A stand-in for the Supabase client over in-memory tables: the part of the query builder these routes use. */
function fakeDb(tables) {
  const data = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]))
  const read = (row, column) => column.split(/->>?/).reduce((value, key) => (value == null ? null : value[key]), row)
  let inserted = 0
  return {
    tables: data,
    from(table) {
      const rows = data[table] || (data[table] = [])
      const filters = []
      let operation = { type: 'select' }
      let window = null
      let one = null
      const matching = () => rows.filter((row) => filters.every((filter) => filter(row)))
      const run = () => {
        let result
        if (operation.type === 'update') {
          result = matching()
          for (const row of result) Object.assign(row, operation.values)
        } else if (operation.type === 'delete') {
          result = matching()
          for (const row of result) rows.splice(rows.indexOf(row), 1)
        } else if (operation.type === 'insert') {
          result = operation.rows.map((row) => ({ id: `22222222-2222-4222-8222-${String(++inserted).padStart(12, '0')}`, ...row }))
          rows.push(...result)
        } else if (operation.type === 'upsert') {
          result = []
          for (const incoming of operation.rows) {
            const current = rows.find((row) => row.organization_id === incoming.organization_id && row.retailer_id === incoming.retailer_id)
            if (current) Object.assign(current, incoming)
            else rows.push({ id: `new-${incoming.retailer_id}`, ...incoming })
          }
        } else {
          result = matching().sort((a, b) => String(a.id).localeCompare(String(b.id)))
          if (window) result = result.slice(window[0], window[1] + 1)
        }
        // Rows come back as copies, as they do from PostgREST
        const copy = (row) => JSON.parse(JSON.stringify(row))
        if (one === 'single') return { data: result[0] ? copy(result[0]) : null, error: result[0] ? null : { code: 'PGRST116', message: 'no rows' } }
        if (one === 'maybeSingle') return { data: result[0] ? copy(result[0]) : null, error: null }
        return { data: result.map(copy), error: null, count: result.length }
      }
      const query = {
        select: () => query,
        update: (values) => { operation = { type: 'update', values }; return query },
        insert: (values) => { operation = { type: 'insert', rows: [].concat(values) }; return query },
        upsert: (values) => { operation = { type: 'upsert', rows: [].concat(values) }; return query },
        delete: () => { operation = { type: 'delete' }; return query },
        eq: (column, value) => { filters.push((row) => read(row, column) === value); return query },
        neq: (column, value) => { filters.push((row) => read(row, column) !== value); return query },
        in: (column, values) => { filters.push((row) => values.includes(read(row, column))); return query },
        order: () => query,
        limit: (count) => { window = [0, count - 1]; return query },
        range: (from, to) => { window = [from, to]; return query },
        single: () => { one = 'single'; return query },
        maybeSingle: () => { one = 'maybeSingle'; return query },
        then: (resolve, reject) => new Promise((settle) => settle(run())).then(resolve, reject),
      }
      return query
    },
  }
}

let db = fakeDb({})
stub(require.resolve('@supabase/supabase-js', { paths: [PROJECT] }), { createClient: () => db })
stub(path.join(PROJECT, 'lib/api-auth-helper.ts'), {
  getSupabaseAdminClient: () => db,
  verifyOrgAccess: async () => ({ authorized: true, user: { id: 'u1', role: 'org_admin', organization_id: ORG } }),
})

// Fake Meta: items_batch takes everything in, unless deletions are refused like an expired connection
const meta = { refuseDelete: false, onBatch: null, calls: [] }
global.fetch = async (input, init = {}) => {
  const url = new URL(String(input))
  const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : {}
  const requests = body.requests ? JSON.parse(body.requests) : []
  meta.calls.push({ path: url.pathname, requests })
  const reply = (payload, status = 200) => new Response(JSON.stringify(payload), { status })
  if (!url.pathname.endsWith('/items_batch')) throw new Error('Unexpected Meta call: ' + url.pathname)
  if (meta.refuseDelete && requests.some((request) => request.method === 'DELETE')) {
    return reply({ error: { code: 190, message: 'Error validating access token: Session has expired' } }, 400)
  }
  if (meta.onBatch) await meta.onBatch(requests)
  return reply({ handles: ['H1'], validation_status: [] })
}
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.invalid'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'
console.error = () => {}

const sync = require(path.join(PROJECT, 'lib/commerce/catalog-sync.ts'))
const route = require(path.join(PROJECT, 'app/api/commerce/products/route.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))
const BASE = 'https://wamacrm.example.com/api/commerce/products'
const remove = (id, query = '') => route.DELETE(new NextRequest(`${BASE}?organizationId=${ORG}&id=${id}${query}`, { method: 'DELETE' }))
const save = (product) => route.POST(new NextRequest(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: ORG, product }) }))

const org = () => ({
  id: ORG, name: 'Asha Textiles', currency: 'INR', meta_catalog_id: CATALOG, whatsapp_api_token: 'TOKEN', whatsapp_graph_api_version: 'v25.0',
  whatsapp_default_phone: '+91 98765 43210', whatsapp_business_account_id: '200000000000001', whatsapp_phone_number_id: '300000000000001',
})
const inCatalog = { source: 'meta', catalog: { state: 'synced', review_status: 'approved', catalog_id: CATALOG } }
const shirt = (overrides = {}) => ({
  id: P1, organization_id: ORG, retailer_id: 'SHIRT-001', title: 'White linen shirt', description: 'Breathable summer shirt', price: 1499, currency: 'INR',
  image_url: 'https://cdn.example.com/shirt.jpg', website_url: 'https://shop.example.com/shirt', category: 'Shirts', is_available: true, inventory_count: 12,
  metadata: inCatalog, ...overrides,
})
/** The shirt as the dashboard form submits it. */
const form = (overrides = {}) => ({ id: P1, title: 'White linen shirt', retailer_id: 'SHIRT-001', price: 1499, currency: 'INR', image_url: 'https://cdn.example.com/shirt.jpg', website_url: 'https://shop.example.com/shirt', inventory_count: 12, is_available: true, ...overrides })

function reset(products = [shirt()], organization = org()) {
  db = fakeDb({ organizations: [organization], commerce_products: products })
  meta.refuseDelete = false
  meta.onBatch = null
  meta.calls.length = 0
}

test('Products: a product Meta keeps in the catalog is kept here too, so it is never orderable unseen', async () => {
  reset()
  meta.refuseDelete = true
  const res = await remove(P1)
  assert.equal(res.status, 409)
  const data = await res.json()
  assert.match(data.error, /“White linen shirt” was not removed: it is still in your WhatsApp catalog/)
  assert.match(data.error, /Reconnect WhatsApp/)
  assert.deepEqual([data.inCatalog, data.catalogRemoved], [true, false])
  assert.equal(db.tables.commerce_products.length, 1)
})

test('Products: force removes it here regardless, saying that the catalog still has it', async () => {
  reset()
  meta.refuseDelete = true
  const res = await remove(P1, '&force=true')
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.deepEqual([data.success, data.inCatalog, data.catalogRemoved], [true, true, false])
  assert.match(data.catalogError, /Reconnect WhatsApp/)
  assert.equal(db.tables.commerce_products.length, 0)
})

test('Products: removing a product takes it out of the catalog first; one outside it needs no Meta call', async () => {
  reset()
  const res = await remove(P1)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { success: true, inCatalog: true, catalogRemoved: true })
  assert.deepEqual(meta.calls.map((call) => call.requests), [[{ method: 'DELETE', data: { id: 'SHIRT-001' } }]])
  assert.equal(db.tables.commerce_products.length, 0)

  reset([shirt({ metadata: {} })])
  meta.refuseDelete = true
  assert.equal((await remove(P1)).status, 200)
  assert.equal(meta.calls.length, 0)
  assert.equal(db.tables.commerce_products.length, 0)

  // A store that no longer uses a catalog: nothing to remove it from
  reset([shirt()], { ...org(), meta_catalog_id: null })
  assert.equal((await remove(P1)).status, 200)
  assert.equal(meta.calls.length, 0)
})

test('Products: a new SKU whose old item Meta keeps is reported, not left orderable in silence', async () => {
  reset()
  meta.refuseDelete = true
  const res = await save(form({ retailer_id: 'SHIRT-002' }))
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.catalog.state, 'error')
  assert.match(data.catalog.errors[0], /old SKU “SHIRT-001” is still in your WhatsApp catalog/)
  assert.match(data.catalog.errors[0], /Reconnect WhatsApp/)
  // The product is still sent under its new SKU, so it can be ordered that way
  assert.deepEqual(meta.calls.map((call) => call.requests.map((request) => [request.method, request.data.id])), [[['DELETE', 'SHIRT-001']], [['UPDATE', 'SHIRT-002']]])
  assert.deepEqual([db.tables.commerce_products[0].retailer_id, db.tables.commerce_products[0].metadata.catalog.state], ['SHIRT-002', 'pending'])

  // When the old item does leave the catalog, nothing is wrong
  reset()
  const ok = await (await save(form({ retailer_id: 'SHIRT-003' }))).json()
  assert.deepEqual([ok.catalog.state, ok.catalog.errors], ['pending', []])
})

test('Products: an edit saved while the catalog is being copied back is kept', async () => {
  reset()
  // Meta still lists the old title while it processes the edit, and a pull runs in the middle of the save
  const older = async () => ({ ok: true, status: 200, json: async () => ({ data: [
    { retailer_id: 'SHIRT-001', name: 'White linen shirt', price: '₹1,499.00', currency: 'INR', availability: 'in stock', inventory: 12, image_url: 'https://cdn.example.com/shirt.jpg', review_status: 'approved' },
  ] }) })
  let pulled = null
  meta.onBatch = async () => { pulled = await sync.pullCatalogToDatabase(db, org(), older) }
  const res = await save(form({ title: 'Blue linen shirt' }))
  assert.equal(res.status, 200)
  assert.equal(pulled.skipped, 1)
  const [row] = db.tables.commerce_products
  assert.equal(row.title, 'Blue linen shirt')
  assert.deepEqual([row.metadata.catalog.state, row.metadata.catalog.handle, row.metadata.catalog.catalog_id], ['pending', 'H1', CATALOG])
  assert.equal((await res.json()).catalog.state, 'pending')

  // Without a linked catalog, a save marks nothing and asks Meta nothing
  reset([shirt({ metadata: {} })], { ...org(), meta_catalog_id: null })
  const plain = await (await save(form({ title: 'Blue linen shirt' }))).json()
  assert.deepEqual(plain.catalog, { linked: false, state: null, errors: [], warnings: [] })
  assert.equal(db.tables.commerce_products[0].metadata.catalog, undefined)
  assert.equal(meta.calls.length, 0)
})
