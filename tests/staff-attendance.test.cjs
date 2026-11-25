require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { salonDb } = require('./salon-fake-db.cjs')

const A = require('../lib/salon/attendance.ts')
const S = require('../lib/salon/attendance-store.ts')
const AV = require('../lib/salon/availability.ts')
const BP = require('../lib/salon/booking-page.ts')
const { busyOn } = require('../lib/salon/chat.ts')
const { availableTimes } = require('../lib/public-api/front-desk.ts')

const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER_ORG = '99999999-9999-4999-8999-999999999999'
const CUT = '22222222-2222-4222-8222-222222222222'
const COLOUR = '33333333-3333-4333-8333-333333333333'
const ANU = '44444444-4444-4444-8444-444444444444'
const RAVI = '55555555-5555-4555-8555-555555555555'
const OLD = '66666666-6666-4666-8666-666666666666'
const STRANGER = '77777777-7777-4777-8777-777777777777'
// Wednesday 25 Nov 2026, 11:30 am in India
const NOW = Date.parse('2026-11-25T06:00:00Z')
// Thursday 12 Nov 2026, 9 am in India (the booking page tests' day)
const THU = Date.parse('2026-11-12T03:30:00Z')

const seed = (settings = {}) => ({
  organizations: [{ id: ORG, name: 'Glow', slug: 'glow-ab12', enabled_connectors: ['salon'] }],
  salon_settings: [{ organization_id: ORG, business_name: 'Glow Salon', opens_at: '10:00', closes_at: '20:00', closed_weekdays: [2], ...settings }],
  salon_services: [
    { id: CUT, organization_id: ORG, name: 'Haircut', category: 'Hair', price: 300, duration_minutes: 30, tax_rate: 18, active: true, position: 1 },
    { id: COLOUR, organization_id: ORG, name: 'Colour', category: 'Hair', price: 1500, duration_minutes: 90, tax_rate: 18, active: true, position: 2 },
  ],
  salon_staff: [
    { id: ANU, organization_id: ORG, name: 'Anu', active: true, service_ids: [CUT, COLOUR] },
    { id: RAVI, organization_id: ORG, name: 'Ravi', active: true, service_ids: [CUT] },
    { id: OLD, organization_id: ORG, name: 'Old hand', active: false, service_ids: [] },
    { id: STRANGER, organization_id: OTHER_ORG, name: 'Someone else', active: true, service_ids: [] },
  ],
})

// ── Pure rules ───────────────────────────────────────────────────────────────

test('a mark is checked: person, India day, status; leave kind only for leave; short note', () => {
  const ok = A.cleanMark({ staff_id: ANU, day: '2026-11-25', status: 'leave', leave_kind: 'sick', note: '  Fever,   back Friday  ' }, NOW)
  assert.deepEqual(ok.value, { staff_id: ANU, day: '2026-11-25', status: 'leave', leave_kind: 'sick', note: 'Fever, back Friday' })
  assert.equal(A.cleanMark({ staff_id: ANU, day: '2026-11-25', status: 'present', leave_kind: 'sick' }, NOW).value.leave_kind, null, 'a kind only goes with leave')
  assert.equal(A.cleanMark({ staff_id: ANU, day: '2026-11-25', status: 'leave', leave_kind: 'holiday' }, NOW).value.leave_kind, null)
  assert.equal(A.cleanMark({ day: '2026-11-25', status: 'present' }, NOW).field, 'staff_id')
  assert.equal(A.cleanMark({ staff_id: ANU, day: '2026-02-30', status: 'present' }, NOW).field, 'day')
  assert.equal(A.cleanMark({ staff_id: ANU, day: '2026-11-25', status: 'holiday' }, NOW).field, 'status')
  assert.equal(A.cleanMark({ staff_id: ANU, day: '2026-11-25', status: 'present', note: 'x'.repeat(201) }, NOW).field, 'note')
  assert.equal(A.cleanMark({ staff_id: ANU, day: '2026-11-25', status: 'present', note: '   ' }, NOW).value.note, null)
})

