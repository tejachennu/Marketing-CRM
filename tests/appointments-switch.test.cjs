require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { salonDb } = require('./salon-fake-db.cjs')

const S = require('../lib/salon/appointments-switch.ts')
const SET = require('../lib/salon/appointments-setting.ts')
const W = require('../lib/salon/website.ts')
const BP = require('../lib/salon/booking-page.ts')
const A = require('../lib/salon/actions.ts')
const J = require('../lib/salon/jobs.ts')
const F = require('../lib/salon/booking-flow.ts')
const C = require('../lib/salon/chat.ts')
const SA = require('../lib/ai/site-assistant.ts')
const N = require('../lib/connector-nav.ts')
const FD = require('../lib/front-desk-nav.ts')
const SP = require('../lib/public-api/spec.ts')
const { MESSAGE_PURPOSES } = require('../lib/salon/message-templates.ts')

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')
const ORG = '11111111-1111-4111-8111-111111111111'
const CUT = '22222222-2222-4222-8222-222222222222'
const ANU = '44444444-4444-4444-8444-444444444444'
// Thursday 12 Nov 2026, 9 am in India
const NOW = Date.parse('2026-11-12T03:30:00Z')
const iso = (ms) => new Date(ms).toISOString()

const seed = (settings = {}, extra = {}) => salonDb({
  organizations: [{ id: ORG, name: 'Glow', slug: 'glow-ab12', enabled_connectors: ['salon'], whatsapp_provider: 'facebook', whatsapp_api_token: 't', whatsapp_phone_number_id: '111' }],
  salon_settings: [{ organization_id: ORG, business_name: 'Glow Salon', opens_at: '10:00', closes_at: '20:00', closed_weekdays: [], phone: '+91 98480 12345', reminders_enabled: true, feedback_enabled: false, booking_flow: { enabled: true }, ...settings }],
  salon_services: [{ id: CUT, organization_id: ORG, name: 'Haircut', category: 'Hair', price: 300, duration_minutes: 30, tax_rate: 18, active: true, position: 1 }],
  salon_staff: [{ id: ANU, organization_id: ORG, name: 'Anu', active: true, service_ids: [] }],
  salon_appointments: [], salon_chat_offers: [], salon_booking_sessions: [], salon_invoices: [], contacts: [], conversations: [], messages: [],
  ...extra,
})

/** WhatsApp sends are recorded (Meta answers OK). */
function whatsapp() {
  const sent = []
  const real = globalThis.fetch
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ messages: [{ id: `wamid.${sent.length}` }] }), { status: 200 }) }
  return { sent, restore: () => { globalThis.fetch = real } }
}

// ── The setting ─────────────────────────────────────────────────────────────

test('Appointments switch: on by default, off only when saved off', () => {
  assert.equal(S.takesAppointments(undefined), true)
  assert.equal(S.takesAppointments(null), true)
  assert.equal(S.takesAppointments({}), true, 'older workspaces (no column yet) keep taking appointments')
  assert.equal(S.takesAppointments({ takes_appointments: true }), true)
  assert.equal(S.takesAppointments({ takes_appointments: null }), true)
  assert.equal(S.takesAppointments({ takes_appointments: false }), false)
  const { DEFAULT_SALON_SETTINGS } = require('../lib/salon/server.ts')
  assert.equal(DEFAULT_SALON_SETTINGS.takes_appointments, true)
})

