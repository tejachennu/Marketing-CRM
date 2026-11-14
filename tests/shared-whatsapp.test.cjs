require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const SW = require('../lib/shared-whatsapp.ts')
const W = require('../lib/salon/whatsapp.ts')

const ENV = { WAMA_SHARED_PHONE_NUMBER_ID: '555', WAMA_SHARED_WABA_ID: '777', WAMA_SHARED_ACCESS_TOKEN: 'token', META_PRICE_UTILITY_INR: '0.5' }

function withEnv(values, fn) {
  const before = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]))
  Object.assign(process.env, values)
  return Promise.resolve().then(fn).finally(() => { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } })
}

/** A small Supabase stand-in: tables, eq filters, order desc by created_at, and the message wallet functions. */
function database(seed = {}) {
  const tables = { organization_billing: [], message_wallet_transactions: [], shared_messages: [], salon_settings: [], organizations: [], ...structuredClone(seed) }
  let stamp = Date.parse('2026-11-11T10:00:00Z')
  const from = (table) => {
    let filters = [], op = 'select', values, singular = false, limit = Infinity
    const q = {
      select() { return q }, eq(k, v) { filters.push((r) => r[k] === v); return q }, in(k, list) { filters.push((r) => list.includes(r[k])); return q }, order() { return q }, limit(n) { limit = n; return q },
      maybeSingle() { singular = true; return q }, single() { singular = true; return q },
      insert(data) { op = 'insert'; values = data; return q }, update(data) { op = 'update'; values = data; return q },
      then(resolve, reject) {
        tables[table] = tables[table] || []
        let rows = tables[table].filter((r) => filters.every((f) => f(r)))
        if (op === 'insert') { rows = [{ created_at: new Date(stamp += 1000).toISOString(), ...values }]; tables[table].push(...rows) }
        else if (op === 'update') rows.forEach((r) => Object.assign(r, values))
        else rows = [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit)
        return Promise.resolve({ data: singular ? rows[0] || null : rows, error: null }).then(resolve, reject)
      },
    }
    return q
  }
  const rpc = async (fn, args) => {
    const ledger = tables.message_wallet_transactions
    if (fn === 'message_wallet_charge') {
      const b = tables.organization_billing.find((r) => r.organization_id === args.p_org)
      if (!b || b.message_balance < args.p_amount) return { data: false, error: null }
      b.message_balance -= args.p_amount
      ledger.push({ organization_id: args.p_org, kind: 'usage', amount: -args.p_amount, message_ref: args.p_ref })
      return { data: true, error: null }
    }
    if (fn === 'message_wallet_refund') {
      const charge = ledger.find((t) => t.message_ref === args.p_ref && t.kind === 'usage')
      if (!charge || ledger.some((t) => t.message_ref === args.p_ref && t.kind === 'refund')) return { data: 0, error: null }
      tables.organization_billing.find((r) => r.organization_id === charge.organization_id).message_balance -= charge.amount
      ledger.push({ kind: 'refund', amount: -charge.amount, message_ref: args.p_ref })
      return { data: -charge.amount, error: null }
    }
    return { data: null, error: { message: 'unknown ' + fn } }
  }
  return { from, rpc, tables }
}

/** Replace fetch for graph.facebook.com; answers in order. */
function mockFetch(answers) {
  const calls = []
  const original = global.fetch
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null })
    const [status, body] = answers.length > 1 ? answers.shift() : answers[0]
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }
  return { calls, restore: () => { global.fetch = original } }
}

const seed = () => ({
  organization_billing: [{ organization_id: 'org-1', whatsapp_mode: 'shared', billing_exempt: false, message_balance: 1 }],
  salon_settings: [{ organization_id: 'org-1', business_name: 'Glow Salon', phone: '+91 98480 12345' }],
  organizations: [{ id: 'org-1', name: 'Glow', contact_phone: null }],
})

