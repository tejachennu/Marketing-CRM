require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const R = require('../lib/commerce/shipping-rules.ts')
const SR = require('../lib/commerce/shiprocket.ts')
const DL = require('../lib/commerce/delhivery.ts')
const S = require('../lib/commerce/shipping.ts')
const { salonDb } = require('./salon-fake-db.cjs')

const root = path.join(__dirname, '..')
const ORG = '11111111-1111-4111-8111-111111111111'
const ORDER = '22222222-2222-4222-8222-222222222222'

/** A stand-in fetch: answers by path; records every call. */
function fakeFetch(routes) {
  const calls = []
  const fn = async (url, init = {}) => {
    const u = new URL(url)
    calls.push({ url: String(url), path: u.pathname, method: init.method || 'GET', headers: init.headers || {}, body: init.body })
    const key = Object.keys(routes).find((k) => u.pathname.endsWith(k))
    if (!key) return new Response(JSON.stringify({ message: 'not found' }), { status: 404 })
    const r = typeof routes[key] === 'function' ? routes[key](u, init, calls) : routes[key]
    return new Response(r.status === 204 ? null : typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? r), { status: r.status || 200 })
  }
  fn.calls = calls
  return fn
}

// Answers shaped like the samples in the partners' official docs
const SR_RATES = { body: { data: { recommended_courier_company_id: 43, available_courier_companies: [
  { courier_company_id: 43, courier_name: 'Delhivery Surface', rate: 54, freight_charge: 54, cod_charges: 0, estimated_delivery_days: '4', etd: 'Jul 01, 2024', rating: 4.9, cod: 1 },
  { courier_company_id: 51, courier_name: 'Xpressbees Surface', rate: 61, cod_charges: 0, estimated_delivery_days: '2', etd: 'Jun 29, 2024', rating: 4.1, cod: 0 },
] } } }
const SR_ROUTES = {
  '/auth/login': { body: { token: 'jwt-1' } },
  '/settings/company/pickup': { body: { data: { shipping_address: [{ pickup_location: 'Casa Moderna', pin_code: '122003', city: 'Gurgaon', is_primary_location: 1 }] } } },
  '/courier/serviceability/': SR_RATES,
  '/orders/create/adhoc': { body: { order_id: 16161616, shipment_id: 15151515, status: 'NEW', status_code: 1 } },
  '/courier/assign/awb': { body: { awb_assign_status: 1, response: { data: { awb_code: '321055706540', courier_name: 'Amazon Surface', shipment_id: 15151515 } } } },
  '/courier/generate/pickup': { body: { pickup_status: 1, response: { pickup_scheduled_date: '2021-12-10 12:39:54' } } },
  '/courier/generate/label': { body: { label_created: 1, label_url: 'https://kr-shipmultichannel.s3.amazonaws.com/label.pdf' } },
  '/courier/track/awb/321055706540': { body: { tracking_data: { track_status: 1, shipment_status: 7, shipment_track: [{ current_status: 'Delivered', edd: null }], shipment_track_activities: [{ date: '2022-07-19 11:37:00', status: 'DLVD', activity: 'Delivered', location: 'MADANPALLI', 'sr-status': '7', 'sr-status-label': 'DELIVERED' }] } } },
  '/orders/cancel': { status: 204, body: '' },
}

function order(extra = {}) {
  return {
    id: ORDER, organization_id: ORG, order_number: 'W-1001', status: 'cod_confirmed', payment_method: 'cod', payment_status: 'pending',
    subtotal: 900, shipping_fee: 50, total_amount: 950, created_at: '2026-11-17T06:30:00.000Z', conversation_id: null,
    shipping_address: { full_name: 'Ravi Kumar', phone_number: '+91 98480 22338', address_line_1: '12 MG Road', address_line_2: 'Near park', city: 'Hyderabad', state: 'Telangana', pincode: '500081', handover: 'delivery' },
    ...extra,
  }
}

function orgRow(extra = {}) {
  return {
    id: ORG, name: 'Unisalon', slug: 'unisalon', contact_email: 'shop@unisalon.in', contact_address: 'Ameerpet, Hyderabad',
    shipping_settings: { shiprocket: { email: 'api@unisalon.in', pickup_location: 'Casa Moderna', pickup_pin: '122003' }, delhivery: { warehouse: 'Main WH', pickup_pin: '500016', live: true }, parcel: { weight_grams: 400 } },
    shiprocket_api_password: 'pw', shiprocket_api_token: null, shiprocket_token_at: null, delhivery_api_token: 'dl-token', shipping_webhook_token: 'k'.repeat(48),
    ...extra,
  }
}

