require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const G = require('../lib/billing-gate.ts')

const DAY = 86_400_000
const NOW = Date.parse('2026-11-24T06:00:00Z')

/** A pretend Supabase that only knows one billing row */
function fakeDb(row) {
  let reads = 0
  const chain = {
    select() { return chain },
    eq() { return chain },
    async maybeSingle() { reads++; return { data: row, error: null } },
  }
  return { db: { from: () => chain }, reads: () => reads }
}

const trial = (endsIn) => ({ organization_id: 'o1', billing_exempt: false, status: 'trialing', trial_ends_at: new Date(NOW + endsIn).toISOString(), current_period_end: null, ai_balance: 100, ai_allowance: 300, whatsapp_mode: 'own', plan: 'growth' })

test('paused workspaces can still pay, sign in and load the app profile', () => {
  for (const [path, method] of [['/api/billing', 'GET'], ['/api/billing/subscribe', 'POST'], ['/api/auth/logout', 'POST'], ['/api/mobile/me', 'GET'], ['/api/mobile/devices', 'POST'], ['/api/organization', 'GET'], ['/api/billing/', 'GET']]) {
    assert.equal(G.openWhenEnded(path, method), true, `${method} ${path}`)
  }
})

test('everything else waits for a plan, including changing the workspace', () => {
  for (const [path, method] of [['/api/conversations', 'GET'], ['/api/salon/act', 'POST'], ['/api/commerce/orders', 'GET'], ['/api/organization', 'PUT'], ['/api/billingx', 'GET'], ['/api/mobile/push-test', 'POST'], ['/api/contacts', 'GET']]) {
    assert.equal(G.openWhenEnded(path, method), false, `${method} ${path}`)
  }
})

test('a trial with days left is open; an ended trial is paused with trial words', async () => {
  const open = await G.workspacePaused(fakeDb(trial(3 * DAY)).db, 'open-1', NOW)
  assert.equal(open.paused, false)
  const ended = await G.workspacePaused(fakeDb(trial(-DAY)).db, 'ended-1', NOW)
  assert.deepEqual({ paused: ended.paused, onTrial: ended.onTrial }, { paused: true, onTrial: true })
  assert.match(G.endedMessage(true), /free trial has ended/)
  assert.match(G.endedMessage(false), /plan has ended/)
})

test('a paid plan inside its month is open; exempt and no billing are never paused', async () => {
  const paid = { ...trial(-30 * DAY), status: 'active', current_period_end: new Date(NOW + 10 * DAY).toISOString() }
  assert.equal((await G.workspacePaused(fakeDb(paid).db, 'paid-1', NOW)).paused, false)
  assert.equal((await G.workspacePaused(fakeDb({ ...trial(-DAY), billing_exempt: true }).db, 'exempt-1', NOW)).paused, false)
})

test('billing is read once per half minute per workspace, and forgotten after a payment', async () => {
  const fake = fakeDb(trial(-DAY))
  await G.workspacePaused(fake.db, 'cache-1', NOW)
  await G.workspacePaused(fake.db, 'cache-1', NOW + 10_000)
  assert.equal(fake.reads(), 1)
  G.forgetWorkspace('cache-1')
  await G.workspacePaused(fake.db, 'cache-1', NOW + 11_000)
  assert.equal(fake.reads(), 2)
  await G.workspacePaused(fake.db, 'cache-1', NOW + 50_000)
  assert.equal(fake.reads(), 3)
})

test('a billing read error never locks anyone out', async () => {
  const broken = { from: () => ({ select() { return this }, eq() { return this }, async maybeSingle() { return { data: null, error: { message: 'connection reset' } } } }) }
  assert.equal((await G.workspacePaused(broken, 'broken-1', NOW)).paused, false)
})