test('Appointments switch: what is hidden when off (tabs, booking messages), and what stays', () => {
  assert.deepEqual(S.frontDeskTabsFor(FD.FRONT_DESK_TABS, true), FD.FRONT_DESK_TABS)
  assert.deepEqual(S.frontDeskTabsFor(FD.FRONT_DESK_TABS, false), ['counter', 'invoices', 'members', 'reviews', 'team', 'setup'])
  assert.deepEqual(S.messagePurposesFor(MESSAGE_PURPOSES, true), ['bill', 'booking', 'reminder', 'feedback'])
  assert.deepEqual(S.messagePurposesFor(MESSAGE_PURPOSES, false), ['bill', 'feedback'])
  assert.ok(S.HIDDEN_WHEN_OFF.some((line) => /reminders/i.test(line)))
  assert.ok(S.HIDDEN_WHEN_OFF.some((line) => /booking page/i.test(line)))
  assert.match(S.KEPT_WHEN_OFF, /Walk-in bills, invoices, reviews, memberships, team/)
  assert.match(S.KEPT_WHEN_OFF, /Bookings already made are kept/)
})

test('Appointments switch: the WhatsApp words, in the customer\'s language', () => {
  assert.equal(S.noBookingsReply('en', 'Glow Salon', '+91 98480 12345'), 'Sorry, Glow Salon is not taking appointments right now. Just walk in during our opening hours, or call us on +91 98480 12345. 🙏')
  assert.equal(S.noBookingsReply('en', '', null), 'Sorry, we are not taking appointments right now. Just walk in during our opening hours. 🙏')
  assert.match(S.noBookingsReply('te', 'Glow'), /appointments teeskovatledu/)
  assert.match(S.noBookingsReply('hi', 'Glow', '040 1234'), /040 1234 par call kijiye/)
  assert.match(S.assistantBookingRule(true, '2026-11-12', '2026-11-13'), /call offer_times/)
  assert.match(S.assistantBookingRule(false, '2026-11-12', '2026-11-13'), /does not take appointments/)
  assert.doesNotMatch(S.assistantBookingRule(false, '2026-11-12', '2026-11-13'), /offer_times/)
})

test('Appointments switch: the column is added by itself (lock 724519040), word for word as the migration', () => {
  assert.equal(SET.APPOINTMENTS_LOCK, 724519040)
  assert.equal(read('supabase/migrations/20261213_front_desk_take_appointments.sql'), SET.APPOINTMENTS_SQL)
  assert.match(SET.APPOINTMENTS_SQL, /ADD COLUMN IF NOT EXISTS takes_appointments BOOLEAN NOT NULL DEFAULT TRUE/)
})

test('Appointments switch: a missing column is added once, then the save is tried again', async () => {
  let tries = 0
  let ensured = 0
  const result = await SET.withAppointmentsSchema(async () => (++tries === 1 ? { error: { code: 'PGRST204', message: "Could not find the 'takes_appointments' column of 'salon_settings'" } } : { data: { ok: true }, error: null }), { ensure: async () => { ensured++; return true } })
  assert.deepEqual(result.data, { ok: true })
  assert.equal(ensured, 1)
  assert.equal(tries, 2)
})

// ── Website buttons ─────────────────────────────────────────────────────────

const reachAll = { bookings: true, store: true, phone: true, address: true }

test('Website buttons: all on by default (existing sites unchanged), each can be switched off', () => {
  assert.deepEqual(W.readSite(null).buttons, { call: true, whatsapp: true, book: true, shop: true, directions: true })
  assert.deepEqual(W.readSite({ buttons: 'nonsense' }).buttons, W.DEFAULT_BUTTONS)
  assert.deepEqual(W.readSite({ buttons: { call: false, shop: false, extra: false } }).buttons, { call: false, whatsapp: true, book: true, shop: false, directions: true })
  assert.deepEqual(W.SITE_BUTTONS.map((b) => b.label), ['Call', 'WhatsApp', 'Book now', 'Shop online', 'Directions and map'])
  assert.deepEqual(W.siteButtons(W.readSite(null), reachAll), { call: true, whatsapp: true, book: true, shop: true, directions: true })
})

