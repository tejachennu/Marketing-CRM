require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const { salonDb } = require('./salon-fake-db.cjs')

const AV = require('../lib/salon/availability.ts')
const C = require('../lib/salon/chat.ts')
const A = require('../lib/salon/actions.ts')
const V = require('../lib/salon/validate.ts')

// Saturday 7 Nov 2026, 10:00 am in India
const NOW = Date.parse('2026-11-07T10:00:00+05:30')
const at = (date, time) => new Date(`${date}T${time}:00+05:30`).toISOString()
const HOURS = { opens_at: '10:00', closes_at: '21:00', closed_weekdays: [0] }

// ── Free times ──────────────────────────────────────────────────────────────

test('Free times: within opening hours, half an hour from now on, none on closed days or in the past', () => {
  const times = AV.freeTimes({ date: '2026-11-07', now: NOW, hours: HOURS, minutes: 60, eligibleStaff: [], busy: [], limit: 100 })
  assert.equal(times[0], '10:30')
  assert.equal(times.at(-1), '20:00')
  assert.equal(times.length, 20)
  assert.deepEqual(AV.freeTimes({ date: '2026-11-08', now: NOW, hours: HOURS, minutes: 60, eligibleStaff: [], busy: [] }), [])
  assert.deepEqual(AV.freeTimes({ date: '2026-11-06', now: NOW, hours: HOURS, minutes: 60, eligibleStaff: [], busy: [] }), [])
  // Near the time asked for, earliest first
  assert.deepEqual(AV.freeTimes({ date: '2026-11-07', now: NOW, hours: HOURS, minutes: 60, eligibleStaff: [], busy: [], around: '17:00', limit: 4 }), ['16:00', '16:30', '17:00', '17:30'])
})

test('Free times: a person is free only when they have nothing then; bookings nobody is on use up someone', () => {
  const busy = [
    { starts_at: at('2026-11-07', '11:00'), ends_at: at('2026-11-07', '12:00'), staff_ids: ['A'] },
    { starts_at: at('2026-11-07', '11:00'), ends_at: at('2026-11-07', '12:00'), staff_ids: [] },
  ]
  const two = AV.freeTimes({ date: '2026-11-07', now: NOW, hours: HOURS, minutes: 60, eligibleStaff: ['A', 'B'], busy, limit: 100 })
  assert.equal(two.includes('11:00'), false)
  assert.equal(two.includes('10:30'), false)
  assert.equal(two.includes('12:00'), true)
  const justA = AV.freeTimes({ date: '2026-11-07', now: NOW, hours: HOURS, minutes: 60, eligibleStaff: ['A', 'B'], staffId: 'A', busy: busy.slice(0, 1), limit: 100 })
  assert.deepEqual(justA.slice(0, 2), ['12:00', '12:30'])
  const justB = AV.freeTimes({ date: '2026-11-07', now: NOW, hours: HOURS, minutes: 60, eligibleStaff: ['A', 'B'], staffId: 'B', busy: busy.slice(0, 1), limit: 100 })
  assert.equal(justB.includes('11:00'), true)
})

test('Free times: a tapped time is checked again; the busy list counts requests but not finished or cancelled visits', () => {
  const busy = AV.busyFrom([
    { starts_at: at('2026-11-07', '17:00'), ends_at: at('2026-11-07', '18:00'), status: 'requested', staff_id: null, services: [{ staff_id: 'A' }] },
    { starts_at: at('2026-11-07', '15:00'), ends_at: at('2026-11-07', '16:00'), status: 'cancelled', staff_id: 'A' },
    { starts_at: at('2026-11-07', '09:00'), ends_at: at('2026-11-07', '10:00'), status: 'completed', staff_id: 'A' },
  ])
  assert.deepEqual(busy, [{ starts_at: at('2026-11-07', '17:00'), ends_at: at('2026-11-07', '18:00'), staff_ids: ['A'] }])
  const base = { date: '2026-11-07', now: NOW, hours: HOURS, minutes: 60, eligibleStaff: ['A'], busy }
  assert.equal(AV.isTimeFree({ ...base, time: '17:00' }), false)
  assert.equal(AV.isTimeFree({ ...base, time: '15:00' }), true)
  assert.equal(AV.isTimeFree({ ...base, time: '09:30', now: NOW }), false)
  // Offered at 10:30 and tapped at 10:15: still fine
  assert.equal(AV.isTimeFree({ ...base, time: '10:30', now: NOW + 15 * 60_000 }), true)
  assert.equal(AV.describeHours(HOURS), 'Open 10:00 am to 9:00 pm, closed on Sunday')
  assert.equal(AV.describeHours({}), 'Open 10:00 am to 9:00 pm, every day')
})

