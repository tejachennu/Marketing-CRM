require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { salonDb } = require('./salon-fake-db.cjs')
const F = require('../lib/salon/booking-flow.ts')
const C = require('../lib/salon/chat.ts')

const ORG = 'c0ffee00-0000-4000-8000-0000000000cc'
const svc = (n) => `00000000-0000-4000-8000-0000000005${String(n).padStart(2, '0')}`
const STAFF_A = '00000000-0000-4000-8000-0000000006a1'
const STAFF_B = '00000000-0000-4000-8000-0000000006b2'
// Monday 9 Nov 2026, 9:00 am in India
const NOW = Date.parse('2026-11-09T09:00:00+05:30')
const organization = { id: ORG, name: 'Glow', enabled_connectors: ['salon'], whatsapp_provider: 'facebook', whatsapp_api_token: 't', whatsapp_phone_number_id: '111' }

function seed({ flow = { enabled: true }, services = 3, closed = [0] } = {}) {
  const list = Array.from({ length: services }, (_, i) => ({ id: svc(i + 1), organization_id: ORG, name: `Service ${i + 1}`, category: i < 6 ? 'Hair' : i < 11 ? 'Skin' : 'Nails', price: 500 + i, duration_minutes: 30, active: true, position: i }))
  return salonDb({
    salon_settings: [{ organization_id: ORG, business_name: 'Glow Salon', opens_at: '10:00', closes_at: '20:00', closed_weekdays: closed, booking_flow: flow, service_categories: ['Hair', 'Skin', 'Nails'] }],
    salon_services: list,
    salon_staff: [{ id: STAFF_A, organization_id: ORG, name: 'Anitha', active: true, service_ids: [] }, { id: STAFF_B, organization_id: ORG, name: 'Ravi', active: true, service_ids: [svc(1)] }],
    salon_appointments: [], salon_chat_offers: [], contacts: [], conversations: [], messages: [],
  })
}

function whatsapp() {
  const sent = []
  const real = globalThis.fetch
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ messages: [{ id: `wamid.${sent.length}` }] }), { status: 200 }) }
  return { sent, restore: () => { globalThis.fetch = real } }
}

const input = (db, extra = {}) => ({ supabase: db, organization, contact: { id: 'k1', first_name: 'Priya' }, conversationId: 'cv1', customerPhone: '+919876543210', message: 'Book', history: [], now: NOW, ...extra })
const rows = (message) => message.interactive.action.sections[0].rows

