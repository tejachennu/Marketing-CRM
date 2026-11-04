// Order changes made from the dashboard (PATCH /api/commerce/orders) are noted in the order's chat
// with who made them, settle stock, withdraw a live payment request and tell the customer. Against
// a fake database, a fake session and a fake WhatsApp; nothing reaches the network.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const ORG = '55555555-5555-4555-8555-555555555555'
const ORDER = '11111111-1111-4111-8111-111111111111'
const CONTACT = '22222222-2222-4222-8222-222222222222'
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

let user = { full_name: 'Asha Rao', email: 'asha@example.com' }
let tables = {}
let missingColumns = {}
let calls = []
// What would go to WhatsApp, instead of calling Meta
let sent = []
function reset(order = {}, extra = {}) {
  missingColumns = {}
  calls = []
  sent = []
  tables = {
    commerce_orders: [{
      id: ORDER, organization_id: ORG, order_number: 'ORD-261013-AB12', status: 'payment_pending', payment_status: 'pending', payment_method: null,
      contact_id: CONTACT, conversation_id: 'conversation-1', shipping_address: null, currency: 'INR', total_amount: 1040, created_at: '2026-10-13T09:00:00.000Z', ...order,
    }],
    commerce_order_items: [],
    commerce_products: [],
    contacts: [{ id: CONTACT, organization_id: ORG, first_name: 'Asha', last_name: 'Rao', phone_number: '+919876543210' }],
    organizations: [{ id: ORG, currency: 'INR', whatsapp_api_token: 'token', whatsapp_phone_number_id: '111' }],
    messages: [],
    ...extra,
  }
}

