require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const V = require('../lib/salon/voice.ts')

// Friday 6 Nov 2026, 10:00 am in India
const NOW = Date.parse('2026-11-06T10:00:00+05:30')

const services = [
  { id: 's1', name: 'Haircut (Women)', category: 'Hair', price: 600, tax_rate: 18, active: true },
  { id: 's2', name: 'Haircut (Men)', category: 'Hair', price: 300, tax_rate: 18, active: true },
  { id: 's3', name: 'Beard Trim', category: 'Hair', price: 150, tax_rate: 18, active: true },
  { id: 's4', name: 'Facial', category: 'Skin', price: 1200, tax_rate: 18, active: true },
  { id: 's5', name: 'Hair Spa', category: 'Spa', price: 1500, tax_rate: 18, active: false },
]
const staff = [{ id: 'st1', name: 'Anitha', active: true }, { id: 'st2', name: 'Ravi', active: true }, { id: 'st3', name: 'Lakshmi', active: true }]
const at = (time) => new Date(`2026-11-06T${time}:00+05:30`).toISOString()
const appointments = [
  { id: 'a1', customer_name: 'Priya Sharma', starts_at: at('11:00'), status: 'booked', services: [{ service_id: 's4', name: 'Facial', price: 1200, tax_rate: 18 }] },
  { id: 'a2', customer_name: 'Priya Reddy', starts_at: at('15:00'), status: 'booked', services: [{ service_id: 's1', name: 'Haircut (Women)', price: 600, tax_rate: 18 }] },
  { id: 'a3', customer_name: 'Kiran', starts_at: at('09:30'), status: 'arrived', services: [{ service_id: 's2', name: 'Haircut (Men)', price: 300, tax_rate: 18 }] },
  { id: 'a4', customer_name: 'Sita', starts_at: at('09:00'), status: 'completed', services: [{ service_id: 's3', name: 'Beard Trim', price: 150, tax_rate: 18 }] },
  { id: 'a5', customer_name: 'Gopal', starts_at: at('12:00'), status: 'cancelled', services: [] },
]
const context = (extra = {}) => ({ now: NOW, services, staff, appointments, collectedToday: 177, settings: { gstin: '36ABCDE1234F1Z5', prices_include_tax: false }, ...extra })
const parsed = (fields) => V.normalizeParsed({ intent: 'unknown', services: [], payment_method: 'none', language: 'en', ...fields })
const resolve = (fields, extra) => V.resolveCommand(parsed(fields), 'test', context(extra))

test('Voice: what the model returns is cleaned before use', () => {
  const clean = V.normalizeParsed({ intent: 'dance', customer_name: '  ', services: ['facial ', 42, ''], date: 'tomorrow', time: '5pm', payment_method: 'gpay', discount_percent: -5, discount_amount: '100', language: 'ta' })
  assert.equal(clean.intent, 'unknown')
  assert.equal(clean.customer_name, null)
  assert.deepEqual(clean.services, ['facial'])
  assert.equal(clean.date, null)
  assert.equal(clean.time, null)
  assert.equal(clean.payment_method, 'none')
  assert.equal(clean.discount_percent, null)
  assert.equal(clean.discount_amount, 100)
  assert.equal(clean.language, 'en')
  assert.equal(V.normalizeParsed(null).intent, 'unknown')
})

test('Voice: a Telugu booking with a spoken number becomes a ready draft and a booking at the right time', () => {
  const draft = resolve({ intent: 'book', customer_name: 'Meena', customer_phone: 'nine eight seven six five four three two one zero', services: ['facial'], staff_name: 'anitha', date: '2026-11-07', time: '17:00', language: 'te' })
  assert.deepEqual(draft.customer, { contact_id: null, name: 'Meena', phone: '+919876543210' })
  assert.deepEqual(draft.service_ids, ['s4'])
  assert.equal(draft.staff_id, 'st1')
  assert.equal(draft.date, '2026-11-07')
  assert.deepEqual(draft.missing, [])
  assert.equal(V.isReady(draft), true)
  assert.equal(draft.speech, 'Meena ki Facial, Anitha tho, repu 5:00 pm ki book cheyyana?')
  assert.deepEqual(V.draftToAction(draft), { type: 'create_appointment', customer: { contact_id: null, name: 'Meena', phone: '+919876543210' }, service_ids: ['s4'], staff_id: 'st1', starts_at: '2026-11-07T11:30:00.000Z', send_whatsapp: true })
})

