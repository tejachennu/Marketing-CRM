// Checkout-abandonment reminders, against a fake database and a fake "resend the checkout
// step". Nothing here reaches WhatsApp or a real database.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const NOW = new Date('2026-11-04T10:00:00.000Z')
const HOUR = 60 * 60 * 1000
const hoursAgo = (hours) => new Date(NOW.getTime() - hours * HOUR).toISOString()
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

// Fake "send the step the order is waiting on again"
let resends = []
let resendResult = { step: 'address' }
stub(path.join(PROJECT, 'lib/commerce/commerce-webhook-handler.ts'), {
  resendCheckoutStep: async (args) => { resends.push(args); return typeof resendResult === 'function' ? resendResult(args) : resendResult },
})
let warnings = []
for (const level of ['log', 'warn', 'error']) {
  const original = console[level]
  console[level] = (...args) => { if (String(args[0]).startsWith('[Checkout Reminders]')) warnings.push(String(args[0])); else original(...args) }
}

const { sendCheckoutReminders, MIGRATION_HINT, SEND_TIMEOUT_MS } = require(path.join(PROJECT, 'lib/scheduler/checkout-reminders.ts'))

// In-memory stand-in for the parts of supabase-js the job uses: filters (also on the inner-joined
// organization), ordering, limits, maybeSingle and updates that return the rows they changed.
function createDb(tables) {
  const db = { tables, calls: [], beforeQuery: null }
  const read = (row, column) => column.split('.').reduce((value, key) => (value == null ? value : value[key]), row)
  const test = (operator, actual, expected) => {
    switch (operator) {
      case 'eq': return actual === expected
      case 'neq': return actual !== expected
      case 'lt': return actual != null && actual < expected
      case 'lte': return actual != null && actual <= expected
      case 'gt': return actual != null && actual > expected
      case 'gte': return actual != null && actual >= expected
      case 'in': return expected.includes(actual)
      case 'is': return expected === null ? actual == null : actual === expected
      default: throw new Error(`Unsupported operator ${operator}`)
    }
  }
  const matches = (row, [op, ...args]) => {
    if (op === 'not') return !test(args[1], read(row, args[0]), args[2])
    if (op === 'or') {
      return args[0].split(',').some((part) => {
        const [, column, operator, raw] = part.match(/^([^.]+)\.([^.]+)\.(.*)$/)
        return test(operator, read(row, column), raw === 'null' ? null : raw)
      })
    }
    return test(op, read(row, args[0]), args[1])
  }
  function execute(table, ops) {
    const error = db.beforeQuery && db.beforeQuery(table, ops)
    if (error) return { data: null, error }
    let action = 'select', values = null, columns = null, single = false, limit = Infinity, order = null, returning = false
    const filters = []
    for (const [op, ...args] of ops) {
      if (op === 'select') { if (action === 'select') columns = args[0]; else returning = true }
      else if (op === 'update') { action = 'update'; values = args[0] }
      else if (op === 'order') order = { column: args[0], ascending: !(args[1] && args[1].ascending === false) }
      else if (op === 'limit') limit = args[0]
      else if (op === 'maybeSingle') single = true
      else filters.push([op, ...args])
    }
    let rows = db.tables[table] || []
    if (action === 'select' && table === 'commerce_orders' && columns.includes('organizations!inner')) {
      rows = rows.map((row) => ({
        ...row,
        organizations: (db.tables.organizations || []).find((org) => org.id === row.organization_id) || null,
        items: (db.tables.commerce_order_items || []).filter((item) => item.order_id === row.id),
        contact: (db.tables.contacts || []).find((contact) => contact.id === row.contact_id) || null,
      })).filter((row) => row.organizations)
    }
    rows = rows.filter((row) => filters.every((filter) => matches(row, filter)))
    if (order) rows = [...rows].sort((a, b) => (a[order.column] < b[order.column] ? -1 : a[order.column] > b[order.column] ? 1 : 0) * (order.ascending ? 1 : -1))
    rows = rows.slice(0, limit)
    if (action === 'update') {
      rows.forEach((row) => Object.assign(row, values))
      return { data: returning ? rows.map(({ id }) => ({ id })) : null, error: null }
    }
    if (single) return { data: rows[0] || null, error: null }
    return { data: rows, error: null }
  }
  db.from = (table) => {
    const ops = []
    db.calls.push({ table, ops })
    const query = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') return (resolve, reject) => Promise.resolve().then(() => execute(table, ops)).then(resolve, reject)
        return (...args) => { ops.push([prop, ...args]); return query }
      },
    })
    return query
  }
  return db
}

