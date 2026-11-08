require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const I = require('../lib/salon/invoice.ts')
const SP = require('../lib/salon/spoken.ts')

// ── Schema ──────────────────────────────────────────────────────────────────

test('Salon schema: the app runs the migration file word for word', () => {
  const { SALON_SCHEMA_SQL } = require('../lib/salon/schema.ts')
  const file = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261106_spa_salon_connector.sql'), 'utf8')
  assert.equal(SALON_SCHEMA_SQL, file)
})

test('Salon schema: the logo column is added by its own migration, also word for word', () => {
  const { SALON_LOGO_SQL } = require('../lib/salon/schema.ts')
  const file = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261107_salon_logo.sql'), 'utf8')
  assert.equal(SALON_LOGO_SQL, file)
  assert.match(SALON_LOGO_SQL, /ADD COLUMN IF NOT EXISTS logo_url TEXT/)
})

test('Salon schema: after setting up, a step is retried until Supabase sees the new column', async () => {
  const { withSalonSchema } = require('../lib/salon/schema.ts')
  const missing = { data: null, error: { code: 'PGRST204', message: "Could not find the 'logo_url' column of 'salon_settings' in the schema cache" } }
  let calls = 0
  let setups = 0
  const setup = { ensure: async () => { setups++; return true } }
  const result = await withSalonSchema(async () => (++calls <= 3 ? missing : { data: { ok: true }, error: null }), { setup, waitMs: 1 })
  assert.deepEqual([result.data, calls, setups], [{ ok: true }, 4, 1])
  // When setup cannot run, the first answer comes back as it was
  calls = 0
  const refused = await withSalonSchema(async () => { calls++; return missing }, { setup: { ensure: async () => false }, waitMs: 1 })
  assert.deepEqual([refused.error.code, calls], ['PGRST204', 1])
  // Other errors are not retried
  calls = 0
  await withSalonSchema(async () => { calls++; return { data: null, error: { code: '23505', message: 'duplicate' } } }, { setup, waitMs: 1 })
  assert.equal(calls, 1)
})

test('Salon schema: the WhatsApp migration (chat, bookings, feedback, commission) is copied word for word', () => {
  const { SALON_WHATSAPP_SQL } = require('../lib/salon/schema.ts')
  const file = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261108_salon_whatsapp.sql'), 'utf8')
  assert.equal(SALON_WHATSAPP_SQL, file)
  for (const piece of ['auto_approve_bookings', 'commission_percent', 'CREATE TABLE IF NOT EXISTS salon_feedback', 'CREATE TABLE IF NOT EXISTS salon_chat_offers', 'feedback_due_at']) assert.ok(SALON_WHATSAPP_SQL.includes(piece), piece)
})

test('Salon schema: the feedback form migration is copied word for word', () => {
  const { SALON_FEEDBACK_FORM_SQL } = require('../lib/salon/schema.ts')
  const file = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261109_salon_feedback_form.sql'), 'utf8')
  assert.equal(SALON_FEEDBACK_FORM_SQL, file)
})

test('Salon schema: a missing table is recognised so it can be set up', () => {
  const { isMissingSalonSchema } = require('../lib/salon/schema.ts')
  assert.equal(isMissingSalonSchema({ code: 'PGRST205', message: "Could not find the table 'public.salon_services' in the schema cache" }), true)
  assert.equal(isMissingSalonSchema({ code: '42703', message: 'column organizations.enabled_connectors does not exist' }), true)
  assert.equal(isMissingSalonSchema({ code: '23505', message: 'duplicate key value' }), false)
  assert.equal(isMissingSalonSchema(null), false)
})

// ── Invoice maths ───────────────────────────────────────────────────────────

const haircut = { name: 'Haircut', price: 500, tax_rate: 18 }
const facial = { name: 'Facial', price: 1200, tax_rate: 18 }

test('Invoice: GST added on top, split into CGST and SGST', () => {
  const bill = I.computeInvoice([haircut, facial])
  assert.equal(bill.subtotal, 1700)
  assert.equal(bill.taxable, 1700)
  assert.equal(bill.cgst, 153)
  assert.equal(bill.sgst, 153)
  assert.equal(bill.igst, 0)
  assert.equal(bill.total, 2006)
  assert.deepEqual(bill.taxSummary, [{ rate: 18, taxable: 1700, cgst: 153, sgst: 153, igst: 0 }])
})

