require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const { salonDb } = require('./salon-fake-db.cjs')

const J = require('../lib/salon/jobs.ts')
const T = require('../lib/salon/templates.ts')
const A = require('../lib/salon/actions.ts')
const { validateDraft } = require('../lib/whatsapp-templates/template-model.ts')

const ORG = 'c0ffee00-0000-4000-8000-0000000000bb'
const NOW = Date.parse('2026-11-07T15:00:00+05:30')
const INV = '00000000-0000-4000-8000-0000000000d1'
const iso = (ms) => new Date(ms).toISOString()

const seed = (extra = {}) => salonDb({
  organizations: [{ id: ORG, name: 'Glow', whatsapp_provider: 'facebook', whatsapp_api_token: 't', whatsapp_phone_number_id: '111' }],
  salon_settings: [{ organization_id: ORG, business_name: 'Glow Salon', feedback_enabled: true, reminders_enabled: true, review_link: 'https://g.page/r/glow/review', ...(extra.settings || {}) }],
  salon_invoices: [{ id: INV, organization_id: ORG, number: 'GLOW-0007', customer_name: 'Priya Sharma', customer_phone: '+919876543210', status: 'paid', issued_at: iso(NOW - 3 * 3600_000), feedback_due_at: iso(NOW - 60_000), feedback_status: null, public_token: 'TokFeedback1234567890', business: { name: 'Glow Salon' }, staff_name: 'Anitha, Lakshmi', items: [{ name: 'Facial', staff_id: 's1', staff_name: 'Anitha' }, { name: 'Manicure', staff_id: 's2', staff_name: 'Lakshmi' }], ...(extra.invoice || {}) }],
  salon_appointments: extra.appointments || [],
  salon_feedback: [], contacts: [], conversations: [], messages: [],
})

/** WhatsApp: free-form messages fail with the 24-hour error when `windowClosed`; templates Meta does not know (all when `templatesMissing`) fail as Meta does. */
function whatsapp({ windowClosed = false, templatesMissing = false, missingNames = [] } = {}) {
  const sent = []
  const real = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    sent.push(body)
    if (body.type === 'template' && (templatesMissing || missingNames.includes(body.template.name))) {
      return new Response(JSON.stringify({ error: { code: 132001, message: '(#132001) Template name does not exist in the translation', error_data: { details: `template name (${body.template.name}) does not exist in ${body.template.language.code}` } } }), { status: 400 })
    }
    if (body.type !== 'template' && windowClosed) return new Response(JSON.stringify({ error: { code: 131047, message: 'refused' } }), { status: 400 })
    return new Response(JSON.stringify({ messages: [{ id: `wamid.${sent.length}` }] }), { status: 200 })
  }
  return { sent, restore: () => { globalThis.fetch = real } }
}

test('Feedback: asked once it is due, with a Give feedback button to the form; never twice', async () => {
  const db = seed()
  const wa = whatsapp()
  try {
    const result = await J.runSalonJobs(db, ORG, { now: NOW, origin: 'https://wamacrm.magnetora.in' })
    assert.deepEqual(result, { feedbackSent: 1, feedbackSkipped: 0, remindersSent: 0 })
    const message = wa.sent[0].interactive
    assert.equal(message.type, 'cta_url')
    assert.equal(message.body.text, 'Hi Priya, thank you for visiting Glow Salon! How was your Facial, Manicure with Anitha, Lakshmi? Tap below to rate your visit and the team. It takes less than a minute.')
    assert.deepEqual(message.action, { name: 'cta_url', parameters: { display_text: 'Give feedback', url: 'https://wamacrm.magnetora.in/f/TokFeedback1234567890' } })
    assert.equal(db.tables.salon_invoices[0].feedback_status, 'sent')
    assert.deepEqual(await J.runSalonJobs(db, ORG, { now: NOW + 60_000 }), { feedbackSent: 0, feedbackSkipped: 0, remindersSent: 0 })
    assert.equal(wa.sent.length, 1)
  } finally { wa.restore() }
})

