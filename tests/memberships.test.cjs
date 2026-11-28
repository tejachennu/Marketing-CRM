require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const M = require('../lib/salon/memberships.ts')
const A = require('../lib/salon/actions.ts')
const store = require('../lib/salon/membership-store.ts')
const { salonDb } = require('./salon-fake-db.cjs')

const ORG = 'org-salon'
const CUT = '00000000-0000-4000-8000-0000000000a1'
const FACIAL = '00000000-0000-4000-8000-0000000000a2'
const services = [
  { id: CUT, organization_id: ORG, name: 'Haircut', category: 'Hair', price: 500, duration_minutes: 30, tax_rate: 18, active: true },
  { id: FACIAL, organization_id: ORG, name: 'Facial', category: 'Skin', price: 1000, duration_minutes: 60, tax_rate: 18, active: true },
]
const settings = { business_name: 'Glow Salon', gstin: '', invoice_prefix: 'GLOW', prices_include_tax: false }
const ctxFor = (db) => ({ db, organizationId: ORG, user: { id: 'user-1' }, organization: { id: ORG }, settings })
const PRIYA = { name: 'Priya', phone: '+919876543210' }

test('Memberships: the migration file matches the SQL the app runs', () => {
  assert.equal(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261122_front_desk_memberships.sql'), 'utf8'), M.MEMBERSHIP_SQL)
  assert.equal(M.MEMBERSHIP_LOCK, 724519019)
  for (const t of ['salon_membership_plans', 'salon_memberships', 'salon_membership_usage']) assert.match(M.MEMBERSHIP_SQL, new RegExp(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`))
})

test('Memberships: a plan needs a name, a length and at least one benefit', () => {
  assert.match(M.readPlan({ name: 'G', price: 10, validity_days: 30, credit: 10 }).error, /name/)
  assert.match(M.readPlan({ name: 'Gold', price: 10, validity_days: 0, credit: 10 }).error, /How long/)
  assert.match(M.readPlan({ name: 'Gold', price: 10, validity_days: 30 }).error, /at least one benefit/)
  const { plan } = M.readPlan({ name: ' Gold ', price: '5000', validity_days: 365, credit: 6000, discount_percent: 150, tax_rate: 7, colour: 'pink', sessions: [{ service_id: CUT, count: 4 }, { service_id: CUT, count: 2 }, { service_id: 'x', count: 1 }, { service_id: FACIAL, count: 0 }] }, services)
  assert.equal(plan.name, 'Gold')
  assert.equal(plan.discount_percent, 100)
  assert.equal(plan.tax_rate, 18, 'unknown GST rate falls back to 18')
  assert.equal(plan.colour, M.PLAN_COLOURS[0])
  assert.deepEqual(plan.sessions, [{ service_id: CUT, name: 'Haircut', count: 4 }])
  assert.deepEqual(M.planBenefits({ ...plan, discount_percent: 10 }), ['₹6,000 to spend', '4 × Haircut', '10% off services', 'valid 1 year'])
  assert.equal(M.validityWords(90), '3 months')
})

test('Memberships: card state and validity', () => {
  const now = new Date('2026-11-15T10:00:00Z')
  const card = (starts, ends, status = 'active') => ({ status, starts_at: starts, expires_at: ends })
  assert.equal(M.cardState(card('2026-11-01T00:00:00Z', '2027-11-01T00:00:00Z'), now), 'active')
  assert.equal(M.cardState(card('2026-11-01T00:00:00Z', '2026-11-20T00:00:00Z'), now), 'expiring')
  assert.equal(M.cardState(card('2026-01-01T00:00:00Z', '2026-11-01T00:00:00Z'), now), 'expired')
  assert.equal(M.cardState(card('2026-12-01T00:00:00Z', '2027-12-01T00:00:00Z'), now), 'upcoming')
  assert.equal(M.cardState(card('2026-11-01T00:00:00Z', '2027-11-01T00:00:00Z', 'cancelled'), now), 'cancelled')
  assert.equal(M.usableCard(card('2026-11-01T00:00:00Z', '2026-11-20T00:00:00Z'), now), true)
  assert.equal(M.usableCard(card('2026-12-01T00:00:00Z', '2027-12-01T00:00:00Z'), now), false)
})

test('Memberships: on a bill, free sessions first, then the discount; credit pays the total', () => {
  const card = { plan: { discount_percent: 10 }, sessions: [{ service_id: CUT, name: 'Haircut', total: 4, used: 3 }], credit_balance: 700 }
  const lines = [
    { service_id: CUT, name: 'Haircut', price: 500, tax_rate: 18, sac_code: null },
    { service_id: CUT, name: 'Haircut', price: 500, tax_rate: 18, sac_code: null },
    { service_id: FACIAL, name: 'Facial', price: 1000, tax_rate: 18, sac_code: null },
    { service_id: null, name: 'Product', price: 200, tax_rate: 18, sac_code: null },
  ]
  const use = M.applyCard(card, lines)
  assert.deepEqual(use.lines.map((l) => l.price), [0, 450, 900, 200], 'one free cut left; 10% off the other services; not on products')
  assert.equal(use.lines[0].name, 'Haircut (membership)')
  assert.deepEqual(use.sessions, [{ service_id: CUT, name: 'Haircut', count: 1 }])
  assert.equal(use.discountSaved, 150)
  assert.equal(use.sessionsSaved, 500)
  assert.equal(M.creditToUse(card, 1550), 700)
  assert.equal(M.creditToUse(card, 300), 300)
  const after = M.cardAfterUse(card, { sessions: use.sessions, credit: 700 })
  assert.equal(after.credit_balance, 0)
  assert.equal(after.sessions[0].used, 4)
  const back = M.cardAfterRefund(after, { sessions: use.sessions, credit: 700 })
  assert.equal(back.credit_balance, 700)
  assert.equal(back.sessions[0].used, 3)
})

test('Memberships: the card page shows no ids and only https logos', () => {
  const view = M.publicCard({ id: 'secret', organization_id: 'org', card_number: 'MB-0001', plan: { name: 'Gold', colour: '#1D5BEA', discount_percent: 5 }, customer_name: 'Priya', customer_phone: '+91', contact_id: 'c', starts_at: '2026-01-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z', credit_balance: '1200.50', sessions: [{ service_id: CUT, name: 'Haircut', total: 4, used: 1 }], status: 'active', public_token: 'tok' }, { name: 'Glow', logo_url: 'http://x/logo.png' })
  const text = JSON.stringify(view)
  for (const hidden of ['secret', '"org"', 'tok', 'contact_id']) assert.ok(!text.includes(hidden), hidden)
  assert.equal(view.business.logo, '')
  assert.equal(view.credit, 1200.5)
  assert.deepEqual(view.sessions, [{ name: 'Haircut', total: 4, left: 3 }])
  assert.equal(M.usageWords({ kind: 'credit', amount: 450 }), 'Paid ₹450 from credit')
  assert.equal(M.usageWords({ kind: 'session', detail: 'Haircut', sessions: 1 }), 'Used 1 × Haircut')
})

test('Memberships: sell a card, use it on a walk-in bill, then cancel the bill and get it all back', async () => {
  const db = salonDb({ salon_services: services })
  const ctx = ctxFor(db)
  const plan = await store.savePlan(db, ORG, { name: 'Gold', price: 2000, validity_days: 365, credit: 1000, discount_percent: 10, sessions: [{ service_id: CUT, count: 2 }], tax_rate: 0 })
  assert.match(A.parseCounterAction({ type: 'sell_membership', customer: { name: 'Priya' }, plan_id: plan.id }).error, /mobile number/)

  const sold = await A.executeCounterAction(ctx, A.parseCounterAction({ type: 'sell_membership', customer: PRIYA, plan_id: plan.id, payment_method: 'upi', send_whatsapp: false }).action)
  const card = sold.membership
  assert.equal(card.card_number, 'MB-0001')
  assert.equal(Number(card.credit_balance), 1000)
  assert.equal(sold.invoice.items[0].name, 'Membership: Gold')
  assert.equal(Number(sold.invoice.total), 2000)
  assert.equal(sold.invoice.status, 'paid')

  // Found by the customer's phone, written differently
  const found = await store.cardsForCustomer(db, ORG, { phone: '98765 43210' })
  assert.deepEqual(found.map((c) => c.id), [card.id])

  // Haircut (free) + Facial (10% off = 900) → total 900, all paid from credit
  const billed = await A.executeCounterAction(ctx, A.parseCounterAction({ type: 'walk_in_bill', customer: PRIYA, service_ids: [CUT, FACIAL], membership_id: card.id, send_whatsapp: false }).action)
  assert.equal(Number(billed.invoice.total), 900)
  assert.equal(Number(billed.invoice.membership_paid), 900)
  assert.equal(billed.invoice.status, 'paid')
  assert.equal(billed.invoice.payment_method, 'membership')
  assert.match(billed.message, /card MB-0001 used/)
  let now = await store.loadCard(db, ORG, card.id)
  assert.equal(Number(now.credit_balance), 100)
  assert.equal(now.sessions[0].used, 1)
  const kinds = db.tables.salon_membership_usage.filter((u) => u.invoice_id === billed.invoice.id).map((u) => u.kind).sort()
  assert.deepEqual(kinds, ['credit', 'discount', 'session'])

  // Second bill: credit runs out, the rest is paid by cash
  const second = await A.executeCounterAction(ctx, A.parseCounterAction({ type: 'walk_in_bill', customer: PRIYA, service_ids: [FACIAL], membership_id: card.id, payment_method: 'cash', send_whatsapp: false }).action)
  assert.equal(Number(second.invoice.membership_paid), 100)
  assert.equal(second.invoice.payment_method, 'cash')

  // Cancelling the first bill gives back its session and credit (once)
  await A.executeCounterAction(ctx, { type: 'void_invoice', invoice_id: billed.invoice.id })
  await A.executeCounterAction(ctx, { type: 'void_invoice', invoice_id: billed.invoice.id })
  now = await store.loadCard(db, ORG, card.id)
  assert.equal(Number(now.credit_balance), 900)
  assert.equal(now.sessions[0].used, 0)
  assert.equal(db.tables.salon_membership_usage.filter((u) => u.kind === 'refund').length, 1)

  // Cancelling the bill the card was sold on cancels the card
  await A.executeCounterAction(ctx, { type: 'void_invoice', invoice_id: sold.invoice.id })
  now = await store.loadCard(db, ORG, card.id)
  assert.equal(now.status, 'cancelled')
  await assert.rejects(A.executeCounterAction(ctx, A.parseCounterAction({ type: 'walk_in_bill', customer: PRIYA, service_ids: [CUT], membership_id: card.id, send_whatsapp: false }).action), /cannot be used today/)
})

test('Memberships: a card is never used on another customer\'s bill', async () => {
  const db = salonDb({ salon_services: services })
  const ctx = ctxFor(db)
  const plan = await store.savePlan(db, ORG, { name: 'Silver', price: 1000, validity_days: 30, credit: 1000 })
  const sold = await A.executeCounterAction(ctx, A.parseCounterAction({ type: 'sell_membership', customer: PRIYA, plan_id: plan.id, payment_method: 'cash', send_whatsapp: false }).action)
  await assert.rejects(
    A.executeCounterAction(ctx, A.parseCounterAction({ type: 'walk_in_bill', customer: { name: 'Ravi', phone: '+919999988888' }, service_ids: [CUT], membership_id: sold.membership.id, send_whatsapp: false }).action),
    /belongs to another customer/,
  )
})

test('Memberships: shop changes are written to the card\'s history', async () => {
  const db = salonDb({ salon_services: services })
  const ctx = ctxFor(db)
  const plan = await store.savePlan(db, ORG, { name: 'Gold', price: 0, validity_days: 30, credit: 500, sessions: [{ service_id: CUT, count: 2 }] })
  const { membership } = await A.executeCounterAction(ctx, A.parseCounterAction({ type: 'sell_membership', customer: PRIYA, plan_id: plan.id, send_whatsapp: false }).action)
  const before = Date.parse(membership.expires_at)
  let card = await store.adjustCard(db, ORG, membership.id, { type: 'extend', days: 30 }, 'u')
  assert.ok(Date.parse(card.expires_at) >= before + 29 * 86_400_000)
  card = await store.adjustCard(db, ORG, membership.id, { type: 'credit', amount: 250 }, 'u')
  assert.equal(Number(card.credit_balance), 750)
  await assert.rejects(store.adjustCard(db, ORG, membership.id, { type: 'credit', amount: -5000 }, 'u'), /does not have that much/)
  card = await store.adjustCard(db, ORG, membership.id, { type: 'sessions', service_id: CUT, count: 1 }, 'u')
  assert.equal(card.sessions[0].total, 3)
  card = await store.adjustCard(db, ORG, membership.id, { type: 'cancel' }, 'u')
  assert.equal(card.status, 'cancelled')
  const kinds = db.tables.salon_membership_usage.filter((u) => u.membership_id === membership.id).map((u) => u.kind)
  assert.deepEqual(kinds, ['sale', 'adjust', 'adjust', 'adjust', 'cancel'])
})

test('Memberships: the report counts money in, use, and what is still owed', () => {
  const now = new Date('2026-11-15T00:00:00Z')
  const cards = [
    { id: 'a', plan: { name: 'Gold' }, status: 'active', starts_at: '2026-01-01T00:00:00Z', expires_at: '2027-01-01T00:00:00Z', credit_balance: 400, sessions: [{ total: 4, used: 1 }] },
    { id: 'b', plan: { name: 'Gold' }, status: 'active', starts_at: '2026-01-01T00:00:00Z', expires_at: '2026-11-20T00:00:00Z', credit_balance: 100, sessions: [] },
    { id: 'c', plan: { name: 'Silver' }, status: 'cancelled', starts_at: '2026-01-01T00:00:00Z', expires_at: '2027-01-01T00:00:00Z', credit_balance: 999, sessions: [] },
  ]
  const usage = [
    { membership_id: 'a', kind: 'sale', amount: 5000 }, { membership_id: 'b', kind: 'sale', amount: 5000 },
    { membership_id: 'a', kind: 'credit', amount: 600 }, { membership_id: 'a', kind: 'session', amount: 0, sessions: 1 }, { membership_id: 'b', kind: 'discount', amount: 50 },
  ]
  const r = M.membershipReport(cards, usage, [{ id: 'p', name: 'Gold' }], now)
  assert.deepEqual([r.sold, r.revenue, r.creditUsed, r.sessionsUsed, r.discountGiven], [2, 10000, 600, 1, 50])
  assert.equal(r.creditOwed, 500, 'cancelled cards owe nothing')
  assert.equal(r.sessionsOwed, 3)
  assert.equal(r.cards.expiring, 1)
  assert.equal(r.perPlan[0].plan, 'Gold')
  assert.equal(r.perPlan[0].revenue, 10000)
})

test('Memberships: the rules file has no server code (it runs in the browser)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../lib/salon/membership-rules.ts'), 'utf8')
  // Only the pure money helpers (the business's currency), which import nothing themselves
  for (const line of src.match(/^import .*$/gm) || []) assert.match(line, /from '\.\.\/money'$/)
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../lib/money.ts'), 'utf8'), /^import /m)
})