test('Invoice: prices that include GST are split back into price and tax', () => {
  const bill = I.computeInvoice([{ name: 'Haircut', price: 590, tax_rate: 18 }], { pricesIncludeTax: true })
  assert.equal(bill.taxable, 500)
  assert.equal(bill.tax, 90)
  assert.equal(bill.total, 590)
})

test('Invoice: a discount comes off before tax, spread across the services', () => {
  const percent = I.computeInvoice([haircut, facial], { discount: { type: 'percent', value: 10 } })
  assert.equal(percent.discount, 170)
  assert.equal(percent.taxable, 1530)
  assert.equal(percent.tax, 275.4)
  assert.equal(percent.total, 1805.4)
  const rupees = I.computeInvoice([haircut, facial], { discount: { type: 'amount', value: 100 } })
  assert.equal(rupees.discount, 100)
  assert.equal(rupees.taxable, 1600)
  // A discount never makes the bill negative
  assert.equal(I.computeInvoice([haircut], { discount: { type: 'amount', value: 9999 } }).total, 0)
  assert.equal(I.computeInvoice([haircut], { discount: { type: 'percent', value: 150 } }).total, 0)
})

test('Invoice: IGST for a customer GSTIN from another state; mixed rates are summarised per rate', () => {
  const bill = I.computeInvoice([haircut, { name: 'Shampoo', price: 300, tax_rate: 12, quantity: 2 }], { interState: true })
  assert.equal(bill.cgst, 0)
  assert.equal(bill.igst, 162)
  assert.deepEqual(bill.taxSummary.map((row) => [row.rate, row.taxable, row.igst]), [[12, 600, 72], [18, 500, 90]])
  assert.equal(I.isInterState('36ABCDE1234F1Z5', '29ABCDE1234F1Z5'), true)
  assert.equal(I.isInterState('36ABCDE1234F1Z5', '36PQRSX5678K1Z2'), false)
  assert.equal(I.isInterState('36ABCDE1234F1Z5', null), false)
  assert.equal(I.isValidGstin('36ABCDE1234F1Z5'), true)
  assert.equal(I.isValidGstin('36ABCDE1234F1'), false)
})

test('Invoice: lines are cleaned (quantity at least 1, no blank names, GST at most 28%)', () => {
  const bill = I.computeInvoice([{ name: '  ', price: 100, tax_rate: 18 }, { name: 'Spa', price: -5, tax_rate: 99, quantity: 0 }])
  assert.equal(bill.lines.length, 1)
  assert.deepEqual([bill.lines[0].quantity, bill.lines[0].price, bill.lines[0].tax_rate], [1, 0, 28])
})

test('Invoice: amount in words, the Indian way', () => {
  assert.equal(I.amountInWords(0), 'Rupees Zero Only')
  assert.equal(I.amountInWords(1500), 'Rupees One Thousand Five Hundred Only')
  assert.equal(I.amountInWords(2006), 'Rupees Two Thousand Six Only')
  assert.equal(I.amountInWords(1805.4), 'Rupees One Thousand Eight Hundred Five and Forty Paise Only')
  assert.equal(I.amountInWords(125000), 'Rupees One Lakh Twenty Five Thousand Only')
  assert.equal(I.amountInWords(23456789), 'Rupees Two Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Only')
})

test('Invoice: numbers keep a clean prefix and four digits', () => {
  assert.equal(I.formatInvoiceNumber('sal', 7), 'SAL-0007')
  assert.equal(I.formatInvoiceNumber('RK/26-27', 1234), 'RK/26-27-1234')
  assert.equal(I.formatInvoiceNumber('', 1), 'INV-0001')
  assert.equal(I.formatInvoiceNumber('a b@c!', 12), 'ABC-0012')
})

// ── Speech ──────────────────────────────────────────────────────────────────