test('Feedback: after 24 hours nothing goes until a template is set up — there is no default', async () => {
  const db = seed()
  const wa = whatsapp({ windowClosed: true })
  try {
    assert.deepEqual(await J.runSalonJobs(db, ORG, { now: NOW }), { feedbackSent: 0, feedbackSkipped: 1, remindersSent: 0 })
    assert.equal(wa.sent.filter((m) => m.type === 'template').length, 0, 'no built-in template is sent')
    assert.equal(db.tables.salon_invoices[0].feedback_status, 'skipped')
  } finally { wa.restore() }
})

test('Feedback: the template the business set up goes, with its blanks and the form link on its button', async () => {
  const own = seed({ settings: { message_templates: { feedback: { name: 'clinic_feedback', language: 'en_US', fields: ['customer_name', 'services'], url_field: 'link' } } } })
  const wa = whatsapp({ windowClosed: true })
  try {
    assert.deepEqual(await J.runSalonJobs(own, ORG, { now: NOW }), { feedbackSent: 1, feedbackSkipped: 0, remindersSent: 0 })
    const template = wa.sent[1].template
    assert.deepEqual([template.name, template.language.code], ['clinic_feedback', 'en_US'])
    assert.deepEqual(template.components, [
      { type: 'body', parameters: [{ type: 'text', text: 'Priya Sharma' }, { type: 'text', text: 'Facial, Manicure' }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'TokFeedback1234567890' }] },
    ])
    assert.equal(own.tables.salon_invoices[0].feedback_status, 'sent')
  } finally { wa.restore() }
  // Not approved (or deleted) on Meta: nothing else is tried in its place
  const refused = seed({ settings: { message_templates: { feedback: { name: 'clinic_feedback', language: 'en', fields: [] } } } })
  const wa2 = whatsapp({ windowClosed: true, templatesMissing: true })
  try {
    assert.deepEqual(await J.runSalonJobs(refused, ORG, { now: NOW }), { feedbackSent: 0, feedbackSkipped: 1, remindersSent: 0 })
    assert.equal(wa2.sent.filter((m) => m.type === 'template').length, 1)
  } finally { wa2.restore() }
})

test('Feedback: not for cancelled bills, bills not yet due, or when switched off', async () => {
  const wa = whatsapp()
  try {
    const voided = seed({ invoice: { status: 'void' } })
    assert.deepEqual(await J.runSalonJobs(voided, ORG, { now: NOW }), { feedbackSent: 0, feedbackSkipped: 1, remindersSent: 0 })
    assert.deepEqual(await J.runSalonJobs(seed({ invoice: { feedback_due_at: iso(NOW + 60_000) } }), ORG, { now: NOW }), { feedbackSent: 0, feedbackSkipped: 0, remindersSent: 0 })
    assert.deepEqual(await J.runSalonJobs(seed({ settings: { feedback_enabled: false } }), ORG, { now: NOW }), { feedbackSent: 0, feedbackSkipped: 0, remindersSent: 0 })
    assert.equal(wa.sent.length, 0)
  } finally { wa.restore() }
})

test('Reminders: about 2 hours before a booking, once', async () => {
  const appointment = (id, minutes, extra = {}) => ({ id, organization_id: ORG, customer_name: 'Meena Reddy', customer_phone: '+919876500003', status: 'booked', starts_at: iso(NOW + minutes * 60_000), ends_at: iso(NOW + (minutes + 45) * 60_000), services: [{ name: 'Haircut (Women)', staff_name: 'Anitha' }], reminder_sent_at: null, ...extra })
  const db = seed({ invoice: { feedback_due_at: iso(NOW + 3600_000) }, appointments: [appointment('a1', 120), appointment('a2', 240), appointment('a3', 90, { status: 'requested' })] })
  const wa = whatsapp()
  try {
    assert.deepEqual(await J.runSalonJobs(db, ORG, { now: NOW }), { feedbackSent: 0, feedbackSkipped: 0, remindersSent: 1 })
    assert.equal(wa.sent[0].text.body, 'Hi Meena, a reminder of your appointment at Glow Salon today at 5:00 pm (Haircut (Women) with Anitha). Reply here if you need to change it.')
    assert.deepEqual(await J.runSalonJobs(db, ORG, { now: NOW + 60_000 }), { feedbackSent: 0, feedbackSkipped: 0, remindersSent: 0 })
  } finally { wa.restore() }
})

