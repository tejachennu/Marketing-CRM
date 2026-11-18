require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const I = require('../lib/commerce/invoice.ts')
const IS = require('../lib/commerce/invoice-store.ts')
const { salonDb } = require('./salon-fake-db.cjs')
const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const ORG = '11111111-1111-4111-8111-111111111111'
const P1 = '22222222-2222-4222-8222-222222222221'
const P2 = '22222222-2222-4222-8222-222222222222'
const O1 = '44444444-4444-4444-8444-444444444441'
const O2 = '44444444-4444-4444-8444-444444444442'
const GSTIN = '36ABCDE1234F1Z5' // Telangana

test('settings: GSTIN checked, prefix and rate cleaned', () => {
  assert.deepEqual(I.readInvoiceSettings(null), { gstin: '', legalName: '', address: '', prefix: 'WEB', defaultRate: 0 })
  const bad = I.parseInvoiceSettings({ gstin: '36ABC' })
  assert.equal(bad.field, 'gstin')
  assert.equal(I.parseInvoiceSettings({ defaultRate: 55 }).field, 'defaultRate')
  const ok = I.parseInvoiceSettings({ gstin: ' 36abcde1234f1z5 ', prefix: 'my-shop!', defaultRate: '18' })
  assert.deepEqual(ok.settings, { gstin: GSTIN, legalName: '', address: '', prefix: 'MYSHO', defaultRate: 18 })
  assert.equal(I.readRate(''), null)
  assert.equal(I.readRate('5'), 5)
  assert.equal(I.readRate(-1), null)
})

test('states: names, short forms and GSTIN digits', () => {
  assert.equal(I.stateCodeOf('Telangana'), '36')
  assert.equal(I.stateCodeOf(' andhra pradesh '), '37')
  assert.equal(I.stateCodeOf('TS'), '36')
  assert.equal(I.stateCodeOf('Orissa'), '21')
  assert.equal(I.stateCodeOf('Tamil Nadu'), '33')
  assert.equal(I.stateCodeOf('27'), '27')
  assert.equal(I.stateCodeOf('Narnia'), null)
  assert.equal(I.stateCodeOf(''), null)
  assert.equal(I.stateOfGstin(GSTIN), '36')
  assert.equal(I.stateOfGstin('bad'), null)
})

test('numbers run per financial year (April to March, India time)', () => {
  assert.equal(I.financialYear(new Date('2026-04-01T00:00:00+05:30')), '26-27')
  assert.equal(I.financialYear(new Date('2026-03-31T23:59:00+05:30')), '25-26')
  // 31 March 20:00 UTC is already 1 April in India
  assert.equal(I.financialYear(new Date('2026-03-31T20:00:00Z')), '26-27')
  assert.equal(I.shopInvoiceNumber('web', '26-27', 7), 'WEB/26-27/0007')
  assert.ok(I.shopInvoiceNumber('ABCDE', '26-27', 9999).length <= 16)
})

test('maths: GST taken out of the price; offer shared; delivery at the highest rate; total = what was paid', () => {
  const t = I.computeShopInvoice({
    items: [{ name: 'Saree', hsn: '5007', quantity: 2, unitPrice: 1050, rate: 5 }, { name: 'Bag', quantity: 1, unitPrice: 1180, rate: 18 }],
    delivery: 100, discount: 330, registered: true, interState: false,
  })
  assert.equal(t.itemsTotal, 3280)
  assert.equal(t.total, 3280 + 100 - 330)
  assert.equal(t.discount, 330)
  assert.equal(t.lines.length, 3)
  assert.deepEqual(t.lines.map((l) => l.rate), [5, 18, 18])
  assert.equal(t.lines[2].name, 'Delivery charge')
  assert.equal(Math.round(t.lines.reduce((s, l) => s + l.discount, 0) * 100) / 100, 330)
  for (const l of t.lines) {
    assert.equal(Math.round((l.taxable + l.tax) * 100) / 100, l.total)
    assert.equal(Math.round((l.cgst + l.sgst) * 100) / 100, l.tax)
    assert.equal(l.igst, 0)
  }
  assert.equal(Math.round((t.taxable + t.tax) * 100) / 100, t.total)
  assert.deepEqual(t.taxSummary.map((r) => r.rate), [5, 18])
  // Without the offer a ₹1,180 bag at 18% is ₹1,000 + ₹180
  const bag = I.computeShopInvoice({ items: [{ name: 'Bag', quantity: 1, unitPrice: 1180, rate: 18 }], registered: true, interState: true })
  assert.deepEqual([bag.lines[0].taxable, bag.lines[0].igst, bag.cgst, bag.total], [1000, 180, 0, 1180])
})