test('Website buttons: Book now goes when appointments are off, even if switched on; others need the store, a phone, an address', () => {
  const site = W.readSite(null)
  assert.equal(W.siteButtons(site, { ...reachAll, bookings: false }).book, false)
  assert.match(W.buttonBlocker('book', { ...reachAll, bookings: false }), /Appointments are off/)
  assert.equal(W.siteButtons(site, { ...reachAll, store: false }).shop, false)
  const noPhone = W.siteButtons(site, { ...reachAll, phone: false })
  assert.deepEqual([noPhone.call, noPhone.whatsapp], [false, false])
  assert.match(W.buttonBlocker('call', { ...reachAll, phone: false }), /phone number/)
  assert.equal(W.siteButtons(site, { ...reachAll, address: false }).directions, false)
  assert.equal(W.buttonBlocker('whatsapp', reachAll), null)
  assert.equal(W.siteButtons(W.readSite({ buttons: { whatsapp: false } }), reachAll).whatsapp, false)
})

test('Website buttons: the phone bar has Call, WhatsApp and Book now (else Shop online); none when all are off', () => {
  const all = W.siteButtons(W.readSite(null), reachAll)
  assert.deepEqual(W.phoneBar(all), { small: ['call', 'whatsapp'], main: 'book' })
  assert.deepEqual(W.phoneBar({ ...all, book: false }), { small: ['call', 'whatsapp'], main: 'shop' })
  assert.deepEqual(W.phoneBar({ ...all, call: false, book: false, shop: false }), { small: ['whatsapp'], main: null })
  assert.deepEqual(W.phoneBar({ call: false, whatsapp: false, book: false, shop: false, directions: true }), { small: [], main: null })
})

