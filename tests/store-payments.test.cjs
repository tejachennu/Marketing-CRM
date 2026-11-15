require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const { createHmac } = require('node:crypto')

const S = require('../lib/commerce/storefront.ts')
const R = require('../lib/commerce/store-payments.ts')

const P1 = '11111111-1111-4111-8111-111111111111'
const KEYS = { keyId: 'rzp_test_abc123XYZ', keySecret: 'shop-secret' }

function page(payment, connected) {
  const settings = S.readStorefront({ enabled: true, payment })
  const products = [{ id: P1, title: 'Shirt', description: '', price: 500, currency: 'INR', image: '', category: 'Men', inStock: true }]
  return { organization: { id: 'org-1', name: 'Glow', slug: 'glow', currency: 'INR' }, settings, products, categories: [], fees: { fee: 0, freeFrom: 0 }, pay: S.payOptions(settings, connected) }
}
const order = (pay) => ({ name: 'Priya', phone: '9876543210', pay, items: [{ productId: P1, quantity: 1 }] })

test('Store payment: online is offered only with the business\'s Razorpay connected, and never no way to pay', () => {
  assert.deepEqual(S.payOptions({ payment: 'online' }, false), { online: false, later: true })
  assert.deepEqual(S.payOptions({ payment: 'online' }, true), { online: true, later: false })
  assert.deepEqual(S.payOptions({ payment: 'both' }, true), { online: true, later: true })
  assert.deepEqual(S.payOptions({ payment: 'later' }, true), { online: false, later: true })
  assert.equal(S.readStorefront({ payment: 'card' }).payment, 'later')
})

test('Store payment: the customer\'s choice is checked against the page', () => {
  assert.match(S.parseStoreOrder(order('online'), page('later', true)).error, /not available/)
  assert.match(S.parseStoreOrder(order('later'), page('online', true)).error, /pay online/)
  assert.equal(S.parseStoreOrder(order('online'), page('both', true)).pay, 'online')
  assert.equal(S.parseStoreOrder(order(undefined), page('both', true)).pay, 'later')
  assert.equal(JSON.stringify(S.storeView(page('both', true))).includes('secret'), false)
})

test('Store payment: Razorpay\'s checkout and webhook signatures', () => {
  const sig = createHmac('sha256', KEYS.keySecret).update('order_1|pay_1').digest('hex')
  assert.equal(R.verifyStoreSignature(KEYS.keySecret, 'order_1', 'pay_1', sig), true)
  assert.equal(R.verifyStoreSignature(KEYS.keySecret, 'order_1', 'pay_2', sig), false)
  assert.equal(R.verifyStoreSignature('other', 'order_1', 'pay_1', sig), false)
  const body = '{"event":"payment.captured"}'
  assert.equal(R.verifyStoreWebhook('wh', body, createHmac('sha256', 'wh').update(body).digest('hex')), true)
  assert.equal(R.verifyStoreWebhook('', body, 'x'), false)
  assert.equal(R.isKeyId('rzp_live_Ab12Cd34Ef'), true)
  assert.equal(R.isKeyId('sk_live_123'), false)
  assert.equal(R.storeRazorpayKeys({ store_razorpay_key_id: 'rzp_test_x', store_razorpay_key_secret: '' }), null)
})

test('Store payment: the Razorpay order is for the order total in paise, tied to our order', async () => {
  const calls = []
  const fetcher = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization })
    return new Response(JSON.stringify({ id: 'order_9', amount: 56000, currency: 'INR' }), { status: 200 })
  }
  const made = await R.createStorePayment(KEYS, { id: 'o1', order_number: 'ORD-1', total_amount: 560, currency: 'INR' }, fetcher)
  assert.equal(made.id, 'order_9')
  assert.equal(calls[0].body.amount, 56000)
  assert.equal(calls[0].body.notes.wama_order_id, 'o1')
  assert.equal(calls[0].auth, 'Basic ' + Buffer.from('rzp_test_abc123XYZ:shop-secret').toString('base64'))
  const refused = await R.checkStoreKeys(KEYS, async () => new Response('{"error":{"description":"bad"}}', { status: 401 }))
  assert.match(refused.error, /did not accept these keys/)
})

