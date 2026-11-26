// Fixes after the owner's test of the websites (26 Nov 2026): new customer bookings stand out, the business's own
// name is not shown as every product's brand, the Google review link is offered after every rating, and a page that
// broke because a new version went live reloads itself.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const NB = require('../lib/salon/new-bookings.ts')
const { dropOwnBrand } = require('../lib/commerce/storefront.ts')
const { thanksText } = require('../lib/salon/jobs.ts')
const { isNewVersionError } = require('../lib/new-version.ts')

// Thursday 26 Nov 2026, 5:41 pm in India
const NOW = Date.parse('2026-11-26T12:11:00Z')
const row = (over = {}) => ({ id: 'a1', customer_name: 'Priya', starts_at: '2026-11-28T05:00:00Z', created_at: '2026-11-26T12:11:00Z', source: 'online', status: 'booked', services: [{ name: 'Haircut' }, { name: 'Beard trim' }], ...over })

test('new bookings from customers: made by them lately, still to come, booked, not seen; newest first', () => {
  const list = NB.freshBookings([
    row(),
    row({ id: 'a2', source: 'chat', created_at: '2026-11-26T10:00:00Z' }),
    row({ id: 'counter', source: 'counter' }),
    row({ id: 'old', created_at: '2026-11-22T10:00:00Z' }),
    row({ id: 'gone', starts_at: '2026-11-25T05:00:00Z' }),
    row({ id: 'request', status: 'requested' }),
    row({ id: 'seen' }),
  ], NOW, ['seen'])
  assert.deepEqual(list.map((a) => a.id), ['a1', 'a2'])
  assert.equal(NB.sourceLabel('online'), 'Website')
  assert.equal(NB.sourceLabel('chat'), 'WhatsApp')
  assert.equal(NB.sourceLabel('api'), 'Your app')
  assert.equal(NB.serviceNames(row()), 'Haircut, Beard trim')
  assert.match(NB.bookingWhen('2026-11-28T05:00:00Z', NOW), /28 Nov|Sat/)
  assert.match(NB.bookingWhen('2026-11-28T05:00:00Z', NOW), /10:30/)
})

test('the store: a brand that is just the business or store name is not shown', () => {
  const products = dropOwnBrand([{ id: '1', brand: 'Magnetora AI Solutions' }, { id: '2', brand: ' unisalon ' }, { id: '3', brand: 'Penguin' }, { id: '4' }], ['Magnetora AI Solutions', 'Unisalon'])
  assert.deepEqual(products.map((p) => p.brand || null), [null, null, 'Penguin', null])
})

test('the Google review link goes with every rating (asked after a good visit, offered quietly otherwise)', () => {
  const link = 'https://g.page/r/abc/review'
  assert.match(thanksText(5, link), /Google review helps us a lot/)
  assert.match(thanksText(3, link), /review us on Google: https:\/\/g\.page/)
  assert.match(thanksText(1, link), /manager will call you[\s\S]*review us on Google/)
  assert.doesNotMatch(thanksText(1, null), /Google/)
})

test('a page broken by a new version going live is recognised (it reloads itself once)', () => {
  assert.equal(isNewVersionError({ name: 'ChunkLoadError', message: 'Loading chunk 123 failed.' }), true)
  assert.equal(isNewVersionError(new TypeError('Failed to fetch dynamically imported module: https://x/_next/a.js')), true)
  assert.equal(isNewVersionError(new Error('Cannot read properties of undefined')), false)
})