test('marks go up to 62 days ahead and a year back, India time', () => {
  assert.equal(A.dayProblem('2027-01-26', NOW), null, '62 days ahead is fine')
  assert.match(A.dayProblem('2027-01-27', NOW), /62 days ahead/)
  assert.match(A.dayProblem('2025-11-23', NOW), /year/)
  assert.equal(A.dayProblem('2025-11-24', NOW), null)
  // 10 pm on 25 Nov in UTC is already 26 Nov in India
  assert.equal(A.dayProblem('2027-01-27', Date.parse('2026-11-25T20:00:00Z')), null)
})

test('many marks at once: the same person and day twice keeps the last; any problem refuses them all', () => {
  const two = A.cleanMarks([{ staff_id: ANU, day: '2026-11-25', status: 'present' }, { staff_id: ANU, day: '2026-11-25', status: 'half_day' }, { staff_id: RAVI, day: '2026-11-25', status: 'absent' }], NOW)
  assert.deepEqual(two.value.map((m) => [m.staff_id, m.status]), [[ANU, 'half_day'], [RAVI, 'absent']])
  assert.equal(A.cleanMarks([], NOW).field, 'marks')
  assert.equal(A.cleanMarks([{ staff_id: ANU, day: '2026-11-25', status: 'present' }, { staff_id: RAVI, day: 'soon', status: 'present' }], NOW).field, 'day')
  assert.equal(A.cleanMarks(Array.from({ length: 501 }, () => ({ staff_id: ANU, day: '2026-11-25', status: 'present' })), NOW).field, 'marks')
})

test('"Mark all present": the active team, without changing anyone already marked', () => {
  const team = seed().salon_staff.filter((m) => m.organization_id === ORG)
  const existing = [{ staff_id: RAVI, day: '2026-11-25', status: 'leave' }, { staff_id: ANU, day: '2026-11-24', status: 'present' }]
  assert.deepEqual(A.markAll(team, '2026-11-25', existing).map((m) => [m.staff_id, m.status]), [[ANU, 'present']], 'Ravi on leave stays; the inactive person is left out')
  assert.deepEqual(A.markAll(team, '2026-11-25', existing, { overwrite: true }).map((m) => m.staff_id), [ANU, RAVI])
  assert.equal(A.markAll(team, '2026-11-25', [], { status: 'week_off' })[0].status, 'week_off')
  assert.equal(A.markAll(team, '2026-11-25', [], { status: 'nonsense' })[0].status, 'present')
})

test('leave from one day to another: one mark a day, closed days left out', () => {
  // 23 Nov (Mon) to 27 Nov (Fri); the business is closed on Tuesdays (2)
  const range = A.leaveRange({ staff_id: ANU, from: '2026-11-23', to: '2026-11-27', leave_kind: 'casual', note: 'Wedding' }, NOW, [2])
  assert.deepEqual(range.value.map((m) => m.day), ['2026-11-23', '2026-11-25', '2026-11-26', '2026-11-27'])
  assert.ok(range.value.every((m) => m.status === 'leave' && m.leave_kind === 'casual' && m.note === 'Wedding'))
  assert.deepEqual(A.leaveRange({ staff_id: ANU, from: '2026-11-25' }, NOW).value.map((m) => m.day), ['2026-11-25'], 'one day when there is no last day')
  assert.equal(A.leaveRange({ staff_id: ANU, from: '2026-11-25', to: '2026-11-25', status: 'week_off', leave_kind: 'sick' }, NOW).value[0].leave_kind, null)
  assert.equal(A.leaveRange({ staff_id: ANU, from: '2026-11-27', to: '2026-11-25' }, NOW).field, 'to')
  assert.equal(A.leaveRange({ staff_id: ANU, from: '2026-11-25', to: '2027-02-10' }, NOW).field, 'to', 'too long, and too far ahead')
  assert.equal(A.leaveRange({ staff_id: ANU, from: '2027-01-20', to: '2027-02-01' }, NOW).field, 'to', 'ends past 62 days ahead')
  assert.equal(A.leaveRange({ from: '2026-11-25' }, NOW).field, 'staff_id')
  assert.match(A.leaveRange({ staff_id: ANU, from: '2026-11-24', to: '2026-11-24' }, NOW, [2]).error, /closed/)
})

