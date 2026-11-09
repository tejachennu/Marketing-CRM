require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { salonDb } = require('./salon-fake-db.cjs')
const C = require('../lib/salon/catalog.ts')
const L = require('../lib/salon/change-log.ts')
const A = require('../lib/salon/actions.ts')
const V = require('../lib/salon/validate.ts')

const ORG = 'c0ffee00-0000-4000-8000-0000000000ca'
const P = (n) => `00000000-0000-4000-8000-0000000009${String(n).padStart(2, '0')}`
const product = (n, name, price, category, extra = {}) => ({ id: P(n), organization_id: ORG, name, price, currency: 'INR', category, image_url: `https://cdn.example.com/${n}.jpg`, description: '', is_available: true, ...extra })

function seed() {
  return salonDb({
    commerce_products: [product(1, 'Argan hair oil', 450, 'Hair care'), product(2, 'Face wash', 299, 'Skin care'), product(3, 'Gift card', 1000, 'Gifts'), product(9, 'Other shop item', 50, 'X', { organization_id: 'someone-else' })],
    salon_services: [],
    salon_change_log: [],
  })
}

test('Catalog and history migration is run word for word', () => {
  const { FRONT_DESK_CATALOG_SQL } = require('../lib/salon/schema.ts')
  assert.equal(FRONT_DESK_CATALOG_SQL, fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261117_front_desk_catalog_and_history.sql'), 'utf8'))
})

test('Catalog: products become services when ticked; ones already added are skipped; prices follow the catalog', async () => {
  const db = seed()
  let list = await C.listCatalog(db, ORG)
  assert.deepEqual(list.map((p) => p.name).sort(), ['Argan hair oil', 'Face wash', 'Gift card'])
  assert.ok(list.every((p) => p.service_id === null))

  const first = await C.importFromCatalog(db, ORG, { product_ids: [P(1), P(3)], billable: true, duration_minutes: 15, tax_rate: 18 })
  assert.equal(first.created.length, 2)
  const oil = db.tables.salon_services.find((s) => s.name === 'Argan hair oil')
  assert.equal(oil.source, 'catalog')
  assert.equal(oil.catalog_product_id, P(1))
  assert.equal(oil.category, 'Hair care')
  assert.equal(oil.price, 450)
  assert.equal(oil.duration_minutes, 15)
  assert.equal(oil.image_url, 'https://cdn.example.com/1.jpg')

  // Ticked again with one new: only the new one is added, kept off bills as asked, in the chosen category
  const second = await C.importFromCatalog(db, ORG, { product_ids: [P(1), P(2)], billable: false, category: 'Retail' })
  assert.equal(second.created.length, 1)
  assert.equal(second.skipped, 1)
  const wash = db.tables.salon_services.find((s) => s.name === 'Face wash')
  assert.equal(wash.billable, false)
  assert.equal(wash.category, 'Retail')

  list = await C.listCatalog(db, ORG)
  assert.equal(list.find((p) => p.name === 'Face wash').billable, false)
  assert.ok(list.find((p) => p.name === 'Argan hair oil').service_id)

  // Another business's product can never be added
  const other = await C.importFromCatalog(db, ORG, { product_ids: [P(9)] })
  assert.equal(other.created.length, 0)

  await assert.rejects(C.importFromCatalog(db, ORG, { product_ids: [] }), /Tick at least one/)
  await assert.rejects(C.importFromCatalog(db, ORG, { product_ids: [P(2)], duration_minutes: 1 }), /5 minutes/)

  // The catalog price changes: Update prices brings it over
  db.tables.commerce_products.find((p) => p.id === P(1)).price = 499
  const { changed } = await C.refreshFromCatalog(db, ORG)
  assert.deepEqual(changed, [{ name: 'Argan hair oil', from: 450, to: 499 }])
  assert.equal(db.tables.salon_services.find((s) => s.name === 'Argan hair oil').price, 499)
  assert.deepEqual((await C.refreshFromCatalog(db, ORG)).changed, [])
})

test('Billing on/off: a service switched off cannot go on a new bill', async () => {
  const db = seed()
  await C.importFromCatalog(db, ORG, { product_ids: [P(2)], billable: false })
  const wash = db.tables.salon_services[0]
  const ctx = { db, organizationId: ORG, user: { id: 'user-1' }, organization: { id: ORG }, settings: { invoice_prefix: 'INV', prices_include_tax: true } }
  await assert.rejects(A.executeCounterAction(ctx, { type: 'walk_in_bill', customer: { name: 'Meena' }, service_ids: [wash.id], payment_method: 'cash', send_whatsapp: false }), /Face wash is set not to go on bills/)
  assert.equal(V.parseService({ name: 'Consultation', price: 0, billable: false }).value.billable, false)
  assert.equal(V.parseService({ name: 'Haircut', price: 300 }).value.billable, true)
  assert.deepEqual(V.parseService({ billable: false }, true).value, { billable: false })
})

test('Change history: who changed what, newest first; only real changes are written', async () => {
  const db = seed()
  const ctx = { db, organizationId: ORG, user: { id: 'u1', full_name: 'Teja' } }
  assert.deepEqual(L.changedFields({ price: '600.00', name: 'Haircut', billable: true }, { price: 650, name: 'Haircut', billable: true }, ['price', 'name', 'billable']), { price: { from: '600.00', to: 650 } })
  assert.deepEqual(L.changedFields({ tax_rate: '18.00' }, { tax_rate: 18 }, ['tax_rate']), {})
  await L.logChange(ctx, { area: 'service', action: 'added', target: 'Haircut', details: { price: 300 } })
  await L.logChange(ctx, { area: 'service', action: 'billing off', target: 'Face wash', details: { billable: { from: true, to: false } } })
  await L.logChange(ctx, { area: 'team', action: 'added', target: 'Anitha' })
  const all = await L.listChanges(db, ORG)
  assert.deepEqual(all.map((e) => e.target), ['Anitha', 'Face wash', 'Haircut'])
  assert.equal(all[0].user_name, 'Teja')
  assert.deepEqual((await L.listChanges(db, ORG, { area: 'service' })).map((e) => e.action), ['billing off', 'added'])
  // Writing the history never breaks the change itself
  await L.logChange({ db: { from: () => { throw new Error('down') } }, organizationId: ORG }, { area: 'service', action: 'added' })
})
