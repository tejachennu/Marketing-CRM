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

test('Button ids carry each choice', () => {
  assert.deepEqual(F.parseFlowButton(`bf:s:${svc(1)}`), { step: 'service', serviceId: svc(1) })
  assert.deepEqual(F.parseFlowButton(`bf:p:${svc(1)}:any`), { step: 'person', serviceId: svc(1), staffId: null })
  assert.deepEqual(F.parseFlowButton(`bf:d:${svc(1)}:${STAFF_A}:20261110`), { step: 'day', serviceId: svc(1), staffId: STAFF_A, date: '2026-11-10' })
  assert.deepEqual(F.parseFlowButton('bf:c:2'), { step: 'category', index: 2 })
  assert.equal(F.parseFlowButton('bf:s:not-an-id'), null)
  assert.equal(F.parseFlowButton('sb:x'), null)
})

test('Switched off: nothing is sent', async () => {
  const wa = whatsapp()
  try {
    assert.deepEqual(await F.startBookingFlow(input(seed({ flow: { enabled: false } }))), { handled: false, reason: 'flow_off' })
    assert.equal(wa.sent.length, 0)
  } finally { wa.restore() }
})

test('"Book" → services → days (closed days skipped) → times → a tap books it', async () => {
  const db = seed()
  const wa = whatsapp()
  try {
    assert.deepEqual(await F.startBookingFlow(input(db)), { handled: true, step: 'started' })
    const first = wa.sent[0]
    assert.match(first.interactive.body.text, /^Hi Priya! Let's book your visit at Glow Salon/)
    assert.deepEqual(rows(first).map((r) => r.id), [svc(1), svc(2), svc(3)].map((id) => `bf:s:${id}`))
    assert.equal(rows(first)[0].description, '₹500 · 30 min')

    assert.deepEqual(await F.handleBookingFlowButton(input(db, { buttonId: `bf:s:${svc(2)}` })), { handled: true, step: 'days' })
    const days = rows(wa.sent[1])
    assert.equal(days[0].title, 'Today')
    assert.equal(days[0].description, 'Mon, 9 Nov')
    assert.equal(days[2].title, 'Wed, 11 Nov')
    assert.ok(!days.some((d) => d.id.endsWith('20261115')), 'Sunday is closed')
    assert.equal(days.length, 6, '7 days ahead minus Sunday')

    assert.deepEqual(await F.handleBookingFlowButton(input(db, { buttonId: days[1].id })), { handled: true, step: 'times' })
    const times = rows(wa.sent[2])
    assert.match(times[0].id, /^sb:[0-9a-f-]{36}:1000$/)
    assert.match(wa.sent[2].interactive.body.text, /Service 2 on Tomorrow: tap "Choose a time"/)
    assert.equal(db.tables.salon_chat_offers.length, 1)

    const booked = await C.handleSlotPick({ ...input(db), buttonId: times[0].id })
    assert.deepEqual(booked, { handled: true, action: 'requested' })
    assert.equal(db.tables.salon_appointments[0].status, 'requested')
    assert.equal(db.tables.salon_appointments[0].source, 'chat')
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
  } finally { wa.restore() }
})

test('Asking who: only people who do that service, plus Anyone', async () => {
  const db = seed({ flow: { enabled: true, ask_staff: true } })
  const wa = whatsapp()
  try {
    assert.deepEqual(await F.handleBookingFlowButton(input(db, { buttonId: `bf:s:${svc(1)}` })), { handled: true, step: 'people' })
    assert.deepEqual(rows(wa.sent[0]).map((r) => r.title), ['Anyone free', 'Anitha', 'Ravi'])
    await F.handleBookingFlowButton(input(db, { buttonId: `bf:s:${svc(2)}` }))
    // Ravi does only Service 1, so for Service 2 there is one person: straight to the days
    assert.match(wa.sent[1].interactive.body.text, /Which day suits you for Service 2/)
    assert.deepEqual(await F.handleBookingFlowButton(input(db, { buttonId: `bf:p:${svc(2)}:${STAFF_B}` })), { handled: true, step: 'expired' })
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