// ── The chat assistant ──────────────────────────────────────────────────────

const ORG = 'c0ffee00-0000-4000-8000-0000000000aa'
const FACIAL = '00000000-0000-4000-8000-0000000000f1'
const MEN = '00000000-0000-4000-8000-0000000000f2'
const WOMEN = '00000000-0000-4000-8000-0000000000f3'
const ANITHA = '00000000-0000-4000-8000-0000000000e1'
const CONTACT = '00000000-0000-4000-8000-0000000000c1'
const organization = { id: ORG, name: 'Glow Salon', slug: 'glow', enabled_connectors: ['salon'], whatsapp_provider: 'facebook', whatsapp_api_token: 'token', whatsapp_phone_number_id: '111' }
const seed = (settings = {}) => salonDb({
  salon_settings: [{ organization_id: ORG, business_name: 'Glow Salon & Spa', address: 'Road No. 12, Banjara Hills', phone: '040 2345 6789', gstin: null, opens_at: '10:00', closes_at: '21:00', closed_weekdays: [0], chat_assistant: true, auto_approve_bookings: false, ...settings }],
  salon_services: [
    { id: FACIAL, organization_id: ORG, name: 'Facial', category: 'Skin', price: 1200, duration_minutes: 60, tax_rate: 18, active: true, position: 1 },
    { id: MEN, organization_id: ORG, name: 'Haircut (Men)', category: 'Hair', price: 300, duration_minutes: 30, tax_rate: 18, active: true, position: 2 },
    { id: WOMEN, organization_id: ORG, name: 'Haircut (Women)', category: 'Hair', price: 600, duration_minutes: 45, tax_rate: 18, active: true, position: 3 },
  ],
  salon_staff: [{ id: ANITHA, organization_id: ORG, name: 'Anitha', service_ids: [], active: true }],
  salon_appointments: [], salon_chat_offers: [], messages: [],
})
const access = { organizationId: ORG, apiKey: 'sk-test', billed: false, allowed: true }

/** OpenAI answers one tool call per round, in order; WhatsApp sends are recorded. */
function harness(db, toolCalls) {
  const requests = []
  let round = 0
  const fetcher = async (url, init) => {
    requests.push(JSON.parse(init.body))
    const call = toolCalls[round++]
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: `c${round}`, type: 'function', function: { name: call[0], arguments: JSON.stringify(call[1]) } }] } }] }), { status: 200 })
  }
  const sent = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes('graph.facebook.com')) return realFetch(url, init)
    sent.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ messages: [{ id: `wamid.${sent.length}` }] }), { status: 200 })
  }
  const input = (message, extra = {}) => ({ supabase: db, organization, contact: { id: CONTACT, first_name: 'Priya', last_name: 'Sharma' }, conversationId: 'conv-1', customerPhone: '+919876543210', ai: access, message, history: [], fetcher, now: NOW, ...extra })
  return { requests, sent, input, restore: () => { globalThis.fetch = realFetch } }
}

test('Chat: the assistant knows the menu, prices, hours and dates, and only talks about the salon', () => {
  const setup = { settings: { business_name: 'Glow Salon & Spa', address: 'Road No. 12', phone: '040 2345 6789', opens_at: '10:00', closes_at: '21:00', closed_weekdays: [0] }, services: [{ id: FACIAL, name: 'Facial', category: 'Skin', price: 1200, duration_minutes: 60, active: true }], staff: [{ id: ANITHA, name: 'Anitha', service_ids: [], active: true }] }
  const prompt = C.chatSystemPrompt(setup, organization, 'Priya', NOW)
  assert.match(prompt, /Glow Salon & Spa/)
  assert.match(prompt, /- Facial: ₹1,200, 60 min/)
  assert.match(prompt, /Open 10:00 am to 9:00 pm, closed on Sunday/)
  assert.match(prompt, /Address: Road No. 12/)
  assert.match(prompt, /Team: Anitha/)
  assert.match(prompt, /"tomorrow" \/ "repu" \/ "kal" = 2026-11-08/)
  assert.match(prompt, /Never invent a service, price, discount, offer or time/)
})