test('Voice: a booking with no time asks for one; tapping a time makes it ready', () => {
  const draft = resolve({ intent: 'book', customer_name: 'Meena', services: ['beard trim'] })
  assert.equal(draft.date, '2026-11-06')
  assert.deepEqual(draft.missing, ['time'])
  assert.equal(draft.speech, 'What time for Meena?')
  assert.equal(V.isReady(draft), false)
  assert.equal(V.draftToAction(draft), null)
  const timed = V.applyEdit(draft, { kind: 'time', time: '16:00' }, context())
  assert.equal(V.isReady(timed), true)
  assert.equal(timed.speech, 'Book Meena for Beard Trim, today at 4:00 pm?')
})

test('Voice: a time that has already gone today is asked again; no day in the past is booked', () => {
  const past = resolve({ intent: 'book', customer_name: 'Meena', services: ['facial'], time: '09:00', language: 'hi' })
  assert.deepEqual(past.missing, ['time'])
  assert.equal(past.speech, '9:00 am nikal gaya. Kitne baje?')
  const yesterday = resolve({ intent: 'book', customer_name: 'Meena', services: ['facial'], date: '2026-11-05', time: '18:00' })
  assert.equal(yesterday.date, '2026-11-06')
})

test('Voice: "5" heard as five in the morning means 5 pm at a salon', () => {
  assert.equal(V.salonTime('5:00'), '17:00')
  assert.equal(V.salonTime('07:30'), '19:30')
  assert.equal(V.salonTime('9:00'), '09:00')
  assert.equal(V.salonTime('11:30'), '11:30')
  assert.equal(V.salonTime('17:00'), '17:00')
  assert.equal(V.salonTime('25:00'), null)
  assert.equal(V.salonTime(null), null)
  assert.equal(resolve({ intent: 'book', customer_name: 'Meena', services: ['facial'], time: '05:00' }).time, '17:00')
  assert.equal(resolve({ intent: 'arrived', customer_name: 'Priya', appointment_time: '3:00' }).appointment_id, 'a2')
})

test('Voice: a booking says what is missing, customer and services first', () => {
  const draft = resolve({ intent: 'book', time: '17:00' })
  assert.deepEqual(draft.missing, ['customer', 'services'])
  assert.equal(draft.speech, 'Which services?')
  const named = V.applyEdit(draft, { kind: 'service', id: 's4' }, context())
  assert.deepEqual(named.missing, ['customer'])
  assert.equal(named.speech, 'Who is the customer?')
})

test('Voice: "haircut" when there are two haircuts comes back as a choice, never a guess', () => {
  const draft = resolve({ intent: 'walk_in', services: ['haircut'], payment_method: 'cash' })
  assert.deepEqual(draft.service_ids, [])
  assert.deepEqual(draft.choices.services[0].options.map((o) => o.id).sort(), ['s1', 's2'])
  assert.equal(V.isReady(draft), false)
  assert.equal(draft.speech, 'Which haircut? Tap to choose.')
  const chosen = V.applyEdit(draft, { kind: 'service', id: 's2', spoken: 'haircut' }, context())
  assert.equal(chosen.choices.services, undefined)
  assert.deepEqual(chosen.service_ids, ['s2'])
  assert.equal(V.isReady(chosen), true)
  // Walk-in with no name is billed as a walk-in customer
  assert.equal(chosen.customer.name, 'Walk-in customer')
  assert.equal(chosen.speech, 'Bill the customer ₹354 by cash?')
  assert.deepEqual(V.draftToAction(chosen), { type: 'walk_in_bill', customer: { contact_id: null, name: 'Walk-in customer', phone: null }, service_ids: ['s2'], staff_id: null, discount: null, payment_method: 'cash', send_whatsapp: true })
})