test('Website page: every placement follows the switches; no bar when it would be empty', () => {
  const page = read('components/salon-site/business-site.tsx')
  assert.match(page, /siteButtons\(site, \{ bookings: view\.bookings !== false/)
  assert.match(page, /\{showBar && \(/)
  assert.match(page, /\{cta\.book && <section aria-labelledby="book-title">/)
  assert.match(page, /bookable=\{cta\.book\}/)
  assert.doesNotMatch(page, /storeLink && <li>/, 'Shop online goes through its switch')
  const menu = read('components/salon-site/services-menu.tsx')
  assert.match(menu, /\{bookable && <BookButton/)
  const settings = read('components/salon/salon-website.tsx')
  assert.match(settings, /Buttons on your website/)
  assert.match(settings, /key !== 'shop' \|\| meta\.storeOn/)
})

// ── Booking page and its API ────────────────────────────────────────────────

test('Booking page: open with appointments on; with them off it still loads (for the website) but takes nothing', async () => {
  const on = await BP.loadBookingPage(seed(), 'glow-ab12')
  assert.equal(on.bookings, true)
  assert.equal(BP.publicView(on).bookings, true)

  const db = seed({ takes_appointments: false })
  const page = await BP.loadBookingPage(db, 'glow-ab12')
  assert.ok(page, 'the website uses the same data, so the page still loads')
  assert.equal(page.bookings, false)
  assert.equal(BP.takesBookings(page), false)
  assert.equal(BP.publicView(page).bookings, false)
  assert.equal(BP.publicView(page).phone, '+91 98480 12345', 'Call / WhatsApp instead')

  const times = await BP.bookingTimes(db, page, { serviceIds: [CUT], staffId: null, date: '2026-11-12' }, NOW)
  assert.equal(times.error, S.NOT_TAKING_BOOKINGS)
  const input = BP.parseOnlineBooking({ service_ids: [CUT], date: '2026-11-12', time: '11:00', name: 'Priya Rao', phone: '+91 90000 11111' })
  const result = await BP.createOnlineBooking(db, page, input, NOW)
  assert.equal(result.closed, true)
  assert.equal(result.error, S.NOT_TAKING_BOOKINGS)
  assert.equal(db.tables.salon_appointments.length, 0, 'nothing saved')
  assert.equal(db.tables.contacts.length, 0)
})

test('Booking API: refuses new bookings and free times (403) while appointments are off', () => {
  const route = read('app/api/public/booking/[slug]/route.ts')
  assert.match(route, /if \(!takesBookings\(page\)\) return NextResponse\.json\(\{ error: NOT_TAKING_BOOKINGS, code: 'not_taking_bookings'/)
  assert.match(route, /status: 403/)
  const times = read('app/api/public/booking/[slug]/times/route.ts')
  assert.match(times, /if \(!takesBookings\(page\)\) return NextResponse\.json\(\{ error: NOT_TAKING_BOOKINGS, code: 'not_taking_bookings' \}, \{ status: 403 \}\)/)
  const wizard = read('app/b/[slug]/booking-wizard.tsx')
  assert.match(wizard, /props\.page\.bookings === false \? <NoBookings/)
  assert.match(wizard, /is not taking online bookings/)
})

// ── Counter, reminders, public API ──────────────────────────────────────────

test('Counter: no new booking while appointments are off; walk-in bills still work', async () => {
  const db = seed()
  const ctx = (settings) => ({ db, organizationId: ORG, user: { id: 'u1' }, organization: { id: ORG }, settings: { business_name: 'Glow', ...settings } })
  const book = A.parseCounterAction({ type: 'create_appointment', customer: { name: 'Priya', phone: '+919876543210' }, service_ids: [CUT], staff_id: ANU, starts_at: iso(Date.now() + 86_400_000), send_whatsapp: false }).action
  await assert.rejects(A.executeCounterAction(ctx({ takes_appointments: false }), book), new RegExp(S.APPOINTMENTS_OFF_MESSAGE.slice(0, 40)))
  assert.equal(db.tables.salon_appointments.length, 0)
  const bill = await A.executeCounterAction(ctx({ takes_appointments: false }), A.parseCounterAction({ type: 'walk_in_bill', customer: { name: 'Kiran' }, service_ids: [CUT], payment_method: 'cash', send_whatsapp: false }).action)
  assert.equal(bill.invoice.status, 'paid')
  const booked = await A.executeCounterAction(ctx({}), book)
  assert.equal(booked.appointment.status, 'booked', 'with appointments on, booking works as before')
})

test('Reminders: none while appointments are off; bookings already made are left as they are', async () => {
  const appointment = { id: 'a1', organization_id: ORG, customer_name: 'Meena Reddy', customer_phone: '+919876500003', status: 'booked', starts_at: iso(NOW + 120 * 60_000), ends_at: iso(NOW + 165 * 60_000), services: [{ name: 'Haircut' }], reminder_sent_at: null }
  const off = seed({ takes_appointments: false }, { salon_appointments: [appointment] })
  const wa = whatsapp()
  try {
    assert.deepEqual(await J.runSalonJobs(off, ORG, { now: NOW }), { feedbackSent: 0, feedbackSkipped: 0, remindersSent: 0 })
    assert.equal(wa.sent.length, 0)
    assert.equal(off.tables.salon_appointments[0].reminder_sent_at, null)
    assert.equal(off.tables.salon_appointments[0].status, 'booked')
    const on = seed({}, { salon_appointments: [appointment] })
    assert.equal((await J.runSalonJobs(on, ORG, { now: NOW })).remindersSent, 1)
  } finally { wa.restore() }
})

test('Public API: creating an appointment answers appointments_off (documented); reading still works', () => {
  const route = read('app/api/v1/appointments/route.ts')
  assert.match(route, /apiError\(409, APPOINTMENTS_OFF_CODE/)
  assert.equal(S.APPOINTMENTS_OFF_CODE, 'appointments_off')
  assert.ok(SP.ERROR_CODES.some((e) => e.code === 'appointments_off' && e.status === 409))
  assert.match(read('lib/public-api/spec.ts'), /errors: \['slot_taken', 'appointments_off', 'invalid_request'\]/)
  // GET is unchanged: no appointments check before the list
  const get = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function POST'))
  assert.doesNotMatch(get, /takesAppointments/)
})

test('Settings: only owners and admins switch appointments; the column is added on the first save', () => {
  const route = read('app/api/salon/settings/route.ts')
  assert.match(route, /if \(switching && !can\(access\.ctx\.user, 'settings\.manage'\)\) return NextResponse\.json\(\{ error: APPOINTMENTS_ADMIN_ONLY \}, \{ status: 403 \}\)/)
  assert.match(route, /withSalonSchema\(\(\) => \(switching \? withAppointmentsSchema\(save\) : save\(\)\)\)/)
  // The business details form never writes it (it is not one of its fields)
  const V = require('../lib/salon/validate.ts')
  assert.equal('takes_appointments' in V.parseWhatsAppSettings({ takes_appointments: false }).value, false)
  const me = read('app/api/mobile/me/route.ts')
  assert.match(me, /frontDesk: \{ appointments: takesAppointments\(deskSettings\) \}/)
})

// ── WhatsApp ────────────────────────────────────────────────────────────────

const organization = { id: ORG, name: 'Glow', slug: 'glow-ab12', enabled_connectors: ['salon'], whatsapp_provider: 'facebook', whatsapp_api_token: 't', whatsapp_phone_number_id: '111' }
const chatInput = (db, extra = {}) => ({ supabase: db, organization, contact: { id: 'k1', first_name: 'Priya' }, conversationId: 'cv1', customerPhone: '+919876543210', message: 'Book', history: [], now: NOW, ...extra })

test('WhatsApp: "Book" does not start the booking flow while appointments are off (the assistant answers instead)', async () => {
  const wa = whatsapp()
  try {
    const off = seed({ takes_appointments: false })
    assert.deepEqual(await F.startBookingFlow(chatInput(off)), { handled: false, reason: 'appointments_off' })
    assert.deepEqual(await F.startStatelessFlow(chatInput(off)), { handled: false, reason: 'appointments_off' })
    assert.equal(off.tables.salon_booking_sessions.length, 0)
    assert.equal(wa.sent.length, 0)
    const on = seed()
    assert.equal((await F.startBookingFlow(chatInput(on))).handled, true, 'with appointments on, the flow starts as before')
  } finally { wa.restore() }
})

test('WhatsApp: a tap on an old booking list or times list gets a kind "no appointments", and nothing is booked', async () => {
  const wa = whatsapp()
  try {
    const db = seed({ takes_appointments: false }, {
      salon_booking_sessions: [{ id: '00000000-0000-4000-8000-0000000000a1', organization_id: ORG, customer_phone: '+919876543210', step: 0, service_ids: [], answers: [], updated_at: iso(NOW - 60_000) }],
      salon_chat_offers: [{ id: '00000000-0000-4000-8000-0000000000b1', organization_id: ORG, customer_phone: '+919876543210', service_ids: [CUT], date: '2026-11-12', language: 'en', created_at: iso(NOW - 60_000) }],
    })
    const tap = await F.handleBookingStepButton(chatInput(db, { buttonId: `bs:${F.packId('00000000-0000-4000-8000-0000000000a1')}:0:s:${F.packId(CUT)}` }))
    assert.deepEqual(tap, { handled: true, step: 'closed' })
    assert.equal(db.tables.salon_booking_sessions.length, 0, 'the booking in progress is dropped')
    const slot = await C.handleSlotPick(chatInput(db, { buttonId: 'sb:00000000-0000-4000-8000-0000000000b1:1100' }))
    assert.deepEqual(slot, { handled: true, action: 'not_taking' })
    assert.equal(db.tables.salon_appointments.length, 0)
    assert.equal(db.tables.salon_chat_offers.length, 0)
    assert.match(wa.sent[0].text.body, /not taking appointments/)
    assert.match(wa.sent[1].text.body, /Glow Salon is not taking appointments right now/)
  } finally { wa.restore() }
})

test('WhatsApp assistant: never offers times while appointments are off', async () => {
  const setup = { settings: { business_name: 'Glow Salon', takes_appointments: false, opens_at: '10:00', closes_at: '20:00', closed_weekdays: [] }, services: [{ id: CUT, name: 'Haircut', category: 'Hair', price: 300, duration_minutes: 30, active: true }], staff: [] }
  const prompt = C.chatSystemPrompt(setup, organization, 'Priya', NOW)
  assert.match(prompt, /does not take appointments/)
  assert.doesNotMatch(prompt, /offer_times/)
  assert.match(C.chatSystemPrompt({ ...setup, settings: { ...setup.settings, takes_appointments: true } }, organization, 'Priya', NOW), /call offer_times/)

  const db = seed({ takes_appointments: false, chat_assistant: true })
  const requests = []
  const calls = [['offer_times', { services: ['Haircut'], date: '2026-11-12', around: null, staff_name: null, language: 'en' }], ['reply_to_customer', { message: 'We do not take appointments. Just walk in!' }]]
  let round = 0
  const fetcher = async (url, init) => {
    requests.push(JSON.parse(init.body))
    const [name, args] = calls[round++]
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: `c${round}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] }), { status: 200 })
  }
  const wa = whatsapp()
  try {
    const result = await C.runSalonAssistant(chatInput(db, { message: 'book a haircut today', ai: { organizationId: ORG, apiKey: 'sk-test', billed: false, allowed: true }, fetcher }))
    assert.deepEqual(result, { handled: true, action: 'replied' })
    assert.deepEqual(requests[0].tools.map((t) => t.function.name), ['reply_to_customer', 'not_for_salon'])
    assert.equal(db.tables.salon_chat_offers.length, 0, 'no times sent even when the model asked')
    assert.equal(wa.sent.length, 1)
    assert.match(wa.sent[0].text.body, /walk in/)
  } finally { wa.restore() }
})

test('Website AI chat: no booking talk and no Book on service cards when appointments are off', () => {
  const base = { business: 'Glow', hours: 'Open 10 am to 8 pm', services: [{ id: CUT, name: 'Haircut', category: 'Hair', price: 300, minutes: 30 }], staff: [], approval: true, pay: { mode: 'shop', advance: 100, online: false, methods: '' }, phone: '+91 98480 12345' }
  assert.match(SA.deskFacts(base), /customers book on this website/)
  const off = SA.deskFacts({ ...base, bookings: false })
  assert.match(off, /does not take bookings/)
  assert.doesNotMatch(off, /Paying for a booking/)
  assert.doesNotMatch(off, /check their own booking/)
  assert.match(SA.deskFacts({ ...base, bookOnSite: false }), /Booking: not on this website/)
  assert.match(SA.serviceHits(base.services, 'haircut', 4, true, false)[0].content, /walk in during opening hours/)
  assert.match(SA.serviceHits(base.services, 'haircut')[0].content, /Book it on this website/)
})

// ── Phone bottom bar ────────────────────────────────────────────────────────

test('Phone bottom bar: Front Desk tells the bar which tabs to leave out, and it is remembered', () => {
  const beforeWindow = globalThis.window
  const beforeStorage = globalThis.localStorage
  const store = new Map()
  globalThis.window = new EventTarget()
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }
  try {
    const seen = []
    const stop = N.onConnectorEvent(N.HIDDEN_TABS_EVENT, 'front-desk', (tabs) => seen.push(tabs))
    FD.announceFrontDeskHiddenTabs(['appointments'])
    N.announceConnectorHiddenTabs('pipeline', ['list'])
    assert.deepEqual(seen, [['appointments']])
    assert.deepEqual(N.rememberedHiddenTabs('front-desk'), ['appointments'])
    FD.announceFrontDeskHiddenTabs([])
    assert.deepEqual(N.rememberedHiddenTabs('front-desk'), [])
    stop()
    const layout = read('app/dashboard/layout.tsx')
    assert.match(layout, /\.filter\(\(item\) => !hiddenConnectorTabs\.includes\(item\.tab\)\)/)
  } finally {
    globalThis.window = beforeWindow
    globalThis.localStorage = beforeStorage
  }
})
