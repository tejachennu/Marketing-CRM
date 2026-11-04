// Round-two commerce rules that need no WhatsApp: order numbers in the store's time zone, the
// summary cache, catalog lookups in chunks, and cash collected on Cash on Delivery orders.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const utils = require('../lib/commerce/commerce-utils.ts')
const handlers = require('../lib/commerce/commerce-webhook-handler.ts')
const stats = require('../lib/commerce/commerce-stats.ts')
const meta = require('../lib/commerce/meta-commerce.ts')

// ── Order numbers carry the store's date, not the UTC date ───────────────────

test('Order numbers: the date is the store\'s own, so an Indian order before 05:30 is not dated yesterday', () => {
  const date = number => number.split('-')[1]
  // 22:30 UTC on 13 October is 04:00 on 14 October in India
  const lateEvening = new Date('2026-10-13T22:30:00.000Z')
  assert.equal(date(handlers.generateOrderNumber(lateEvening)), '261014')
  assert.equal(date(handlers.generateOrderNumber(lateEvening, 'Asia/Kolkata')), '261014')
  assert.equal(date(handlers.generateOrderNumber(lateEvening, 'America/New_York')), '261013')
  assert.equal(date(handlers.generateOrderNumber(lateEvening, 'UTC')), '261013')
  // A zone Intl does not know falls back to India's
  assert.equal(date(handlers.generateOrderNumber(lateEvening, 'Mars/Olympus')), '261014')
  // The format is unchanged: ORD-YYMMDD-XXXX with no 0/O or 1/I look-alikes
  assert.match(handlers.generateOrderNumber(new Date('2026-01-05T00:00:00.000Z'), 'Asia/Kolkata'), /^ORD-260105-[A-Z2-9]{4}$/)

  assert.equal(utils.DEFAULT_TIME_ZONE, 'Asia/Kolkata')
  assert.equal(utils.getOrganizationTimeZone({ timezone: 'Europe/London' }), 'Europe/London')
  assert.equal(utils.getOrganizationTimeZone({ timezone: ' Asia/Dubai ' }), 'Asia/Dubai')
  assert.equal(utils.getOrganizationTimeZone({}), 'Asia/Kolkata') // no such column yet
  assert.equal(utils.getOrganizationTimeZone({ timezone: 'nowhere' }), 'Asia/Kolkata')
  assert.equal(utils.getOrganizationTimeZone(null), 'Asia/Kolkata')
})

// ── The store summary is kept for 30 seconds per organization ────────────────

// Counts queries per organization; `broken` makes every query fail
function summaryDb(orders, broken = false) {
  const calls = []
  return {
    calls,
    from(table) {
      const filters = []
      let head = false
      const query = {
        select(columns, options = {}) { head = Boolean(options.head); return query },
        eq(key, value) { filters.push(row => row[key] === value); return query },
        neq(key, value) { filters.push(row => row[key] !== value); return query },
        in(key, list) { filters.push(row => list.includes(row[key])); return query },
        order() { return query },
        range() { return query },
        then(resolve, reject) {
          calls.push(table)
          if (broken) return Promise.reject(new Error('database down')).then(resolve, reject)
          const rows = orders.filter(row => filters.every(filter => filter(row)))
          return Promise.resolve(head ? { count: rows.length, error: null } : { data: rows, error: null, count: rows.length }).then(resolve, reject)
        },
      }
      return query
    },
  }
}
const order = (status, payment_status = 'pending', total_amount = 100, currency = 'INR') => ({ organization_id: 'org-a', status, payment_status, total_amount, currency })