test('Chat: a question gets a reply on WhatsApp, logged in the conversation', async () => {
  const db = seed()
  const h = harness(db, [['reply_to_customer', { message: 'Facial ₹1,200 andi, 60 minutes padutundi.' }]])
  try {
    const result = await C.runSalonAssistant(h.input('facial entha?'))
    assert.deepEqual(result, { handled: true, action: 'replied' })
    assert.equal(h.sent[0].text.body, 'Facial ₹1,200 andi, 60 minutes padutundi.')
    assert.equal(h.sent[0].to, '919876543210')
    assert.equal(db.tables.messages[0].body, 'Facial ₹1,200 andi, 60 minutes padutundi.')
    assert.equal(h.requests[0].tool_choice, 'required')
    assert.match(h.requests[0].messages[0].content, /Facial: ₹1,200/)
  } finally { h.restore() }
})

test('Chat: a booking sends the free times as a list to tap; one tap makes a request for the counter', async () => {
  const db = seed()
  const h = harness(db, [['offer_times', { services: ['facial'], date: '2026-11-07', around: '17:00', staff_name: null, language: 'te' }]])
  try {
    const result = await C.runSalonAssistant(h.input('ivala saayantram 5 ki facial book cheyyandi'))
    assert.deepEqual(result, { handled: true, action: 'offered_times' })
    const list = h.sent[0].interactive
    assert.equal(list.type, 'list')
    assert.equal(list.action.button, 'Choose a time')
    assert.match(list.body.text, /Today Facial ki free times ivi andi/)
    const rows = list.action.sections[0].rows
    assert.equal(rows.length, 10)
    assert.ok(rows.some((row) => row.title === '5:00 pm'))
    const offer = db.tables.salon_chat_offers[0]
    assert.deepEqual([offer.service_ids, offer.date, offer.language, offer.customer_name], [[FACIAL], '2026-11-07', 'te', 'Priya Sharma'])
    const five = rows.find((row) => row.title === '5:00 pm')
    assert.equal(five.id, `sb:${offer.id}:1700`)

    // The customer taps 5:00 pm
    const picked = await C.handleSlotPick({ ...h.input('5:00 pm'), buttonId: five.id })
    assert.deepEqual(picked, { handled: true, action: 'requested' })
    const appointment = db.tables.salon_appointments[0]
    assert.deepEqual([appointment.status, appointment.source, appointment.customer_name, appointment.starts_at, appointment.ends_at], ['requested', 'chat', 'Priya Sharma', at('2026-11-07', '17:00'), at('2026-11-07', '18:00')])
    assert.equal(appointment.services[0].name, 'Facial')
    assert.match(h.sent.at(-1).text.body, /Today 5:00 pm ki Facial request vachindi/)
    assert.equal(db.tables.salon_chat_offers.length, 0)

    // Tapping the old list again books nothing more
    const again = await C.handleSlotPick({ ...h.input('5:00 pm'), buttonId: five.id })
    assert.deepEqual(again, { handled: true, action: 'expired' })
    assert.equal(db.tables.salon_appointments.length, 1)
  } finally { h.restore() }
})

test('Chat: with automatic approval a free slot is confirmed straight away', async () => {
  const db = seed({ auto_approve_bookings: true })
  const h = harness(db, [['offer_times', { services: ['Haircut (Women)'], date: '2026-11-09', around: null, staff_name: 'anitha', language: 'en' }]])
  try {
    await C.runSalonAssistant(h.input('book a haircut for women on monday with anitha'))
    const row = h.sent[0].interactive.action.sections[0].rows[0]
    assert.equal(row.title, '10:00 am')
    const picked = await C.handleSlotPick({ ...h.input('10:00 am'), buttonId: row.id })
    assert.deepEqual(picked, { handled: true, action: 'booked' })
    const appointment = db.tables.salon_appointments[0]
    assert.deepEqual([appointment.status, appointment.staff_id, appointment.services[0].staff_name], ['booked', ANITHA, 'Anitha'])
    assert.equal(h.sent.at(-1).text.body, 'Confirmed! Haircut (Women) with Anitha at Glow Salon & Spa, Mon, 9 Nov at 10:00 am. See you soon! ✨')
  } finally { h.restore() }
})