test('Ratings: a tap is saved with who served them; 4-5 stars get the review link, 1-2 an apology; a second tap changes it', async () => {
  const db = seed()
  const wa = whatsapp()
  const input = (buttonId, phone = '+919876543210') => ({ supabase: db, organization: { id: ORG }, contact: { id: 'c1' }, customerPhone: phone, buttonId })
  try {
    assert.deepEqual(await J.handleFeedbackReply(input(`sf:${INV}:5`)), { handled: true, rating: 5 })
    const row = db.tables.salon_feedback[0]
    assert.deepEqual([row.rating, row.staff_ids, row.staff_names, row.customer_name], [5, ['s1', 's2'], ['Anitha', 'Lakshmi'], 'Priya Sharma'])
    assert.match(wa.sent[0].text.body, /a Google review helps us a lot: https:\/\/g\.page\/r\/glow\/review/)
    await J.handleFeedbackReply(input(`sf:${INV}:2`))
    assert.equal(db.tables.salon_feedback.length, 1)
    assert.equal(db.tables.salon_feedback[0].rating, 2)
    assert.match(wa.sent[1].text.body, /Our manager will call you/)
    assert.deepEqual(await J.handleFeedbackReply(input(`sf:${INV}:5`, '+919000000000')), { handled: false })
    assert.deepEqual(await J.handleFeedbackReply(input('sb:x:1700')), { handled: false })
    assert.deepEqual(J.parseFeedbackButton(`sf:${INV}:6`), null)
  } finally { wa.restore() }
})

test('Bills: feedback is due after the delay set in Setup, only when there is a number to ask', async () => {
  const db = salonDb({ salon_invoices: [] })
  const ctx = { organizationId: ORG, userId: 'u', settings: { business_name: 'Glow', invoice_prefix: 'GLOW', feedback_delay_minutes: 60 } }
  const line = { service_id: null, name: 'Facial', price: 1200, tax_rate: 18, sac_code: null }
  const before = Date.now()
  const withPhone = await A.issueInvoice(db, ctx, { customer: { contact_id: null, name: 'Priya', phone: '+919876543210' }, lines: [line], payment_method: 'cash' })
  const due = Date.parse(withPhone.feedback_due_at)
  assert.ok(due >= before + 59 * 60_000 && due <= Date.now() + 61 * 60_000)
  const noPhone = await A.issueInvoice(db, ctx, { customer: { contact_id: null, name: 'Walk-in customer', phone: null }, lines: [line], payment_method: 'cash' })
  assert.equal(noPhone.feedback_due_at, undefined)
  const off = await A.issueInvoice(db, { ...ctx, settings: { ...ctx.settings, feedback_enabled: false } }, { customer: { contact_id: null, name: 'Priya', phone: '+919876543210' }, lines: [line], payment_method: 'cash' })
  assert.equal(off.feedback_due_at, undefined)
})