test('Store summary: counted once per 30 seconds per organization, and again as soon as an order changes', async () => {
  const database = summaryDb([order('payment_pending'), order('paid', 'paid', 1040), order('shipped', 'paid', 500, 'usd'), order('canceled', 'paid', 200)])
  const first = await stats.getCommerceSummary(database, 'org-a', { now: 1_000_000 })
  assert.deepEqual(first, { total: 4, awaiting: 1, toShip: 1, shipped: 1, delivered: 0, canceled: 1, refundDue: 1, revenue: [{ currency: 'INR', amount: 1040 }, { currency: 'USD', amount: 500 }] })
  const cost = database.calls.length
  assert.ok(cost >= 8, `seven counts and a page of paid orders: ${cost} queries`)

  // Within 30 seconds: the same answer, no queries
  assert.equal(await stats.getCommerceSummary(database, 'org-a', { now: 1_000_000 + stats.SUMMARY_CACHE_MS - 1 }), first)
  assert.equal(database.calls.length, cost)
  // Another organization is counted on its own
  const other = summaryDb([{ organization_id: 'org-b', status: 'delivered', payment_status: 'paid', total_amount: 10, currency: 'INR' }])
  assert.equal((await stats.getCommerceSummary(other, 'org-b', { now: 1_000_000 })).delivered, 1)
  assert.equal(database.calls.length, cost)

  // An order changed (the orders route says so): counted afresh at once
  stats.invalidateCommerceSummary('org-a')
  assert.notEqual(await stats.getCommerceSummary(database, 'org-a', { now: 1_000_000 + 1 }), first)
  assert.equal(database.calls.length, cost * 2)
  // After 30 seconds the summary is counted again anyway
  await stats.getCommerceSummary(database, 'org-a', { now: 1_000_000 + 1 + stats.SUMMARY_CACHE_MS })
  assert.equal(database.calls.length, cost * 3)

  // A summary that could not be counted is not remembered: the next load tries again
  const broken = summaryDb([], true)
  assert.deepEqual(await stats.getCommerceSummary(broken, 'org-c', { now: 1 }), { total: 0, awaiting: 0, toShip: 0, shipped: 0, delivered: 0, canceled: 0, refundDue: 0, revenue: [] })
  const retried = database.calls.length
  await stats.getCommerceSummary(broken, 'org-c', { now: 2 })
  assert.ok(broken.calls.length > 1)
  assert.equal(database.calls.length, retried)
  stats.invalidateCommerceSummary('org-a')
  stats.invalidateCommerceSummary('org-b')
})

// ── Catalog lookups: ten SKUs per request, chunk after chunk ─────────────────

test('Catalog lookups: a large cart is looked up ten SKUs at a time, and every row comes back', async () => {
  const skus = Array.from({ length: 23 }, (_, index) => `SKU-${index + 1}`)
  const asked = []
  const fetcher = async (url, init) => {
    const chunk = JSON.parse(decodeURIComponent(String(url).match(/filter=([^&]+)/)[1])).retailer_id.is_any
    asked.push(chunk)
    assert.equal(init.headers.Authorization, 'Bearer token')
    assert.match(String(url), /^https:\/\/graph\.facebook\.com\/v25\.0\/123456789\/products\?/)
    return { ok: true, status: 200, json: async () => ({ data: chunk.map(sku => ({ id: `m-${sku}`, retailer_id: sku, name: `Product ${sku}`, price: '₹10.00', currency: 'INR', availability: 'in stock' })) }) }
  }

  const rows = await meta.fetchMetaProductsBySku('123456789', 'token', [...skus, 'SKU-1', ' ', ''], 'not-a-version', fetcher)
  // Ten per request; duplicates and blanks dropped
  assert.deepEqual(asked.map(chunk => chunk.length).sort((a, b) => b - a), [10, 10, 3])
  assert.deepEqual(rows.map(row => row.retailer_id), skus)
  assert.deepEqual([rows[0].title, rows[0].price, rows[0].is_available], ['Product SKU-1', 10, true])
  assert.equal(meta.SKU_LOOKUP_CHUNK, 10)

  // A failing request loses only its own SKUs, and the lookup never throws
  const flaky = async (url, init) => (decodeURIComponent(String(url)).includes('"SKU-11"') ? { ok: false, status: 500, json: async () => ({}) } : fetcher(url, init))
  const partial = await meta.fetchMetaProductsBySku('123456789', 'token', skus.slice(0, 12), 'v25.0', flaky)
  assert.deepEqual(partial.map(row => row.retailer_id), skus.slice(0, 10))
  // A catalog id that is not Meta's numeric id is never asked
  assert.deepEqual(await meta.fetchMetaProductsBySku('my-catalog', 'token', ['SKU-1'], 'v25.0', async () => { throw new Error('should not be called') }), [])
})

