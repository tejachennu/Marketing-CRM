require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const M = require('../lib/commerce/shop-messages.ts')
const CR = require('../lib/commerce/cart-reminders.ts')
const COD = require('../lib/commerce/cod-check.ts')
const SA = require('../lib/commerce/stock-alerts.ts')
const SS = require('../lib/commerce/shop-sales-store.ts')
const { salonDb } = require('./salon-fake-db.cjs')
const root = path.join(__dirname, '..')
const ORG = '11111111-1111-4111-8111-111111111111'
const P1 = '22222222-2222-4222-8222-222222222222'
const V1 = '33333333-3333-4333-8333-333333333331'
const O1 = '44444444-4444-4444-8444-444444444441'

test('message settings: defaults, cleaning, template with blanks and button payloads', () => {
  const m = M.readShopMessages({ cart_reminder: { on: true, template: 'Cart Reminder!', language: 'en_US' } })
  assert.deepEqual(m.cart_reminder, { on: true, template: 'cartreminder', language: 'en_US' })
  assert.equal(m.cod_confirm.on, true, 'COD check is on unless switched off')
  assert.equal(M.readShopMessages({}).cart_reminder.on, false, 'cart reminder is off until switched on')
  const t = M.templatePayload('+91 98765 43210', { on: true, template: 'cod_check', language: 'en' }, ['Asha', 'W-1', '₹950', 'Glow'], ['codok:x', 'codno:x'])
  assert.equal(t.to, '919876543210')
  assert.deepEqual(t.template.components[0].parameters.map((p) => p.text), ['Asha', 'W-1', '₹950', 'Glow'])
  assert.deepEqual(t.template.components[2], { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'codno:x' }] })
  assert.deepEqual(M.readShopButton(`codok:${O1}`), { kind: 'codok', orderId: O1 })
  assert.equal(M.readShopButton('codok:nope'), null)
  assert.equal(M.codCheckLabel({ shipping_address: { cod_check: { asked_at: 'x' } } }).text, "Waiting for the customer's yes on WhatsApp")
  assert.equal(M.codCheckLabel({ shipping_address: { cod_check: { answer: 'cancel' } } }).red, true)
})

const page = { products: [
  { id: P1, title: 'Shirt', price: 500, variants: [{ id: V1, name: 'M', price: 550, inStock: true }] },
  { id: '22222222-2222-4222-8222-222222222229', title: 'Cap', price: 200 },
] }

test('cart reminder: saved per phone, reminded once after an hour, stopped by an order', async () => {
  const r = CR.readCart(page, { [`${P1}:${V1}`]: 2, [P1]: 1, '22222222-2222-4222-8222-222222222229': 1, junk: 3 })
  assert.deepEqual(Object.keys(r.cart), [`${P1}:${V1}`, '22222222-2222-4222-8222-222222222229'], 'a product with options needs its option')
  assert.equal(r.total, 1300)
  assert.equal(r.summary, '2 × Shirt (M), 1 × Cap')
  const db = salonDb({ commerce_checkouts: [] })
  const token = await CR.saveCheckout(db, ORG, page, { phone: '+919876543210', name: 'Asha Rao', cart: { [`${P1}:${V1}`]: 1 } })
  assert.match(token, /^[A-Za-z0-9_-]{20,}$/)
  assert.equal(await CR.saveCheckout(db, ORG, page, { phone: '+91 98765 43210', cart: { '22222222-2222-4222-8222-222222222229': 2 } }), token, 'same phone, same cart row')
  assert.equal(db.tables.commerce_checkouts.length, 1)
  assert.equal((await CR.cartByToken(db, ORG, token)).cart['22222222-2222-4222-8222-222222222229'], 2)
  const msg = CR.reminderMessage({ name: 'Asha Rao', summary: '2 × Cap' }, 'Glow', 'https://x/s/glow?cart=t')
  assert.match(msg.text, /^Hi Asha, you left 2 × Cap in your cart at Glow/)
  assert.deepEqual(msg.values, ['Asha', '2 × Cap', 'Glow', 'https://x/s/glow?cart=t'])
  // An hour later: reminded once (WhatsApp not connected here, so it is marked but not sent)
  db.tables.commerce_checkouts[0].updated_at = new Date(Date.now() - 2 * 3600_000).toISOString()
  let res = await CR.sendDueReminders(db, { storeLink: () => 'https://x/s/glow', loadOrg: async () => ({ id: ORG, name: 'Glow' }) })
  assert.equal(res.due, 1)
  assert.ok(db.tables.commerce_checkouts[0].reminded_at)
  res = await CR.sendDueReminders(db, { storeLink: () => '', loadOrg: async () => ({}) })
  assert.equal(res.due, 0, 'never twice')
  await CR.markRecovered(db, ORG, '+919876543210', O1)
  assert.equal(db.tables.commerce_checkouts[0].recovered_order_id, O1)
})

