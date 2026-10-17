require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const items = require('../lib/commerce/catalog-items.ts')
const meta = require('../lib/commerce/meta-catalog.ts')
const sync = require('../lib/commerce/catalog-sync.ts')
const onboarding = require('../lib/whatsapp-onboarding.ts')

const CATALOG = '102938475610293'
const WABA = '555000111222333'
const PHONE = '106850078877666'
const BUSINESS = '777000111222333'
const ORG = { id: 'org-1', name: 'Asha Textiles', meta_catalog_id: CATALOG, whatsapp_api_token: 'TOKEN', whatsapp_graph_api_version: 'v25.0', whatsapp_business_account_id: WABA, whatsapp_phone_number_id: PHONE, whatsapp_default_phone: '+91 98765 43210' }
const CREDENTIALS = { token: 'TOKEN', version: 'v25.0', businessAccountId: WABA, phoneNumberId: PHONE }
const DEFAULTS = { brand: 'Asha Textiles', link: 'https://wa.me/919876543210' }

const product = (overrides = {}) => ({
  id: 'p1', retailer_id: 'SHIRT-001', title: 'White linen shirt', description: 'Breathable summer shirt', price: 1499, currency: 'INR',
  image_url: 'https://cdn.example.com/shirt.jpg', website_url: 'https://shop.example.com/shirt', category: 'Shirts', is_available: true, inventory_count: 12, metadata: {},
  ...overrides,
})

/** A stand-in for fetch that answers Graph API calls from a list of handlers and records each call. */
function graph(...handlers) {
  const calls = []
  const fetcher = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || 'GET', body: init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : undefined, auth: init.headers?.Authorization }
    calls.push(call)
    const handler = handlers[Math.min(calls.length - 1, handlers.length - 1)]
    const payload = typeof handler === 'function' ? handler(call) : handler
    return { ok: !payload?.error, status: payload?.error ? 400 : 200, json: async () => payload }
  }
  fetcher.calls = calls
  return fetcher
}

/** A stand-in for the Supabase client over in-memory product rows. */
function fakeDb(rows) {
  const table = rows.map((row) => ({ ...row }))
  const read = (row, column) => {
    if (column === 'metadata->catalog->>state') return row.metadata?.catalog?.state ?? null
    return row[column]
  }
  return {
    rows: table,
    from() {
      let filters = []
      let operation = { type: 'select' }
      let window = null
      const matching = () => table.filter((row) => filters.every((filter) => filter(row)))
      const run = () => {
        if (operation.type === 'update') {
          for (const row of matching()) Object.assign(row, operation.values)
          return { data: null, error: null }
        }
        if (operation.type === 'delete') {
          for (const row of matching()) table.splice(table.indexOf(row), 1)
          return { data: null, error: null }
        }
        if (operation.type === 'upsert') {
          for (const incoming of operation.rows) {
            const current = table.find((row) => row.organization_id === incoming.organization_id && row.retailer_id === incoming.retailer_id)
            if (current) Object.assign(current, incoming)
            else table.push({ id: `new-${incoming.retailer_id}`, ...incoming })
          }
          return { data: null, error: null }
        }
        let found = matching().sort((a, b) => String(a.id).localeCompare(String(b.id)))
        if (window) found = found.slice(window[0], window[1] + 1)
        return { data: found, error: null }
      }
      const query = {
        select: () => query,
        update: (values) => { operation = { type: 'update', values }; return query },
        delete: () => { operation = { type: 'delete' }; return query },
        upsert: (incoming) => { operation = { type: 'upsert', rows: incoming }; return query },
        eq: (column, value) => { filters.push((row) => read(row, column) === value); return query },
        in: (column, values) => { filters.push((row) => values.includes(row[column])); return query },
        order: () => query,
        limit: (count) => { window = [0, count - 1]; return query },
        range: (from, to) => { window = [from, to]; return query },
        then: (resolve) => resolve(run()),
      }
      return query
    },
  }
}

// ── Products as catalog items ───────────────────────────────────────────────

test('Catalog items: a product becomes a PRODUCT_ITEM with every field Meta requires', () => {
  assert.deepEqual(items.toCatalogItem(product(), DEFAULTS), {
    id: 'SHIRT-001',
    title: 'White linen shirt',
    description: 'Breathable summer shirt',
    availability: 'in stock',
    condition: 'new',
    price: '1499.00 INR',
    link: 'https://shop.example.com/shirt',
    brand: 'Asha Textiles',
    wa_compliance_category: 'DEFAULT',
    image: [{ url: 'https://cdn.example.com/shirt.jpg' }],
    image_link: 'https://cdn.example.com/shirt.jpg',
    quantity_to_sell_on_facebook: 12,
    product_type: 'Shirts',
  })
})

test('Catalog items: empty optional details fall back to what the store has', () => {
  const item = items.toCatalogItem(product({ description: '', website_url: null, category: 'General', inventory_count: null, currency: 'usd', price: '9.5' }), DEFAULTS)
  assert.equal(item.description, 'White linen shirt')          // Meta requires a description
  assert.equal(item.link, 'https://wa.me/919876543210')         // and a link: the chat with the business
  assert.equal(item.price, '9.50 USD')
  assert.equal(item.availability, 'in stock')                   // stock that is not tracked is sellable
  assert.equal('quantity_to_sell_on_facebook' in item, false)
  assert.equal('product_type' in item, false)

  assert.deepEqual(items.getCatalogItemDefaults(ORG), DEFAULTS)
  assert.deepEqual(items.getCatalogItemDefaults({ name: '' }), { brand: 'Store', link: '' })
})