test('Spoken phone numbers in English, Hindi and Telugu', () => {
  assert.equal(SP.parseSpokenPhone('nine eight seven six five four three two one zero'), '+919876543210')
  assert.equal(SP.parseSpokenPhone('98765 43210'), '+919876543210')
  assert.equal(SP.parseSpokenPhone('nine eight double seven six five four triple zero'), '+919877654000')
  assert.equal(SP.parseSpokenPhone('nau aath saat chhe paanch chaar teen do ek shunya'), '+919876543210')
  assert.equal(SP.parseSpokenPhone('tommidi enimidi edu aaru aidu naalugu moodu rendu okati sunna'), '+919876543210')
  assert.equal(SP.parseSpokenPhone('+91 98765-43210'), '+919876543210')
  assert.equal(SP.parseSpokenPhone('098765 43210'), '+919876543210')
  // Not a mobile number
  assert.equal(SP.parseSpokenPhone('one two three'), null)
  assert.equal(SP.parseSpokenPhone('12345 67890'), null)
  assert.equal(SP.phoneKey('919876543210'), '9876543210')
})

test('India time: dates, times and day ranges', () => {
  const moment = SP.fromIst('2026-11-06', '17:30')
  assert.equal(moment.toISOString(), '2026-11-06T12:00:00.000Z')
  assert.equal(SP.istDate('2026-11-06T20:00:00Z'), '2026-11-07')
  assert.equal(SP.istTime(moment), '17:30')
  assert.equal(SP.formatIstTime(moment), '5:30 pm')
  assert.equal(SP.formatIstTime(SP.fromIst('2026-11-06', '00:05')), '12:05 am')
  assert.deepEqual(SP.istDayRange('2026-11-06'), { start: '2026-11-05T18:30:00.000Z', end: '2026-11-06T18:30:00.000Z' })
  assert.equal(SP.addDays('2026-11-30', 1), '2026-12-01')
  assert.equal(SP.formatIstDay('2026-11-07', '2026-11-06'), 'Tomorrow')
  assert.equal(SP.fromIst('2026-11-06', '25:00'), null)
  assert.equal(SP.fromIst('not a date'), null)
})

test('Spoken names: one clear match, or choices to tap', () => {
  const services = ['Haircut (Men)', 'Haircut (Women)', 'Hair spa', 'Facial', 'Beard trim'].map((name) => ({ name }))
  assert.equal(SP.matchByName('facial', services, (s) => s.name).match.name, 'Facial')
  assert.equal(SP.matchByName('beard', services, (s) => s.name).match.name, 'Beard trim')
  const haircut = SP.matchByName('haircut', services, (s) => s.name)
  assert.equal(haircut.match, null)
  assert.deepEqual(haircut.choices.map((s) => s.name), ['Haircut (Men)', 'Haircut (Women)'])
  assert.equal(SP.matchByName('pedicure', services, (s) => s.name).match, null)
  const people = [{ name: 'Priya Sharma' }, { name: 'Priya Reddy' }, { name: 'Anitha' }]
  assert.deepEqual(SP.matchByName('Priya', people, (p) => p.name).choices.map((p) => p.name), ['Priya Sharma', 'Priya Reddy'])
  assert.equal(SP.matchByName('priya reddy', people, (p) => p.name).match.name, 'Priya Reddy')
})

// ── Connectors, access and setup checks ─────────────────────────────────────

test('Connectors: switching Spa & Salon on and off; E-commerce is on unless switched off', () => {
  const C = require('../lib/connectors.ts')
  assert.deepEqual(C.withConnector([], 'salon', true), ['salon'])
  assert.deepEqual(C.withConnector(['salon', 'salon', 'nonsense'], 'salon', true), ['salon'])
  assert.deepEqual(C.withConnector(['salon'], 'salon', false), [])
  assert.deepEqual(C.withConnector(null, 'salon', false), [])
  assert.equal(C.isConnectorOn({ enabled_connectors: ['salon'] }, 'salon'), true)
  assert.equal(C.isConnectorOn({ enabled_connectors: [] }, 'salon'), false)
  assert.equal(C.isConnectorOn({}, 'ecommerce'), true)
  assert.equal(C.isConnectorOn({ enable_commerce: false }, 'ecommerce'), false)
  assert.equal(C.isConnectorOn(null, 'ecommerce'), false)
})

