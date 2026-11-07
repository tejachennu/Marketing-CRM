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
  salon_invoices: [{ id: INV, organization_id: ORG, number: 'GLOW-0007', customer_name: 'Priya Sharma', customer_phone: '+919876543210', status: 'paid', issued_at: iso(NOW - 3 * 3600_000), feedback_due_at: iso(NOW - 60_000), feedback_status: null, business: { name: 'Glow Salon' }, staff_name: 'Anitha, Lakshmi', items: [{ name: 'Facial', staff_id: 's1', staff_name: 'Anitha' }, { name: 'Manicure', staff_id: 's2', staff_name: 'Lakshmi' }], ...(extra.invoice || {}) }],
  salon_appointments: extra.appointments || [],
  salon_feedback: [], contacts: [], conversations: [], messages: [],
})

/** WhatsApp: free-form messages fail with the 24-hour error when `windowClosed`; templates fail when `templatesMissing`. */
function whatsapp({ windowClosed = false, templatesMissing = false } = {}) {
  const sent = []
  const real = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    sent.push(body)
    const refuse = body.type === 'template' ? templatesMissing : windowClosed
    if (refuse) return new Response(JSON.stringify({ error: { code: body.type === 'template' ? 132001 : 131047, message: 'refused' } }), { status: 400 })
    return new Response(JSON.stringify({ messages: [{ id: `wamid.${sent.length}` }] }), { status: 200 })
  }
  return { sent, restore: () => { globalThis.fetch = real } }
}

test('Feedback: asked once it is due, as a list of ratings; never twice', async () => {
  const db = seed()
  const wa = whatsapp()
  try {
    const result = await J.runSalonJobs(db, ORG, { now: NOW })
    assert.deepEqual(result, { feedbackSent: 1, feedbackSkipped: 0, remindersSent: 0 })
    const list = wa.sent[0].interactive
    assert.equal(list.body.text, 'Hi Priya, thank you for visiting Glow Salon! How was your Facial, Manicure with Anitha, Lakshmi? Tap to rate.')
    assert.deepEqual(list.action.sections[0].rows.map((r) => r.id), [5, 4, 3, 2, 1].map((n) => `sf:${INV}:${n}`))
    assert.equal(db.tables.salon_invoices[0].feedback_status, 'sent')
    assert.deepEqual(await J.runSalonJobs(db, ORG, { now: NOW + 60_000 }), { feedbackSent: 0, feedbackSkipped: 0, remindersSent: 0 })
    assert.equal(wa.sent.length, 1)
  } finally { wa.restore() }
})

test('Feedback: after 24 hours the approved template goes, its buttons carrying the rating; without it, skipped', async () => {
  const db = seed()
  const wa = whatsapp({ windowClosed: true })
  try {
    await J.runSalonJobs(db, ORG, { now: NOW })
    const template = wa.sent[1].template
    assert.equal(template.name, 'wama_salon_feedback')
    assert.deepEqual(template.components[0].parameters.map((p) => p.text), ['Priya', 'Glow Salon', 'Facial, Manicure'])
    assert.deepEqual(template.components.slice(1).map((c) => c.parameters[0].payload), [`sf:${INV}:5`, `sf:${INV}:3`, `sf:${INV}:1`])
    assert.equal(db.tables.salon_invoices[0].feedback_status, 'sent')
  } finally { wa.restore() }
  const db2 = seed()
  const wa2 = whatsapp({ windowClosed: true, templatesMissing: true })
  try {
    assert.deepEqual(await J.runSalonJobs(db2, ORG, { now: NOW }), { feedbackSent: 0, feedbackSkipped: 1, remindersSent: 0 })
    assert.equal(db2.tables.salon_invoices[0].feedback_status, 'skipped')
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

test('Templates: every salon template is a valid draft for Meta; the bill button opens this app\'s invoice page', () => {
  assert.deepEqual(T.SALON_TEMPLATES.map((t) => t.name), ['wama_salon_bill', 'wama_salon_booking', 'wama_salon_reminder', 'wama_salon_feedback', 'wama_salon_offer', 'wama_salon_we_miss_you', 'wama_salon_festival'])
  for (const template of T.SALON_TEMPLATES) {
    const draft = T.templateDraft(template, 'https://wamacrm.magnetora.in/')
    assert.deepEqual(validateDraft(draft), [], template.name)
  }
  const bill = T.templateDraft(T.templateFor('bill'), 'https://wamacrm.magnetora.in/')
  assert.deepEqual(bill.buttons[0], { type: 'URL', text: 'View bill', url: 'https://wamacrm.magnetora.in/i/{{1}}', example: 'https://wamacrm.magnetora.in/i/AbCdEf123456' })
  assert.deepEqual(T.SALON_TEMPLATES.filter((t) => t.category === 'MARKETING').map((t) => t.key), ['offer', 'comeback', 'festival'])
  const payload = T.templatePayload(T.templateFor('bill'), '+91 98765 43210', ['Priya', 'Glow\nSalon', 'GLOW-0001', '₹1,911.60'], { urlSuffix: 'tok123' })
  assert.equal(payload.to, '919876543210')
  assert.deepEqual(payload.template.components, [
    { type: 'body', parameters: [{ type: 'text', text: 'Priya' }, { type: 'text', text: 'Glow Salon' }, { type: 'text', text: 'GLOW-0001' }, { type: 'text', text: '₹1,911.60' }] },
    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'tok123' }] },
  ])
})
