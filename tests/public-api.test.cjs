require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const { salonDb } = require('./salon-fake-db.cjs')

const K = require('../lib/public-api/keys.ts')
const AU = require('../lib/public-api/auth.ts')
const CT = require('../lib/public-api/contacts.ts')
const MS = require('../lib/public-api/messages.ts')
const FD = require('../lib/public-api/front-desk.ts')
const SP = require('../lib/public-api/spec.ts')
const { RateLimiter } = require('../lib/rate-limiter.ts')

const ORG = 'c0ffee00-0000-4000-8000-0000000000aa'
const OTHER = 'c0ffee00-0000-4000-8000-0000000000bb'

// ── Keys ────────────────────────────────────────────────────────────────────

test('API keys: "wama_live_" and 32 random characters; only a hash is kept; sent as Bearer or X-API-Key', () => {
  const key = K.generateApiKey()
  assert.match(key, /^wama_live_[A-Za-z0-9_-]{32}$/)
  assert.notEqual(K.generateApiKey(), key)
  assert.equal(K.looksLikeApiKey(key), true)
  assert.equal(K.looksLikeApiKey('wama_live_short'), false)
  assert.equal(K.hashApiKey(key), K.hashApiKey(key))
  assert.match(K.hashApiKey(key), /^[0-9a-f]{64}$/)
  assert.ok(!K.hashApiKey(key).includes(key.slice(10)))
  assert.equal(K.keyPreview(key), `${key.slice(0, 14)}…`)
  assert.equal(K.keyFromHeaders(new Headers({ Authorization: `Bearer ${key}` })), key)
  assert.equal(K.keyFromHeaders(new Headers({ 'X-API-Key': key })), key)
  assert.equal(K.keyFromHeaders(new Headers({ Authorization: 'Basic abc' })), null)
  assert.deepEqual(K.parseScopes(['contacts:read', 'admin:everything']), ['contacts:read'])
  assert.deepEqual(K.parseScopes([]), K.ALL_SCOPES, 'none chosen means all')
})

test('API phone numbers: international form; a 10-digit Indian mobile number gets +91', () => {
  assert.equal(K.normalizePhone('98765 43210'), '+919876543210')
  assert.equal(K.normalizePhone('09876543210'), '+919876543210')
  assert.equal(K.normalizePhone('+91 98765-43210'), '+919876543210')
  assert.equal(K.normalizePhone('919876543210'), '+919876543210')
  assert.equal(K.normalizePhone('+1 (415) 555-0123'), '+14155550123')
  assert.equal(K.normalizePhone('12345'), null)
  assert.equal(K.normalizePhone(''), null)
  assert.equal(K.normalizePhone('+12'), null)
})

// ── Who is calling ──────────────────────────────────────────────────────────

function keyDb(rows = {}) {
  const key = K.generateApiKey()
  const db = salonDb({
    organizations: [{ id: ORG, name: 'Glow Studio', enabled_connectors: ['salon'] }, { id: OTHER, name: 'Other' }],
    api_keys: [{ id: 'k1', organization_id: ORG, name: 'Website', key_hash: K.hashApiKey(key), scopes: ['contacts:read'], revoked_at: null, last_used_at: null }],
    // A paid month that runs for a while yet
    organization_billing: [{ organization_id: ORG, billing_exempt: false, status: 'active', trial_ends_at: '2026-01-01T00:00:00Z', current_period_end: '2099-01-01T00:00:00Z' }],
    ...rows,
  })
  return { db, key }
}
const req = (headers = {}) => new Request('https://app.example.in/api/v1/contacts', { headers })
const errorOf = async (result) => ({ status: result.response.status, ...(await result.response.json()).error })

