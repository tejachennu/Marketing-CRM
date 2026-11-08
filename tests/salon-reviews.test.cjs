require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const { salonDb } = require('./salon-fake-db.cjs')

const R = require('../lib/salon/ranges.ts')
const V = require('../lib/salon/reviews.ts')
const { allRows } = require('../lib/salon/rows.ts')

const NOW = Date.parse('2026-11-07T10:00:00+05:30')

test('Dates: presets are India dates, including yesterday and last month across the new year', () => {
  assert.deepEqual(R.periodRange('yesterday', NOW), { from: '2026-11-06', to: '2026-11-06' })
  assert.deepEqual(R.periodRange('yesterday', Date.parse('2026-11-01T09:00:00+05:30')), { from: '2026-10-31', to: '2026-10-31' })
  assert.deepEqual(R.periodRange('week', NOW), { from: '2026-11-01', to: '2026-11-07' })
  assert.deepEqual(R.periodRange('last_month', Date.parse('2026-03-31T23:00:00+05:30')), { from: '2026-02-01', to: '2026-02-28' })
  // Just after midnight in India, while it is still the day before in UTC
  assert.deepEqual(R.periodRange('today', Date.parse('2026-11-07T00:20:00+05:30')), { from: '2026-11-07', to: '2026-11-07' })
})

test('Dates: a custom range is two real dates, swapped if back to front, never past today, at most a year', () => {
  assert.deepEqual(R.resolveRange('custom', '2026-10-05', '2026-10-20', NOW), { preset: 'custom', from: '2026-10-05', to: '2026-10-20' })
  assert.deepEqual(R.resolveRange('custom', '2026-10-20', '2026-10-05', NOW), { preset: 'custom', from: '2026-10-05', to: '2026-10-20' })
  assert.deepEqual(R.resolveRange('custom', '2026-11-01', '2026-12-25', NOW), { preset: 'custom', from: '2026-11-01', to: '2026-11-07' })
  assert.deepEqual(R.resolveRange('custom', '2026-12-01', '2026-12-25', NOW), { preset: 'custom', from: '2026-11-07', to: '2026-11-07' })
  assert.deepEqual(R.resolveRange('custom', '2020-01-01', '2026-11-07', NOW), { preset: 'custom', from: '2025-11-07', to: '2026-11-07' })
  // Not real dates, or missing: the fallback
  assert.deepEqual(R.resolveRange('custom', '2026-02-30', '2026-03-03', NOW), { preset: 'month', from: '2026-11-01', to: '2026-11-07' })
  assert.deepEqual(R.resolveRange('custom', '2026-10-01', null, NOW), { preset: 'month', from: '2026-11-01', to: '2026-11-07' })
  assert.deepEqual(R.resolveRange('custom', "2026-10-01' or 1=1", '2026-10-02', NOW).preset, 'month')
  assert.deepEqual(R.resolveRange('forever', null, null, NOW), { preset: 'month', from: '2026-11-01', to: '2026-11-07' })
  assert.deepEqual(R.resolveRange(null, null, null, NOW, 'today'), { preset: 'today', from: '2026-11-07', to: '2026-11-07' })
  assert.deepEqual(R.resolveRange('yesterday', '2026-01-01', '2026-01-31', NOW), { preset: 'yesterday', from: '2026-11-06', to: '2026-11-06' })
})

test('Dates: database bounds, labels and the query string', () => {
  assert.deepEqual(R.rangeBounds({ from: '2026-11-01', to: '2026-11-07' }), { start: '2026-10-31T18:30:00.000Z', end: '2026-11-07T18:30:00.000Z' })
  assert.equal(R.rangeLabel({ from: '2026-11-07', to: '2026-11-07' }, '2026-11-07'), 'Today')
  assert.equal(R.rangeLabel({ from: '2026-11-01', to: '2026-11-07' }, '2026-11-07'), 'Sun, 1 Nov – Today')
  assert.equal(R.rangeLabel({ from: '2025-10-01', to: '2025-10-31' }, '2026-11-07'), 'Wed, 1 Oct 2025 – Fri, 31 Oct 2025')
  assert.equal(R.rangeQuery({ preset: 'week', from: '2026-11-01', to: '2026-11-07' }), 'preset=week')
  assert.equal(R.rangeQuery({ preset: 'custom', from: '2026-10-05', to: '2026-10-20' }), 'preset=custom&from=2026-10-05&to=2026-10-20')
})

