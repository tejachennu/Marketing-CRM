// Shop holidays (Front Desk → Team → Attendance → Holidays): one-off and repeating closed days. Bookings, the
// WhatsApp assistant, the booking page, the website, the public API and attendance all treat them as closed days.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { salonDb } = require('./salon-fake-db.cjs')

const H = require('../lib/salon/holidays.ts')
const HS = require('../lib/salon/holidays-store.ts')
const A = require('../lib/salon/attendance.ts')
const AV = require('../lib/salon/availability.ts')
const BP = require('../lib/salon/booking-page.ts')
const W = require('../lib/salon/website.ts')
const { chatSystemPrompt } = require('../lib/salon/chat.ts')
const { deskFacts } = require('../lib/ai/site-assistant.ts')
const { availableTimes } = require('../lib/public-api/front-desk.ts')

const ORG = '11111111-1111-4111-8111-111111111111'
const CUT = '22222222-2222-4222-8222-222222222222'
const ANU = '44444444-4444-4444-8444-444444444444'
const RAVI = '55555555-5555-4555-8555-555555555555'
// Wednesday 25 Nov 2026, 11:30 am in India
const NOW = Date.parse('2026-11-25T06:00:00Z')

const once = (start, days = 1, name = 'Diwali') => ({ id: `h_${start}`, name, start, days, repeat: 'none' })
const every = (repeat, start, days = 1, name = 'Holiday') => ({ id: `h_${repeat}_${start}`, name, start, days, repeat })

const seed = (holidays = []) => ({
  organizations: [{ id: ORG, name: 'Glow', slug: 'glow-ab12', enabled_connectors: ['salon'] }],
  salon_settings: [{ organization_id: ORG, business_name: 'Glow Salon', opens_at: '10:00', closes_at: '20:00', closed_weekdays: [], holidays }],
  salon_services: [{ id: CUT, organization_id: ORG, name: 'Haircut', category: 'Hair', price: 300, duration_minutes: 30, tax_rate: 18, active: true, position: 1 }],
  salon_staff: [
    { id: ANU, organization_id: ORG, name: 'Anu', active: true, service_ids: [] },
    { id: RAVI, organization_id: ORG, name: 'Ravi', active: true, service_ids: [] },
  ],
})

// ── When a holiday falls ──────────────────────────────────────────────────────

test('a one-off holiday covers its days only', () => {
  const list = [once('2026-11-27', 3)]
  assert.equal(H.holidayOn('2026-11-26', list), null)
  assert.equal(H.holidayOn('2026-11-27', list).name, 'Diwali')
  assert.equal(H.holidayOn('2026-11-29', list).end, '2026-11-29')
  assert.equal(H.holidayOn('2026-11-30', list), null)
  assert.equal(H.holidayOn('2027-11-27', list), null, 'not next year')
})

test('every year on the same date; 29 Feb falls on 28 Feb in other years; spans cross the new year', () => {
  const republic = [every('yearly', '2027-01-26', 1, 'Republic Day')]
  assert.equal(H.holidayOn('2027-01-26', republic).name, 'Republic Day')
  assert.equal(H.holidayOn('2031-01-26', republic).name, 'Republic Day')
  assert.equal(H.holidayOn('2026-01-26', republic), null, 'not before it was first set')
  const leap = [every('yearly', '2028-02-29')]
  assert.ok(H.holidayOn('2028-02-29', leap))
  assert.ok(H.holidayOn('2029-02-28', leap))
  assert.equal(H.holidayOn('2029-03-01', leap), null)
  const newYear = [every('yearly', '2026-12-31', 3)]
  assert.ok(H.holidayOn('2027-01-02', newYear), 'the span runs into January')
  assert.equal(H.holidayOn('2027-01-03', newYear), null)
  assert.ok(H.holidayOn('2028-01-01', newYear))
})

test('every month on a date: the 31st falls on the last day of shorter months', () => {
  const list = [every('monthly', '2026-10-31')]
  assert.ok(H.holidayOn('2026-11-30', list))
  assert.ok(H.holidayOn('2026-12-31', list))
  assert.equal(H.holidayOn('2026-12-30', list), null)
  assert.ok(H.holidayOn('2027-02-28', list))
  const first = [every('monthly', '2026-11-01', 2)]
  assert.ok(H.holidayOn('2027-03-02', first))
  assert.equal(H.holidayOn('2027-03-03', first), null)
})