test('Catalog items: availability follows the switch and the stock', () => {
  assert.equal(items.toCatalogItem(product({ is_available: false }), DEFAULTS).availability, 'out of stock')
  assert.equal(items.toCatalogItem(product({ inventory_count: 0 }), DEFAULTS).availability, 'out of stock')
})

test('Catalog items: a sale keeps the full price, and ending it clears the old sale price', () => {
  const onSale = items.toCatalogItem(product({ price: 999, metadata: { attributes: { list_price: 1499 } } }), DEFAULTS)
  assert.equal(onSale.price, '1499.00 INR')
  assert.equal(onSale.sale_price, '999.00 INR')

  const ended = items.toCatalogItem(product({ price: 1599 }), DEFAULTS, { endSale: true })
  assert.equal(ended.price, '1599.00 INR')
  assert.equal(ended.sale_price, '1599.00 INR')

  assert.equal('sale_price' in items.toCatalogItem(product(), DEFAULTS), false)
})

test('Catalog items: India’s origin details are sent for goods and waived for services', () => {
  const importer = { importer_name: 'Asha Imports LLP', importer_address: { street1: '12 MG Road', city: 'Bengaluru', country: 'IN' } }
  const goods = items.toCatalogItem(product({ metadata: { attributes: { origin_country: 'CN', brand: 'Linea', condition: 'used', ...importer } } }), DEFAULTS)
  assert.equal(goods.origin_country, 'CN')
  assert.equal(goods.importer_name, 'Asha Imports LLP')
  assert.deepEqual(goods.importer_address, importer.importer_address)
  assert.equal(goods.brand, 'Linea')
  assert.equal(goods.condition, 'used')
  assert.equal(goods.wa_compliance_category, 'DEFAULT')

  const service = items.toCatalogItem(product({ metadata: { attributes: { is_service: true, origin_country: 'CN', ...importer } } }), DEFAULTS)
  assert.equal(service.wa_compliance_category, 'COUNTRY_ORIGIN_EXEMPT')
  assert.equal('origin_country' in service, false)
  assert.equal('importer_name' in service, false)
})

test('Catalog items: what stops a product from being sent is named', () => {
  assert.deepEqual(items.getCatalogProblems(product(), DEFAULTS), [])
  assert.match(items.getCatalogProblems(product({ image_url: '' }), DEFAULTS)[0], /photo/)
  assert.deepEqual(items.getCatalogProblems(product({ website_url: '' }), DEFAULTS), [])                 // the chat link stands in
  assert.match(items.getCatalogProblems(product({ website_url: '' }), { brand: 'X', link: '' })[0], /website/)
})

test('Catalog items: catalog details from the dashboard are validated', () => {
  assert.deepEqual(items.parseProductAttributes({}), {})
  assert.deepEqual(items.parseProductAttributes({ brand: ' Linea ', condition: 'new', origin_country: 'in', is_service: false }), { brand: 'Linea', origin_country: 'IN' })
  assert.deepEqual(items.parseProductAttributes({ condition: 'Used', is_service: true }), { condition: 'used', is_service: true })
  assert.deepEqual(
    items.parseProductAttributes({ origin_country: 'CN', importer_name: 'Asha Imports', importer_street: '12 MG Road', importer_city: 'Bengaluru', importer_postal_code: '560001' }),
    { origin_country: 'CN', importer_name: 'Asha Imports', importer_address: { street1: '12 MG Road', city: 'Bengaluru', country: 'IN', postal_code: '560001' } }
  )
  // A service needs no importer, so one typed earlier is dropped
  assert.deepEqual(items.parseProductAttributes({ is_service: true, origin_country: 'CN', importer_name: 'Asha', importer_street: 'x', importer_city: 'y' }), { origin_country: 'CN', is_service: true })

  assert.throws(() => items.parseProductAttributes({ condition: 'mint' }), /new, refurbished or used/)
  assert.throws(() => items.parseProductAttributes({ origin_country: 'India' }), /2-letter/)
  assert.throws(() => items.parseProductAttributes({ brand: 'x'.repeat(101) }), /100 characters/)
  assert.throws(() => items.parseProductAttributes({ origin_country: 'CN', importer_name: 'Asha' }), /street address and city/)
})

