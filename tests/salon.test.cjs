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