test('maths: no GSTIN → plain bill, no tax at all', () => {
  const t = I.computeShopInvoice({ items: [{ name: 'Bag', quantity: 1, unitPrice: 1180, rate: 18 }], delivery: 50, registered: false, interState: false })
  assert.equal(t.tax, 0)
  assert.equal(t.taxable, 1230)
  assert.equal(t.total, 1230)
  assert.ok(t.lines.every((l) => l.rate === 0))
})

function shop(extra = {}) {
  return salonDb({
    organizations: [{ id: ORG, name: 'Asha Silks', contact_address: 'Ameerpet, Hyderabad', contact_phone: '+919000000000', shop_invoice: { gstin: GSTIN, prefix: 'AS', defaultRate: 5 }, storefront: {} }],
    commerce_products: [{ id: P1, gst_rate: null, hsn_code: '5007' }, { id: P2, gst_rate: 18, hsn_code: null }],
    commerce_orders: [
      { id: O1, organization_id: ORG, order_number: 'W-101', status: 'cod_confirmed', payment_method: 'cod', payment_status: 'pending', shipping_fee: 60, discount_amount: 0, total_amount: 2340,
        shipping_address: { handover: 'delivery', full_name: 'Ravi Kumar', phone_number: '+919876543210', address_line_1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001', review_token: 'keepme' } },
      { id: O2, organization_id: ORG, order_number: 'W-102', status: 'payment_pending', shipping_fee: 0, total_amount: 500, shipping_address: { handover: 'pickup' } },
    ],
    commerce_order_items: [
      { order_id: O1, product_id: P1, title: 'Saree', variant_name: 'Red', quantity: 1, unit_price: 1100 },
      { order_id: O1, product_id: P2, title: 'Bag', quantity: 1, unit_price: 1180 },
      { order_id: O2, product_id: P1, title: 'Saree', quantity: 1, unit_price: 500 },
    ],
    commerce_invoices: [],
    ...extra,
  })
}

test('issue: numbered, kept as issued, IGST for another state, same invoice the second time', async () => {
  const db = shop()
  const now = new Date('2026-11-18T10:00:00Z')
  const inv = await IS.issueInvoice(db, ORG, O1, now)
  assert.equal(inv.number, 'AS/26-27/0001')
  assert.equal(inv.registered, true)
  assert.equal(inv.inter_state, true) // Telangana shop → Karnataka customer
  assert.equal(inv.place_of_supply, 'Karnataka (29)')
  assert.equal(Number(inv.total), 2340)
  assert.equal(inv.lines[0].name, 'Saree · Red')
  assert.equal(inv.lines[0].rate, 5) // the shop's usual rate
  assert.equal(inv.lines[0].hsn, '5007')
  assert.equal(inv.lines[1].rate, 18) // the product's own rate
  assert.ok(Number(inv.igst) > 0 && Number(inv.cgst) === 0)
  assert.equal(inv.business.gstin, GSTIN)
  assert.equal(inv.customer.name, 'Ravi Kumar')
  assert.equal(inv.payment, 'Cash on delivery')
  // The token goes on the order for My orders, without losing what was there
  const order = db.tables.commerce_orders.find((o) => o.id === O1)
  assert.equal(order.shipping_address.invoice_token, inv.public_token)
  assert.equal(order.shipping_address.review_token, 'keepme')
  const again = await IS.issueInvoice(db, ORG, O1, now)
  assert.equal(again.id, inv.id)
  assert.equal(db.tables.commerce_invoices.length, 1)
  assert.equal((await IS.invoiceByToken(db, inv.public_token)).id, inv.id)
  assert.equal(await IS.invoiceByToken(db, 'short'), null)
})

test('issue: not for orders waiting for payment; numbers go on; cancel marks it', async () => {
  const db = shop({ commerce_invoices: [{ id: 'x', organization_id: ORG, order_id: 'other', fy: '26-27', seq: 41, status: 'issued' }] })
  assert.equal(await IS.issueInvoice(db, ORG, O2), null)
  assert.equal(await IS.issueInvoice(db, '99999999-9999-4999-8999-999999999999', O1), null)
  const inv = await IS.issueInvoice(db, ORG, O1, new Date('2026-11-18T10:00:00Z'))
  assert.equal(inv.number, 'AS/26-27/0042')
  await IS.cancelInvoiceFor(db, ORG, O1)
  assert.equal(db.tables.commerce_invoices.find((r) => r.id === inv.id).status, 'cancelled')
})

test('issue: same state → CGST + SGST; pick up counts as the shop’s state', async () => {
  const db = shop()
  db.tables.commerce_orders[0].shipping_address = { handover: 'pickup', full_name: 'Ravi' }
  db.tables.commerce_orders[0].shipping_fee = 0
  const inv = await IS.issueInvoice(db, ORG, O1, new Date('2026-11-18T10:00:00Z'))
  assert.equal(inv.inter_state, false)
  assert.equal(inv.place_of_supply, 'Telangana (36)')
  assert.ok(Number(inv.cgst) > 0 && Number(inv.cgst) === Number(inv.sgst) && Number(inv.igst) === 0)
})

test('issue: a number taken at the same moment → the next one', async () => {
  const db = shop()
  const realFrom = db.from
  let failed = false
  db.from = (table) => {
    const q = realFrom(table)
    if (table !== 'commerce_invoices') return q
    const insert = q.insert.bind(q)
    q.insert = (values) => {
      if (!failed) {
        failed = true
        db.tables.commerce_invoices.push({ id: 'y', organization_id: ORG, order_id: 'someone-else', fy: values.fy, seq: values.seq, status: 'issued' })
        return { select: () => ({ single: () => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } }) }) }
      }
      return insert(values)
    }
    return q
  }
  const inv = await IS.issueInvoice(db, ORG, O1, new Date('2026-11-18T10:00:00Z'))
  assert.equal(inv.number, 'AS/26-27/0002')
})