test('Templates: suggested texts are valid drafts for Meta, nothing more; the link buttons open this app', () => {
  const { validateDraft: check } = require('../lib/whatsapp-templates/template-model.ts')
  const { MESSAGE_PURPOSES, PURPOSES } = require('../lib/salon/message-templates.ts')
  assert.deepEqual(T.SUGGESTED_TEMPLATES.map((t) => t.purpose), MESSAGE_PURPOSES)
  for (const purpose of MESSAGE_PURPOSES) {
    const { draft, fields, urlField } = T.suggestionFor(purpose, 'https://wamacrm.magnetora.in/')
    assert.deepEqual(check(draft), [], purpose)
    assert.equal(draft.category, 'UTILITY')
    assert.ok(fields.every((f) => PURPOSES[purpose].fields.includes(f)), purpose)
    assert.equal(fields.length, (draft.body.match(/\{\{\d+\}\}/g) || []).length, purpose)
    assert.doesNotMatch(`${draft.name} ${draft.body}`, /salon/i)
    assert.equal(urlField, PURPOSES[purpose].linkPath ? 'link' : null)
  }
  const bill = T.suggestionFor('bill', 'https://wamacrm.magnetora.in/')
  assert.deepEqual(bill.draft.buttons[0], { type: 'URL', text: 'View bill', url: 'https://wamacrm.magnetora.in/i/{{1}}', example: 'https://wamacrm.magnetora.in/i/AbCdEf123456' })
})

// ── Staff performance ───────────────────────────────────────────────────────

const P = require('../lib/salon/performance.ts')

test('Team: services, value, commission and ratings per person; old bills, void bills and unassigned work handled', () => {
  const staff = [
    { id: 's1', name: 'Anitha', commission_percent: 20, active: true },
    { id: 's2', name: 'Lakshmi', commission_percent: '10', active: true },
    { id: 's3', name: 'Ravi', commission_percent: 0, active: true },
  ]
  const invoices = [
    { id: 'i1', status: 'paid', issued_at: '2026-11-07T05:00:00Z', staff_name: 'Anitha, Lakshmi', items: [{ name: 'Facial', taxable: 1080, staff_id: 's1', staff_name: 'Anitha' }, { name: 'Manicure', taxable: 450, staff_id: 's2', staff_name: 'Lakshmi' }] },
    { id: 'i2', status: 'unpaid', issued_at: '2026-11-07T06:00:00Z', staff_name: 'Anitha', items: [{ name: 'Facial', taxable: 1200 }] },
    { id: 'i3', status: 'void', issued_at: '2026-11-07T07:00:00Z', staff_name: 'Ravi', items: [{ name: 'Haircut (Men)', taxable: 300, staff_id: 's3' }] },
    { id: 'i4', status: 'paid', issued_at: '2026-11-07T08:00:00Z', staff_name: null, items: [{ name: 'Beard trim', taxable: 150 }] },
  ]
  const feedback = [
    { rating: 5, staff_ids: ['s1', 's2'], created_at: '2026-11-07T09:00:00Z' },
    { rating: 4, staff_ids: [], staff_names: ['Anitha'], created_at: '2026-11-07T10:00:00Z' },
  ]
  const report = P.computePerformance(invoices, feedback, staff)
  const anitha = report.staff.find((r) => r.name === 'Anitha')
  assert.deepEqual([anitha.services, anitha.visits, anitha.revenue, anitha.commission, anitha.ratings, anitha.averageRating], [2, 2, 2280, 456, 2, 4.5])
  assert.deepEqual(anitha.topServices, [{ name: 'Facial', count: 2 }])
  const lakshmi = report.staff.find((r) => r.name === 'Lakshmi')
  assert.deepEqual([lakshmi.revenue, lakshmi.commission, lakshmi.averageRating], [450, 45, 5])
  const ravi = report.staff.find((r) => r.name === 'Ravi')
  assert.deepEqual([ravi.services, ravi.revenue, ravi.averageRating], [0, 0, null])
  assert.equal(report.staff.at(-1).name, 'Not assigned')
  assert.equal(report.staff.at(-1).revenue, 150)
  assert.deepEqual(report.staff.map((r) => r.name), ['Anitha', 'Lakshmi', 'Ravi', 'Not assigned'])
  assert.deepEqual(report.totals, { revenue: 2880, services: 4, visits: 3, commission: 501, ratings: 2, averageRating: 4.5 })
})