test('Voice: services that are switched off or not on the list are not booked', () => {
  const draft = resolve({ intent: 'book', customer_name: 'Meena', services: ['hair spa', 'pedicure'], time: '17:00' })
  assert.deepEqual(draft.service_ids, [])
  assert.deepEqual(draft.unknown_services, ['hair spa', 'pedicure'])
  assert.deepEqual(draft.missing, ['services'])
})

test('Voice: two Priyas today: choose one; the time or the full name picks it straight away', () => {
  const draft = resolve({ intent: 'arrived', customer_name: 'Priya', language: 'hi' })
  assert.deepEqual(draft.choices.appointments.map((c) => c.id), ['a1', 'a2'])
  assert.equal(draft.choices.appointments[0].label, '11:00 am · Priya Sharma')
  assert.equal(draft.speech, 'Kaun sa? Tap karke chuniye.')
  const picked = V.applyEdit(draft, { kind: 'appointment', id: 'a2' }, context())
  assert.equal(picked.speech, 'Priya aa gaye, mark karun?')
  assert.deepEqual(V.draftToAction(picked), { type: 'set_status', appointment_id: 'a2', status: 'arrived' })

  assert.equal(resolve({ intent: 'arrived', customer_name: 'Priya', appointment_time: '15:00' }).appointment_id, 'a2')
  assert.equal(resolve({ intent: 'start', customer_name: 'Priya Sharma' }).appointment_id, 'a1')
})

test('Voice: only appointments that can still change are matched', () => {
  const done = resolve({ intent: 'start', customer_name: 'Sita' })
  assert.deepEqual(done.missing, ['appointment'])
  assert.equal(done.speech, 'I could not find Sita today.')
  assert.equal(V.draftToAction(done), null)
  // Kiran has arrived, so "arrived" again finds nothing, but "start" finds him
  assert.deepEqual(resolve({ intent: 'arrived', customer_name: 'Kiran' }).missing, ['appointment'])
  assert.equal(resolve({ intent: 'start', customer_name: 'Kiran', language: 'te' }).speech, 'Kiran service start cheyyana?')
})

test('Voice: billing an appointment works out the total with discount and GST, and does not add its services twice', () => {
  const draft = resolve({ intent: 'bill', customer_name: 'kiran', services: ['haircut men'], payment_method: 'upi', discount_percent: 10, language: 'hi' })
  assert.equal(draft.appointment_id, 'a3')
  assert.deepEqual(draft.service_ids, [])
  // 300 − 10% = 270, + 18% GST = 318.60
  assert.equal(draft.speech, 'Kiran ka bill ₹318.60, UPI se?')
  assert.deepEqual(V.draftToAction(draft), { type: 'complete_and_bill', appointment_id: 'a3', extra_service_ids: [], discount: { type: 'percent', value: 10 }, payment_method: 'upi', send_whatsapp: true })
  // Without a GSTIN there is no GST; a beard trim said with it is added
  const plain = V.resolveCommand(parsed({ intent: 'bill', customer_name: 'Kiran', services: ['beard trim'] }), 'x', context({ settings: { gstin: null } }))
  assert.deepEqual(plain.service_ids, ['s3'])
  assert.equal(plain.speech, 'Bill Kiran ₹450?')
  const cancelledDiscount = V.applyEdit(draft, { kind: 'discount', discount: null }, context())
  assert.equal(cancelledDiscount.speech, 'Kiran ka bill ₹354, UPI se?')
})