const STORE = {
  id: ORG_A, name: 'Magnetora Books', currency: 'INR', enable_commerce: true, commerce_reminders_enabled: true,
  whatsapp_api_token: 'TOKEN', whatsapp_phone_number_id: '600000000000001', whatsapp_graph_api_version: 'v25.0',
  commerce_address_flow_id: 'flow-1', commerce_payment_gateway: 'razorpay', commerce_gateway_config_name: 'cfg', commerce_enable_cod: true,
}
const QUIET_STORE = { ...STORE, id: ORG_B, commerce_reminders_enabled: false }

/** An open checkout abandoned two hours ago, by a customer of its own, whose customer wrote two hours ago. */
function order(id, overrides = {}) {
  return {
    id, organization_id: ORG_A, contact_id: `contact-${id}`, conversation_id: `conv-${id}`, order_number: `ORD-${id}`,
    status: 'cart_submitted', payment_status: 'pending', total_amount: 500, currency: 'INR',
    created_at: hoursAgo(2), updated_at: hoursAgo(2), reminder_count: 0, next_reminder_at: null,
    ...overrides,
  }
}
/**
 * The chat of each order: the customer's cart message (`lastInbound`, two hours ago by default)
 * and the store's own next step right after it, which the checkout notes as sent by the team.
 * `chats` overrides the conversation row, `lines` adds messages.
 */
function setup(orders, { lastInbound = {}, chats = {}, lines = [] } = {}) {
  const messages = orders.flatMap((o) => (o.conversation_id ? [
    { id: `m-${o.id}`, organization_id: o.organization_id, conversation_id: o.conversation_id, sender_type: 'contact', body: '🛒 [WhatsApp Cart Order]: 1 item(s) selected', created_at: lastInbound[o.id] || hoursAgo(2) },
    { id: `u-${o.id}`, organization_id: o.organization_id, conversation_id: o.conversation_id, sender_type: 'user', body: `[Sent delivery address form for Order #${o.order_number}]`, created_at: hoursAgo(1.9) },
  ] : [])).concat(lines)
  const conversations = orders.filter((o) => o.conversation_id).map((o) => ({
    id: o.conversation_id, organization_id: o.organization_id, contact_id: o.contact_id, assigned_to: null, auto_reply_enabled: true,
    last_message_at: messages.filter((m) => m.conversation_id === o.conversation_id).map((m) => m.created_at).sort().pop() || null,
    ...(chats[o.id] || {}),
  }))
  return createDb({
    organizations: [STORE, QUIET_STORE],
    commerce_orders: orders,
    commerce_order_items: orders.map((o) => ({ id: `item-${o.id}`, order_id: o.id, retailer_id: 'BOOK-1', title: 'Gitanjali', unit_price: 500, quantity: 1 })),
    contacts: orders.map((o) => ({ id: o.contact_id, organization_id: o.organization_id, phone_number: '919000000001' })),
    conversations,
    messages,
  })
}
const byId = (db, id) => db.tables.commerce_orders.find((row) => row.id === id)
const queriesOf = (db, table) => db.calls.filter((call) => call.table === table)
function reset() { resends = []; resendResult = { step: 'address' }; warnings = [] }

