require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const { parseDemoRequest, normalizeDemoPhone, saveDemoRequest, demoRequestsOrgId } = require('../lib/demo-requests.ts')

function database(seed = {}) {
  const tables = { contacts: [], leads: [], pipeline_stages: [{ id: 'stage-1', organization_id: 'org', position: 0 }, { id: 'stage-other', organization_id: 'other', position: 0 }], ...structuredClone(seed) }
  let sequence = 0
  const from = table => {
    let filters = [], op = 'select', values, singular = false
    const query = {
      select() { return this }, eq(key, value) { filters.push(row => row[key] === value); return this },
      order() { return this }, limit() { return this }, maybeSingle() { singular = true; return this }, single() { singular = true; return this },
      insert(data) { op = 'insert'; values = data; return this }, update(data) { op = 'update'; values = data; return this },
      then(resolve, reject) {
        let rows = tables[table].filter(row => filters.every(filter => filter(row)))
        if (op === 'insert') { rows = [{ id: `${table}-${++sequence}`, ...structuredClone(values) }]; tables[table].push(...rows) }
        else if (op === 'update') rows.forEach(row => Object.assign(row, structuredClone(values)))
        return Promise.resolve({ data: structuredClone(singular ? rows[0] || null : rows), error: null }).then(resolve, reject)
      },
    }
    return query
  }
  return { from, tables }
}

test('Demo requests: Indian numbers are stored the way WhatsApp contacts are', () => {
  assert.equal(normalizeDemoPhone('98765 43210'), '+919876543210')
  assert.equal(normalizeDemoPhone('098765-43210'), '+919876543210')
  assert.equal(normalizeDemoPhone('+91 98765 43210'), '+919876543210')
  assert.equal(normalizeDemoPhone('0091 98765 43210'), '+919876543210')
  assert.equal(normalizeDemoPhone('+1 555 019 2834'), '+15550192834')
  assert.equal(normalizeDemoPhone('12345'), null)
})

test('Demo requests: the form is checked, and the honeypot catches bots', () => {
  const ok = parseDemoRequest({ name: '  Ravi   Kumar ', email: 'Ravi@Shop.in', phone: '9876543210', goal: 'Both', source: { utm_source: 'google', gclid: 'abc', junk: 'x' } })
  assert.deepEqual(ok.request, { name: 'Ravi Kumar', email: 'ravi@shop.in', phone: '+919876543210', goal: 'Both', source: { utm_source: 'google', gclid: 'abc' } })
  assert.match(parseDemoRequest({ name: 'R', email: 'a@b.in', phone: '9876543210' }).error, /name/)
  assert.match(parseDemoRequest({ name: 'Ravi', email: 'nope', phone: '9876543210' }).error, /email/)
  assert.match(parseDemoRequest({ name: 'Ravi', email: 'a@b.in', phone: '123' }).error, /WhatsApp number/)
  assert.equal(parseDemoRequest({ name: 'Ravi', email: 'a@b.in', phone: '9876543210', website: 'http://spam' }).spam, true)
})

test('Demo requests: a request becomes a contact and a lead in the first stage, with its ad source', async () => {
  const db = database()
  const { request } = parseDemoRequest({ name: 'Ravi Kumar', email: 'ravi@shop.in', phone: '9876543210', goal: 'Bulk Marketing', source: { utm_campaign: 'diwali', gclid: 'g1' } })
  await saveDemoRequest(db, 'org', request)
  assert.equal(db.tables.contacts.length, 1)
  assert.deepEqual([db.tables.contacts[0].first_name, db.tables.contacts[0].last_name, db.tables.contacts[0].phone_number, db.tables.contacts[0].tags], ['Ravi', 'Kumar', '+919876543210', ['Website demo']])
  const lead = db.tables.leads[0]
  assert.equal(lead.organization_id, 'org')
  assert.equal(lead.contact_id, db.tables.contacts[0].id)
  assert.equal(lead.pipeline_stage_id, 'stage-1')
  assert.equal(lead.source, 'Google Ads')
  assert.equal(lead.title, 'Demo: Ravi Kumar (diwali)')
  assert.match(lead.notes, /Goal: Bulk Marketing/)
  assert.match(lead.notes, /gclid: g1/)
})

test('Demo requests: a returning contact is reused, not duplicated', async () => {
  const db = database({ contacts: [{ id: 'c1', organization_id: 'org', phone_number: '+919876543210', email: null, tags: ['VIP'] }] })
  const { request } = parseDemoRequest({ name: 'Ravi', email: 'ravi@shop.in', phone: '+91 98765 43210', source: { fbclid: 'f1' } })
  await saveDemoRequest(db, 'org', request)
  assert.equal(db.tables.contacts.length, 1)
  assert.deepEqual(db.tables.contacts[0].tags, ['VIP', 'Website demo'])
  assert.equal(db.tables.contacts[0].email, 'ravi@shop.in')
  assert.equal(db.tables.leads[0].contact_id, 'c1')
  assert.equal(db.tables.leads[0].source, 'Meta Ads')
})

test('Demo requests: the endpoint saves real requests and quietly drops bots', async () => {
  const PROJECT = path.join(__dirname, '..')
  const db = database()
  const file = path.join(PROJECT, 'lib/api-auth-helper.ts')
  require.cache[file] = { id: file, filename: file, loaded: true, exports: { getSupabaseAdminClient: () => db } }
  process.env.DEMO_REQUESTS_ORG_ID = 'org'
  const { POST } = require('../app/api/public/demo-request/route.ts')
  const send = (body, ip) => POST(new Request('http://localhost/api/public/demo-request', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body) }))
  let res = await send({ name: 'Ravi', email: 'ravi@shop.in', phone: '9876543210' }, '1.1.1.1')
  assert.equal(res.status, 200)
  assert.equal(db.tables.leads.length, 1)
  res = await send({ name: 'Bot', email: 'bot@x.io', phone: '9876543211', website: 'spam.example' }, '2.2.2.2')
  assert.equal(res.status, 200)
  assert.equal(db.tables.leads.length, 1, 'the bot is not saved')
  res = await send({ name: 'Ravi', email: 'bad', phone: '9876543210' }, '3.3.3.3')
  assert.equal(res.status, 400)
  for (let i = 0; i < 5; i++) await send({ name: 'Ravi', email: 'bad', phone: '1' }, '4.4.4.4')
  assert.equal((await send({ name: 'Ravi', email: 'bad', phone: '1' }, '4.4.4.4')).status, 429)
  assert.equal(demoRequestsOrgId(), 'org')
  delete process.env.DEMO_REQUESTS_ORG_ID
  assert.equal(demoRequestsOrgId(), 'b2acf062-c379-49f2-8905-267413c9c394')
})