test('API auth: a valid key opens its own workspace; a missing, wrong or revoked key does not', async () => {
  const { db, key } = keyDb()
  const ok = await AU.apiAuth(req({ Authorization: `Bearer ${key}` }), 'contacts:read', { db, limiter: new RateLimiter() })
  assert.equal(ok.ok, true)
  assert.equal(ok.ctx.organizationId, ORG)
  assert.deepEqual(ok.ctx.key, { id: 'k1', name: 'Website', scopes: ['contacts:read'] })
  await new Promise((r) => setImmediate(r))
  assert.ok(db.tables.api_keys[0].last_used_at, 'last use is noted')

  assert.deepEqual(await errorOf(await AU.apiAuth(req(), 'contacts:read', { db })), { status: 401, code: 'missing_api_key', message: 'Send your API key in the Authorization header: "Authorization: Bearer wama_live_…". Create one in Settings → API.' })
  assert.equal((await errorOf(await AU.apiAuth(req({ Authorization: 'Bearer nope' }), 'contacts:read', { db }))).code, 'invalid_api_key')
  assert.equal((await errorOf(await AU.apiAuth(req({ Authorization: `Bearer ${K.generateApiKey()}` }), 'contacts:read', { db }))).code, 'invalid_api_key')
  db.tables.api_keys[0].revoked_at = '2026-11-08T00:00:00Z'
  assert.equal((await errorOf(await AU.apiAuth(req({ Authorization: `Bearer ${key}` }), 'contacts:read', { db }))).status, 401)
})

test('API auth: a key may only do what its permissions allow, and is rate limited', async () => {
  const { db, key } = keyDb()
  const denied = await errorOf(await AU.apiAuth(req({ 'X-API-Key': key }), 'messages:send', { db, limiter: new RateLimiter() }))
  assert.deepEqual([denied.status, denied.code, denied.required_scope], [403, 'insufficient_scope', 'messages:send'])
  const limiter = new RateLimiter()
  for (let i = 0; i < AU.RATE_LIMIT_PER_MINUTE; i++) assert.equal((await AU.apiAuth(req({ 'X-API-Key': key }), 'contacts:read', { db, limiter })).ok, true)
  const limited = await AU.apiAuth(req({ 'X-API-Key': key }), 'contacts:read', { db, limiter })
  assert.equal(limited.response.status, 429)
  assert.ok(Number(limited.response.headers.get('Retry-After')) >= 1)
})

test('API auth: a workspace whose plan has ended is refused; Front Desk endpoints need the connector on', async () => {
  const { db, key } = keyDb({ organization_billing: [{ organization_id: ORG, billing_exempt: false, status: 'trialing', trial_ends_at: '2020-01-01T00:00:00Z' }] })
  const locked = await errorOf(await AU.apiAuth(req({ 'X-API-Key': key }), 'contacts:read', { db, limiter: new RateLimiter() }))
  assert.deepEqual([locked.status, locked.code], [402, 'workspace_locked'])
  assert.equal(AU.frontDeskOff({ enabled_connectors: ['salon'], name: 'Glow' }), null)
  assert.equal(AU.frontDeskOff({ enabled_connectors: [], name: 'Glow' }).status, 403)
  assert.equal(AU.frontDeskOff({ enabled_connectors: ['salon'], name: 'Consular Helpdesk' }).status, 403)
})

test('API paging: limit 1–100 (default 50) and offset; one extra row says whether there are more', async () => {
  assert.deepEqual(AU.paging(new URLSearchParams('')), { limit: 50, offset: 0 })
  assert.deepEqual(AU.paging(new URLSearchParams('limit=500&offset=-3')), { limit: 100, offset: 0 })
  assert.deepEqual(AU.paging(new URLSearchParams('limit=0&offset=20')), { limit: 50, offset: 20 })
  const body = await AU.listResponse([1, 2, 3], { limit: 2, offset: 0 }).json()
  assert.deepEqual(body, { data: [1, 2], pagination: { limit: 2, offset: 0, has_more: true } })
})

// ── Contacts ────────────────────────────────────────────────────────────────

