// POST /api/messages/send: who takes a chat and when, whose customer may not be written to, where
// the message goes, the 24-hour window, and the media download guard. Against a fake database,
// fake Meta and Twilio APIs and a fake resolver; nothing here reaches the network.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const dns = require('node:dns')
const http = require('node:http')
const https = require('node:https')
const { EventEmitter } = require('node:events')
const { Readable } = require('node:stream')

const PROJECT = path.join(__dirname, '..')
const ORG = '99999999-9999-4999-8999-999999999999'
const OTHER_ORG = '88888888-8888-4888-8888-888888888888'
const AGENT = '11111111-1111-4111-8111-111111111111'
const TEAMMATE = '22222222-2222-4222-8222-222222222222'
const MANAGER = '33333333-3333-4333-8333-333333333333'
const CONTACT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const STRANGER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' // a contact of another organization
const CHAT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }
const hoursAgo = (hours) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

// ── A fake database over in-memory rows, remembering every write and the order of events ──

const tables = {}
const timeline = [] // 'meta-send' | 'twilio-send' | { table, values, where }
const reads = [] // every select, as { table, where, limit }
const fake = { failSelect: null } // (table, where) => true makes that select fail, as a timed-out statement does
let nextId = 1
const db = {
  from(table) {
    const filters = []
    const where = []
    let action = 'select'
    let values = null
    let ordering = null
    let limit = null
    let shape = 'many'
    const finish = (rows) => {
      const copies = rows.map((row) => ({ ...row }))
      if (shape === 'single') return copies.length === 1 ? { data: copies[0], error: null } : { data: null, error: { code: 'PGRST116', message: `${copies.length} rows` } }
      if (shape === 'maybe') return { data: copies[0] || null, error: null }
      return { data: copies, error: null }
    }
    const run = () => {
      const rows = tables[table] || (tables[table] = [])
      if (action === 'insert') {
        const created = values.map((row) => ({ id: `${table}-${nextId++}`, created_at: new Date().toISOString(), ...row }))
        rows.push(...created)
        timeline.push({ table, values: created, where: [] })
        return finish(created)
      }
      if (action === 'select') {
        reads.push({ table, where, limit })
        if (fake.failSelect && fake.failSelect(table, where)) return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
      }
      let matched = rows.filter((row) => filters.every((filter) => filter(row)))
      if (action === 'update') {
        timeline.push({ table, values, where })
        for (const row of matched) Object.assign(row, values)
        return finish(matched)
      }
      if (ordering) {
        const { column, ascending } = ordering
        matched.sort((a, b) => (ascending ? 1 : -1) * String(a[column] ?? '').localeCompare(String(b[column] ?? '')))
      }
      if (limit !== null) matched = matched.slice(0, limit)
      return finish(matched)
    }
    const query = {
      select: () => query,
      insert: (rows) => { action = 'insert'; values = rows; return query },
      update: (patch) => { action = 'update'; values = patch; return query },
      eq: (column, value) => { where.push(['eq', column, value]); filters.push((row) => row[column] === value); return query },
      is: (column, value) => { where.push(['is', column, value]); filters.push((row) => (value === null ? row[column] == null : row[column] === value)); return query },
      not: (column, operator, value) => { where.push(['not', column, operator, value]); filters.push((row) => (operator === 'is' && value === null ? row[column] != null : row[column] !== value)); return query },
      in: (column, values) => { where.push(['in', column, values]); filters.push((row) => values.includes(row[column])); return query },
      order: (column, { ascending = true } = {}) => { ordering = { column, ascending }; return query },
      limit: (count) => { limit = count; return query },
      single: () => { shape = 'single'; return query },
      maybeSingle: () => { shape = 'maybe'; return query },
      then: (resolve, reject) => Promise.resolve().then(run).then(resolve, reject),
    }
    return query
  },
}

// ── Fake Meta, Twilio and resolver ──

const meta = { fails: false }
const metaSent = [] // payloads posted to /messages
const uploads = [] // files posted to /media
const fetched = [] // every GET of a media URL, with the URL and options it was opened with
let mediaAnswers = {} // url → () => a fake response
global.fetch = async (input, init = {}) => {
  const url = new URL(String(input))
  if (url.hostname === 'graph.facebook.com' && url.pathname.endsWith('/messages')) {
    metaSent.push(JSON.parse(init.body))
    timeline.push('meta-send')
    if (meta.fails) return new Response(JSON.stringify({ error: { message: 'Message failed to send because more than 24 hours have passed', code: 131047 } }), { status: 400 })
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.SENT1' }] }))
  }
  if (url.hostname === 'graph.facebook.com' && url.pathname.endsWith('/media')) {
    uploads.push(init.body.get('file'))
    return new Response(JSON.stringify({ id: 'MEDIA_1' }))
  }
  throw new Error('Unexpected fetch: ' + url.href)
}