test('statuses from both partners map to our words, and never go backwards', () => {
  assert.equal(R.shiprocketStatus(7), 'delivered')
  assert.equal(R.shiprocketStatus(17), 'out_for_delivery')
  assert.equal(R.shiprocketStatus(42), 'picked_up')
  assert.equal(R.shiprocketStatus(9), 'returning')
  assert.equal(R.shiprocketStatus(999, 'IN TRANSIT'), 'in_transit', 'an unknown number falls back to the words')
  assert.equal(R.delhiveryStatus('UD', 'Manifested'), 'booked')
  assert.equal(R.delhiveryStatus('UD', 'In Transit'), 'in_transit')
  assert.equal(R.delhiveryStatus('UD', 'Dispatched'), 'out_for_delivery')
  assert.equal(R.delhiveryStatus('DL', 'Delivered'), 'delivered')
  assert.equal(R.delhiveryStatus('RT', 'RTO'), 'returning')
  assert.equal(R.delhiveryStatus('DL', 'RTO'), 'returned')
  assert.equal(R.delhiveryStatus('CN', 'Canceled'), 'cancelled')
  assert.equal(R.shouldMoveTo('in_transit', 'booked'), false, 'an old update does not move a parcel back')
  assert.equal(R.shouldMoveTo('delivered', 'in_transit'), false)
  assert.equal(R.shouldMoveTo('out_for_delivery', 'undelivered'), true)
  assert.equal(R.shouldMoveTo('undelivered', 'out_for_delivery'), true, 'the courier tries again')
  assert.equal(R.orderStatusFor('in_transit', 'cod_confirmed'), 'shipped')
  assert.equal(R.orderStatusFor('delivered', 'shipped'), 'delivered')
  assert.equal(R.orderStatusFor('booked', 'paid'), null, 'booked is not shipped yet')
  assert.equal(R.orderStatusFor('delivered', 'canceled'), null)
})

test('parcel weight, PIN codes, phones, names and the Delhivery character rule', () => {
  assert.deepEqual(R.parcelFor([{ quantity: 2, weight_grams: 300 }, { quantity: 1, weight_grams: 150 }], R.DEFAULT_PARCEL).weight_grams, 750)
  assert.equal(R.parcelFor([{ quantity: 3 }], { ...R.DEFAULT_PARCEL, weight_grams: 400 }).weight_grams, 400, 'unknown weights count the default once')
  assert.equal(R.parcelFor([{ quantity: 1, weight_grams: 10 }], R.DEFAULT_PARCEL).weight_grams, 50, 'at least 50 g')
  assert.equal(R.cleanPin(' 500 081 '), '500081')
  assert.equal(R.cleanPin('050081'), null)
  assert.equal(R.tenDigits('+91 98480 22338'), '9848022338')
  assert.equal(R.tenDigits('12345'), null)
  assert.deepEqual(R.splitName('  Ravi  Kumar Reddy '), { first: 'Ravi', last: 'Kumar Reddy' })
  assert.equal(R.delhiverySafe('Flat #4 & 5; 50% off\\'), 'Flat 4 5 50 off')
  assert.match(R.shipBlocker(order({ status: 'payment_pending' })), /Only paid or Cash on Delivery/)
  assert.match(R.shipBlocker(order({ shipping_address: { handover: 'pickup' } })), /picked up from the shop/)
  assert.match(R.shipBlocker(order({ shipping_address: { ...order().shipping_address, pincode: '' } })), /6-digit PIN/)
  assert.equal(R.shipBlocker(order()), null)
})

test('rates: cheapest first, cheapest and fastest marked, Shiprocket answer read', () => {
  const rates = SR.shiprocketRates(SR_RATES.body)
  assert.equal(rates.length, 2)
  assert.equal(rates[0].recommended, true)
  const sorted = R.sortRates(rates)
  assert.equal(sorted[0].courierName, 'Delhivery Surface')
  assert.equal(sorted[0].cheapest, true)
  assert.equal(sorted.find((r) => r.fastest).courierName, 'Xpressbees Surface')
})