test('Catalog items: where a product stands in the catalog', () => {
  const state = (metadata) => items.getCatalogState({ metadata })
  assert.equal(state({}), 'not_sent')
  assert.equal(state(null), 'not_sent')
  assert.equal(state({ source: 'meta' }), 'in_catalog')                                     // copied before the status was recorded
  assert.equal(state({ catalog: { state: 'pending', handle: 'h' } }), 'sending')
  assert.equal(state({ catalog: { state: 'error', errors: ['bad image'] } }), 'error')
  assert.equal(state({ catalog: { state: 'synced', review_status: 'approved' } }), 'in_catalog')
  assert.equal(state({ catalog: { state: 'synced', review_status: 'pending' } }), 'in_review')
  assert.equal(state({ catalog: { state: 'synced', review_status: 'rejected' } }), 'rejected')

  assert.equal(items.isInCatalog({ metadata: {} }), false)
  assert.equal(items.isInCatalog({ metadata: { catalog: { state: 'error' } } }), false)
  assert.equal(items.isInCatalog({ metadata: { catalog: { state: 'pending' } } }), true)
  assert.equal(items.isInCatalog({ metadata: { source: 'meta', catalog: { state: 'error' } } }), true)   // an update was turned down; the item is still there
  assert.equal(items.getCatalogStateLabel({ metadata: { source: 'meta', catalog: { state: 'error' } } }), 'Update not accepted')
  assert.equal(items.getCatalogStateLabel({ metadata: { catalog: { state: 'error' } } }), 'Not accepted')
})

test('Catalog items: a Meta item becomes a product row with its review and sale', () => {
  const row = items.toCatalogProductRow(
    { id: '1', retailer_id: 'SKU-9', name: 'Kurta', price: '₹1,299.00', sale_price: '₹999.00', currency: 'inr', availability: 'in stock', inventory: 7,
      image_url: 'https://x/y.jpg', url: 'https://wa.me/919876543210', brand: 'Asha', condition: 'refurbished', origin_country: 'cn', review_status: 'rejected',
      errors: [{ title: 'Image too small', description: 'Use an image of at least 500 x 500 pixels' }] },
    { importer_name: 'Asha Imports', importer_address: { street1: '12 MG Road', city: 'Bengaluru', country: 'IN' } },
    '2026-10-13T10:00:00.000Z'
  )
  assert.equal(row.price, 999)
  assert.equal(row.website_url, null)                         // the chat link is not a product page
  assert.deepEqual(row.metadata, {
    source: 'meta',
    attributes: { brand: 'Asha', condition: 'refurbished', origin_country: 'CN', importer_name: 'Asha Imports', importer_address: { street1: '12 MG Road', city: 'Bengaluru', country: 'IN' }, list_price: 1299 },
    catalog: { state: 'synced', synced_at: '2026-10-13T10:00:00.000Z', review_status: 'rejected', warnings: ['Use an image of at least 500 x 500 pixels'] },
  })

  const service = items.toCatalogProductRow({ retailer_id: 'S', price: '500 INR', wa_compliance_category: 'COUNTRY_ORIGIN_EXEMPT' })
  assert.deepEqual(service.metadata.attributes, { is_service: true })
  assert.equal(items.getCatalogState(service), 'in_catalog')
})

// ── Meta's catalog endpoints ────────────────────────────────────────────────

test('Catalog API: only numeric IDs reach a request path', async () => {
  assert.equal(meta.isGraphId(CATALOG), true)
  for (const bad of ['', 'me', '123', `${CATALOG}/products`, `${CATALOG}?x=1`, null, 42]) assert.equal(meta.isGraphId(bad), false)

  const fetcher = graph({ success: true })
  await assert.rejects(() => meta.sendItemsBatch(CREDENTIALS, 'me/accounts', [], fetcher), /numeric ID/)
  await assert.rejects(() => meta.connectCatalog(CREDENTIALS, '../x', fetcher), /numeric ID/)
  await assert.rejects(() => meta.createCatalog(CREDENTIALS, 'business', 'Shop', fetcher), /numeric ID/)
  assert.equal(fetcher.calls.length, 0)
})

test('Catalog API: items go to items_batch as PRODUCT_ITEM upserts', async () => {
  const fetcher = graph({ handles: ['HANDLE-1'], validation_status: [{ retailer_id: 'SHIRT-002', errors: [{ message: 'price is required' }], warnings: [{ message: 'unknown field' }] }] })
  const requests = [items.toUpsertRequest(product(), DEFAULTS), items.toUpsertRequest(product({ retailer_id: 'SHIRT-002' }), DEFAULTS), items.toDeleteRequest('OLD-1')]
  const result = await meta.sendItemsBatch(CREDENTIALS, CATALOG, requests, fetcher)

  const [call] = fetcher.calls
  assert.equal(call.url, `https://graph.facebook.com/v25.0/${CATALOG}/items_batch`)
  assert.equal(call.method, 'POST')
  assert.equal(call.auth, 'Bearer TOKEN')
  assert.equal(call.body.item_type, 'PRODUCT_ITEM')
  assert.equal(call.body.allow_upsert, 'true')
  const sent = JSON.parse(call.body.requests)
  assert.deepEqual(sent.map((request) => [request.method, request.data.id]), [['UPDATE', 'SHIRT-001'], ['UPDATE', 'SHIRT-002'], ['DELETE', 'OLD-1']])
  assert.deepEqual(sent[2].data, { id: 'OLD-1' })

  assert.deepEqual(result.handles, ['HANDLE-1'])
  assert.equal(result.handleByItem.get('SHIRT-001'), 'HANDLE-1')
  assert.deepEqual(result.items.get('SHIRT-002'), { errors: ['price is required'], warnings: ['unknown field'] })
  assert.equal(result.failed.size, 0)
})