// Media is downloaded with node:http(s), each connection through a checked lookup: a fake transport
// records how each request was opened and answers from mediaAnswers
const originalRequests = { http: http.request, https: https.request }
function fakeRequest(url, options, callback) {
  fetched.push({ url: url.href, target: url, options })
  const request = new EventEmitter()
  request.end = () => setImmediate(() => {
    const answer = mediaAnswers[url.href]
    if (!answer) return request.emit('error', new Error('Unexpected request: ' + url.href))
    callback(answer())
  })
  return request
}
http.request = fakeRequest
https.request = fakeRequest
test.after(() => { http.request = originalRequests.http; https.request = originalRequests.https })
/** A response as http.request hands it over: a stream with a status and lower-case headers. */
function mediaResponse(status, headers, body = Buffer.alloc(0)) {
  return Object.assign(Readable.from(body.length ? [body] : []), { statusCode: status, statusMessage: status === 200 ? 'OK' : '', headers })
}

const twilio = { fails: false }
const twilioSent = []
stub(require.resolve('twilio', { paths: [PROJECT] }), () => ({
  messages: {
    create: async (params) => {
      timeline.push('twilio-send')
      if (twilio.fails) throw new Error('Twilio could not deliver the message')
      twilioSent.push(params)
      return { sid: 'SM_SENT1' }
    },
  },
}))

const addresses = { 'cdn.example.com': ['93.184.216.34'], 'inside.example.com': ['10.0.0.8'] }
dns.promises.lookup = async (host, options) => {
  const list = addresses[host]
  if (!list) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' })
  const entries = list.map((address) => ({ address, family: 4 }))
  return options?.all ? entries : entries[0]
}

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.invalid'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'
let caller = {}
stub(require.resolve('@supabase/supabase-js', { paths: [PROJECT] }), { createClient: () => db })
stub(path.join(PROJECT, 'lib/api-auth-helper.ts'), { verifyOrgAccess: async () => ({ authorized: true, user: caller }) })
console.log = () => {}
console.warn = () => {}
console.error = () => {}

