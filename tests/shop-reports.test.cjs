require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const R = require('../lib/commerce/shop-reports.ts')
const RS = require('../lib/commerce/shop-reports-store.ts')
const { salonDb } = require('./salon-fake-db.cjs')
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
const ORG = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-11-18T12:00:00+05:30')

test('periods and India days', () => {
  assert.equal(R.readPeriod('7'), 7)
  assert.equal(R.readPeriod('365'), 30)
  assert.equal(R.readPeriod('1'), 1)
  assert.equal(R.readChannel('in_chat'), 'in_chat')
  assert.equal(R.readChannel('x'), null)
  assert.equal(R.istDay('2026-11-17T20:00:00Z'), '2026-11-18')
  const days = R.periodDays(7, NOW)
  assert.equal(days.length, 7)
  assert.equal(days[6], '2026-11-18')
  assert.equal(days[0], '2026-11-12')
  assert.equal(R.periodStart(7, NOW), '2026-11-11T18:30:00.000Z')
})

test('report: counts, sales, what sells, carts, customers', () => {
  const orders = [
    { id: 'a', status: 'delivered', total_amount: 1000, created_at: '2026-11-18T05:00:00Z', checkout_type: 'website', shipping_address: { full_name: 'Asha', phone_number: '+91 98765 43210' } },
    { id: 'b', status: 'cod_confirmed', total_amount: 500, created_at: '2026-11-17T05:00:00Z', checkout_type: 'in_chat', shipping_address: { full_name: 'Asha', phone_number: '9876543210' } },
    { id: 'c', status: 'paid', total_amount: 300, created_at: '2026-11-16T05:00:00Z', checkout_type: 'website', shipping_address: { full_name: 'Ravi', phone_number: '+919000000001' } },
    { id: 'd', status: 'canceled', total_amount: 900, created_at: '2026-11-16T05:00:00Z', checkout_type: 'website', shipping_address: {} },
    { id: 'e', status: 'payment_pending', total_amount: 900, created_at: '2026-11-16T05:00:00Z', checkout_type: 'website', shipping_address: {} },
    { id: 'old', status: 'delivered', total_amount: 9999, created_at: '2026-10-01T05:00:00Z', checkout_type: 'website', shipping_address: {} },
  ]
  const items = [
    { order_id: 'a', product_id: 'p1', title: 'Saree', quantity: 2, total_price: 800 },
    { order_id: 'a', product_id: 'p2', title: 'Bag', quantity: 1, total_price: 200 },
    { order_id: 'b', product_id: 'p2', title: 'Bag', quantity: 2, unit_price: 250 },
    { order_id: 'd', product_id: 'p1', title: 'Saree', quantity: 5, total_price: 900 },
  ]
  const checkouts = [
    { created_at: '2026-11-17T05:00:00Z', reminded_at: '2026-11-17T06:00:00Z', recovered_order_id: null, total: 700 },
    { created_at: '2026-11-17T05:00:00Z', reminded_at: null, recovered_order_id: 'a', total: 1000 },
  ]
  const r = R.buildShopReport({ days: 7, now: NOW, orders, items, checkouts, visits: [{ day: '2026-11-18', visits: 40, product_views: 90 }, { day: '2026-11-17', visits: 60 }, { day: '2026-01-01', visits: 999 }], earlierPhones: ['+919000000001'] })
  assert.equal(r.orders, 3)
  assert.equal(r.sales, 1800)
  assert.equal(r.averageOrder, 600)
  assert.equal(r.cancelled, 1)
  assert.equal(r.visits, 100)
  assert.equal(r.productViews, 90)
  assert.equal(r.conversion, 2) // 2 website orders / 100 visits
  assert.deepEqual(r.topProducts.map((p) => [p.title, p.quantity, p.sales]), [['Bag', 3, 700], ['Saree', 2, 800]])
  assert.deepEqual(r.channels.map((c) => [c.label, c.orders]), [['Website', 2], ['WhatsApp', 1]])
  assert.deepEqual(r.carts, { left: 1, reminded: 1, cameBack: 1, value: 700 })
  assert.equal(r.customers[0].name, 'Asha')
  assert.equal(r.customers[0].orders, 2)
  assert.equal(r.customers[0].spent, 1500)
  // Ravi ordered before this week (returning); Asha's first order is this week (new), and she ordered twice (repeat)
  assert.equal(r.returningCustomers, 1)
  assert.equal(r.newCustomers, 1)
  assert.equal(r.repeatCustomers, 1)
  assert.equal(r.received, 0) // nothing marked paid in this list
  assert.equal(r.channel, null)
  assert.equal(r.daily.find((d) => d.day === '2026-11-18').sales, 1000)
  const empty = R.buildShopReport({ days: 30, now: NOW, orders: [], items: [], checkouts: [], visits: [] })
  assert.equal(empty.conversion, null)
  assert.equal(empty.daily.length, 30)
})

