require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHmac } = require('node:crypto')
const { salonDb } = require('./salon-fake-db.cjs')

const ST = require('../lib/payments/stripe.ts')
const GW = require('../lib/payments/gateway.ts')
const RU = require('../lib/payments/return-url.ts')
const PS = require('../lib/payments/schema.ts')
const BPAY = require('../lib/salon/booking-pay.ts')
const AV = require('../lib/salon/availability.ts')
const BP = require('../lib/salon/booking-page.ts')
const BPM = require('../lib/salon/booking-payments.ts')
const WEB = require('../lib/salon/website.ts')
const A = require('../lib/salon/actions.ts')

const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

// ── Stripe ──────────────────────────────────────────────────────────────────

test('Stripe: keys are recognised by their shape', () => {
  assert.equal(ST.isStripeKey('sk_live_' + 'a'.repeat(24)), true)
  assert.equal(ST.isStripeKey('rk_test_' + 'B1'.repeat(12)), true)
  assert.equal(ST.isStripeKey('pk_live_' + 'a'.repeat(24)), false, 'the publishable key is not the secret key')
  assert.equal(ST.isStripeKey('sk_live_short'), false)
  assert.equal(ST.isStripeWebhookSecret('whsec_' + 'x'.repeat(32)), true)
  assert.equal(ST.isStripeWebhookSecret('secret'), false)
  assert.deepEqual(ST.stripeKeys({ stripe_secret_key: ' sk_test_x ', stripe_webhook_secret: null }), { secretKey: 'sk_test_x', webhookSecret: '' })
  assert.equal(ST.stripeKeys({}), null)
})

test('Stripe: amounts in the smallest unit, and back', () => {
  assert.equal(ST.minorUnits(120.5, 'INR'), 12050)
  assert.equal(ST.minorUnits(999, 'JPY'), 999)
  assert.equal(ST.majorUnits(12050, 'inr'), 120.5)
  assert.equal(ST.majorUnits(999, 'JPY'), 999)
})

test('Stripe: nested form fields use brackets, empty ones are left out', () => {
  const body = ST.formBody({ mode: 'payment', metadata: { a: '1', b: '' }, line_items: [{ quantity: 1, price_data: { unit_amount: 500 } }], skip: undefined })
  assert.equal(decodeURIComponent(body), 'mode=payment&metadata[a]=1&line_items[0][quantity]=1&line_items[0][price_data][unit_amount]=500')
})

test('Stripe: the Checkout form asks for the right amount, keeps our ids, and lasts at least 30 minutes', () => {
  const now = Date.parse('2026-11-20T10:00:00Z')
  const form = ST.checkoutForm({ amount: 849.5, currency: 'INR', title: 'Glow · Haircut', metadata: { wama_kind: 'booking', wama_booking_id: 'b1' }, reference: 'booking-b1', successUrl: 'https://x/v/glow?booked=b1&session={CHECKOUT_SESSION_ID}', cancelUrl: 'https://x/v/glow?unpaid=b1', minutes: 5, email: 'not an email' }, now)
  assert.equal(form.mode, 'payment')
  assert.equal(form.line_items[0].price_data.unit_amount, 84950)
  assert.equal(form.line_items[0].price_data.currency, 'inr')
  assert.equal(form.metadata.wama_booking_id, 'b1')
  assert.equal(form.payment_intent_data.metadata.wama_kind, 'booking', 'the payment carries our ids too')
  assert.ok(form.expires_at - Math.floor(now / 1000) >= 30 * 60, 'Stripe refuses less than 30 minutes')
  assert.equal(form.customer_email, undefined)
  assert.match(form.success_url, /\{CHECKOUT_SESSION_ID\}/)
})

test('Stripe: a session is read the same from the API and from a webhook', () => {
  const s = ST.readCheckout({ id: 'cs_test_1', payment_status: 'paid', amount_total: 50000, currency: 'inr', payment_intent: 'pi_1', metadata: { wama_kind: 'order' }, status: 'complete' })
  assert.deepEqual(s, { id: 'cs_test_1', paid: true, amount: 50000, currency: 'INR', paymentIntent: 'pi_1', metadata: { wama_kind: 'order' }, expired: false })
  assert.equal(ST.readCheckout({ payment_status: 'unpaid', status: 'expired' }).expired, true)
  assert.equal(ST.readCheckout({ payment_intent: { id: 'pi_2' } }).paymentIntent, 'pi_2')
})

