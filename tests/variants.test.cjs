require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const V = require('../lib/commerce/variants.ts')
const VS = require('../lib/commerce/variant-store.ts')
const SF = require('../lib/commerce/storefront.ts')
const { cleanCart } = require('../lib/commerce/store-accounts.ts')
const { salonDb } = require('./salon-fake-db.cjs')

const ORG = '11111111-1111-4111-8111-111111111111'
const P1 = '22222222-2222-4222-8222-222222222222'
const VA = '33333333-3333-4333-8333-333333333331'
const VB = '33333333-3333-4333-8333-333333333332'
const root = path.join(__dirname, '..')

test('options are cleaned: names, choices, limits', () => {
  assert.deepEqual(V.cleanOptions([{ name: ' Size ', values: 'S, M, m, L,' }]).options, [{ name: 'Size', values: ['S', 'M', 'L'] }], 'same choice twice is kept once')
  assert.match(V.cleanOptions([{ name: '', values: 'S' }]).error, /Give every option a name/)
  assert.match(V.cleanOptions([{ name: 'Size', values: '' }]).error, /Add the choices for Size/)
  assert.match(V.cleanOptions([{ name: 'Size', values: 'S' }, { name: 'size', values: 'M' }]).error, /two options called/)
  assert.match(V.cleanOptions([1, 2, 3, 4].map((i) => ({ name: `O${i}`, values: 'a' }))).error, /at most 3 options/)
  const many = Array.from({ length: 11 }, (_, i) => `v${i}`).join(',')
  assert.match(V.cleanOptions([{ name: 'A', values: many }, { name: 'B', values: many }]).error, /121 combinations; the most is 100/)
  assert.deepEqual(V.cleanOptions([]).options, [])
})

test('combinations keep their price, stock and SKU when a choice is added', () => {
  const size = { name: 'Size', values: ['S', 'M'] }
  const first = V.buildVariants([size], [], [{ options: { Size: 'S' }, price: '499', stock: '5', sku: 'TS-S' }])
  assert.deepEqual(first.map((v) => [v.name, v.price, v.stock, v.sku]), [['S', 499, 5, 'TS-S'], ['M', null, null, null]])
  const saved = first.map((v, i) => ({ ...v, id: `id-${i}` }))
  const colour = { name: 'Colour', values: ['Red'] }
  const bigger = V.buildVariants([size], saved, [])
  assert.equal(bigger[0].id, 'id-0')
  const withColour = V.buildVariants([colour, size], saved)
  assert.deepEqual(withColour.map((v) => v.name), ['Red / S', 'Red / M'])
  assert.equal(withColour[0].id, undefined, 'a new option makes new combinations')
  assert.equal(V.variantName([colour, size], { Size: 'L', Colour: 'Red' }), 'Red / L')
  assert.equal(V.buildVariants([size], [], [{ options: { Size: 'S' }, price: '-3', stock: 'x' }])[0].price, null, 'a bad price means the product price')
})

test('the shopper picks: the matching combination, what can still be picked, price from', () => {
  const options = [{ name: 'Colour', values: ['Red', 'Blue'] }, { name: 'Size', values: ['S', 'M'] }]
  const variants = [
    { options: { Colour: 'Red', Size: 'S' }, price: 499, stock: 0, active: true },
    { options: { Colour: 'Red', Size: 'M' }, price: 549, stock: 3, active: true },
    { options: { Colour: 'Blue', Size: 'S' }, price: null, stock: null, active: true },
    { options: { Colour: 'Blue', Size: 'M' }, price: 599, stock: 2, active: false },
  ]
  assert.equal(V.findVariant(variants, { Colour: 'Red' }, options), null, 'not all picked yet')
  assert.equal(V.findVariant(variants, { Colour: 'Red', Size: 'M' }, options).price, 549)
  assert.equal(V.valueAvailable(variants, options, { Colour: 'Red' }, 'Size', 'S'), false, 'Red S is sold out')
  assert.equal(V.valueAvailable(variants, options, { Colour: 'Blue' }, 'Size', 'M'), false, 'Blue M is not sold')
  assert.equal(V.valueAvailable(variants, options, {}, 'Size', 'S'), true, 'Blue S has stock')
  assert.deepEqual(V.priceRange(450, variants), { min: 450, max: 549 }, 'the switched-off one is left out; null = product price')
})

test('saved in the database: replaced, kept, removed; stock never below 0', async () => {
  const db = salonDb({ commerce_products: [{ id: P1, organization_id: ORG, title: 'T-shirt', price: 450 }], commerce_product_variants: [] })
  let r = await VS.saveProductOptions(db, ORG, P1, [{ name: 'Size', values: 'S, M' }], [{ options: { Size: 'S' }, price: 499, stock: 5 }])
  assert.equal(r.variants.length, 2)
  assert.deepEqual(db.tables.commerce_products[0].options, [{ name: 'Size', values: ['S', 'M'] }])
  const sId = db.tables.commerce_product_variants.find((v) => v.name === 'S').id
  r = await VS.saveProductOptions(db, ORG, P1, [{ name: 'Size', values: 'S, L' }], [])
  assert.deepEqual(db.tables.commerce_product_variants.map((v) => v.name).sort(), ['L', 'S'], 'M removed, L added')
  const s = db.tables.commerce_product_variants.find((v) => v.name === 'S')
  assert.equal(s.id, sId, 'S kept its id')
  assert.equal(s.price, 499)
  await VS.changeVariantStock(db, ORG, sId, -3)
  assert.equal(db.tables.commerce_product_variants.find((v) => v.id === sId).stock, 2)
  await VS.changeVariantStock(db, ORG, sId, -9)
  assert.equal(db.tables.commerce_product_variants.find((v) => v.id === sId).stock, 0)
  const lId = db.tables.commerce_product_variants.find((v) => v.name === 'L').id
  await VS.changeVariantStock(db, ORG, lId, -1)
  assert.equal(db.tables.commerce_product_variants.find((v) => v.id === lId).stock, null, 'stock not counted stays not counted')
  r = await VS.saveProductOptions(db, ORG, P1, [], [])
  assert.equal(db.tables.commerce_products[0].options, null)
  assert.equal(db.tables.commerce_product_variants.length, 0, 'no options: no combinations')
  assert.match((await VS.saveProductOptions(db, ORG, '44444444-4444-4444-8444-444444444444', [], [])).error, /Product not found/)
})