test('Catalog API: large sends are split, and a refused request stops the rest', async () => {
  const many = Array.from({ length: meta.MAX_BATCH_ITEMS + 5 }, (_, index) => items.toDeleteRequest(`SKU-${index}`))

  const ok = graph({ handles: ['A'] }, { handles: ['B'] })
  const sent = await meta.sendItemsBatch(CREDENTIALS, CATALOG, many, ok)
  assert.equal(ok.calls.length, 2)
  assert.deepEqual(sent.handles, ['A', 'B'])
  assert.equal(sent.handleByItem.get('SKU-0'), 'A')
  assert.equal(sent.handleByItem.get(`SKU-${meta.MAX_BATCH_ITEMS}`), 'B')

  const refused = graph({ error: { code: 200, message: '(#200) Permissions error' } })
  const failed = await meta.sendItemsBatch(CREDENTIALS, CATALOG, many, refused)
  assert.equal(refused.calls.length, 1)                                // the second chunk would fail the same way
  assert.equal(failed.failed.size, many.length)
  assert.match(failed.failed.get('SKU-0'), /needs catalog access/)

  // Meta answered but took nothing in
  const empty = await meta.sendItemsBatch(CREDENTIALS, CATALOG, [items.toDeleteRequest('X-1')], graph({ handles: [] }))
  assert.match(empty.failed.get('X-1'), /did not take the update/)
})

test('Catalog API: a batch is checked by its handle', async () => {
  const fetcher = graph({ data: [{ handle: 'H/1', status: 'finished', errors_total_count: 1, errors: [{ line: 0, id: 'SHIRT-002', message: 'Image could not be downloaded' }], warnings: [{ id: 'SHIRT-001', message: 'Title is long' }], ids_of_invalid_requests: ['SHIRT-002', 'SHIRT-003'] }] })
  const status = await meta.checkBatch(CREDENTIALS, CATALOG, 'H/1', fetcher)
  assert.equal(fetcher.calls[0].url, `https://graph.facebook.com/v25.0/${CATALOG}/check_batch_request_status?handle=H%2F1&load_ids_of_invalid_requests=true`)
  assert.equal(status.finished, true)
  assert.deepEqual([...status.invalidIds].sort(), ['SHIRT-002', 'SHIRT-003'])
  assert.deepEqual(status.errors.get('SHIRT-002'), ['Image could not be downloaded'])
  assert.deepEqual(status.warnings.get('SHIRT-001'), ['Title is long'])

  const running = await meta.checkBatch(CREDENTIALS, CATALOG, 'H2', graph({ data: [{ handle: 'H2', status: 'started' }] }))
  assert.equal(running.finished, false)
})

test('Catalog API: reading items follows paging and survives an unknown field', async () => {
  const paged = graph(
    { data: [{ retailer_id: 'A' }], paging: { cursors: { after: 'CUR+1' }, next: 'https://graph.facebook.com/next' } },
    { data: [{ retailer_id: 'B' }], paging: { cursors: { after: 'CUR2' } } }
  )
  assert.deepEqual((await meta.fetchCatalogItems(CREDENTIALS, CATALOG, paged)).map((item) => item.retailer_id), ['A', 'B'])
  assert.match(paged.calls[0].url, /review_status/)
  assert.match(paged.calls[1].url, /&after=CUR%2B1$/)

  const older = graph({ error: { code: 100, message: '(#100) Tried accessing nonexisting field (review_status)' } }, { data: [{ retailer_id: 'A' }] })
  assert.equal((await meta.fetchCatalogItems(CREDENTIALS, CATALOG, older)).length, 1)
  assert.doesNotMatch(older.calls[1].url, /review_status/)

  // A catalog that cannot be opened is an error, not a reason to retry
  const missing = graph({ error: { code: 100, message: "Unsupported get request. Object with ID '1' does not exist, cannot be loaded due to missing permissions" } })
  await assert.rejects(() => meta.fetchCatalogItems(CREDENTIALS, CATALOG, missing))
  assert.equal(missing.calls.length, 1)
})

test('Catalog API: creating and connecting a catalog', async () => {
  const create = graph({ id: '900800700600500' })
  assert.equal(await meta.createCatalog(CREDENTIALS, BUSINESS, '  Asha catalog ', create), '900800700600500')
  assert.equal(create.calls[0].url, `https://graph.facebook.com/v25.0/${BUSINESS}/owned_product_catalogs`)
  assert.deepEqual(create.calls[0].body, { name: 'Asha catalog', vertical: 'commerce' })
  await assert.rejects(() => meta.createCatalog(CREDENTIALS, BUSINESS, '   ', create), /name/)

  const connect = graph({ success: true })
  await meta.connectCatalog(CREDENTIALS, CATALOG, connect)
  assert.equal(connect.calls[0].url, `https://graph.facebook.com/v25.0/${WABA}/product_catalogs`)
  assert.equal(connect.calls[0].method, 'POST')
  assert.deepEqual(connect.calls[0].body, { catalog_id: CATALOG })
  await assert.rejects(() => meta.connectCatalog(CREDENTIALS, CATALOG, graph({ success: false })), /did not confirm/)

  const listed = graph({ data: [{ id: CATALOG, name: 'Asha', product_count: 4 }] })
  assert.equal((await meta.listWabaCatalogs(CREDENTIALS, listed))[0].id, CATALOG)
  assert.match(listed.calls[0].url, new RegExp(`/${WABA}/product_catalogs\\?fields=`))
})

