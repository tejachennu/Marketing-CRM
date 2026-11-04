// Runs the Twilio status callback route against an in-memory database: a status only moves a
// message and its campaign log forward, and only in the workspace the callback address names.
// Nothing here reaches the network or a real database.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const ORG = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG = '33333333-3333-4333-8333-333333333333'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.invalid'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'

for (const level of ['log', 'warn', 'error']) {
  const original = console[level]
  console[level] = (...args) => { if (!/^\[Status Webhook/.test(String(args[0]))) original(...args) }
}

/**
 * A small in-memory Postgres: eq/in filters, update, and one level of embedded select
 * ("campaign:campaigns(organization_id)"), which is how a log's workspace is found.
 */
function fakeDb() {
  const tables = {}
  const rows = (table) => (tables[table] ||= [])
  return {
    tables,
    seed(table, list) { rows(table).push(...list) },
    from(table) {
      const filters = []
      const state = { op: 'select', payload: null, columns: '*', single: false }
      const builder = {
        select(requested = '*') { state.columns = requested; return builder },
        update(data) { state.op = 'update'; state.payload = data; return builder },
        eq(column, value) { filters.push((row) => row[column] === value); return builder },
        in(column, values) { filters.push((row) => values.includes(row[column])); return builder },
        maybeSingle() { state.single = true; return builder },
        then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject) },
      }
      const project = (row) => {
        if (state.columns === '*') return row
        const out = {}
        for (const spec of state.columns.split(',').map((part) => part.trim())) {
          const embed = spec.match(/^(\w+):(\w+)\((\w+)\)$/)
          if (!embed) { out[spec] = row[spec]; continue }
          const [, alias, other, column] = embed
          const parent = rows(other).find((candidate) => candidate.id === row[`${alias}_id`])
          out[alias] = parent ? { [column]: parent[column] } : null
        }
        return out
      }
      function run() {
        const matching = rows(table).filter((row) => filters.every((test) => test(row)))
        if (state.op === 'update') { for (const row of matching) Object.assign(row, state.payload); return { data: matching, error: null } }
        const projected = matching.map(project)
        return { data: state.single ? projected[0] || null : projected, error: null }
      }
      return builder
    },
  }
}

let db = fakeDb()
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }
stub(require.resolve('@supabase/supabase-js', { paths: [PROJECT] }), { createClient: () => db })