test('Chat: a time taken meanwhile offers the others; a tap from another number is refused', async () => {
  const db = seed()
  const h = harness(db, [['offer_times', { services: ['facial'], date: '2026-11-07', around: '17:00', staff_name: null, language: 'en' }]])
  try {
    await C.runSalonAssistant(h.input('facial today at 5'))
    const five = h.sent[0].interactive.action.sections[0].rows.find((row) => row.title === '5:00 pm')
    // Someone books Anitha (the only person) at 5 at the counter
    db.tables.salon_appointments.push({ id: 'x', organization_id: ORG, starts_at: at('2026-11-07', '17:00'), ends_at: at('2026-11-07', '18:00'), status: 'booked', staff_id: ANITHA, services: [] })
    const taken = await C.handleSlotPick({ ...h.input('5:00 pm'), buttonId: five.id })
    assert.deepEqual(taken, { handled: true, action: 'taken' })
    assert.match(h.sent.at(-1).interactive.body.text, /Sorry, 5:00 pm was just taken/)
    assert.equal(h.sent.at(-1).interactive.action.sections[0].rows.some((row) => row.title === '5:00 pm'), false)
    const stranger = await C.handleSlotPick({ ...h.input('5:30 pm', { customerPhone: '+919000000000' }), buttonId: five.id.replace('1700', '1730') })
    assert.deepEqual(stranger, { handled: true, action: 'expired' })
    assert.equal(db.tables.salon_appointments.length, 1)
  } finally { h.restore() }
})

test('Chat: unclear or unknown services are asked about, not guessed; closed days point to the next open day', async () => {
  const db = seed()
  const h = harness(db, [
    ['offer_times', { services: ['haircut'], date: '2026-11-07', around: null, staff_name: null, language: 'en' }],
    ['offer_times', { services: ['facial'], date: '2026-11-08', around: null, staff_name: null, language: 'en' }],
    ['reply_to_customer', { message: 'Which haircut, men or women? We are closed on Sunday; Monday is free.' }],
  ])
  try {
    const result = await C.runSalonAssistant(h.input('haircut today, or facial sunday'))
    assert.deepEqual(result, { handled: true, action: 'replied' })
    const toolNotes = h.requests.at(-1).messages.filter((m) => m.role === 'tool').map((m) => m.content)
    assert.match(toolNotes[0], /could be Haircut \(Men\) or Haircut \(Women\)/)
    assert.match(toolNotes[1], /No free time on 2026-11-08\. The next day with free times is 2026-11-09/)
    assert.equal(db.tables.salon_chat_offers.length, 0)
  } finally { h.restore() }
})

test('Chat: other topics pass to the next assistant; switched off or not set up, it stays out', async () => {
  const db = seed()
  const h = harness(db, [['not_for_salon', { reason: 'order status' }]])
  try {
    assert.deepEqual(await C.runSalonAssistant(h.input('where is my order?')), { handled: false, reason: 'order status' })
    assert.equal(h.sent.length, 0)
    assert.deepEqual(await C.runSalonAssistant({ ...h.input('hi'), ai: null }), { handled: false, reason: 'ai_unavailable' })
    assert.deepEqual(await C.runSalonAssistant({ ...h.input('hi'), organization: { ...organization, enabled_connectors: [] } }), { handled: false, reason: 'not_ready' })
    assert.deepEqual(await C.runSalonAssistant({ ...h.input('hi'), organization: { ...organization, whatsapp_provider: 'twilio' } }), { handled: false, reason: 'not_ready' })
    const off = seed({ chat_assistant: false })
    assert.deepEqual(await C.runSalonAssistant({ ...h.input('hi'), supabase: off }), { handled: false, reason: 'switched_off' })
  } finally { h.restore() }
})

test('Chat: slot buttons are recognised exactly', () => {
  assert.deepEqual(C.parseSlotButton('sb:00000000-0000-4000-8000-000000000001:1730'), { offerId: '00000000-0000-4000-8000-000000000001', time: '17:30' })
  for (const bad of ['sb:abc:1730', 'sf:00000000-0000-4000-8000-000000000001:5', 'sb:00000000-0000-4000-8000-000000000001:17', null]) assert.equal(C.parseSlotButton(bad), null)
})

// ── The counter approves or declines ─────────────────────────────────────────