test('every month on a weekday: the 2nd Tuesday, the last Saturday; a 5th weekday means the last one', () => {
  const second = [every('monthly_weekday', '2026-11-10')] // 2nd Tuesday
  assert.ok(H.holidayOn('2026-12-08', second))
  assert.ok(H.holidayOn('2027-01-12', second))
  assert.equal(H.holidayOn('2027-01-05', second), null)
  const last = [every('monthly_last_weekday', '2026-11-28')] // last Saturday
  assert.ok(H.holidayOn('2026-12-26', last))
  assert.ok(H.holidayOn('2027-02-27', last))
  assert.equal(H.holidayOn('2027-02-20', last), null)
  const fifth = [every('monthly_weekday', '2026-11-30')] // 5th Monday → the last Monday
  assert.ok(H.holidayOn('2026-12-28', fifth))
})

test('spans, days and the next ones between two dates', () => {
  const list = [once('2026-11-27', 2), every('yearly', '2027-01-26', 1, 'Republic Day'), every('monthly', '2026-12-01', 1, 'Stock day')]
  assert.deepEqual(H.holidayDays(list, '2026-11-25', '2026-12-02'), { '2026-11-27': 'Diwali', '2026-11-28': 'Diwali', '2026-12-01': 'Stock day' })
  const next = H.upcomingHolidays(list, NOW)
  assert.deepEqual(next.map((s) => [s.name, s.start]), [['Diwali', '2026-11-27'], ['Stock day', '2026-12-01'], ['Republic Day', '2027-01-26']])
  // A holiday that started before the range still shows (its days overlap)
  assert.equal(H.holidaySpans([once('2026-11-24', 3)], '2026-11-25', '2026-11-30')[0].start, '2026-11-24')
  assert.equal(H.nextTime(once('2026-11-20'), NOW), null, 'a one-off that has gone')
  assert.equal(H.nextTime(every('yearly', '2026-01-26'), NOW).start, '2027-01-26')
})

// ── Checking what a screen sends ──────────────────────────────────────────────

test('a holiday is checked: a name, a real day, how many days, how it repeats', () => {
  const ok = H.cleanHoliday({ name: '  Diwali   holidays ', start: '2026-11-27', days: '2' }, NOW)
  assert.equal(ok.value.name, 'Diwali holidays')
  assert.equal(ok.value.days, 2)
  assert.equal(ok.value.repeat, 'none')
  assert.match(ok.value.id, /^h_/)
  assert.equal(H.cleanHoliday({ id: 'keep-me', name: 'Diwali', start: '2026-11-27' }, NOW).value.id, 'keep-me')
  assert.equal(H.cleanHoliday({ start: '2026-11-27' }, NOW).field, 'name')
  assert.equal(H.cleanHoliday({ name: 'x'.repeat(41), start: '2026-11-27' }, NOW).field, 'name')
  assert.equal(H.cleanHoliday({ name: 'Diwali', start: '2026-02-30' }, NOW).field, 'start')
  assert.match(H.cleanHoliday({ name: 'Old', start: '2026-11-20' }, NOW).error, /already gone/)
  assert.ok(H.cleanHoliday({ name: 'Yearly from the past', start: '2026-01-26', repeat: 'yearly' }, NOW).value, 'a repeating one may start in the past')
  assert.match(H.cleanHoliday({ name: 'Far', start: '2029-01-01' }, NOW).error, /two years/)
  assert.equal(H.cleanHoliday({ name: 'Long', start: '2026-12-01', days: 32 }, NOW).field, 'days')
  assert.match(H.cleanHoliday({ name: 'Monthly', start: '2026-12-01', days: 8, repeat: 'monthly' }, NOW).error, /7 days/)
  assert.equal(H.cleanHoliday({ name: 'Odd', start: '2026-12-01', repeat: 'weekly' }, NOW).value.repeat, 'none')
})

