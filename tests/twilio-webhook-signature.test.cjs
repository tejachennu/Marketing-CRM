// The Twilio inbound webhooks refuse requests Twilio did not sign, before storing anything.
// Against a fake database that records every write; nothing here reaches the network.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const ORG = '99999999-9999-4999-8999-999999999999'
const TOKEN = 'org-auth-token'
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

const writes = []
const tables = {}
const db = {
  from(table) {
    let action = 'select'
    let shape = 'many'
    const filters = []
    const query = {
      select: () => query,
      insert: () => { action = 'insert'; return query },
      update: () => { action = 'update'; return query },
      upsert: () => { action = 'upsert'; return query },
      eq: (column, value) => { filters.push((row) => row[column] === value); return query },
      in: () => query, or: () => query, ilike: () => query, neq: () => query, not: () => query, is: () => query, gt: () => query,
      order: () => query, limit: () => query,
      single: () => { shape = 'one'; return query },
      maybeSingle: () => { shape = 'one'; return query },
      then(resolve, reject) {
        if (action !== 'select') writes.push({ table, action })
        const rows = (tables[table] || []).filter((row) => filters.every((filter) => filter(row)))
        return Promise.resolve({ data: shape === 'one' ? rows[0] || null : rows, error: null }).then(resolve, reject)
      },
    }
    return query
  },
  storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
}

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.invalid'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'
delete process.env.TWILIO_AUTH_TOKEN
delete process.env.TWILIO_WEBHOOK_ALLOW_UNSIGNED
stub(require.resolve('@supabase/supabase-js', { paths: [PROJECT] }), { createClient: () => db })
const warnings = []
console.warn = (...args) => { warnings.push(args.join(' ')) }
console.log = () => {}
console.error = () => {}

const twilio = require(require.resolve('twilio', { paths: [PROJECT] }))
const orgRoute = require(path.join(PROJECT, 'app/api/webhooks/twilio/[orgIdAndSlug]/route.ts'))
const legacyRoute = require(path.join(PROJECT, 'app/api/webhooks/twilio/route.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))

const fields = { From: 'whatsapp:+14165550123', To: 'whatsapp:+15550001111', Body: 'Hi', MessageSid: 'SM1', NumMedia: '0' }
const request = (url, signature) => new NextRequest(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(signature ? { 'X-Twilio-Signature': signature } : {}) },
  body: new URLSearchParams(fields).toString(),
})

function reset() {
  writes.length = 0
  warnings.length = 0
  tables.organizations = [{ id: ORG, whatsapp_provider: 'twilio', twilio_auth_token: TOKEN, twilio_whatsapp_number: '+15550001111' }]
  tables.users = [{ id: 'u1', organization_id: ORG }]
}

test('Twilio inbound: an unsigned or forged message for a workspace is refused before anything is stored', async () => {
  const url = `https://wamacrm.example.com/api/webhooks/twilio/${ORG}`
  for (const signature of [null, 'forged', twilio.getExpectedTwilioSignature('someone-else', url, fields)]) {
    reset()
    const res = await orgRoute.POST(request(url, signature), { params: { orgIdAndSlug: ORG } })
    assert.equal(res.status, 403)
    assert.deepEqual(writes, [])
    assert.match(warnings.join('\n'), /Refused a request/)
  }
})

test('Twilio inbound: the address without a workspace refuses unsigned messages too', async () => {
  reset()
  const url = 'https://wamacrm.example.com/api/webhooks/twilio'
  const res = await legacyRoute.POST(request(url, null))
  assert.equal(res.status, 403)
  assert.deepEqual(writes, [])
})

test('Twilio inbound: the address without a workspace never guesses which workspace a message belongs to', async () => {
  reset()
  const OTHER = '88888888-8888-4888-8888-888888888888'
  tables.organizations.push({ id: OTHER, whatsapp_provider: 'twilio', twilio_auth_token: 'other-token', twilio_whatsapp_number: '+15550002222' })
  tables.contacts = [{ id: 'c-other', organization_id: OTHER, phone_number: '+14165550123' }] // the same customer, known elsewhere
  const url = 'https://wamacrm.example.com/api/webhooks/twilio'
  const unknownNumber = { ...fields, To: 'whatsapp:+15550009999' }
  const res = await legacyRoute.POST(new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': twilio.getExpectedTwilioSignature(TOKEN, url, unknownNumber) },
    body: new URLSearchParams(unknownNumber).toString(),
  }))
  assert.equal(res.status, 200)
  assert.equal((await res.json()).ignored, true)
  assert.deepEqual(writes, [])

  // The number names its workspace; a signature from another workspace's account is still refused
  const known = await legacyRoute.POST(new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': twilio.getExpectedTwilioSignature('other-token', url, fields) },
    body: new URLSearchParams(fields).toString(),
  }))
  assert.equal(known.status, 403)
  assert.deepEqual(writes, [])
})