test('Voice: cancel and no-show', () => {
  const cancel = resolve({ intent: 'cancel', customer_name: 'Priya', appointment_time: '11:00' })
  assert.equal(cancel.speech, "Cancel Priya's 11:00 am appointment?")
  assert.deepEqual(V.draftToAction(cancel), { type: 'set_status', appointment_id: 'a1', status: 'cancelled' })
  const noShow = resolve({ intent: 'no_show', customer_name: 'Priya Reddy', language: 'te' })
  assert.equal(noShow.speech, 'Priya raledu ani mark cheyyana?')
  assert.deepEqual(V.draftToAction(noShow), { type: 'set_status', appointment_id: 'a2', status: 'no_show' })
})

test('Voice: a saved customer is found by name; several close names come back as choices', () => {
  const contacts = [{ id: 'c1', name: 'Meena Kumari', phone: '+919812345678' }, { id: 'c2', name: 'Meenakshi', phone: '+919800000001' }]
  const one = resolve({ intent: 'book', customer_name: 'Meena Kumari', services: ['facial'], time: '17:00' }, { contacts })
  assert.deepEqual(one.customer, { contact_id: 'c1', name: 'Meena Kumari', phone: '+919812345678' })
  const two = resolve({ intent: 'book', customer_name: 'Meena', services: ['facial'], time: '17:00' }, { contacts })
  assert.deepEqual(two.choices.customers.map((c) => c.label), ['Meena Kumari · ••••5678', 'Meenakshi · ••••0001'])
  assert.equal(V.isReady(two), false)
  const saved = V.applyEdit(two, { kind: 'customer', id: 'c2', name: 'Meenakshi' }, context())
  assert.deepEqual(saved.customer, { contact_id: 'c2', name: 'Meenakshi', phone: null })
  assert.equal(V.isReady(saved), true)
  const fresh = V.applyEdit(two, { kind: 'customer', id: 'new' }, context())
  assert.deepEqual(fresh.customer, { contact_id: null, name: 'Meena', phone: null })
  assert.equal(V.isReady(fresh), true)
})

test('Voice: today so far', () => {
  const draft = resolve({ intent: 'summary', language: 'te' })
  assert.deepEqual(draft.summary, { appointments: 4, done: 1, waiting: 3, collected: 177, next: '11:00 am Priya Sharma' })
  assert.equal(draft.speech, 'Ivala 4 appointments, 1 ayyayi, ₹177 vachindi. Next: 11:00 am Priya Sharma.')
  assert.equal(V.isReady(draft), false)
  const one = resolve({ intent: 'summary' }, { appointments: [appointments[2]], collectedToday: 0 })
  assert.equal(one.speech, 'Today: 1 appointment, 0 done, ₹0 collected.')
})

test('Voice: not understood says how to say it', () => {
  const draft = resolve({ intent: 'unknown' })
  assert.match(draft.speech, /^Sorry, I did not catch that/)
  assert.equal(V.draftToAction(draft), null)
})

test('Voice: a short yes or no answers the draft on screen; anything longer is a new command', () => {
  for (const yes of ['yes', 'Yes, please.', 'haan ji', 'theek hai', 'avunu andi', 'sare', 'ok do it', 'हाँ', 'అవును']) assert.equal(V.yesOrNo(yes), 'yes', yes)
  for (const no of ['no', 'nahi', 'vaddu', 'leave it', 'cancel karo', 'Cancel it', 'नहीं', 'వద్దు']) assert.equal(V.yesOrNo(no), 'no', no)
  for (const other of ['', 'book Priya at 5', 'yes no', 'Priya vachindi', 'hai', 'please']) assert.equal(V.yesOrNo(other), null, other)
})

