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

/** A column, or a JSON path such as `metadata->catalog->>state`, read from a row. */
const read = (row, column) => (column.includes('->') ? column.split(/->>?/).reduce((value, key) => (value == null ? null : value[key]), row) : row[column])

function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') depth--
    else if (text[i] === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1 }
  }
  parts.push(text.slice(start))
  return parts
}

/** A PostgREST filter string as a row predicate. A plain list is an `or`, as `.or(...)` sends it. */
function parseFilter(text) {
  const group = text.match(/^(and|or)\((.*)\)$/s)
  if (group) {
    const parts = splitTopLevel(group[2]).map(parseFilter)
    return group[1] === 'and' ? (row) => parts.every((part) => part(row)) : (row) => parts.some((part) => part(row))
  }
  if (splitTopLevel(text).length > 1) return parseFilter(`or(${text})`)
  const [column, op, ...rest] = text.split('.')
  const value = rest.join('.')
  switch (op) {
    case 'eq': return (row) => String(read(row, column)) === value
    // As in SQL, a missing value is neither equal nor unequal to anything
    case 'neq': return (row) => read(row, column) != null && String(read(row, column)) !== value
    case 'is': return (row) => (value === 'null' ? read(row, column) == null : String(read(row, column)) === value)
    default: throw new Error(`Unsupported filter: ${text}`)
  }
}

/**
 * A stand-in for the Supabase client over in-memory tables: the part of the query builder these routes use.
 * `missingColumns` plays a database a migration has not reached: selecting one of them fails as PostgREST does.
 */
