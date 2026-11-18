require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const R = require('../lib/commerce/reviews.ts')
const RS = require('../lib/commerce/review-store.ts')
const { salonDb } = require('./salon-fake-db.cjs')
const root = path.join(__dirname, '..')
const ORG = '11111111-1111-4111-8111-111111111111'
const P1 = '22222222-2222-4222-8222-222222222221'
const P2 = '22222222-2222-4222-8222-222222222222'
const O1 = '44444444-4444-4444-8444-444444444441'

test('a review is cleaned; names are shortened; stars are summed', () => {
  assert.equal(R.cleanReview({ productId: P1, rating: 0 }), null)
  assert.equal(R.cleanReview({ productId: 'x', rating: 5 }), null)
  const r = R.cleanReview({ productId: P1, rating: '4', text: '  Lovely   fabric ', photos: ['https://a.com/1.jpg', 'http://b', 'https://a.com/2.jpg', 'https://a.com/3.jpg', 'https://a.com/4.jpg', 'https://a.com/5.jpg'] })
  assert.deepEqual(r, { productId: P1, rating: 4, text: 'Lovely fabric', photos: ['https://a.com/1.jpg', 'https://a.com/2.jpg', 'https://a.com/3.jpg', 'https://a.com/4.jpg'] })
  assert.equal(R.publicName('Asha Reddy Kumar'), 'Asha K.')
  assert.equal(R.publicName('Asha'), 'Asha')
  assert.equal(R.publicName(''), 'A customer')
  assert.deepEqual(R.ratingSummary([{ rating: 5 }, { rating: 4 }, { rating: 4 }]), { average: 4.3, count: 3, stars: [0, 0, 0, 2, 1] })
})

test('reviews are saved once per product of the order; only published ones show', async () => {
  const order = { id: O1, organization_id: ORG, order_number: 'W-1', status: 'delivered', shipping_address: { full_name: 'Asha Reddy', phone_number: '+919876543210' }, items: [{ product_id: P1 }, { product_id: P2 }] }
  const db = salonDb({ commerce_orders: [order], commerce_reviews: [] })
  let res = await RS.saveReviews(db, ORG, order, [{ productId: P1, rating: 5, text: 'Great', photos: [] }, { productId: '22222222-2222-4222-8222-999999999999', rating: 1, text: 'not in the order', photos: [] }])
  assert.equal(res.saved, 1)
  res = await RS.saveReviews(db, ORG, order, [{ productId: P1, rating: 1, text: 'again', photos: [] }])
  assert.equal(res.saved, 0, 'never twice for the same product of an order')
  db.tables.commerce_reviews.push({ organization_id: ORG, product_id: P1, rating: 2, body: 'hidden one', photos: [], customer_name: 'X', published: false, created_at: '2026-01-01' })
  db.tables.commerce_reviews[0].published = true
  const shown = await RS.productReviews(db, ORG, P1)
  assert.equal(shown.length, 1)
  assert.equal(shown[0].name, 'Asha R.')
  const token = await RS.reviewToken(db, db.tables.commerce_orders[0])
  assert.match(token, /^[A-Za-z0-9_-]{18,22}$/)
  assert.equal(await RS.reviewToken(db, db.tables.commerce_orders[0]), token, 'the same link every time')
})

test('the review ask goes once when delivered (and never for in-shop sales)', async () => {
  const order = { id: O1, organization_id: ORG, order_number: 'W-1', status: 'delivered', shipping_address: { full_name: 'Asha', phone_number: '+919876543210', handover: 'delivery' } }
  const db = salonDb({ commerce_orders: [order], organizations: [{ id: ORG, name: 'Glow', slug: 'glow' }] })
  await RS.askForReviewOf(db, ORG, O1, 'https://app')
  assert.ok(db.tables.commerce_orders[0].shipping_address.review_asked_at, 'asked (WhatsApp is not connected in this test)')
  assert.ok(db.tables.commerce_orders[0].shipping_address.review_token)
  const again = await RS.askForReview(db, { id: ORG }, db.tables.commerce_orders[0], 'https://app/s/glow')
  assert.equal(again.sent, false, 'once per order')
  assert.equal((await RS.askForReview(db, { id: ORG }, { id: 'x', shipping_address: { handover: 'now', phone_number: '1' } }, '')).sent, false)
})

test('wiring: migration, product page reviews and stars for Google, review page, Delivered asks', () => {
  assert.equal(fs.readFileSync(path.join(root, 'supabase/migrations/20261128_shop_reviews.sql'), 'utf8'), RS.REVIEW_SQL)
  const product = fs.readFileSync(path.join(root, 'app/s/[slug]/p/[productId]/page.tsx'), 'utf8')
  assert.match(product, /aggregateRating/)
  assert.match(product, /reviews=\{reviews\}/)
  assert.ok(fs.existsSync(path.join(root, 'app/s/[slug]/review/[token]/review-form.tsx')))
  assert.match(fs.readFileSync(path.join(root, 'app/api/commerce/orders/route.ts'), 'utf8'), /if \(status === 'delivered'\) await afterDelivered/)
  assert.match(fs.readFileSync(path.join(root, 'lib/commerce/order-delivered.ts'), 'utf8'), /await askForReviewOf\(db, organizationId, orderId, appUrl\)/)
  assert.match(fs.readFileSync(path.join(root, 'lib/commerce/shipping.ts'), 'utf8'), /deps\.onDelivered\(order\.id\)/)
  const photo = fs.readFileSync(path.join(root, 'app/api/public/store/[slug]/review-photo/route.ts'), 'utf8')
  assert.match(photo, /orderByReviewToken/, 'photos only with a valid review link')
  assert.match(photo, /image\\\/\(jpeg\|png\|webp\|heic\|heif\)/)
})