test('Access: managers see Connectors, everyone sees the counter, Consular Helpdesk sees neither', () => {
  const rbac = require('../lib/rbac.ts')
  const { workspaceHasPage } = require('../lib/workspace-modules.ts')
  assert.deepEqual(['owner', 'org_admin', 'org_manager', 'sales_employee', 'viewer'].map((role) => rbac.canAccessPage({ role }, '/dashboard/connectors')), [true, true, true, false, false])
  assert.deepEqual(['org_admin', 'sales_employee', 'viewer'].map((role) => rbac.canAccessPage({ role }, '/dashboard/salon')), [true, true, true])
  const consular = { name: 'Consular Helpdesk' }
  assert.equal(workspaceHasPage(consular, '/dashboard/salon'), false)
  assert.equal(workspaceHasPage(consular, '/dashboard/connectors'), false)
  assert.equal(workspaceHasPage({ name: 'Glow Salon' }, '/dashboard/salon'), true)
})

test('Setup checks: services, staff and business details', () => {
  const V = require('../lib/salon/validate.ts')
  assert.deepEqual(V.parseService({ name: ' Haircut  (Men) ', price: '300', duration_minutes: 30 }).value, { name: 'Haircut (Men)', category: 'General', price: 300, duration_minutes: 30, tax_rate: 18, sac_code: null, active: true })
  assert.match(V.parseService({ name: '', price: 100 }).error, /name/)
  assert.match(V.parseService({ name: 'Spa', price: -1 }).error, /price/)
  assert.match(V.parseService({ name: 'Spa', price: 100, duration_minutes: 2 }).error, /5 minutes/)
  assert.match(V.parseService({ name: 'Spa', price: 100, tax_rate: 40 }).error, /28%/)
  assert.match(V.parseService({ name: 'Spa', price: 100, sac_code: '12' }).error, /SAC/)
  // A change only touches what was sent
  assert.deepEqual(V.parseService({ active: false }, true).value, { active: false })
  assert.deepEqual(V.parseStaff({ name: 'Anitha', phone: '98765 43210', service_ids: ['bad', '00000000-0000-4000-8000-000000000001'] }).value, { name: 'Anitha', phone: '+919876543210', service_ids: ['00000000-0000-4000-8000-000000000001'], active: true })
  assert.match(V.parseStaff({ name: 'Anitha', phone: '123' }).error, /10-digit/)
  const settings = V.parseSettings({ business_name: 'Glow', gstin: '36abcde1234f1z5', invoice_prefix: 'glow!', prices_include_tax: true })
  assert.equal(settings.value.gstin, '36ABCDE1234F1Z5')
  assert.equal(settings.value.invoice_prefix, 'GLOW')
  assert.equal(settings.value.prices_include_tax, true)
  assert.match(V.parseSettings({ gstin: 'ABC' }).error, /GSTIN/)
  assert.match(V.parseSettings({ email: 'nope' }).error, /email/)
})

test('Sample salon: every staff category has services', () => {
  const { SAMPLE_SERVICES, SAMPLE_STAFF } = require('../lib/salon/sample.ts')
  const categories = new Set(SAMPLE_SERVICES.map((s) => s.category))
  for (const member of SAMPLE_STAFF) for (const category of member.categories) assert.ok(categories.has(category), category)
  assert.ok(SAMPLE_SERVICES.length >= 10)
})

// ── Counter actions ─────────────────────────────────────────────────────────

const A = require('../lib/salon/actions.ts')

/** An in-memory Supabase stand-in with the filters the counter uses, and unique invoice numbers. */
const { salonDb } = require('./salon-fake-db.cjs')

const ORG = 'org-salon'
const S1 = '00000000-0000-4000-8000-0000000000a1'
const S2 = '00000000-0000-4000-8000-0000000000a2'
const ST = '00000000-0000-4000-8000-0000000000b1'
const seedSalon = () => salonDb({
  salon_services: [
    { id: S1, organization_id: ORG, name: 'Haircut (Women)', category: 'Hair', price: 600, duration_minutes: 45, tax_rate: 18, active: true },
    { id: S2, organization_id: ORG, name: 'Facial', category: 'Skin', price: 1200, duration_minutes: 60, tax_rate: 18, active: true },
  ],
  salon_staff: [{ id: ST, organization_id: ORG, name: 'Anitha', service_ids: [], active: true }],
  contacts: [{ id: '00000000-0000-4000-8000-0000000000c1', organization_id: ORG, first_name: 'Priya', last_name: 'Sharma', phone_number: '919876543210' }],
})
const settings = { business_name: 'Glow Salon', gstin: '36ABCDE1234F1Z5', invoice_prefix: 'GLOW', prices_include_tax: false, invoice_note: 'Thanks!' }
const ctxFor = (db, extra = {}) => ({ db, organizationId: ORG, user: { id: 'user-1' }, organization: { id: ORG }, settings: { ...settings, ...extra } })
const later = (hours) => new Date(Date.now() + hours * 3600_000).toISOString()

