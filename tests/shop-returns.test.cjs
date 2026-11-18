require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const R = require('../lib/commerce/returns.ts')
const RS = require('../lib/commerce/returns-store.ts')
const { salonDb } = require('./salon-fake-db.cjs')
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
const ORG = '11111111-1111-4111-8111-111111111111'
const O1 = '44444444-4444-4444-8444-444444444441'
const V1 = '55555555-5555-4555-8555-555555555551'
const NOW = new Date('2026-11-18T10:00:00Z')

test('return window, reasons, refundable amounts', () => {
  assert.deepEqual(R.readReturnSettings(null), { on: false, days: 7 })
  assert.deepEqual(R.readReturnSettings({ on: true, days: '10' }), { on: true, days: 10 })
  assert.equal(R.readReturnSettings({ days: 500 }).days, 7)
  const on = { on: true, days: 7 }
  const delivered = { status: 'delivered', shipping_address: { delivered_at: '2026-11-15T10:00:00Z' } }
  assert.equal(R.returnChance(delivered, on, NOW).ok, true)
  assert.match(R.returnChance(delivered, { on: false, days: 7 }, NOW).reason, /does not take returns/)
  assert.match(R.returnChance({ status: 'shipped', shipping_address: {} }, on, NOW).reason, /once the order is delivered/)
  assert.match(R.returnChance(delivered, { on: true, days: 2 }, NOW).reason, /within 2 days/)
  assert.match(R.returnChance({ ...delivered, shipping_address: { ...delivered.shipping_address, return: { status: 'asked' } } }, on, NOW).reason, /already asked/)
  assert.equal(R.cleanReturnRequest({ reason: 'nope' }).error, 'Choose why you are returning it.')
  assert.ok(R.cleanReturnRequest({ reason: 'Something else' }).error)
  assert.deepEqual(R.cleanReturnRequest({ reason: 'Damaged or broken', note: '  box  torn ' }, NOW), { status: 'asked', reason: 'Damaged or broken', note: 'box torn', asked_at: NOW.toISOString() })
  assert.deepEqual(R.refundable({ payment_status: 'paid', total_amount: 1000 }, [{ amount: 300 }, { amount: 100, status: 'failed' }]), { paid: 1000, refunded: 300, left: 700 })
  assert.equal(R.refundable({ payment_status: 'pending', total_amount: 1000 }).left, 0)
  assert.ok(R.parseRefund({ amount: 800 }, 700).error)
  assert.ok(R.parseRefund({ amount: 0 }, 700).error)
  assert.deepEqual(R.parseRefund({ amount: '250.555', reason: 'Late', restock: true }, 700), { amount: 250.56, reason: 'Late', restock: true })
})

function shop(order) {
  return salonDb({
    organizations: [{ id: ORG, name: 'Asha Silks', store_razorpay_key_id: 'rzp_test_abcdef123', store_razorpay_key_secret: 'secret' }],
    commerce_orders: [{ id: O1, organization_id: ORG, order_number: 'W-1', status: 'delivered', currency: 'INR', total_amount: 1000, ...order }],
    commerce_order_items: [{ order_id: O1, variant_id: V1, quantity: 2 }],
    commerce_product_variants: [{ id: V1, organization_id: ORG, stock: 3 }],
    commerce_refunds: [],
  })
}

test('online refund goes through Razorpay; part, then the rest; return marked refunded', async () => {
  const db = shop({ payment_method: 'razorpay', payment_status: 'paid', shipping_address: { payment: { payment_id: 'pay_123' }, return: { status: 'accepted', reason: 'Damaged or broken', note: '', asked_at: NOW.toISOString() } } })
  const calls = []
  const fetcher = async (url, init) => { calls.push([url, JSON.parse(init.body)]); return { ok: true, json: async () => ({ id: 'rfnd_1', status: 'processed' }) } }
  const org = db.tables.organizations[0]
  let res = await RS.refundOrder(db, org, db.tables.commerce_orders[0], { amount: 400, reason: 'Damaged', restock: false }, fetcher)
  assert.equal(res.method, 'razorpay')
  assert.equal(res.left, 600)
  assert.equal(calls[0][0], 'https://api.razorpay.com/v1/payments/pay_123/refund')
  assert.equal(calls[0][1].amount, 40000)
  let order = db.tables.commerce_orders[0]
  assert.equal(order.payment_status, 'paid')
  assert.equal(order.shipping_address.refunded_amount, 400)
  assert.equal(order.shipping_address.return.status, 'refunded')
  assert.equal(db.tables.commerce_refunds[0].razorpay_refund_id, 'rfnd_1')
  res = await RS.refundOrder(db, org, order, { amount: 600, reason: '', restock: false }, fetcher)
  assert.equal(res.left, 0)
  assert.equal(db.tables.commerce_orders[0].payment_status, 'refunded')
  res = await RS.refundOrder(db, org, db.tables.commerce_orders[0], { amount: 1, reason: '', restock: false }, fetcher)
  assert.ok(res.error)
})

test('Razorpay refusing → nothing recorded; cash order → recorded by hand, stock back', async () => {
  const db = shop({ payment_method: 'razorpay', payment_status: 'paid', shipping_address: { payment: { payment_id: 'pay_9' } } })
  const refused = async () => ({ ok: false, status: 400, json: async () => ({ error: { description: 'The amount is more than what was paid' } }) })
  const res = await RS.refundOrder(db, db.tables.organizations[0], db.tables.commerce_orders[0], { amount: 100, reason: '', restock: true }, refused)
  assert.match(res.error, /Razorpay did not make the refund: The amount is more/)
  assert.equal(db.tables.commerce_refunds.length, 0)

  const cash = shop({ payment_method: 'cod', payment_status: 'paid', shipping_address: {} })
  const done = await RS.refundOrder(cash, cash.tables.organizations[0], cash.tables.commerce_orders[0], { amount: 1000, reason: 'Returned', restock: true }, async () => { throw new Error('must not call Razorpay') })
  assert.equal(done.method, 'manual')
  assert.equal(cash.tables.commerce_orders[0].payment_status, 'refunded')
  assert.equal(cash.tables.commerce_refunds[0].restocked, true)
})

test('asking and answering a return', async () => {
  const db = shop({ payment_status: 'paid', shipping_address: { full_name: 'Ravi' } })
  await RS.askReturn(db, db.tables.commerce_orders[0], { status: 'asked', reason: 'Wrong item sent', note: '', asked_at: NOW.toISOString() })
  assert.equal(db.tables.commerce_orders[0].shipping_address.return.status, 'asked')
  assert.equal(db.tables.commerce_orders[0].shipping_address.full_name, 'Ravi')
  const res = await RS.decideReturn(db, ORG, O1, 'declined', 'Opened and used')
  assert.equal(res.return.status, 'declined')
  assert.equal(res.return.decline_note, 'Opened and used')
  assert.ok((await RS.decideReturn(db, ORG, O1, 'accepted')).error)
})

test('wiring: migration, routes, screens, refund message', () => {
  assert.equal(read('supabase/migrations/20261201_shop_returns.sql'), RS.RETURNS_SQL)
  assert.match(read('components/commerce/orders-tab.tsx'), /<OrderReturns /)
  assert.match(read('app/dashboard/commerce/page.tsx'), /<ReturnsSettingsCard /)
  assert.match(read('app/s/[slug]/account.tsx'), /<ReturnBox /)
  assert.match(read('app/api/public/store/[slug]/return/route.ts'), /returnChance\(order/)
  assert.match(read('lib/commerce/shop-messages.ts'), /refund_update/)
})
