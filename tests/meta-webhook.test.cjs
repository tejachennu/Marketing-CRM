require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const { createHmac } = require('node:crypto')

const { verifyMetaSignature } = require('../lib/meta-webhook.ts')
const { getPublicBaseUrl, getWebhookOverride } = require('../lib/whatsapp-onboarding.ts')

const ORG = '99999999-9999-4999-8999-999999999999'
const SECRET = 'app-secret'
const BODY = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '1', changes: [] }] })
const sign = (body, secret = SECRET) => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')

test('Webhook: only payloads signed with the app secret are accepted', () => {
  const live = { secret: SECRET, production: true, allowUnsigned: false }
  assert.deepEqual(verifyMetaSignature(BODY, sign(BODY), live), { valid: true })
  assert.equal(verifyMetaSignature(BODY, sign(BODY, 'another-app'), live).valid, false)        // signed by a different app
  assert.equal(verifyMetaSignature(BODY + ' ', sign(BODY), live).valid, false)                  // body changed on the way
  assert.equal(verifyMetaSignature(BODY, null, live).valid, false)
  assert.equal(verifyMetaSignature(BODY, 'sha256=abc', live).valid, false)                      // wrong length must not throw
  assert.equal(verifyMetaSignature(BODY, sign(BODY).replace('sha256=', 'sha1='), live).valid, false)
})

test('Webhook: a live site without the app secret refuses everything', () => {
  const refused = verifyMetaSignature(BODY, sign(BODY), { secret: '', production: true, allowUnsigned: false })
  assert.equal(refused.valid, false)
  assert.match(refused.note, /META_APP_SECRET is not set/)

  // A developer's machine, or a site that has explicitly opted out, lets it through and says so
  assert.equal(verifyMetaSignature(BODY, null, { secret: '', production: false, allowUnsigned: false }).valid, true)
  const optedOut = verifyMetaSignature(BODY, null, { secret: '', production: true, allowUnsigned: true })
  assert.equal(optedOut.valid, true)
  assert.match(optedOut.note, /not checked/)
  // The opt-out never weakens a site that does have the secret
  assert.equal(verifyMetaSignature(BODY, 'sha256=bad', { secret: SECRET, production: true, allowUnsigned: true }).valid, false)
})

const request = (url, headers = {}) => ({ url, headers: { get: (name) => headers[name.toLowerCase()] ?? null } })

test('Onboarding: Meta is only ever given a public https address', () => {
  assert.equal(getPublicBaseUrl(request('https://app.example.com/api/whatsapp/embedded-signup'), ''), 'https://app.example.com')
  // The configured address wins over where the request happened to arrive
  assert.equal(getPublicBaseUrl(request('http://localhost:3000/api/x'), 'https://crm.example.com/'), 'https://crm.example.com')
  // Behind a proxy, the address the visitor used
  assert.equal(getPublicBaseUrl(request('http://10.0.0.5:3000/api/x', { 'x-forwarded-host': 'crm.example.com', 'x-forwarded-proto': 'https' }), ''), 'https://crm.example.com')

  for (const local of ['http://localhost:3000/api/x', 'https://localhost/api/x', 'http://app.example.com/api/x', 'https://192.168.1.20/api/x', 'https://127.0.0.1/api/x', 'https://intranet/api/x']) {
    assert.equal(getPublicBaseUrl(request(local), ''), null, local)
  }
  // A configured address that cannot be used is not quietly replaced
  assert.equal(getPublicBaseUrl(request('https://app.example.com/api/x'), 'http://localhost:3000'), null)
  assert.equal(getPublicBaseUrl(request('https://app.example.com/api/x'), 'not a url'), null)
})

test('Onboarding: each organization gets its own webhook address and verify token', () => {
  assert.deepEqual(getWebhookOverride(ORG, 'https://crm.example.com/'), {
    override_callback_uri: `https://crm.example.com/api/webhooks/facebook/${ORG}`,
    verify_token: ORG,
  })
  assert.equal(getWebhookOverride(ORG, null), null)
  assert.equal(getWebhookOverride('not-an-org', 'https://crm.example.com'), null)
  assert.equal(getWebhookOverride(`${ORG}/../x`, 'https://crm.example.com'), null)
  // Meta takes at most 200 characters
  assert.equal(getWebhookOverride(ORG, `https://${'a'.repeat(180)}.example.com`), null)
})
