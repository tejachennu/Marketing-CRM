require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const D = require('../lib/commerce/discounts.ts')
const DS = require('../lib/commerce/discount-store.ts')
const { salonDb } = require('./salon-fake-db.cjs')
const ORG = '11111111-1111-4111-8111-111111111111'
const root = path.join(__dirname, '..')

const offer = (raw) => { const p = D.parseDiscount(raw); if ('error' in p) throw new Error(p.error); return p.discount }
const cart = (lines, delivery = 60) => ({ lines, subtotal: lines.reduce((s, l) => s + l.price * l.quantity, 0), delivery })

test('offers are checked as typed, with plain titles', () => {
  assert.equal(D.cleanCode(' diwali 10! '), 'DIWALI10')
  assert.equal(D.cleanCode('ab'), null)
  assert.match(D.parseDiscount({ kind: 'percent', code: 'X' }).error, /3 to 20 letters/)
  assert.match(D.parseDiscount({ kind: 'percent', code: 'SAVE', value: 120 }).error, /between 1 and 100/)
  assert.match(D.parseDiscount({ kind: 'buy_get', automatic: true, buy_qty: 0, get_qty: 1 }).error, /how many to buy/)
  assert.match(D.parseDiscount({ kind: 'flat', code: 'FLAT', value: 50, starts_at: '2026-12-01', ends_at: '2026-11-01' }).error, /end must be after/)
  assert.equal(offer({ kind: 'percent', code: 'diwali10', value: 10 }).title, '10% off')
  assert.equal(offer({ kind: 'flat', code: 'FLAT200', value: 200, min_order: 999 }).title, '₹200 off on ₹999 or more')
  assert.equal(offer({ kind: 'free_delivery', automatic: true, min_order: 999 }).title, 'Free delivery on ₹999 or more')
  assert.equal(offer({ kind: 'buy_get', automatic: true, buy_qty: 2, get_qty: 1 }).title, 'Buy 2 get 1 free')
  assert.equal(offer({ kind: 'buy_get', automatic: true, buy_qty: 2, get_qty: 1 }).code, null, 'applies by itself')
})

test('what each offer takes off, and why it does not apply', () => {
  const now = Date.parse('2026-11-20T10:00:00Z')
  const pct = offer({ kind: 'percent', code: 'TEN', value: 10 })
  assert.deepEqual(D.applyDiscount(pct, cart([{ price: 500, quantity: 2 }]), { now }), { ok: true, amount: 100, freeDelivery: false, title: '10% off', code: 'TEN' })
  const flat = offer({ kind: 'flat', code: 'FLAT', value: 200, min_order: 999 })
  assert.match(D.applyDiscount(flat, cart([{ price: 900, quantity: 1 }]), { now }).reason, /Add ₹99 more/)
  assert.equal(D.applyDiscount(flat, cart([{ price: 1000, quantity: 1 }]), { now }).amount, 200)
  const free = offer({ kind: 'free_delivery', automatic: true, min_order: 999 })
  const r = D.applyDiscount(free, cart([{ price: 1200, quantity: 1 }], 60), { now })
  assert.equal(r.freeDelivery, true)
  assert.equal(D.saving(r, 60), 60)
  const b2g1 = offer({ kind: 'buy_get', automatic: true, buy_qty: 2, get_qty: 1 })
  assert.equal(D.applyDiscount(b2g1, cart([{ price: 300, quantity: 2 }, { price: 100, quantity: 1 }]), { now }).amount, 100, 'the cheapest is free')
  assert.equal(D.applyDiscount(b2g1, cart([{ price: 300, quantity: 6 }]), { now }).amount, 600, 'two groups of three: two free')
  assert.match(D.applyDiscount(b2g1, cart([{ price: 300, quantity: 2 }]), { now }).reason, /Add 1 more item to get 1 free/)
  const first = offer({ kind: 'percent', code: 'FIRST', value: 15, first_order_only: true })
  assert.match(D.applyDiscount(first, cart([{ price: 100, quantity: 1 }]), { now, orderedBefore: true }).reason, /first order only/)
  const once = offer({ kind: 'percent', code: 'ONCE', value: 5, once_per_phone: true })
  assert.match(D.applyDiscount(once, cart([{ price: 100, quantity: 1 }]), { now, usedByPhone: true }).reason, /already used/)
  const ended = offer({ kind: 'percent', code: 'OLD', value: 5, ends_at: '2026-11-01T00:00:00Z' })
  assert.match(D.applyDiscount(ended, cart([{ price: 100, quantity: 1 }]), { now }).reason, /ended/)
  const later = offer({ kind: 'percent', code: 'SOON', value: 5, starts_at: '2026-12-01T00:00:00Z' })
  assert.match(D.applyDiscount(later, cart([{ price: 100, quantity: 1 }]), { now }).reason, /not started/)
  assert.match(D.applyDiscount({ ...pct, max_uses: 3, uses: 3 }, cart([{ price: 100, quantity: 1 }]), { now }).reason, /used up/)
  assert.equal(D.applyDiscount(offer({ kind: 'flat', code: 'BIG', value: 5000 }), cart([{ price: 300, quantity: 1 }]), { now }).amount, 300, 'never more than the items')
})