test('COD check: only for COD orders not shipped; Yes and Cancel are kept on the order', async () => {
  assert.equal(COD.needsCodCheck({ payment_method: 'cod', status: 'cod_confirmed', shipping_address: { handover: 'delivery' } }), true)
  assert.equal(COD.needsCodCheck({ payment_method: 'razorpay', status: 'paid' }), false)
  assert.equal(COD.needsCodCheck({ payment_method: 'cod', status: 'shipped' }), false)
  const order = { id: O1, organization_id: ORG, order_number: 'W-1', status: 'cod_confirmed', payment_method: 'cod', total_amount: 950, currency: 'INR', shipping_address: { full_name: 'Asha', handover: 'delivery' }, items: [{ variant_id: V1, quantity: 2 }] }
  const db = salonDb({ commerce_orders: [order], commerce_order_items: [], commerce_product_variants: [{ id: V1, organization_id: ORG, stock: 3 }] })
  const org = { id: ORG }
  assert.deepEqual(await COD.handleCodButton(db, org, 'something-else', '+919876543210'), { handled: false })
  assert.equal((await COD.handleCodButton(db, org, `codok:${O1}`, '+919876543210')).outcome, 'confirmed')
  assert.equal(db.tables.commerce_orders[0].shipping_address.cod_check.answer, 'yes')
  assert.equal(db.tables.commerce_orders[0].status, 'cod_confirmed')
  // The fake database has no joined items, so put them on the row for the cancel path
  db.tables.commerce_orders[0].items = [{ variant_id: V1, quantity: 2 }]
  assert.equal((await COD.handleCodButton(db, org, `codno:${O1}`, '+919876543210')).outcome, 'cancelled')
  assert.equal(db.tables.commerce_orders[0].status, 'canceled')
  assert.equal(db.tables.commerce_product_variants[0].stock, 5, 'the size\'s stock comes back')
  db.tables.commerce_orders[0].status = 'shipped'
  assert.equal((await COD.handleCodButton(db, org, `codno:${O1}`, '+919876543210')).outcome, 'too_late')
})

test('back in stock: one request per phone and product, sent once when it is back', async () => {
  const db = salonDb({ commerce_stock_alerts: [], commerce_products: [{ id: P1, organization_id: ORG, title: 'Shirt', is_available: true, inventory_count: 0 }], commerce_product_variants: [], organizations: [{ id: ORG, name: 'Glow', slug: 'glow' }] })
  assert.equal((await SA.addStockAlert(db, ORG, { productId: P1, phone: '+919876543210' })).already, false)
  assert.equal((await SA.addStockAlert(db, ORG, { productId: P1, phone: '9876543210' })).already, true)
  assert.match((await SA.addStockAlert(db, ORG, { productId: P1, phone: '123' })).reason, /WhatsApp number/)
  assert.equal((await SA.notifyBackInStock(db, ORG, P1, () => 'https://x/s/glow')).sent, 0)
  assert.equal(db.tables.commerce_stock_alerts[0].sent_at, undefined, 'still sold out: nobody told')
  db.tables.commerce_products[0].inventory_count = 5
  await SA.notifyBackInStock(db, ORG, P1, () => 'https://x/s/glow')
  assert.ok(db.tables.commerce_stock_alerts[0].sent_at, 'back: marked as told (WhatsApp is not connected in this test)')
  assert.equal(SA.storeLinkFor('https://app/')({ slug: 'glow' }), 'https://app/s/glow')
  assert.equal(SA.storeLinkFor('https://app')({ store_domain: 'shop.in' }), 'https://shop.in')
})

test('wiring: migration, webhook taps, store page forms, cron, reorder', () => {
  assert.equal(fs.readFileSync(path.join(root, 'supabase/migrations/20261127_shop_whatsapp_selling.sql'), 'utf8'), SS.SALES_SQL)
  const hook = fs.readFileSync(path.join(root, 'app/api/webhooks/facebook/[orgIdAndSlug]/route.ts'), 'utf8')
  assert.match(hook, /handleCodButton\(supabase, orgData, interactiveButtonId, phoneNumber\)/)
  const order = fs.readFileSync(path.join(root, 'app/api/public/store/[slug]/order/route.ts'), 'utf8')
  assert.match(order, /askCodCheck\(db, fullOrg, order, parsed\.order\.customer\.phone\)/)
  assert.match(order, /markRecovered\(/)
  const store = fs.readFileSync(path.join(root, 'app/s/[slug]/storefront.tsx'), 'utf8')
  assert.match(store, /<BackInStock slug=/)
  assert.match(store, /checkout\?token=\$\{encodeURIComponent\(token\)\}/)
  assert.match(store, /onReorder=\{\(items\) =>/)
  assert.match(fs.readFileSync(path.join(root, 'app/api/cron/shop/route.ts'), 'utf8'), /sendDueReminders\(db/)
  assert.match(fs.readFileSync(path.join(root, 'lib/commerce/store-accounts.ts'), 'utf8'), /key: item\.product_id \?/)
})