test('Counter: actions are checked before anything happens', () => {
  assert.match(A.parseCounterAction({ type: 'create_appointment', customer: { name: 'Priya' }, service_ids: [], starts_at: later(2) }).error, /at least one service/)
  assert.match(A.parseCounterAction({ type: 'create_appointment', customer: { name: 'Priya', phone: '123' }, service_ids: [S1], starts_at: later(2) }).error, /phone number/)
  assert.match(A.parseCounterAction({ type: 'create_appointment', customer: {}, service_ids: [S1], starts_at: later(2) }).error, /name or a phone/)
  assert.match(A.parseCounterAction({ type: 'create_appointment', customer: { name: 'P' }, service_ids: [S1], starts_at: 'later' }).error, /date and time/)
  assert.match(A.parseCounterAction({ type: 'pay_invoice', invoice_id: S1, payment_method: 'cheque' }).error, /cash, UPI or card/)
  assert.match(A.parseCounterAction({ type: 'drop_tables' }).error, /Unknown/)
  const ok = A.parseCounterAction({ type: 'walk_in_bill', service_ids: [S1, S1, 'bad'], discount: { type: 'percent', value: 150 }, payment_method: 'upi' })
  assert.deepEqual([ok.action.service_ids, ok.action.discount, ok.action.customer.name], [[S1], { type: 'percent', value: 100 }, 'Walk-in customer'])
})

test('Counter: book → arrived → complete & bill makes a numbered GST invoice and finds the customer by phone', async () => {
  const db = seedSalon()
  const ctx = ctxFor(db)
  const booked = await A.executeCounterAction(ctx, A.parseCounterAction({ type: 'create_appointment', customer: { name: 'Priya', phone: 'nine eight seven six five four three two one zero' }, service_ids: [S1, S2], staff_id: ST, starts_at: later(3) }).action)
  assert.equal(booked.appointment.contact_id, '00000000-0000-4000-8000-0000000000c1')
  assert.equal(booked.appointment.status, 'booked')
  assert.equal(Date.parse(booked.appointment.ends_at) - Date.parse(booked.appointment.starts_at), 105 * 60_000)
  assert.equal(db.tables.contacts.length, 1)

  const arrived = await A.executeCounterAction(ctx, { type: 'set_status', appointment_id: booked.appointment.id, status: 'arrived' })
  assert.equal(arrived.appointment.status, 'arrived')

  const billed = await A.executeCounterAction(ctx, { type: 'complete_and_bill', appointment_id: booked.appointment.id, discount: { type: 'percent', value: 10 }, payment_method: 'upi', send_whatsapp: false })
  const invoice = billed.invoice
  assert.equal(invoice.number, 'GLOW-0001')
  assert.equal(billed.message, 'GLOW-0001 · ₹1,911.60 paid by UPI')
  assert.deepEqual([invoice.subtotal, invoice.discount, invoice.taxable, invoice.cgst, invoice.sgst, invoice.total], [1800, 180, 1620, 145.8, 145.8, 1911.6])
  assert.deepEqual([invoice.status, invoice.payment_method, invoice.staff_name], ['paid', 'upi', 'Anitha'])
  assert.equal(invoice.business.gstin, '36ABCDE1234F1Z5')
  assert.match(invoice.public_token, /^[A-Za-z0-9_-]{20,}$/)
  assert.equal(db.tables.salon_appointments[0].status, 'completed')
  // Billing again returns the same invoice instead of a second one
  const again = await A.executeCounterAction(ctx, { type: 'complete_and_bill', appointment_id: booked.appointment.id })
  assert.equal(again.invoice.id, invoice.id)
  assert.equal(db.tables.salon_invoices.length, 1)
  // A billed appointment cannot be moved back
  await assert.rejects(A.executeCounterAction(ctx, { type: 'set_status', appointment_id: booked.appointment.id, status: 'booked' }), /already billed/)
})