test('Counter: a chat request is approved (or moved) with a WhatsApp confirmation, or declined with a message', async () => {
  const db = seed()
  db.tables.salon_appointments.push(
    { id: '00000000-0000-4000-8000-00000000aa01', organization_id: ORG, customer_name: 'Priya Sharma', customer_phone: '+919876543210', starts_at: at('2026-11-08', '17:00'), ends_at: at('2026-11-08', '18:00'), status: 'requested', services: [{ name: 'Facial', staff_name: 'Anitha' }], source: 'chat' },
    { id: '00000000-0000-4000-8000-00000000aa02', organization_id: ORG, customer_name: 'Meena', customer_phone: '+919876500003', starts_at: at('2026-11-09', '11:00'), ends_at: at('2026-11-09', '11:45'), status: 'requested', services: [{ name: 'Haircut (Women)' }], source: 'chat' },
  )
  const calls = []
  const send = { invoice: async () => null, booking: async (appointment, staff) => { calls.push(['booking', appointment.starts_at, staff]); return { sent: true } }, text: async (phone, body) => { calls.push(['text', phone, body]); return { sent: true } } }
  const ctx = { db, organizationId: ORG, user: { id: 'u' }, organization: { id: ORG }, settings: {} }

  const moved = A.parseCounterAction({ type: 'approve_request', appointment_id: '00000000-0000-4000-8000-00000000aa01', starts_at: '2099-11-08T13:00:00.000Z' })
  const approved = await A.executeCounterAction(ctx, moved.action, send)
  assert.equal(approved.appointment.status, 'booked')
  assert.equal(approved.appointment.starts_at, '2099-11-08T13:00:00.000Z')
  assert.equal(approved.appointment.ends_at, '2099-11-08T14:00:00.000Z')
  assert.deepEqual(calls[0], ['booking', '2099-11-08T13:00:00.000Z', 'Anitha'])

  const declined = await A.executeCounterAction(ctx, A.parseCounterAction({ type: 'decline_request', appointment_id: '00000000-0000-4000-8000-00000000aa02' }).action, send)
  assert.equal(declined.appointment.status, 'cancelled')
  assert.equal(calls[1][0], 'text')
  assert.match(calls[1][2], /Sorry, we cannot take Mon, 9 Nov 11:00 am for Haircut \(Women\)\. Reply here with another day or time/)

  await assert.rejects(A.executeCounterAction(ctx, { type: 'approve_request', appointment_id: '00000000-0000-4000-8000-00000000aa01' }, send), /already handled/)
  assert.match(A.parseCounterAction({ type: 'approve_request', appointment_id: 'x' }).error, /booking request/)
  assert.match(A.parseCounterAction({ type: 'approve_request', appointment_id: '00000000-0000-4000-8000-00000000aa01', starts_at: '2020-01-01T00:00:00Z' }).error, /already passed/)
})

// ── Settings ────────────────────────────────────────────────────────────────

test('Settings: WhatsApp settings are checked, and only the ones sent are changed', () => {
  assert.deepEqual(V.parseWhatsAppSettings({ chat_assistant: false }).value, { chat_assistant: false })
  const full = V.parseWhatsAppSettings({ opens_at: '09:30', closes_at: '20:00', closed_weekdays: [0, 0, 2, 9], auto_approve_bookings: true, feedback_delay_minutes: 999, review_link: ' https://g.page/r/abc/review ' }).value
  assert.deepEqual(full, { opens_at: '09:30', closes_at: '20:00', closed_weekdays: [0, 2], auto_approve_bookings: true, feedback_delay_minutes: 120, review_link: 'https://g.page/r/abc/review' })
  assert.match(V.parseWhatsAppSettings({ opens_at: '21:00', closes_at: '10:00' }).error, /after opening/)
  assert.match(V.parseWhatsAppSettings({ closed_weekdays: [0, 1, 2, 3, 4, 5, 6] }).error, /every day/)
  assert.match(V.parseWhatsAppSettings({ review_link: 'http://x.com' }).error, /https/)
  // The business details form leaves the WhatsApp settings alone
  const business = V.parseSettings({ business_name: 'Glow' }).value
  assert.equal('chat_assistant' in business, false)
  assert.equal('opens_at' in business, false)
})

test('Staff: commission is a percentage from 0 to 100', () => {
  assert.equal(V.parseStaff({ name: 'Anitha', commission_percent: '25' }).value.commission_percent, 25)
  assert.equal(V.parseStaff({ name: 'Anitha' }).value.commission_percent, undefined)
  assert.match(V.parseStaff({ name: 'Anitha', commission_percent: 120 }).error, /0 to 100/)
})
