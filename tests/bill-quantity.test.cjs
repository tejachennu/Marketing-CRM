require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const A = require('../lib/salon/actions.ts')
const M = require('../lib/salon/memberships.ts')
const P = require('../lib/salon/performance.ts')
const store = require('../lib/salon/membership-store.ts')
const { salonDb } = require('./salon-fake-db.cjs')

// A count for each service on a walk-in bill: 2 × Threading is one line with quantity 2, not two lines.

const ORG = 'org-salon'
const CUT = '00000000-0000-4000-8000-0000000000a1'
const THREAD = '00000000-0000-4000-8000-0000000000a3'
const services = [
  { id: CUT, organization_id: ORG, name: 'Haircut', category: 'Hair', price: 500, duration_minutes: 30, tax_rate: 18, active: true },
  { id: THREAD, organization_id: ORG, name: 'Threading', category: 'Skin', price: 60, duration_minutes: 10, tax_rate: 18, active: true },
]
const settings = { business_name: 'Glow Salon', gstin: '', invoice_prefix: 'GLOW', prices_include_tax: false }
const ctxFor = (db) => ({ db, organizationId: ORG, user: { id: 'user-1' }, organization: { id: ORG }, settings })

test('Bill counts: each service keeps the count sent at its place; wrong counts become 1, never more than 99', () => {
  const parsed = A.parseCounterAction({ type: 'walk_in_bill', customer: { name: 'Asha' }, service_ids: [THREAD, CUT, THREAD], quantities: [3, 'x', 5] })
  assert.deepEqual(parsed.action.service_ids, [THREAD, CUT])
  assert.deepEqual(parsed.action.quantities, [3, 1], 'a repeated id keeps the first count; a word counts as 1')
  assert.deepEqual(A.parseCounterAction({ type: 'walk_in_bill', customer: { name: 'Asha' }, service_ids: [CUT], quantities: [500] }).action.quantities, [99])
  assert.deepEqual(A.parseCounterAction({ type: 'walk_in_bill', customer: { name: 'Asha' }, service_ids: [CUT], quantities: [0] }).action.quantities, [1])
  assert.equal(A.parseCounterAction({ type: 'walk_in_bill', customer: { name: 'Asha' }, service_ids: [CUT] }).action.quantities, undefined, 'older apps send no counts')
})

test('Bill counts: a walk-in bill bills 3 × Threading as one line and the visit takes three times as long', async () => {
  const db = salonDb({ salon_services: services })
  const result = await A.executeCounterAction(ctxFor(db), A.parseCounterAction({ type: 'walk_in_bill', customer: { name: 'Asha' }, service_ids: [THREAD, CUT], quantities: [3, 1], payment_method: 'cash', send_whatsapp: false }).action)
  const items = result.invoice.items
  assert.deepEqual(items.map((i) => [i.name, i.quantity, i.price, i.total]), [['Threading', 3, 60, 180], ['Haircut', 1, 500, 500]])
  assert.equal(Number(result.invoice.subtotal), 680)
  assert.equal(Number(result.invoice.total), 680)
  const visit = result.appointment
  assert.equal(Math.round((Date.parse(visit.ends_at) - Date.parse(visit.starts_at)) / 60000), 3 * 10 + 30)
  assert.equal(visit.services[0].quantity, 3)

  // Without counts nothing changes: one of each
  const plain = await A.executeCounterAction(ctxFor(db), A.parseCounterAction({ type: 'walk_in_bill', customer: { name: 'Ravi' }, service_ids: [THREAD], payment_method: 'cash', send_whatsapp: false }).action)
  assert.deepEqual(plain.invoice.items.map((i) => [i.quantity, i.total]), [[1, 60]])
})