test('Voice: the model is asked for strict JSON with the salon\'s own names and today\'s date', async () => {
  let sent
  const result = await V.understandCommand('Priya ki 5 ki haircut book cheyyi', context(), async (body) => {
    sent = body
    return { choices: [{ message: { content: JSON.stringify({ intent: 'book', customer_name: 'Priya', customer_phone: null, services: ['Haircut (Women)'], staff_name: null, date: '2026-11-06', time: '17:00', appointment_time: null, payment_method: 'none', discount_percent: null, discount_amount: null, language: 'te' }) } }] }
  })
  assert.equal(sent.response_format.type, 'json_schema')
  assert.equal(sent.response_format.json_schema.strict, true)
  assert.equal(sent.temperature, 0)
  const prompt = sent.messages[0].content
  assert.match(prompt, /2026-11-06/)
  assert.match(prompt, /repu = 2026-11-07/)
  assert.match(prompt, /- Haircut \(Women\)/)
  assert.doesNotMatch(prompt, /Hair Spa/)
  assert.match(prompt, /11:00 am Priya Sharma \(booked\)/)
  assert.doesNotMatch(prompt, /Sita/)
  assert.equal(sent.messages[1].content, 'Priya ki 5 ki haircut book cheyyi')
  assert.equal(result.intent, 'book')
  assert.equal(result.time, '17:00')
  // A broken answer is "not understood", not an error
  assert.equal((await V.understandCommand('x', context(), async () => ({ choices: [{ message: { content: 'not json' } }] }))).intent, 'unknown')
})

test('Voice: speech-to-text is told the salon\'s names and to write Hindi and Telugu in English letters', () => {
  const prompt = V.transcriptionPrompt(context())
  assert.match(prompt, /Haircut \(Women\), Haircut \(Men\), Beard Trim, Facial\./)
  assert.match(prompt, /Staff: Anitha, Ravi, Lakshmi/)
  assert.match(prompt, /English letters/)
})

// ── Server side ─────────────────────────────────────────────────────────────

const S = require('../lib/salon/voice-server.ts')

test('Voice server: "yes" with a draft waiting confirms without asking the model; a new sentence is a new command', async () => {
  let calls = 0
  const post = async () => { calls++; return { choices: [{ message: { content: JSON.stringify({ intent: 'arrived', customer_name: 'Kiran', services: [], payment_method: 'none', language: 'en' }) } }] } }
  const noContacts = async () => []
  assert.deepEqual(await S.interpret('haan', true, context(), post, noContacts), { kind: 'confirm', transcript: 'haan' })
  assert.deepEqual(await S.interpret('vaddu', true, context(), post, noContacts), { kind: 'reject', transcript: 'vaddu' })
  assert.deepEqual(await S.interpret('  ', true, context(), post, noContacts), { kind: 'empty', transcript: '' })
  assert.equal(calls, 0)
  // "yes" with nothing waiting goes to the model like any sentence
  const result = await S.interpret('yes', false, context(), post, noContacts)
  assert.equal(result.kind, 'draft')
  assert.equal(calls, 1)
  const start = await S.interpret('Kiran start', true, context(), async () => ({ choices: [{ message: { content: JSON.stringify({ intent: 'start', customer_name: 'Kiran', services: [], payment_method: 'none', language: 'en' }) } }] }), noContacts)
  assert.equal(start.draft.appointment_id, 'a3')
})

test('Voice server: saved contacts are looked up only for a new booking said with a name and no number', async () => {
  const looked = []
  const contacts = async (name) => { looked.push(name); return [{ id: 'c1', name: 'Meena Kumari', phone: '+919812345678' }] }
  const answer = (fields) => async () => ({ choices: [{ message: { content: JSON.stringify({ services: ['facial'], payment_method: 'none', language: 'en', time: '17:00', ...fields }) } }] })
  const booked = await S.interpret('book meena kumari facial at 5', false, context(), answer({ intent: 'book', customer_name: 'Meena Kumari' }), contacts)
  assert.equal(booked.draft.customer.contact_id, 'c1')
  await S.interpret('book meena 98123 45678', false, context(), answer({ intent: 'book', customer_name: 'Meena', customer_phone: '9812345678' }), contacts)
  await S.interpret('meena vachindi', false, context(), answer({ intent: 'arrived', customer_name: 'Meena' }), contacts)
  assert.deepEqual(looked, ['Meena Kumari'])
})