test('Shiprocket: logs in with the API user, saves the token, logs in again after a 401', async () => {
  let saved = null
  let first = true
  const fetcher = fakeFetch({
    ...SR_ROUTES,
    '/auth/login': () => ({ body: { token: saved ? 'jwt-2' : 'jwt-1' } }),
    '/settings/company/pickup': (u, init) => {
      if (first && init.headers.Authorization === 'Bearer old') { first = false; return { status: 401, body: { message: 'Token has expired' } } }
      return SR_ROUTES['/settings/company/pickup']
    },
  })
  const client = SR.shiprocketClient({ email: 'api@x.in', password: 'pw', token: 'old', tokenAt: new Date().toISOString() }, { fetcher, onToken: (t) => { saved = t } })
  const places = await client.pickupLocations()
  assert.deepEqual(places, [{ name: 'Casa Moderna', pin: '122003', city: 'Gurgaon', primary: true }])
  assert.equal(saved, 'jwt-1', 'the new token is handed back to be saved')
  assert.equal(fetcher.calls.filter((c) => c.path.endsWith('/auth/login')).length, 1)
  assert.equal(SR.tokenFresh(new Date(Date.now() - 8 * 86400000).toISOString()), true)
  assert.equal(SR.tokenFresh(new Date(Date.now() - 10 * 86400000).toISOString()), false, 'their token lasts 10 days; we log in again after 9')
  const bad = fakeFetch({ '/auth/login': { status: 400, body: { message: 'Invalid email and password combination' } } })
  await assert.rejects(SR.shiprocketLogin({ email: 'a@b.in', password: 'x' }, bad), /did not accept the API user/)
})

test('Shiprocket order body has the fields the docs require', () => {
  const body = SR.shiprocketOrderPayload({ order: order(), items: [{ title: 'Poetry book', retailer_id: 'BK-1', quantity: 2, unit_price: 450, hsn_code: '4901' }], pickupLocation: 'Casa Moderna', parcel: { weight_grams: 750, length_cm: 20, breadth_cm: 15, height_cm: 10 }, email: 'shop@x.in' })
  for (const key of ['order_id', 'order_date', 'pickup_location', 'billing_customer_name', 'billing_address', 'billing_city', 'billing_pincode', 'billing_state', 'billing_country', 'billing_email', 'billing_phone', 'shipping_is_billing', 'order_items', 'payment_method', 'sub_total', 'length', 'breadth', 'height', 'weight']) assert.ok(key in body, key)
  assert.equal(body.payment_method, 'COD')
  assert.equal(body.billing_pincode, 500081)
  assert.equal(body.billing_phone, 9848022338)
  assert.equal(body.weight, 0.75, 'kilograms')
  assert.equal(body.order_date, '2026-11-17 12:00', 'India time, yyyy-mm-dd hh:mm')
  assert.equal(body.order_items[0].hsn, '4901')
  assert.equal(SR.shiprocketOrderPayload({ order: order({ payment_status: 'paid', status: 'paid', payment_method: 'razorpay' }), items: [], pickupLocation: 'X', parcel: R.DEFAULT_PARCEL, attempt: 2 }).order_id, 'W-1001-2', 'a second try never reuses a cancelled order id')
})

test('Delhivery: PIN check, shipment body (format=json&data=), Token header, test vs live address', async () => {
  assert.deepEqual(DL.delhiveryPin({ delivery_codes: [] }), { served: false, prepaid: false, cod: false, place: null })
  assert.deepEqual(DL.delhiveryPin({ delivery_codes: [{ postal_code: { pin: 110017, pre_paid: 'Y', cash: 'Y', cod: 'Y', district: 'South Delhi' } }] }), { served: true, prepaid: true, cod: true, place: 'South Delhi' })
  const body = DL.delhiveryShipmentPayload({ order: order(), items: [{ title: 'Poetry book #1', quantity: 2, hsn_code: '4901' }], parcel: { weight_grams: 750, length_cm: 20, breadth_cm: 15, height_cm: 10 }, seller: { name: 'Unisalon', address: 'Ameerpet' } })
  assert.equal(body.payment_mode, 'COD')
  assert.equal(body.cod_amount, 950)
  assert.equal(body.weight, 750, 'grams')
  assert.equal(body.phone, '9848022338')
  assert.equal(body.products_desc, 'Poetry book 1 x2', 'no # in Delhivery data')
  const fetcher = fakeFetch({
    '/api/cmu/create.json': { body: { success: true, packages: [{ waybill: '1234567890123', status: 'Success' }] } },
    '/fm/request/new/': { status: 201, body: { pickup_id: 4323300 } },
  })
  const client = DL.delhiveryClient({ token: 'tok', warehouse: 'Main WH', live: false }, fetcher)
  const booked = await client.book(body, 'S')
  assert.equal(booked.awb, '1234567890123')
  assert.equal(booked.pickupId, '4323300')
  const create = fetcher.calls[0]
  assert.match(create.url, /^https:\/\/staging-express\.delhivery\.com\/api\/cmu\/create\.json/)
  assert.equal(create.headers.Authorization, 'Token tok')
  assert.match(create.body, /^format=json&data=/)
  const sent = JSON.parse(decodeURIComponent(create.body.slice('format=json&data='.length)))
  assert.deepEqual(sent.pickup_location, { name: 'Main WH' }, 'the warehouse name exactly as registered')
  assert.equal(sent.shipments[0].shipping_mode, 'Surface')
  const refused = DL.delhiveryClient({ token: 'tok', warehouse: 'X', live: true }, fakeFetch({ '/api/cmu/create.json': { body: { success: false, rmk: 'ClientWarehouse matching query does not exist.', packages: [] } } }))
  await assert.rejects(refused.book(body, 'S'), /ClientWarehouse matching query/)
})