test('Bill counts: a membership card makes as many free as it has sessions left, then its discount on the rest', () => {
  const card = { plan: { discount_percent: 10 }, sessions: [{ service_id: CUT, name: 'Haircut', total: 4, used: 3 }] }
  const use = M.applyCard(card, [{ service_id: CUT, name: 'Haircut', quantity: 3, price: 500, tax_rate: 18, sac_code: null }])
  assert.deepEqual(use.lines.map((l) => [l.name, l.quantity, l.price]), [['Haircut (membership)', 1, 0], ['Haircut', 2, 450]])
  assert.deepEqual(use.sessions, [{ service_id: CUT, name: 'Haircut', count: 1 }])
  assert.equal(use.sessionsSaved, 500)
  assert.equal(use.discountSaved, 100)

  // Enough sessions for all of them: one free line with the whole count
  const plenty = M.applyCard({ plan: {}, sessions: [{ service_id: CUT, name: 'Haircut', total: 5, used: 0 }] }, [{ service_id: CUT, name: 'Haircut', quantity: 2, price: 500, tax_rate: 18, sac_code: null }])
  assert.deepEqual(plenty.lines.map((l) => [l.name, l.quantity, l.price]), [['Haircut (membership)', 2, 0]])
  assert.deepEqual(plenty.sessions, [{ service_id: CUT, name: 'Haircut', count: 2 }])
})

test('Bill counts: a card used on 2 × Haircut takes two sessions, and cancelling the bill gives both back', async () => {
  const db = salonDb({ salon_services: services })
  const ctx = ctxFor(db)
  const plan = await store.savePlan(db, ORG, { name: 'Silver', price: 1000, validity_days: 365, sessions: [{ service_id: CUT, count: 3 }], tax_rate: 0 })
  const sold = await A.executeCounterAction(ctx, A.parseCounterAction({ type: 'sell_membership', customer: { name: 'Priya', phone: '+919876543210' }, plan_id: plan.id, payment_method: 'cash', send_whatsapp: false }).action)
  const card = sold.membership
  const billed = await A.executeCounterAction(ctx, A.parseCounterAction({ type: 'walk_in_bill', customer: { name: 'Priya', phone: '+919876543210' }, service_ids: [CUT, THREAD], quantities: [2, 1], membership_id: card.id, payment_method: 'cash', send_whatsapp: false }).action)
  assert.deepEqual(billed.invoice.items.map((i) => [i.name, i.quantity, i.total]), [['Haircut (membership)', 2, 0], ['Threading', 1, 60]])
  let now = await store.loadCard(db, ORG, card.id)
  assert.equal(now.sessions[0].used, 2)
  await A.executeCounterAction(ctx, { type: 'void_invoice', invoice_id: billed.invoice.id })
  now = await store.loadCard(db, ORG, card.id)
  assert.equal(now.sessions[0].used, 0)
})

test('Bill counts: the team page counts 3 × Threading as three services done', () => {
  const staff = [{ id: 's1', name: 'Anitha', commission_percent: 10, active: true }]
  const invoices = [{ id: 'i1', status: 'paid', issued_at: '2026-11-28T05:00:00Z', items: [{ name: 'Threading', quantity: 3, taxable: 180, staff_id: 's1', staff_name: 'Anitha' }, { name: 'Haircut', taxable: 500, staff_id: 's1', staff_name: 'Anitha' }] }]
  const anitha = P.computePerformance(invoices, [], staff).staff.find((r) => r.name === 'Anitha')
  assert.deepEqual([anitha.services, anitha.revenue, anitha.commission], [4, 680, 68])
  assert.deepEqual(anitha.topServices[0], { name: 'Threading', count: 3 })
})

test('Bill counts: prices with GST in them add up to the price itself (₹600 was billed as ₹599.99)', () => {
  const { computeInvoice } = require('../lib/salon/invoice.ts')
  const one = computeInvoice([{ name: 'Haircut', price: 600, tax_rate: 18 }], { pricesIncludeTax: true })
  assert.deepEqual([one.total, one.taxable, one.tax], [600, 508.47, 91.53])
  const two = computeInvoice([{ name: 'Haircut', price: 300, quantity: 2, tax_rate: 18 }], { pricesIncludeTax: true })
  assert.equal(two.total, 600)
  assert.equal(two.cgst + two.sgst, two.tax)
  // A discount still comes off before GST: ₹100 off ₹1,180 at 18% is ₹1,062
  assert.equal(computeInvoice([{ name: 'Facial', price: 1180, tax_rate: 18 }], { pricesIncludeTax: true, discount: { type: 'amount', value: 100 } }).total, 1062)
})