test('the saved list is read forgivingly, added to, changed and trimmed', () => {
  assert.deepEqual(H.readHolidays(null), [])
  assert.deepEqual(H.readHolidays('not json'), [])
  const list = H.readHolidays([once('2026-12-25', 1, 'Christmas'), { name: '', start: '2026-12-01' }, { name: 'Bad day', start: 'soon' }, once('2026-11-27')])
  assert.deepEqual(list.map((h) => h.name), ['Diwali', 'Christmas'], 'broken ones dropped, oldest first')
  const added = H.withHoliday(list, every('yearly', '2027-01-26', 1, 'Republic Day'))
  assert.equal(added.value.length, 3)
  const changed = H.withHoliday(added.value, { ...once('2026-11-27'), name: 'Diwali (2 days)', days: 2 })
  assert.equal(changed.value.length, 3)
  assert.equal(changed.value[0].name, 'Diwali (2 days)')
  assert.equal(H.withoutHoliday(changed.value, 'h_2026-11-27').length, 2)
  const full = Array.from({ length: H.MAX_HOLIDAYS }, (_, i) => every('yearly', `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, 1, `H${i}`)).map((h, i) => ({ ...h, id: `h${i}` }))
  assert.match(H.withHoliday(full, once('2026-12-25')).error, /at most/)
  assert.equal(H.dropOldHolidays([once('2025-10-01'), once('2026-11-27'), every('yearly', '2020-01-26')], NOW).length, 2, 'one-offs over a year old go')
})

test('words: how it repeats, the choices for a day, dates', () => {
  assert.equal(H.repeatLabel(every('yearly', '2027-01-26')), 'Every year on 26 Jan')
  assert.equal(H.repeatLabel(every('monthly', '2026-11-01')), 'Every month on the 1st')
  assert.equal(H.repeatLabel(every('monthly', '2026-11-22')), 'Every month on the 22nd')
  assert.equal(H.repeatLabel(every('monthly_weekday', '2026-11-10')), 'Every month on the 2nd Tuesday')
  assert.equal(H.repeatLabel(every('monthly_last_weekday', '2026-11-28')), 'Every month on the last Saturday')
  assert.equal(H.repeatLabel(once('2026-11-27')), 'Only once')
  assert.equal(H.repeatLabel(once('2026-11-27', 3)), 'Only once, 3 days')
  assert.equal(H.repeatLabel(every('yearly', '2026-12-31', 3)), 'Every year on 31 Dec, 3 days')
  assert.deepEqual(H.repeatChoices('2026-11-28').map((c) => c.value), ['none', 'yearly', 'monthly', 'monthly_weekday', 'monthly_last_weekday'])
  assert.deepEqual(H.repeatChoices('2026-11-30').map((c) => c.value), ['none', 'yearly', 'monthly', 'monthly_last_weekday'], 'no "5th Monday"')
  assert.deepEqual(H.repeatChoices('2026-11-10').map((c) => c.value), ['none', 'yearly', 'monthly', 'monthly_weekday'])
  assert.equal(H.spanLabel({ start: '2026-11-08', end: '2026-11-10' }), '8 to 10 Nov')
  assert.equal(H.spanLabel({ start: '2026-12-30', end: '2027-01-02' }, true), '30 Dec 2026 to 2 Jan 2027')
  assert.equal(H.ordinal(11), '11th')
  assert.equal(H.ordinal(23), '23rd')
  assert.equal(H.suggestedStart('01-26', NOW), '2027-01-26')
  assert.equal(H.suggestedStart('12-25', NOW), '2026-12-25')
})

// ── Everything follows them ───────────────────────────────────────────────────

test('availability: a holiday is a closed day, so no free times', () => {
  const hours = { opens_at: '10:00', closes_at: '20:00', closed_weekdays: [], holidays: [once('2026-11-27')] }
  assert.equal(AV.isClosedOn('2026-11-27', hours), true)
  assert.equal(AV.isClosedOn('2026-11-26', hours), false)
  const base = { now: NOW, hours, minutes: 30, eligibleStaff: [ANU], busy: [] }
  assert.deepEqual(AV.freeTimes({ ...base, date: '2026-11-27' }), [])
  assert.ok(AV.freeTimes({ ...base, date: '2026-11-26' }).length)
  assert.equal(AV.nextOpenDay({ ...base, from: '2026-11-27', busyFor: () => [] }), '2026-11-28')
  assert.equal(AV.isClosedOn('2026-11-27', { ...hours, holidays: 'broken' }), false, 'a broken saved list never closes the shop')
})

test('the booking page skips holidays and offers no times on them; the public API too', async () => {
  const db = salonDb(seed([once('2026-11-27'), every('yearly', '2026-12-25', 1, 'Christmas')]))
  const page = await BP.loadBookingPage(db, 'glow-ab12')
  const days = BP.bookableDays(page.setup.settings, NOW)
  assert.ok(!days.includes('2026-11-27'))
  assert.ok(!days.includes('2026-12-25'))
  assert.ok(days.includes('2026-11-26'))
  const closed = await BP.bookingTimes(db, page, { serviceIds: [CUT], staffId: null, date: '2026-11-27' }, NOW)
  assert.deepEqual(closed.times, [])
  const open = await BP.bookingTimes(db, page, { serviceIds: [CUT], staffId: null, date: '2026-11-26' }, NOW)
  assert.ok(open.times.length)
  const api = await availableTimes(db, ORG, { date: '2026-11-27', serviceIds: [CUT], now: NOW })
  assert.deepEqual(api.times, [])
  assert.equal(api.check('12:00'), false)
  assert.ok((await availableTimes(db, ORG, { date: '2026-11-26', serviceIds: [CUT], now: NOW })).times.length)
})

test('the WhatsApp assistant and the website chat are told about coming holidays', () => {
  const settings = { business_name: 'Glow Salon', opens_at: '10:00', closes_at: '20:00', closed_weekdays: [], holidays: [once('2026-11-27'), every('yearly', '2027-06-01', 1, 'Far away')] }
  const prompt = chatSystemPrompt({ settings, services: [], staff: [] }, { name: 'Glow' }, 'Priya', NOW)
  assert.match(prompt, /Closed for holidays: Diwali \(27 Nov, Friday, 2026-11-27\)/)
  assert.doesNotMatch(prompt, /Far away/, 'only the next two months')
  assert.equal(H.holidaysSentence([], NOW), '')
  const facts = deskFacts({ business: 'Glow', hours: 'Open 10 am to 8 pm', services: [], staff: [], approval: true, holidays: [{ name: 'Diwali', when: '27 Nov' }] })
  assert.match(facts, /Closed for holidays .*Diwali \(27 Nov\)/)
})

test('the website: "Closed today · Diwali" and the next open day skips holidays; coming holidays listed', () => {
  const hours = { opens_at: '10:00', closes_at: '20:00', closed_weekdays: [4], holidays: [once('2026-11-25', 1, 'Diwali')] }
  // 25 Nov is the holiday, 26 Nov a Thursday (closed every week): opens Friday
  assert.deepEqual(W.openStatus(hours, NOW), { open: false, text: 'Closed today · Diwali · opens Friday 10 am' })
  assert.equal(W.openStatus({ ...hours, holidays: [] }, NOW).open, true)
  const long = { opens_at: '10:00', closes_at: '20:00', closed_weekdays: [], holidays: [once('2026-11-25', 10, 'Annual leave')] }
  assert.equal(W.openStatus(long, NOW).text, 'Closed today · Annual leave · opens on 5 Dec, 10 am')
  const list = W.comingHolidays({ holidays: [once('2026-11-25'), every('yearly', '2026-12-25', 1, 'Christmas'), every('yearly', '2027-03-01', 1, 'Too far')] }, NOW)
  assert.deepEqual(list, [{ name: 'Diwali', when: '25 Nov', today: true }, { name: 'Christmas', when: '25 Dec', today: false }])
  assert.deepEqual(W.comingHolidays({ opens_at: '10:00' }, NOW), [])
})

test('attendance: holidays are not working days (leave skips them, never "not marked", leave joins across them)', () => {
  const holidays = [once('2026-11-27')]
  const leave = A.leaveRange({ staff_id: ANU, from: '2026-11-26', to: '2026-11-28' }, NOW, [], holidays)
  assert.deepEqual(leave.value.map((m) => m.day), ['2026-11-26', '2026-11-28'])
  assert.match(A.leaveRange({ staff_id: ANU, from: '2026-11-27', to: '2026-11-27' }, NOW, [], holidays).error, /closed/)
  const team = [{ id: ANU, name: 'Anu' }]
  // 1 to 25 Nov 2026 with a holiday on 10 and 11 Nov: 23 working days, none marked
  const summary = A.monthSummary(team, [], '2026-11', NOW, [], [once('2026-11-10', 2)])
  assert.equal(summary[0].not_marked, 23)
  assert.equal(A.monthSummary(team, [], '2026-11', NOW)[0].not_marked, 25)
  const marks = [{ staff_id: ANU, day: '2026-11-26', status: 'leave' }, { staff_id: ANU, day: '2026-11-28', status: 'leave' }]
  assert.equal(A.leaveSpans(marks, ANU, [], holidays).length, 1, 'one leave across the holiday')
  assert.equal(A.leaveSpans(marks, ANU, []).length, 2)
})

// ── Saving ────────────────────────────────────────────────────────────────────

test('store: holidays are saved on the settings row, read back, and bookings on them are counted', async () => {
  const db = salonDb({ ...seed(), salon_settings: [] })
  assert.deepEqual(await HS.loadHolidays(db, ORG), [])
  const saved = await HS.saveHolidays(db, ORG, [once('2026-11-27'), once('2025-01-01', 1, 'Long gone')])
  assert.deepEqual(saved.map((h) => h.name), ['Diwali'])
  assert.deepEqual((await HS.loadHolidays(db, ORG)).map((h) => h.id), ['h_2026-11-27'])
  db.tables.salon_appointments = [
    { id: 'a1', organization_id: ORG, starts_at: '2026-11-27T05:30:00Z', ends_at: '2026-11-27T06:00:00Z', status: 'booked' },
    { id: 'a2', organization_id: ORG, starts_at: '2026-11-27T08:30:00Z', ends_at: '2026-11-27T09:00:00Z', status: 'cancelled' },
    { id: 'a3', organization_id: ORG, starts_at: '2026-11-28T05:30:00Z', ends_at: '2026-11-28T06:00:00Z', status: 'booked' },
  ]
  const booked = await HS.bookingsOnHoliday(db, ORG, once('2026-11-27'), NOW)
  assert.deepEqual(booked, { count: 1, days: ['2026-11-27'] })
  assert.deepEqual(await HS.bookingsOnHoliday({ from: () => { throw new Error('down') } }, ORG, once('2026-11-27'), NOW), { count: 0, days: [] })
})

test('the column: same SQL as the migration file, its own lock, set up when missing', async () => {
  const file = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261214_front_desk_holidays.sql'), 'utf8')
  assert.equal(file, HS.HOLIDAYS_SQL)
  assert.equal(HS.HOLIDAYS_LOCK, 724519041)
  assert.match(HS.HOLIDAYS_SQL, /ADD COLUMN IF NOT EXISTS holidays JSONB NOT NULL DEFAULT '\[\]'::jsonb/)
  let calls = 0
  let ensured = 0
  const step = () => Promise.resolve(++calls === 1 ? { data: null, error: { code: 'PGRST204', message: "Could not find the 'holidays' column of 'salon_settings' in the schema cache" } } : { data: { holidays: [] }, error: null })
  const result = await HS.withHolidaysSchema(step, { ensure: async () => { ensured++; return true } })
  assert.equal(ensured, 1)
  assert.equal(calls, 2)
  assert.deepEqual(result.data, { holidays: [] })
})

// ── The API ───────────────────────────────────────────────────────────────────

const PROJECT = path.join(__dirname, '..')
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }
const { can } = require(path.join(PROJECT, 'lib/rbac.ts'))
const { istDate, addDays } = require(path.join(PROJECT, 'lib/salon/spoken.ts'))
let apiDb
let me
stub(path.join(PROJECT, 'lib/api-auth-helper.ts'), {
  getSupabaseAdminClient: () => apiDb,
  verifyOrgAccess: async (_request, organizationId, options = {}) => {
    if (organizationId !== ORG) return { authorized: false, error: 'Not your workspace', status: 403, user: me }
    if (options.permission && !can(me, options.permission)) return { authorized: false, error: 'Only managers and admins can do this.', status: 403, user: me }
    return { authorized: true, user: me }
  },
})

const loadRoute = () => {
  const route = require(path.join(PROJECT, 'app/api/salon/holidays/route.ts'))
  const attendance = require(path.join(PROJECT, 'app/api/salon/attendance/route.ts'))
  const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))
  return { route, attendance, NextRequest }
}
const MANAGER = { id: 'u-manager', role: 'org_manager' }
const STAFF = { id: 'u-staff', role: 'sales_employee' }

test('API: managers add, change and remove holidays; staff can look; bookings already on the day are counted', async () => {
  const quiet = console.error
  console.error = () => {}
  try {
    const { route, attendance, NextRequest } = loadRoute()
    apiDb = salonDb(seed())
    const today = istDate()
    const day = addDays(today, 2)
    apiDb.tables.salon_appointments = [{ id: 'a1', organization_id: ORG, starts_at: `${day}T05:30:00Z`, ends_at: `${day}T06:00:00Z`, status: 'booked' }]
    const call = async (method, body, query = '') => {
      const url = `https://wamacrm.example.com/api/salon/holidays?organizationId=${ORG}${query}`
      const init = method === 'GET' || method === 'DELETE' ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: ORG, ...body }) }
      const res = await route[method](new NextRequest(url, init))
      return { status: res.status, body: await res.json() }
    }
    me = MANAGER
    const added = await call('POST', { holiday: { name: 'Diwali', start: day } })
    assert.equal(added.status, 200)
    assert.equal(added.body.holidays.length, 1)
    assert.equal(added.body.bookings.count, 1)
    assert.match(added.body.message, /1 booking is already on that day/)
    const id = added.body.holidays[0].id
    assert.equal(added.body.holidays[0].label, 'Only once')
    assert.ok(added.body.holidays[0].next)
    assert.ok(added.body.suggestions.some((s) => s.name === 'Republic Day'))

    const yearly = await call('PUT', { holiday: { name: 'Republic Day', start: H.suggestedStart('01-26'), repeat: 'yearly' } })
    assert.equal(yearly.body.holidays.length, 2)
    assert.ok(!yearly.body.suggestions.some((s) => s.name === 'Republic Day'), 'an added suggestion is not offered again')

    const changed = await call('POST', { holiday: { id, name: 'Diwali', start: day, days: 2 } })
    assert.equal(changed.body.holidays.length, 2)
    assert.equal(changed.body.holidays.find((h) => h.id === id).days, 2)
    assert.equal((await call('POST', { holiday: { name: '', start: day } })).body.field, 'name')

    // The attendance day view says it is a holiday; leave skips it
    const att = await attendance.GET(new NextRequest(`https://wamacrm.example.com/api/salon/attendance?organizationId=${ORG}&day=${day}`))
    const attBody = await att.json()
    assert.equal(attBody.holiday.name, 'Diwali')
    const month = await attendance.GET(new NextRequest(`https://wamacrm.example.com/api/salon/attendance?organizationId=${ORG}&month=${day.slice(0, 7)}`))
    assert.equal((await month.json()).holidays[day], 'Diwali')

    me = STAFF
    const look = await call('GET')
    assert.equal(look.status, 200)
    assert.equal(look.body.canChange, false)
    assert.equal((await call('POST', { holiday: { name: 'Mine', start: day } })).status, 403)
    assert.equal((await call('DELETE', null, `&id=${id}`)).status, 403)

    me = MANAGER
    const removed = await call('DELETE', null, `&id=${id}`)
    assert.equal(removed.body.removed, true)
    assert.equal(removed.body.holidays.length, 1)
    const again = await call('DELETE', null, `&id=${id}`)
    assert.equal(again.status, 200)
    assert.equal(again.body.removed, false)
    assert.equal((await call('DELETE', null, '')).status, 400)
  } finally {
    console.error = quiet
  }
})