test('Team: periods are India dates — today, last 7 days, this month, last month (also across the new year)', () => {
  const now = Date.parse('2026-11-07T10:00:00+05:30')
  assert.deepEqual(P.periodRange('today', now), { from: '2026-11-07', to: '2026-11-07' })
  assert.deepEqual(P.periodRange('week', now), { from: '2026-11-01', to: '2026-11-07' })
  assert.deepEqual(P.periodRange('month', now), { from: '2026-11-01', to: '2026-11-07' })
  assert.deepEqual(P.periodRange('last_month', now), { from: '2026-10-01', to: '2026-10-31' })
  assert.deepEqual(P.periodRange('last_month', Date.parse('2027-01-15T10:00:00+05:30')), { from: '2026-12-01', to: '2026-12-31' })
})

// ── The feedback form ───────────────────────────────────────────────────────

const F = require('../lib/salon/feedback.ts')
const FS = require('../lib/salon/feedback-store.ts')

test('Feedback form: the people on a bill, from each service (or the one name on older bills)', () => {
  assert.deepEqual(F.staffOnInvoice({ items: [{ name: 'Facial', staff_id: 's1', staff_name: 'Anitha' }, { name: 'Threading', staff_id: 's1', staff_name: 'Anitha' }, { name: 'Manicure', staff_id: 's2', staff_name: 'Lakshmi' }, { name: 'Beard trim' }] }), [
    { key: 's1', id: 's1', name: 'Anitha', services: ['Facial', 'Threading'] },
    { key: 's2', id: 's2', name: 'Lakshmi', services: ['Manicure'] },
  ])
  assert.deepEqual(F.staffOnInvoice({ items: [{ name: 'Facial' }], staff_name: 'Ravi' }), [{ key: 'name:Ravi', id: null, name: 'Ravi', services: [] }])
  assert.deepEqual(F.staffOnInvoice({ items: [] }), [])
})

test('Feedback form: a rating is required; staff ratings only for people on the bill; known tags only; comment trimmed', () => {
  const invoice = { items: [{ name: 'Facial', staff_id: 's1', staff_name: 'Anitha' }] }
  assert.match(F.parseFeedbackForm({}, invoice).error, /Tap the stars/)
  assert.match(F.parseFeedbackForm({ rating: 6 }, invoice).error, /Tap the stars/)
  const ok = F.parseFeedbackForm({ rating: 4, staff_ratings: { s1: 5, s9: 1, x: 'a' }, tags: ['Friendly staff', 'Friendly staff', 'Hacked'], comment: '  Loved it  ' }, invoice).value
  assert.deepEqual(ok, { rating: 4, staff_ratings: { s1: 5 }, tags: ['Friendly staff'], comment: 'Loved it' })
  assert.equal(F.parseFeedbackForm({ rating: 2, comment: '   ' }, invoice).value.comment, null)
  assert.equal(F.feedbackLink('https://app.test/', 'tok'), 'https://app.test/f/tok')
})

test('Feedback form: one answer per bill, saved with who served; sending again updates it and asks for a call again if low', async () => {
  const db = salonDb({ salon_feedback: [] })
  const invoice = { id: INV, organization_id: ORG, contact_id: 'c1', customer_name: 'Priya', customer_phone: '+919876543210', items: [{ name: 'Facial', staff_id: 's1', staff_name: 'Anitha' }, { name: 'Manicure', staff_id: 's2', staff_name: 'Lakshmi' }] }
  await FS.saveFeedback(db, invoice, { rating: 5, staff_ratings: { s1: 5, s2: 4 }, tags: ['Cleanliness'], comment: 'Great' }, 'form')
  const row = db.tables.salon_feedback[0]
  assert.deepEqual([row.rating, row.staff_ratings, row.tags, row.comment, row.source, row.staff_ids, row.staff_names], [5, { s1: 5, s2: 4 }, ['Cleanliness'], 'Great', 'form', ['s1', 's2'], ['Anitha', 'Lakshmi']])
  db.tables.salon_feedback[0].followed_up_at = '2026-11-07T10:00:00Z'
  await FS.saveFeedback(db, invoice, { rating: 2, staff_ratings: { s2: 1 }, tags: ['Long wait'], comment: null }, 'form')
  assert.equal(db.tables.salon_feedback.length, 1)
  assert.deepEqual([db.tables.salon_feedback[0].rating, db.tables.salon_feedback[0].followed_up_at], [2, null])
})

