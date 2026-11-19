require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const B = require('../lib/commerce/store-browse.ts')
const SF = require('../lib/commerce/storefront.ts')
const CI = require('../lib/commerce/catalog-items.ts')
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')

const P = [
  { id: '1', title: 'Herbal Shampoo 200ml', category: 'Hair care', price: 199, mrp: 299, inStock: true, rating: 4.5, ratingCount: 12, brand: 'GreenLeaf', addedAt: '2026-11-01' },
  { id: '2', title: 'Cotton Kurti Blue', category: 'Clothing', price: 799, mrp: 1599, inStock: true, rating: 4.1, ratingCount: 3, addedAt: '2026-11-05' },
  { id: '3', title: 'Radhakrishnan Philosophy Book', category: 'Books', price: 450, inStock: true, brand: 'Penguin', addedAt: '2026-11-03' },
  { id: '4', title: 'Neem Face Wash', category: 'Hair care', price: 149, mrp: 175, inStock: false },
  { id: '5', title: 'Silk Saree', category: 'Clothing', price: 4999, mrp: 6999, inStock: true, rating: 4.8, ratingCount: 40 },
  { id: '6', title: 'Linen Shirt', category: 'Clothing', price: 999, inStock: true, variants: [{}], priceFrom: 899 },
]

test('discounts against the MRP, and the price a shopper pays', () => {
  assert.equal(B.discountPercent(P[1]), 50)
  assert.equal(B.discountPercent(P[0]), 33)
  assert.equal(B.discountPercent(P[2]), 0, 'no MRP, no discount')
  assert.equal(B.discountPercent({ price: 500, mrp: 400 }), 0, 'an MRP below the price is ignored')
  assert.equal(B.shownPrice(P[5]), 899, 'options: the lowest price')
})

test('sorting: in stock first, then the chosen order', () => {
  assert.deepEqual(B.sortProducts(P, 'price_low').map((p) => p.id), ['1', '3', '2', '6', '5', '4'])
  assert.deepEqual(B.sortProducts(P, 'price_high').map((p) => p.id).slice(0, 2), ['5', '6'])
  assert.equal(B.sortProducts(P, 'discount')[0].id, '2')
  assert.equal(B.sortProducts(P, 'newest')[0].id, '2')
  assert.equal(B.sortProducts(P, 'popular')[0].id, '5', 'best rated with most reviews')
  assert.equal(B.sortProducts(P, 'popular').at(-1).id, '4', 'out of stock last')
})

test('filters, their count, and sensible price ranges', () => {
  assert.deepEqual(B.filterProducts(P, { category: 'Clothing' }).map((p) => p.id), ['2', '5', '6'])
  assert.deepEqual(B.filterProducts(P, { price: [0, 500] }).map((p) => p.id), ['1', '3', '4'])
  assert.deepEqual(B.filterProducts(P, { price: [1000, null] }).map((p) => p.id), ['5'])
  assert.deepEqual(B.filterProducts(P, { inStock: true, minDiscount: 30 }).map((p) => p.id), ['1', '2'])
  assert.deepEqual(B.filterProducts(P, { minRating: 4.5 }).map((p) => p.id), ['1', '5'])
  assert.deepEqual(B.filterProducts(P, { brands: ['Penguin'] }).map((p) => p.id), ['3'])
  assert.equal(B.filterCount({ price: [0, 500], inStock: true, brands: [] }), 2)
  const ranges = B.priceRanges(P)
  assert.ok(ranges.length >= 2 && ranges[0][0] === 0 && ranges.at(-1)[1] === null)
  assert.deepEqual(B.priceRanges(P.slice(0, 2)), [], 'too few products for ranges')
})

test('rails: deals, top rated, best of each category', () => {
  assert.deepEqual(B.dealProducts(P).map((p) => p.id), ['2', '1', '5'], 'in stock, 10% or more, biggest first')
  assert.deepEqual(B.topRated(P).map((p) => p.id), ['5', '1', '2'])
  const rails = B.categoryRails(P)
  assert.deepEqual(rails.map((r) => r.category), ['Clothing'], 'only categories with 3 or more products')
})

test('search forgives spelling and suggests categories', () => {
  assert.deepEqual(B.searchProducts(P, 'shampo').map((p) => p.id), ['1'])
  assert.deepEqual(B.searchProducts(P, 'kurthi').map((p) => p.id), ['2'])
  assert.deepEqual(B.searchProducts(P, 'radakrishnan book').map((p) => p.id), ['3'])
  assert.deepEqual(B.searchProducts(P, 'greenleaf').map((p) => p.id), ['1'], 'brand')
  assert.deepEqual(B.searchProducts(P, 'xyzzy'), [])
  assert.equal(B.searchProducts(P, '').length, P.length)
  const s = B.searchSuggestions(P, 'cloth')
  assert.deepEqual(s[0], { kind: 'category', name: 'Clothing' })
  assert.deepEqual(B.searchSuggestions(P, 'c'), [], 'needs 2 letters')
})

test('store products carry MRP, brand and date; the form\'s MRP is saved for the catalog', () => {
  assert.deepEqual(SF.productExtras({ price: 799, created_at: '2026-11-05T00:00:00Z', metadata: { attributes: { list_price: 1599, brand: 'Ethnic' } } }), { mrp: 1599, brand: 'Ethnic', addedAt: '2026-11-05T00:00:00Z' })
  assert.deepEqual(SF.productExtras({ price: 799, metadata: { attributes: { list_price: 700 } } }), {}, 'an MRP below the price is not shown')
  assert.equal(SF.readStorefront({ chat: true }).chat, true)
  assert.equal(SF.readStorefront({}).chat, false)
  assert.equal(CI.parseProductAttributes({ mrp: '1999' }).list_price, 1999)
  assert.equal(CI.parseProductAttributes({ mrp: '' }).list_price, undefined)
  assert.throws(() => CI.parseProductAttributes({ mrp: 'abc' }), /MRP must be a number/)
  const route = read('app/api/commerce/products/route.ts')
  assert.match(route, /const typedMrp = product && 'mrp' in product/)
})

test('the store page uses the new parts', () => {
  const store = read('app/s/[slug]/storefront.tsx')
  for (const part of ['<TrustStrip', '<Rail title="Deals for you"', '<SortTabs', '<FilterPanel', 'title="Sort by"', 'aria-label="Store menu"', 'Price details', 'You save']) assert.ok(store.includes(part) || read('app/s/[slug]/store-parts.tsx').includes(part), part)
  assert.doesNotMatch(store, /typeof window !== 'undefined' \? window\.location\.href/, 'no server / browser mismatch in the WhatsApp link')
})