test('the best offer that applies by itself wins; codes never apply by themselves', () => {
  const offers = [offer({ kind: 'free_delivery', automatic: true }), offer({ kind: 'percent', automatic: true, value: 10, min_order: 2000 }), offer({ kind: 'percent', code: 'SECRET', value: 50 })]
  assert.equal(D.bestAutomatic(offers, cart([{ price: 500, quantity: 1 }], 60)).title, 'Free delivery')
  assert.equal(D.bestAutomatic(offers, cart([{ price: 2500, quantity: 1 }], 60)).title, '10% off on ₹2,000 or more')
  assert.equal(D.bestAutomatic(offers, cart([{ price: 500, quantity: 1 }], 0)), null, 'free delivery saves nothing on a pick-up')
})

test('saved offers: typed code decided on the server, use counted, once per phone', async () => {
  const db = salonDb({ commerce_discounts: [
    { id: 'd1', organization_id: ORG, title: '10% off', code: 'TEN', kind: 'percent', value: 10, min_order: 0, uses: 0, once_per_phone: true, active: true, created_at: '1' },
    { id: 'd2', organization_id: ORG, title: 'Free delivery', code: null, kind: 'free_delivery', value: 0, min_order: 0, uses: 0, active: true, created_at: '2' },
  ], commerce_discount_uses: [], contacts: [], commerce_orders: [] })
  const c = cart([{ price: 500, quantity: 2 }], 60)
  assert.match((await DS.decideDiscount(db, ORG, 'NOPE', c, '+919876543210')).reason, /code is not right/)
  const got = await DS.decideDiscount(db, ORG, 'ten', c, '+919876543210')
  assert.equal(got.ok, true)
  assert.equal(got.amount, 100)
  await DS.recordDiscountUse(db, ORG, got.discount, 'o1', '+919876543210', 100)
  assert.equal(db.tables.commerce_discounts[0].uses, 1)
  assert.equal(db.tables.commerce_discount_uses[0].phone_key, '9876543210')
  assert.match((await DS.decideDiscount(db, ORG, 'TEN', c, '+91 98765 43210')).reason, /already used/)
  assert.equal((await DS.decideDiscount(db, ORG, '', c, '+919876543210')).title, 'Free delivery', 'no code: the offer that applies by itself')
  assert.deepEqual(DS.publicOffers(db.tables.commerce_discounts.map(DS.rowToDiscount)), [{ title: 'Free delivery', kind: 'free_delivery', min_order: 0 }])
})

test('orders keep the discount; the total takes it off; free delivery waives the charge', async () => {
  const { createManualOrder } = require('../lib/commerce/manual-order.ts')
  const P1 = '22222222-2222-4222-8222-222222222222'
  const db = salonDb({ commerce_products: [{ id: P1, organization_id: ORG, retailer_id: 'A', title: 'Saree', price: 1000 }], commerce_orders: [], commerce_order_items: [] })
  const base = { channel: 'website', customer: { contactId: null, name: '', phone: null }, items: [{ productId: P1, title: '', price: null, quantity: 1 }], paid: false, paymentMethod: null, address: { address_line_1: 'x', city: 'y' }, note: null }
  const made = await createManualOrder(db, { id: ORG }, { ...base, handover: 'delivery', shippingFee: 60, discount: { code: 'TEN', title: '10% off', amount: 100, freeDelivery: false } }, async () => 'W-1')
  assert.equal(made.order.total_amount, 960)
  assert.equal(made.order.discount_code, 'TEN')
  assert.equal(made.order.discount_amount, 100)
  const free = await createManualOrder(db, { id: ORG }, { ...base, handover: 'delivery', shippingFee: 60, discount: { code: null, title: 'Free delivery', amount: 0, freeDelivery: true } }, async () => 'W-2')
  assert.equal(free.order.shipping_fee, 0)
  assert.equal(free.order.total_amount, 1000)
  assert.equal(free.order.discount_code, 'Free delivery')
})

test('wiring: store order decides on the server, checkout has the code box, Offers tab, migration', () => {
  assert.equal(fs.readFileSync(path.join(root, 'supabase/migrations/20261125_shop_discounts.sql'), 'utf8'), DS.DISCOUNT_SQL)
  const route = fs.readFileSync(path.join(root, 'app/api/public/store/[slug]/order/route.ts'), 'utf8')
  assert.match(route, /decideDiscount\(db, page\.organization\.id, body\?\.code/)
  assert.match(route, /recordDiscountUse\(/)
  const store = fs.readFileSync(path.join(root, 'app/s/[slug]/storefront.tsx'), 'utf8')
  assert.match(store, /aria-label="Discount code"/)
  assert.match(store, /\{pay === 'online' \? `Pay \$\{money\(toPay\)\}`/)
  const page = fs.readFileSync(path.join(root, 'app/dashboard/commerce/page.tsx'), 'utf8')
  assert.match(page, /<Offers orgId=\{orgId\}/)
})