test('Store payment: an order is marked paid once, and only for the right amount', async () => {
  const rows = { commerce_orders: [{ id: 'o1', organization_id: 'org-1', order_number: 'ORD-1', status: 'payment_pending', payment_status: 'pending', total_amount: 560, currency: 'INR', shipping_address: { handover: 'pickup', payment: { order_id: 'order_9' } } }], commerce_transactions: [], device_tokens: [] }
  const db = {
    from(table) {
      let filters = [], op = 'select', values
      const q = {
        select() { return q }, eq(k, v) { filters.push((r) => r[k] === v); return q }, neq(k, v) { filters.push((r) => r[k] !== v); return q }, in() { return q }, limit() { return q },
        update(v) { op = 'update'; values = v; return q }, insert(v) { op = 'insert'; values = v; return q },
        then(resolve) {
          let hit = rows[table].filter((r) => filters.every((f) => f(r)))
          if (op === 'update') hit.forEach((r) => Object.assign(r, values))
          if (op === 'insert') rows[table].push(values)
          return Promise.resolve({ data: hit, error: null }).then(resolve)
        },
      }
      return q
    },
  }
  const order = { ...rows.commerce_orders[0] }
  assert.equal(await R.markStoreOrderPaid(db, order, { id: 'pay_1', amount: 100 }), false)
  assert.equal(rows.commerce_orders[0].payment_status, 'pending')
  assert.equal(await R.markStoreOrderPaid(db, order, { id: 'pay_1', amount: 56000 }), true)
  assert.equal(rows.commerce_orders[0].status, 'paid')
  assert.equal(rows.commerce_orders[0].payment_method, 'razorpay')
  assert.equal(rows.commerce_orders[0].shipping_address.payment.payment_id, 'pay_1')
  assert.equal(rows.commerce_transactions.length, 1)
  assert.equal(await R.markStoreOrderPaid(db, order, { id: 'pay_1', amount: 56000 }), false)
  assert.equal(rows.commerce_transactions.length, 1)
})

// A tiny stand-in for the database: filters rows of one table by eq() (incl. JSON paths like a->b->>c)
function fakeDb(rows) {
  const read = (row, key) => {
    const m = key.match(/^(\w+)->(\w+)->>(\w+)$/)
    return m ? row[m[1]]?.[m[2]]?.[m[3]] : row[key]
  }
  return {
    from() {
      const filters = []
      const q = {
        select() { return q },
        eq(k, v) { filters.push([k, v]); return q },
        rows() { return rows.filter((r) => filters.every(([k, v]) => String(read(r, k)) === String(v))) },
        maybeSingle() { return Promise.resolve({ data: q.rows()[0] || null }) },
        limit() { return Promise.resolve({ data: q.rows() }) },
      }
      return q
    },
  }
}

test('Store webhook: the order is found from the Razorpay order notes, the payment notes, or the Razorpay order id', async () => {
  const ORDER = { id: '33333333-3333-4333-8333-333333333333', organization_id: 'org1', order_number: 'ORD-1', shipping_address: { payment: { order_id: 'order_RZP1' } } }
  const db = fakeDb([ORDER, { ...ORDER, id: '44444444-4444-4444-8444-444444444444', organization_id: 'org2', order_number: 'ORD-2' }])
  const pay = (notes) => ({ payload: { payment: { entity: { order_id: 'order_RZP1', notes: notes || {} } } } })
  // Razorpay puts our notes on the ORDER entity (order.paid), not on the payment
  const fromOrder = { payload: { payment: { entity: { order_id: 'order_RZP1', notes: [] } }, order: { entity: { notes: { wama_order_id: ORDER.id } } } } }
  assert.equal((await R.findStoreOrder(db, 'org1', fromOrder)).id, ORDER.id)
  assert.equal((await R.findStoreOrder(db, 'org1', pay({ wama_order_number: 'ORD-1' }))).id, ORDER.id)
  // No notes at all (payment.captured): found by the Razorpay order id we kept
  assert.equal((await R.findStoreOrder(db, 'org1', pay())).id, ORDER.id)
  // Never another workspace's order
  assert.equal((await R.findStoreOrder(db, 'org3', pay({ wama_order_id: ORDER.id }))), null)
  // A made-up id is not used as an id
  assert.equal((await R.findStoreOrder(db, 'org1', pay({ wama_order_id: "x' or 1=1" }))).id, ORDER.id)
})

test('Store page: unfinished payments, cancelled orders and Razorpay time limit are handled', () => {
  const fs = require('fs')
  const path = require('path')
  const root = path.join(__dirname, '..')
  const page = fs.readFileSync(path.join(root, 'app/s/[slug]/storefront.tsx'), 'utf8')
  assert.match(page, /store-unpaid:\$\{store\.slug\}/, 'an unfinished payment is kept across a reload')
  assert.match(page, /action: 'check'/, 'and checked with Razorpay when the page opens again')
  assert.match(page, /notes: \{ wama_order_number/, 'checkout passes our order number to Razorpay')
  const pay = fs.readFileSync(path.join(root, 'app/api/public/store/[slug]/pay/route.ts'), 'utf8')
  assert.match(pay, /order\.status === 'canceled' && body\?\.action !== 'check'/, 'no paying for a cancelled order')
  const lib = fs.readFileSync(path.join(root, 'lib/commerce/store-payments.ts'), 'utf8')
  assert.match(lib, /AbortSignal\.timeout\(15000\)/)
  assert.ok(fs.existsSync(path.join(root, 'app/s/[slug]/not-found.tsx')), 'a closed store shows a friendly page')
})

test('Store page: phone numbers are shown in a readable way', () => {
  const { showPhone } = require('../lib/phone-display.ts')
  assert.equal(showPhone('+919876543210'), '+91 98765 43210')
  assert.equal(showPhone('9876543210'), '98765 43210')
  assert.equal(showPhone('+14155550100'), '+14155550100')
})