test('webhooks: Shiprocket and Delhivery bodies are read as updates', () => {
  const sr = SR.shiprocketWebhook({ awb: '19041424751540', current_status: 'IN TRANSIT', current_status_id: 20, shipment_status: 'IN TRANSIT', shipment_status_id: 18, etd: '2023-05-23 15:40:19', scans: [{ date: '2023-05-19 11:59:16', activity: 'Manifested', location: 'Chomu' }, { date: '2023-05-20 10:27:56', activity: 'In Transit - Bag Added To Trip', location: 'Chomu' }] })
  assert.equal(sr.awb, '19041424751540')
  assert.equal(sr.status, 'pickup_scheduled', 'current_status_id 20 = Pickup Exception in the docs')
  assert.equal(sr.events[0].text, 'In Transit - Bag Added To Trip', 'newest first')
  assert.equal(SR.shiprocketWebhook({ awb: '1', current_status_id: 18 }).status, 'in_transit')
  const dl = DL.delhiveryWebhook({ Shipment: { Status: { Status: 'Manifested', StatusDateTime: '2019-01-09T17:10:42.767', StatusType: 'UD', StatusLocation: 'Chandigarh', Instructions: 'Manifest uploaded' }, AWB: '987654', ReferenceNo: '28' } })
  assert.equal(dl.awb, '987654')
  assert.equal(dl.status, 'booked')
  assert.equal(SR.shiprocketWebhook({}), null)
})

test('booking with Shiprocket: AWB, pickup, label saved; order gets the courier and tracking link', async () => {
  const db = salonDb({ organizations: [orgRow()], commerce_orders: [order()], commerce_shipments: [] })
  const fetcher = fakeFetch(SR_ROUTES)
  const org = orgRow()
  const shipment = await S.bookShipment(db, org, { order: order(), items: [{ title: 'Book', retailer_id: 'BK', quantity: 2, unit_price: 450, weight_grams: 300 }] }, { provider: 'shiprocket', courierId: '43', price: 54 }, null, fetcher)
  assert.equal(shipment.awb, '321055706540')
  assert.equal(shipment.status, 'pickup_scheduled')
  assert.equal(shipment.label_url, 'https://kr-shipmultichannel.s3.amazonaws.com/label.pdf')
  assert.equal(shipment.cod, true)
  assert.equal(shipment.weight_grams, 600)
  const assigned = fetcher.calls.find((c) => c.path.endsWith('/courier/assign/awb'))
  assert.deepEqual(JSON.parse(assigned.body), { shipment_id: 15151515, courier_id: 43 })
  assert.equal(db.tables.organizations[0].shiprocket_api_token, 'jwt-1', 'the token is kept for next time')
  const saved = db.tables.commerce_orders[0].shipping_address
  assert.equal(saved.tracking_number, '321055706540')
  assert.equal(saved.tracking_url, 'https://shiprocket.co/tracking/321055706540')
  assert.equal(db.tables.commerce_orders[0].status, 'cod_confirmed', 'Shipped only when the courier has it')
  await assert.rejects(S.bookShipment(db, org, { order: order(), items: [] }, { provider: 'shiprocket', courierId: '43' }, null, fetcher), /already has a courier booked/)
})

