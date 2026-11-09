require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { salonDb } = require('./salon-fake-db.cjs')
const F = require('../lib/salon/booking-flow.ts')
const S = require('../lib/salon/booking-flow-settings.ts')
const C = require('../lib/salon/chat.ts')

const ORG = 'c0ffee00-0000-4000-8000-0000000000dd'
const svc = (n) => `00000000-0000-4000-8000-0000000007${String(n).padStart(2, '0')}`
const STAFF_A = '00000000-0000-4000-8000-0000000008a1'
const STAFF_B = '00000000-0000-4000-8000-0000000008b2'
const NOW = Date.parse('2026-11-09T09:00:00+05:30')
const organization = { id: ORG, name: 'Glow', enabled_connectors: ['salon'], whatsapp_provider: 'facebook', whatsapp_api_token: 't', whatsapp_phone_number_id: '111' }

const STEPS = [
  { type: 'choice', text: 'Is this your first visit?', label: 'First visit', options: ['Yes', 'No'] },
  { type: 'services' },
  { type: 'text', text: 'Any allergies we should know about?', label: 'Allergies' },
  { type: 'message', text: 'Please come 10 minutes early.' },
  { type: 'staff' },
  { type: 'choice', text: 'How did you hear about us?', label: 'Heard from', options: ['Instagram', 'Google', 'Friend', 'Walked by'] },
  { type: 'datetime' },
]

function seed(flow = {}) {
  return salonDb({
    salon_settings: [{ organization_id: ORG, business_name: 'Glow Salon', opens_at: '10:00', closes_at: '20:00', closed_weekdays: [0], booking_flow: { enabled: true, steps: STEPS, ...flow } }],
    salon_services: [1, 2, 3].map((i) => ({ id: svc(i), organization_id: ORG, name: `Service ${i}`, category: 'Hair', price: 500, duration_minutes: 30, active: true, position: i })),
    salon_staff: [{ id: STAFF_A, organization_id: ORG, name: 'Anitha', active: true, service_ids: [] }, { id: STAFF_B, organization_id: ORG, name: 'Ravi', active: true, service_ids: [] }],
    salon_appointments: [], salon_chat_offers: [], salon_booking_sessions: [], contacts: [], conversations: [], messages: [],
  })
}

function whatsapp() {
  const sent = []
  const real = globalThis.fetch
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ messages: [{ id: `wamid.${sent.length}` }] }), { status: 200 }) }
  return { sent, restore: () => { globalThis.fetch = real } }
}

const input = (db, extra = {}) => ({ supabase: db, organization, contact: { id: 'k1', first_name: 'Priya' }, conversationId: 'cv1', customerPhone: '+919876543210', message: 'Book', history: [], now: NOW, ...extra })
const rows = (m) => m.interactive.action.sections[0].rows
const buttons = (m) => m.interactive.action.buttons.map((b) => b.reply)
const tap = (db, id) => F.handleBookingStepButton(input(db, { buttonId: id }))