test('Reminders: only an open checkout abandoned for an hour, inside the 24-hour window, is reminded', async () => {
  reset()
  const db = setup([
    order('eligible'),
    order('too_new', { created_at: hoursAgo(0.5), updated_at: hoursAgo(0.5) }),
    order('just_changed', { updated_at: hoursAgo(0.2) }),
    order('reminded_twice', { reminder_count: 2 }),
    order('not_due_yet', { reminder_count: 1, next_reminder_at: hoursAgo(-2) }),
    order('outside_window'),
    order('canceled', { status: 'canceled' }),
    order('paid', { status: 'paid', payment_status: 'paid' }),
    order('cod', { status: 'cod_confirmed' }),
    order('paid_pending_status', { payment_status: 'paid' }),
    order('reminders_off', { organization_id: ORG_B }),
  ], { lastInbound: { outside_window: hoursAgo(30) } })

  const result = await sendCheckoutReminders({ supabase: db, now: NOW })
  assert.deepEqual(result, { scanned: 2, sent: 1, failed: 0, waiting: 1, held: 0 })

  assert.equal(resends.length, 1)
  assert.deepEqual(resends[0].organization, STORE, 'the store settings go along, so the right step is sent')
  assert.equal(resends[0].order.id, 'eligible')
  assert.equal(resends[0].order.items[0].title, 'Gitanjali', 'items come along, so nothing is read again')
  assert.equal(resends[0].order.contact.phone_number, '919000000001')
  assert.equal(resends[0].database, db)

  const sent = byId(db, 'eligible')
  assert.equal(sent.reminder_count, 1)
  assert.equal(sent.next_reminder_at, hoursAgo(-20), 'the next reminder is a day away')
  assert.equal(sent.updated_at, NOW.toISOString())

  const waiting = byId(db, 'outside_window')
  assert.equal(waiting.reminder_count, 0)
  assert.equal(waiting.next_reminder_at, hoursAgo(-6), 'looked at again in six hours, when the customer may have written')

  for (const id of ['too_new', 'just_changed', 'reminded_twice', 'canceled', 'paid', 'cod', 'paid_pending_status', 'reminders_off']) {
    const untouched = byId(db, id)
    assert.equal(untouched.next_reminder_at, null, `${id} is left alone`)
    assert.equal(untouched.reminder_count, id === 'reminded_twice' ? 2 : 0)
  }
  assert.equal(byId(db, 'not_due_yet').next_reminder_at, hoursAgo(-2))
})

test('Reminders: checkouts begun more than a week ago are over, not abandoned', async () => {
  reset()
  const db = setup([
    order('last_week', { created_at: hoursAgo(6 * 24), updated_at: hoursAgo(6 * 24) }),
    order('old', { created_at: hoursAgo(8 * 24), updated_at: hoursAgo(2) }),
  ], { lastInbound: { last_week: hoursAgo(2), old: hoursAgo(2) } })
  const result = await sendCheckoutReminders({ supabase: db, now: NOW })
  assert.deepEqual(result, { scanned: 1, sent: 1, failed: 0, waiting: 0, held: 0 })
  assert.deepEqual(resends.map((r) => r.order.id), ['last_week'])
  assert.equal(byId(db, 'old').next_reminder_at, null, 'not even claimed')

  // The bound is in the query itself, so the database never hands over the old carts
  const [candidates] = queriesOf(db, 'commerce_orders')
  assert.ok(candidates.ops.some(([op, column, value]) => op === 'gte' && column === 'created_at' && value === hoursAgo(7 * 24)), JSON.stringify(candidates.ops))
})

test('Reminders: the second reminder goes out a day later, and there is never a third', async () => {
  reset()
  const db = setup([order('once', { reminder_count: 1, next_reminder_at: hoursAgo(1), created_at: hoursAgo(22), updated_at: hoursAgo(21) })], { lastInbound: { once: hoursAgo(21) } })
  let result = await sendCheckoutReminders({ supabase: db, now: NOW })
  assert.equal(result.sent, 1)
  assert.equal(byId(db, 'once').reminder_count, 2)

  const dayLater = new Date(NOW.getTime() + 21 * HOUR)
  result = await sendCheckoutReminders({ supabase: db, now: dayLater })
  assert.equal(result.scanned, 0)
  assert.equal(resends.length, 1)
})

