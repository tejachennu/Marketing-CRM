require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const T = require('../lib/salon/service-time.ts')
const A = require('../lib/salon/actions.ts')
const V = require('../lib/salon/validate.ts')
const chat = require('../lib/salon/chat.ts')
const api = require('../lib/public-api/front-desk.ts')
const { salonDb } = require('./salon-fake-db.cjs')

// "Takes time" on a service (owner, 28 Nov 2026: "Prati service ki time vundadu just billing vuntadi time enable
// disable option evu"): off = billing only, no minutes, never booked; still billed.

const ORG = 'org-salon'
const CUT = '00000000-0000-4000-8000-0000000000a1'
const OIL = '00000000-0000-4000-8000-0000000000a4'
const services = [
  { id: CUT, organization_id: ORG, name: 'Haircut', category: 'Hair', price: 500, duration_minutes: 30, tax_rate: 0, active: true },
  { id: OIL, organization_id: ORG, name: 'Hair oil bottle', category: 'Products', price: 250, duration_minutes: 30, tax_rate: 0, active: true, takes_time: false },
]
const settings = { business_name: 'Glow Salon', gstin: '', invoice_prefix: 'GLOW', prices_include_tax: false }
const ctxFor = (db) => ({ db, organizationId: ORG, user: { id: 'user-1' }, organization: { id: ORG }, settings })

test('Service time: the column is added by itself (lock 724519042), word for word as the migration', () => {
  assert.equal(T.SERVICE_TIME_LOCK, 724519042)
  assert.equal(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261215_front_desk_service_time.sql'), 'utf8'), T.SERVICE_TIME_SQL)
  assert.match(T.SERVICE_TIME_SQL, /ADD COLUMN IF NOT EXISTS takes_time BOOLEAN NOT NULL DEFAULT TRUE/)
  assert.equal(T.takesTime({}), true, 'a missing value counts as on')
  assert.equal(T.takesTime({ takes_time: false }), false)
})

test('Service time: saved only when sent; a billing-only service needs no minutes', () => {
  assert.equal('takes_time' in V.parseService({ name: 'Haircut', price: 500, duration_minutes: 30 }).value, false, 'older apps send nothing, nothing changes')
  const off = V.parseService({ name: 'Hair oil bottle', price: 250, duration_minutes: '', takes_time: false })
  assert.equal(off.value.takes_time, false)
  assert.equal(off.value.duration_minutes, 30, 'a blank stays the usual 30')
  assert.deepEqual(V.parseService({ duration_minutes: '', takes_time: false }, true).value, { takes_time: false }, 'a change keeps the minutes it had')
  assert.match(V.parseService({ name: 'Haircut', price: 500, duration_minutes: '' }).error, /5 minutes and 10 hours/, 'a service that takes time still needs its minutes')
})

test('Service time: a billing-only service goes on a walk-in bill (adding no time) but cannot be booked', async () => {
  const db = salonDb({ salon_services: services })
  const bill = await A.executeCounterAction(ctxFor(db), A.parseCounterAction({ type: 'walk_in_bill', customer: { name: 'Asha' }, service_ids: [CUT, OIL], payment_method: 'cash', send_whatsapp: false }).action)
  assert.deepEqual(bill.invoice.items.map((i) => i.name), ['Haircut', 'Hair oil bottle'])
  assert.equal(Math.round((Date.parse(bill.appointment.ends_at) - Date.parse(bill.appointment.starts_at)) / 60000), 30, 'only the haircut takes time')

  const startsAt = new Date(Date.now() + 2 * 86_400_000).toISOString()
  const booking = A.parseCounterAction({ type: 'create_appointment', customer: { name: 'Asha', phone: '+919876543210' }, service_ids: [OIL], starts_at: startsAt, send_whatsapp: false })
  await assert.rejects(A.executeCounterAction(ctxFor(db), booking.action), /Hair oil bottle is for billing only \(no time\), so it cannot be booked/)
})

test('Service time: customers are never offered a billing-only service (WhatsApp, booking page, website)', async () => {
  const db = salonDb({ salon_services: services, salon_settings: [{ organization_id: ORG, business_name: 'Glow Salon' }] })
  const setup = await chat.loadChatSetup(db, ORG)
  assert.deepEqual(setup.services.map((s) => s.name), ['Haircut'])
})

test('Service time: the public API says which services can be booked and refuses the others', async () => {
  assert.equal(api.toApiService(services[0]).bookable, true)
  assert.equal(api.toApiService(services[1]).bookable, false)
  const db = salonDb({ salon_services: services, salon_settings: [{ organization_id: ORG }] })
  const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)
  const result = await api.availableTimes(db, ORG, { date, serviceIds: [OIL] })
  assert.match(result.error, /Hair oil bottle is for billing only/)
})

test('Service time: saving adds the column when it is missing, and saves "on" without it when it cannot', async () => {
  const missing = { error: { code: '42703', message: 'column salon_services.takes_time does not exist' } }
  const calls = []
  let added = false
  const write = async (values) => { calls.push(values); return added || !('takes_time' in values) ? { data: values, error: null } : missing }
  const result = await T.saveWithServiceTime({ name: 'Haircut', takes_time: false }, write, { ensure: async () => (added = true) })
  assert.equal(result.data.takes_time, false)
  assert.equal(calls.length, 2)

  // No way to add it: "on" is the default, so the save goes through without the field; "off" says why it failed
  added = false
  const on = await T.saveWithServiceTime({ name: 'Haircut', takes_time: true }, write, { ensure: async () => false })
  assert.deepEqual(on.data, { name: 'Haircut' })
  const off = await T.saveWithServiceTime({ name: 'Oil', takes_time: false }, write, { ensure: async () => false })
  assert.ok(off.error)
})
