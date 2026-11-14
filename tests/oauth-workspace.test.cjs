require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const { salonDb } = require('./salon-fake-db.cjs')

const O = require('../lib/auth/oauth-workspace.ts')

const PERSON = { id: '11111111-1111-4111-8111-111111111111', email: 'priya@example.com', name: 'Priya Rao', provider: 'google' }

test('Google sign-in: the business step needs a name; a plan is kept only when it is a real one', () => {
  assert.match(O.parseBusinessStep({}).error, /business name/)
  assert.deepEqual(O.parseBusinessStep({ companyName: '  Glow   Salon ', plan: 'pro_2' }), { companyName: 'Glow Salon', fullName: null, plan: 'pro_2' })
  assert.equal(O.parseBusinessStep({ companyName: 'Glow', plan: 'gold' }).plan, null)
  assert.match(O.slugFor('Glow Salon & Spa!'), /^glow-salon-spa-[0-9a-f]{8}$/)
})

test('Google sign-in: the first time makes the business with the person as owner; again, nothing new', async () => {
  const db = salonDb({ organizations: [], users: [], pipeline_stages: [] })
  const first = await O.createWorkspaceFor(db, PERSON, { companyName: 'Glow Salon', fullName: null, plan: null })
  assert.equal(first.created, true)
  assert.equal(first.user.role, 'owner')
  assert.equal(first.user.full_name, 'Priya Rao')
  assert.equal(db.tables.organizations.length, 1)
  assert.equal(db.tables.organizations[0].contact_email, 'priya@example.com')
  assert.equal(db.tables.pipeline_stages.length, 5)
  const again = await O.createWorkspaceFor(db, PERSON, { companyName: 'Another', fullName: null, plan: null })
  assert.equal(again.created, false)
  assert.equal(db.tables.organizations.length, 1)
})

test('Google sign-in: an invalid or expired token is nobody', async () => {
  const anon = { auth: { getUser: async (token) => (token === 'good' ? { data: { user: { id: 'u1', email: 'A@Example.com', user_metadata: { full_name: 'A B' }, app_metadata: { provider: 'google' } } }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } }) } }
  assert.deepEqual(await O.personFromToken(anon, 'good'), { id: 'u1', email: 'a@example.com', name: 'A B', provider: 'google' })
  assert.equal(await O.personFromToken(anon, 'bad'), null)
  assert.equal(await O.personFromToken(anon, null), null)
})