test('Reminders: when WhatsApp refuses the message, the order is tried again in six hours', async () => {
  reset()
  resendResult = { step: 'not_sent', error: 'This customer has not messaged you in the last 24 hours' }
  const db = setup([order('refused')])
  const result = await sendCheckoutReminders({ supabase: db, now: NOW })
  assert.deepEqual(result, { scanned: 1, sent: 0, failed: 1, waiting: 0, held: 0 })
  assert.equal(resends.length, 1)
  const refused = byId(db, 'refused')
  assert.equal(refused.reminder_count, 0)
  assert.equal(refused.next_reminder_at, hoursAgo(-6))
  assert.ok(warnings.some((line) => line.includes('ORD-refused') && line.includes('6 hours')))
})

test('Reminders: a step WhatsApp does not confirm in time may still arrive, so it counts as sent, and the run moves on', async () => {
  reset()
  // One WhatsApp call gives up after 15 s (WHATSAPP_SEND_TIMEOUT_MS); a step that answers just
  // before that must not be cut off and counted as refused
  assert.ok(SEND_TIMEOUT_MS > 15 * 1000, 'longer than a single WhatsApp send')
  const db = setup([order('hanging'), order('fine', { created_at: hoursAgo(3) })])
  // WhatsApp never answers for one of them
  resendResult = ({ order }) => (order.id === 'hanging' ? new Promise(() => {}) : { step: 'address' })
  const result = await sendCheckoutReminders({ supabase: db, now: NOW, sendTimeoutMs: 20 })
  assert.deepEqual(result, { scanned: 2, sent: 2, failed: 0, waiting: 0, held: 0 })
  assert.deepEqual(resends.map((r) => r.order.id), ['fine', 'hanging'], 'oldest first; the hanging send did not stop the next')
  const hanging = byId(db, 'hanging')
  assert.equal(hanging.reminder_count, 1, 'counted: the customer is not reminded again six hours later')
  assert.equal(hanging.next_reminder_at, hoursAgo(-20), 'the next reminder is a day away, as for a confirmed one')
  assert.ok(warnings.some((line) => line.includes('ORD-hanging') && line.includes('did not answer') && line.includes('may still arrive')))
  assert.equal(byId(db, 'fine').reminder_count, 1)
})

test('Reminders: a send that answers late is recorded once, and a second reminder within the day never follows', async () => {
  reset()
  const db = setup([order('slow', { reminder_count: 1, next_reminder_at: hoursAgo(1), created_at: hoursAgo(22), updated_at: hoursAgo(21) })], { lastInbound: { slow: hoursAgo(21) } })
  let deliver
  resendResult = () => new Promise((resolve) => { deliver = resolve })
  const result = await sendCheckoutReminders({ supabase: db, now: NOW, sendTimeoutMs: 20 })
  assert.equal(result.sent, 1)
  deliver({ step: 'payment' }) // Meta answers after the run gave up on it
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(byId(db, 'slow').reminder_count, 2, 'the second and last reminder')
  // Six hours later the order is not picked up again
  const later = await sendCheckoutReminders({ supabase: db, now: new Date(NOW.getTime() + 6 * HOUR) })
  assert.equal(later.scanned, 0)
  assert.equal(resends.length, 1)
})