test('months: India time, real months only, bounds and days', () => {
  assert.equal(A.readMonth('2026-02', NOW), '2026-02')
  assert.equal(A.readMonth('2027-01', NOW), '2027-01', 'next months can be opened to plan leave')
  assert.equal(A.readMonth('2027-03', NOW), '2026-11', 'not too far ahead')
  assert.equal(A.readMonth('2026-13', NOW), '2026-11')
  assert.equal(A.readMonth(undefined, Date.parse('2026-11-30T19:00:00Z')), '2026-12', 'half past midnight on 1 Dec in India')
  assert.deepEqual(A.monthBounds('2028-02'), { first: '2028-02-01', last: '2028-02-29', days: 29 })
  assert.equal(A.monthDays('2026-11').length, 30)
  assert.equal(A.addMonths('2026-12', 1), '2027-01')
  assert.equal(A.monthLabel('2026-11'), 'November 2026')
})

test('month summary per person: half days count 0.5, not marked counts working days up to today', () => {
  const team = [{ id: ANU, name: 'Anu', active: true }, { id: RAVI, name: 'Ravi', active: true }]
  const marks = [
    { staff_id: ANU, day: '2026-11-02', status: 'present' },
    { staff_id: ANU, day: '2026-11-04', status: 'half_day' },
    { staff_id: ANU, day: '2026-11-05', status: 'leave' },
    { staff_id: ANU, day: '2026-11-06', status: 'leave' },
    { staff_id: ANU, day: '2026-11-07', status: 'absent' },
    { staff_id: ANU, day: '2026-11-08', status: 'week_off' },
    { staff_id: ANU, day: '2026-11-28', status: 'leave' }, // planned ahead
    { staff_id: ANU, day: '2026-10-31', status: 'present' }, // another month
    { staff_id: RAVI, day: '2026-11-02', status: 'present' },
  ]
  // Closed on Tuesdays: 3, 10, 17, 24 Nov fall in 1–25 Nov
  const [anu, ravi] = A.monthSummary(team, marks, '2026-11', NOW, [2])
  assert.equal(anu.present, 1)
  assert.equal(anu.half_day, 1)
  assert.equal(anu.worked, 1.5)
  assert.equal(anu.leave, 3)
  assert.equal(anu.absent, 1)
  assert.equal(anu.week_off, 1)
  assert.deepEqual(anu.leave_days, ['2026-11-05', '2026-11-06', '2026-11-28'])
  // 25 days so far, 4 closed = 21 working days; Anu has 6 of them marked (28th is ahead)
  assert.equal(anu.not_marked, 15)
  assert.equal(ravi.not_marked, 20)
  assert.equal(A.monthSummary(team, [], '2027-01', NOW)[0].not_marked, 0, 'a month ahead has nothing missing yet')
  assert.equal(A.monthSummary(team, [], '2026-10', NOW)[0].not_marked, 31)
})