const { POST } = require(path.join(PROJECT, 'app/api/webhooks/twilio/[orgIdAndSlug]/status/route.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))

const twilio = require(require.resolve('twilio', { paths: [PROJECT] }))
const TOKENS = { [ORG]: 'org-auth-token', [OTHER_ORG]: 'other-auth-token' }

/** Twilio posts the status as a form to the workspace's callback address, signed with the account's auth token. */
const callback = async (org, fields, { token = TOKENS[org], signature } = {}) => {
  const url = `https://wamacrm.example.com/api/webhooks/twilio/${org}/status`
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
  const signed = signature !== undefined ? signature : token ? twilio.getExpectedTwilioSignature(token, url, fields) : null
  if (signed) headers['X-Twilio-Signature'] = signed
  const res = await POST(new NextRequest(url, { method: 'POST', headers, body: new URLSearchParams(fields).toString() }), { params: { orgIdAndSlug: org } })
  return res.status
}
const seed = () => {
  db = fakeDb()
  db.seed('messages', [
    { id: 'out-1', organization_id: ORG, twilio_message_sid: 'SM1', status: 'sent', error_message: null },
    { id: 'out-2', organization_id: ORG, twilio_message_sid: 'SM2', status: 'sent', error_message: null },
    { id: 'elsewhere', organization_id: OTHER_ORG, twilio_message_sid: 'SM1', status: 'sent', error_message: null },
  ])
  db.seed('organizations', [{ id: ORG, twilio_auth_token: TOKENS[ORG] }, { id: OTHER_ORG, twilio_auth_token: TOKENS[OTHER_ORG] }])
  db.seed('campaigns', [{ id: 'camp-1', organization_id: ORG }, { id: 'camp-9', organization_id: OTHER_ORG }])
  db.seed('campaign_logs', [
    { id: 'log-1', campaign_id: 'camp-1', status: 'SENT', error_message: null, message_sid: 'SM1' },
    { id: 'log-2', campaign_id: 'camp-1', status: 'SENT', error_message: null, message_sid: 'SM2' },
    { id: 'log-9', campaign_id: 'camp-9', status: 'SENT', error_message: null, message_sid: 'SM1' },
  ])
  const row = (table, id) => db.tables[table].find((candidate) => candidate.id === id)
  return { message: (id) => row('messages', id), log: (id) => row('campaign_logs', id) }
}

test('Twilio status: a status only moves forward, for the message and its campaign log, in this workspace only', async () => {
  const { message, log } = seed()
  assert.equal(await callback(ORG, { MessageSid: 'SM1', MessageStatus: 'read' }), 200)
  assert.equal(message('out-1').status, 'read')
  assert.ok(message('out-1').read_at, 'read time recorded')
  assert.equal(log('log-1').status, 'READ', 'the campaign log followed, although campaign_logs has no organization_id column')
  // Twilio's callbacks arrive out of order and again: a late "delivered" or "sent" changes nothing
  await callback(ORG, { MessageSid: 'SM1', MessageStatus: 'delivered' })
  await callback(ORG, { MessageSid: 'SM1', MessageStatus: 'sent' })
  assert.equal(message('out-1').status, 'read')
  assert.equal(log('log-1').status, 'READ')
  // A failure after the customer read it changes nothing either
  await callback(ORG, { MessageSid: 'SM1', MessageStatus: 'failed', ErrorCode: '30008' })
  assert.equal(message('out-1').status, 'read')
  assert.equal(message('out-1').error_message, null)
  assert.equal(log('log-1').status, 'READ')
  // The other workspace's message and campaign log with the same SID are untouched
  assert.equal(message('elsewhere').status, 'sent')
  assert.equal(log('log-9').status, 'SENT')
})

test('Twilio status: an undelivered message keeps the reason, and nothing comes back from it', async () => {
  const { message, log } = seed()
  assert.equal(await callback(ORG, { MessageSid: 'SM2', MessageStatus: 'undelivered', ErrorCode: '63016' }), 200)
  assert.equal(message('out-2').status, 'undelivered')
  assert.equal(message('out-2').error_message, 'Twilio Error 63016')
  assert.equal(log('log-2').status, 'FAILED')
  assert.equal(log('log-2').error_message, 'Twilio Error 63016')
  await callback(ORG, { MessageSid: 'SM2', MessageStatus: 'delivered' })
  await callback(ORG, { MessageSid: 'SM2', MessageStatus: 'failed', ErrorCode: '30008' })
  assert.equal(message('out-2').status, 'undelivered')
  assert.equal(message('out-2').error_message, 'Twilio Error 63016')
  assert.equal(log('log-2').status, 'FAILED')
  // Twilio's own wording is kept when it gives one
  await callback(ORG, { MessageSid: 'SM1', MessageStatus: 'failed', ErrorCode: '63016', ErrorMessage: 'Failed to send freeform message because you are outside the allowed window.' })
  assert.equal(message('out-1').status, 'failed')
  assert.equal(message('out-1').error_message, 'Failed to send freeform message because you are outside the allowed window.')
  assert.equal(log('log-1').error_message, message('out-1').error_message)
})

test("Twilio status: a callback at another workspace's address never touches this one", async () => {
  const { message, log } = seed()
  assert.equal(await callback(OTHER_ORG, { MessageSid: 'SM1', MessageStatus: 'delivered' }), 200)
  assert.equal(message('elsewhere').status, 'delivered')
  assert.equal(log('log-9').status, 'DELIVERED')
  assert.equal(message('out-1').status, 'sent')
  assert.equal(log('log-1').status, 'SENT')
  // An address that names no workspace, or an empty callback, is acknowledged and changes nothing
  assert.equal(await callback('not-a-workspace', { MessageSid: 'SM1', MessageStatus: 'read' }), 200)
  assert.equal(await callback(ORG, {}), 200)
  assert.equal(message('out-1').status, 'sent')
  assert.equal(log('log-1').status, 'SENT')
})

test('Twilio status: only a callback Twilio signed with this workspace\'s auth token changes anything', async () => {
  const { message, log } = seed()
  const delivered = { MessageSid: 'SM1', MessageStatus: 'delivered' }
  assert.equal(await callback(ORG, delivered, { token: null }), 403)                    // unsigned
  assert.equal(await callback(ORG, delivered, { token: TOKENS[OTHER_ORG] }), 403)       // another workspace's account
  assert.equal(await callback(ORG, delivered, { signature: 'forged' }), 403)
  // Signed for other fields than the ones posted
  const url = `https://wamacrm.example.com/api/webhooks/twilio/${ORG}/status`
  assert.equal(await callback(ORG, delivered, { signature: twilio.getExpectedTwilioSignature(TOKENS[ORG], url, { MessageSid: 'SM1', MessageStatus: 'sent' }) }), 403)
  assert.equal(message('out-1').status, 'sent')
  assert.equal(log('log-1').status, 'SENT')

  // A workspace without a saved token: nothing can be checked, so nothing is accepted
  db.tables.organizations[0].twilio_auth_token = null
  assert.equal(await callback(ORG, delivered, { token: TOKENS[ORG] }), 403)
  assert.equal(message('out-1').status, 'sent')

  // The documented switch for local tunnels
  process.env.TWILIO_WEBHOOK_ALLOW_UNSIGNED = 'true'
  try {
    assert.equal(await callback(ORG, delivered, { token: null }), 200)
    assert.equal(message('out-1').status, 'delivered')
  } finally {
    delete process.env.TWILIO_WEBHOOK_ALLOW_UNSIGNED
  }
})

test('Twilio status: a proxy in front of the app does not break the signature', async () => {
  const { message } = seed()
  const fields = { MessageSid: 'SM2', MessageStatus: 'delivered' }
  // Twilio signed the public address; the request arrives at an internal one with forwarding headers
  const publicUrl = `https://crm.example.com/api/webhooks/twilio/${ORG}/status`
  const request = new NextRequest(`http://10.0.0.5:3000/api/webhooks/twilio/${ORG}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-Host': 'crm.example.com', 'X-Forwarded-Proto': 'https', 'X-Twilio-Signature': twilio.getExpectedTwilioSignature(TOKENS[ORG], publicUrl, fields) },
    body: new URLSearchParams(fields).toString(),
  })
  assert.equal((await POST(request, { params: { orgIdAndSlug: ORG } })).status, 200)
  assert.equal(message('out-2').status, 'delivered')
})