test('product form GST value; links', () => {
  assert.equal(IS.productGstValue({}), null)
  assert.deepEqual(IS.productGstValue({ gst_rate: '' }), { gst_rate: null })
  assert.deepEqual(IS.productGstValue({ gst_rate: '18' }), { gst_rate: 18 })
  assert.equal(IS.invoiceLink('https://app.example/', 'abc'), 'https://app.example/invoice/abc')
  assert.equal(IS.canInvoice({ status: 'delivered' }), true)
  assert.equal(IS.canInvoice({ status: 'cart_submitted' }), false)
})

test('wiring: migration, hooks on delivered / shipped / cancelled, screens', () => {
  assert.equal(read('supabase/migrations/20261129_shop_invoices.sql'), IS.INVOICE_SQL)
  const orders = read('app/api/commerce/orders/route.ts')
  assert.match(orders, /status === 'shipped'\) await issueInvoiceQuietly/)
  assert.match(orders, /status === 'delivered'\) await afterDelivered/)
  assert.match(read('lib/commerce/order-delivered.ts'), /issueInvoiceQuietly\(db, organizationId, orderId\)/)
  assert.match(orders, /cancelInvoiceFor\(supabase, organizationId, orderId\)/)
  assert.match(read('app/api/webhooks/parcel-updates/route.ts'), /afterDelivered\(db, shipment.organization_id, id/)
  assert.match(read('app/api/cron/shop/route.ts'), /afterDelivered\(db, shipment.organization_id, id/)
  assert.match(read('components/commerce/orders-tab.tsx'), /<OrderInvoice /)
  assert.match(read('app/dashboard/commerce/page.tsx'), /<InvoiceSettingsCard /)
  assert.match(read('app/api/commerce/products/route.ts'), /productGstValue\(product\)/)
  assert.match(read('app/s/[slug]/account.tsx'), /order\.invoice &&/)
})
