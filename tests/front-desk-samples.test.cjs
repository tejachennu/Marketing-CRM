require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const S = require('../lib/salon/sample.ts')
const { salonDb } = require('./salon-fake-db.cjs')
const ORG = '11111111-1111-4111-8111-111111111111'

test('samples: what the starter lists made, never the owner\'s own', () => {
  const services = [
    { id: 's1', name: 'Screen replacement', price: 2500, duration_minutes: 60, source: 'own' }, // untouched sample (added before samples were marked)
    { id: 's2', name: 'Screen replacement', price: 2800, duration_minutes: 60, source: 'own' }, // price changed: the owner's now
    { id: 's3', name: 'Anything', price: 10, duration_minutes: 5, source: 'sample' }, // marked as a sample
    { id: 's4', name: 'Haircut (Men)', price: 300, duration_minutes: 30, source: 'catalog' }, // from the owner's catalog
    { id: 's5', name: 'My own service', price: 300, duration_minutes: 30 },
  ]
  const staff = [
    { id: 'm1', name: 'Imran' },
    { id: 'm2', name: 'Venkat', phone: '+919876543210' }, // a real person with a phone
    { id: 'm3', name: 'Suresh', commission_percent: 10 }, // commission set: real
    { id: 'm4', name: 'Ramesh' }, // not a starter-list name
  ]
  const found = S.sampleMatches(services, staff)
  assert.deepEqual(found.services.map((s) => s.id), ['s1', 's3'])
  assert.deepEqual(found.staff.map((m) => m.id), ['m1'])
})

test('samples: unused ones are deleted, used ones only switched off', async () => {
  const db = salonDb({
    salon_services: [
      { id: 'a', organization_id: ORG, name: 'AC service', price: 600, duration_minutes: 60, source: 'sample', active: true },
      { id: 'b', organization_id: ORG, name: 'Laptop service', price: 1500, duration_minutes: 90, source: 'sample', active: true },
      { id: 'c', organization_id: ORG, name: 'My service', price: 99, duration_minutes: 10, source: 'own', active: true },
    ],
    salon_staff: [
      { id: 'x', organization_id: ORG, name: 'Imran', active: true },
      { id: 'y', organization_id: ORG, name: 'Venkat', active: true },
    ],
    salon_appointments: [{ id: 'v1', organization_id: ORG, staff_id: 'y', services: [{ service_id: 'b', name: 'Laptop service' }] }],
    salon_invoices: [],
  })
  const setup = { services: db.tables.salon_services.slice(), staff: db.tables.salon_staff.slice() }
  const result = await S.removeSamples(db, ORG, setup)
  assert.deepEqual(result, { removed: { services: 1, staff: 1 }, switchedOff: { services: 1, staff: 1 } })
  assert.deepEqual(db.tables.salon_services.map((s) => [s.id, s.active]), [['b', false], ['c', true]])
  assert.deepEqual(db.tables.salon_staff.map((m) => [m.id, m.active]), [['y', false]])
})