test('Sessions migration is run word for word', () => {
  const { FRONT_DESK_BOOKING_SESSIONS_SQL } = require('../lib/salon/schema.ts')
  assert.equal(FRONT_DESK_BOOKING_SESSIONS_SQL, fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261116_front_desk_booking_sessions.sql'), 'utf8'))
})

test('Steps are checked: services added, day and time last, who after services, empty ones dropped', () => {
  const { steps, notes } = S.parseSteps([
    { type: 'datetime' },
    { type: 'staff' },
    { type: 'choice', text: 'Gender?', options: ['Female'] },
    { type: 'text', text: '  Your age?  ' },
    { type: 'message', text: '' },
    { type: 'rocket' },
  ])
  assert.deepEqual(steps.map((s) => s.type), ['services', 'staff', 'text', 'datetime'])
  assert.deepEqual(steps.map((s) => s.id), ['s1', 's2', 's3', 's4'])
  assert.equal(steps[2].label, 'Your age')
  assert.ok(notes.some((n) => /needs at least two answers/.test(n)))
  assert.ok(notes.some((n) => /Pick services was added/.test(n)))
  assert.deepEqual(S.parseSteps(null, true).steps.map((s) => s.type), ['services', 'staff', 'datetime'])
  const many = S.parseSteps(Array.from({ length: 20 }, (_, i) => ({ type: 'message', text: `Note ${i}` }))).steps
  assert.equal(many.length, S.MAX_STEPS)
  assert.equal(many.at(-1).type, 'datetime')
})

test('Saved flow without steps keeps working as before', () => {
  assert.deepEqual(S.parseBookingFlow({ enabled: true, ask_staff: true }).steps.map((s) => s.type), ['services', 'staff', 'datetime'])
  assert.equal(S.parseBookingFlow({ steps: [{ type: 'services' }, { type: 'staff' }, { type: 'datetime' }] }).ask_staff, true)
})

test('The business\'s own steps, in their order, with answers written on the booking', async () => {
  const db = seed()
  const wa = whatsapp()
  try {
    // 1. A question with buttons, after the welcome
    assert.deepEqual(await F.startBookingFlow(input(db)), { handled: true, step: 'question' })
    assert.match(wa.sent[0].interactive.body.text, /^Hi Priya! Let's book your visit at Glow Salon\. Which service would you like\?\n\nIs this your first visit\?$/)
    assert.deepEqual(buttons(wa.sent[0]).map((b) => b.title), ['Yes', 'No'])
    assert.equal(db.tables.salon_booking_sessions.length, 1)

    // 2. Services
    assert.deepEqual(await tap(db, buttons(wa.sent[0])[0].id), { handled: true, step: 'services' })
    assert.equal(wa.sent[1].interactive.body.text, 'Which service would you like?')
    assert.deepEqual(rows(wa.sent[1]).map((r) => r.title), ['Service 1', 'Service 2', 'Service 3'])
    assert.deepEqual(await tap(db, rows(wa.sent[1])[1].id), { handled: true, step: 'added' })
    assert.deepEqual(buttons(wa.sent[2]).map((b) => b.title), ['Add another', 'Continue'])

    // A tap on an old list: "here is where you are" and the current step again
    assert.deepEqual(await tap(db, buttons(wa.sent[0])[1].id), { handled: true, step: 'services' })
    assert.match(wa.sent[3].interactive.body.text, /^That list is from an earlier step\./)

    // 3. A typed answer, then 4. a message, then 5. who
    assert.deepEqual(await tap(db, buttons(wa.sent[2])[1].id), { handled: true, step: 'question' })
    assert.match(wa.sent[4].text.body, /^Any allergies we should know about\?\n\(Type your answer/)
    const waiting = await F.waitingForAnswer(db, ORG, '+91 98765 43210', NOW)
    assert.ok(waiting)
    assert.deepEqual(await F.handleBookingText(input(db, { sessionId: waiting, message: 'No allergies' })), { handled: true, step: 'people' })
    assert.equal(wa.sent[5].text.body, 'Please come 10 minutes early.')
    assert.deepEqual(rows(wa.sent[6]).map((r) => r.title), ['Anyone free', 'Anitha', 'Ravi'])
    assert.equal(await F.waitingForAnswer(db, ORG, '+919876543210', NOW), null)

    // 6. A question with 4 answers comes as a list
    assert.deepEqual(await tap(db, rows(wa.sent[6])[2].id), { handled: true, step: 'question' })
    assert.deepEqual(rows(wa.sent[7]).map((r) => r.title), ['Instagram', 'Google', 'Friend', 'Walked by'])

    // 7. Day, then the times; the tap books it with the answers
    assert.deepEqual(await tap(db, rows(wa.sent[7])[0].id), { handled: true, step: 'days' })
    assert.match(wa.sent[8].interactive.body.text, /Which day suits you for Service 2/)
    assert.deepEqual(await tap(db, rows(wa.sent[8])[1].id), { handled: true, step: 'times' })
    assert.equal(db.tables.salon_booking_sessions.length, 0, 'the times list carries it from here')
    const offer = db.tables.salon_chat_offers[0]
    assert.equal(offer.staff_id, STAFF_B)
    assert.equal(offer.notes, 'First visit: Yes · Allergies: No allergies · Heard from: Instagram')
    await C.handleSlotPick({ ...input(db), buttonId: rows(wa.sent[9])[0].id })
    assert.equal(db.tables.salon_appointments[0].notes, 'Booked on WhatsApp · First visit: Yes · Allergies: No allergies · Heard from: Instagram')
    assert.equal(db.tables.salon_appointments[0].staff_id, STAFF_B)
  } finally { wa.restore() }
})

test('"cancel" while a typed answer is waiting stops the booking', async () => {
  const db = seed({ steps: [{ type: 'text', text: 'Your car number?', label: 'Car' }, { type: 'services' }, { type: 'datetime' }] })
  const wa = whatsapp()
  try {
    assert.deepEqual(await F.startBookingFlow(input(db)), { handled: true, step: 'question' })
    const waiting = await F.waitingForAnswer(db, ORG, '+919876543210', NOW)
    assert.deepEqual(await F.handleBookingText(input(db, { sessionId: waiting, message: 'Cancel' })), { handled: true, step: 'cancelled' })
    assert.match(wa.sent[1].text.body, /Booking cancelled/)
    assert.equal(db.tables.salon_booking_sessions.length, 0)
  } finally { wa.restore() }
})

test('Default steps: the welcome list of services straight away, as before', async () => {
  const db = seed({ steps: undefined })
  const wa = whatsapp()
  try {
    assert.deepEqual(await F.startBookingFlow(input(db)), { handled: true, step: 'started' })
    assert.match(wa.sent[0].interactive.body.text, /^Hi Priya! Let's book your visit at Glow Salon\. Which service would you like\?$/)
    assert.match(rows(wa.sent[0])[0].id, /^bs:[A-Za-z0-9_-]{22}:0:s:[A-Za-z0-9_-]{22}$/)
  } finally { wa.restore() }
})

test('Another customer\'s buttons, or an old session, do not work for this number', async () => {
  const db = seed({ steps: undefined })
  const wa = whatsapp()
  try {
    await F.startBookingFlow(input(db))
    const id = rows(wa.sent[0])[0].id
    assert.deepEqual(await F.handleBookingStepButton(input(db, { buttonId: id, customerPhone: '+919000000000' })), { handled: true, step: 'expired' })
    assert.deepEqual(await F.handleBookingStepButton(input(db, { buttonId: id, now: NOW + 25 * 3600_000 })), { handled: true, step: 'expired' })
  } finally { wa.restore() }
})