test('Catalog API: renaming and deleting a catalog', async () => {
  const rename = graph({ success: true })
  await meta.renameCatalog(CREDENTIALS, CATALOG, '  Asha summer catalog ', rename)
  assert.equal(rename.calls[0].url, `https://graph.facebook.com/v25.0/${CATALOG}`)
  assert.equal(rename.calls[0].method, 'POST')
  assert.deepEqual(rename.calls[0].body, { name: 'Asha summer catalog' })
  await assert.rejects(() => meta.renameCatalog(CREDENTIALS, CATALOG, '  ', rename), /name/)

  const remove = graph({ success: true })
  await meta.deleteCatalog(CREDENTIALS, CATALOG, remove)
  assert.equal(remove.calls[0].url, `https://graph.facebook.com/v25.0/${CATALOG}`)
  assert.equal(remove.calls[0].method, 'DELETE')

  await assert.rejects(() => meta.deleteCatalog(CREDENTIALS, 'not-an-id', graph({ success: true })), /numeric ID/)
  await assert.rejects(() => meta.deleteCatalog(CREDENTIALS, CATALOG, graph({ success: false })), /did not confirm/)
  assert.equal(meta.disconnectCatalog, undefined, 'Meta has no API to disconnect a catalog from a WhatsApp account')
})

test('Catalog sync: after a catalog is deleted its products stay, no longer marked as in it', async () => {
  const db = fakeDb([
    { id: 'a', organization_id: 'org-1', retailer_id: 'IN-IT', metadata: { source: 'meta', catalog: { state: 'synced', catalog_id: CATALOG }, attributes: { importer_name: 'Asha Imports' } } },
    { id: 'b', organization_id: 'org-1', retailer_id: 'OTHER', metadata: { catalog: { state: 'synced', catalog_id: '999999999999999' } } },
    { id: 'c', organization_id: 'org-1', retailer_id: 'LOCAL', metadata: {} },
  ])
  assert.equal(await sync.forgetCatalog(db, 'org-1', CATALOG), 1)
  const byId = Object.fromEntries(db.rows.map((row) => [row.id, row.metadata]))
  assert.deepEqual(byId.a, { attributes: { importer_name: 'Asha Imports' } })
  assert.equal(items.isInCatalog({ metadata: byId.a }), false)
  assert.equal(byId.b.catalog.catalog_id, '999999999999999')
  assert.deepEqual(byId.c, {})
})

test('Catalog API: cart and catalog buttons are set with query parameters', async () => {
  const fetcher = graph({ success: true })
  await meta.setCommerceSettings(CREDENTIALS, { is_cart_enabled: true, is_catalog_visible: true }, fetcher)
  assert.equal(fetcher.calls[0].url, `https://graph.facebook.com/v25.0/${PHONE}/whatsapp_commerce_settings?is_cart_enabled=true&is_catalog_visible=true`)
  assert.equal(fetcher.calls[0].method, 'POST')

  const read = graph({ data: [{ is_cart_enabled: true, is_catalog_visible: false, id: '1' }] })
  assert.deepEqual(await meta.getCommerceSettings(CREDENTIALS, read), { is_cart_enabled: true, is_catalog_visible: false })
  assert.equal(await meta.getCommerceSettings(CREDENTIALS, graph({ data: [] })), null)
})

test('Catalog API: failures are explained in the store owner’s terms', () => {
  const error = (code, message = 'x') => ({ message, details: [{ code }] })
  assert.equal(meta.describeCatalogError(error(190)).kind, 'token')
  assert.match(meta.describeCatalogError(error(190)).message, /Reconnect WhatsApp/)
  assert.equal(meta.describeCatalogError(error(200)).kind, 'permission')
  assert.match(meta.describeCatalogError(error(10)).message, /Connect catalog with Meta/)
  assert.equal(meta.describeCatalogError(error(80014)).kind, 'rate_limit')
  assert.equal(meta.describeCatalogError(error(100, "Object with ID '9' does not exist")).kind, 'not_found')
  assert.deepEqual(meta.describeCatalogError(error(100, 'Param name must be a string')), { kind: 'invalid', message: 'Param name must be a string' })
  assert.equal(meta.describeCatalogError({ name: 'TimeoutError', message: 'The operation timed out' }).kind, 'timeout')
})