test('a courier that refuses the AWB leaves nothing half done in Shiprocket', async () => {
  const db = salonDb({ organizations: [orgRow()], commerce_orders: [order()], commerce_shipments: [] })
  const fetcher = fakeFetch({ ...SR_ROUTES, '/courier/assign/awb': { status: 422, body: { message: 'Selected courier is not serviceable' } } })
  await assert.rejects(S.bookShipment(db, orgRow(), { order: order(), items: [] }, { provider: 'shiprocket', courierId: '43' }, null, fetcher), /not serviceable/)
  assert.ok(fetcher.calls.some((c) => c.path.endsWith('/orders/cancel')), 'the Shiprocket order is cancelled again')
  assert.equal(db.tables.commerce_shipments.length, 0)
})

test('tracking updates move the order and tell the customer once per step', async () => {
  const db = salonDb({ organizations: [orgRow()], commerce_orders: [order()], commerce_shipments: [{ id: 'sh1', organization_id: ORG, order_id: ORDER, provider: 'shiprocket', awb: 'AWB12345', courier_name: 'Xpressbees', status: 'pickup_scheduled', notices: {}, events: [] }] })
  const sent = []
  const notify = async (args) => { sent.push(args); return true }
  const ship = () => db.tables.commerce_shipments[0]
  await S.applyTracking(db, ship(), { status: 'in_transit', statusText: 'In transit', expected: '2026-11-20', events: [] }, { notify })
  assert.equal(db.tables.commerce_orders[0].status, 'shipped')
  assert.equal(sent.length, 1)
  assert.match(sent[0].text, /on the way with Xpressbees\. Expected by 2026-11-20\.\nTrack it here: https:\/\/shiprocket\.co\/tracking\/AWB12345/)
  await S.applyTracking(db, ship(), { status: 'in_transit', statusText: 'In transit', expected: null, events: [] }, { notify })
  assert.equal(sent.length, 1, 'the same step twice sends nothing more')
  await S.applyTracking(db, ship(), { status: 'booked', statusText: '', expected: null, events: [] }, { notify })
  assert.equal(ship().status, 'in_transit', 'an old update is ignored')
  await S.applyTracking(db, ship(), { status: 'delivered', statusText: 'Delivered', expected: null, events: [] }, { notify })
  assert.equal(db.tables.commerce_orders[0].status, 'delivered')
  assert.equal(db.tables.commerce_orders[0].payment_status, 'paid', 'cash collected at the door')
  assert.equal(sent[1].status, 'delivered')
  db.tables.organizations[0].shipping_settings = { ...orgRow().shipping_settings, notify: false }
  db.tables.commerce_shipments.push({ id: 'sh2', organization_id: ORG, order_id: ORDER, provider: 'delhivery', awb: 'B2', status: 'in_transit', notices: {}, events: [] })
  await S.applyTracking(db, db.tables.commerce_shipments[1], { status: 'out_for_delivery', statusText: '', expected: null, events: [] }, { notify })
  assert.equal(sent.length, 2, 'WhatsApp updates switched off: nothing sent')
})

test('cancel: only before the courier has it; the AWB is cleared from the order', async () => {
  const withAwb = order({ shipping_address: { ...order().shipping_address, tracking_number: 'A1', carrier: 'X', tracking_url: 'u' } })
  const db = salonDb({ organizations: [orgRow()], commerce_orders: [withAwb], commerce_shipments: [{ id: 'sh1', organization_id: ORG, order_id: ORDER, provider: 'shiprocket', provider_order_id: '16161616', awb: 'A1', status: 'pickup_scheduled' }] })
  const fetcher = fakeFetch(SR_ROUTES)
  await S.cancelShipment(db, orgRow(), db.tables.commerce_shipments[0], fetcher)
  assert.equal(db.tables.commerce_shipments[0].status, 'cancelled')
  assert.equal(db.tables.commerce_orders[0].shipping_address.tracking_number, undefined)
  assert.deepEqual(JSON.parse(fetcher.calls.find((c) => c.path.endsWith('/orders/cancel')).body), { ids: [16161616] })
  await assert.rejects(S.cancelShipment(db, orgRow(), { ...db.tables.commerce_shipments[0], status: 'in_transit' }, fetcher), /already has this parcel/)
})

