// "Forgot password?": the route that emails a one-time reset link, against a fake database and a
// fake mailer. Nothing is sent and no real database is touched.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

// Fake database: the users table and the password_setup_tokens table
let users = []
let tokens = []
let insertError = null
function query(table) {
  const filters = []
  let action = 'select'
  let values = null
  const rows = () => (table === 'users' ? users : tokens).filter((row) => filters.every((f) => f(row)))
  const builder = {
    select() { return builder },
    ilike(column, pattern) {
      // Wildcards are escaped by the route, so an escaped pattern must match the address exactly
      const literal = pattern.replace(/\\([\\%_])/g, '$1')
      filters.push((row) => String(row[column]).toLowerCase() === literal.toLowerCase())
      return builder
    },
    eq(column, value) { filters.push((row) => row[column] === value); return action === 'delete' ? builder.run() : builder },
    gt(column, value) { filters.push((row) => row[column] > value); return builder },
    limit() { return builder },
    maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
    delete() { action = 'delete'; return builder },
    insert: async (list) => {
      if (insertError) return { error: insertError }
      values = list.map((row) => ({ ...row, created_at: new Date().toISOString() }))
      tokens.push(...values)
      return { error: null }
    },
    run: async () => { const gone = new Set(rows()); tokens = tokens.filter((row) => !gone.has(row)); return { error: null } },
    then(resolve, reject) { return Promise.resolve({ data: rows(), error: null }).then(resolve, reject) },
  }
  return builder
}
stub(path.join(PROJECT, 'lib/api-auth-helper.ts'), { getSupabaseAdminClient: () => ({ from: query }) })

// Fake mailer
let sent = []
let mailFails = false
stub(path.join(PROJECT, 'lib/email.ts'), {
  sendEmail: async (mail) => { if (mailFails) throw new Error('SMTP down'); sent.push(mail); return { success: true } },
})

const originalError = console.error
console.error = (...args) => { if (!/^\[Forgot Password\]/.test(String(args[0]))) originalError(...args) }

const route = require(path.join(PROJECT, 'app/api/auth/forgot-password/route.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))

const request = (body, headers = {}) => new NextRequest('https://wamacrm.magnetora.in/api/auth/forgot-password', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})
const OWNER = { id: 'user-1', email: 'Owner@Magnetora.in', full_name: 'Teja <b>' }

function reset() {
  users = [{ ...OWNER }]
  tokens = []
  insertError = null
  sent = []
  mailFails = false
  delete process.env.NEXT_PUBLIC_APP_URL
}

test('Forgot password: a known address gets one reset link on this site, valid for an hour', async () => {
  reset()
  const res = await route.POST(request({ email: '  owner@magnetora.IN ' }, { Origin: 'https://evil.example' }))
  assert.equal(res.status, 200)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, 'Owner@Magnetora.in')
  assert.equal(tokens.length, 1)
  assert.equal(tokens[0].user_id, 'user-1')
  assert.match(tokens[0].token, /^[0-9a-f]{64}$/)
  const lifetime = Date.parse(tokens[0].expires_at) - Date.now()
  assert.ok(lifetime > 59 * 60 * 1000 && lifetime <= 60 * 60 * 1000)
  // The link points at the host the request reached, never the caller-supplied Origin
  assert.ok(sent[0].html.includes(`https://wamacrm.magnetora.in/set-password?token=${tokens[0].token}&reset=1`))
  assert.ok(!sent[0].html.includes('evil.example'))
  assert.ok(sent[0].html.includes('Teja &lt;b&gt;'), 'the name is escaped')
})

test('Forgot password: the configured app address wins', async () => {
  reset()
  process.env.NEXT_PUBLIC_APP_URL = 'https://crm.example.com/'
  await route.POST(request({ email: 'owner@magnetora.in' }))
  assert.ok(sent[0].text.includes('https://crm.example.com/set-password?token='))
})

test('Forgot password: an unknown address gets the same answer and no email', async () => {
  reset()
  const known = await (await route.POST(request({ email: 'owner@magnetora.in' }))).json()
  reset()
  const res = await route.POST(request({ email: 'nobody@magnetora.in' }))
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), known)
  assert.equal(sent.length, 0)
  assert.equal(tokens.length, 0)
})

test('Forgot password: wildcards in the address do not match someone else', async () => {
  reset()
  const res = await route.POST(request({ email: 'o%@magnetora.in' }))
  assert.equal(res.status, 200)
  assert.equal(sent.length, 0)
})

test('Forgot password: a second request within a minute sends nothing; a new link replaces the old one', async () => {
  reset()
  await route.POST(request({ email: 'owner@magnetora.in' }))
  const first = tokens[0].token
  const again = await route.POST(request({ email: 'owner@magnetora.in' }))
  assert.equal(again.status, 200)
  assert.equal(sent.length, 1, 'no second email')
  assert.equal(tokens[0].token, first)

  tokens[0].created_at = new Date(Date.now() - 2 * 60 * 1000).toISOString()
  await route.POST(request({ email: 'owner@magnetora.in' }))
  assert.equal(sent.length, 2)
  assert.equal(tokens.length, 1, 'the old link stops working')
  assert.notEqual(tokens[0].token, first)
})

test('Forgot password: when the email cannot be sent, the link is dropped and the person is told', async () => {
  reset()
  mailFails = true
  const res = await route.POST(request({ email: 'owner@magnetora.in' }))
  assert.equal(res.status, 500)
  assert.match((await res.json()).error, /try again/)
  assert.equal(tokens.length, 0, 'a retry is not held back by the one-minute wait')
})

test('Forgot password: a missing or malformed address is refused', async () => {
  reset()
  for (const body of [{}, { email: 'not-an-email' }, 'not json']) {
    const res = await route.POST(request(body))
    assert.equal(res.status, 400)
  }
  assert.equal(sent.length, 0)
})

test('Forgot password: a token that cannot be stored is reported, not emailed', async () => {
  reset()
  insertError = { message: 'db down' }
  const res = await route.POST(request({ email: 'owner@magnetora.in' }))
  assert.equal(res.status, 500)
  assert.equal(sent.length, 0)
})