function page(variants) {
  const settings = SF.readStorefront({ enabled: true, pickup: true, delivery: true })
  return {
    organization: { id: ORG, name: 'S', slug: 's', currency: 'INR', domain: null }, settings, categories: [], fees: { fee: 0, freeFrom: 0 }, pay: { online: false, later: true },
    products: [{ id: P1, title: 'T-shirt', description: '', price: 450, currency: 'INR', image: '', category: 'Men', inStock: true, options: [{ name: 'Size', values: ['S', 'M'] }], variants, priceFrom: 450 }],
  }
}

test('store orders: a product with options needs a choice; price and name from the choice', () => {
  const p = page([{ id: VA, name: 'S', options: { Size: 'S' }, price: 499, inStock: true, image: '' }, { id: VB, name: 'M', options: { Size: 'M' }, price: 450, inStock: false, image: '' }])
  const base = { name: 'Asha', phone: '+919876543210', handover: 'pickup' }
  assert.match(SF.parseStoreOrder({ ...base, items: [{ productId: P1, quantity: 1 }] }, p).error, /Please choose the size for T-shirt/)
  assert.match(SF.parseStoreOrder({ ...base, items: [{ productId: P1, variantId: VB, quantity: 1 }] }, p).error, /T-shirt \(M\) is out of stock/)
  const ok = SF.parseStoreOrder({ ...base, items: [{ productId: P1, variantId: VA, quantity: 2 }] }, p)
  assert.equal(ok.subtotal, 998)
  assert.deepEqual(ok.order.items[0], { productId: P1, variantId: VA, variantName: 'S', title: 'T-shirt · S', price: 499, quantity: 2 })
})

test('saved carts keep "product:option" keys; the order line keeps the option', async () => {
  assert.deepEqual(cleanCart({ [P1]: 1, [`${P1}:${VA}`]: 2, [`${P1}:x`]: 1, [`${P1}:${VA}:${VB}`]: 1 }, new Set([P1])), { [P1]: 1, [`${P1}:${VA}`]: 2 })
  const { createManualOrder } = require('../lib/commerce/manual-order.ts')
  const db = salonDb({ commerce_products: [{ id: P1, organization_id: ORG, retailer_id: 'TS', title: 'T-shirt', price: 450 }], commerce_orders: [], commerce_order_items: [] })
  const made = await createManualOrder(db, { id: ORG }, { channel: 'website', customer: { contactId: null, name: '', phone: null }, items: [{ productId: P1, variantId: VA, variantName: 'S', title: 'T-shirt · S', price: 499, quantity: 2 }], handover: 'pickup', paid: false, paymentMethod: null, shippingFee: null, address: null, note: null }, async () => 'W-1')
  assert.ok(made.order)
  const line = db.tables.commerce_order_items[0]
  assert.equal(line.variant_id, VA)
  assert.equal(line.variant_name, 'S')
  assert.equal(line.title, 'T-shirt · S')
  assert.equal(line.unit_price, 499)
})

test('wiring: store page picks options, stock changes on order and cancel, migration matches', () => {
  assert.equal(fs.readFileSync(path.join(root, 'supabase/migrations/20261124_shop_product_options.sql'), 'utf8'), VS.VARIANT_SQL)
  const store = fs.readFileSync(path.join(root, 'app/s/[slug]/storefront.tsx'), 'utf8')
  assert.match(store, /findVariant\(viewing\.variants, picked, viewing\.options \|\| \[\]\)/)
  assert.match(store, /\.\.\.\(l\.variant \? \{ variantId: l\.variant\.id \} : \{\}\)/, 'the order sends the chosen option')
  assert.match(store, />Choose<\/a>/, 'a card with options opens the product page')
  const order = fs.readFileSync(path.join(root, 'app/api/public/store/[slug]/order/route.ts'), 'utf8')
  assert.match(order, /changeVariantStock\(db, page\.organization\.id, item\.variantId, -item\.quantity\)/)
  const orders = fs.readFileSync(path.join(root, 'app/api/commerce/orders/route.ts'), 'utf8')
  assert.match(orders, /changeVariantStock\(supabase, organizationId, item\.variant_id, Number\(item\.quantity\) \|\| 0\)/)
  const tab = fs.readFileSync(path.join(root, 'components/commerce/products-tab.tsx'), 'utf8')
  assert.match(tab, /<ProductOptions orgId=\{orgId\} productId=\{form\.id\}/)
})