test('settings: view never shows the password or tokens; ready only with a pickup place', () => {
  const view = S.shippingView(orgRow(), 'https://wamacrm.magnetora.in')
  const json = JSON.stringify(view)
  assert.ok(!json.includes('"pw"') && !json.includes('dl-token'))
  assert.deepEqual(view.ready, ['shiprocket', 'delhivery'])
  assert.equal(view.webhookUrl, 'https://wamacrm.magnetora.in/api/webhooks/parcel-updates')
  assert.doesNotMatch(view.webhookUrl.replace('https://wamacrm.magnetora.in', ''), /shiprocket|kartrocket|sr|kr/i, 'Shiprocket refuses these words in webhook addresses')
  assert.deepEqual(S.readyPartners(orgRow({ shipping_settings: { shiprocket: { email: 'a@b.in' } } })), [], 'no pickup place yet')
  assert.equal(S.sameKey('k'.repeat(48), 'k'.repeat(48)), true)
  assert.equal(S.sameKey('short', 'short'), false)
  const { isSecretColumn } = require('../lib/organization-access.ts')
  for (const column of ['shiprocket_api_password', 'shiprocket_api_token', 'shiprocket_token_at', 'delhivery_api_token', 'shipping_webhook_token']) assert.equal(isSecretColumn(column), true, column)
  assert.equal(fs.readFileSync(path.join(root, 'supabase/migrations/20261123_shop_delivery_partners.sql'), 'utf8'), S.SHIPPING_SQL, 'migration file matches the auto-migration')
})

test('routes: webhook checks the business key; public PIN check is rate limited; cron needs CRON_SECRET', () => {
  const hook = fs.readFileSync(path.join(root, 'app/api/webhooks/parcel-updates/route.ts'), 'utf8')
  assert.match(hook, /sameKey\(key, org\?\.shipping_webhook_token\)/)
  assert.match(hook, /x-api-key/)
  const pin = fs.readFileSync(path.join(root, 'app/api/public/store/[slug]/delivery-check/route.ts'), 'utf8')
  assert.match(pin, /checkRateLimit\(`store-pin:/)
  const cron = fs.readFileSync(path.join(root, 'app/api/cron/shop/route.ts'), 'utf8')
  assert.match(cron, /Bearer \$\{secret\}/)
  const ship = fs.readFileSync(path.join(root, 'app/api/commerce/shipping/ship/route.ts'), 'utf8')
  assert.match(ship, /permission: 'records\.write'/)
  const settings = fs.readFileSync(path.join(root, 'app/api/commerce/shipping/route.ts'), 'utf8')
  assert.match(settings, /permission: 'settings\.manage'/)
})

test('screens: settings card, courier panel in orders, PIN check on the store, product weight and HSN', () => {
  assert.deepEqual(S.productShippingValues({ weight_grams: '350', hsn_code: '4901 10' }), { weight_grams: 350, hsn_code: '490110' })
  assert.deepEqual(S.productShippingValues({ weight_grams: '', hsn_code: '12' }), { weight_grams: null, hsn_code: null }, 'blank or too short clears them')
  assert.equal(S.productShippingValues({ title: 'x' }), null, 'a form without them leaves them alone')
  const page = fs.readFileSync(path.join(root, 'app/dashboard/commerce/page.tsx'), 'utf8')
  assert.match(page, /<DeliveryPartners orgId=\{orgId\} canManage=\{can\(viewer, 'settings\.manage'\)\}/)
  const orders = fs.readFileSync(path.join(root, 'components/commerce/orders-tab.tsx'), 'utf8')
  assert.match(orders, /<CourierPanel key=\{selected\.id\}/)
  const store = fs.readFileSync(path.join(root, 'app/s/[slug]/storefront.tsx'), 'utf8')
  assert.match(store, /\{store\.pinCheck && <div className="mt-2"><PinCheck slug=\{store\.slug\} charge=/)
  const products = fs.readFileSync(path.join(root, 'app/api/commerce/products/route.ts'), 'utf8')
  assert.match(products, /productShippingValues\(product\)/)
  const view = require('../lib/commerce/storefront.ts').storeView
  assert.equal(view({ organization: { id: ORG, name: 'S', slug: 's', currency: 'INR', domain: null }, settings: require('../lib/commerce/storefront.ts').readStorefront({ enabled: true }), products: [], categories: [], fees: { fee: 0, freeFrom: 0 }, pay: { online: false, later: true }, pinCheck: true }).pinCheck, true)
})