test('Rows: long ranges are read a page at a time, up to the most allowed', async () => {
  const db = salonDb({ salon_invoices: Array.from({ length: 25 }, (_, i) => ({ id: `inv-${String(i).padStart(2, '0')}`, organization_id: 'o', issued_at: `2026-11-0${1 + (i % 7)}T10:00:00Z` })) })
  const calls = []
  const page = (from, to) => { calls.push([from, to]); return db.from('salon_invoices').select('*').eq('organization_id', 'o').order('id').range(from, to) }
  const all = await allRows(page, { pageSize: 10 })
  assert.equal(all.rows.length, 25)
  assert.equal(all.truncated, false)
  assert.equal(new Set(all.rows.map((r) => r.id)).size, 25)
  assert.deepEqual(calls, [[0, 9], [10, 19], [20, 29]])
  const capped = await allRows(page, { pageSize: 10, max: 20 })
  assert.deepEqual([capped.rows.length, capped.truncated], [20, true])
  await assert.rejects(allRows(() => Promise.resolve({ data: null, error: { message: 'boom' } })), /boom/)
})

const STAFF = [{ id: 's1', name: 'Anitha' }, { id: 's2', name: 'Lakshmi' }, { id: 's3', name: 'Ravi' }]
const review = (over) => ({ id: over.id, rating: 5, staff_ids: [], staff_names: [], staff_ratings: {}, tags: [], comment: null, followed_up_at: null, created_at: '2026-11-05T10:00:00Z', ...over })

test('Reviews: the summary — average, each star, happy share, people to call, what is mentioned most', () => {
  const rows = [
    review({ id: 'a', rating: 5, staff_ids: ['s1'], staff_names: ['Anitha'], tags: ['Friendly staff', 'Cleanliness'], comment: 'Lovely' }),
    review({ id: 'b', rating: 4, staff_ids: ['s1', 's2'], staff_names: ['Anitha', 'Lakshmi'], staff_ratings: { s1: 5, s2: 3 }, tags: ['Friendly staff'] }),
    review({ id: 'c', rating: 2, staff_ids: ['s2'], staff_names: ['Lakshmi'], tags: ['Long wait'], comment: '  ' }),
    review({ id: 'd', rating: 1, staff_names: ['Ravi'], followed_up_at: '2026-11-06T10:00:00Z', comment: 'Rude' }),
    review({ id: 'e', rating: 3 }),
  ]
  const s = V.reviewSummary(rows, STAFF)
  assert.equal(s.count, 5)
  assert.equal(s.average, 3)
  assert.deepEqual(s.distribution, [{ stars: 5, count: 1 }, { stars: 4, count: 1 }, { stars: 3, count: 1 }, { stars: 2, count: 1 }, { stars: 1, count: 1 }])
  assert.equal(s.happyPercent, 40)
  assert.equal(s.unhappy, 2)
  assert.equal(s.toCall, 1, 'the 1-star review was already called')
  assert.equal(s.comments, 2, 'blank comments do not count')
  assert.deepEqual(s.tags[0], { tag: 'Friendly staff', count: 2 })
  // Own stars from the form count; without them, the visit's rating counts for everyone on it
  assert.deepEqual(s.staff, [
    { id: 's1', name: 'Anitha', ratings: 2, average: 5 },
    { id: 's2', name: 'Lakshmi', ratings: 2, average: 2.5 },
    { id: 's3', name: 'Ravi', ratings: 1, average: 1 },
  ])
})

test('Reviews: nothing yet is an empty summary, not an error', () => {
  const s = V.reviewSummary([], STAFF)
  assert.deepEqual([s.count, s.average, s.happyPercent, s.unhappy, s.toCall, s.staff.length], [0, null, null, 0, 0, 0])
})

