require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { salonDb } = require('./salon-fake-db.cjs')
const O = require('../lib/auth/signup-otp.ts')

const EMAIL = 'owner@glow.in'
const T = Date.parse('2026-11-09T10:00:00Z')

test('Sign-up codes: the migration file is run word for word', () => {
  assert.equal(O.SIGNUP_OTP_SQL, fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261114_signup_otps.sql'), 'utf8'))
})

test('Sign-up form is checked in plain words', () => {
  assert.deepEqual(O.parseSignup({ email: ' Owner@Glow.in ', password: 'secret1', fullName: 'Teja', companyName: 'Glow' }).value, { email: 'owner@glow.in', password: 'secret1', fullName: 'Teja', companyName: 'Glow' })
  assert.equal(O.parseSignup({ email: 'x@y.in', password: '123', fullName: 'A', companyName: 'B' }).error, 'Password must be at least 6 characters long')
  assert.equal(O.parseSignup({ email: 'bad', password: 'secret1', fullName: 'A', companyName: 'B' }).error, 'Please enter a valid email address')
  assert.equal(O.parseSignup({ email: 'x@y.in', password: 'secret1', companyName: 'B' }).error, 'Enter your name.')
})

test('A code is 6 digits and only its hash is stored', async () => {
  const db = salonDb({ signup_otps: [] })
  const issued = await O.issueSignupCode(db, EMAIL, T)
  assert.match(issued.code, /^\d{6}$/)
  const row = db.tables.signup_otps[0]
  assert.equal(row.code_hash, O.hashCode(EMAIL, issued.code))
  assert.ok(!JSON.stringify(row).includes(`"${issued.code}"`))
})

test('The right code passes; a wrong one counts as a try; 5 wrong tries lock it', async () => {
  const db = salonDb({ signup_otps: [] })
  const { code } = await O.issueSignupCode(db, EMAIL, T)
  const wrong = code === '000000' ? '111111' : '000000'
  assert.match((await O.checkSignupCode(db, EMAIL, wrong, T)).error, /not right\. 4 tries left/)
  assert.deepEqual(await O.checkSignupCode(db, EMAIL, code, T), { ok: true })
  for (let i = 0; i < 4; i++) await O.checkSignupCode(db, EMAIL, wrong, T)
  assert.match((await O.checkSignupCode(db, EMAIL, code, T)).error, /Too many wrong tries/)
})

test('Codes expire after 10 minutes, and need a 6-digit entry', async () => {
  const db = salonDb({ signup_otps: [] })
  const { code } = await O.issueSignupCode(db, EMAIL, T)
  assert.match((await O.checkSignupCode(db, EMAIL, code, T + 10 * 60_000 + 1)).error, /expired/)
  assert.match((await O.checkSignupCode(db, EMAIL, '12', T)).error, /6-digit/)
  assert.match((await O.checkSignupCode(db, 'other@glow.in', code, T)).error, /Ask for a code first/)
})

test('A new code: once a minute, up to 5 an hour; it replaces the old one', async () => {
  const db = salonDb({ signup_otps: [] })
  const first = await O.issueSignupCode(db, EMAIL, T)
  const soon = await O.issueSignupCode(db, EMAIL, T + 20_000)
  assert.equal(soon.retryAfter, 40)
  let last = first
  for (let i = 1; i <= 4; i++) last = await O.issueSignupCode(db, EMAIL, T + i * 61_000)
  assert.ok(last.code)
  assert.match((await O.issueSignupCode(db, EMAIL, T + 5 * 61_000)).error, /Too many codes/)
  assert.ok((await O.issueSignupCode(db, EMAIL, T + 61 * 60_000)).code, 'a new hour starts again')
  const newest = db.tables.signup_otps[0]
  assert.equal(newest.attempts, 0)
})

test('After the account is made the code is gone', async () => {
  const db = salonDb({ signup_otps: [] })
  const { code } = await O.issueSignupCode(db, EMAIL, T)
  await O.clearSignupCode(db, EMAIL)
  assert.match((await O.checkSignupCode(db, EMAIL, code, T)).error, /Ask for a code first/)
})

test('The email says the code plainly', () => {
  const mail = O.signupCodeEmail('123456', 'Teja Chennu')
  assert.equal(mail.subject, '123456 is your WAMA CRM sign-up code')
  assert.match(mail.text, /^Hi Teja,/)
  assert.match(mail.html, /123456/)
})