test('Voice server: contacts are searched by the start of the first name only (no wildcards from speech)', async () => {
  const calls = []
  const db = { from: () => { const q = { select: () => q, eq: () => q, ilike: (column, pattern) => { calls.push([column, pattern]); return q }, limit: async () => ({ data: [{ id: 'c1', first_name: 'Meena', last_name: 'Kumari', phone_number: '+919812345678' }, { id: 'c2', first_name: '', last_name: null }] }) }; return q } }
  const found = await S.findContacts(db, 'org', 'Meena_% Kumari')
  assert.deepEqual(calls, [['first_name', 'mee%']])
  assert.deepEqual(found, [{ id: 'c1', name: 'Meena Kumari', phone: '+919812345678' }])
  assert.deepEqual(await S.findContacts(db, 'org', null), [])
})

test('Voice server: speech-to-text is sent as a file with the model, and charged to AI credit at the transcription price', async () => {
  const charges = []
  const db = { rpc: async (name, args) => { charges.push([name, args]); return { error: null } } }
  const access = { organizationId: 'org', apiKey: 'sk-test', billed: true, allowed: true }
  let request
  const fetcher = async (url, init) => {
    request = { url, init }
    return new Response(JSON.stringify({ text: ' Priya vachindi ', usage: { type: 'tokens', input_tokens: 120, output_tokens: 8, total_tokens: 128 } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const text = await S.transcribe(db, access, new Blob([new Uint8Array(2000)], { type: 'audio/webm;codecs=opus' }), 'Salon', fetcher)
  assert.equal(text, 'Priya vachindi')
  assert.equal(request.url, 'https://api.openai.com/v1/audio/transcriptions')
  assert.equal(new Headers(request.init.headers).get('Authorization'), 'Bearer sk-test')
  const form = request.init.body
  assert.equal(form.get('model'), 'gpt-4o-mini-transcribe')
  assert.equal(form.get('file').name, 'counter.webm')
  assert.equal(form.get('prompt'), 'Salon')
  assert.equal(charges.length, 1)
  assert.equal(charges[0][1].p_model, 'gpt-4o-mini-transcribe')
  assert.equal(charges[0][1].p_feature, 'salon_voice')
  assert.ok(charges[0][1].p_amount > 0)

  const failing = async () => new Response(JSON.stringify({ error: { message: 'Invalid file format.' } }), { status: 400 })
  await assert.rejects(S.transcribe(db, access, new Blob(['x'], { type: 'audio/mp4' }), '', failing), /Speech could not be read: Invalid file format/)
})

test('Voice server: transcription has its own price; only a development server may point OpenAI elsewhere', () => {
  const { aiCostInr } = require('../lib/billing.ts')
  // US$3 per million audio tokens × ₹88 × 1.5
  assert.equal(aiCostInr('gpt-4o-mini-transcribe', 1_000_000, 0), 396)
  assert.equal(aiCostInr('gpt-4o-transcribe', 1_000_000, 0), 792)
  assert.equal(aiCostInr('gpt-4o-mini', 1_000_000, 0), 19.8)

  const env = { NODE_ENV: process.env.NODE_ENV, OPENAI_API_BASE: process.env.OPENAI_API_BASE }
  try {
    process.env.OPENAI_API_BASE = 'http://127.0.0.1:9999/v1/'
    process.env.NODE_ENV = 'production'
    assert.equal(S.openAiBase(), 'https://api.openai.com/v1')
    process.env.NODE_ENV = 'development'
    assert.equal(S.openAiBase(), 'http://127.0.0.1:9999/v1')
  } finally {
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  }
})
