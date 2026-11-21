require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHmac } = require('node:crypto')

const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('Twilio: the signature is checked the way Twilio makes it', () => {
  const T = require('../lib/twilio-signature.ts')
  const params = new URLSearchParams('From=whatsapp%3A%2B919876543210&Body=Hi&To=whatsapp%3A%2B14155238886&MessageSid=SM1')
  const url = 'https://wamacrm.magnetora.in/api/webhooks/twilio/abc'
  const names = ['Body', 'From', 'MessageSid', 'To']
  const want = createHmac('sha1', 'token').update(url + names.map((n) => n + params.get(n)).join('')).digest('base64')
  assert.equal(T.twilioSignature('token', url, params), want)
  assert.equal(T.validTwilioSignature('token', url, params, want), true)
  assert.equal(T.validTwilioSignature('other', url, params, want), false)
  assert.equal(T.validTwilioSignature('token', url, params, null), false)
  const request = { url: 'http://localhost:3000/api/webhooks/twilio/abc', headers: { get: (n) => ({ 'x-forwarded-host': 'wamacrm.magnetora.in', 'x-forwarded-proto': 'https', 'x-twilio-signature': 'bad' })[n] || null } }
  assert.equal(T.calledUrl(request), url)
  assert.equal(T.twilioCallAllowed(request, 'token', params, 'test', {}), true, 'only logged until switched to enforce')
  assert.equal(T.twilioCallAllowed(request, 'token', params, 'test', { TWILIO_SIGNATURE_CHECK: 'enforce' }), false)
})

test('Sign-in: too many tries from one address or for one email are refused', async () => {
  const { tooManyAttempts } = require('../lib/auth/attempts.ts')
  const req = (ip) => ({ headers: { get: (n) => (n === 'x-forwarded-for' ? ip : null) } })
  let refused = null
  for (let i = 0; i < 9 && !refused; i++) refused = tooManyAttempts(req(`10.0.0.${i}`), 'login', 'owner@shop.in')
  assert.ok(refused, 'the ninth try for one email is refused')
  assert.equal(refused.status, 429)
  assert.equal(tooManyAttempts(req('10.9.9.9'), 'login', 'someone-else@shop.in'), null)
  for (const route of ['login', 'verify-otp', 'set-password', 'signup', 'signup/send-code', 'forgot-password']) {
    assert.match(read(`app/api/auth/${route}/route.ts`), /tooManyAttempts\(request/, route)
  }
})

test('Database lock-down: the migration file matches, and it locks every table', () => {
  const L = require('../lib/security/lockdown.ts')
  assert.equal(read('supabase/migrations/20261211_lock_down_tables.sql'), L.LOCKDOWN_SQL)
  assert.equal(L.LOCKDOWN_LOCK, 724519037)
  assert.match(L.LOCKDOWN_SQL, /ENABLE ROW LEVEL SECURITY/)
  assert.match(L.LOCKDOWN_SQL, /REVOKE ALL ON public\.%I FROM anon/)
  assert.match(L.LOCKDOWN_SQL, /REVOKE SELECT ON public\.organizations FROM authenticated/)
  assert.doesNotMatch(L.LOCKDOWN_SQL, /'whatsapp_api_token'|'store_razorpay_key_secret'|'stripe_secret_key'|'openai_api_key'/, 'secret columns are never granted')
  assert.deepEqual(L.openTables([{ table: 'a', rls: false, anonCanRead: true, openRules: [] }, { table: 'b', rls: true, anonCanRead: false, openRules: ['Allow all'] }, { table: 'c', rls: true, anonCanRead: false, openRules: [] }]), ['a', 'b'])
})

test('Browser code asks only for harmless columns of the business', () => {
  assert.doesNotMatch(read('app/dashboard/ivr/page.tsx'), /from\('organizations'\)\s*\.select\('\*'\)/)
  assert.match(read('next.config.mjs'), /frame-ancestors 'none'/)
  assert.match(read('components/assistant-drawer.tsx'), /escapeHtml\(line\)/)
  assert.match(read('app/dashboard/campaigns/page.tsx'), /sandbox=""/)
  assert.equal(fs.existsSync(path.join(root, 'app/api/tickets/notify/route.ts')), false, 'the open ticket-email route is gone')
})
