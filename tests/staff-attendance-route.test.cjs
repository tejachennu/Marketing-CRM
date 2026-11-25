// /api/salon/attendance against a fake database and a fake sign-in: managers mark, everyone can look (notes hidden).
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { salonDb } = require('./salon-fake-db.cjs')

const PROJECT = path.join(__dirname, '..')
const ORG = '11111111-1111-4111-8111-111111111111'
const ANU = '44444444-4444-4444-8444-444444444444'
const RAVI = '55555555-5555-4555-8555-555555555555'
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

const { can } = require(path.join(PROJECT, 'lib/rbac.ts'))
const { istDate, addDays } = require(path.join(PROJECT, 'lib/salon/spoken.ts'))
let db
let me
stub(path.join(PROJECT, 'lib/api-auth-helper.ts'), {
  getSupabaseAdminClient: () => db,
  verifyOrgAccess: async (_request, organizationId, options = {}) => {
    if (organizationId !== ORG) return { authorized: false, error: 'Not your workspace', status: 403, user: me }
    if (options.permission && !can(me, options.permission)) return { authorized: false, error: 'Only managers and admins can do this.', status: 403, user: me }
    return { authorized: true, user: me }
  },
})
console.error = () => {}

const route = require(path.join(PROJECT, 'app/api/salon/attendance/route.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))
const url = (query) => `https://wamacrm.example.com/api/salon/attendance?organizationId=${ORG}&${query}`
const get = async (query) => { const res = await route.GET(new NextRequest(url(query))); return { status: res.status, body: await res.json() } }
const send = async (method, body) => {
  const res = await route[method](new NextRequest('https://wamacrm.example.com/api/salon/attendance', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: ORG, ...body }) }))
  return { status: res.status, body: await res.json() }
}
const remove = async (query) => { const res = await route.DELETE(new NextRequest(url(query), { method: 'DELETE' })); return { status: res.status, body: await res.json() } }

const MANAGER = { id: 'u-manager', role: 'org_manager' }
const STAFF = { id: 'u-staff', role: 'sales_employee' }
const today = istDate()

function reset() {
  db = salonDb({
    organizations: [{ id: ORG, name: 'Glow', slug: 'glow', enabled_connectors: ['salon'] }],
    salon_settings: [{ organization_id: ORG, closed_weekdays: [] }],
    salon_staff: [
      { id: ANU, organization_id: ORG, name: 'Anu', active: true, service_ids: [] },
      { id: RAVI, organization_id: ORG, name: 'Ravi', active: true, service_ids: [] },
    ],
  })
}

test('managers mark one person, then "everyone else present"; the day lists both', async () => {
  reset()
  me = MANAGER
  const one = await send('POST', { marks: [{ staff_id: RAVI, day: today, status: 'leave', leave_kind: 'sick', note: 'Fever' }] })
  assert.equal(one.status, 200)
  assert.equal(one.body.count, 1)
  const all = await send('POST', { all: { day: today } })
  assert.equal(all.body.count, 1, 'only Anu: Ravi stays on leave')
  const again = await send('POST', { all: { day: today } })
  assert.equal(again.body.count, 0)
  const day = await get(`day=${today}`)
  assert.deepEqual(day.body.rows.map((r) => [r.name, r.mark.status]), [['Anu', 'present'], ['Ravi', 'leave']])
  assert.equal(day.body.rows[1].mark.note, 'Fever')
  assert.equal(day.body.counts.leave, 1)
  assert.equal(day.body.canMark, true)
})

test('the app\'s offline queue sends PUT: the same mark twice is still one mark', async () => {
  reset()
  me = MANAGER
  const mark = { marks: [{ staff_id: ANU, day: today, status: 'half_day' }], client_ref: 'abc' }
  assert.equal((await send('PUT', mark)).status, 200)
  assert.equal((await send('PUT', mark)).status, 200)
  assert.equal(db.tables.salon_staff_attendance.length, 1)
})

test('staff can look (without notes) but not mark or clear', async () => {
  reset()
  me = MANAGER
  await send('POST', { marks: [{ staff_id: RAVI, day: today, status: 'leave', note: 'Doctor' }] })
  me = STAFF
  const refused = await send('POST', { marks: [{ staff_id: ANU, day: today, status: 'present' }] })
  assert.equal(refused.status, 403)
  assert.equal((await remove(`staffId=${RAVI}&day=${today}`)).status, 403)
  const day = await get(`day=${today}`)
  assert.equal(day.status, 200)
  assert.equal(day.body.canMark, false)
  assert.equal(day.body.rows.find((r) => r.staff_id === RAVI).mark.note, null)
  assert.equal(day.body.marks[0].note, null)
})

test('leave from one day to another, the month view, then cancelling the leave', async () => {
  reset()
  me = MANAGER
  const from = addDays(today, 1)
  const to = addDays(today, 3)
  const leave = await send('POST', { leave: { staff_id: ANU, from, to, leave_kind: 'casual', note: 'Wedding' } })
  assert.equal(leave.status, 200)
  assert.equal(leave.body.count, 3)
  assert.match(leave.body.message, /3 days/)
  const month = await get(`month=${from.slice(0, 7)}&staffId=${ANU}`)
  assert.equal(month.status, 200)
  assert.equal(month.body.staff.length, 1)
  assert.ok(month.body.leave.length >= 1)
  assert.equal(month.body.leave[0].note, 'Wedding')
  const cleared = await remove(`staffId=${ANU}&from=${from}&to=${to}`)
  assert.equal(cleared.body.removed, 3)
  assert.equal(db.tables.salon_staff_attendance.length, 0)
})

test('bad input is refused in plain words', async () => {
  reset()
  me = MANAGER
  const ahead = await send('POST', { marks: [{ staff_id: ANU, day: addDays(today, 90), status: 'present' }] })
  assert.equal(ahead.status, 400)
  assert.match(ahead.body.error, /62 days/)
  const stranger = await send('POST', { marks: [{ staff_id: '77777777-7777-4777-8777-777777777777', day: today, status: 'present' }] })
  assert.match(stranger.body.error, /not on your team/)
  const backwards = await send('POST', { leave: { staff_id: ANU, from: addDays(today, 3), to: today } })
  assert.equal(backwards.body.field, 'to')
  assert.equal((await remove(`staffId=${ANU}`)).status, 400)
})