test('Catalog API: what an access token may do with a catalog', async () => {
  const fetcher = graph({ data: { is_valid: true, scopes: ['whatsapp_business_management', 'catalog_management', 'business_management'], granular_scopes: [{ scope: 'catalog_management', target_ids: [CATALOG] }, { scope: 'business_management', target_ids: [BUSINESS] }, { scope: 'whatsapp_business_messaging' }] } })
  const access = await meta.inspectToken('CUSTOMER', { id: '111', secret: 'shh' }, 'v25.0', fetcher)
  assert.equal(fetcher.calls[0].url, 'https://graph.facebook.com/v25.0/debug_token?input_token=CUSTOMER')
  assert.equal(fetcher.calls[0].auth, 'Bearer 111|shh')
  assert.deepEqual(access.targets, { catalog_management: [CATALOG], business_management: [BUSINESS] })

  assert.equal(meta.canEditCatalog(access, CATALOG), true)
  assert.equal(meta.canEditCatalog(access, '999999999'), false)                      // granted for another catalog only
  assert.equal(meta.canEditCatalog({ valid: true, scopes: ['catalog_management'], targets: {} }, CATALOG), true)   // granted for all
  assert.equal(meta.canEditCatalog({ valid: true, scopes: ['whatsapp_business_management'], targets: {} }, CATALOG), false)
  assert.equal(meta.canEditCatalog(null, CATALOG), null)

  // No app credentials, or a token Meta will not describe: unknown rather than "no"
  assert.equal(await meta.inspectToken('CUSTOMER', { id: '111' }, 'v25.0', fetcher), null)
  assert.equal(await meta.inspectToken('CUSTOMER', { id: '111', secret: 'shh' }, 'v25.0', graph({ error: { code: 100, message: 'another app' } })), null)
})

// ── Keeping the dashboard and the catalog in step ───────────────────────────

test('Catalog sync: saving sends the product and records how Meta answered', async () => {
  const db = fakeDb([
    { id: 'p1', organization_id: 'org-1', ...product() },
    { id: 'p2', organization_id: 'org-1', ...product({ id: 'p2', retailer_id: 'NO-PHOTO', image_url: null }) },
    { id: 'p3', organization_id: 'org-1', ...product({ id: 'p3', retailer_id: 'BAD-PRICE' }) },
  ])
  const fetcher = graph({ handles: ['H1'], validation_status: [{ retailer_id: 'BAD-PRICE', errors: [{ message: 'Invalid price' }], warnings: [] }] })
  const summary = await sync.pushProductsToCatalog(db, ORG, db.rows.map((row) => ({ ...row })), { fetcher })

  assert.equal(fetcher.calls.length, 1)
  assert.deepEqual(JSON.parse(fetcher.calls[0].body.requests).map((request) => request.data.id), ['SHIRT-001', 'BAD-PRICE'])   // the one without a photo is not sent
  assert.equal(summary.sent, 1)
  assert.equal(summary.rejected, 2)

  const saved = Object.fromEntries(db.rows.map((row) => [row.id, row.metadata.catalog]))
  assert.equal(saved.p1.state, 'pending')
  assert.equal(saved.p1.handle, 'H1')
  assert.equal(saved.p2.state, 'error')
  assert.match(saved.p2.errors[0], /photo/)
  assert.deepEqual(saved.p3.errors, ['Invalid price'])
})

test('Catalog sync: a request Meta refuses outright leaves catalog items as they were', async () => {
  const inCatalog = { source: 'meta', catalog: { state: 'synced', review_status: 'approved' } }
  const db = fakeDb([
    { id: 'p1', organization_id: 'org-1', ...product({ metadata: inCatalog }) },
    { id: 'p2', organization_id: 'org-1', ...product({ id: 'p2', retailer_id: 'NEW-1' }) },
  ])
  const summary = await sync.pushProductsToCatalog(db, ORG, db.rows.map((row) => ({ ...row })), { fetcher: graph({ error: { code: 200, message: 'Permissions error' } }) })

  assert.match(summary.requestError, /needs catalog access/)
  assert.deepEqual(db.rows[0].metadata, inCatalog)                       // still shown as in the catalog, which it is
  assert.equal(db.rows[1].metadata.catalog.state, 'error')               // the new one says why it is not there
  assert.match(db.rows[1].metadata.catalog.errors[0], /needs catalog access/)
})

test('Catalog sync: a store without a linked catalog is told so', async () => {
  await assert.rejects(() => sync.pushProductsToCatalog(fakeDb([]), { ...ORG, meta_catalog_id: '' }, [product()]), /Link your Meta catalog/)
  assert.deepEqual(await sync.removeFromCatalog({ ...ORG, meta_catalog_id: 'abc' }, ['X']), { removed: false, error: 'Link your Meta catalog in Store settings first.' })
})

test('Catalog sync: removing a product deletes the catalog item', async () => {
  const fetcher = graph({ handles: ['H9'] })
  assert.deepEqual(await sync.removeFromCatalog(ORG, ['SHIRT-001'], fetcher), { removed: true })
  assert.deepEqual(JSON.parse(fetcher.calls[0].body.requests), [{ method: 'DELETE', data: { id: 'SHIRT-001' } }])

  const refused = await sync.removeFromCatalog(ORG, ['SHIRT-001'], graph({ error: { code: 190, message: 'expired' } }))
  assert.equal(refused.removed, false)
  assert.match(refused.error, /Reconnect WhatsApp/)
})