test('Shared number: templates name the business, give its phone and say no replies', () => {
  for (const t of SW.SHARED_TEMPLATES) {
    assert.match(t.body, /does not take replies/)
    assert.equal((t.body.match(/\{\{\d+\}\}/g) || []).length, t.params.length)
    assert.equal(t.example.length, t.params.length)
    assert.ok(t.params.includes('business') && t.params.includes('phone'))
  }
  assert.deepEqual(SW.SHARED_TEMPLATES.map((t) => t.purpose).sort(), ['bill', 'booking', 'feedback', 'reminder'])
  const def = SW.sharedTemplateDefinition(SW.sharedTemplateFor('bill'), 'https://wamacrm.magnetora.in/')
  assert.equal(def.category, 'UTILITY')
  assert.equal(def.components[1].buttons[0].url, 'https://wamacrm.magnetora.in/i/{{1}}')
})

test('Shared number: the message fills each blank, with the business phone and the link button', () => {
  const payload = SW.sharedTemplatePayload(SW.sharedTemplateFor('bill'), '+91 90000 11111', { first_name: 'Priya', business: 'Glow Salon', bill_number: 'INV-1', amount: '₹500', link: 'tok123' }, '+91 98480 12345')
  assert.equal(payload.to, '919000011111')
  assert.equal(payload.template.name, 'wama_bill_ready')
  assert.deepEqual(payload.template.components[0].parameters.map((p) => p.text), ['Priya', 'Glow Salon', 'INV-1', '₹500', '+91 98480 12345'])
  assert.deepEqual(payload.template.components[1].parameters, [{ type: 'text', text: 'tok123' }])
})

test('Shared number: a Starter workspace\'s booking goes from WAMA\'s number, paid from the wallet', async () => {
  await withEnv(ENV, async () => {
    const db = database(seed())
    const fetch = mockFetch([[200, { messages: [{ id: 'wamid.1' }] }]])
    try {
      const result = await W.sendToCustomer(db, 'org-1', '+91 90000 11111', { text: 'hi', logBody: 'hi' }, { purpose: 'booking', values: { first_name: 'Priya', business: 'Glow Salon', date_time: 'Sat at 4 pm', visit: 'Haircut' } })
      assert.deepEqual(result, { sent: true, viaTemplate: true })
      assert.match(fetch.calls[0].url, /\/555\/messages$/)
      assert.equal(fetch.calls[0].body.template.name, 'wama_booking_confirmed')
      assert.equal(db.tables.organization_billing[0].message_balance, 0.5)
      assert.equal(db.tables.shared_messages[0].meta_message_id, 'wamid.1')
    } finally { fetch.restore() }
  })
})

test('Shared number: nothing is sent when the wallet is short, and a refused message is given back', async () => {
  await withEnv(ENV, async () => {
    const db = database(seed())
    db.tables.organization_billing[0].message_balance = 0.2
    let fetch = mockFetch([[200, { messages: [{ id: 'x' }] }]])
    try {
      const short = await SW.sendShared(db, 'org-1', '9000011111', 'reminder', { first_name: 'A', business: 'B', time: '4 pm', visit: 'C' })
      assert.equal(short.walletEmpty, true)
      assert.equal(fetch.calls.length, 0)
    } finally { fetch.restore() }
    db.tables.organization_billing[0].message_balance = 1
    fetch = mockFetch([[400, { error: { message: 'Recipient not on WhatsApp', code: 131026 } }]])
    try {
      const refused = await SW.sendShared(db, 'org-1', '9000011111', 'reminder', { first_name: 'A', business: 'B', time: '4 pm', visit: 'C' })
      assert.equal(refused.sent, false)
      assert.equal(db.tables.organization_billing[0].message_balance, 1)
    } finally { fetch.restore() }
  })
})

test('Shared number: a message Meta later reports failed is given back once', async () => {
  await withEnv(ENV, async () => {
    const db = database(seed())
    const fetch = mockFetch([[200, { messages: [{ id: 'wamid.9' }] }]])
    try {
      await SW.sendShared(db, 'org-1', '9000011111', 'booking', { first_name: 'A', business: 'B', date_time: 'x', visit: 'y' })
    } finally { fetch.restore() }
    assert.equal(db.tables.organization_billing[0].message_balance, 0.5)
    await SW.handleSharedStatus(db, { id: 'wamid.9', status: 'failed', errors: [{ title: 'Undeliverable' }] })
    await SW.handleSharedStatus(db, { id: 'wamid.9', status: 'failed' })
    assert.equal(db.tables.organization_billing[0].message_balance, 1)
    assert.equal(db.tables.shared_messages[0].status, 'failed')
  })
})

