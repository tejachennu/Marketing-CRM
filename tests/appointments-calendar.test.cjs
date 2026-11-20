require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const C = require('../lib/salon/calendar.ts')
const A = require('../lib/salon/actions.ts')
const { salonDb } = require('./salon-fake-db.cjs')

const ORG = 'org-salon'
const S1 = '00000000-0000-4000-8000-0000000000a1'
const ANITHA = '00000000-0000-4000-8000-0000000000b1'
const RAVI = '00000000-0000-4000-8000-0000000000b2'
const at = (date, hhmm) => new Date(`${date}T${hhmm}:00+05:30`).toISOString()

test('Calendar: India-time minutes, dates and weeks', () => {
  assert.equal(C.istMinutes(at('2026-11-16', '09:30')), 9 * 60 + 30)
  assert.equal(C.clockMinutes('18:45'), 18 * 60 + 45)
  assert.equal(C.clockMinutes('late'), null)
  assert.equal(C.shiftDate('2026-12-31', 1), '2027-01-01')
  assert.deepEqual(C.weekOf('2026-11-19'), ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'], 'Monday to Sunday')
  assert.equal(C.weekOf('2026-11-22')[0], '2026-11-16', 'Sunday belongs to the week before')
})

test('Calendar: the day grid spans opening hours and stretches for late bookings', () => {
  assert.deepEqual(C.dayWindow({ opens_at: '10:00', closes_at: '20:00' }, []), { start: 600, end: 1200 })
  assert.deepEqual(C.dayWindow({ opens_at: '10:00', closes_at: '20:00' }, [{ starts_at: at('2026-11-16', '08:30'), ends_at: at('2026-11-16', '09:00') }, { starts_at: at('2026-11-16', '20:15'), ends_at: at('2026-11-16', '21:10') }]), { start: 480, end: 1320 })
  assert.deepEqual(C.dayWindow({}, []), { start: 540, end: 1260 }, '9 to 9 when hours are not set')
})

test('Calendar: bookings go in their person\'s column, overlapping ones side by side', () => {
  const d = '2026-11-16'
  const list = [
    { id: '1', customer_name: 'A', status: 'booked', staff_id: ANITHA, starts_at: at(d, '10:00'), ends_at: at(d, '11:00') },
    { id: '2', customer_name: 'B', status: 'booked', staff_id: ANITHA, starts_at: at(d, '10:30'), ends_at: at(d, '11:00') },
    { id: '3', customer_name: 'C', status: 'booked', staff_id: ANITHA, starts_at: at(d, '11:00'), ends_at: at(d, '11:30') },
    { id: '4', customer_name: 'D', status: 'booked', staff_id: null, starts_at: at(d, '12:00'), ends_at: at(d, '12:30') },
    { id: '5', customer_name: 'E', status: 'booked', staff_id: 'left-the-shop', starts_at: at(d, '13:00'), ends_at: at(d, '13:20') },
  ]
  const { columns, blocks } = C.layoutDay(list, [ANITHA, RAVI], { start: 600, end: 1200 })
  assert.deepEqual(columns, [ANITHA, RAVI, 'anyone'])
  const b = Object.fromEntries(blocks.map((x) => [x.appointment.id, x]))
  assert.deepEqual([b['1'].lane, b['1'].lanes, b['2'].lane, b['2'].lanes], [0, 2, 1, 2])
  assert.deepEqual([b['3'].lane, b['3'].lanes, b['3'].top], [0, 1, 60])
  assert.equal(b['4'].column, 'anyone')
  assert.equal(b['5'].column, 'anyone', 'someone no longer in the team goes to Anyone')
  assert.equal(b['5'].height, 20)
})

test('Calendar: clashes, counts and days', () => {
  const d = '2026-11-16'
  const list = [
    { id: '1', customer_name: 'A', status: 'booked', staff_id: ANITHA, starts_at: at(d, '10:00'), ends_at: at(d, '11:00'), services: [{ name: 'Cut', price: 500 }] },
    { id: '2', customer_name: 'B', status: 'cancelled', staff_id: ANITHA, starts_at: at(d, '11:00'), ends_at: at(d, '12:00'), services: [{ name: 'Cut', price: 500 }] },
    { id: '3', customer_name: 'C', status: 'completed', staff_id: RAVI, starts_at: at('2026-11-17', '10:00'), ends_at: at('2026-11-17', '10:30'), services: [{ name: 'Facial', price: '1200' }] },
    { id: '4', customer_name: 'D', status: 'no_show', staff_id: RAVI, starts_at: at(d, '15:00'), ends_at: at(d, '15:30'), services: [{ name: 'Cut', price: 500 }] },
  ]
  assert.equal(C.findClash(list, { starts_at: at(d, '10:30'), ends_at: at(d, '11:30'), staff_id: ANITHA }).id, '1')
  assert.equal(C.findClash(list, { starts_at: at(d, '11:00'), ends_at: at(d, '12:00'), staff_id: ANITHA }), null, 'a cancelled one is no clash')
  assert.equal(C.findClash(list, { id: '1', starts_at: at(d, '10:00'), ends_at: at(d, '11:00'), staff_id: ANITHA }), null, 'not with itself')
  const s = C.periodSummary(list)
  assert.deepEqual([s.total, s.upcoming, s.done, s.noShow, s.cancelled, s.expected], [4, 1, 1, 1, 1, 1700])
  assert.deepEqual(C.onDay(list, d).map((a) => a.id), ['1', '2', '4'])
})

test('Appointments: move one to another time and person, with a clash warning', async () => {
  const db = salonDb({
    salon_services: [{ id: S1, organization_id: ORG, name: 'Cut', price: 500, duration_minutes: 45, tax_rate: 18, active: true }],
    salon_staff: [{ id: ANITHA, organization_id: ORG, name: 'Anitha', service_ids: [], active: true }, { id: RAVI, organization_id: ORG, name: 'Ravi', service_ids: [], active: true }],
  })
  const ctx = { db, organizationId: ORG, user: { id: 'u1' }, organization: { id: ORG }, settings: { business_name: 'Glow' } }
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  const first = await A.executeCounterAction(ctx, A.parseCounterAction({ type: 'create_appointment', customer: { name: 'Priya', phone: '+919876543210' }, service_ids: [S1], staff_id: ANITHA, starts_at: at(tomorrow, '10:00'), send_whatsapp: false }).action)
  await A.executeCounterAction(ctx, A.parseCounterAction({ type: 'create_appointment', customer: { name: 'Kiran' }, service_ids: [S1], staff_id: RAVI, starts_at: at(tomorrow, '12:00'), send_whatsapp: false }).action)

  assert.match(A.parseCounterAction({ type: 'reschedule', appointment_id: first.appointment.id, starts_at: 'soon' }).error, /date and time/)
  const parsed = A.parseCounterAction({ type: 'reschedule', appointment_id: first.appointment.id, starts_at: at(tomorrow, '12:15'), staff_id: RAVI, send_whatsapp: false })
  const moved = await A.executeCounterAction(ctx, parsed.action)
  assert.equal(moved.appointment.starts_at, at(tomorrow, '12:15'))
  assert.equal(Date.parse(moved.appointment.ends_at) - Date.parse(moved.appointment.starts_at), 45 * 60_000, 'keeps its length')
  assert.equal(moved.appointment.staff_id, RAVI)
  assert.equal(moved.appointment.services[0].staff_name, 'Ravi')
  assert.match(moved.warning, /Ravi already has Kiran/)
  assert.match(moved.message, /Moved Priya/)

  // Keeping the person: only the time changes
  const again = await A.executeCounterAction(ctx, A.parseCounterAction({ type: 'reschedule', appointment_id: first.appointment.id, starts_at: at(tomorrow, '16:00'), send_whatsapp: false }).action)
  assert.equal(again.appointment.staff_id, RAVI)
  assert.equal(again.warning, undefined)

  // A finished visit cannot be moved
  await A.executeCounterAction(ctx, { type: 'complete_and_bill', appointment_id: first.appointment.id, send_whatsapp: false })
  await assert.rejects(A.executeCounterAction(ctx, A.parseCounterAction({ type: 'reschedule', appointment_id: first.appointment.id, starts_at: at(tomorrow, '18:00'), send_whatsapp: false }).action), /not started can be moved/)
})

test('Front Desk pages: Appointments and Members tabs, phone bar, landing page links', () => {
  const root = path.join(__dirname, '..')
  const nav = fs.readFileSync(path.join(root, 'lib/front-desk-nav.ts'), 'utf8')
  assert.match(nav, /'appointments'/)
  assert.match(nav, /'members'/)
  const layout = fs.readFileSync(path.join(root, 'app/dashboard/layout.tsx'), 'utf8')
  assert.match(layout, /tab: 'appointments', label: 'Calendar'/)
  assert.match(layout, /tab: 'members', label: 'Members'/)
  // The business page is now the Front Desk website (components/salon-site, data from lib/salon/website-store.ts)
  const menu = fs.readFileSync(path.join(root, 'components/salon-site/services-menu.tsx'), 'utf8')
  const site = fs.readFileSync(path.join(root, 'components/salon-site/business-site.tsx'), 'utf8')
  const store = fs.readFileSync(path.join(root, 'lib/salon/website-store.ts'), 'utf8')
  assert.match(menu, /href=\{`\$\{bookHref\}\?s=\$\{s\.id\}`\}/, 'each service books straight away')
  assert.match(site, /href=\{`\$\{bookHref\}\?p=\$\{m\.id\}`\}/, 'each person books straight away')
  assert.match(store, /split\(' '\)\[0\]/, 'reviews show first names only')
})
