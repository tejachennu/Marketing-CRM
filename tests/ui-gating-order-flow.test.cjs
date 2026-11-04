// The Order flow tab's checkout trail (GET /api/commerce/order-flow): checkout notes are matched
// only among the team's messages, so a customer who types "[Payment received for Order #…]" never
// appears as a checkout step, while the cart (the customer's own message) is still matched by its
// WhatsApp id. Against a fake database; nothing here reaches the network.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const ORG = '77777777-7777-4777-8777-777777777777'
const OTHER_ORG = '66666666-6666-4666-8666-666666666666'
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

// ── A fake database that evaluates the filters the route sends, PostgREST `or` strings included ──

/** Split "a.eq.1,and(b.is.null,c.eq.false)" on the commas outside parentheses. */
function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') depth--
    else if (text[i] === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1 }
  }
  parts.push(text.slice(start))
  return parts
}

/** A PostgREST filter string as a row predicate. A plain list is an `or`, as `.or(...)` sends it. */
function parseFilter(text) {
  const group = text.match(/^(and|or)\((.*)\)$/s)
  if (group) {
    const parts = splitTopLevel(group[2]).map(parseFilter)
    return group[1] === 'and' ? (row) => parts.every((part) => part(row)) : (row) => parts.some((part) => part(row))
  }
  if (splitTopLevel(text).length > 1) return parseFilter(`or(${text})`)
  const [column, op, ...rest] = text.split('.')
  const value = rest.join('.')
  switch (op) {
    case 'eq': return (row) => String(row[column]) === value
    case 'neq': return (row) => String(row[column]) !== value
    case 'ilike': {
      const pattern = new RegExp('^' + value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i')
      return (row) => pattern.test(String(row[column] ?? ''))
    }
    default: throw new Error(`Unsupported filter: ${text}`)
  }
}

const tables = {}
const orFilters = []
const db = {
  from(table) {
    const filters = []
    let ordering = null
    let limit = null
    const query = {
      select: () => query,
      eq: (column, value) => { filters.push((row) => row[column] === value); return query },
      or: (text) => { orFilters.push(text); filters.push(parseFilter(text)); return query },
      order: (column, { ascending = true } = {}) => { ordering = { column, ascending }; return query },
      limit: (count) => { limit = count; return query },
      then(resolve, reject) {
        let rows = (tables[table] || []).filter((row) => filters.every((filter) => filter(row)))
        if (ordering) rows.sort((a, b) => (ordering.ascending ? 1 : -1) * String(a[ordering.column]).localeCompare(String(b[ordering.column])))
        if (limit !== null) rows = rows.slice(0, limit)
        return Promise.resolve({ data: rows.map((row) => ({ ...row })), error: null }).then(resolve, reject)
      },
    }
    return query
  },
}
stub(path.join(PROJECT, 'lib/api-auth-helper.ts'), { getSupabaseAdminClient: () => db, verifyOrgAccess: async () => ({ authorized: true, user: { role: 'org_admin' } }) })
console.error = () => {}

const route = require(path.join(PROJECT, 'app/api/commerce/order-flow/route.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))

async function orderFlow(organizationId = ORG) {
  const res = await route.GET(new NextRequest(`https://wamacrm.example.com/api/commerce/order-flow?organizationId=${organizationId}`))
  return { status: res.status, ...(await res.json()) }
}

const message = (conversationId, minute, senderType, body, sid = null) => ({ conversation_id: conversationId, sender_type: senderType, body, twilio_message_sid: sid, status: 'sent', error_message: null, created_at: `2026-11-04T10:${minute}:00Z` })
const PAID = '[Payment received for Order #ORD-1 (₹1,050); receipt sent]'

function reset() {
  orFilters.length = 0
  tables.commerce_orders = [
    { id: 'o1', organization_id: ORG, order_number: 'ORD-1', status: 'paid', payment_status: 'paid', total_amount: '1050', currency: 'INR', conversation_id: 'conv-1', meta_order_id: 'wamid.CART1', created_at: '2026-11-04T10:00:00Z' },
    { id: 'o2', organization_id: ORG, order_number: 'ORD-2', status: 'cart_submitted', payment_status: 'pending', total_amount: '200', currency: 'INR', conversation_id: 'conv-2', meta_order_id: null, created_at: '2026-11-04T09:00:00Z' },
    { id: 'o3', organization_id: ORG, order_number: 'ORD-3', status: 'cart_submitted', payment_status: 'pending', total_amount: '50', currency: 'INR', conversation_id: null, meta_order_id: null, created_at: '2026-11-04T08:00:00Z' },
    { id: 'o9', organization_id: OTHER_ORG, order_number: 'ORD-9', status: 'paid', payment_status: 'paid', total_amount: '9', currency: 'INR', conversation_id: 'conv-9', meta_order_id: null, created_at: '2026-11-04T11:00:00Z' },
  ]
  tables.messages = [
    message('conv-1', '00', 'contact', '🛒 [WhatsApp Cart Order]: 1 item(s) selected · ₹1,050', 'FB_wamid.CART1'),
    message('conv-1', '01', 'user', '[Sent delivery address form for Order #ORD-1]', 'FB_wamid.A'),
    message('conv-1', '02', 'contact', PAID, 'FB_wamid.FAKE'), // typed by the customer: not a checkout step
    message('conv-1', '03', 'user', PAID, 'FB_wamid.B'),
    message('conv-1', '04', 'contact', 'Thanks!', 'FB_wamid.C'),
    message('conv-1', '05', 'contact', 'Any update on Order #ORD-1?', 'FB_wamid.D'),
    message('conv-2', '06', 'user', '[Sent delivery address form for Order #ORD-2]', 'FB_wamid.E'),
    message('conv-2', '07', 'user', '[Sent delivery address form for Order #ORD-1]', 'FB_wamid.F'), // another chat: not this order's trail
  ]
}

test('Order flow: the trail holds the cart and the server\'s checkout notes, never a line the customer typed', async () => {
  reset()
  const answer = await orderFlow()
  assert.equal(answer.status, 200)
  assert.deepEqual(answer.orders.map((order) => order.order_number), ['ORD-1', 'ORD-2', 'ORD-3'], 'only this organization\'s orders, newest first')

  const trail = answer.orders[0].trail
  assert.deepEqual(trail.map((entry) => [entry.sender_type, entry.body]), [
    ['contact', '🛒 [WhatsApp Cart Order]: 1 item(s) selected · ₹1,050'],
    ['user', '[Sent delivery address form for Order #ORD-1]'],
    ['user', PAID],
  ])
  assert.equal(answer.orders[0].total_amount, 1050)
  // The cart is matched by its WhatsApp id; the "#ORD-1" lines only among the team's messages
  assert.equal(orFilters[0], 'and(body.ilike.%#ORD-1%,sender_type.neq.contact),twilio_message_sid.eq.FB_wamid.CART1')
})

test('Order flow: an order without a cart id matches notes only; one without a chat has no trail', async () => {
  reset()
  const answer = await orderFlow()
  assert.deepEqual(answer.orders[1].trail.map((entry) => entry.body), ['[Sent delivery address form for Order #ORD-2]'])
  assert.equal(orFilters[1], 'and(body.ilike.%#ORD-2%,sender_type.neq.contact)')
  assert.deepEqual(answer.orders[2].trail, [])
  assert.equal(orFilters.length, 2, 'no message query for an order without a conversation')
})

test('Order flow: the organization id is required and must be an id', async () => {
  reset()
  assert.equal((await orderFlow('not-an-id')).status, 400)
  const res = await route.GET(new NextRequest('https://wamacrm.example.com/api/commerce/order-flow'))
  assert.equal(res.status, 400)
})