test('API contacts: created with a phone; the same number in another format updates that contact and adds tags', async () => {
  const db = salonDb({ contacts: [] })
  const first = CT.parseContactInput({ name: 'Priya Sharma', phone: '98765 43210', email: 'PRIYA@example.com', tags: ['Website'] })
  assert.deepEqual(first.value, { first_name: 'Priya', last_name: 'Sharma', phone: '+919876543210', email: 'priya@example.com', tags: ['Website'] })
  const made = await CT.upsertContact(db, ORG, first.value)
  assert.equal(made.created, true)
  assert.deepEqual([made.contact.name, made.contact.phone, made.contact.whatsapp, made.contact.tags], ['Priya Sharma', '+919876543210', '+919876543210', ['Website']])
  const again = await CT.upsertContact(db, ORG, CT.parseContactInput({ phone: '+91 98765-43210', company: 'Sharma Traders', tags: ['VIP'] }).value)
  assert.equal(again.created, false)
  assert.equal(again.contact.id, made.contact.id)
  assert.deepEqual([again.contact.company, again.contact.tags, again.contact.first_name], ['Sharma Traders', ['Website', 'VIP'], 'Priya'])
  assert.equal(db.tables.contacts.length, 1)
  // Another workspace with the same number is a different contact
  assert.equal((await CT.upsertContact(db, OTHER, first.value)).created, true)
})

test('API contacts: what is checked, and a phone number cannot move to another contact', async () => {
  assert.match(CT.parseContactInput({ name: 'No phone' }).error, /phone number is needed/)
  assert.equal(CT.parseContactInput({ phone: '123' }).field, 'phone')
  assert.equal(CT.parseContactInput({ phone: '9876543210', email: 'not-an-email' }).field, 'email')
  assert.equal(CT.parseContactInput({ phone: '9876543210', tags: 'VIP' }).field, 'tags')
  assert.deepEqual(CT.parseContactInput({ email: 'a@b.in' }, true), { value: { email: 'a@b.in' } })
  const db = salonDb({ contacts: [
    { id: 'c1', organization_id: ORG, first_name: 'A', phone_number: '+919876500001', created_at: '2026-11-01' },
    { id: 'c2', organization_id: ORG, first_name: 'B', phone_number: '+919876500002', created_at: '2026-11-02' },
  ] })
  assert.deepEqual(await CT.updateContact(db, ORG, 'c2', { phone: '+919876500001' }), { error: 'phone_taken' })
  assert.deepEqual(await CT.updateContact(db, OTHER, 'c2', { first_name: 'X' }), { error: 'not_found' })
  const changed = await CT.updateContact(db, ORG, 'c2', { first_name: 'Bhavani', tags: ['VIP'] })
  assert.deepEqual([changed.contact.name, changed.contact.tags], ['Bhavani', ['VIP']])
})

test('API contacts: listed newest first, searched by name or digits, found by a whole number, filtered by tag — only this workspace', async () => {
  const db = salonDb({ contacts: [
    { id: 'c1', organization_id: ORG, first_name: 'Priya', last_name: 'Sharma', phone_number: '+919876500001', tags: ['VIP'], created_at: '2026-11-01' },
    { id: 'c2', organization_id: ORG, first_name: 'Ravi', last_name: null, phone_number: null, whatsapp_number: 'whatsapp:+919876500002', tags: [], created_at: '2026-11-02' },
    { id: 'c3', organization_id: OTHER, first_name: 'Priya', phone_number: '+919876500001', tags: ['VIP'], created_at: '2026-11-03' },
  ] })
  const page = { limit: 50, offset: 0 }
  const ids = async (query) => (await CT.listContacts(db, ORG, new URLSearchParams(query), page)).map((c) => c.id)
  assert.deepEqual(await ids(''), ['c2', 'c1'])
  assert.deepEqual(await ids('search=pri'), ['c1'])
  assert.deepEqual(await ids('search=98765000'), ['c2', 'c1'])
  assert.deepEqual(await ids('phone=09876500002'), ['c2'], 'found by the WhatsApp number')
  assert.deepEqual(await ids('tag=VIP'), ['c1'])
  assert.equal((await CT.listContacts(db, ORG, new URLSearchParams(''), { limit: 1, offset: 0 })).length, 2, 'one extra row to know there are more')
})

