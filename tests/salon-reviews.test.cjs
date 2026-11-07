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
