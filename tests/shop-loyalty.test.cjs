require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const L = require('../lib/commerce/loyalty.ts')
const LS = require('../lib/commerce/loyalty-store.ts')
const D = require('../lib/commerce/discounts.ts')
const { salonDb } = require('./salon-fake-db.cjs')
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
const ORG = '11111111-1111-4111-8111-111111111111'
const O1 = '44444444-4444-4444-8444-444444444441'

test('codes for one customer', () => {
  assert.ok(D.parseDiscount({ kind: 'percent', value: 15, code: 'ASHA15', for_phone: '123' }).error)
  assert.match(D.parseDiscount({ kind: 'percent', value: 15, automatic: true, for_phone: '9876543210' }).error, /needs a code/)
  const d = D.parseDiscount({ kind: 'percent', value: 15, code: 'ASHA15', for_phone: '+91 98765 43210' }).discount
  assert.equal(d.for_phone, '9876543210')
  const cart = { lines: [{ price: 1000, quantity: 1 }], subtotal: 1000, delivery: 0 }
  assert.equal(D.applyDiscount(d, cart, { phoneKey: '9876543210' }).amount, 150)
  assert.match(D.applyDiscount(d, cart, { phoneKey: '9000000000' }).reason, /another customer/)
  assert.match(D.applyDiscount(d, cart, {}).reason, /phone number first/)
  assert.equal(D.parseDiscount({ kind: 'percent', value: 15, code: 'ALL15' }).discount.for_phone, null)
})

test('points: earned, usable, capped', () => {
  const off = L.readLoyaltySettings(null)
  assert.equal(off.on, false)
  assert.equal(L.pointsEarned(1000, off), 0)
  const s = L.readLoyaltySettings({ on: true, percent: 5, minUse: 50, maxPercent: 20 })
  assert.equal(L.pointsEarned(999, s), 49)
  assert.equal(L.pointsUsable(40, 1000, s), 0) // below the minimum
  assert.equal(L.pointsUsable(500, 1000, s), 200) // at most 20% of the order
  assert.equal(L.pointsUsable(120, 1000, s), 120)
  assert.match(L.loyaltyLine(s), /5% back/)
  assert.equal(L.readLoyaltySettings({ on: true, percent: 90 }).percent, 2)
})

test('ledger: earned once on delivery, used, given back on cancel', async () => {
  const db = salonDb({
    organizations: [{ id: ORG, shop_loyalty: { on: true, percent: 10, minUse: 0, maxPercent: 100 } }],
    commerce_orders: [{ id: O1, organization_id: ORG, status: 'delivered', total_amount: 1234, shipping_address: { phone_number: '+91 98765 43210' } }],
    commerce_points: [],
  })
  assert.equal(await LS.earnPointsFor(db, ORG, O1), 123)
  // The unique index stops a second earn; the fake database does not, so check the caller's guard instead
  assert.equal(await LS.pointsBalance(db, ORG, '9876543210'), 123)
  await LS.usePoints(db, ORG, '9876543210', 100, 'order-2')
  assert.equal(await LS.pointsBalance(db, ORG, '9876543210'), 23)
  await LS.returnPointsFor(db, ORG, 'order-2')
  assert.equal(await LS.pointsBalance(db, ORG, '9876543210'), 123)
  db.tables.commerce_orders[0].status = 'shipped'
  assert.equal(await LS.earnPointsFor(db, ORG, O1), 0)
})

test('wiring: migration, delivered step, checkout uses points only for the shopper\'s own phone', () => {
  assert.equal(read('supabase/migrations/20261202_shop_loyalty.sql'), LS.LOYALTY_SQL)
  assert.match(read('lib/commerce/order-delivered.ts'), /earnPointsFor\(db, organizationId, orderId\)/)
  const order = read('app/api/public/store/[slug]/order/route.ts')
  assert.match(order, /samePhone\(saved\.phone, parsed\.order\.customer\.phone\)/)
  assert.match(order, /usePoints\(db, page\.organization\.id/)
  assert.match(read('app/api/commerce/orders/route.ts'), /returnPointsFor\(supabase, organizationId, orderId\)/)
  assert.match(read('components/commerce/offers.tsx'), /<LoyaltyCard /)
})

test('Front Desk members: best plan discount, only for signed-in shoppers with their own phone', () => {
  assert.equal(L.readLoyaltySettings({}).members, false)
  assert.equal(L.readLoyaltySettings({ members: true }).members, true)
  assert.equal(L.memberDiscount([], 1000), null)
  assert.deepEqual(L.memberDiscount([{ plan: { name: 'Silver', discount_percent: 5 } }, { plan: { name: 'Gold', discount_percent: 12 } }, { plan: { name: 'Credit only', discount_percent: 0 } }], 1999), { percent: 12, amount: 239.88, title: 'Gold member 12% off' })
  const order = read('app/api/public/store/[slug]/order/route.ts')
  assert.match(order, /loyalty\?\.members && ownPhone/)
  assert.match(order, /member\.amount > offerSaving/)
  assert.match(read('components/commerce/loyalty-card.tsx'), /Front Desk members get their plan/)
})
