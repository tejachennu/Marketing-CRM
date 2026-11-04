// Sending a product from the store: which chat the send is logged in, against a fake database and
// a stubbed WhatsApp send. Nothing here reaches the network or a real database.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const ORG = '99999999-9999-4999-8999-999999999999'
const CATALOG = '700600500400300'
const CONTACT = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const CHAT = '33333333-3333-4333-8333-333333333333'
const OTHER_CHAT = '44444444-4444-4444-8444-444444444444'
const FOREIGN_CHAT = '55555555-5555-4555-8555-555555555555'
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

/** A stand-in for the Supabase client over in-memory tables: the part of the query builder this route uses. */
function fakeDb(tables) {
  const data = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]))
  return {
    tables: data,
    from(table) {
      const rows = data[table] || (data[table] = [])
      const filters = []
      let operation = { type: 'select' }
      let window = null
      let one = null
      const matching = () => rows.filter((row) => filters.every((filter) => filter(row)))
      const run = () => {
        let result
        if (operation.type === 'update') {
          result = matching()
          for (const row of result) Object.assign(row, operation.values)
        } else if (operation.type === 'insert') {
          result = operation.rows.map((row, index) => ({ id: `msg-${rows.length + index + 1}`, ...row }))
          rows.push(...result)
        } else {
          result = matching()
          if (window) result = result.slice(window[0], window[1] + 1)
        }
        if (one === 'single') return { data: result[0] || null, error: result[0] ? null : { code: 'PGRST116', message: 'no rows' } }
        if (one === 'maybeSingle') return { data: result[0] || null, error: null }
        return { data: result, error: null }
      }
      const query = {
        select: () => query,
        update: (values) => { operation = { type: 'update', values }; return query },
        insert: (values) => { operation = { type: 'insert', rows: [].concat(values) }; return query },
        eq: (column, value) => { filters.push((row) => row[column] === value); return query },
        in: (column, values) => { filters.push((row) => values.includes(row[column])); return query },
        order: () => query,
        limit: (count) => { window = [0, count - 1]; return query },
        single: () => { one = 'single'; return query },
        maybeSingle: () => { one = 'maybeSingle'; return query },
        then: (resolve, reject) => new Promise((settle) => settle(run())).then(resolve, reject),
      }
      return query
    },
  }
}

let db = fakeDb({})
const sent = []
stub(require.resolve('@supabase/supabase-js', { paths: [PROJECT] }), { createClient: () => db })
stub(path.join(PROJECT, 'lib/api-auth-helper.ts'), { verifyOrgAccess: async () => ({ authorized: true, user: { id: 'u1', role: 'org_admin', organization_id: ORG } }), getSupabaseAdminClient: () => db })
// WhatsApp accepts every message; what was sent is recorded
stub(path.join(PROJECT, 'lib/commerce/commerce-webhook-handler.ts'), { sendWhatsAppMessage: async (organization, payload) => { sent.push(payload); return { ok: true, messageId: 'wamid.1' } } })
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.invalid'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'
console.error = () => {}

const route = require(path.join(PROJECT, 'app/api/commerce/send/route.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))
const post = (body) => route.POST(new NextRequest('https://wamacrm.example.com/api/commerce/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ organizationId: ORG, type: 'single_product', payload: { productRetailerId: 'SHIRT-001', productTitle: 'White linen shirt' }, ...body }),
}))

function reset() {
  db = fakeDb({
    organizations: [{ id: ORG, meta_catalog_id: CATALOG, whatsapp_api_token: 'TOKEN', whatsapp_phone_number_id: '300000000000001', whatsapp_graph_api_version: 'v25.0' }],
    contacts: [
      { id: CONTACT, organization_id: ORG, phone_number: '+919876543210' },
      { id: OTHER, organization_id: ORG, phone_number: '+919999999999' },
    ],
    conversations: [
      { id: CHAT, organization_id: ORG, contact_id: CONTACT, last_message_at: '2026-10-01T00:00:00.000Z' },
      { id: OTHER_CHAT, organization_id: ORG, contact_id: OTHER, last_message_at: '2026-10-02T00:00:00.000Z' },
      { id: FOREIGN_CHAT, organization_id: 'another-org', contact_id: CONTACT, last_message_at: '2026-10-03T00:00:00.000Z' },
    ],
    messages: [],
  })
  sent.length = 0
}

test('Send: a product goes into the contact’s own chat, never into another contact’s', async () => {
  reset()
  // The chat named belongs to another contact: nothing is sent or logged
  const wrong = await post({ contactId: CONTACT, conversationId: OTHER_CHAT })
  assert.equal(wrong.status, 404)
  assert.match((await wrong.json()).error, /Conversation not found/)
  assert.equal(sent.length, 0)
  assert.equal(db.tables.messages.length, 0)

  // The contact's chat
  const ok = await post({ contactId: CONTACT, conversationId: CHAT })
  assert.equal(ok.status, 200)
  const data = await ok.json()
  assert.deepEqual([data.success, data.conversationId, data.phone, data.messageId], [true, CHAT, '+919876543210', 'FB_wamid.1'])
  assert.equal(sent[0].to, '919876543210')
  assert.equal(sent[0].interactive.action.product_retailer_id, 'SHIRT-001')
  assert.deepEqual(db.tables.messages.map((message) => [message.conversation_id, message.organization_id]), [[CHAT, ORG]])

  // Another store's chat, even for the same contact
  assert.equal((await post({ contactId: CONTACT, conversationId: FOREIGN_CHAT })).status, 404)
  assert.equal(sent.length, 1)
})

test('Send: a phone number that belongs to a contact is held to the same rule', async () => {
  reset()
  assert.equal((await post({ phone: '+91 98765 43210', conversationId: OTHER_CHAT })).status, 404)
  assert.equal(sent.length, 0)

  // No chat named: the contact's latest one is used
  const latest = await (await post({ phone: '+91 98765 43210' })).json()
  assert.equal(latest.conversationId, CHAT)
  assert.deepEqual(db.tables.messages.map((message) => message.conversation_id), [CHAT])

  // A number that is not a contact's can only be logged in a chat of this store
  const unknown = await (await post({ phone: '+91 91234 56789', conversationId: CHAT })).json()
  assert.equal(unknown.conversationId, CHAT)
  assert.equal((await post({ phone: '+91 91234 56789', conversationId: FOREIGN_CHAT })).status, 404)
})