// ── Cash collected on Cash on Delivery orders ────────────────────────────────

test('Commerce rules: cash collected moves a Cash on Delivery order to paid; delivered still settles it', () => {
  assert.equal(utils.canTransitionOrder('cod_confirmed', 'paid'), true)
  assert.equal(utils.canTransitionOrder('shipped', 'paid'), true)
  assert.deepEqual(utils.getNextOrderStatuses('cod_confirmed'), ['paid', 'shipped', 'canceled'])
  assert.deepEqual(utils.getNextOrderStatuses('shipped'), ['paid', 'delivered', 'canceled'])
  // Finished orders stay final
  assert.equal(utils.canTransitionOrder('delivered', 'paid'), false)
  assert.equal(utils.canTransitionOrder('canceled', 'paid'), false)

  assert.equal(utils.isCashCollection({ status: 'cod_confirmed', payment_status: 'pending', payment_method: 'cod' }), true)
  assert.equal(utils.isCashCollection({ status: 'shipped', payment_status: 'pending', payment_method: 'cod' }), true)
  assert.equal(utils.isCashCollection({ status: 'shipped', payment_status: 'paid', payment_method: 'cod' }), false) // already collected
  assert.equal(utils.isCashCollection({ status: 'shipped', payment_status: 'pending', payment_method: null }), false) // not a cash order
  assert.equal(utils.isCashCollection({ status: 'payment_pending', payment_status: 'pending', payment_method: 'cod' }), false)
  assert.equal(utils.isCashCollection({ status: 'delivered', payment_status: 'paid', payment_method: 'cod' }), false)
})

test('Commerce rules: in-chat payments are rupees only, and the order-update template is read in any shape it was saved in', () => {
  assert.equal(utils.IN_CHAT_PAYMENT_CURRENCY, 'INR')

  const { buildTemplateMessage } = require('../lib/commerce/commerce-messages.ts')
  const filled = [{ type: 'body', parameters: [{ type: 'text', text: 'ORD-1' }] }]
  assert.deepEqual(buildTemplateMessage({ phone: '+91 98765 43210', name: ' order_update ', language: '', components: filled }), {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: '919876543210', type: 'template',
    template: { name: 'order_update', language: { code: 'en' }, components: filled },
  })
  assert.equal(buildTemplateMessage({ phone: '1', name: 'x', language: 'hi', components: [] }).template.components, undefined)
  assert.throws(() => buildTemplateMessage({ phone: '1', name: ' ', language: 'en' }), /template name/)

  assert.deepEqual(utils.getStatusTemplate({ commerce_status_template: { name: 'order_update', language: 'en_US' } }), { name: 'order_update', language: 'en_US' })
  assert.deepEqual(utils.getStatusTemplate({ commerce_status_template: '{"name":" order_update ","language_code":"hi"}' }), { name: 'order_update', language: 'hi' })
  assert.deepEqual(utils.getStatusTemplate({ commerce_status_template: 'order_update' }), { name: 'order_update', language: 'en' })
  const components = [{ type: 'BODY', text: '{{1}} {{2}} {{3}}' }]
  assert.deepEqual(utils.getStatusTemplate({ commerce_status_template: { name: 'order_update', components } }), { name: 'order_update', language: 'en', components })
  // Not set, the column missing, or junk: no template
  for (const value of [undefined, null, '', '  ', '{not json', { language: 'en' }, { name: '' }, 42]) {
    assert.equal(utils.getStatusTemplate({ commerce_status_template: value }), null, JSON.stringify(value))
  }
  assert.equal(utils.getStatusTemplate(null), null)
})
