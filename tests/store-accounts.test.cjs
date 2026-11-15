require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const A = require('../lib/commerce/store-accounts.ts')
const S = require('../lib/commerce/storefront.ts')
const C = require('../lib/commerce/shopper-client.ts')

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const root = path.join(__dirname, '..')

test('Shop accounts: the migration file matches the SQL the app runs, and only the server can read shoppers', () => {
  assert.equal(fs.readFileSync(path.join(root, 'supabase/migrations/20261121_store_accounts.sql'), 'utf8'), A.STORE_ACCOUNTS_SQL)
  assert.match(A.STORE_ACCOUNTS_SQL, /ENABLE ROW LEVEL SECURITY/)
  assert.match(A.STORE_ACCOUNTS_SQL, /ADD COLUMN IF NOT EXISTS shopper_id UUID/)
  assert.equal(A.STORE_ACCOUNTS_LOCK, 724519018)
})

test('Shop accounts: sign-in is on by default and can be switched off', () => {
  assert.equal(S.defaultStorefront().accounts, true)
  assert.equal(S.readStorefront({}).accounts, true)
  assert.equal(S.readStorefront({ accounts: false }).accounts, false)
})

test('Shop accounts: a saved cart keeps only real products and sensible amounts; carts join', () => {
  assert.deepEqual(A.cleanCart({ [P1]: 3, [P2]: 500, 'x': 2, [P1.replace('1', '3')]: 0 }, new Set([P1, P2])), { [P1]: 3, [P2]: 99 })
  assert.deepEqual(A.cleanCart({ [P1]: 2 }, new Set([P2])), {})
  assert.deepEqual(A.cleanCart(['nope']), {})
  assert.deepEqual(A.mergeCarts({ [P1]: 1 }, { [P1]: 4, [P2]: 2 }), { [P1]: 4, [P2]: 2 })
})

test('Shop accounts: a saved address keeps only the checkout fields', () => {
  assert.deepEqual(A.cleanAddress({ address_line_1: ' 12, Road 3 ', city: 'Hyderabad', evil: '<x>' }), { address_line_1: '12, Road 3', address_line_2: '', city: 'Hyderabad', state: '', pincode: '' })
  assert.equal(A.cleanAddress({}), null)
  assert.equal(A.cleanAddress(null), null)
})

test('Shop accounts: the shopper sees plain words for each order status', () => {
  const d = { shipping_address: { handover: 'delivery' } }
  const p = { shipping_address: { handover: 'pickup' } }
  assert.equal(A.shopperStatus({ status: 'payment_pending', ...d }).label, 'Waiting for payment')
  assert.equal(A.shopperStatus({ status: 'cod_confirmed', ...d }).label, 'Confirmed')
  assert.equal(A.shopperStatus({ status: 'shipped', ...d }).label, 'On the way')
  assert.equal(A.shopperStatus({ status: 'shipped', ...p }).label, 'Ready to pick up')
  assert.equal(A.shopperStatus({ status: 'delivered', ...p }).label, 'Picked up')
  assert.equal(A.shopperStatus({ status: 'canceled', ...d }).label, 'Cancelled')
})

test('Shop accounts: the order timeline follows the order', () => {
  const ship = { handover: 'delivery', shipped_at: '2026-11-15T10:00:00Z' }
  const states = (order) => A.orderTimeline(order).map((s) => `${s.key}:${s.state}`).join(' ')
  assert.equal(states({ status: 'payment_pending', shipping_address: ship }), 'placed:now confirmed:next shipped:next delivered:next')
  assert.equal(states({ status: 'cod_confirmed', shipping_address: ship }), 'placed:done confirmed:now shipped:next delivered:next')
  assert.equal(states({ status: 'shipped', shipping_address: ship }), 'placed:done confirmed:done shipped:now delivered:next')
  assert.equal(states({ status: 'delivered', shipping_address: ship }), 'placed:done confirmed:done shipped:done delivered:done')
  assert.equal(states({ status: 'canceled', shipping_address: ship }), 'placed:done canceled:stopped')
  const shipped = A.orderTimeline({ status: 'shipped', created_at: '2026-11-14T10:00:00Z', shipping_address: ship })
  assert.equal(shipped[2].label, 'On the way')
  assert.equal(shipped[2].at, '2026-11-15T10:00:00Z')
  assert.equal(A.orderTimeline({ status: 'shipped', shipping_address: { handover: 'pickup' } })[2].label, 'Ready to pick up')
  assert.match(A.orderTimeline({ status: 'payment_pending', shipping_address: ship })[0].label, /waiting for payment/)
})

test('Shop accounts: the order view shows nothing about the workspace or the team', () => {
  const order = { id: 'secret-id', organization_id: 'org', contact_id: 'c', conversation_id: 'conv', order_number: 'ORD-1', status: 'paid', payment_status: 'paid', payment_method: 'razorpay', total_amount: 450, subtotal: 400, shipping_fee: 50, currency: 'INR', customer_note: 'note', internal_note: 'team only', shipping_address: { handover: 'delivery', address_line_1: '12 Road', city: 'Hyderabad', tracking_number: 'TRK1', carrier: 'DTDC' } }
  const view = A.shopperOrderView(order, [{ title: 'Soap', quantity: 2, unit_price: 200, total_price: 400, image_url: 'http://insecure/x.png', order_id: 'secret-id' }])
  const text = JSON.stringify(view)
  for (const hidden of ['secret-id', 'org', 'conv', 'team only', 'internal_note']) assert.ok(!text.includes(hidden), hidden)
  assert.equal(view.payment, 'Paid online')
  assert.equal(view.address, '12 Road, Hyderabad')
  assert.deepEqual(view.tracking, { number: 'TRK1', carrier: 'DTDC' })
  assert.equal(view.items[0].image, '', 'only https pictures')
})