function fakeDb(tables, { missingColumns = {} } = {}) {
  const data = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]))
  let inserted = 0
  return {
    tables: data,
    from(table) {
      const rows = data[table] || (data[table] = [])
      const filters = []
      let operation = { type: 'select' }
      let window = null
      let one = null
      let columns = '*'
      const matching = () => rows.filter((row) => filters.every((filter) => filter(row)))
      const run = () => {
        const missing = operation.type === 'select' && (missingColumns[table] || []).find((column) => columns.split(',').map((name) => name.trim()).includes(column))
        if (missing) return { data: null, error: { code: '42703', message: `column ${table}.${missing} does not exist` } }
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
        // Rows come back as copies with the columns asked for, as they do from PostgREST
        const names = operation.type === 'select' && columns !== '*' ? columns.split(',').map((name) => name.trim()) : null
        const copy = (row) => JSON.parse(JSON.stringify(names ? Object.fromEntries(names.filter((name) => name in row).map((name) => [name, row[name]])) : row))
        if (one === 'single') return { data: result[0] ? copy(result[0]) : null, error: result[0] ? null : { code: 'PGRST116', message: 'no rows' } }
        if (one === 'maybeSingle') return { data: result[0] ? copy(result[0]) : null, error: null }
        return { data: result.map(copy), error: null, count: result.length }
      }
      const query = {
        select: (selected) => { if (operation.type === 'select' && selected) columns = selected; return query },
        update: (values) => { operation = { type: 'update', values }; return query },
        insert: (values) => { operation = { type: 'insert', rows: [].concat(values) }; return query },
        upsert: (values) => { operation = { type: 'upsert', rows: [].concat(values) }; return query },
        delete: () => { operation = { type: 'delete' }; return query },
        eq: (column, value) => { filters.push((row) => read(row, column) === value); return query },
        is: (column, value) => { filters.push((row) => (value === null ? read(row, column) == null : read(row, column) === value)); return query },
        neq: (column, value) => { filters.push((row) => read(row, column) !== value); return query },
        gt: (column, value) => { filters.push((row) => String(read(row, column)) > String(value)); return query },
        in: (column, values) => { filters.push((row) => values.includes(read(row, column))); return query },
        or: (text) => { filters.push(parseFilter(text)); return query },
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

// Fake Meta: items_batch takes everything in, unless deletions are refused like an expired connection,
// and every batch asked about has finished without complaint
const meta = { refuseDelete: false, onBatch: null, calls: [] }
global.fetch = async (input, init = {}) => {
  const url = new URL(String(input))
  const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : {}
  const requests = body.requests ? JSON.parse(body.requests) : []
  meta.calls.push({ path: url.pathname, requests, auth: String((init.headers || {}).Authorization || '') })
  const reply = (payload, status = 200) => new Response(JSON.stringify(payload), { status })
  if (url.pathname.endsWith('/check_batch_request_status')) return reply({ data: [{ handle: url.searchParams.get('handle'), status: 'finished', errors: [], ids_of_invalid_requests: [] }] })
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
const post = (body) => route.POST(new NextRequest(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: ORG, ...body }) }))
const save = (product) => post({ product })

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

function reset(products = [shirt()], organization = org(), options = {}) {
  db = fakeDb({ organizations: [organization], commerce_products: products }, options)
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

test('Products: "send all" goes on from where the last request stopped, and says how many are still waiting', async () => {
  const id = (index) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`
  // 3,003 products outside the catalog: one whose last send was turned down, then 3,002 never sent
  reset([
    shirt({ id: id(1), retailer_id: 'THERE', metadata: inCatalog }),
    shirt({ id: id(2), retailer_id: 'SENDING', metadata: { catalog: { state: 'pending', handle: 'H0', catalog_id: CATALOG } } }),
    shirt({ id: id(3), retailer_id: 'TURNED-DOWN', metadata: { catalog: { state: 'error', errors: ['Bad image'], catalog_id: CATALOG } } }),
    ...Array.from({ length: 3002 }, (_, index) => shirt({ id: id(10 + index), retailer_id: `NEW-${index}`, metadata: {} })),
  ])
  const push = (after) => post({ action: 'push_meta', ...(after ? { after } : {}) })
  const sizes = () => meta.calls.map((call) => call.requests.length)

  const first = await (await push()).json()
  assert.deepEqual([first.pushed, first.sent, first.rejected, first.remaining], [3000, 3000, 0, 3])
  assert.equal(first.cursor, id(10 + 2998))                                 // the last product this request looked at
  assert.deepEqual(sizes(), [1000, 1000, 1000])

  const second = await (await push(first.cursor)).json()
  assert.deepEqual([second.pushed, second.sent, second.remaining, second.cursor], [3, 3, 0, id(10 + 3001)])
  assert.deepEqual(sizes(), [1000, 1000, 1000, 3])
  assert.deepEqual(meta.calls[3].requests.map((request) => request.data.id), ['NEW-2999', 'NEW-3000', 'NEW-3001'])

  // Nothing after the last one: the caller stops here
  const third = await (await push(second.cursor)).json()
  assert.deepEqual([third.pushed, third.sent, third.remaining, third.cursor], [0, 0, 0, null])
  assert.equal(meta.calls.length, 4)

  const byState = (state) => db.tables.commerce_products.filter((row) => row.metadata.catalog?.state === state).map((row) => row.retailer_id)
  assert.equal(byState('pending').length, 3004)                             // the 3,003 just sent, and the one already on its way
  assert.deepEqual([byState('synced'), byState('error')], [['THERE'], []])
  assert.equal(db.tables.commerce_products.find((row) => row.retailer_id === 'SENDING').metadata.catalog.handle, 'H0')   // not sent again
})

test('Products: a refresh settles the batches Meta has finished', async () => {
  const sending = { catalog: { state: 'pending', handle: 'H1', synced_at: new Date().toISOString(), catalog_id: CATALOG } }
  reset([shirt({ metadata: sending }), shirt({ id: '11111111-1111-4111-8111-222222222222', retailer_id: 'SHIRT-002', metadata: sending })])
  const res = await post({ action: 'refresh_catalog' })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { success: true, accepted: 2, rejected: 0, pending: 0 })
  assert.deepEqual(meta.calls.map((call) => call.path), [`/v25.0/${CATALOG}/check_batch_request_status`])
  assert.deepEqual(db.tables.commerce_products.map((row) => row.metadata.catalog.state), ['synced', 'synced'])
})

test('Products: every catalog call uses the catalog connection the store made, not the WhatsApp token', async () => {
  const P2 = '11111111-1111-4111-8111-222222222222'
  const sending = { catalog: { state: 'pending', handle: 'H0', synced_at: new Date().toISOString(), catalog_id: CATALOG } }
  const connected = { ...org(), meta_catalog_token: 'CATALOG_TOKEN' }
  reset([shirt(), shirt({ id: P2, retailer_id: 'SHIRT-002', metadata: sending })], connected)
  assert.equal((await post({ action: 'refresh_catalog' })).status, 200)
  assert.equal((await post({ action: 'push_meta', productIds: [P1] })).status, 200)
  assert.equal((await save(form({ retailer_id: 'SHIRT-009' }))).status, 200)    // the old SKU leaves, the new one is sent
  assert.equal((await remove(P2)).status, 200)
  assert.deepEqual(meta.calls.map((call) => call.path.split('/').pop()), ['check_batch_request_status', 'items_batch', 'items_batch', 'items_batch', 'items_batch'])
  assert.deepEqual([...new Set(meta.calls.map((call) => call.auth))], ['Bearer CATALOG_TOKEN'])
})

test('Products: a database without the catalog connection column still reaches the catalog, with the WhatsApp token', async () => {
  reset([shirt()], org(), { missingColumns: { organizations: ['meta_catalog_token'] } })
  assert.equal((await post({ action: 'push_meta', productIds: [P1] })).status, 200)
  assert.equal((await remove(P1)).status, 200)
  assert.equal(db.tables.commerce_products.length, 0)
  assert.deepEqual(meta.calls.map((call) => [call.path.split('/').pop(), call.auth]), [['items_batch', 'Bearer TOKEN'], ['items_batch', 'Bearer TOKEN']])
})

test('Products: a status answer about an older send does not overwrite a newer save of the product', async () => {
  // A refresh read the product while it waited under H0; the owner saved it again before the answer came
  const read = new Date(Date.now() - 60000).toISOString()
  reset([shirt({ metadata: { attributes: { brand: 'Old brand' }, catalog: { state: 'pending', handle: 'H0', synced_at: read, catalog_id: CATALOG } } })])
  const original = global.fetch
  global.fetch = async (input, init) => {
    if (String(input).includes('/check_batch_request_status') && !meta.saved) {
      meta.saved = true
      assert.equal((await save(form({ brand: 'New brand' }))).status, 200)
    }
    return original(input, init)
  }
  try {
    assert.deepEqual(await (await post({ action: 'refresh_catalog' })).json(), { success: true, accepted: 1, rejected: 0, pending: 0 })
  } finally {
    global.fetch = original
    delete meta.saved
  }
  const [row] = db.tables.commerce_products
  // The newer save and its own send are what the product records; the next refresh asks Meta about that one
  assert.equal(row.metadata.attributes.brand, 'New brand')
  assert.deepEqual([row.metadata.catalog.state, row.metadata.catalog.handle], ['pending', 'H1'])
})

test('Products: the route declares the two minutes a full catalog sync may take', () => {
  assert.equal(route.maxDuration, 120)
})