// ── Messages ────────────────────────────────────────────────────────────────

test('API messages: a text or a template, checked; the WhatsApp payload fills blanks in order and link buttons', () => {
  assert.deepEqual(MS.parseMessageInput({ to: '9876543210', text: ' Hello ' }), { value: { to: '+919876543210', text: 'Hello' } })
  assert.equal(MS.parseMessageInput({ to: '123', text: 'x' }).field, 'to')
  assert.equal(MS.parseMessageInput({ to: '9876543210' }).field, 'text')
  assert.equal(MS.parseMessageInput({ to: '9876543210', text: 'x'.repeat(4097) }).field, 'text')
  assert.equal(MS.parseMessageInput({ to: '9876543210', template: { name: 'Bad Name' } }).field, 'template.name')
  assert.equal(MS.parseMessageInput({ to: '9876543210', template: { name: 'ok', language: 'english' } }).field, 'template.language')
  assert.equal(MS.parseMessageInput({ to: '9876543210', template: { name: 'ok', body_parameters: 'Priya' } }).field, 'template.body_parameters')
  const input = MS.parseMessageInput({ to: '+919876543210', template: { name: 'wama_bill', body_parameters: ['Priya', 'Glow\nStudio', 42], button_parameters: ['tok123'] } }).value
  assert.deepEqual(MS.whatsappPayload(input), {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: '919876543210', type: 'template',
    template: { name: 'wama_bill', language: { code: 'en' }, components: [
      { type: 'body', parameters: [{ type: 'text', text: 'Priya' }, { type: 'text', text: 'Glow Studio' }, { type: 'text', text: '42' }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'tok123' }] },
    ] },
  })
  assert.equal(MS.inboxText(input), '[Template wama_bill]: Priya · Glow\nStudio · 42')
  assert.deepEqual(MS.whatsappPayload({ to: '+919876543210', text: 'Hi' }).text, { preview_url: true, body: 'Hi' })
})

test('API messages: a sent message lands in the inbox — the contact and conversation are found, or made for a new number', async () => {
  const db = salonDb({ contacts: [{ id: 'c1', organization_id: ORG, first_name: 'Priya', phone_number: '+919876543210' }], conversations: [{ id: 'v1', organization_id: ORG, contact_id: 'c1', last_message_at: '2026-11-01' }] })
  assert.deepEqual(await MS.logSentMessage(db, ORG, '+919876543210', 'Hello', 'wamid.1'), { contactId: 'c1', conversationId: 'v1' })
  assert.deepEqual(db.tables.messages.map((m) => [m.conversation_id, m.body, m.twilio_message_sid, m.sender_type]), [['v1', 'Hello', 'FB_wamid.1', 'user']])
  const fresh = await MS.logSentMessage(db, ORG, '+919800000000', 'Welcome', null)
  assert.ok(fresh.contactId && fresh.conversationId)
  assert.deepEqual(db.tables.contacts.find((c) => c.id === fresh.contactId).tags, ['API'])
})

// ── Front Desk ──────────────────────────────────────────────────────────────