test('leave ranges: next-door days join, closed days in between too; another kind starts a new one', () => {
  const marks = [
    { staff_id: ANU, day: '2026-11-23', status: 'leave', leave_kind: 'casual', note: 'Wedding' },
    { staff_id: ANU, day: '2026-11-25', status: 'leave', leave_kind: 'casual' }, // 24th is a closed Tuesday
    { staff_id: ANU, day: '2026-11-26', status: 'leave', leave_kind: 'casual' },
    { staff_id: ANU, day: '2026-11-27', status: 'leave', leave_kind: 'sick' },
    { staff_id: ANU, day: '2026-11-30', status: 'leave', leave_kind: 'sick' },
    { staff_id: ANU, day: '2026-11-29', status: 'present' },
    { staff_id: RAVI, day: '2026-11-23', status: 'leave' },
  ]
  const spans = A.leaveSpans(marks, ANU, [2])
  assert.deepEqual(spans.map((s) => [s.from, s.to, s.days, s.leave_kind]), [['2026-11-23', '2026-11-26', 3, 'casual'], ['2026-11-27', '2026-11-27', 1, 'sick'], ['2026-11-30', '2026-11-30', 1, 'sick']])
  assert.equal(spans[0].note, 'Wedding')
  assert.equal(A.leaveSpans(marks, null, [2]).length, 4, 'everyone')
  assert.deepEqual(A.leaveDates(marks, ANU), ['2026-11-23', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-30'])
})

test('a day for the screens: everyone active with their mark, counts, who is away, labels', () => {
  const team = seed().salon_staff.filter((m) => m.organization_id === ORG)
  const marks = [{ staff_id: RAVI, day: '2026-11-25', status: 'leave', leave_kind: 'sick', note: null }]
  const rows = A.dayList(team, marks, '2026-11-25')
  assert.deepEqual(rows.map((r) => [r.name, r.mark?.status || null]), [['Anu', null], ['Ravi', 'leave']])
  assert.deepEqual(A.dayCounts(rows), { present: 0, absent: 0, leave: 1, half_day: 0, week_off: 0, not_marked: 1 })
  const day = [
    { staff_id: ANU, day: '2026-11-25', status: 'half_day' },
    { staff_id: RAVI, day: '2026-11-25', status: 'leave' },
    { staff_id: OLD, day: '2026-11-25', status: 'week_off' },
    { staff_id: ANU, day: '2026-11-26', status: 'absent' },
  ]
  assert.deepEqual(A.awayIds(day, '2026-11-25'), [RAVI, OLD], 'a half day is still in')
  assert.equal(A.markLabel({ status: 'leave', leave_kind: 'sick' }), 'On leave · Sick')
  assert.equal(A.markLabel({ status: 'week_off' }), 'Week off')
  assert.equal(A.markLabel(null), 'Not marked')
  assert.deepEqual(A.daysWorked([...day, { staff_id: ANU, status: 'present' }]), { [ANU]: 1.5 })
  assert.deepEqual(A.AWAY_STATUSES, ['absent', 'leave', 'week_off'])
})

// ── Bookings follow attendance ───────────────────────────────────────────────

test('free times: someone away that day is not offered; others still are; one chair is unaffected', () => {
  const date = '2026-11-26'
  const hours = { opens_at: '10:00', closes_at: '12:00', closed_weekdays: [] }
  const base = { date, now: NOW, hours, minutes: 30 }
  const away = AV.awayBusy(date, [ANU])
  assert.equal(away.length, 1)
  assert.equal(away[0].starts_at, '2026-11-25T18:30:00.000Z', 'the whole India day')
  assert.deepEqual(AV.freeTimes({ ...base, eligibleStaff: [ANU, RAVI], staffId: ANU, busy: away }), [], 'asked for Anu, who is on leave')
  assert.equal(AV.freeTimes({ ...base, eligibleStaff: [ANU, RAVI], busy: away }).length, 4, 'Ravi is free')
  // Ravi busy 10–11 and Anu away: nobody free then
  const raviBusy = [{ starts_at: '2026-11-26T04:30:00.000Z', ends_at: '2026-11-26T05:30:00.000Z', staff_ids: [RAVI] }]
  assert.deepEqual(AV.freeTimes({ ...base, eligibleStaff: [ANU, RAVI], busy: [...raviBusy, ...away] }), ['11:00', '11:30'])
  assert.deepEqual(AV.freeTimes({ ...base, eligibleStaff: [ANU], busy: AV.awayBusy(date, [ANU]) }), [], 'the only person who does it is away')
  assert.equal(AV.freeTimes({ ...base, eligibleStaff: [], busy: away }).length, 4, 'no one in particular does it: a day off does not close the chair')
  assert.equal(AV.isTimeFree({ ...base, eligibleStaff: [ANU, RAVI], staffId: ANU, busy: away, time: '11:00' }), false)
  const slots = AV.counterSlots({ ...base, eligibleStaff: [ANU, RAVI], staffIds: [ANU], busy: away })
  assert.ok(slots.length && slots.every((s) => !s.free), 'the counter sees Anu busy all day (and can still book)')
  assert.ok(AV.counterSlots({ ...base, eligibleStaff: [ANU, RAVI], busy: away }).every((s) => s.free))
})

test('store: marks are saved once per person per day, checked against the team, read back and cleared', async () => {
  const db = salonDb(seed())
  const first = await S.saveMarks(db, ORG, [{ staff_id: ANU, day: '2026-11-25', status: 'present', leave_kind: null, note: null }], 'user-1')
  assert.equal(first.saved.length, 1)
  await S.saveMarks(db, ORG, [{ staff_id: ANU, day: '2026-11-25', status: 'half_day', leave_kind: null, note: 'Left at 2' }], 'user-2')
  assert.equal(db.tables.salon_staff_attendance.length, 1, 'a new mark replaces the old one')
  assert.equal(db.tables.salon_staff_attendance[0].status, 'half_day')
  assert.equal(db.tables.salon_staff_attendance[0].marked_by, 'user-2')
  assert.match((await S.saveMarks(db, ORG, [{ staff_id: STRANGER, day: '2026-11-25', status: 'present', leave_kind: null, note: null }])).error, /not on your team/)
  assert.equal(db.tables.salon_staff_attendance.length, 1)

  const leave = A.leaveRange({ staff_id: RAVI, from: '2026-11-26', to: '2026-11-30', leave_kind: 'sick' }, NOW, [2])
  await S.saveMarks(db, ORG, leave.value, 'user-1')
  const day = await S.marksOn(db, ORG, '2026-11-26')
  assert.deepEqual(day.map((m) => [m.staff_id, m.status, m.leave_kind]), [[RAVI, 'leave', 'sick']])
  const month = await S.marksInMonth(db, ORG, '2026-11')
  assert.equal(month.length, 6)
  assert.equal((await S.marksInMonth(db, ORG, '2026-11', ANU)).length, 1)
  assert.equal((await S.marksInMonth(db, OTHER_ORG, '2026-11')).length, 0, 'never another business\'s marks')

  assert.deepEqual(await S.awayStaffOn(db, ORG, '2026-11-27'), [RAVI])
  assert.deepEqual(await S.awayStaffOn(db, ORG, '2026-11-25'), [], 'a half day is still in')
  assert.deepEqual((await S.dayNotices(db, ORG, '2026-11-25')).map((m) => m.status), ['half_day'])

  assert.equal(await S.clearMarks(db, ORG, RAVI, '2026-11-28', '2026-11-30'), 3)
  assert.equal(await S.clearMarks(db, ORG, RAVI, '2026-11-26'), 1)
  assert.deepEqual((await S.marksInMonth(db, ORG, '2026-11', RAVI)).map((m) => m.day), ['2026-11-27'])
})

test('store: when attendance cannot be read, everyone counts as in (a booking is never refused for it)', async () => {
  const broken = { from: () => { throw new Error('no table') } }
  assert.deepEqual(await S.awayStaffOn(broken, ORG, '2026-11-25'), [])
  const failing = { from: () => ({ select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: { code: '42P01', message: 'relation "salon_staff_attendance" does not exist' } }) }) }) }) }
  assert.deepEqual(await S.dayNotices(failing, ORG, '2026-11-25'), [])
})