test('Counter: a new customer is saved to Contacts so they appear in the WhatsApp inbox', async () => {
  const db = seedSalon()
  const result = await A.executeCounterAction(ctxFor(db), A.parseCounterAction({ type: 'walk_in_bill', customer: { name: 'Ravi Kumar', phone: '91234 56789' }, service_ids: [S1], payment_method: 'cash', send_whatsapp: false }).action)
  const contact = db.tables.contacts.find((c) => c.phone_number === '+919123456789')
  assert.deepEqual([contact.first_name, contact.last_name, contact.tags], ['Ravi', 'Kumar', ['Front desk']])
  assert.equal(result.invoice.contact_id, contact.id)
  assert.equal(result.appointment.status, 'completed')
  assert.equal(result.invoice.total, 708)
})

test('Counter: Contacts stay in sync — found by their WhatsApp number, and a contact saved without a name gets the real one', async () => {
  const db = seedSalon()
  // Someone who messaged on WhatsApp first: saved with only their WhatsApp number and no real name
  db.tables.contacts.push({ id: 'c-wa', organization_id: ORG, first_name: 'Customer', last_name: null, phone_number: null, whatsapp_number: 'whatsapp:+919876500111' })
  const result = await A.executeCounterAction(ctxFor(db), { type: 'walk_in_bill', customer: { name: 'Meena Rao', phone: '98765 00111' }, service_ids: [S1], payment_method: 'cash' })
  assert.equal(result.invoice.contact_id, 'c-wa', 'no second contact for the same person')
  const before = db.tables.contacts.length
  const saved = () => db.tables.contacts.find((c) => c.id === 'c-wa')
  assert.deepEqual([saved().first_name, saved().last_name], ['Meena', 'Rao'])
  // A real name already saved is never overwritten; a nameless walk-in takes the saved name
  const again = await A.executeCounterAction(ctxFor(db), { type: 'walk_in_bill', customer: { name: 'Walk-in customer', phone: '+91 98765 00111' }, service_ids: [S1], payment_method: 'cash' })
  assert.equal(again.invoice.customer_name, 'Meena Rao')
  await A.executeCounterAction(ctxFor(db), { type: 'walk_in_bill', customer: { name: 'M. Rao', phone: '9876500111' }, service_ids: [S1], payment_method: 'cash' })
  assert.deepEqual([saved().first_name, saved().last_name], ['Meena', 'Rao'])
  assert.equal(db.tables.contacts.length, before, 'still one contact for this person')
})

test('Counter: invoice numbers stay in order when two counters bill at the same moment', async () => {
  const db = seedSalon()
  const ctx = ctxFor(db)
  await A.executeCounterAction(ctx, { type: 'walk_in_bill', customer: { name: 'A' }, service_ids: [S1], payment_method: 'cash' })
  db.failInvoiceInserts(2) // someone else took the next number twice
  const second = await A.executeCounterAction(ctx, { type: 'walk_in_bill', customer: { name: 'B' }, service_ids: [S2], payment_method: 'cash' })
  assert.equal(second.invoice.number, 'GLOW-0002')
  assert.deepEqual(db.tables.salon_invoices.map((i) => i.seq), [1, 2])
})

test('Counter: without a GSTIN the bill carries no GST', async () => {
  const db = seedSalon()
  const result = await A.executeCounterAction(ctxFor(db, { gstin: null, invoice_prefix: 'INV' }), { type: 'walk_in_bill', customer: { name: 'A' }, service_ids: [S1, S2], payment_method: 'card' })
  assert.deepEqual([result.invoice.number, result.invoice.cgst, result.invoice.sgst, result.invoice.total], ['INV-0001', 0, 0, 1800])
})

test('Counter: the logo is kept with each invoice, so changing it later leaves sent invoices alone', async () => {
  const db = seedSalon()
  const logo = 'https://example.supabase.co/storage/v1/object/public/media-attachments/salon-logos/org/1.png'
  const withLogo = await A.executeCounterAction(ctxFor(db, { logo_url: logo }), { type: 'walk_in_bill', customer: { name: 'A' }, service_ids: [S1], payment_method: 'cash' })
  assert.equal(withLogo.invoice.business.logo_url, logo)
  const without = await A.executeCounterAction(ctxFor(db), { type: 'walk_in_bill', customer: { name: 'B' }, service_ids: [S1], payment_method: 'cash' })
  assert.equal(without.invoice.business.logo_url, null)
})