test('Catalog sync: batches still being processed are settled from Meta’s answer', async () => {
  const sentAt = '2026-10-13T10:00:00.000Z'
  const pending = (handle) => ({ catalog: { state: 'pending', handle, synced_at: sentAt } })
  const db = fakeDb([
    { id: 'p1', organization_id: 'org-1', retailer_id: 'GOOD', metadata: pending('H1') },
    { id: 'p2', organization_id: 'org-1', retailer_id: 'BAD', metadata: pending('H1') },
    { id: 'p3', organization_id: 'org-1', retailer_id: 'SLOW', metadata: pending('H2') },
    { id: 'p4', organization_id: 'org-1', retailer_id: 'DONE', metadata: { catalog: { state: 'synced' } } },
    { id: 'p5', organization_id: 'org-2', retailer_id: 'OTHER', metadata: pending('H1') },
  ])
  const answers = (call) => call.url.includes('handle=H1')
    ? { data: [{ status: 'finished', errors: [{ id: 'BAD', message: 'Image could not be downloaded' }], ids_of_invalid_requests: ['BAD'] }] }
    : { data: [{ status: 'started' }] }

  const soon = await sync.refreshCatalogStatus(db, ORG, { fetcher: graph(answers), now: Date.parse(sentAt) + 60_000 })
  assert.deepEqual(soon, { accepted: 1, rejected: 1, pending: 1 })
  const states = () => Object.fromEntries(db.rows.map((row) => [row.retailer_id, row.metadata.catalog.state]))
  assert.deepEqual(states(), { GOOD: 'synced', BAD: 'error', SLOW: 'pending', DONE: 'synced', OTHER: 'pending' })   // another store is never touched
  assert.deepEqual(db.rows[1].metadata.catalog.errors, ['Image could not be downloaded'])

  // An update Meta never confirms does not stay "sending" for ever
  const later = await sync.refreshCatalogStatus(db, ORG, { fetcher: graph(answers), now: Date.parse(sentAt) + 2 * 60 * 60 * 1000 })
  assert.deepEqual(later, { accepted: 0, rejected: 1, pending: 0 })
  assert.match(db.rows[2].metadata.catalog.errors[0], /Send it to the catalog again/)

  // Nothing waiting: Meta is not asked at all
  const idle = graph({ data: [] })
  await sync.refreshCatalogStatus(db, ORG, { fetcher: idle })
  assert.equal(idle.calls.length, 0)
})

test('Catalog sync: copying the catalog back keeps local work and drops what left the catalog', async () => {
  const db = fakeDb([
    { id: 'a', organization_id: 'org-1', retailer_id: 'KEPT', title: 'Old title', metadata: { source: 'meta', attributes: { importer_name: 'Asha Imports', importer_address: { street1: 'MG Road', city: 'Bengaluru', country: 'IN' } } } },
    { id: 'b', organization_id: 'org-1', retailer_id: 'GONE', title: 'Left the catalog', metadata: { source: 'meta' } },
    { id: 'c', organization_id: 'org-1', retailer_id: 'MINE', title: 'Dashboard only', metadata: {} },
    { id: 'd', organization_id: 'org-1', retailer_id: 'EDITING', title: 'My new title', metadata: { source: 'meta', catalog: { state: 'pending', handle: 'H1' } } },
    { id: 'e', organization_id: 'org-1', retailer_id: 'TURNED-DOWN', title: 'My rejected edit', metadata: { source: 'meta', catalog: { state: 'error', errors: ['Bad image'] } } },
    { id: 'f', organization_id: 'org-2', retailer_id: 'GONE', title: 'Another store', metadata: { source: 'meta' } },
  ])
  const fetcher = graph({ data: [
    { retailer_id: 'KEPT', name: 'New title', price: '500 INR', origin_country: 'CN', review_status: 'approved' },
    { retailer_id: 'EDITING', name: 'Catalog title', price: '100 INR' },
    { retailer_id: 'TURNED-DOWN', name: 'Catalog title', price: '100 INR' },
    { retailer_id: 'FRESH', name: 'Added in Commerce Manager', price: '250 INR', review_status: 'pending' },
  ] })
  const summary = await sync.pullCatalogToDatabase(db, ORG, fetcher)
  assert.deepEqual(summary, { total: 4, synced: 2, removed: 1, skipped: 2, error: null })

  const byKey = Object.fromEntries(db.rows.map((row) => [`${row.organization_id}/${row.retailer_id}`, row]))
  assert.equal(byKey['org-1/KEPT'].title, 'New title')
  assert.equal(byKey['org-1/KEPT'].metadata.attributes.importer_name, 'Asha Imports')        // Meta's listing does not return it
  assert.equal(byKey['org-1/KEPT'].metadata.catalog.review_status, 'approved')
  assert.equal(byKey['org-1/EDITING'].title, 'My new title')                                 // Meta is still applying this edit
  assert.equal(byKey['org-1/TURNED-DOWN'].title, 'My rejected edit')                         // so the owner can fix and resend it
  assert.equal(byKey['org-1/FRESH'].metadata.catalog.review_status, 'pending')
  assert.equal(byKey['org-1/MINE'].title, 'Dashboard only')
  assert.equal('org-1/GONE' in byKey, false)
  assert.equal(byKey['org-2/GONE'].title, 'Another store')
})