test('the WhatsApp assistant, booking page and public API leave out someone on leave', async () => {
  const db = salonDb(seed())
  await S.saveMarks(db, ORG, [{ staff_id: ANU, day: '2026-11-12', status: 'leave', leave_kind: 'casual', note: null }])
  const busy = await busyOn(db, ORG, '2026-11-12')
  assert.deepEqual(busy.map((b) => [b.staff_ids, b.away]), [[[ANU], true]])

  const page = await BP.loadBookingPage(db, 'glow-ab12')
  const withAnu = await BP.bookingTimes(db, page, { serviceIds: [CUT], staffId: ANU, date: '2026-11-12' }, THU)
  assert.deepEqual(withAnu.times, [], 'Anu is not offered on her leave day')
  const colour = await BP.bookingTimes(db, page, { serviceIds: [COLOUR], staffId: null, date: '2026-11-12' }, THU)
  assert.deepEqual(colour.times, [], 'only Anu does colour')
  const cut = await BP.bookingTimes(db, page, { serviceIds: [CUT], staffId: null, date: '2026-11-12' }, THU)
  assert.equal(cut.times[0], '10:00', 'Ravi still takes haircuts')
  const nextDay = await BP.bookingTimes(db, page, { serviceIds: [COLOUR], staffId: ANU, date: '2026-11-13' }, THU)
  assert.ok(nextDay.times.length, 'back the next day')

  // "Anyone" on the booking page goes to whoever is in, never to the person on leave
  const booked = await BP.createOnlineBooking(db, page, BP.parseOnlineBooking({ service_ids: [CUT], date: '2026-11-12', time: '11:00', name: 'Priya Rao', phone: '+91 90000 11111' }), THU)
  assert.equal(booked.appointment.staff_id, RAVI)
  const refused = await BP.createOnlineBooking(db, page, BP.parseOnlineBooking({ service_ids: [CUT], staff_id: ANU, date: '2026-11-12', time: '12:00', name: 'Kiran', phone: '+91 90000 22222' }), THU)
  assert.equal(refused.taken, true)

  const api = await availableTimes(db, ORG, { date: '2026-11-12', serviceIds: [COLOUR], now: THU })
  assert.deepEqual(api.times, [])
  assert.equal(api.check('12:00'), false)
  const apiCut = await availableTimes(db, ORG, { date: '2026-11-12', serviceIds: [CUT], staffId: RAVI, now: THU })
  assert.ok(apiCut.times.length)
})