test('Shop accounts: phones match on their last 10 digits', () => {
  assert.equal(A.samePhone('+91 98765 43210', '9876543210'), true)
  assert.equal(A.samePhone('919876543210', '+91-98765-43211'), false)
  assert.equal(A.samePhone('', ''), false)
  assert.equal(A.samePhone('12345', '12345'), false)
})

function fakeDb(tables) {
  return {
    from(table) {
      const filters = []
      const q = {
        select() { return q },
        eq(k, v) { filters.push([k, v]); return q },
        rows() { return (tables[table] || []).filter((r) => filters.every(([k, v]) => String(r[k]) === String(v))) },
        maybeSingle() { return Promise.resolve({ data: q.rows()[0] || null }) },
        then(resolve) { return Promise.resolve({ data: q.rows() }).then(resolve) },
      }
      return q
    },
  }
}

test('Shop accounts: a guest tracks an order with its number and phone, and nothing else', async () => {
  const db = fakeDb({
    commerce_orders: [
      { id: 'o1', organization_id: 'org1', order_number: 'ORD-241115-0001', status: 'shipped', shipping_address: { handover: 'delivery', phone_number: '+919876543210' } },
      { id: 'o2', organization_id: 'org1', order_number: 'ORD-241115-0002', status: 'paid', contact_id: 'c1', shipping_address: { handover: 'pickup' } },
    ],
    commerce_order_items: [{ order_id: 'o1', title: 'Saree', quantity: 1, unit_price: 4299, total_price: 4299 }],
    contacts: [{ id: 'c1', organization_id: 'org1', phone_number: '+918888877777' }],
  })
  const found = await A.trackOrder(db, 'org1', '#ord-241115-0001', '98765 43210')
  assert.equal(found.status, 'On the way')
  assert.equal(found.items[0].title, 'Saree')
  assert.equal(await A.trackOrder(db, 'org1', 'ORD-241115-0001', '9999999999'), null, 'wrong phone')
  assert.equal(await A.trackOrder(db, 'org2', 'ORD-241115-0001', '9876543210'), null, 'another store')
  assert.equal(await A.trackOrder(db, 'org1', "ORD-1' or 1=1", '9876543210'), null, 'odd order number')
  // A pick-up order: the phone comes from the customer's contact
  assert.equal((await A.trackOrder(db, 'org1', 'ORD-241115-0002', '8888877777')).status, 'Confirmed')
})

test('Shop accounts: the shopper comes only from a valid sign-in token', async () => {
  const db = { auth: { getUser: async (token) => (token === 'good' ? { data: { user: { id: 'u1', email: 'a@b.in', user_metadata: { full_name: 'Asha', avatar_url: 'https://pic/a.png' } } }, error: null } : { data: { user: null }, error: { message: 'bad' } }) } }
  const req = (h) => ({ headers: { get: (n) => (n === 'authorization' ? h : null) } })
  assert.deepEqual(await A.shopperFrom(req('Bearer good'), db), { id: 'u1', email: 'a@b.in', name: 'Asha', picture: 'https://pic/a.png' })
  assert.equal(await A.shopperFrom(req('Bearer bad'), db), null)
  assert.equal(await A.shopperFrom(req(null), db), null)
  assert.equal(await A.shopperFrom(req('Basic good'), db), null)
})

test('Shop accounts: sign-in returns only to WAMA or the store\'s own domain', () => {
  const app = 'https://wamacrm.magnetora.in'
  assert.equal(C.safeReturn('https://shop.glow.in', app, 'shop.glow.in'), 'https://shop.glow.in')
  assert.equal(C.safeReturn('https://wamacrm.magnetora.in/s/x', app, null), app)
  assert.equal(C.safeReturn('https://evil.example.com', app, 'shop.glow.in'), app)
  assert.equal(C.safeReturn('http://shop.glow.in', app, 'shop.glow.in'), app, 'never plain http')
  assert.equal(C.safeReturn('javascript:alert(1)', app, 'shop.glow.in'), app)
  const packed = C.packSession('access.token.here', 'refresh123')
  assert.deepEqual(C.unpackSession(packed), { access_token: 'access.token.here', refresh_token: 'refresh123' })
  assert.equal(C.unpackSession('not-base64!!'), null)
})

test('Shop accounts: orders are linked to the signed-in shopper, and the account needs a sign-in', () => {
  const order = fs.readFileSync(path.join(root, 'app/api/public/store/[slug]/order/route.ts'), 'utf8')
  assert.match(order, /shopperFrom\(request, db\)/)
  assert.match(order, /update\(\{ shopper_id: shopper\.id \}\)/)
  const account = fs.readFileSync(path.join(root, 'app/api/public/store/[slug]/account/route.ts'), 'utf8')
  assert.match(account, /Please sign in again/)
  assert.match(account, /page\.settings\.accounts/)
  const track = fs.readFileSync(path.join(root, 'app/api/public/store/[slug]/track/route.ts'), 'utf8')
  assert.match(track, /checkRateLimit\(`store-track/)
})