test('Reminders: a store whose commerce module is off, or the platform kill switch, sends nothing', async () => {
  reset()
  const OFF = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  const NO_MESSAGING = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  const db = setup([order('commerce_off', { organization_id: OFF }), order('messaging_off', { organization_id: NO_MESSAGING }), order('on')])
  db.tables.organizations.push({ ...STORE, id: OFF, enable_commerce: false }, { ...STORE, id: NO_MESSAGING, enable_messages: false })
  const result = await sendCheckoutReminders({ supabase: db, now: NOW })
  assert.deepEqual(result, { scanned: 1, sent: 1, failed: 0, waiting: 0, held: 0 })
  assert.deepEqual(resends.map((r) => r.order.id), ['on'])
  assert.equal(byId(db, 'commerce_off').next_reminder_at, null, 'not even claimed')
  assert.equal(byId(db, 'messaging_off').next_reminder_at, null, 'not even claimed')
  const [candidates] = queriesOf(db, 'commerce_orders')
  assert.ok(candidates.ops.some(([op, column, operator, value]) => op === 'not' && column === 'organizations.enable_commerce' && operator === 'is' && value === false))
  assert.ok(candidates.ops.some(([op, column, operator, value]) => op === 'not' && column === 'organizations.enable_messages' && operator === 'is' && value === false))
  assert.match(candidates.ops[0][1], /enable_messages/, 'the switch is read with the store')

  // The platform's kill switch for commerce: nothing is read or sent
  reset()
  const fresh = setup([order('on')])
  const previous = process.env.NEXT_PUBLIC_DISABLED_MODULES
  process.env.NEXT_PUBLIC_DISABLED_MODULES = 'flows, Commerce'
  try {
    const off = await sendCheckoutReminders({ supabase: fresh, now: NOW })
    assert.deepEqual(off, { disabled: true, scanned: 0, sent: 0, failed: 0, waiting: 0, held: 0 })
    assert.equal(resends.length, 0)
    assert.equal(fresh.calls.length, 0)
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_DISABLED_MODULES
    else process.env.NEXT_PUBLIC_DISABLED_MODULES = previous
  }
  process.env.NEXT_PUBLIC_DISABLED_MODULES = 'flows'
  try {
    assert.equal((await sendCheckoutReminders({ supabase: fresh, now: NOW })).sent, 1, 'another module switched off changes nothing here')
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_DISABLED_MODULES
    else process.env.NEXT_PUBLIC_DISABLED_MODULES = previous
  }
})

