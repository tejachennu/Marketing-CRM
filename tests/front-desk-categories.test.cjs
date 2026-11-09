require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const C = require('../lib/salon/categories.ts')
const SP = require('../lib/salon/spoken.ts')

test('Categories migration: the app runs the file word for word', () => {
  const { FRONT_DESK_CATEGORIES_SQL } = require('../lib/salon/schema.ts')
  const file = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261112_front_desk_categories.sql'), 'utf8')
  assert.equal(FRONT_DESK_CATEGORIES_SQL, file)
  assert.match(file, /ADD COLUMN IF NOT EXISTS service_categories TEXT\[\]/)
})

test('Category names are cleaned, and the saved list drops empties and repeats', () => {
  assert.equal(C.categoryName('  Hair   &  Beard '), 'Hair & Beard')
  assert.equal(C.categoryName('x'.repeat(60)).length, 40)
  assert.deepEqual(C.cleanCategoryList(['Hair', ' hair ', '', null, 'Skin']), ['Hair', 'Skin'])
  assert.deepEqual(C.cleanCategoryList('not a list'), [])
})

test('Categories follow the saved order; ones only services use come after', () => {
  const services = [{ category: 'Nails' }, { category: 'hair' }, { category: '' }, { category: 'Nails' }]
  assert.deepEqual(C.orderedCategories(['Skin', 'Hair'], services), ['Skin', 'Hair', 'Nails', 'General'])
  const groups = C.groupByCategory(['Skin', 'Hair'], services)
  assert.deepEqual(groups.map(([name, list]) => [name, list.length]), [['Skin', 0], ['Hair', 1], ['Nails', 2], ['General', 1]])
  assert.ok(C.hasCategory(['Hair'], 'HAIR'))
})

test('Phone numbers: any country with its code, Indian numbers without one', () => {
  assert.equal(SP.parsePhoneNumber('98765 43210'), '+919876543210')
  assert.equal(SP.parsePhoneNumber('+91 98765 43210'), '+919876543210')
  assert.equal(SP.parsePhoneNumber('+971 50 123 4567'), '+971501234567')
  assert.equal(SP.parsePhoneNumber('00971501234567'), '+971501234567')
  assert.equal(SP.parsePhoneNumber('+1 (415) 555-0100'), '+14155550100')
  assert.equal(SP.parsePhoneNumber('+91 12345'), null)
  assert.equal(SP.parsePhoneNumber('+12'), null)
  assert.equal(SP.parsePhoneNumber('12345'), null)
})

test('WhatsApp window: closed when the customer never wrote or wrote over 24 hours ago', () => {
  const W = require('../lib/salon/whatsapp.ts')
  const now = Date.parse('2026-11-09T12:00:00Z')
  assert.equal(W.windowIsClosed(null, now), true)
  assert.equal(W.windowIsClosed(undefined, now), false)
  assert.equal(W.windowIsClosed('2026-11-09T07:30:00Z', now), false)
  assert.equal(W.windowIsClosed('2026-11-08T11:59:00Z', now), true)
})

test('Action log migration: the app runs the file word for word', () => {
  const { FRONT_DESK_ACTION_LOG_SQL } = require('../lib/salon/schema.ts')
  const file = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261113_front_desk_action_log.sql'), 'utf8')
  assert.equal(FRONT_DESK_ACTION_LOG_SQL, file)
})

test('Action log: the same client reference is done once; a failed one can be tried again', async () => {
  const L = require('../lib/salon/action-log.ts')
  const { salonDb } = require('./salon-fake-db.cjs')
  const db = salonDb({ salon_action_log: [] })
  const org = 'c0ffee00-0000-4000-8000-0000000000aa'
  assert.ok(L.isClientRef('local_8f3a2b1c9d'))
  assert.ok(!L.isClientRef('short'))
  assert.ok(!L.isClientRef('has spaces in it'))
  assert.deepEqual(await L.claimClientRef(db, org, 'local_bill_0001'), { fresh: true })
  assert.deepEqual(await L.claimClientRef(db, org, 'local_bill_0001'), { fresh: false, result: null })
  await L.saveClientResult(db, org, 'local_bill_0001', { success: true, message: 'Billed' })
  assert.deepEqual(await L.claimClientRef(db, org, 'local_bill_0001'), { fresh: false, result: { success: true, message: 'Billed' } })
  assert.deepEqual(await L.claimClientRef(db, org, 'local_bill_0002'), { fresh: true })
  await L.releaseClientRef(db, org, 'local_bill_0002')
  assert.deepEqual(await L.claimClientRef(db, org, 'local_bill_0002'), { fresh: true })
})