test('Logo: only real PNG, JPG or WebP images, and only http(s) links are shown', () => {
  const L = require('../lib/salon/logo.ts')
  const bytes = (...values) => new Uint8Array([...values, ...new Array(16).fill(0)])
  assert.equal(L.sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), 'image/png')
  assert.equal(L.sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0)), 'image/jpeg')
  assert.equal(L.sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50)), 'image/webp')
  assert.equal(L.sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null)
  assert.equal(L.sniffImageType(new TextEncoder().encode('GIF89a......')), null)
  assert.equal(L.sniffImageType(new Uint8Array([0x89, 0x50])), null)

  assert.equal(L.isSafeLogoUrl('https://x.supabase.co/storage/v1/object/public/media-attachments/salon-logos/o/1.png'), true)
  assert.equal(L.isSafeLogoUrl('http://localhost:54329/storage/v1/object/public/a.png'), true)
  for (const bad of ['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'http://evil.example/logo.png', 'not a url', '', null, 42]) assert.equal(L.isSafeLogoUrl(bad), false, String(bad))

  assert.match(L.logoStoragePath('c0ffee00-0000-4000-8000-000000000001', 'image/png', 1700000000000), /^salon-logos\/c0ffee00-0000-4000-8000-000000000001\/1700000000000\.png$/)
  assert.equal(L.logoStoragePath('../../etc', 'image/jpeg', 1), 'salon-logos/etc/1.jpg')
})

test('Counter: who did each service is kept per service, on the visit and on the bill', async () => {
  const ST2 = '00000000-0000-4000-8000-0000000000b2'
  const db = seedSalon()
  db.tables.salon_staff.push({ id: ST2, organization_id: ORG, name: 'Lakshmi', service_ids: [], active: true })

  // Walk-in: Haircut by Anitha, Facial by Lakshmi; no name or number needed
  const parsed = A.parseCounterAction({ type: 'walk_in_bill', service_ids: [S1, S2], staff_ids: [ST, ST2, 'x'], payment_method: 'cash' })
  assert.deepEqual(parsed.action.staff_ids, [ST, ST2, null])
  assert.equal(parsed.action.customer.name, 'Walk-in customer')
  const walkIn = await A.executeCounterAction(ctxFor(db), parsed.action)
  assert.deepEqual(walkIn.invoice.items.map((item) => [item.name, item.staff_name]), [['Haircut (Women)', 'Anitha'], ['Facial', 'Lakshmi']])
  assert.equal(walkIn.invoice.staff_name, 'Anitha, Lakshmi')
  assert.deepEqual(walkIn.appointment.services.map((s) => s.staff_id), [ST, ST2])
  assert.equal(walkIn.appointment.staff_id, ST)

  // One person for the whole visit (as voice sends it) covers every service
  const one = await A.executeCounterAction(ctxFor(db), { type: 'walk_in_bill', customer: { name: 'B' }, service_ids: [S1, S2], staff_id: ST2, payment_method: 'upi' })
  assert.deepEqual(one.invoice.items.map((item) => item.staff_name), ['Lakshmi', 'Lakshmi'])
  assert.equal(one.invoice.staff_name, 'Lakshmi')

  // Booked per service; billing keeps it unless the counter changes a row (null: nobody in particular)
  const booked = await A.executeCounterAction(ctxFor(db), { type: 'create_appointment', customer: { name: 'Priya', phone: '9876543210' }, service_ids: [S1, S2], staff_ids: [ST, ST2], starts_at: later(2) })
  assert.deepEqual(booked.appointment.services.map((s) => s.staff_name), ['Anitha', 'Lakshmi'])
  const kept = await A.executeCounterAction(ctxFor(db), { type: 'complete_and_bill', appointment_id: booked.appointment.id, payment_method: 'cash' })
  assert.deepEqual(kept.invoice.items.map((item) => item.staff_name), ['Anitha', 'Lakshmi'])

  const second = await A.executeCounterAction(ctxFor(db), { type: 'create_appointment', customer: { name: 'Meena' }, service_ids: [S1], staff_id: ST, starts_at: later(5) })
  const changed = await A.executeCounterAction(ctxFor(db), { type: 'complete_and_bill', appointment_id: second.appointment.id, extra_service_ids: [S2], staff_ids: [null, ST2], payment_method: 'card' })
  assert.deepEqual(changed.invoice.items.map((item) => item.staff_name || null), [null, 'Lakshmi'])
  assert.equal(changed.invoice.staff_name, 'Lakshmi')

  // Someone not on this salon's team is refused
  await assert.rejects(A.executeCounterAction(ctxFor(db), { type: 'walk_in_bill', customer: { name: 'C' }, service_ids: [S1], staff_ids: ['00000000-0000-4000-8000-0000000000ff'], payment_method: 'cash' }), /no longer on your list/)
})

