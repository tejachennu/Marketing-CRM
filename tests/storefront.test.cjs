require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const S = require('../lib/commerce/storefront.ts')

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const P3 = '33333333-3333-4333-8333-333333333333'

function page(settings = {}) {
  const s = S.readStorefront({ enabled: true, ...settings })
  const products = [
    { id: P1, title: 'Linen shirt', description: '', price: 1499, currency: 'INR', image: 'https://cdn.example.com/shirt.jpg', category: 'Shirts', inStock: true },
    { id: P2, title: 'Silk saree', description: '', price: 4299, currency: 'INR', image: '', category: 'Sarees', inStock: true },
    { id: P3, title: 'Sandals', description: '', price: 999, currency: 'INR', image: '', category: 'Footwear', inStock: false },
  ]
  return { organization: { id: 'org-1', name: 'Glow', slug: 'glow', currency: 'INR' }, settings: s, products, categories: S.storeCategories(s, products), fees: { fee: 60, freeFrom: 1000 }, pay: S.payOptions(s, settings.razorpay === true) }
}

test('Store page: the migration file is the SQL the app runs', () => {
  assert.equal(S.STOREFRONT_SQL, fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261119_storefront.sql'), 'utf8'))
})

test('Store page: settings are cleaned before they are saved or shown', () => {
  const s = S.readStorefront({
    enabled: true, colour: 'red', logo: 'javascript:alert(1)',
    banners: [{ image: 'https://x.com/a.jpg', title: 'Diwali sale', link: 'javascript:alert(1)' }, { image: 'http://insecure.com/b.jpg' }, { title: 'no picture' }],
    categories: [{ name: 'Sarees', image: 'https://x.com/s.jpg' }, { name: 'sarees' }, { name: '' }],
    pickup: false, delivery: false, whatsapp: '98765 43210', min_order: -5,
  })
  assert.equal(s.colour, '#1D5BEA')
  assert.equal(s.logo, '')
  assert.equal(s.banners.length, 1)
  assert.equal(s.banners[0].link, '')
  assert.deepEqual(s.categories.map((c) => c.name), ['Sarees'])
  // A shop always offers a way to get the order
  assert.equal(s.pickup, true)
  assert.equal(s.whatsapp, '+919876543210')
  assert.equal(s.min_order, 0)
  assert.equal(S.readStorefront(null).enabled, false)
})

test('Store page: categories follow the business order, then the rest by name, with a product photo', () => {
  const p = page({ categories: [{ name: 'Sarees', image: 'https://x.com/s.jpg' }] })
  assert.deepEqual(p.categories.map((c) => c.name), ['Sarees', 'Footwear', 'Shirts'])
  assert.equal(p.categories[0].image, 'https://x.com/s.jpg')
  assert.equal(p.categories[2].image, 'https://cdn.example.com/shirt.jpg')
})

test('Store page: an order is checked against the page; prices come from the product list', () => {
  const p = page({ pickup: true, delivery: false, min_order: 1000 })
  assert.match(S.parseStoreOrder({ name: 'A', phone: '9876543210', items: [{ productId: P1, quantity: 1 }] }, p).error, /your name/)
  assert.match(S.parseStoreOrder({ name: 'Priya', phone: '12', items: [{ productId: P1, quantity: 1 }] }, p).error, /mobile number/)
  assert.match(S.parseStoreOrder({ name: 'Priya', phone: '9876543210', items: [] }, p).error, /cart is empty/)
  assert.match(S.parseStoreOrder({ name: 'Priya', phone: '9876543210', items: [{ productId: P3, quantity: 1 }] }, p).error, /out of stock/)
  assert.match(S.parseStoreOrder({ name: 'Priya', phone: '9876543210', items: [{ productId: '99999999-9999-4999-8999-999999999999', quantity: 1 }] }, p).error, /no longer sold/)
  assert.match(S.parseStoreOrder({ name: 'Priya', phone: '9876543210', handover: 'delivery', items: [{ productId: P1, quantity: 1 }] }, p).error, /does not deliver/)
  assert.match(S.parseStoreOrder({ name: 'Priya', phone: '9876543210', items: [{ productId: P1, quantity: 0 }] }, p).error, /between 1 and 99/)
  const ok = S.parseStoreOrder({ name: 'Priya', phone: '9876543210', items: [{ productId: P1, quantity: 2, price: 1 }] }, p)
  assert.equal(ok.subtotal, 2998)
  assert.equal(ok.order.items[0].price, null)
  assert.equal(ok.order.channel, 'website')
  assert.equal(ok.order.paid, false)
  assert.equal(ok.order.handover, 'pickup')
  const small = page({ min_order: 5000 })
  assert.match(S.parseStoreOrder({ name: 'Priya', phone: '9876543210', items: [{ productId: P1, quantity: 1 }] }, small).error, /smallest order/)
})

test('Store page: delivery needs an address, and the charge follows the free-delivery rule', () => {
  const p = page()
  assert.match(S.parseStoreOrder({ name: 'Priya', phone: '9876543210', handover: 'delivery', items: [{ productId: P1, quantity: 1 }], address: { city: 'Hyderabad' } }, p).error, /delivery address/)
  const ok = S.parseStoreOrder({ name: 'Priya', phone: '9876543210', handover: 'delivery', items: [{ productId: P1, quantity: 1 }], address: { address_line_1: 'Flat 3', city: 'Hyderabad' } }, p)
  assert.equal(ok.order.address.city, 'Hyderabad')
  assert.equal(S.deliveryCharge(S.readStorefront({ delivery_fee: 50, free_delivery_from: 1000 }), 999), 50)
  assert.equal(S.deliveryCharge(S.readStorefront({ delivery_fee: 50, free_delivery_from: 1000 }), 1000), 0)
  assert.equal(S.deliveryCharge(S.readStorefront({}), 500, { commerce_default_shipping_fee: 40 }), 40)
})

test('Store page: the public view carries no workspace id', () => {
  const view = S.storeView(page())
  assert.equal(view.slug, 'glow')
  assert.equal(JSON.stringify(view).includes('org-1'), false)
})
