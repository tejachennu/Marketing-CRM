require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { salonDb } = require('./salon-fake-db.cjs')
const F = require('../lib/salon/booking-flow.ts')
const SF = require('../lib/salon/services-form.ts')

const ORG = 'c0ffee00-0000-4000-8000-0000000000ee'
const svc = (n) => `00000000-0000-4000-8000-0000000009${String(n).padStart(2, '0')}`
const STAFF_A = '00000000-0000-4000-8000-0000000008a1'
const STAFF_B = '00000000-0000-4000-8000-0000000008b2'
const NOW = Date.parse('2026-11-09T09:00:00+05:30')
const organization = { id: ORG, name: 'Glow', enabled_connectors: ['salon'], whatsapp_provider: 'facebook', whatsapp_api_token: 't', whatsapp_phone_number_id: '111', whatsapp_business_account_id: '999' }

function seed({ flow = {}, form = { id: '555', version: SF.FORM_VERSION, ready: true }, services } = {}) {
  return salonDb({
    salon_settings: [{ organization_id: ORG, business_name: 'Glow Salon', opens_at: '10:00', closes_at: '20:00', closed_weekdays: [0], service_categories: ['Skin', 'Hair'], services_form: form,
      booking_flow: { enabled: true, steps: [{ type: 'services' }, { type: 'staff' }, { type: 'datetime' }], ...flow } }],
    salon_services: services || [
      { id: svc(1), organization_id: ORG, name: 'Haircut', category: 'Hair', price: 600, duration_minutes: 45, active: true, position: 1 },
      { id: svc(2), organization_id: ORG, name: 'Hair spa', category: 'Hair', price: 1200, duration_minutes: 60, active: true, position: 2 },
      { id: svc(3), organization_id: ORG, name: 'Gold facial', category: 'Skin', price: 1500, duration_minutes: 60, active: true, position: 3 },
    ],
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

test('Services form migration is run word for word', () => {
  const { FRONT_DESK_SERVICES_FORM_SQL } = require('../lib/salon/schema.ts')
  assert.equal(FRONT_DESK_SERVICES_FORM_SQL, fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261118_front_desk_services_form.sql'), 'utf8'))
})

test('The form: ten groups of tick boxes, filled from the message, every tick sent back', () => {
  const json = SF.servicesFormJson()
  const screen = json.screens[0]
  assert.equal(screen.id, 'SERVICES')
  assert.equal(screen.terminal, true)
  const form = screen.layout.children[0]
  const boxes = form.children.filter((c) => c.type === 'CheckboxGroup')
  assert.equal(boxes.length, 10)
  assert.deepEqual(boxes[3], { type: 'CheckboxGroup', name: 'g3', label: '${data.g3_label}', 'data-source': '${data.g3_items}', visible: '${data.g3_show}', required: false })
  const footer = form.children.at(-1)
  assert.equal(footer.type, 'Footer')
  assert.equal(footer['on-click-action'].name, 'complete')
  assert.equal(footer['on-click-action'].payload.g9, '${form.g9}')
  // Every value the layout reads is declared with an example (Meta checks this)
  for (const key of ['intro', 'button', 'g0_label', 'g0_items', 'g0_show', 'g9_items']) assert.ok(screen.data[key].__example__ !== undefined, key)
})

test('Form data: services by category in the business\'s order; big categories split; too many groups fall back', () => {
  const services = [
    { id: 'a', name: 'Haircut', category: 'Hair', price: 600, duration_minutes: 45 },
    { id: 'b', name: 'Gold facial', category: 'Skin', price: 1500, duration_minutes: 60 },
  ]
  const data = SF.servicesFormData(services, ['Skin', 'Hair'], { intro: 'Tick', button: 'Continue' })
  assert.equal(data.g0_label, 'Skin')
  assert.deepEqual(data.g0_items, [{ id: 'b', title: 'Gold facial', description: '₹1,500 · 60 min' }])
  assert.equal(data.g1_label, 'Hair')
  assert.equal(data.g1_show, true)
  assert.equal(data.g2_show, false)
  assert.equal(data.g2_items.length, 1, 'a hidden group still has one row')

  const many = Array.from({ length: 45 }, (_, i) => ({ id: `h${i}`, name: `Style ${i}`, category: 'Hair', price: 100, duration_minutes: 30 }))
  const split = SF.servicesFormData(many, [], { intro: 'Tick', button: 'Continue' })
  assert.deepEqual([split.g0_label, split.g1_label, split.g2_label], ['Hair', 'Hair (2)', 'Hair (3)'])
  assert.deepEqual([split.g0_items.length, split.g1_items.length, split.g2_items.length], [20, 20, 5])

  const groups = Array.from({ length: 11 }, (_, i) => ({ id: `c${i}`, name: `S${i}`, category: `Cat ${i}`, price: 1, duration_minutes: 30 }))
  assert.equal(SF.servicesFormData(groups, [], { intro: 'x', button: 'y' }), null)
})

test('Ticks read back: known services only, in order, no repeats', () => {
  assert.deepEqual(SF.tickedServices({ g0: ['b', 'zz'], g1: ['a', 'b'], flow_token: 'bk:x' }, [{ id: 'a' }, { id: 'b' }]), ['b', 'a'])
  assert.deepEqual(SF.tickedServices(null, [{ id: 'a' }]), [])
  assert.equal(SF.sessionFromToken('bk:00000000-0000-4000-8000-000000000001'), '00000000-0000-4000-8000-000000000001')
  assert.equal(SF.sessionFromToken('order_123'), null)
})

test('Publishing: created, filled and published on Meta once; a refusal is remembered and the list is used', async () => {
  const db = seed({ form: null })
  const calls = []
  const ok = async (url, init) => {
    calls.push(`${init?.method || 'GET'} ${url.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+\//, '')}`)
    if (url.endsWith('/999/flows')) return new Response(JSON.stringify({ id: '777' }))
    return new Response(JSON.stringify({ success: true }))
  }
  assert.deepEqual(await SF.ensureServicesForm(db, organization, { fetcher: ok, now: NOW }), { id: '777' })
  assert.deepEqual(calls, ['POST 999/flows', 'POST 777/assets', 'POST 777/publish'])
  const saved = db.tables.salon_settings[0].services_form
  assert.equal(saved.ready, true)
  assert.equal(saved.version, SF.FORM_VERSION)
  assert.deepEqual(await SF.ensureServicesForm(db, organization, { fetcher: ok, now: NOW }), { id: '777' })
  assert.equal(calls.length, 3, 'not published twice')

  const db2 = seed({ form: null })
  const refuse = async () => new Response(JSON.stringify({ error: { message: 'Flows are not allowed' } }), { status: 400 })
  const first = await SF.ensureServicesForm(db2, organization, { fetcher: refuse, now: NOW })
  assert.match(first.problem, /did not accept the tick-box form: Flows are not allowed/)
  let tried = 0
  const counting = async (...args) => { tried++; return refuse(...args) }
  await SF.ensureServicesForm(db2, organization, { fetcher: counting, now: NOW + 60_000 })
  assert.equal(tried, 0, 'waits before trying again')
  await SF.ensureServicesForm(db2, organization, { fetcher: counting, now: NOW + 60_000, force: true })
  assert.equal(tried, 1, 'Save tries again straight away')

  const twilio = await SF.ensureServicesForm(db2, { ...organization, whatsapp_provider: 'twilio' })
  assert.match(twilio.problem, /Meta/)
})

test('Booking with the form: tick several, then the next step with what they picked', async () => {
  const db = seed()
  const wa = whatsapp()
  try {
    assert.deepEqual(await F.startBookingFlow(input(db)), { handled: true, step: 'form' })
    const opened = wa.sent[0]
    assert.equal(opened.interactive.type, 'flow')
    const params = opened.interactive.action.parameters
    assert.equal(params.flow_id, '555')
    assert.equal(params.flow_cta, 'Choose services')
    assert.equal(params.flow_action_payload.screen, 'SERVICES')
    assert.equal(params.flow_action_payload.data.g0_label, 'Skin')
    assert.deepEqual(params.flow_action_payload.data.g1_items.map((i) => i.title), ['Haircut', 'Hair spa'])
    assert.match(opened.interactive.body.text, /Reply LIST/)
    const session = db.tables.salon_booking_sessions[0]
    assert.equal(session.waiting, 'form')
    assert.equal(params.flow_token, `bk:${session.id}`)

    // Nothing ticked: asked again
    assert.deepEqual(await F.handleServicesForm(input(db, { token: params.flow_token, response: { g0: [], g1: [] } })), { handled: true, step: 'form' })
    assert.match(wa.sent[1].interactive.body.text, /^Please tick at least one service/)

    // Two ticked: who, with what they picked first
    assert.deepEqual(await F.handleServicesForm(input(db, { token: params.flow_token, response: { g0: [svc(3)], g1: [svc(1)] } })), { handled: true, step: 'people' })
    const who = wa.sent[2]
    assert.match(who.interactive.body.text, /^You picked: Gold facial, Haircut · ₹2,100, about 105 min\./)
    assert.deepEqual(db.tables.salon_booking_sessions[0].service_ids, [svc(3), svc(1)])
    assert.equal(db.tables.salon_booking_sessions[0].waiting, null)

    // The same form sent again after moving on: "here is where you are"
    await F.handleServicesForm(input(db, { token: params.flow_token, response: { g0: [svc(2)] } }))
    assert.match(wa.sent[3].interactive.body.text, /^That list is from an earlier step/)
    assert.deepEqual(db.tables.salon_booking_sessions[0].service_ids, [svc(3), svc(1)])
  } finally {
    wa.restore()
  }
})

test('Form: "LIST" sends the list instead; other words go to the assistant; the list is used when the form cannot be', async () => {
  const db = seed()
  const wa = whatsapp()
  try {
    await F.startBookingFlow(input(db))
    const sessionId = await F.waitingForAnswer(db, ORG, '+919876543210', NOW)
    assert.ok(sessionId)
    assert.deepEqual(await F.handleBookingText(input(db, { sessionId, message: 'what time do you close?' })), { handled: false, reason: 'not_waiting' })
    assert.deepEqual(await F.handleBookingText(input(db, { sessionId, message: 'List' })), { handled: true, step: 'services' })
    assert.equal(wa.sent.at(-1).interactive.type, 'list')

    // Set to the list, or only one service allowed, or not published: the list
    for (const [flow, form] of [[{ services_style: 'list' }, undefined], [{ multi_select: false }, undefined], [{}, null]]) {
      const other = seed({ flow, ...(form === null ? { form: null } : {}) })
      const result = await F.startBookingFlow(input(other, { organization: form === null ? { ...organization, whatsapp_business_account_id: '' } : organization }))
      assert.equal(result.step, 'started')
      assert.equal(wa.sent.at(-1).interactive.type, 'list')
    }
  } finally {
    wa.restore()
  }
})
