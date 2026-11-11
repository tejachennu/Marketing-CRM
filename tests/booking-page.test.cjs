require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const { salonDb } = require('./salon-fake-db.cjs')

const BP = require('../lib/salon/booking-page.ts')

const ORG = '11111111-1111-4111-8111-111111111111'
const CUT = '22222222-2222-4222-8222-222222222222'
const COLOUR = '33333333-3333-4333-8333-333333333333'
const ANU = '44444444-4444-4444-8444-444444444444'
const RAVI = '55555555-5555-4555-8555-555555555555'
// Thursday 12 Nov 2026, 9 am in India
const NOW = Date.parse('2026-11-12T03:30:00Z')

const seed = (settings = {}) => ({
  organizations: [{ id: ORG, name: 'Glow', slug: 'glow-ab12', enabled_connectors: ['salon'] }],
  salon_settings: [{ organization_id: ORG, business_name: 'Glow Salon', opens_at: '10:00', closes_at: '20:00', closed_weekdays: [2], phone: '+91 98480 12345', ...settings }],
  salon_services: [
    { id: CUT, organization_id: ORG, name: 'Haircut', category: 'Hair', price: 300, duration_minutes: 30, tax_rate: 18, active: true, position: 1 },
    { id: COLOUR, organization_id: ORG, name: 'Colour', category: 'Hair', price: 1500, duration_minutes: 90, tax_rate: 18, active: true, position: 2 },
  ],
  salon_staff: [
    { id: ANU, organization_id: ORG, name: 'Anu', active: true, service_ids: [CUT, COLOUR] },
    { id: RAVI, organization_id: ORG, name: 'Ravi', active: true, service_ids: [CUT] },
  ],
})

test('Booking page: found by slug only when Front Desk is on and has services', async () => {
  assert.ok(await BP.loadBookingPage(salonDb(seed()), 'glow-ab12'))
  assert.equal(await BP.loadBookingPage(salonDb(seed()), 'nobody'), null)
  const off = seed(); off.organizations[0].enabled_connectors = []
  assert.equal(await BP.loadBookingPage(salonDb(off), 'glow-ab12'), null)
  assert.equal(await BP.loadBookingPage(salonDb(seed()), '../etc'), null)
})

test('Booking page: what the public sees has no costs or notes, and closed days are skipped', async () => {
  const page = await BP.loadBookingPage(salonDb(seed()), 'glow-ab12')
  const view = BP.publicView(page)
  assert.deepEqual(view.services.map((s) => [s.name, s.price, s.minutes]), [['Haircut', 300, 30], ['Colour', 1500, 90]])
  assert.equal(view.approval, true)
  assert.deepEqual(Object.keys(view.staff[0]).sort(), ['id', 'name', 'service_ids'])
  const days = BP.bookableDays(page.setup.settings, NOW, 7)
  assert.equal(days[0], '2026-11-12')
  // Tuesday (2) is closed
  assert.ok(!days.includes('2026-11-17'))
  assert.equal(days.length, 6)
})

test('Booking page: a person who does not do every service cannot be picked', async () => {
  const db = salonDb(seed())
  const page = await BP.loadBookingPage(db, 'glow-ab12')
  const bad = await BP.bookingTimes(db, page, { serviceIds: [COLOUR], staffId: RAVI, date: '2026-11-12' }, NOW)
  assert.match(bad.error, /does not do all/)
  const ok = await BP.bookingTimes(db, page, { serviceIds: [CUT], staffId: null, date: '2026-11-12' }, NOW)
  assert.equal(ok.times[0], '10:00')
})

test('Booking page: the form is checked before anything is saved', () => {
  assert.match(BP.parseOnlineBooking({}).error, /service/)
  const base = { service_ids: [CUT], date: '2026-11-12', time: '11:00', name: 'Priya', phone: '+91 90000 11111' }
  assert.equal(BP.parseOnlineBooking(base).phone.replace(/\D/g, '').endsWith('9000011111'), true)
  assert.match(BP.parseOnlineBooking({ ...base, phone: '123' }).error, /mobile number/)
  assert.match(BP.parseOnlineBooking({ ...base, name: 'P' }).error, /name/)
  assert.match(BP.parseOnlineBooking({ ...base, time: '11' }).error, /time/)
})

test('Booking page: a booking waits as a request, picks a free person, and is not saved twice', async () => {
  const db = salonDb(seed())
  const page = await BP.loadBookingPage(db, 'glow-ab12')
  const input = BP.parseOnlineBooking({ service_ids: [CUT], date: '2026-11-12', time: '11:00', name: 'Priya Rao', phone: '+91 90000 11111', note: 'First visit' })
  const result = await BP.createOnlineBooking(db, page, input, NOW)
  assert.equal(result.status, 'requested')
  assert.equal(result.appointment.source, 'online')
  assert.match(result.appointment.notes, /First visit/)
  assert.ok([ANU, RAVI].includes(result.appointment.staff_id))
  assert.equal(db.tables.contacts.length, 1)
  const again = await BP.createOnlineBooking(db, page, input, NOW)
  assert.ok(again.error)
})

test('Booking page: with "accept on their own" it is booked; a taken time is refused', async () => {
  const db = salonDb(seed({ auto_approve_bookings: true }))
  const page = await BP.loadBookingPage(db, 'glow-ab12')
  const first = await BP.createOnlineBooking(db, page, BP.parseOnlineBooking({ service_ids: [COLOUR], staff_id: ANU, date: '2026-11-12', time: '12:00', name: 'Priya', phone: '+91 90000 11111' }), NOW)
  assert.equal(first.status, 'booked')
  assert.equal(first.staffName, 'Anu')
  const clash = await BP.createOnlineBooking(db, page, BP.parseOnlineBooking({ service_ids: [CUT], staff_id: ANU, date: '2026-11-12', time: '12:30', name: 'Kiran', phone: '+91 90000 22222' }), NOW)
  assert.equal(clash.taken, true)
})