test('Team: each person\'s own rating from the form counts for them', () => {
  const staff = [{ id: 's1', name: 'Anitha', active: true }, { id: 's2', name: 'Lakshmi', active: true }]
  const report = P.computePerformance([], [
    { rating: 4, staff_ids: ['s1', 's2'], staff_ratings: { s1: 5, s2: 2 }, created_at: '2026-11-07T09:00:00Z' },
    { rating: 4, staff_ids: ['s1'], created_at: '2026-11-07T10:00:00Z' },
  ], staff)
  const by = Object.fromEntries(report.staff.map((r) => [r.name, r]))
  assert.equal(by.Anitha.averageRating, 4.5)
  assert.equal(by.Lakshmi.averageRating, 2)
})

// WhatsApp often accepts a free-form message and fails it later, so the window is checked first
const chatSeed = (lastInboundMs) => ({
  contacts: [{ id: 'k1', organization_id: ORG, phone_number: '+919876543210' }],
  conversations: [{ id: 'cv1', organization_id: ORG, contact_id: 'k1' }],
  messages: lastInboundMs === null ? [] : [{ id: 'm1', conversation_id: 'cv1', sender_type: 'contact', body: 'hi', created_at: iso(lastInboundMs) }],
})

test('Window check: a customer who last wrote over 24 hours ago gets no free-form message', async () => {
  const W = require('../lib/salon/whatsapp.ts')
  const db = seed()
  Object.assign(db.tables, structuredClone(chatSeed(Date.now() - 30 * 3600_000)))
  const wa = whatsapp()
  try {
    const outcome = await W.sendCustomerText(db, ORG, '+919876543210', 'Your bill', W.billTemplate({ customer_name: 'Priya', number: 'GLOW-1', total: 700, public_token: 'tok', business: { name: 'Glow' } }))
    assert.equal(outcome.sent, false)
    assert.equal(outcome.windowClosed, true)
    assert.match(outcome.error, /24 hours/)
    assert.match(outcome.error, /template is set up/)
    assert.equal(wa.sent.length, 0)
  } finally { wa.restore() }
})

test('Window check: a customer who never wrote gets the template the business set up', async () => {
  const W = require('../lib/salon/whatsapp.ts')
  const db = seed({ settings: { message_templates: { bill: { name: 'bill_ready', language: 'en', fields: ['first_name', 'amount'] } } } })
  Object.assign(db.tables, structuredClone(chatSeed(null)))
  const wa = whatsapp()
  try {
    const outcome = await W.sendCustomerText(db, ORG, '+919876543210', 'Your bill', W.billTemplate({ customer_name: 'Priya', number: 'GLOW-1', total: 700, public_token: 'tok', business: { name: 'Glow' } }))
    assert.equal(outcome.sent, true)
    assert.equal(wa.sent.length, 1)
    assert.equal(wa.sent[0].type, 'template')
    assert.equal(wa.sent[0].template.name, 'bill_ready')
  } finally { wa.restore() }
})

test('Window check: a customer who wrote today gets the normal message', async () => {
  const W = require('../lib/salon/whatsapp.ts')
  const db = seed()
  Object.assign(db.tables, structuredClone(chatSeed(Date.now() - 2 * 3600_000)))
  const wa = whatsapp()
  try {
    const outcome = await W.sendCustomerText(db, ORG, '+919876543210', 'Your bill', undefined)
    assert.equal(outcome.sent, true)
    assert.equal(wa.sent[0].type, 'text')
  } finally { wa.restore() }
})