test('API Front Desk: dates are India days, at most 31 at a time; invoices carry their public link', () => {
  const w = FD.dateWindow(new URLSearchParams('date=2026-11-08'))
  assert.deepEqual(w, { start: '2026-11-07T18:30:00.000Z', end: '2026-11-08T18:30:00.000Z', from: '2026-11-08', to: '2026-11-08' })
  assert.match(FD.dateWindow(new URLSearchParams('date=08-11-2026')).error, /YYYY-MM-DD/)
  assert.match(FD.dateWindow(new URLSearchParams('from=2026-11-08&to=2026-11-01')).error, /on or after/)
  assert.match(FD.dateWindow(new URLSearchParams('from=2026-01-01&to=2026-03-01')).error, /31 days/)
  const invoice = FD.toApiInvoice({ id: 'i1', number: 'GLOW-0001', status: 'paid', customer_name: 'Priya', total: '708', items: [{ name: 'Facial', price: 600, total: 708 }], public_token: 'tok', issued_at: 'x' }, 'https://app.example.in/')
  assert.equal(invoice.url, 'https://app.example.in/i/tok')
  assert.equal(invoice.total, 708)
  assert.equal(invoice.items[0].quantity, 1)
})

test('API Front Desk: free times use opening hours and who is booked; a person asked for narrows them', async () => {
  const S1 = '00000000-0000-4000-8000-000000000101'
  const db = salonDb({
    salon_settings: [{ organization_id: ORG, opens_at: '10:00', closes_at: '13:00', closed_weekdays: [] }],
    salon_services: [{ id: S1, organization_id: ORG, duration_minutes: 60, active: true }],
    salon_staff: [{ id: 'a', organization_id: ORG, service_ids: [], active: true }, { id: 'b', organization_id: ORG, service_ids: [], active: true }],
    salon_appointments: [{ organization_id: ORG, starts_at: '2026-11-10T10:00:00+05:30', ends_at: '2026-11-10T11:00:00+05:30', status: 'booked', staff_id: 'a', services: [] }],
  })
  const now = Date.parse('2026-11-08T09:00:00+05:30')
  const anyone = await FD.availableTimes(db, ORG, { date: '2026-11-10', serviceIds: [S1], now })
  assert.deepEqual(anyone.times, ['10:00', '10:30', '11:00', '11:30', '12:00'])
  const withA = await FD.availableTimes(db, ORG, { date: '2026-11-10', serviceIds: [S1], staffId: 'a', now })
  assert.deepEqual(withA.times, ['11:00', '11:30', '12:00'])
  assert.equal(withA.check('10:30'), false)
  assert.equal(withA.check('11:00'), true)
  assert.match((await FD.availableTimes(db, ORG, { date: '2026-11-10', serviceIds: ['00000000-0000-4000-8000-000000000999'], now })).error, /not on the list/)
  assert.match((await FD.availableTimes(db, ORG, { date: '2026-11-10', serviceIds: [S1], staffId: 'zzz', now })).error, /staff member/)
})

// ── Documentation ───────────────────────────────────────────────────────────

test('API docs: every endpoint has a real permission and documented errors; the OpenAPI file lists them all', () => {
  const codes = new Set(SP.ERROR_CODES.map((e) => e.code))
  const endpoints = SP.API_GROUPS.flatMap((g) => g.endpoints)
  for (const endpoint of endpoints) {
    assert.ok(endpoint.scope === null || K.ALL_SCOPES.includes(endpoint.scope), endpoint.id)
    for (const code of endpoint.errors || []) assert.ok(codes.has(code), `${endpoint.id}: ${code}`)
  }
  assert.equal(new Set(endpoints.map((e) => e.id)).size, endpoints.length, 'ids are unique')
  const spec = SP.openApiSpec('https://app.example.in/')
  assert.equal(spec.openapi, '3.1.0')
  assert.equal(spec.servers[0].url, 'https://app.example.in/api/v1')
  const operations = Object.values(spec.paths).flatMap((p) => Object.keys(p))
  assert.equal(operations.length, endpoints.length)
  assert.deepEqual(Object.keys(spec.paths).sort(), [...new Set(endpoints.map((e) => e.path))].sort())
  assert.ok(spec.paths['/contacts'].post.requestBody)
})