test('Counter: take payment later, void, and send the bill on WhatsApp', async () => {
  const db = seedSalon()
  const ctx = ctxFor(db)
  const sent = []
  const send = { invoice: async (invoice) => { sent.push(invoice.number); return { sent: true } }, booking: async () => ({ sent: true }) }
  const unpaid = await A.executeCounterAction(ctx, { type: 'walk_in_bill', customer: { name: 'Priya', phone: '+919876543210' }, service_ids: [S1], payment_method: null, send_whatsapp: true }, send)
  assert.equal(unpaid.invoice.status, 'unpaid')
  assert.deepEqual(sent, ['GLOW-0001'])
  assert.equal(unpaid.whatsapp.sent, true)
  const paid = await A.executeCounterAction(ctx, { type: 'pay_invoice', invoice_id: unpaid.invoice.id, payment_method: 'cash' }, send)
  assert.deepEqual([paid.invoice.status, paid.invoice.payment_method], ['paid', 'cash'])
  const voided = await A.executeCounterAction(ctx, { type: 'void_invoice', invoice_id: unpaid.invoice.id }, send)
  assert.equal(voided.invoice.status, 'void')
  await assert.rejects(A.executeCounterAction(ctx, { type: 'pay_invoice', invoice_id: unpaid.invoice.id, payment_method: 'upi' }), /cancelled/)
  // A void invoice is kept, never deleted
  assert.equal(db.tables.salon_invoices.length, 1)
})

test('Counter: a double booking is warned about, not blocked', async () => {
  const db = seedSalon()
  const ctx = ctxFor(db)
  const at = later(4)
  await A.executeCounterAction(ctx, { type: 'create_appointment', customer: { name: 'Priya' }, service_ids: [S2], staff_id: ST, starts_at: at })
  const second = await A.executeCounterAction(ctx, { type: 'create_appointment', customer: { name: 'Meena' }, service_ids: [S1], staff_id: ST, starts_at: new Date(Date.parse(at) + 30 * 60_000).toISOString() })
  assert.match(second.warning, /Anitha already has Priya/)
  assert.equal(db.tables.salon_appointments.length, 2)
})

test('Booking times: every 30 minutes, only from now on today', () => {
  const now = Date.parse('2026-11-06T10:10:00Z') // 3:40 pm in India
  const slots = SP.bookingSlots('2026-11-06', now)
  assert.equal(slots[0], '15:30')
  assert.equal(slots.at(-1), '21:00')
  assert.equal(SP.bookingSlots('2026-11-07', now)[0], '10:00')
  assert.deepEqual(SP.bookingSlots('2026-11-05', now), [])
})

test('WhatsApp messages read naturally', () => {
  const W = require('../lib/salon/whatsapp.ts')
  const message = W.invoiceMessage({ customer_name: 'Priya Sharma', number: 'GLOW-0001', total: 1911.6, status: 'paid', business: { name: 'Glow Salon' } }, 'https://app.test/i/abc')
  assert.match(message, /^Hi Priya, thank you for visiting Glow Salon!/)
  assert.match(message, /GLOW-0001: ₹1,911\.60 \(paid, thank you!\)/)
  assert.match(message, /https:\/\/app\.test\/i\/abc$/)
  const booking = W.bookingMessage({ customer_name: 'Priya', starts_at: '2026-11-06T11:30:00Z', services: [{ name: 'Facial' }] }, 'Glow Salon', 'Anitha')
  assert.match(booking, /Hi Priya, your appointment at Glow Salon is booked for .*5:00 pm \(Facial with Anitha\)/)
  assert.equal(W.invoiceLink('https://app.test/', 'tok'), 'https://app.test/i/tok')
})
