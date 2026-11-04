// Order changes made from the dashboard (PATCH /api/commerce/orders) are noted in the order's chat
// with who made them. Against a fake database and a fake session; nothing reaches the network.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const ORG = '55555555-5555-4555-8555-555555555555'
const ORDER = '11111111-1111-4111-8111-111111111111'
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

let user = { full_name: 'Asha Rao', email: 'asha@example.com' }
let tables = {}
function reset(order = {}) {
  tables = {
    commerce_orders: [{
      id: ORDER, organization_id: ORG, order_number: 'ORD-261013-AB12', status: 'payment_pending', payment_status: 'pending', payment_method: null,
      conversation_id: 'conversation-1', shipping_address: null, currency: 'INR', total_amount: 1040, ...order,
    }],
    organizations: [{ id: ORG, currency: 'INR' }],
    messages: [],
  }
}

// The few query shapes the route uses, over plain arrays; every filter is applied
const fakeDb = {
  from(table) {
    const rows = () => tables[table] || (tables[table] = [])
    const filters = []
    let op = 'select', values, singular = false
    const query = {
      select() { return query }, order() { return query }, range() { return query }, limit() { return query },
      eq(key, value) { filters.push(row => row[key] === value); return query },
      in(key, list) { filters.push(row => list.includes(row[key])); return query },
      maybeSingle() { singular = true; return query }, single() { singular = true; return query },
      update(data) { op = 'update'; values = data; return query },
      insert(data) { op = 'insert'; values = Array.isArray(data) ? data : [data]; return query },
      then(resolve, reject) {
        let matched = rows().filter(row => filters.every(filter => filter(row)))
        if (op === 'update') matched.forEach(row => Object.assign(row, values))
        if (op === 'insert') { matched = values.map(value => ({ id: `m${rows().length + 1}`, ...value })); rows().push(...matched) }
        // Copies, as Supabase returns them: a row read earlier does not change under the route
        return Promise.resolve({ data: structuredClone(singular ? matched[0] || null : matched), error: null, count: matched.length }).then(resolve, reject)
      },
    }
    return query
  },
}
stub(path.join(PROJECT, 'lib/api-auth-helper.ts'), { verifyOrgAccess: async () => ({ authorized: true, user }) })
stub(require.resolve('@supabase/supabase-js', { paths: [PROJECT] }), { createClient: () => fakeDb })
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'
console.error = () => {}

const route = require(path.join(PROJECT, 'app/api/commerce/orders/route.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))
const patch = (body) => route.PATCH(new NextRequest('https://wamacrm.example.com/api/commerce/orders', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: ORDER, organizationId: ORG, ...body }),
}))
const noted = () => tables.messages.map(message => message.body)

test('Order changes from the dashboard are noted in the order\'s chat, with who made them', async () => {
  reset()
  let res = await patch({ status: 'paid' })
  assert.equal(res.status, 200)
  assert.deepEqual(tables.messages, [{ id: 'm1', organization_id: ORG, conversation_id: 'conversation-1', sender_type: 'user', body: '[Order #ORD-261013-AB12 marked paid by Asha Rao]', status: 'sent' }])
  assert.deepEqual([tables.commerce_orders[0].status, tables.commerce_orders[0].payment_status, tables.commerce_orders[0].payment_method], ['paid', 'paid', 'manual'])

  res = await patch({ status: 'shipped', trackingNumber: 'AWB123', carrier: 'Delhivery' })
  assert.equal(res.status, 200)
  assert.deepEqual(noted().slice(1), ['[Order #ORD-261013-AB12 marked shipped by Asha Rao]'])

  // A refund from the dashboard
  res = await patch({ paymentStatus: 'refunded' })
  assert.equal(res.status, 200)
  assert.deepEqual(noted().slice(2), ['[Order #ORD-261013-AB12 payment marked refunded by Asha Rao]'])

  // Nothing about the status or payment changed: nothing noted
  res = await patch({ customerNote: 'Leave at the door' })
  assert.equal(res.status, 200)
  res = await patch({ paymentStatus: 'refunded' })
  assert.equal(res.status, 200)
  assert.equal(noted().length, 3)
})

test('Order changes: one line when marking paid also sets the payment; the email when there is no name; no chat, no line', async () => {
  reset()
  let res = await patch({ status: 'paid', paymentStatus: 'paid' })
  assert.equal(res.status, 200)
  assert.deepEqual(noted(), ['[Order #ORD-261013-AB12 marked paid by Asha Rao]'])

  reset()
  user = { full_name: null, email: 'ravi@example.com' }
  res = await patch({ status: 'cod_confirmed' })
  assert.equal(res.status, 200)
  assert.deepEqual(noted(), ['[Order #ORD-261013-AB12 marked confirmed for Cash on Delivery by ravi@example.com]'])
  user = { full_name: 'Asha Rao', email: 'asha@example.com' }

  reset({ conversation_id: null })
  res = await patch({ status: 'paid' })
  assert.equal(res.status, 200)
  assert.deepEqual(noted(), [])

  // A change the order's status does not allow is refused before anything is noted
  reset({ status: 'delivered', payment_status: 'paid' })
  res = await patch({ status: 'paid' })
  assert.equal(res.status, 409)
  assert.deepEqual(noted(), [])
})
