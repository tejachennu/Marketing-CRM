require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const { generateKeyPairSync, createSign } = require('node:crypto')

const F = require('../lib/auth/firebase-signin.ts')

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
const other = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
const NOW = Date.parse('2026-11-14T10:00:00Z')
const s = Math.floor(NOW / 1000)
const PROJECT = 'dynamic-linking-ec557'
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')

function token(claims = {}, { kid = 'k1', key = privateKey, alg = 'RS256' } = {}) {
  const head = b64({ alg, kid, typ: 'JWT' })
  const body = b64({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: 'firebase-uid', iat: s - 10, exp: s + 3600, email: 'Priya@Example.com', email_verified: true, name: 'Priya Rao', firebase: { sign_in_provider: 'google.com' }, ...claims })
  const signature = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key).toString('base64url')
  return `${head}.${body}.${signature}`
}
const certs = { k1: publicKey }

test('Google sign-in: a token signed by Google for this project gives the person', async () => {
  assert.deepEqual(await F.verifyFirebaseToken(token(), PROJECT, certs, NOW), { uid: 'firebase-uid', email: 'priya@example.com', name: 'Priya Rao', provider: 'google.com' })
})

test('Google sign-in: forged, other-project, expired and unconfirmed tokens are refused', async () => {
  const refused = async (t) => 'error' in (await F.verifyFirebaseToken(t, PROJECT, certs, NOW))
  assert.ok(await refused(token({}, { key: other.privateKey })))
  assert.ok(await refused(token({}, { kid: 'unknown' })))
  assert.ok(await refused(token({ aud: 'another-project' })))
  assert.ok(await refused(token({ iss: 'https://securetoken.google.com/another-project' })))
  assert.ok(await refused(token({ exp: s - 600 })))
  assert.ok(await refused(token({ email_verified: false })))
  assert.ok(await refused(token({ email: '' })))
  assert.ok(await refused('not.a.token'))
  assert.ok(await refused(undefined))
  // A changed body breaks the signature
  const [h, , sig] = token().split('.')
  assert.ok(await refused(`${h}.${b64({ aud: PROJECT, email: 'boss@example.com', email_verified: true })}.${sig}`))
})

test('Google sign-in: an existing Supabase account is used, a new email makes one', async () => {
  const calls = []
  const admin = (exists) => ({ auth: { admin: {
    createUser: async (input) => { calls.push(['create', input.email, input.email_confirm]); return exists ? { data: null, error: { message: 'A user with this email address has already been registered' } } : { data: { user: { id: 'new' } }, error: null } },
    generateLink: async (input) => { calls.push(['link', input.type, input.email]); return { data: { properties: { hashed_token: 'hash123' } }, error: null } },
  } } })
  const anon = { auth: { verifyOtp: async (input) => { calls.push(['verify', input.token_hash, input.type]); return { data: { session: { access_token: 'at', refresh_token: 'rt', token_type: 'bearer', expires_in: 3600, expires_at: s + 3600, user: { id: 'u1' } } }, error: null } } } }
  const person = { uid: 'f', email: 'priya@example.com', name: 'Priya', provider: 'google.com' }
  const existing = await F.supabaseSessionFor(admin(true), anon, person)
  assert.equal(existing.created, false)
  assert.equal(existing.session.refresh_token, 'rt')
  assert.deepEqual(calls.slice(1), [['link', 'magiclink', 'priya@example.com'], ['verify', 'hash123', 'magiclink']])
  calls.length = 0
  const fresh = await F.supabaseSessionFor(admin(false), anon, person)
  assert.equal(fresh.created, true)
  assert.deepEqual(calls[0], ['create', 'priya@example.com', true])
  // Any other problem making the account stops the sign-in
  const broken = { auth: { admin: { createUser: async () => ({ error: { message: 'Database error' } }) } } }
  await assert.rejects(F.supabaseSessionFor(broken, anon, person), /Database error/)
})