test('Reviews: who served the customer, with their own stars when given', () => {
  const invoice = { items: [{ name: 'Facial', staff_id: 's1', staff_name: 'Anitha' }, { name: 'Pedicure', staff_name: 'Guest stylist' }, { name: 'Threading', staff_id: 's1', staff_name: 'Anitha' }] }
  assert.deepEqual(V.reviewPeople({ staff_ratings: { s1: 4, 'name:Guest stylist': 9 } }, invoice), [
    { key: 's1', id: 's1', name: 'Anitha', rating: 4 },
    { key: 'name:Guest stylist', id: null, name: 'Guest stylist', rating: null },
  ])
  // A rating from the chat (no bill at hand): the names, no stars of their own
  assert.deepEqual(V.reviewPeople({ staff_names: ['Ravi'], staff_ratings: {} }, null), [{ key: 'name:Ravi', id: null, name: 'Ravi', rating: null }])
  assert.equal(V.needsCall({ rating: 2, followed_up_at: null }), true)
  assert.equal(V.needsCall({ rating: 2, followed_up_at: '2026-11-06T10:00:00Z' }), false)
  assert.equal(V.needsCall({ rating: 3, followed_up_at: null }), false)
})

// ── Finding a returning customer, and the counter's times ───────────────────

const C = require('../lib/salon/customers.ts')
const AV = require('../lib/salon/availability.ts')

test('Customers: what is typed becomes a safe search — digits of a number, or up to two words of a name', () => {
  assert.deepEqual(C.customerSearch('98480 120'), { digits: '98480120' })
  assert.deepEqual(C.customerSearch('+91 98480-12000'), { digits: '9848012000' })
  assert.deepEqual(C.customerSearch('Priya'), { words: ['Priya'] })
  assert.deepEqual(C.customerSearch('  priya  sharma reddy '), { words: ['priya', 'sharma'] })
  // Characters that mean something to the database are dropped
  assert.deepEqual(C.customerSearch('pri,ya)*.'), { words: ['pri', 'ya'] })
  assert.equal(C.customerSearch('9'), null)
  assert.equal(C.customerSearch('a'), null)
  assert.equal(C.customerSearch('%%'), null)
  assert.equal(C.customerSearch(null), null)
})

test('Customers: visits and the last visit come from their bills, newest first, void bills left out', () => {
  const visits = C.summarizeVisits([
    { contact_id: 'c1', status: 'paid', issued_at: '2026-11-01T06:00:00Z', total: 500, items: [{ name: 'Haircut', service_id: 's1', staff_id: 't1' }] },
    { contact_id: 'c1', status: 'paid', issued_at: '2026-11-05T06:00:00Z', total: 1700, items: [{ name: 'Facial', service_id: 's2', staff_id: 't1' }, { name: 'Manicure', service_id: 's3', staff_id: null }] },
    { contact_id: 'c1', status: 'void', issued_at: '2026-11-06T06:00:00Z', total: 9999, items: [{ name: 'Bridal', service_id: 's9' }] },
    { contact_id: null, status: 'paid', issued_at: '2026-11-06T06:00:00Z', total: 100, items: [] },
  ])
  assert.equal(visits.size, 1)
  assert.deepEqual(visits.get('c1'), { visits: 2, last_visit: { date: '2026-11-05', services: ['Facial', 'Manicure'], service_ids: ['s2', 's3'], staff_ids: ['t1', null], total: 1700 } })
})