test('report: one channel, money received, today, and the period before', () => {
  const orders = [
    { id: 'w1', status: 'delivered', payment_status: 'paid', total_amount: 400, created_at: '2026-11-18T05:00:00Z', checkout_type: 'website', shipping_address: { full_name: 'Asha', phone_number: '9876543210' } },
    { id: 'c1', status: 'cod_confirmed', payment_status: 'pending', total_amount: 250, created_at: '2026-11-17T05:00:00Z', checkout_type: 'in_chat', contact: { first_name: 'Ravi', phone_number: '+919000000001' } },
    // the 7 days before this week
    { id: 'w0', status: 'delivered', payment_status: 'paid', total_amount: 100, created_at: '2026-11-08T05:00:00Z', checkout_type: 'website', shipping_address: { phone_number: '+91 98765 43210' } },
    { id: 'c0', status: 'canceled', total_amount: 999, created_at: '2026-11-08T05:00:00Z', checkout_type: 'in_chat' },
  ]
  const visits = [{ day: '2026-11-18', visits: 20 }, { day: '2026-11-09', visits: 10 }]
  const checkouts = [{ created_at: '2026-11-17T05:00:00Z', total: 300 }]
  const all = R.buildShopReport({ days: 7, now: NOW, orders, items: [], checkouts, visits })
  assert.equal(all.sales, 650)
  assert.equal(all.received, 400)
  assert.deepEqual(all.before, { orders: 1, sales: 100, visits: 10 })
  assert.equal(all.returningCustomers, 1) // Asha's phone ordered last week (written differently)
  const chat = R.buildShopReport({ days: 7, now: NOW, orders, items: [], checkouts, visits, channel: 'in_chat' })
  assert.equal(chat.orders, 1)
  assert.equal(chat.sales, 250)
  assert.equal(chat.visits, 0) // visits and carts belong to the website
  assert.equal(chat.conversion, null)
  assert.equal(chat.carts.left, 0)
  assert.equal(chat.customers[0].name, 'Ravi') // WhatsApp orders keep the phone on the contact
  assert.deepEqual(chat.channels.map((c) => c.label), ['Website', 'WhatsApp']) // the split always shows every channel
  const web = R.buildShopReport({ days: 7, now: NOW, orders, items: [], checkouts, visits, channel: 'website' })
  assert.equal(web.conversion, 5)
  const today = R.buildShopReport({ days: 1, now: NOW, orders, items: [], checkouts, visits })
  assert.equal(today.orders, 1)
  assert.equal(today.daily.length, 1)
  assert.deepEqual(today.before, { orders: 1, sales: 250, visits: 0 }) // yesterday
})

test('visits are counted per day (without a direct database connection)', async () => {
  const db = salonDb({ commerce_store_visits: [] })
  await RS.countVisit(db, ORG, 'visit', NOW, null)
  await RS.countVisit(db, ORG, 'visit', NOW, null)
  await RS.countVisit(db, ORG, 'product', NOW, null)
  assert.deepEqual(db.tables.commerce_store_visits.map((r) => [r.day, r.visits, r.product_views]), [['2026-11-18', 2, 1]])
  const calls = []
  await RS.countVisit(db, ORG, 'product', NOW, { query: async (sql, args) => calls.push([sql, args]) })
  assert.match(calls[0][0], /ON CONFLICT \(organization_id, day\) DO UPDATE SET product_views = commerce_store_visits\.product_views \+ 1/)
})

test('wiring: migration, tab, store page counts visits', () => {
  assert.equal(read('supabase/migrations/20261130_shop_reports.sql'), RS.REPORTS_SQL)
  assert.match(read('app/dashboard/commerce/page.tsx'), /<ReportsTab /)
  assert.match(read('app/s/[slug]/storefront.tsx'), /\/visit`/)
  assert.match(read('lib/connector-nav.ts'), /'products', 'reports'/)
})