test('Stripe: webhook signatures are checked, old events are refused', () => {
  const secret = 'whsec_test_secret_value'
  const body = JSON.stringify({ type: 'checkout.session.completed' })
  const now = Date.parse('2026-11-20T10:00:00Z')
  const t = Math.floor(now / 1000)
  const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
  assert.equal(ST.verifyStripeWebhook(secret, body, `t=${t},v1=${sig}`, now), true)
  assert.equal(ST.verifyStripeWebhook(secret, body, `t=${t},v1=${'0'.repeat(64)},v1=${sig}`, now), true, 'any of several signatures')
  assert.equal(ST.verifyStripeWebhook('whsec_other', body, `t=${t},v1=${sig}`, now), false)
  assert.equal(ST.verifyStripeWebhook(secret, body + ' ', `t=${t},v1=${sig}`, now), false)
  assert.equal(ST.verifyStripeWebhook(secret, body, `t=${t},v1=${sig}`, now + 10 * 60_000), false, 'too old')
  assert.equal(ST.verifyStripeWebhook('', body, `t=${t},v1=${sig}`, now), false)
  assert.equal(ST.verifyStripeWebhook(secret, body, 'garbage', now), false)
})

test('Stripe: a Checkout page is opened with the secret key, form-encoded', async () => {
  const calls = []
  const fetcher = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ id: 'cs_test_abcdefghijkl', url: 'https://checkout.stripe.com/c/pay/cs_test_abcdefghijkl' }) } }
  const made = await ST.createCheckout('sk_test_key', { amount: 500, currency: 'INR', title: 'Order', metadata: { wama_kind: 'order' }, reference: 'W-1', successUrl: 'https://a', cancelUrl: 'https://b' }, fetcher)
  assert.equal(made.url, 'https://checkout.stripe.com/c/pay/cs_test_abcdefghijkl')
  assert.equal(calls[0].url, 'https://api.stripe.com/v1/checkout/sessions')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk_test_key')
  assert.equal(calls[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded')
  assert.match(decodeURIComponent(calls[0].init.body), /line_items\[0\]\[price_data\]\[unit_amount\]=50000/)
  await assert.rejects(ST.createCheckout('sk_test_key', { amount: 0.2, currency: 'INR', title: 'x', metadata: {}, reference: 'r', successUrl: 'a', cancelUrl: 'b' }, fetcher), /too small/)
  await assert.rejects(ST.getCheckout('sk_test_key', '../evil', fetcher), /could not be found/)
  const refused = await ST.checkStripeKey('sk_test_bad', async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Invalid API Key' } }) }))
  assert.equal(refused.ok, false)
  assert.match(refused.error, /did not accept this key/)
})

// ── Which gateway ───────────────────────────────────────────────────────────

test('Gateway: the connected one is used; the business picks when both are connected', () => {
  const rzp = { store_razorpay_key_id: 'rzp_live_x', store_razorpay_key_secret: 's' }
  const stripe = { stripe_secret_key: 'sk_live_x' }
  assert.equal(GW.onlineGateway({}), null)
  assert.equal(GW.onlineGateway(rzp), 'razorpay')
  assert.equal(GW.onlineGateway(stripe), 'stripe')
  assert.deepEqual(GW.connectedGateways({ ...rzp, ...stripe }), ['razorpay', 'stripe'])
  assert.equal(GW.onlineGateway({ ...rzp, ...stripe }), 'razorpay')
  assert.equal(GW.onlineGateway({ ...rzp, ...stripe, pay_gateway: 'stripe' }), 'stripe')
  assert.equal(GW.onlineGateway({ ...rzp, pay_gateway: 'stripe' }), 'razorpay', 'a pick that is not connected is ignored')
  assert.match(GW.gatewayMethods('razorpay'), /UPI/)
  assert.match(GW.gatewayMethods('stripe'), /Card/)
})

test('Return address: back to the page on WAMA or the own domain, never elsewhere', () => {
  const app = 'https://wamacrm.magnetora.in'
  assert.equal(RU.returnBase({ origin: 'https://glowsalon.in', appUrl: app, domain: 'glowsalon.in', path: '/', fallback: '/b/glow' }), 'https://glowsalon.in')
  assert.equal(RU.returnBase({ origin: 'https://glowsalon.in', appUrl: app, domain: 'glowsalon.in', path: '/book', fallback: '/b/glow' }), 'https://glowsalon.in/book')
  assert.equal(RU.returnBase({ origin: app, appUrl: app, domain: 'glowsalon.in', path: '/v/glow', fallback: '/b/glow' }), `${app}/v/glow`)
  assert.equal(RU.returnBase({ origin: 'https://evil.example', appUrl: app, domain: 'glowsalon.in', path: '/v/glow', fallback: '/b/glow' }), `${app}/v/glow`, 'a stranger origin is not trusted')
  assert.equal(RU.returnBase({ origin: app, appUrl: app, domain: null, path: '//evil.example/x', fallback: '/b/glow' }), `${app}/b/glow`)
  assert.equal(RU.returnBase({ origin: app, appUrl: app, domain: null, path: 'https://evil.example', fallback: '/s/shop' }), `${app}/s/shop`)
  assert.equal(RU.withQuery('https://a/v/glow', { booked: 'b 1', session: '{CHECKOUT_SESSION_ID}' }), 'https://a/v/glow?booked=b%201&session={CHECKOUT_SESSION_ID}')
})

test('Payments schema: migration file matches, own lock, secrets hidden', () => {
  assert.equal(read('supabase/migrations/20261210_stripe_and_booking_payments.sql'), PS.PAYMENTS_SQL)
  assert.equal(PS.PAYMENTS_LOCK, 724519036)
  const locks = new Set()
  for (const file of fs.readdirSync(path.join(root, 'lib'), { recursive: true }).filter((f) => String(f).endsWith('.ts'))) {
    for (const m of read(path.join('lib', String(file))).matchAll(/LOCK = (7245190\d\d)\b/g)) {
      assert.ok(!locks.has(m[1]), `lock ${m[1]} is used twice`)
      locks.add(m[1])
    }
  }
  const { isSecretColumn } = require('../lib/organization-access.ts')
  assert.equal(isSecretColumn('stripe_secret_key'), true)
  assert.equal(isSecretColumn('stripe_webhook_secret'), true)
})

// ── Paying while booking ────────────────────────────────────────────────────

test('Booking payment: settings are cleaned; advance rounds up to whole rupees', () => {
  assert.deepEqual(BPAY.readBookingPay(null), { mode: 'shop', advance: 100 })
  assert.deepEqual(BPAY.readBookingPay({ mode: 'choice', advance: 25 }), { mode: 'choice', advance: 25 })
  assert.deepEqual(BPAY.readBookingPay({ mode: 'weird', advance: 500 }), { mode: 'shop', advance: 100 })
  assert.equal(BPAY.amountOnline(1499.5, 100), 1499.5)
  assert.equal(BPAY.amountOnline(1499, 20), 300)
  assert.equal(BPAY.amountOnline(10, 50), 5)
})

test('Booking payment: never no way to book', () => {
  const online = { mode: 'online', advance: 100 }
  assert.deepEqual(BPAY.bookingPayOptions(online, true, 800), { online: true, atShop: false, amount: 800, full: true })
  assert.deepEqual(BPAY.bookingPayOptions(online, false, 800), { online: false, atShop: true, amount: 0, full: false }, 'no gateway: pay at the shop')
  assert.deepEqual(BPAY.bookingPayOptions(online, true, 0), { online: false, atShop: true, amount: 0, full: false }, 'free services: nothing to pay online')
  assert.deepEqual(BPAY.bookingPayOptions({ mode: 'choice', advance: 20 }, true, 1000), { online: true, atShop: true, amount: 200, full: false })
  assert.equal(BPAY.bookingPayOptions({ mode: 'shop', advance: 100 }, true, 1000).online, false)
})

test('Booking payment: what the counter sees, and what the bill takes off', () => {
  const services = [{ price: 600 }, { price: 400 }]
  assert.equal(BPAY.paymentNote({ status: 'awaiting_payment', services }), 'Waiting for online payment')
  assert.equal(BPAY.paymentNote({ status: 'booked', payment_status: 'paid', payment_paid: 1000, services }), 'Paid ₹1,000 online')
  assert.equal(BPAY.paymentNote({ status: 'booked', payment_status: 'paid', payment_paid: 200, services }), '₹200 paid online · ₹800 at the shop')
  assert.equal(BPAY.paymentNote({ status: 'booked', services }), '')
  assert.equal(BPAY.advanceForBill(200, 1180), 200)
  assert.equal(BPAY.advanceForBill(2000, 1180), 1180, 'never more than the bill')
  assert.equal(BPAY.advanceForBill(null, 500), 0)
})

test('Busy times: an unpaid booking holds its time only until its hold runs out', () => {
  const now = Date.parse('2026-11-20T05:00:00Z')
  const row = (extra) => ({ starts_at: '2026-11-20T06:00:00Z', ends_at: '2026-11-20T06:30:00Z', staff_id: 's1', ...extra })
  assert.equal(AV.holdsTime(row({ status: 'awaiting_payment', payment_hold_until: new Date(now + 60_000).toISOString() }), now), true)
  assert.equal(AV.holdsTime(row({ status: 'awaiting_payment', payment_hold_until: new Date(now - 60_000).toISOString() }), now), false)
  assert.equal(AV.holdsTime(row({ status: 'awaiting_payment' }), now), false)
  assert.equal(AV.holdsTime(row({ status: 'booked' }), now), true)
  assert.equal(AV.holdsTime(row({ status: 'cancelled' }), now), false)
  assert.equal(AV.busyFrom([row({ status: 'awaiting_payment', payment_hold_until: new Date(now + 60_000).toISOString() }), row({ status: 'awaiting_payment', payment_hold_until: new Date(now - 1).toISOString() })], now).length, 1)
})

test('Website settings keep the Instagram feed switch and the booking payment', () => {
  const site = WEB.readSite({ instagramLive: true, bookingPay: { mode: 'choice', advance: 30 } })
  assert.equal(site.instagramLive, true)
  assert.deepEqual(site.bookingPay, { mode: 'choice', advance: 30 })
  assert.equal(WEB.readSite({}).instagramLive, false)
  assert.deepEqual(WEB.readSite({}).bookingPay, { mode: 'shop', advance: 100 })
})

const ORG = '11111111-1111-4111-8111-111111111111'
const CUT = '22222222-2222-4222-8222-222222222222'
const ANU = '44444444-4444-4444-8444-444444444444'
const seed = (website = {}, settings = {}, org = {}) => ({
  organizations: [{ id: ORG, name: 'Glow', slug: 'glow-ab12', enabled_connectors: ['salon'], currency: 'INR', store_razorpay_key_id: 'rzp_test_abcdef', store_razorpay_key_secret: 'secret', ...org }],
  salon_settings: [{ organization_id: ORG, business_name: 'Glow Salon', opens_at: '10:00', closes_at: '20:00', closed_weekdays: [], website: { bookingPay: { mode: 'choice', advance: 50 }, ...website }, ...settings }],
  salon_services: [{ id: CUT, organization_id: ORG, name: 'Haircut', category: 'Hair', price: 600, duration_minutes: 30, tax_rate: 18, active: true, position: 1 }],
  salon_staff: [{ id: ANU, organization_id: ORG, name: 'Anu', active: true, service_ids: [CUT] }],
})
const NOW = Date.now()
const tomorrow = new Date(NOW + 86_400_000 + 330 * 60_000).toISOString().slice(0, 10)

test('Booking page: the page knows how to pay; an online booking waits for payment and holds the time', async () => {
  const db = salonDb(seed())
  const page = await BP.loadBookingPage(db, 'glow-ab12')
  const view = BP.publicView(page)
  assert.deepEqual([view.pay.mode, view.pay.advance, view.pay.online, view.pay.gateway], ['choice', 50, true, 'razorpay'])
  assert.equal(BP.servicesTotal(page, [CUT]), 600)
  const input = BP.parseOnlineBooking({ service_ids: [CUT], staff_id: ANU, date: tomorrow, time: '11:00', name: 'Priya', phone: '+91 90000 11111' })
  const made = await BP.createOnlineBooking(db, page, input, NOW, { awaitingPayment: { amount: 300 } })
  assert.equal(made.status, 'awaiting_payment')
  assert.equal(made.appointment.payment_status, 'pending')
  assert.equal(made.appointment.payment_amount, 300)
  assert.ok(Date.parse(made.appointment.payment_hold_until) > NOW)
  // Someone else cannot take that time while it is held
  const other = await BP.createOnlineBooking(db, page, BP.parseOnlineBooking({ service_ids: [CUT], staff_id: ANU, date: tomorrow, time: '11:00', name: 'Kiran', phone: '+91 90000 22222' }), NOW)
  assert.equal(other.taken, true)
  // The same customer trying again lets their own unpaid try go
  const retry = await BP.createOnlineBooking(db, page, input, NOW, { awaitingPayment: { amount: 300 } })
  assert.equal(retry.status, 'awaiting_payment')
  assert.equal(db.tables.salon_appointments.find((a) => a.id === made.appointment.id).status, 'cancelled')
})

test('Booking payment: marked paid once, for at least what was asked; then booked or a request', async () => {
  const db = salonDb(seed({}, { auto_approve_bookings: true }))
  const page = await BP.loadBookingPage(db, 'glow-ab12')
  const input = BP.parseOnlineBooking({ service_ids: [CUT], staff_id: ANU, date: tomorrow, time: '12:00', name: 'Priya', phone: '+91 90000 11111' })
  const made = await BP.createOnlineBooking(db, page, input, NOW, { awaitingPayment: { amount: 300 } })
  const row = () => db.tables.salon_appointments.find((a) => a.id === made.appointment.id)
  assert.equal(await BPM.markBookingPaid(db, page, row(), { id: 'pay_1', amount: 100, gateway: 'razorpay' }), null, 'less than asked is not accepted')
  const paid = await BPM.markBookingPaid(db, page, row(), { id: 'pay_1', amount: 30000, gateway: 'razorpay' })
  assert.equal(paid.status, 'booked')
  assert.deepEqual([row().payment_status, row().payment_paid, row().payment_id], ['paid', 300, 'pay_1'])
  assert.equal(await BPM.markBookingPaid(db, page, row(), { id: 'pay_1', amount: 30000, gateway: 'razorpay' }), null, 'only once')
  assert.equal(BPAY.paymentNote(row()), '₹300 paid online · ₹300 at the shop')
})

test('Booking payment: a payment after the hold ran out and the time was taken waits for the team', async () => {
  const db = salonDb(seed({}, { auto_approve_bookings: true }))
  const page = await BP.loadBookingPage(db, 'glow-ab12')
  const input = BP.parseOnlineBooking({ service_ids: [CUT], staff_id: ANU, date: tomorrow, time: '13:00', name: 'Priya', phone: '+91 90000 11111' })
  const made = await BP.createOnlineBooking(db, page, input, NOW, { awaitingPayment: { amount: 600 } })
  const row = db.tables.salon_appointments.find((a) => a.id === made.appointment.id)
  row.payment_hold_until = new Date(Date.now() - 60_000).toISOString()
  // Someone else books the free time meanwhile
  const other = await BP.createOnlineBooking(db, page, BP.parseOnlineBooking({ service_ids: [CUT], staff_id: ANU, date: tomorrow, time: '13:00', name: 'Kiran', phone: '+91 90000 22222' }), Date.now())
  assert.equal(other.status, 'booked')
  const late = await BPM.markBookingPaid(db, page, row, { id: 'pay_2', amount: 60000, gateway: 'stripe' })
  assert.equal(late.status, 'requested')
  assert.match(late.notes, /after the hold ran out/)
})

test('Booking payment: paying at the shop instead confirms the booking without payment', async () => {
  const db = salonDb(seed({}, { auto_approve_bookings: true }))
  const page = await BP.loadBookingPage(db, 'glow-ab12')
  const made = await BP.createOnlineBooking(db, page, BP.parseOnlineBooking({ service_ids: [CUT], date: tomorrow, time: '15:00', name: 'Priya', phone: '+91 90000 11111' }), NOW, { awaitingPayment: { amount: 300 } })
  const booked = await BPM.payAtShopInstead(db, page, made.appointment)
  assert.deepEqual([booked.status, booked.payment_status], ['booked', 'at_shop'])
  assert.equal(await BPM.payAtShopInstead(db, page, booked), null, 'only from waiting')
})

test('Bill: an advance paid when booking is taken off what is left to pay', async () => {
  const S = '00000000-0000-4000-8000-0000000000a1'
  const db = salonDb({
    salon_services: [{ id: S, organization_id: 'org-salon', name: 'Facial', category: 'Skin', price: 1000, duration_minutes: 60, tax_rate: 0, active: true }],
    salon_staff: [],
  })
  const ctx = { db, organizationId: 'org-salon', user: { id: 'user-1' }, organization: { id: 'org-salon' }, settings: { business_name: 'Glow', invoice_prefix: 'GLOW', prices_include_tax: false } }
  const booked = await A.executeCounterAction(ctx, { type: 'create_appointment', customer: { name: 'Priya' }, service_ids: [S], starts_at: new Date(Date.now() + 7200_000).toISOString() })
  Object.assign(db.tables.salon_appointments[0], { payment_status: 'paid', payment_paid: 400 })
  const part = await A.executeCounterAction(ctx, { type: 'complete_and_bill', appointment_id: booked.appointment.id })
  assert.equal(part.invoice.advance_paid, 400)
  assert.equal(part.invoice.status, 'unpaid', 'the rest is still to pay')

  const db2 = salonDb({ salon_services: db.tables.salon_services, salon_staff: [] })
  const ctx2 = { ...ctx, db: db2 }
  const b2 = await A.executeCounterAction(ctx2, { type: 'create_appointment', customer: { name: 'Asha' }, service_ids: [S], starts_at: new Date(Date.now() + 7200_000).toISOString() })
  Object.assign(db2.tables.salon_appointments[0], { payment_status: 'paid', payment_paid: 1000 })
  const full = await A.executeCounterAction(ctx2, { type: 'complete_and_bill', appointment_id: b2.appointment.id })
  assert.deepEqual([full.invoice.status, full.invoice.payment_method, full.invoice.advance_paid], ['paid', 'online', 1000])
})

test('Wiring: routes, webhooks and screens use the shared payments', () => {
  assert.match(read('app/api/public/store/[slug]/stripe-webhook/route.ts'), /verifyStripeWebhook/)
  assert.match(read('app/api/public/store/[slug]/stripe-webhook/route.ts'), /wama_kind === 'booking'/)
  assert.match(read('app/api/public/store/[slug]/razorpay-webhook/route.ts'), /markBookingPaid/)
  assert.match(read('app/api/public/store/[slug]/order/route.ts'), /createCheckout/)
  assert.match(read('app/api/public/store/[slug]/pay/route.ts'), /getCheckout/)
  assert.match(read('app/api/public/booking/[slug]/route.ts'), /startBookingPayment/)
  assert.match(read('app/api/public/booking/[slug]/pay/route.ts'), /payAtShopInstead/)
  assert.match(read('app/api/salon/appointments/route.ts'), /awaiting_payment/, 'unpaid holds are not on the counter')
  assert.match(read('app/api/v1/appointments/route.ts'), /awaiting_payment/)
  assert.match(read('components/commerce/storefront-settings.tsx'), /<OnlinePayments/)
  assert.match(read('components/salon/salon-website.tsx'), /<OnlinePayments/)
  assert.match(read('lib/commerce/returns-store.ts'), /refundStripe/)
  // Secrets never leave the server
  const route = read('app/api/commerce/storefront/payments/route.ts')
  assert.doesNotMatch(route, /secretKey: org\.stripe_secret_key|stripe_secret_key: org/)
  assert.match(route, /slice\(-4\)/)
})