test('Customers: found by part of the number or by name, regulars first, only in this workspace', async () => {
  const db = salonDb({
    contacts: [
      { id: 'c1', organization_id: 'o', first_name: 'Priya', last_name: 'Sharma', phone_number: '+919848012000' },
      { id: 'c2', organization_id: 'o', first_name: 'Priyanka', last_name: null, phone_number: '+919848012001' },
      { id: 'c3', organization_id: 'o', first_name: 'Ravi', last_name: 'Priyadarshi', phone_number: '+919000000000' },
      { id: 'c4', organization_id: 'other', first_name: 'Priya', last_name: 'Elsewhere', phone_number: '+919848012002' },
    ],
    salon_invoices: [{ id: 'i1', organization_id: 'o', contact_id: 'c2', status: 'paid', issued_at: '2026-11-05T06:00:00Z', total: 600, items: [{ name: 'Haircut', service_id: 's1' }] }],
  })
  const byPhone = await C.findCustomers(db, 'o', '98480 120')
  assert.deepEqual(byPhone.map((c) => c.contact_id), ['c2', 'c1'], 'the regular comes first; the other workspace is never searched')
  assert.equal(byPhone[0].visits, 1)
  assert.equal(byPhone[0].last_visit.services[0], 'Haircut')
  assert.equal(byPhone[1].last_visit, null)
  const byName = await C.findCustomers(db, 'o', 'priy')
  assert.deepEqual(byName.map((c) => c.name).sort(), ['Priya Sharma', 'Priyanka', 'Ravi Priyadarshi'])
  const twoWords = await C.findCustomers(db, 'o', 'priya sha')
  assert.deepEqual(twoWords.map((c) => c.contact_id), ['c1'])
  assert.deepEqual(await C.findCustomers(db, 'o', 'x'), [])
})

test('Customers: a contact known only by the WhatsApp number they messaged from is found too, and the whole number is an exact match', async () => {
  const db = salonDb({ contacts: [
    { id: 'w1', organization_id: 'o', first_name: 'Lavanya', last_name: null, phone_number: null, whatsapp_number: 'whatsapp:+919848099999' },
    { id: 'w2', organization_id: 'o', first_name: 'Latha', last_name: null, phone_number: '+919848099990', whatsapp_number: null },
  ] })
  const partial = await C.findCustomers(db, 'o', '9848099')
  assert.deepEqual(partial.map((c) => [c.contact_id, c.exact]).sort(), [['w1', false], ['w2', false]])
  const whole = await C.findCustomers(db, 'o', '+91 98480 99999')
  assert.deepEqual(whole.map((c) => [c.contact_id, c.exact, c.phone]), [['w1', true, '+919848099999']])
})

test('Counter times: every slot of the day, busy ones marked for the people chosen, late ones flagged', () => {
  const now = Date.parse('2026-11-07T13:10:00+05:30')
  const busy = [{ starts_at: '2026-11-07T15:00:00+05:30', ends_at: '2026-11-07T16:00:00+05:30', staff_ids: ['anitha'] }]
  const hours = { opens_at: '10:00', closes_at: '21:00' }
  const slots = AV.counterSlots({ date: '2026-11-07', now, hours, minutes: 60, eligibleStaff: ['anitha', 'ravi'], staffIds: ['anitha'], busy })
  assert.equal(slots[0].time, '13:00', 'past times today are left out, up to 15 minutes back')
  const at = (t) => slots.find((s) => s.time === t)
  assert.equal(at('14:00').free, true)
  assert.equal(at('14:30').free, false, 'would overlap Anitha at 3')
  assert.equal(at('15:30').free, false)
  assert.equal(at('16:00').free, true)
  assert.deepEqual([at('20:00').late, at('20:30').late, at('20:30').free], [false, true, true])
  assert.equal(slots.at(-1).time, '20:30')
  // Anyone who does it: Ravi is free at 3, so it is free
  const anyone = AV.counterSlots({ date: '2026-11-07', now, hours, minutes: 60, eligibleStaff: ['anitha', 'ravi'], busy })
  assert.equal(anyone.find((s) => s.time === '15:00').free, true)
  // A day gone by has no times; a later day starts at opening
  assert.deepEqual(AV.counterSlots({ date: '2026-11-06', now, hours, minutes: 30, eligibleStaff: [], busy: [] }), [])
  assert.equal(AV.counterSlots({ date: '2026-11-08', now, hours, minutes: 30, eligibleStaff: [], busy: [] })[0].time, '10:00')
})