// The query shapes the route and the handlers use, over plain arrays; every filter is applied.
// Orders come back with their items and their contact, as the route's select asks for them.
const fakeDb = {
  from(table) {
    const rows = () => tables[table] || (tables[table] = [])
    const filters = []
    let op = 'select', values, singular = false, head = false, sorts = []
    const query = {
      select(columns, options = {}) { head = Boolean(options.head); return query },
      order(key, options = {}) { sorts.push([key, options.ascending === false ? -1 : 1]); return query },
      range() { return query }, limit() { return query },
      eq(key, value) { filters.push(row => row[key] === value); return query },
      neq(key, value) { filters.push(row => row[key] !== value); return query },
      in(key, list) { filters.push(row => list.includes(row[key])); return query },
      is(key, value) { filters.push(row => (value === null ? row[key] == null : row[key] === value)); return query },
      not(key, operator, value) { filters.push(row => (operator === 'is' && value === null ? row[key] != null : row[key] !== value)); return query },
      maybeSingle() { singular = true; return query }, single() { singular = true; return query },
      update(data) { op = 'update'; values = data; return query },
      insert(data) { op = 'insert'; values = Array.isArray(data) ? data : [data]; return query },
      then(resolve, reject) {
        calls.push(`${op} ${table}`)
        const written = op === 'update' ? [values] : op === 'insert' ? values : []
        const unknown = (missingColumns[table] || []).find(column => written.some(value => column in value))
        if (unknown) return Promise.resolve({ data: null, error: { code: 'PGRST204', message: `Could not find the '${unknown}' column of '${table}' in the schema cache` } }).then(resolve, reject)
        let matched = rows().filter(row => filters.every(filter => filter(row)))
        for (const [key, direction] of [...sorts].reverse()) matched = [...matched].sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * direction)
        if (op === 'update') matched.forEach(row => Object.assign(row, values))
        if (op === 'insert') { matched = values.map(value => ({ id: `m${rows().length + 1}`, ...value })); rows().push(...matched) }
        if (table === 'commerce_orders' && !head) {
          matched = matched.map(row => ({ ...row, items: tables.commerce_order_items.filter(item => item.order_id === row.id), contact: tables.contacts.find(contact => contact.id === row.contact_id) || null }))
        }
        // Copies, as Supabase returns them: a row read earlier does not change under the route
        return Promise.resolve({ data: head ? null : structuredClone(singular ? matched[0] || null : matched), error: null, count: matched.length }).then(resolve, reject)
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
console.warn = () => {}

let respond = () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.1' }] }) })
globalThis.fetch = async (url, init) => {
  if (!init || !init.body) return { ok: true, status: 200, json: async () => ({ data: [] }) }
  sent.push(JSON.parse(init.body))
  return respond(sent[sent.length - 1])
}
const rejected = code => ({ ok: false, status: 400, json: async () => ({ error: { code, message: 'rejected' } }) })

const route = require(path.join(PROJECT, 'app/api/commerce/orders/route.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))
const { NO_STATUS_TEMPLATE_ERROR } = require(path.join(PROJECT, 'lib/commerce/commerce-webhook-handler.ts'))
const patch = (body) => route.PATCH(new NextRequest('https://wamacrm.example.com/api/commerce/orders', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: ORDER, organizationId: ORG, ...body }),
}))
const get = (params = {}) => route.GET(new NextRequest(`https://wamacrm.example.com/api/commerce/orders?${new URLSearchParams({ organizationId: ORG, ...params })}`))
const noted = () => tables.messages.map(message => message.body)
const audit = () => noted().filter(body => body.startsWith('['))
const order = () => tables.commerce_orders[0]
const hoursAgo = hours => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

test.beforeEach(() => { sent = []; respond = () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.1' }] }) }) })

test('Order changes from the dashboard are noted in the order\'s chat, with who made them', async () => {
  reset()
  let res = await patch({ status: 'paid' })
  assert.equal(res.status, 200)
  assert.deepEqual(tables.messages, [{ id: 'm1', organization_id: ORG, conversation_id: 'conversation-1', sender_type: 'user', body: '[Order #ORD-261013-AB12 marked paid by Asha Rao]', status: 'sent' }])
  assert.deepEqual([order().status, order().payment_status, order().payment_method], ['paid', 'paid', 'manual'])

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

// ── A live payment request does not outlive the decision ────────────────────

const requested = { meta_payment_reference: 'ORD-261013-AB12', payment_requests: [{ reference: 'ORD-261013-AB12', amount: 1040, currency: 'INR', requested_at: '2026-10-13T09:05:00.000Z' }] }

test('Confirming for cash or marking paid from the dashboard withdraws the payment request still open in the chat', async () => {
  reset(requested)
  let res = await patch({ status: 'cod_confirmed', notifyCustomer: true })
  assert.equal(res.status, 200)
  let body = await res.json()
  assert.deepEqual([body.paymentRequestCanceled, body.notified], [true, true])
  // The card is withdrawn first, then the confirmation goes as a message (not as a "processing" card after a withdrawn one)
  assert.deepEqual(sent.map(message => (message.type === 'text' ? 'text' : [message.interactive.type, message.interactive.action.parameters.order.status])), [['order_status', 'canceled'], 'text'])
  assert.deepEqual([sent[0].interactive.action.parameters.reference_id, sent[0].interactive.body.text], ['ORD-261013-AB12', 'Online payment withdrawn: your order #ORD-261013-AB12 is confirmed for Cash on Delivery.'])
  assert.match(sent[1].text.body, /confirmed for Cash on Delivery/)
  assert.deepEqual([order().status, order().payment_method, order().payment_status], ['cod_confirmed', 'cod', 'pending'])
  assert.ok(order().payment_requests[0].voided_at)

  reset(requested)
  res = await patch({ status: 'paid' })
  body = await res.json()
  assert.deepEqual([res.status, body.paymentRequestCanceled], [200, true])
  assert.deepEqual([sent.length, sent[0].interactive.body.text], [1, 'Online payment withdrawn: order #ORD-261013-AB12 is already paid.'])
  assert.deepEqual([order().status, order().payment_status, order().payment_method], ['paid', 'paid', 'manual'])

  // Already paid in the chat, or never asked to pay: nothing to withdraw
  reset({ ...requested, status: 'paid', payment_status: 'paid', payment_method: 'whatsapp_pay' })
  res = await patch({ status: 'shipped' })
  assert.deepEqual([res.status, (await res.json()).paymentRequestCanceled, sent.length], [200, false, 0])
  reset()
  res = await patch({ status: 'cod_confirmed' })
  assert.deepEqual([res.status, (await res.json()).paymentRequestCanceled, sent.length], [200, false, 0])

  // WhatsApp refuses the withdrawal: the order is still confirmed, and the dashboard is told the card stays
  reset(requested)
  respond = () => rejected(131009)
  res = await patch({ status: 'cod_confirmed' })
  assert.deepEqual([res.status, (await res.json()).paymentRequestCanceled, order().status], [200, false, 'cod_confirmed'])
})

// ── Cash collected ──────────────────────────────────────────────────────────

test('Cash collected: "paid" on a Cash on Delivery order keeps the method, and a shipped order keeps its status', async () => {
  reset({ status: 'cod_confirmed', payment_method: 'cod' })
  let res = await patch({ status: 'paid', notifyCustomer: true })
  assert.equal(res.status, 200)
  assert.deepEqual([order().status, order().payment_status, order().payment_method], ['paid', 'paid', 'cod'])
  assert.deepEqual(audit(), ['[Order #ORD-261013-AB12 marked paid (cash collected) by Asha Rao]'])
  assert.deepEqual(sent.map(message => message.type), ['text'])
  assert.match(sent[0].text.body, /^Payment of ₹\s?1,040 received in cash for order #ORD-261013-AB12\. Thank you!$/)

  // Collected after shipping (the courier remitted): the order stays shipped, the money is noted on it
  reset({ status: 'shipped', payment_method: 'cod', meta_payment_reference: 'ORD-261013-AB12' })
  res = await patch({ status: 'paid', notifyCustomer: true })
  assert.equal(res.status, 200)
  assert.deepEqual([order().status, order().payment_status, order().payment_method], ['shipped', 'paid', 'cod'])
  assert.deepEqual(audit(), ['[Order #ORD-261013-AB12 marked paid (cash collected) by Asha Rao]'])
  assert.deepEqual(sent.map(message => message.type), ['text']) // never a "processing" card on a shipped order
  // Clicked twice: nothing changes and nothing more is noted
  res = await patch({ status: 'paid' })
  assert.equal(res.status, 200)
  assert.deepEqual([order().status, order().payment_status, order().payment_method, audit().length], ['shipped', 'paid', 'cod', 1])

  // Delivered still settles a Cash on Delivery order, as before
  reset({ status: 'shipped', payment_method: 'cod' })
  res = await patch({ status: 'delivered' })
  assert.deepEqual([res.status, order().status, order().payment_status, order().payment_method], [200, 'delivered', 'paid', 'cod'])
  assert.deepEqual(noted(), ['[Order #ORD-261013-AB12 marked delivered by Asha Rao]'])

  // Money that came in another way for a shipped order that was never Cash on Delivery
  reset({ status: 'shipped', payment_method: null })
  res = await patch({ status: 'paid' })
  assert.deepEqual([res.status, order().status, order().payment_status, order().payment_method], [200, 'shipped', 'paid', 'manual'])
  assert.deepEqual(noted(), ['[Order #ORD-261013-AB12 marked paid by Asha Rao]'])
})

// ── Stock ───────────────────────────────────────────────────────────────────

const stocked = () => ({
  commerce_products: [{ id: 'p1', organization_id: ORG, retailer_id: 'SKU-1', title: 'Shirt', price: 500, inventory_count: 3, is_available: true }],
  commerce_order_items: [{ id: 'line-1', order_id: ORDER, product_id: 'p1', retailer_id: 'SKU-1', title: 'Shirt', unit_price: 500, quantity: 2 }],
})
const product = () => tables.commerce_products[0]

test('Stock: settling an order from the dashboard takes its items out of stock; canceling puts them back', async () => {
  reset({}, stocked())
  let res = await patch({ status: 'paid' })
  assert.equal(res.status, 200)
  assert.deepEqual([product().inventory_count, product().is_available, Boolean(order().stock_adjusted_at)], [1, true, true])
  // Shipped: nothing more leaves
  await patch({ status: 'shipped' })
  assert.equal(product().inventory_count, 1)
  // Canceled: back in stock, once
  res = await patch({ status: 'canceled' })
  assert.deepEqual([res.status, product().inventory_count, order().stock_adjusted_at], [200, 3, null])

  // Confirmed for cash, then the last one sells out
  reset({}, stocked())
  product().inventory_count = 2
  await patch({ status: 'cod_confirmed' })
  assert.deepEqual([product().inventory_count, product().is_available], [0, false])
  // Cash collected later counts nothing twice
  await patch({ status: 'paid' })
  assert.deepEqual([product().inventory_count, order().status], [0, 'paid'])

  // The column from the stock migration is missing: the order is still settled, stock is left alone
  reset({}, stocked())
  missingColumns = { commerce_orders: ['stock_adjusted_at'] }
  res = await patch({ status: 'paid' })
  assert.deepEqual([res.status, order().status, product().inventory_count, order().stock_adjusted_at], [200, 'paid', 3, undefined])
})

// ── Tracking links ──────────────────────────────────────────────────────────

test('Tracking: a link is kept with the tracking details and sent to the customer; only web addresses are accepted', async () => {
  reset({ status: 'paid', payment_status: 'paid', payment_method: 'manual', shipping_address: { address_line_1: '1 MG Road' } })
  let res = await patch({ status: 'shipped', trackingNumber: 'AWB123', carrier: 'Delhivery', trackingUrl: ' https://track.example.com/AWB123 ', notifyCustomer: true })
  assert.equal(res.status, 200)
  assert.deepEqual([order().shipping_address.address_line_1, order().shipping_address.carrier, order().shipping_address.tracking_number, order().shipping_address.tracking_url], ['1 MG Road', 'Delhivery', 'AWB123', 'https://track.example.com/AWB123'])
  assert.ok(order().shipping_address.shipped_at)
  assert.equal(sent[0].text.body, 'Good news! Order #ORD-261013-AB12 has shipped with Delhivery. Tracking number: AWB123. Track it here: https://track.example.com/AWB123')

  // Corrected later from the same form; cleared with an empty value
  res = await patch({ trackingUrl: 'https://track.example.com/AWB124' })
  assert.deepEqual([res.status, order().shipping_address.tracking_url], [200, 'https://track.example.com/AWB124'])
  res = await patch({ trackingUrl: '' })
  assert.deepEqual([res.status, order().shipping_address.tracking_url], [200, ''])

  // Delivered: the details come along once more
  res = await patch({ status: 'delivered', trackingUrl: 'https://track.example.com/AWB124', notifyCustomer: true })
  assert.equal(res.status, 200)
  assert.equal(sent[sent.length - 1].text.body, 'Order #ORD-261013-AB12 has been delivered with Delhivery. Tracking number: AWB123. Track it here: https://track.example.com/AWB124 Thank you for shopping with us!')

  // Not a link the customer could open: refused before anything changes
  reset({ status: 'paid', payment_status: 'paid' })
  for (const bad of ['javascript:alert(1)', 'track.example.com/AWB123', `https://track.example.com/${'A'.repeat(500)}`]) {
    res = await patch({ status: 'shipped', trackingUrl: bad })
    assert.equal(res.status, 400, bad)
    assert.match((await res.json()).error, /tracking link/)
  }
  assert.deepEqual([order().status, order().shipping_address], ['paid', null])
})

// ── Status updates after the 24-hour window ─────────────────────────────────

test('Notifying after 24 hours: the order-update template when the store has one, otherwise a clear error and a failed row in the chat', async () => {
  const lastWrote = hours => ({ messages: [{ id: 'in-1', organization_id: ORG, conversation_id: 'conversation-1', sender_type: 'contact', body: 'hi', created_at: hoursAgo(hours) }] })

  // No template set up: the dashboard learns what to do, and the chat shows the update was not delivered
  reset({ status: 'cod_confirmed', payment_method: 'cod' }, lastWrote(30))
  let res = await patch({ status: 'shipped', carrier: 'Delhivery', trackingNumber: 'AWB123', notifyCustomer: true })
  assert.equal(res.status, 200)
  let body = await res.json()
  assert.deepEqual([body.notified, body.notifyError, sent.length], [false, NO_STATUS_TEMPLATE_ERROR, 0])
  assert.deepEqual(tables.messages.filter(message => message.sender_type === 'user').map(message => [message.body, message.status, message.error_message]), [
    ['[Order #ORD-261013-AB12 marked shipped by Asha Rao]', 'sent', undefined],
    ['Good news! Order #ORD-261013-AB12 has shipped with Delhivery. Tracking number: AWB123.', 'failed', NO_STATUS_TEMPLATE_ERROR],
  ])

  // With the template: it goes out with the order number, the status and the tracking
  reset({ status: 'cod_confirmed', payment_method: 'cod' }, { ...lastWrote(30), organizations: [{ id: ORG, currency: 'INR', whatsapp_api_token: 'token', whatsapp_phone_number_id: '111', commerce_status_template: { name: 'order_update', language: 'en' } }] })
  res = await patch({ status: 'shipped', carrier: 'Delhivery', trackingNumber: 'AWB123', trackingUrl: 'https://track.example.com/AWB123', notifyCustomer: true })
  body = await res.json()
  assert.deepEqual([res.status, body.notified, body.notifyError], [200, true, null])
  assert.deepEqual(sent.map(message => message.type), ['template'])
  assert.deepEqual(sent[0].template.components[0].parameters.map(parameter => parameter.text), ['ORD-261013-AB12', 'Shipped', 'Delhivery · AWB123 · https://track.example.com/AWB123'])
  assert.deepEqual(tables.messages.filter(message => message.sender_type === 'user').map(message => message.status), ['sent', 'sent'])

  // The customer wrote an hour ago: a plain message, as before
  reset({ status: 'cod_confirmed', payment_method: 'cod' }, lastWrote(1))
  res = await patch({ status: 'shipped', notifyCustomer: true })
  assert.deepEqual([res.status, (await res.json()).notified, sent.map(message => message.type)], [200, true, ['text']])
})

// ── The store summary comes with the first page, and after a change ─────────

test('Orders list: the totals come with the first page (or on request) and are counted again after a change', async () => {
  reset({}, { commerce_orders: [
    { id: ORDER, organization_id: ORG, order_number: 'ORD-1', status: 'payment_pending', payment_status: 'pending', contact_id: CONTACT, conversation_id: 'conversation-1', currency: 'INR', total_amount: 1040, created_at: '2026-10-13T09:00:00.000Z' },
    { id: '33333333-3333-4333-8333-333333333333', organization_id: ORG, order_number: 'ORD-2', status: 'paid', payment_status: 'paid', contact_id: CONTACT, currency: 'INR', total_amount: 500, created_at: '2026-10-13T10:00:00.000Z' },
  ] })
  let res = await get({ page: '1' })
  assert.equal(res.status, 200)
  let body = await res.json()
  assert.deepEqual([body.orders.length, body.pagination.total, body.summary.total, body.summary.awaiting, body.summary.toShip, body.summary.revenue], [2, 2, 2, 1, 1, [{ currency: 'INR', amount: 500 }]])
  const counted = calls.filter(call => call === 'select commerce_orders').length
  assert.ok(counted >= 9, `the page plus the counts: ${counted}`)

  // Page 2: the page only, no totals (the dashboard keeps the ones it has)
  calls = []
  body = await (await get({ page: '2' })).json()
  assert.equal(body.summary, null)
  assert.deepEqual(calls, ['select commerce_orders'])

  // Asked for on a later page (after a change): served from the 30-second cache
  calls = []
  body = await (await get({ page: '2', withSummary: '1' })).json()
  assert.equal(body.summary.total, 2)
  assert.deepEqual(calls, ['select commerce_orders'])

  // An order changed through the route: the next totals are fresh
  await patch({ status: 'canceled' })
  calls = []
  body = await (await get({ page: '1' })).json()
  assert.deepEqual([body.summary.awaiting, body.summary.canceled], [0, 1])
  assert.ok(calls.filter(call => call === 'select commerce_orders').length >= 9)
})