const route = require(path.join(PROJECT, 'app/api/messages/send/route.ts'))
const { lookupPublicAddress } = require(path.join(PROJECT, 'lib/utils.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))

const manager = { id: MANAGER, role: 'org_manager', organization_id: ORG }
const agent = { id: AGENT, role: 'sales_employee', organization_id: ORG }

async function send(body) {
  const request = new NextRequest('https://wamacrm.example.com/api/messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const res = await route.POST(request)
  return { status: res.status, ...(await res.json()) }
}
const chat = () => tables.conversations.find((row) => row.id === CHAT)
const stored = () => tables.messages.filter((row) => row.sender_type === 'user')
const assignments = () => timeline.filter((event) => event.table === 'conversations' && 'assigned_to' in (event.values || {}))
const template = { templateName: 'order_update', templateSid: 'order_update', templateLanguage: 'en', templateMetaComponents: [{ type: 'BODY', text: 'Your order {{1}} is on its way' }], templateVariables: { 1: '42' } }

function reset({ provider = 'facebook', lastInboundHoursAgo = 1, conversation = {} } = {}) {
  meta.fails = false
  twilio.fails = false
  fake.failSelect = null
  caller = agent
  metaSent.length = 0
  uploads.length = 0
  fetched.length = 0
  twilioSent.length = 0
  timeline.length = 0
  reads.length = 0
  mediaAnswers = {}
  tables.organizations = [{
    id: ORG, whatsapp_provider: provider, whatsapp_api_token: 'META_TOKEN', whatsapp_phone_number_id: '600000000000001',
    twilio_account_sid: 'AC1', twilio_auth_token: 'tok', twilio_whatsapp_number: '+15550001111', enable_sms: true, enable_messages: true,
  }]
  tables.contacts = [
    { id: CONTACT, organization_id: ORG, phone_number: '+14165550123', first_name: 'Asha' },
    { id: STRANGER, organization_id: OTHER_ORG, phone_number: '+14165550999' },
  ]
  // Handed to the team by the chatbot: nobody assigned, chatbot off
  tables.conversations = [{ id: CHAT, organization_id: ORG, contact_id: CONTACT, assigned_to: null, auto_reply_enabled: false, handed_off_at: hoursAgo(2), last_message_at: hoursAgo(1), ...conversation }]
  tables.messages = lastInboundHoursAgo === null ? [] : [{ id: 'inbound-1', organization_id: ORG, conversation_id: CHAT, sender_type: 'contact', body: 'Hi', created_at: hoursAgo(lastInboundHoursAgo) }]
  tables.leads = []
  tables.tickets = []
  tables.users = [{ id: TEAMMATE, organization_id: ORG, full_name: 'Priya Nair', email: 'priya@example.com' }, { id: AGENT, organization_id: ORG, full_name: 'Ravi', email: 'ravi@example.com' }]
}

test('Send: an assigned-only agent who replies to a handed-off chat takes it, once the message is away', async () => {
  reset()
  const answer = await send({ conversationId: CHAT, message: 'Hello from Ravi', channel: 'whatsapp' })
  assert.equal(answer.status, 200)
  assert.equal(answer.success, true)
  assert.equal(metaSent[0].to, '14165550123')
  assert.equal(chat().assigned_to, AGENT)
  assert.equal(chat().auto_reply_enabled, false)

  // Claimed after the send, with the organization and the "still unowned" condition in the query
  const [claim] = assignments()
  assert.ok(claim, 'the chat was claimed')
  assert.ok(timeline.indexOf(claim) > timeline.indexOf('meta-send'), 'the claim comes after the send')
  assert.deepEqual(claim.values, { assigned_to: AGENT, handed_off_at: null })
  assert.equal(chat().handed_off_at, null) // out of the hand-off queue
  assert.deepEqual(claim.where, [['eq', 'id', CHAT], ['eq', 'organization_id', ORG], ['is', 'assigned_to', null]])
  assert.equal(stored()[0].status, 'sent')
})

test('Send: before the hand-off migration an agent does not answer an unowned chat with the chatbot off', async () => {
  // A row without handed_off_at: the chatbot being off may only mean a manager is answering, so it
  // is no hand-off, and the agent neither reads, answers nor takes the chat
  reset()
  delete chat().handed_off_at
  const answer = await send({ conversationId: CHAT, message: 'Hello from Ravi', channel: 'whatsapp' })
  assert.equal(answer.status, 403)
  assert.equal(metaSent.length, 0)
  assert.equal(chat().assigned_to, null)
  assert.equal(assignments().length, 0)

  // The agent's own lead still lets them in, and their reply takes the chat
  reset()
  delete chat().handed_off_at
  tables.leads = [{ id: 'lead-1', organization_id: ORG, contact_id: CONTACT, assigned_to: AGENT, status: 'active' }]
  assert.equal((await send({ conversationId: CHAT, message: 'Hello from Ravi', channel: 'whatsapp' })).status, 200)
  assert.equal(chat().assigned_to, AGENT)

  // A manager answers as before
  reset()
  delete chat().handed_off_at
  caller = manager
  assert.equal((await send({ conversationId: CHAT, message: 'Hello', channel: 'whatsapp' })).status, 200)
  assert.equal(chat().assigned_to, null)
})

test('Send: a send that fails leaves the chat unowned, the failed message still on record', async () => {
  reset()
  meta.fails = true
  const answer = await send({ conversationId: CHAT, message: 'Hello', channel: 'whatsapp' })
  assert.equal(answer.status, 400)
  assert.equal(answer.success, false)
  assert.match(answer.error, /24-hour/)
  assert.equal(chat().assigned_to, null)
  assert.equal(assignments().length, 0)
  assert.notEqual(chat().handed_off_at, null) // still waiting for the team
  assert.equal(stored()[0].status, 'failed')

  // Writing to the contact rather than the chat used to take the chat before sending; no longer
  reset()
  meta.fails = true
  assert.equal((await send({ contactId: CONTACT, organizationId: ORG, message: 'Hello', channel: 'whatsapp' })).success, false)
  assert.equal(chat().assigned_to, null)
  assert.equal(assignments().length, 0)

  // Twilio WhatsApp: the same, and a working send claims the chat there too
  reset({ provider: 'twilio' })
  twilio.fails = true
  assert.equal((await send({ conversationId: CHAT, message: 'Hello', channel: 'whatsapp' })).success, false)
  assert.equal(chat().assigned_to, null)
  reset({ provider: 'twilio' })
  assert.equal((await send({ conversationId: CHAT, message: 'Hello', channel: 'whatsapp' })).success, true)
  assert.equal(twilioSent[0].to, 'whatsapp:+14165550123')
  assert.equal(chat().assigned_to, AGENT)
})

test('Send: managers and see-all employees are never auto-assigned, and a credential problem claims nothing', async () => {
  reset()
  caller = manager
  assert.equal((await send({ conversationId: CHAT, message: 'Hello', channel: 'whatsapp' })).success, true)
  assert.equal(chat().assigned_to, null)
  assert.equal(assignments().length, 0)
  // A person answered, so the chat leaves the hand-off queue without becoming the manager's
  assert.equal(chat().handed_off_at, null)
  assert.ok(timeline.indexOf(timeline.find((event) => event.table === 'conversations' && 'handed_off_at' in (event.values || {}))) > timeline.indexOf('meta-send'))

  reset()
  caller = { ...agent, see_all: true }
  assert.equal((await send({ conversationId: CHAT, message: 'Hello', channel: 'whatsapp' })).success, true)
  assert.equal(chat().assigned_to, null)

  // No Meta credentials: the send never happens, so the chat is not taken
  reset()
  tables.organizations[0].whatsapp_api_token = null
  assert.equal((await send({ conversationId: CHAT, message: 'Hello', channel: 'whatsapp' })).success, false)
  assert.equal(chat().assigned_to, null)
  assert.equal(assignments().length, 0)
})

test("Send: a teammate's active lead or open ticket keeps an assigned-only agent out, by name", async () => {
  reset()
  tables.leads = [{ id: 'l1', organization_id: ORG, contact_id: CONTACT, assigned_to: TEAMMATE, status: 'active' }]
  let answer = await send({ conversationId: CHAT, message: 'Hello', channel: 'whatsapp' })
  assert.equal(answer.status, 403)
  assert.equal(answer.error, 'This customer is being handled by Priya Nair')
  assert.equal(answer.code, 'handled_by_teammate')
  assert.equal(metaSent.length, 0)
  assert.equal(stored().length, 0)
  assert.equal(chat().assigned_to, null)

  reset()
  tables.tickets = [{ id: 't1', organization_id: ORG, conversation_id: CHAT, contact_id: CONTACT, assigned_to: TEAMMATE, status: 'open' }]
  answer = await send({ conversationId: CHAT, message: 'Hello', channel: 'whatsapp' })
  assert.equal(answer.status, 403)
  assert.equal(answer.error, 'This customer is being handled by Priya Nair')

  // A teammate the directory no longer names is still a teammate
  reset()
  tables.leads = [{ id: 'l1', organization_id: ORG, contact_id: CONTACT, assigned_to: TEAMMATE, status: 'active' }]
  tables.users = []
  assert.equal((await send({ conversationId: CHAT, message: 'Hello', channel: 'whatsapp' })).error, 'This customer is being handled by a teammate')
})

test('Send: finished work, other organizations, managers and the chat\'s own assignee are not kept out', async () => {
  const wins = async () => {
    const answer = await send({ conversationId: CHAT, message: 'Hello', channel: 'whatsapp' })
    assert.equal(answer.status, 200, answer.error)
    assert.equal(answer.success, true)
  }
  reset()
  tables.leads = [{ id: 'l1', organization_id: ORG, contact_id: CONTACT, assigned_to: TEAMMATE, status: 'won' }]
  tables.tickets = [{ id: 't1', organization_id: ORG, conversation_id: CHAT, assigned_to: TEAMMATE, status: 'resolved' }]
  await wins()

  reset()
  tables.leads = [{ id: 'l1', organization_id: OTHER_ORG, contact_id: CONTACT, assigned_to: TEAMMATE, status: 'active' }]
  tables.tickets = [{ id: 't1', organization_id: ORG, conversation_id: 'another-chat', assigned_to: TEAMMATE, status: 'open' }]
  await wins()

  // A lead nobody is assigned to is not a handler
  reset()
  tables.leads = [{ id: 'l1', organization_id: ORG, contact_id: CONTACT, assigned_to: null, status: 'active' }]
  await wins()

  // Managers write to anyone's customer
  reset()
  caller = manager
  tables.leads = [{ id: 'l1', organization_id: ORG, contact_id: CONTACT, assigned_to: TEAMMATE, status: 'active' }]
  await wins()

  // The chat was given to the agent: the teammate's lead does not take it back
  reset({ conversation: { assigned_to: AGENT } })
  tables.leads = [{ id: 'l1', organization_id: ORG, contact_id: CONTACT, assigned_to: TEAMMATE, status: 'active' }]
  await wins()

  // The agent works this customer too, through a lead of their own
  reset()
  tables.leads = [
    { id: 'l1', organization_id: ORG, contact_id: CONTACT, assigned_to: TEAMMATE, status: 'active' },
    { id: 'l2', organization_id: ORG, contact_id: CONTACT, assigned_to: AGENT, status: 'active' },
  ]
  await wins()
})

test("Send: the message goes to the contact's number; a different number in the request is refused", async () => {
  reset()
  // The same number written differently is fine
  let answer = await send({ conversationId: CHAT, message: 'Hello', phoneNumber: '+1 (416) 555-0123', channel: 'whatsapp' })
  assert.equal(answer.status, 200)
  assert.equal(metaSent[0].to, '14165550123')

  reset()
  answer = await send({ conversationId: CHAT, message: 'Hello', phoneNumber: '+15550009999', channel: 'whatsapp' })
  assert.equal(answer.status, 400)
  assert.equal(answer.error, 'The number does not match this contact')
  assert.equal(metaSent.length, 0)
  assert.equal(stored().length, 0)

  // No number in the request at all
  reset()
  answer = await send({ conversationId: CHAT, message: 'Hello', channel: 'whatsapp' })
  assert.equal(answer.status, 200)
  assert.equal(metaSent[0].to, '14165550123')

  // SMS goes to the same record
  reset({ provider: 'twilio' })
  answer = await send({ conversationId: CHAT, message: 'Hello', phoneNumber: '+1-555-000-9999', channel: 'sms' })
  assert.equal(answer.status, 400)
  reset({ provider: 'twilio' })
  answer = await send({ conversationId: CHAT, message: 'Hello', channel: 'sms' })
  assert.equal(answer.status, 200)
  assert.equal(twilioSent[0].to, '+14165550123')

  // A contact without a number cannot be written to
  reset()
  tables.contacts[0].phone_number = ''
  assert.equal((await send({ conversationId: CHAT, message: 'Hello', channel: 'whatsapp' })).status, 400)
  reset()
  tables.conversations[0].contact_id = 'missing'
  assert.equal((await send({ conversationId: CHAT, message: 'Hello', channel: 'whatsapp' })).status, 404)
})

test('Send: with only a contact, the number comes from the contact row and the chat is found or created', async () => {
  // The contact's existing chat is used, and claimed after the send
  reset()
  let answer = await send({ contactId: CONTACT, organizationId: ORG, message: 'Hello', channel: 'whatsapp' })
  assert.equal(answer.status, 200)
  assert.equal(metaSent[0].to, '14165550123')
  assert.equal(answer.message.conversation_id, CHAT)
  assert.equal(chat().assigned_to, AGENT)
  assert.ok(timeline.indexOf(assignments()[0]) > timeline.indexOf('meta-send'))

  reset()
  answer = await send({ contactId: CONTACT, organizationId: ORG, message: 'Hello', phoneNumber: '+15550009999', channel: 'whatsapp' })
  assert.equal(answer.status, 400)
  assert.equal(answer.error, 'The number does not match this contact')

  // Another organization's contact: not found, nothing sent
  reset()
  answer = await send({ contactId: STRANGER, organizationId: ORG, message: 'Hello', phoneNumber: '+14165550999', channel: 'whatsapp' })
  assert.equal(answer.status, 404)
  assert.equal(metaSent.length, 0)

  // No chat yet: a template starts one, owned by the agent from the start
  reset()
  tables.conversations = []
  answer = await send({ contactId: CONTACT, organizationId: ORG, ...template })
  assert.equal(answer.status, 200, answer.error)
  assert.equal(metaSent[0].type, 'template')
  assert.equal(tables.conversations.length, 1)
  assert.equal(tables.conversations[0].assigned_to, AGENT)
  assert.equal(tables.conversations[0].contact_id, CONTACT)
  assert.equal(answer.message.conversation_id, tables.conversations[0].id)

  // A manager's new chat belongs to nobody
  reset()
  tables.conversations = []
  caller = manager
  await send({ contactId: CONTACT, organizationId: ORG, ...template })
  assert.equal(tables.conversations[0].assigned_to, undefined)
})

test('Send: outside the 24-hour window a free-form WhatsApp message is refused; templates and SMS are not', async () => {
  reset({ lastInboundHoursAgo: 25 })
  let answer = await send({ conversationId: CHAT, message: 'Hello', channel: 'whatsapp' })
  assert.equal(answer.status, 422)
  assert.equal(answer.error, 'This customer last wrote more than 24 hours ago, so WhatsApp only allows an approved template message.')
  assert.equal(answer.code, 'outside_24h_window')
  assert.equal(answer.reason, 'window_closed')
  assert.equal(metaSent.length, 0)
  assert.equal(stored().length, 0, 'nothing is stored for a send that was not attempted')
  assert.equal(chat().assigned_to, null)

  // A template goes through
  reset({ lastInboundHoursAgo: 25 })
  answer = await send({ conversationId: CHAT, ...template })
  assert.equal(answer.status, 200, answer.error)
  assert.equal(metaSent[0].type, 'template')
  assert.equal(metaSent[0].template.name, 'order_update')
  assert.equal(chat().assigned_to, AGENT)

  // Twilio WhatsApp follows the same window; SMS has none
  reset({ provider: 'twilio', lastInboundHoursAgo: 25 })
  assert.equal((await send({ conversationId: CHAT, message: 'Hello', channel: 'whatsapp' })).status, 422)
  assert.equal(twilioSent.length, 0)
  reset({ provider: 'twilio', lastInboundHoursAgo: 25 })
  assert.equal((await send({ conversationId: CHAT, message: 'Hello', channel: 'sms' })).status, 200)
  assert.equal(twilioSent[0].to, '+14165550123')

  // Within the window, and only the customer's own messages count
  reset({ lastInboundHoursAgo: 23 })
  assert.equal((await send({ conversationId: CHAT, message: 'Hello', channel: 'whatsapp' })).status, 200)
  reset({ lastInboundHoursAgo: 25 })
  tables.messages.push({ id: 'ours', organization_id: ORG, conversation_id: CHAT, sender_type: 'user', body: 'Earlier reply', created_at: hoursAgo(2) })
  assert.equal((await send({ conversationId: CHAT, message: 'Hello', channel: 'whatsapp' })).status, 422)

  // A customer who never wrote has no window, whether they have a chat or not, and is told so apart
  reset({ lastInboundHoursAgo: null })
  answer = await send({ conversationId: CHAT, message: 'Hello', channel: 'whatsapp' })
  assert.equal(answer.status, 422)
  assert.equal(answer.error, 'This customer has not written to you yet. Start the conversation with an approved template message.')
  assert.equal(answer.code, 'outside_24h_window')
  assert.equal(answer.reason, 'never_wrote')
  reset()
  tables.conversations = []
  answer = await send({ contactId: CONTACT, organizationId: ORG, message: 'Hello', channel: 'whatsapp' })
  assert.equal(answer.status, 422)
  assert.equal(answer.reason, 'never_wrote')
  assert.equal(tables.conversations.length, 0, 'no chat is created for a message that cannot be sent')

  // When the lookup itself fails the provider decides, as before
  reset({ lastInboundHoursAgo: 25 })
  fake.failSelect = (table) => table === 'messages'
  assert.equal((await send({ conversationId: CHAT, message: 'Hello', channel: 'whatsapp' })).status, 200)
})

test("Send: the 24-hour window is the customer's, found across every chat row of theirs", async () => {
  const NEWEST_CHAT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  const NEIGHBOUR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' // another customer of the same organization
  const row = (id, lastMessageHoursAgo, extra = {}) => ({ id, organization_id: ORG, contact_id: CONTACT, assigned_to: null, auto_reply_enabled: false, handed_off_at: hoursAgo(2), last_message_at: hoursAgo(lastMessageHoursAgo), ...extra })
  const inbound = (conversationId, sentHoursAgo, organizationId = ORG) => ({ id: `in-${conversationId}-${sentHoursAgo}`, organization_id: organizationId, conversation_id: conversationId, sender_type: 'contact', body: 'Hi', created_at: hoursAgo(sentHoursAgo) })
  const windowReads = () => ({
    chats: reads.filter((read) => read.table === 'conversations' && read.where.some(([, column]) => column === 'contact_id')).at(-1),
    inbound: reads.find((read) => read.table === 'messages' && read.where.some(([operator]) => operator === 'in')),
  })

  // The customer wrote an hour ago in the row the webhook keeps current; the agent replies from an older row
  reset({ lastInboundHoursAgo: null })
  tables.conversations.push(row(NEWEST_CHAT, 0.5))
  tables.messages.push(inbound(NEWEST_CHAT, 1))
  let answer = await send({ conversationId: CHAT, message: 'Hello', channel: 'whatsapp' })
  assert.equal(answer.status, 200, answer.error)
  assert.equal(metaSent[0].to, '14165550123')
  assert.equal(stored()[0].conversation_id, CHAT, 'the reply stays in the chat it was written in')
  // Found with one read of the contact's chats, newest first, and one of their messages across those chats
  assert.deepEqual(windowReads().chats.where, [['eq', 'organization_id', ORG], ['eq', 'contact_id', CONTACT]])
  assert.equal(windowReads().chats.limit, 50)
  assert.deepEqual(windowReads().inbound.where, [['eq', 'organization_id', ORG], ['in', 'conversation_id', [NEWEST_CHAT, CHAT]], ['eq', 'sender_type', 'contact']])

  // Written to by contact: the reply lands in the latest row although the customer wrote in an older one
  reset({ lastInboundHoursAgo: 1 })
  tables.conversations.push(row(NEWEST_CHAT, 0.5))
  answer = await send({ contactId: CONTACT, organizationId: ORG, message: 'Hello', channel: 'whatsapp' })
  assert.equal(answer.status, 200, answer.error)
  assert.equal(answer.message.conversation_id, NEWEST_CHAT)

  // Nothing from the customer in any row: never wrote, whatever the team sent them
  reset({ lastInboundHoursAgo: null })
  tables.conversations.push(row(NEWEST_CHAT, 0.5))
  tables.messages.push({ id: 'ours', organization_id: ORG, conversation_id: NEWEST_CHAT, sender_type: 'user', body: 'Earlier template', created_at: hoursAgo(1) })
  answer = await send({ conversationId: CHAT, message: 'Hello', channel: 'whatsapp' })
  assert.equal(answer.status, 422)
  assert.equal(answer.error, 'This customer has not written to you yet. Start the conversation with an approved template message.')
  assert.equal(answer.code, 'outside_24h_window')
  assert.equal(answer.reason, 'never_wrote')
  assert.equal(metaSent.length, 0)
  assert.equal(tables.messages.length, 1, 'nothing is stored for a send that was not attempted')

  // Old in every row: the window closed
  reset({ lastInboundHoursAgo: 30 })
  tables.conversations.push(row(NEWEST_CHAT, 25))
  tables.messages.push(inbound(NEWEST_CHAT, 25))
  answer = await send({ conversationId: CHAT, message: 'Hello', channel: 'whatsapp' })
  assert.equal(answer.status, 422)
  assert.equal(answer.error, 'This customer last wrote more than 24 hours ago, so WhatsApp only allows an approved template message.')
  assert.equal(answer.reason, 'window_closed')
  assert.equal(metaSent.length, 0)

  // Another customer's chat, or a chat of this contact id in another organization, opens no window here
  reset({ lastInboundHoursAgo: null })
  tables.conversations.push(row(NEWEST_CHAT, 0.5, { contact_id: NEIGHBOUR }), row('foreign-chat', 0.5, { organization_id: OTHER_ORG }))
  tables.messages.push(inbound(NEWEST_CHAT, 1), inbound('foreign-chat', 1, OTHER_ORG))
  answer = await send({ conversationId: CHAT, message: 'Hello', channel: 'whatsapp' })
  assert.equal(answer.status, 422)
  assert.equal(answer.reason, 'never_wrote')
  assert.deepEqual(windowReads().inbound.where[1], ['in', 'conversation_id', [CHAT]])

  // Only the 50 most recent rows are searched
  reset({ lastInboundHoursAgo: null })
  tables.conversations = Array.from({ length: 60 }, (_, i) => row(`chat-${String(i).padStart(2, '0')}`, i + 1))
  tables.messages.push(inbound('chat-00', 1))
  answer = await send({ conversationId: 'chat-59', message: 'Hello', channel: 'whatsapp' })
  assert.equal(answer.status, 200, answer.error)
  const searched = windowReads().inbound.where[1][2]
  assert.equal(searched.length, 50)
  assert.equal(searched[0], 'chat-00')
  assert.equal(searched[49], 'chat-49')

  // When the chat list cannot be read the provider decides, as when the messages cannot
  reset({ lastInboundHoursAgo: 30 })
  fake.failSelect = (table, where) => table === 'conversations' && where.some(([, column]) => column === 'contact_id')
  assert.equal((await send({ conversationId: CHAT, message: 'Hello', channel: 'whatsapp' })).status, 200)
})

test('Send: media is downloaded with each redirect checked, never from a private address, and never more than 16 MB', async () => {
  const image = (bytes) => () => mediaResponse(200, { 'content-type': 'image/png' }, Buffer.alloc(bytes, 1))
  const redirect = (to) => () => mediaResponse(302, { location: to })
  const sendImage = (mediaUrl) => send({ conversationId: CHAT, message: 'Look', mediaUrl, channel: 'whatsapp' })

  // A public name: downloaded and uploaded to Meta, with redirects handled by hand and a time limit
  reset()
  mediaAnswers['https://cdn.example.com/a.png'] = redirect('/real/a.png')
  mediaAnswers['https://cdn.example.com/real/a.png'] = image(2048)
  let answer = await sendImage('https://cdn.example.com/a.png')
  assert.equal(answer.status, 200)
  assert.deepEqual(fetched.map((call) => call.url), ['https://cdn.example.com/a.png', 'https://cdn.example.com/real/a.png'])
  for (const call of fetched) {
    // Connected only to an address the lookup accepted, on a connection of its own, with a time limit
    assert.equal(call.options.lookup, lookupPublicAddress)
    assert.equal(call.options.agent, false)
    assert.ok(call.options.signal instanceof AbortSignal, 'a time limit is set')
    // The name stays the name: TLS checks the certificate for it and the Host header carries it
    assert.equal(call.target.hostname, 'cdn.example.com')
    assert.equal(call.options.host, undefined)
    assert.equal(call.options.servername, undefined)
    // No Host override; a User-Agent, since some media hosts refuse a request without one
    assert.deepEqual(call.options.headers, { 'user-agent': 'WAMA-CRM media fetch', accept: '*/*' })
  }
  assert.equal(uploads.length, 1)
  assert.equal(uploads[0].size, 2048)
  assert.deepEqual(metaSent[0].image, { id: 'MEDIA_1', caption: 'Look' })

  // A name that resolves to the private network is never fetched; Meta is given the link instead
  reset()
  answer = await sendImage('https://inside.example.com/a.png')
  assert.equal(answer.status, 200)
  assert.equal(fetched.length, 0)
  assert.equal(uploads.length, 0)
  assert.deepEqual(metaSent[0].image, { link: 'https://inside.example.com/a.png', caption: 'Look' })

  // A public host redirecting to a private address, by name or by number, is not followed
  for (const target of ['http://127.0.0.1/a.png', 'https://inside.example.com/a.png', 'http://169.254.169.254/latest/meta-data/', 'http://[::ffff:10.0.0.1]/a.png', 'http://intranet/a.png']) {
    reset()
    mediaAnswers['https://cdn.example.com/a.png'] = redirect(target)
    await sendImage('https://cdn.example.com/a.png')
    assert.deepEqual(fetched.map((call) => call.url), ['https://cdn.example.com/a.png'], target)
    assert.equal(uploads.length, 0)
    assert.deepEqual(metaSent[0].image, { link: 'https://cdn.example.com/a.png', caption: 'Look' })
  }

  // At most three redirects
  reset()
  mediaAnswers['https://cdn.example.com/a.png'] = redirect('https://cdn.example.com/1.png')
  mediaAnswers['https://cdn.example.com/1.png'] = redirect('https://cdn.example.com/2.png')
  mediaAnswers['https://cdn.example.com/2.png'] = redirect('https://cdn.example.com/3.png')
  mediaAnswers['https://cdn.example.com/3.png'] = redirect('https://cdn.example.com/4.png')
  mediaAnswers['https://cdn.example.com/4.png'] = image(10)
  await sendImage('https://cdn.example.com/a.png')
  assert.equal(fetched.length, 4)
  assert.equal(uploads.length, 0)

  // Too large: announced up front, or discovered while reading
  reset()
  mediaAnswers['https://cdn.example.com/big.png'] = () => mediaResponse(200, { 'content-type': 'image/png', 'content-length': String(16 * 1024 * 1024 + 1) }, Buffer.alloc(16))
  await sendImage('https://cdn.example.com/big.png')
  assert.equal(uploads.length, 0)
  assert.deepEqual(metaSent[0].image, { link: 'https://cdn.example.com/big.png', caption: 'Look' })
  reset()
  mediaAnswers['https://cdn.example.com/big.png'] = image(16 * 1024 * 1024 + 1)
  await sendImage('https://cdn.example.com/big.png')
  assert.equal(uploads.length, 0)
  reset()
  mediaAnswers['https://cdn.example.com/big.png'] = image(16 * 1024 * 1024)
  await sendImage('https://cdn.example.com/big.png')
  assert.equal(uploads.length, 1, 'exactly 16 MB is still accepted')

  // A failed answer is not uploaded either
  reset()
  mediaAnswers['https://cdn.example.com/gone.png'] = () => mediaResponse(404, {})
  await sendImage('https://cdn.example.com/gone.png')
  assert.equal(uploads.length, 0)
  assert.deepEqual(metaSent[0].image, { link: 'https://cdn.example.com/gone.png', caption: 'Look' })
})