test('a half day stays bookable, and week off counts as away', async () => {
  const db = salonDb(seed())
  await S.saveMarks(db, ORG, [
    { staff_id: ANU, day: '2026-11-12', status: 'half_day', leave_kind: null, note: null },
    { staff_id: RAVI, day: '2026-11-13', status: 'week_off', leave_kind: null, note: null },
  ])
  const page = await BP.loadBookingPage(db, 'glow-ab12')
  assert.ok((await BP.bookingTimes(db, page, { serviceIds: [COLOUR], staffId: ANU, date: '2026-11-12' }, THU)).times.length)
  assert.deepEqual((await BP.bookingTimes(db, page, { serviceIds: [CUT], staffId: RAVI, date: '2026-11-13' }, THU)).times, [])
})

test('the table: same SQL as the migration file, its own lock, row level security on', () => {
  const file = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261213_staff_attendance.sql'), 'utf8')
  assert.equal(file, S.ATTENDANCE_SQL)
  assert.equal(S.ATTENDANCE_LOCK, 724519039)
  assert.match(S.ATTENDANCE_SQL, /ALTER TABLE salon_staff_attendance ENABLE ROW LEVEL SECURITY/)
  assert.match(S.ATTENDANCE_SQL, /UNIQUE \(organization_id, staff_id, day\)/)
  for (const status of A.ATTENDANCE_STATUSES) assert.match(S.ATTENDANCE_SQL, new RegExp(`'${status}'`))
  for (const kind of A.LEAVE_KINDS) assert.match(S.ATTENDANCE_SQL, new RegExp(`'${kind}'`))
})

test('the table sets itself up once when missing, then the step runs again', async () => {
  let calls = 0
  let ensured = 0
  const step = () => Promise.resolve(++calls === 1 ? { data: null, error: { code: '42P01', message: 'relation "salon_staff_attendance" does not exist' } } : { data: [], error: null })
  const result = await S.withAttendanceSchema(step, { ensure: async () => { ensured++; return true } })
  assert.equal(ensured, 1)
  assert.equal(calls, 2)
  assert.deepEqual(result.data, [])
})
