require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const M = require('../lib/money.ts')
const B = require('../lib/business-currency.ts')
const invoice = require('../lib/salon/invoice.ts')
const pipeline = require('../lib/pipeline/rules.ts')
const commerce = require('../lib/commerce/commerce-utils.ts')
const discounts = require('../lib/commerce/discounts.ts')
const bookingPay = require('../lib/salon/booking-pay.ts')
const members = require('../lib/salon/membership-rules.ts')
const loyalty = require('../lib/commerce/loyalty.ts')
const pages = require('../lib/commerce/store-pages.ts')
const site = require('../lib/ai/site-assistant.ts')
const expenses = require('../lib/expenses/rules.ts')
const A = require('../lib/salon/actions.ts')
const { salonDb } = require('./salon-fake-db.cjs')

// One currency for the whole business (owner, 28 Nov 2026: "e-commerce and frontdesk and sales currency configuration
// add in the settings"): Settings → Currency, used by Front Desk, the shop and the Sales Pipeline.

test('Currency: the column is added by itself (lock 724519043), word for word as the migration', () => {
  assert.equal(B.BUSINESS_CURRENCY_LOCK, 724519043)
  assert.equal(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261216_business_currency.sql'), 'utf8'), B.BUSINESS_CURRENCY_SQL)
  assert.match(B.BUSINESS_CURRENCY_SQL, /ADD COLUMN IF NOT EXISTS business_currency TEXT/)
})

test('Currency: the short list, and money written in each', () => {
  assert.deepEqual(M.CURRENCIES.map((c) => c.code), ['INR', 'USD', 'AED', 'SAR', 'QAR', 'GBP', 'EUR', 'SGD', 'AUD', 'CAD'])
  assert.equal(M.moneyText(150000, 'INR'), '₹1,50,000')
  assert.equal(M.moneyText(1911.6, 'INR'), '₹1,911.60')
  assert.equal(M.moneyText(150000, 'USD'), '$150,000')
  assert.equal(M.moneyText(1250.5, 'AED'), 'AED 1,250.50')
  assert.equal(M.moneyText(-500, 'GBP'), '−£500')
  assert.equal(M.moneyFixed(12, 'EUR'), '€12.00')
  assert.equal(M.currencySymbol('AED'), 'AED')
  assert.equal(M.currencyWords('USD'), 'US dollars')
  assert.equal(M.readCurrency('xyz'), 'INR', 'not on the list: rupees')
  assert.equal(M.knownCurrency(' sar '), 'SAR')
  assert.equal(M.screenCurrency(), 'INR', 'the server never uses the browser\'s currency')
})

test('Currency: the older currency column (default USD) does not count; only the one chosen in Settings', () => {
  assert.equal(M.businessCurrency({ currency: 'USD' }), 'INR', 'most Indian businesses had USD without choosing it')
  assert.equal(M.businessCurrency({ currency: 'USD', business_currency: 'aed' }), 'AED')
  assert.equal(M.businessCurrency(null), 'INR')
})

test('Currency: saving adds the column on first use and keeps the older column in step', async () => {
  const writes = []
  let missing = true
  const db = {
    from: () => ({
      update: (values) => ({
        eq: async () => {
          writes.push(values)
          if (missing) return { error: { code: 'PGRST204', message: "Could not find the 'business_currency' column of 'organizations' in the schema cache" } }
          return { error: null }
        },
      }),
    }),
  }
  const setup = { ensure: async () => { missing = false; return true } }
  assert.deepEqual(await B.saveBusinessCurrency(db, 'org-1', 'usd', setup), { currency: 'USD' })
  assert.deepEqual(writes.at(-1), { business_currency: 'USD', currency: 'USD' })
  assert.deepEqual(await B.saveBusinessCurrency(db, 'org-1', 'JPY', setup), { error: 'Choose a currency from the list.' })
})

test('Currency: Front Desk, shop and pipeline amounts follow it', () => {
  assert.equal(invoice.formatRupees(500), '₹500', 'no currency given on the server: rupees')
  assert.equal(invoice.formatRupees(500, 'USD'), '$500')
  assert.equal(pipeline.formatMoney(1250000, 'INR', true), '₹12.5 L')
  assert.equal(pipeline.formatMoney(1500, 'USD'), '$1,500')
  assert.equal(commerce.formatMoney(1050, 'AED'), 'AED 1,050')
  assert.equal(discounts.defaultTitle({ kind: 'flat', value: 200, buy_qty: 0, get_qty: 0, min_order: 999 }, 'USD'), '$200 off on $999 or more')
  assert.equal(discounts.parseDiscount({ kind: 'free_delivery', min_order: 50, code: 'FREE' }, 'GBP').discount.title, 'Free delivery on £50 or more')
  assert.equal(bookingPay.paymentNote({ status: 'booked', payment_status: 'paid', payment_paid: 20, services: [{ price: 50 }] }, 'USD'), '$20 paid online · $30 at the shop')
  assert.deepEqual(members.planBenefits({ credit: 600, sessions: [], discount_percent: 0 }, 'AED'), ['AED 600 to spend'])
  assert.equal(members.usageWords({ kind: 'credit', amount: 40 }, 'USD'), 'Paid $40 from credit')
  assert.match(loyalty.loyaltyLine({ on: true, percent: 2, minUse: 0, maxPercent: 50 }, 'USD'), /1 point = \$1 off/)
  const terms = pages.starterPage('terms', { name: 'Desert Shop', currency: 'AED' })
  assert.match(terms, /Prices are in UAE dirhams/)
  assert.doesNotMatch(terms, /Indian law/)
  assert.match(pages.starterPage('terms', { name: 'Glow' }), /Prices are in Indian rupees[\s\S]*Indian law/)
})

test('Currency: the website chat quotes and checks amounts in it', () => {
  const facts = site.deskFacts({ business: 'Glow', hours: 'Open 10 am to 9 pm', services: [{ id: 's1', name: 'Haircut', category: 'Hair', price: 25, minutes: 30 }], staff: [], approval: false, currency: 'USD' })
  assert.match(facts, /Haircut \(\$25, 30 min\)/)
  const hit = site.serviceHits([{ id: 's1', name: 'Haircut', category: 'Hair', price: 25, minutes: 30 }], 'haircut', 4, true, true, 'USD')[0]
  assert.match(hit.content, /Price: \$25/)
  assert.deepEqual(site.amountsIn('A haircut is $25, a facial AED 99, a massage 40 dirhams'), [25, 99, 40])
  assert.deepEqual(site.unknownAmounts('It costs $30', ['Haircut $25']), [30], 'a made-up dollar price is caught too')
})

test('Currency: the monthly AI review is given money in it', () => {
  const facts = { business: 'Desert Shop', kind: 'shop', month: '2026-11', monthLabel: 'November 2026', soFar: false, daysCounted: 30, totals: { month: '2026-11', sales: 1200, salesCount: 4, received: 1200, expenses: 300, profit: 900 }, before: null, trend: [], categories: [], weekdays: [], topItems: [], customers: 0, returning: 0, currency: 'AED' }
  const text = expenses.insightFactsText(facts)
  assert.match(text, /Sales: AED 1,200/)
  assert.doesNotMatch(text, /in India/)
  assert.match(expenses.insightPrompt(facts), /Write money as AED 1,250/)
})

test('Currency: a bill keeps the business currency it was made in', async () => {
  const ORG = 'org-salon'
  const CUT = '00000000-0000-4000-8000-0000000000a1'
  const db = salonDb({ salon_services: [{ id: CUT, organization_id: ORG, name: 'Haircut', category: 'Hair', price: 25, duration_minutes: 30, tax_rate: 0, active: true }] })
  const settings = { business_name: 'Glow', gstin: '', invoice_prefix: 'GLOW', prices_include_tax: false }
  const ctx = { db, organizationId: ORG, user: { id: 'user-1' }, organization: { id: ORG, currency: 'INR', business_currency: 'USD' }, settings }
  const bill = await A.executeCounterAction(ctx, A.parseCounterAction({ type: 'walk_in_bill', customer: { name: 'Asha' }, service_ids: [CUT], payment_method: 'cash', send_whatsapp: false }).action)
  assert.equal(bill.invoice.business.currency, 'USD')
  assert.match(bill.message, /\$25/)
})