test('Reminders: an order with no conversation, or a store without WhatsApp, waits instead of failing', async () => {
  reset()
  const db = setup([order('no_chat', { conversation_id: null }), order('disconnected')])
  db.tables.organizations.push({ ...STORE, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', whatsapp_api_token: null })
  byId(db, 'disconnected').organization_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const result = await sendCheckoutReminders({ supabase: db, now: NOW })
  assert.deepEqual(result, { scanned: 2, sent: 0, failed: 0, waiting: 2, held: 0 })
  assert.equal(resends.length, 0)
  assert.equal(byId(db, 'no_chat').next_reminder_at, hoursAgo(-6))
  assert.equal(byId(db, 'disconnected').next_reminder_at, hoursAgo(-6))
})

test('Reminders: a chat a person is handling, or one active in the last hour, is not interrupted', async () => {
  reset()
  const db = setup([
    order('chatbot_off'),
    order('assigned'),
    order('active'),
    order('team_wrote'),
    order('team_wrote_earlier'),
    order('step_sent_later'),
  ], {
    chats: {
      chatbot_off: { auto_reply_enabled: false },
      assigned: { assigned_to: 'user-1' },
      active: { last_message_at: hoursAgo(0.5) },
    },
    lines: [
      // A person replied from the inbox after the cart came in
      { id: 'h1', organization_id: ORG_A, conversation_id: 'conv-team_wrote', sender_type: 'user', body: 'Hi! Shall I keep the book aside for you?', created_at: hoursAgo(1.5) },
      // A person wrote before the cart; the cart is the newer event
      { id: 'h2', organization_id: ORG_A, conversation_id: 'conv-team_wrote_earlier', sender_type: 'user', body: 'Welcome to the store', created_at: hoursAgo(3) },
      // The checkout's own payment request, written after the order changed, is not a person
      { id: 'h3', organization_id: ORG_A, conversation_id: 'conv-step_sent_later', sender_type: 'user', body: '[Sent payment request for Order #ORD-step_sent_later (₹500.00)]', created_at: hoursAgo(1.5) },
    ],
  })

  const result = await sendCheckoutReminders({ supabase: db, now: NOW })
  assert.deepEqual(result, { scanned: 6, sent: 2, failed: 0, waiting: 0, held: 4 })
  assert.deepEqual(resends.map((r) => r.order.id).sort(), ['step_sent_later', 'team_wrote_earlier'])

  for (const id of ['chatbot_off', 'assigned', 'active', 'team_wrote']) {
    const held = byId(db, id)
    assert.equal(held.reminder_count, 0, `${id} got no reminder`)
    assert.equal(held.next_reminder_at, hoursAgo(-6), `${id} is looked at again in six hours`)
  }
  const reasons = Object.fromEntries(warnings.filter((line) => line.includes('looking again')).map((line) => [line.match(/Order #ORD-(\w+)/)[1], line]))
  assert.match(reasons.chatbot_off, /chatbot is off/)
  assert.match(reasons.assigned, /assigned/)
  assert.match(reasons.active, /active in the last hour/)
  assert.match(reasons.team_wrote, /team wrote last/)

  // The chat is read before the step is sent, never after
  const chatReads = queriesOf(db, 'conversations')
  assert.equal(chatReads.length, 6)
  assert.deepEqual(chatReads[0].ops, [
    ['select', 'id, assigned_to, auto_reply_enabled, last_message_at'],
    ['eq', 'organization_id', ORG_A],
    ['or', 'contact_id.eq.contact-chatbot_off,id.eq.conv-chatbot_off'],
    ['order', 'last_message_at', { ascending: false, nullsFirst: false }],
    ['limit', 20],
  ])
})

test('Reminders: the 24-hour window and the live-chat rule look at every conversation of the customer', async () => {
  reset()
  // The order's own chat went quiet long ago; the customer has since written in a newer one
  const db = setup([order('split'), order('split_assigned')], { lastInbound: { split: hoursAgo(30), split_assigned: hoursAgo(30) } })
  db.tables.conversations.push(
    { id: 'conv-split-2', organization_id: ORG_A, contact_id: 'contact-split', assigned_to: null, auto_reply_enabled: true, last_message_at: hoursAgo(2) },
    { id: 'conv-split_assigned-2', organization_id: ORG_A, contact_id: 'contact-split_assigned', assigned_to: 'user-2', auto_reply_enabled: true, last_message_at: hoursAgo(2) },
    { id: 'conv-other-org', organization_id: ORG_B, contact_id: 'contact-split', assigned_to: 'user-9', auto_reply_enabled: false, last_message_at: hoursAgo(0.1) },
  )
  db.tables.messages.push(
    { id: 'n1', organization_id: ORG_A, conversation_id: 'conv-split-2', sender_type: 'contact', body: 'Is the book still available?', created_at: hoursAgo(2) },
    { id: 'n2', organization_id: ORG_A, conversation_id: 'conv-split_assigned-2', sender_type: 'contact', body: 'Hello?', created_at: hoursAgo(2) },
  )

  const result = await sendCheckoutReminders({ supabase: db, now: NOW })
  assert.deepEqual(result, { scanned: 2, sent: 1, failed: 0, waiting: 0, held: 1 })
  assert.deepEqual(resends.map((r) => r.order.id), ['split'])
  assert.equal(byId(db, 'split').reminder_count, 1)
  assert.equal(byId(db, 'split_assigned').reminder_count, 0, 'a person has the customer in another chat')

  // The inbound message is looked for across the customer's chats in this organization
  const windowRead = queriesOf(db, 'messages').find(({ ops }) => ops.some(([op, column, value]) => op === 'eq' && column === 'sender_type' && value === 'contact'))
  const [select, organization, chats, ...rest] = windowRead.ops
  assert.deepEqual([select, organization], [['select', 'created_at'], ['eq', 'organization_id', ORG_A]])
  assert.deepEqual(chats.slice(0, 2), ['in', 'conversation_id'])
  assert.deepEqual([...chats[2]].sort(), ['conv-split', 'conv-split-2'], 'the other organization\'s chat is not among them')
  assert.deepEqual(rest, [
    ['eq', 'sender_type', 'contact'],
    ['order', 'created_at', { ascending: false }],
    ['limit', 1],
    ['maybeSingle'],
  ])
})

test('Reminders: at most `limit` reminders per run, oldest checkout first; the rest wait for the next run', async () => {
  reset()
  const db = setup([order('third', { created_at: hoursAgo(2) }), order('first', { created_at: hoursAgo(5) }), order('second', { created_at: hoursAgo(3) })])
  const result = await sendCheckoutReminders({ supabase: db, now: NOW, limit: 2 })
  assert.equal(result.sent, 2)
  assert.deepEqual(resends.map((r) => r.order.id), ['first', 'second'])
  assert.equal(byId(db, 'third').next_reminder_at, null, 'not even claimed')
})

test('Reminders: an order another scheduler claimed a moment ago is left alone', async () => {
  reset()
  const db = setup([order('contested')])
  // The other run bumps the counter between our read and our claim
  db.beforeQuery = (table, ops) => { if (table === 'commerce_orders' && ops[0][0] === 'update') byId(db, 'contested').reminder_count = 1 }
  const result = await sendCheckoutReminders({ supabase: db, now: NOW })
  assert.deepEqual(result, { scanned: 1, sent: 0, failed: 0, waiting: 0, held: 0 })
  assert.equal(resends.length, 0)
})

test('Reminders: without the migration the job skips, saying so once', async () => {
  reset()
  const db = setup([order('eligible')])
  db.beforeQuery = (table, ops) => (table === 'commerce_orders' && ops[0][0] === 'select' ? { code: '42703', message: 'column commerce_orders.reminder_count does not exist' } : null)
  let result = await sendCheckoutReminders({ supabase: db, now: NOW })
  assert.deepEqual(result, { skipped: true, scanned: 0, sent: 0, failed: 0, waiting: 0, held: 0 })
  assert.equal(resends.length, 0)
  result = await sendCheckoutReminders({ supabase: db, now: NOW })
  assert.equal(result.skipped, true)
  assert.deepEqual(warnings.filter((line) => line.includes(MIGRATION_HINT)), [`[Checkout Reminders] ${MIGRATION_HINT}`])

  // The write path reports a missing column differently
  db.beforeQuery = (table, ops) => (table === 'commerce_orders' && ops[0][0] === 'update' ? { code: 'PGRST204', message: "Could not find the 'next_reminder_at' column of 'commerce_orders' in the schema cache" } : null)
  result = await sendCheckoutReminders({ supabase: db, now: NOW })
  assert.equal(result.skipped, true)
  assert.equal(resends.length, 0)
})

test('Reminders: any other database error is raised for the tick to report', async () => {
  reset()
  const db = setup([order('eligible')])
  db.beforeQuery = (table) => (table === 'messages' ? { code: '57014', message: 'canceling statement due to statement timeout' } : null)
  await assert.rejects(() => sendCheckoutReminders({ supabase: db, now: NOW }), /statement timeout/)

  const fresh = setup([order('eligible')]) // the claim above holds that order for six hours
  fresh.beforeQuery = (table) => (table === 'conversations' ? { code: '57014', message: 'conversations timed out' } : null)
  await assert.rejects(() => sendCheckoutReminders({ supabase: fresh, now: NOW }), /conversations timed out/)
})

test('Reminders: a run whose time is up stops before the next order', async () => {
  reset()
  const db = setup([order('eligible')])
  const result = await sendCheckoutReminders({ supabase: db, now: NOW, deadline: Date.now() - 1 })
  assert.deepEqual(result, { scanned: 0, sent: 0, failed: 0, waiting: 0, held: 0, out_of_time: true })
  assert.equal(resends.length, 0)
})
