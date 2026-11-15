require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const M = require('../lib/commerce/manual-order.ts')
const U = require('../lib/commerce/commerce-utils.ts')

const PRODUCT = '11111111-1111-4111-8111-111111111111'
const CONTACT = '22222222-2222-4222-8222-222222222222'

/** A small stand-in for the tables an order touches. */
function db(seed = {}) {
  const tables = { commerce_products: [], contacts: [], conversations: [], commerce_orders: [], commerce_order_items: [], ...seed }
  let n = 0
  const from = (table) => {
    let filters = [], op = 'select', values, single = false
    const q = {
      select() { return q }, eq(k, v) { filters.push((r) => r[k] === v); return q }, in(k, list) { filters.push((r) => list.includes(r[k])); return q },
      or() { filters.push(() => false); return q }, order() { return q }, limit() { return q },
      maybeSingle() { single = true; return q }, single() { single = true; return q },
      insert(data) { op = 'insert'; values = data; return q }, delete() { op = 'delete'; return q },
      then(resolve, reject) {
        let rows = tables[table].filter((r) => filters.every((f) => f(r)))
        if (op === 'insert') {
          rows = (Array.isArray(values) ? values : [values]).map((v) => ({ id: `id-${++n}`, ...v }))
          tables[table].push(...rows)
        } else if (op === 'delete') tables[table] = tables[table].filter((r) => !rows.includes(r))
        return Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(resolve, reject)
      },
    }
    return q
  }
  return { from, tables }
}
const number = async () => 'ORD-TEST-1'
const ORG = { id: 'org-1', currency: 'INR', commerce_default_shipping_fee: 60, commerce_free_shipping_threshold: 1000 }

test('Hand-made order: what has to be given', () => {
  assert.match(M.parseManualOrder({ channel: 'shop', handover: 'now' }).error, /where the order came from/)
  assert.match(M.parseManualOrder({ channel: 'in_store', handover: 'now', items: [] }).error, /at least one item/)
  assert.match(M.parseManualOrder({ channel: 'phone', handover: 'now', items: [{ title: 'Tea', price: 10 }] }).error, /phone order cannot be handed over now/)
  assert.match(M.parseManualOrder({ channel: 'phone', handover: 'pickup', items: [{ title: 'Tea', price: 10 }] }).error, /phone number/)
  assert.match(M.parseManualOrder({ channel: 'in_store', handover: 'now', items: [{ title: 'Tea', price: 10 }], paid: false }).error, /must be paid now/)
  assert.match(M.parseManualOrder({ channel: 'in_store', handover: 'now', items: [{ title: 'Tea', price: 10 }], paid: true }).error, /cash, UPI or card/)
  assert.match(M.parseManualOrder({ channel: 'phone', handover: 'delivery', customer: { phone: '9876543210' }, items: [{ title: 'Tea', price: 10 }], paid: false, address: { city: 'Hyderabad' } }).error, /delivery address/)
  assert.match(M.parseManualOrder({ channel: 'in_store', handover: 'now', items: [{ title: 'Tea' }], paid: true, paymentMethod: 'cash' }).error, /name and a price/)
  const ok = M.parseManualOrder({ channel: 'in_store', handover: 'now', items: [{ title: 'Tea', price: '10', quantity: 2 }], paid: true, paymentMethod: 'upi' })
  assert.equal(ok.order.items[0].price, 10)
  assert.equal(ok.order.customer.contactId, null)
})

test('Hand-made order: where it starts', () => {
  assert.equal(M.startStatus({ handover: 'now', paid: true }), 'delivered')
  assert.equal(M.startStatus({ handover: 'delivery', paid: true }), 'paid')
  assert.equal(M.startStatus({ handover: 'pickup', paid: false }), 'cod_confirmed')
  // Paid or Cash on Delivery orders can be marked delivered straight away (handed over in the shop, picked up)
  assert.equal(U.canTransitionOrder('cod_confirmed', 'delivered'), true)
  assert.equal(U.canTransitionOrder('paid', 'delivered'), true)
})

test('Hand-made order: a walk-in sale paid in cash, with a product from the list and a typed item', async () => {
  const d = db({ commerce_products: [{ id: PRODUCT, organization_id: 'org-1', retailer_id: 'SHIRT-1', title: 'Linen shirt', price: 1499, image_url: null }] })
  const parsed = M.parseManualOrder({ channel: 'in_store', handover: 'now', paid: true, paymentMethod: 'cash', items: [{ productId: PRODUCT, quantity: 2 }, { title: 'Alteration', price: 150 }] })
  const { order } = await M.createManualOrder(d, ORG, parsed.order, number)
  assert.equal(order.status, 'delivered')
  assert.equal(order.checkout_type, 'in_store')
  assert.equal(order.payment_status, 'paid')
  assert.equal(order.payment_method, 'cash')
  assert.equal(order.total_amount, 3148)
  assert.equal(order.contact_id, null)
  assert.deepEqual(d.tables.commerce_order_items.map((i) => [i.title, i.quantity, i.total_price]), [['Linen shirt', 2, 2998], ['Alteration', 1, 150]])
})

test('Hand-made order: a phone order for delivery saves the customer and charges delivery under the free limit', async () => {
  const d = db()
  const parsed = M.parseManualOrder({ channel: 'phone', handover: 'delivery', paid: false, customer: { name: 'Priya Sharma', phone: '9876543210' }, items: [{ title: 'Saree', price: 800 }], address: { address_line_1: 'Flat 3, Lake View', city: 'Hyderabad' } })
  const { order } = await M.createManualOrder(d, ORG, parsed.order, number)
  assert.equal(order.status, 'cod_confirmed')
  assert.equal(order.payment_method, 'cod')
  assert.equal(order.shipping_fee, 60)
  assert.equal(order.total_amount, 860)
  assert.equal(order.shipping_address.handover, 'delivery')
  assert.equal(d.tables.contacts[0].first_name, 'Priya')
  assert.equal(d.tables.contacts[0].phone_number, '+919876543210')
  assert.equal(order.contact_id, d.tables.contacts[0].id)
})

test('Hand-made order: a picked customer from another workspace is refused', async () => {
  const parsed = M.parseManualOrder({ channel: 'phone', handover: 'pickup', paid: false, customer: { contactId: CONTACT }, items: [{ title: 'Tea', price: 10 }] })
  const out = await M.createManualOrder(db(), ORG, parsed.order, number)
  assert.match(out.error, /not in your contacts/)
})