test('Catalog sync: each product remembers which catalog it was sent to', async () => {
  const db = fakeDb([{ id: 'p1', organization_id: 'org-1', ...product() }])
  await sync.pushProductsToCatalog(db, ORG, db.rows.map((row) => ({ ...row })), { fetcher: graph({ handles: ['H1'], validation_status: [] }) })
  assert.equal(db.rows[0].metadata.catalog.catalog_id, CATALOG)

  const pulled = fakeDb([])
  await sync.pullCatalogToDatabase(pulled, ORG, graph({ data: [{ retailer_id: 'FRESH', name: 'Added in Commerce Manager', price: '250 INR' }] }))
  assert.equal(pulled.rows[0].metadata.catalog.catalog_id, CATALOG)
})

test('Catalog sync: a product deleted in Commerce Manager is deleted here too, wherever it was created', async () => {
  const confirmed = (catalog_id) => ({ catalog: { state: 'synced', review_status: 'approved', catalog_id } })
  const db = fakeDb([
    { id: 'a', organization_id: 'org-1', retailer_id: 'STILL-THERE', title: 'Kept', metadata: confirmed(CATALOG) },
    { id: 'b', organization_id: 'org-1', retailer_id: 'DELETED-IN-META', title: 'Made here, deleted in Meta', metadata: confirmed(CATALOG) },
    { id: 'c', organization_id: 'org-1', retailer_id: 'OTHER-CATALOG', title: 'Confirmed in an earlier catalog', metadata: confirmed('999999999999999') },
    { id: 'd', organization_id: 'org-1', retailer_id: 'SENDING', title: 'Still on its way', metadata: { catalog: { state: 'pending', handle: 'H1', catalog_id: CATALOG } } },
    { id: 'e', organization_id: 'org-1', retailer_id: 'NEVER-SENT', title: 'Dashboard only', metadata: {} },
  ])
  const summary = await sync.pullCatalogToDatabase(db, ORG, graph({ data: [{ retailer_id: 'STILL-THERE', name: 'Kept', price: '100 INR', review_status: 'approved' }] }))
  assert.equal(summary.removed, 1)
  assert.deepEqual(db.rows.map((row) => row.retailer_id).sort(), ['NEVER-SENT', 'OTHER-CATALOG', 'SENDING', 'STILL-THERE'])

  assert.equal(sync.wasDeletedInCatalog({ metadata: confirmed(CATALOG) }, CATALOG), true)
  assert.equal(sync.wasDeletedInCatalog({ metadata: confirmed('999999999999999') }, CATALOG), false)  // switching catalogs never wipes products
  assert.equal(sync.wasDeletedInCatalog({ metadata: { catalog: { state: 'error', catalog_id: CATALOG } } }, CATALOG), false)
  assert.equal(sync.wasDeletedInCatalog({ metadata: { source: 'meta' } }, CATALOG), true)  // copies made before catalogs were recorded
  assert.equal(sync.wasDeletedInCatalog({ metadata: {} }, CATALOG), false)
})

test('Catalog sync: an empty or failed read never empties the product list', async () => {
  const rows = [{ id: 'a', organization_id: 'org-1', retailer_id: 'KEPT', title: 'Kurta', metadata: { source: 'meta' } }]
  const empty = fakeDb(rows)
  assert.deepEqual(await sync.pullCatalogToDatabase(empty, ORG, graph({ data: [] })), { total: 0, synced: 0, removed: 0, skipped: 0, error: null })
  assert.equal(empty.rows.length, 1)

  const failing = fakeDb(rows)
  await assert.rejects(() => sync.pullCatalogToDatabase(failing, ORG, graph({ error: { code: 190, message: 'expired' } })))
  assert.equal(failing.rows.length, 1)
})

// ── Onboarding a business through Embedded Signup ───────────────────────────

test('Onboarding: each number gets its own registration PIN', () => {
  const pin = onboarding.getRegistrationPin(PHONE, 'server-secret')
  assert.match(pin, /^\d{6}$/)
  assert.equal(onboarding.getRegistrationPin(PHONE, 'server-secret'), pin)                    // worked out again, not stored
  assert.notEqual(onboarding.getRegistrationPin('106850078877667', 'server-secret'), pin)
  assert.notEqual(onboarding.getRegistrationPin(PHONE, 'another-secret'), pin)
  // Until the secret is set, numbers keep the PIN they were registered with
  assert.equal(onboarding.getRegistrationPin(PHONE, ''), onboarding.LEGACY_REGISTRATION_PIN)
})

test('Onboarding: only Meta IDs are taken from the signup window', () => {
  assert.deepEqual(
    onboarding.parseSignupSession({ wabaId: WABA, phoneNumberId: ` ${PHONE} `, businessId: BUSINESS, catalogIds: [CATALOG, 'me/accounts', 42, null] }),
    { wabaId: WABA, phoneNumberId: PHONE, businessId: BUSINESS, catalogIds: [CATALOG] }
  )
  assert.deepEqual(onboarding.parseSignupSession({ wabaId: 'me', phoneNumberId: '1/register', catalogIds: 'x' }), { wabaId: '', phoneNumberId: '', businessId: '', catalogIds: [] })
  assert.deepEqual(onboarding.parseSignupSession(null), { wabaId: '', phoneNumberId: '', businessId: '', catalogIds: [] })
})
