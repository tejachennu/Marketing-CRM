require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const L = require('../lib/auth/login-otp.ts')

function withEnv(values, fn) {
  const before = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]))
  Object.assign(process.env, values)
  return Promise.resolve().then(fn).finally(() => { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } })
}

/** Tiny stand-in for the login_codes table (one row per email). */
function db(seed = []) {
  let rows = [...seed]
  const from = () => {
    let filters = [], op = 'select', values
    const q = {
      select() { return q }, eq(k, v) { filters.push((r) => r[k] === v); return q }, maybeSingle() { return q },
      insert(data) { op = 'insert'; values = data; return q }, update(data) { op = 'update'; values = data; return q }, delete() { op = 'delete'; return q },
      then(resolve) {
        let hit = rows.filter((r) => filters.every((f) => f(r)))
        if (op === 'insert') { rows.push({ ...values }); hit = [values] }
        else if (op === 'update') hit.forEach((r) => Object.assign(r, values))
        else if (op === 'delete') rows = rows.filter((r) => !hit.includes(r))
        return Promise.resolve({ data: op === 'select' ? hit[0] || null : null, error: null }).then(resolve)
      },
    }
    return q
  }
  return { from, rows: () => rows }
}
const NOW = Date.parse('2026-11-15T10:00:00Z')

test('Login code: the migration file is the SQL the app runs', () => {
  const file = require('fs').readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261115_login_codes.sql'), 'utf8')
  assert.equal(L.LOGIN_CODES_SQL, file)
})

test('Login code: issued as a hash, checked once', async () => {
  const d = db()
  const issued = await L.issueLoginCode(d, 'a@x.com', NOW)
  assert.match(issued.code, /^\d{6}$/)
  assert.equal(d.rows()[0].code_hash, L.hashCode('a@x.com', issued.code))
  assert.notEqual(d.rows()[0].code_hash, issued.code)
  assert.match((await L.checkLoginCode(d, 'a@x.com', '000000', NOW + 1000)).error, /not right/)
  assert.deepEqual(await L.checkLoginCode(d, 'a@x.com', issued.code, NOW + 1000), { ok: true })
})

test('Login code: a resend inside a minute keeps the old code', async () => {
  const d = db()
  await L.issueLoginCode(d, 'a@x.com', NOW)
  const again = await L.issueLoginCode(d, 'a@x.com', NOW + 20_000)
  assert.ok(again.error && again.retryAfter)
})

test('Login code: expired and over-tries are refused', async () => {
  const expired = db([{ email: 'a@x.com', code_hash: L.hashCode('a@x.com', '123456'), expires_at: new Date(NOW - 1000).toISOString(), attempts: 0 }])
  assert.match((await L.checkLoginCode(expired, 'a@x.com', '123456', NOW)).error, /expired/)
  const tired = db([{ email: 'a@x.com', code_hash: L.hashCode('a@x.com', '123456'), expires_at: new Date(NOW + 1e6).toISOString(), attempts: 5 }])
  assert.match((await L.checkLoginCode(tired, 'a@x.com', '123456', NOW)).error, /Too many/)
})

test('Login code: the bypass works only for a super admin and only when set', async () => {
  await withEnv({ SUPERADMIN_EMAILS: 'info@magnetora.in', LOGIN_OTP_BYPASS: '63030' }, async () => {
    assert.equal(L.isBypassCode('info@magnetora.in', '63030'), true)
    assert.equal(L.isBypassCode('info@magnetora.in', '00000'), false)
    assert.equal(L.isBypassCode('someone@else.com', '63030'), false)
    assert.deepEqual(await L.checkLoginCode(db(), 'info@magnetora.in', '63030', NOW), { ok: true })
  })
  await withEnv({ SUPERADMIN_EMAILS: 'info@magnetora.in', LOGIN_OTP_BYPASS: '' }, async () => {
    assert.equal(L.isBypassCode('info@magnetora.in', '63030'), false)
  })
})