test('Shared number: a customer who replies gets the business\'s phone, once a day', async () => {
  await withEnv(ENV, async () => {
    const db = database(seed())
    db.tables.shared_messages.push({ organization_id: 'org-1', phone: '9000011111', purpose: 'booking', created_at: '2026-11-11T09:00:00Z' })
    const fetch = mockFetch([[200, { messages: [{ id: 'auto' }] }]])
    try {
      const now = Date.parse('2026-11-11T12:00:00Z')
      assert.deepEqual(await SW.handleSharedIncoming(db, '919000011111', now), { replied: true, known: true })
      assert.match(fetch.calls[0].body.text.body, /Glow Salon.*\+91 98480 12345/)
      assert.deepEqual(await SW.handleSharedIncoming(db, '919000011111', now + 3600_000), { replied: false, known: true })
      // A stranger we never wrote to gets nothing
      assert.deepEqual(await SW.handleSharedIncoming(db, '919999999999', now), { replied: false })
      assert.equal(fetch.calls.length, 1)
    } finally { fetch.restore() }
  })
})

test('Shared number: a plain text (not a booking message) is not sent from WAMA\'s number', async () => {
  await withEnv(ENV, async () => {
    const db = database(seed())
    const result = await W.sendToCustomer(db, 'org-1', '9000011111', { text: 'hello', logBody: 'hello' })
    assert.equal(result.sent, false)
    assert.match(result.error, /booking messages only/)
  })
})

test('Shared number: WAMA CRM\'s own WhatsApp settings are used when no separate number is set', () => {
  const own = { WHATSAPP_PHONE_NUMBER_ID: '111', WHATSAPP_BUSINESS_ACCOUNT_ID: '222', WHATSAPP_API_TOKEN: 'tok', WHATSAPP_GRAPH_API_VERSION: 'v21.0' }
  assert.deepEqual(SW.sharedConfig(own), { phoneNumberId: '111', wabaId: '222', token: 'tok', graphVersion: 'v21.0' })
  assert.equal(SW.sharedConfig({ ...own, WAMA_SHARED_PHONE_NUMBER_ID: '999', WAMA_SHARED_ACCESS_TOKEN: 't2' }).phoneNumberId, '999')
  // The platform number on Twilio cannot send Meta templates
  assert.equal(SW.sharedConfig({ ...own, WHATSAPP_PROVIDER: 'twilio' }), null)
  assert.equal(SW.sharedConfig({}), null)
})

test('Shared number: with nothing in Vercel, the number connected in WAMA CRM\'s own workspace is used', async () => {
  const none = { WAMA_SHARED_PHONE_NUMBER_ID: '', WAMA_SHARED_ACCESS_TOKEN: '', WHATSAPP_PHONE_NUMBER_ID: '', WHATSAPP_API_TOKEN: '', WAMA_SHARED_WORKSPACE_ID: '' }
  await withEnv(none, async () => {
    SW.resetSharedNumber()
    const platform = { id: '303b7a2d-281c-403c-b794-54d1e195ca69', name: 'WAMA CRM', whatsapp_provider: 'twilio' }
    const magnetora = { id: 'b2acf062-c379-49f2-8905-267413c9c394', name: 'Magnetora', whatsapp_provider: 'facebook', whatsapp_api_token: 'tok', whatsapp_phone_number_id: '42', whatsapp_business_account_id: '77' }
    const found = await SW.findSharedNumber(database({ organizations: [platform, magnetora] }))
    assert.deepEqual(found.config, { phoneNumberId: '42', wabaId: '77', token: 'tok', graphVersion: 'v25.0' })
    assert.match(found.from, /Magnetora/)
    SW.resetSharedNumber()
    const missing = await SW.findSharedNumber(database({ organizations: [platform] }))
    assert.equal(missing.config, null)
    assert.match(missing.why, /Twilio/)
  })
})