test('Booking flow migration is run word for word', () => {
  const { FRONT_DESK_BOOKING_FLOW_SQL } = require('../lib/salon/schema.ts')
  assert.equal(FRONT_DESK_BOOKING_FLOW_SQL, fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261115_front_desk_booking_flow.sql'), 'utf8'))
})

test('Settings: cleaned, with defaults', () => {
  assert.deepEqual(F.parseBookingFlow(null), F.DEFAULT_FLOW)
  const flow = F.parseBookingFlow({ enabled: true, triggers: [' Book ', 'BOOK', '', 'slot'], days_ahead: 99, language: 'te', welcome: '  Hi {name}  ' })
  assert.deepEqual(flow.triggers, ['book', 'slot'])
  assert.equal(flow.days_ahead, 7)
  assert.equal(flow.language, 'te')
  assert.equal(flow.welcome, 'Hi {name}')
})

test('What starts the flow: a short message with a trigger word', () => {
  const t = F.DEFAULT_TRIGGERS
  assert.ok(F.isBookingRequest('Book', t))
  assert.ok(F.isBookingRequest('I want to book the appointment', t))
  assert.ok(F.isBookingRequest('బుక్ చేయాలి', t))
  assert.ok(!F.isBookingRequest('Saw you on facebook', t))
  assert.ok(!F.isBookingRequest('notebook', t))
  assert.ok(!F.isBookingRequest('I booked last week but the stylist was late and I want to talk about a refund please', t))
})

test('Button ids carry each choice, with the services picked so far packed short', () => {
  const two = F.packIds([svc(1), svc(2)])
  assert.match(two, /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/)
  assert.equal(F.unpackId(F.packId(svc(3))), svc(3))
  assert.deepEqual(F.parseFlowButton(`bf:s:${two}`), { step: 'service', picked: [svc(1), svc(2)] })
  assert.deepEqual(F.parseFlowButton(`bf:m:${two}`), { step: 'more', picked: [svc(1), svc(2)] })
  assert.deepEqual(F.parseFlowButton(`bf:n:${two}`), { step: 'next', picked: [svc(1), svc(2)] })
  assert.deepEqual(F.parseFlowButton(`bf:p:${two}:any`), { step: 'person', picked: [svc(1), svc(2)], staffId: null })
  assert.deepEqual(F.parseFlowButton(`bf:d:${two}:${F.packId(STAFF_A)}:20261110`), { step: 'day', picked: [svc(1), svc(2)], staffId: STAFF_A, date: '2026-11-10' })
  assert.deepEqual(F.parseFlowButton('bf:c:2'), { step: 'category', index: 2, picked: [] })
  // Lists already sent in chats (full ids) still work
  assert.deepEqual(F.parseFlowButton(`bf:s:${svc(1)}`), { step: 'service', picked: [svc(1)] })
  assert.deepEqual(F.parseFlowButton(`bf:d:${svc(1)}:${STAFF_A}:20261110`), { step: 'day', picked: [svc(1)], staffId: STAFF_A, date: '2026-11-10' })
  assert.equal(F.parseFlowButton('bf:s:not-an-id'), null)
  assert.equal(F.parseFlowButton('sb:x'), null)
  // Five services, a person and a day fit WhatsApp's 200-character id
  const five = F.packIds([1, 2, 3, 4, 5].map(svc))
  assert.ok(`bf:d:${five}:${F.packId(STAFF_A)}:20261110`.length <= 200)
})

test('Switched off: nothing is sent', async () => {
  const wa = whatsapp()
  try {
    assert.deepEqual(await F.startBookingFlow(input(seed({ flow: { enabled: false } }))), { handled: false, reason: 'flow_off' })
    assert.equal(wa.sent.length, 0)
  } finally { wa.restore() }
})

test('First version (lists already in chats): service → Add another → second service → day → times → a tap books both', async () => {
  const db = seed()
  const wa = whatsapp()
  try {
    assert.deepEqual(await F.startStatelessFlow(input(db)), { handled: true, step: 'started' })
    const first = wa.sent[0]
    assert.match(first.interactive.body.text, /^Hi Priya! Let's book your visit at Glow Salon/)
    assert.deepEqual(rows(first).map((r) => F.parseFlowButton(r.id).picked), [[svc(1)], [svc(2)], [svc(3)]])
    assert.equal(rows(first)[0].description, '₹500 · 30 min')

    // Pick Service 2: "Added" with Add another / Choose a day
    assert.deepEqual(await F.handleBookingFlowButton(input(db, { buttonId: rows(first)[1].id })), { handled: true, step: 'added' })
    const added = wa.sent[1]
    assert.equal(added.interactive.type, 'button')
    assert.match(added.interactive.body.text, /Added: Service 2\.\nSo far: Service 2 · ₹501, about 30 min\./)
    const [more, next] = added.interactive.action.buttons.map((b) => b.reply)
    assert.deepEqual([more.title, next.title], ['Add another', 'Choose a day'])

    // Add another: the list again, without Service 2
    assert.deepEqual(await F.handleBookingFlowButton(input(db, { buttonId: more.id })), { handled: true, step: 'services' })
    const second = wa.sent[2]
    assert.match(second.interactive.body.text, /Which other service would you like\? \(You have: Service 2\)/)
    assert.deepEqual(rows(second).map((r) => r.title), ['Service 1', 'Service 3'])
    await F.handleBookingFlowButton(input(db, { buttonId: rows(second)[1].id }))
    assert.match(wa.sent[3].interactive.body.text, /So far: Service 2, Service 3 · ₹1,003, about 60 min/)

    // Choose a day: days for both together
    const done = wa.sent[3].interactive.action.buttons[1].reply.id
    assert.deepEqual(await F.handleBookingFlowButton(input(db, { buttonId: done })), { handled: true, step: 'days' })
    const days = rows(wa.sent[4])
    assert.match(wa.sent[4].interactive.body.text, /Which day suits you for Service 2, Service 3/)
    assert.equal(days[0].title, 'Today')
    assert.equal(days[0].description, 'Mon, 9 Nov')
    assert.equal(days[2].title, 'Wed, 11 Nov')
    assert.ok(!days.some((d) => d.id.endsWith('20261115')), 'Sunday is closed')
    assert.equal(days.length, 6, '7 days ahead minus Sunday')

    assert.deepEqual(await F.handleBookingFlowButton(input(db, { buttonId: days[1].id })), { handled: true, step: 'times' })
    const times = rows(wa.sent[5])
    assert.match(times[0].id, /^sb:[0-9a-f-]{36}:1000$/)
    assert.match(wa.sent[5].interactive.body.text, /Service 2, Service 3 on Tomorrow: tap "Choose a time"/)
    assert.deepEqual(db.tables.salon_chat_offers[0].service_ids, [svc(2), svc(3)])

    const booked = await C.handleSlotPick({ ...input(db), buttonId: times[0].id })
    assert.deepEqual(booked, { handled: true, action: 'requested' })
    const appointment = db.tables.salon_appointments[0]
    assert.equal(appointment.status, 'requested')
    assert.deepEqual(appointment.services.map((s) => s.name), ['Service 2', 'Service 3'])
    assert.equal((Date.parse(appointment.ends_at) - Date.parse(appointment.starts_at)) / 60000, 60)
  } finally { wa.restore() }
})

test('One service at a time when the business switches multi-select off', async () => {
  const db = seed({ flow: { enabled: true, multi_select: false } })
  const wa = whatsapp()
  try {
    assert.deepEqual(await F.handleBookingFlowButton(input(db, { buttonId: `bf:s:${F.packIds([svc(2)])}` })), { handled: true, step: 'days' })
    assert.equal(wa.sent[0].interactive.type, 'list')
  } finally { wa.restore() }
})

test('Up to 5 services: the fifth goes straight on to the day', async () => {
  const db = seed({ services: 6 })
  const wa = whatsapp()
  try {
    assert.deepEqual(await F.handleBookingFlowButton(input(db, { buttonId: `bf:s:${F.packIds([1, 2, 3, 4, 5].map(svc))}` })), { handled: true, step: 'days' })
  } finally { wa.restore() }
})

test('More than 10 services: pick a category first', async () => {
  const db = seed({ services: 13 })
  const wa = whatsapp()
  try {
    assert.deepEqual(await F.startBookingFlow(input(db)), { handled: true, step: 'categories' })
    assert.deepEqual(rows(wa.sent[0]).map((r) => `${r.title} (${r.description})`), ['Hair (6 services)', 'Skin (5 services)', 'Nails (2 services)'])
    assert.deepEqual(await F.handleBookingFlowButton(input(db, { buttonId: 'bf:c:1' })), { handled: true, step: 'services' })
    assert.equal(rows(wa.sent[1]).length, 5)
    assert.match(wa.sent[1].interactive.body.text, /Which Skin service/)
    // After one pick, Add another shows categories with what is left
    const skin = rows(wa.sent[1])[0].id
    await F.handleBookingFlowButton(input(db, { buttonId: skin }))
    await F.handleBookingFlowButton(input(db, { buttonId: wa.sent[2].interactive.action.buttons[0].reply.id }))
    assert.deepEqual(rows(wa.sent[3]).map((r) => r.description), ['6 services', '4 services', '2 services'])
  } finally { wa.restore() }
})

test('Asking who: only people who do that service, plus Anyone', async () => {
  const db = seed({ flow: { enabled: true, ask_staff: true } })
  const wa = whatsapp()
  try {
    assert.deepEqual(await F.handleBookingFlowButton(input(db, { buttonId: `bf:n:${F.packIds([svc(1)])}` })), { handled: true, step: 'people' })
    assert.deepEqual(rows(wa.sent[0]).map((r) => r.title), ['Anyone free', 'Anitha', 'Ravi'])
    await F.handleBookingFlowButton(input(db, { buttonId: `bf:n:${F.packIds([svc(1), svc(2)])}` }))
    // Ravi does only Service 1, so for Service 1 + 2 there is one person: straight to the days
    assert.match(wa.sent[1].interactive.body.text, /Which day suits you for Service 1, Service 2/)
    assert.deepEqual(await F.handleBookingFlowButton(input(db, { buttonId: `bf:p:${F.packIds([svc(2)])}:${F.packId(STAFF_B)}` })), { handled: true, step: 'expired' })
  } finally { wa.restore() }
})

test('A removed service or an old day says to start again', async () => {
  const db = seed()
  const wa = whatsapp()
  try {
    assert.deepEqual(await F.handleBookingFlowButton(input(db, { buttonId: `bf:s:${svc(9)}` })), { handled: true, step: 'expired' })
    assert.deepEqual(await F.handleBookingFlowButton(input(db, { buttonId: `bf:d:${svc(1)}:any:20261101` })), { handled: true, step: 'expired' })
    assert.match(wa.sent[0].text.body, /Send "Book" to start again/)
  } finally { wa.restore() }
})

test('Telugu wording when the business picks it', async () => {
  const db = seed({ flow: { enabled: true, language: 'te' } })
  const wa = whatsapp()
  try {
    await F.startBookingFlow(input(db))
    assert.match(wa.sent[0].interactive.body.text, /^Namaste Priya garu!/)
  } finally { wa.restore() }
})

test('Settings validator accepts the flow', () => {
  const V = require('../lib/salon/validate.ts')
  const parsed = V.parseWhatsAppSettings({ booking_flow: { enabled: true, triggers: ['book'] } })
  assert.equal(parsed.value.booking_flow.enabled, true)
  assert.deepEqual(parsed.value.booking_flow.triggers, ['book'])
})
