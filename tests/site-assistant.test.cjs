require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { salonDb } = require('./salon-fake-db.cjs')

const SA = require('../lib/ai/site-assistant.ts')
const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('Assistant: "where is my order" in English, Tenglish and Hinglish, and by order number', () => {
  for (const q of ['Where is my order?', 'wheres my order', 'order status please', 'track my parcel', 'When will my order arrive', 'I have not received it yet, not delivered', 'naa order ekkada undi', 'mera order kab aayega', 'ORD-261118-ABCD', 'ord261118abcd please']) {
    assert.equal(SA.asksAboutOrder(q), true, q)
  }
  for (const q of ['What do you sell?', 'I want to order a red saree', 'how much is delivery', 'Do you have cash on delivery?']) {
    assert.equal(SA.asksAboutOrder(q), false, q)
  }
})

test('Assistant: "my booking" questions', () => {
  for (const q of ['I want to check my booking', 'When is my appointment?', 'is my booking confirmed', 'naa booking time enti']) assert.equal(SA.asksAboutBooking(q), true, q)
  for (const q of ['I want to book a haircut', 'What are your timings?']) assert.equal(SA.asksAboutBooking(q), false, q)
})

test('Assistant: order number, phone and name are read from what the customer typed', () => {
  assert.equal(SA.findOrderNumber('my order is ord-261118-abcd'), 'ORD-261118-ABCD')
  assert.equal(SA.findOrderNumber('ORD261118WXYZ'), 'ORD-261118-WXYZ')
  assert.equal(SA.findOrderNumber('order 12345'), null)
  assert.equal(SA.findPhone('Order ORD-261118-ABCD, phone +91 98765 43210'), '919876543210')
  assert.equal(SA.findPhone('ORD-261118-ABCD'), null, 'an order number is not a phone')
  assert.equal(SA.findName('Phone 9876543210, name Priya'), 'Priya')
  assert.equal(SA.findName('Priya Rao 98765 43210'), 'Priya')
  assert.equal(SA.findName('I am Kiran'), 'Kiran')
  const given = SA.detailsGiven('9876543210', [{ role: 'user', content: 'where is ORD-261118-ABCD' }, { role: 'assistant', content: 'Send your order number and phone' }])
  assert.deepEqual([given.orderNumber, given.phone], ['ORD-261118-ABCD', '9876543210'])
})

test('Assistant: the order answer is written from the order itself', () => {
  const text = SA.orderReply({ number: 'ORD-261118-ABCD', status: 'On the way', placedAt: '2026-11-18T05:00:00Z', payment: 'Pay on delivery', handover: 'delivery', total: 1250, currency: 'INR', items: [{ title: 'Cotton saree', quantity: 2 }], tracking: { number: 'DL123', carrier: 'Delhivery' }, timeline: [] })
  assert.match(text, /ORD-261118-ABCD: \*On the way\*/)
  assert.match(text, /Placed on 18 Nov/)
  assert.match(text, /2 × Cotton saree/)
  assert.match(text, /₹1,250/)
  assert.match(text, /Delhivery, tracking number DL123/)
})

test('Assistant: store facts carry delivery, paying, returns, offers and the shop pages', () => {
  const facts = SA.storeFacts({ name: 'Unisalon', currency: 'INR', pickup: true, delivery: true, fee: 60, freeFrom: 999, minOrder: 0, payOnline: true, payLater: true, payMethods: 'UPI, card or net banking', returns: { on: true, days: 7 }, loyalty: { on: true, percent: 5 }, offers: [{ title: 'Buy 2 get 1', min_order: 0 }], hasCodes: true, categories: ['Hair care', 'Skin'], productCount: 42, phone: '+91 98765 43210', pages: { shipping: 'We ship in 2-4 days across India.' } })
  for (const want of [/42 products in: Hair care, Skin/, /Delivery charge: ₹60; free delivery on orders of ₹999 or more/, /cash on delivery/, /within 7 days of delivery/, /5% of what you pay/, /Buy 2 get 1/, /Never make up a code/, /We ship in 2-4 days/, /ORD-261118-ABCD/]) assert.match(facts, want)
})

const services = [
  { id: 's1', name: 'Haircut (Women)', category: 'Hair', price: 600, minutes: 45 },
  { id: 's2', name: 'Haircut (Men)', category: 'Hair', price: 300, minutes: 30 },
  { id: 's3', name: 'Gold facial', category: 'Skin', price: 1800, minutes: 75 },
  { id: 's4', name: 'Bridal makeup', category: 'Makeup', price: 15000, minutes: 180 },
]

test('Assistant: Front Desk facts list every service with its price and length, hours, team and paying', () => {
  const facts = SA.deskFacts({ business: 'Glow', hours: 'Open 10 am to 9 pm, closed Tuesday', openNow: 'Open now · closes 9 pm', services, staff: [{ name: 'Asha', service_ids: ['s1', 's3'] }], approval: false, pay: { mode: 'choice', advance: 20, online: true, methods: 'UPI, card or net banking' }, plans: [{ name: 'Gold', price: 5999, validity_days: 365, discount_percent: 15, credit: 1000, sessions: [] }], rating: { average: 4.7, count: 128 } })
  for (const want of [/Haircut \(Women\) \(₹600, 45 min\)/, /Bridal makeup \(₹15,000, 3 h\)/, /Gold facial \(₹1,800, 1 h 15 min\)/, /closed Tuesday/, /Open now/, /Asha \(does Haircut \(Women\), Gold facial\)/, /confirmed at once/, /20% advance/, /Gold ₹5,999 \(₹1,000 to spend, 15% off services, valid 365 days\)/, /4\.7 out of 5/, /never promise a time/]) assert.match(facts, want)
  const hidden = SA.deskFacts({ business: 'Glow', hours: 'x', services, staff: [], approval: true, showPrices: false })
  assert.doesNotMatch(hidden, /₹600/)
  assert.match(hidden, /Prices are not shown online/)
})

test('Assistant: services matching the question come as cards', () => {
  assert.deepEqual(SA.serviceHits(services, 'how much is a haircut for men').map((h) => h.id).slice(0, 2), ['s2', 's1'])
  assert.equal(SA.serviceHits(services, 'facial price')[0].id, 's3')
  assert.equal(SA.serviceHits(services, 'facial price')[0].kind, 'service')
  assert.match(SA.serviceHits(services, 'facial')[0].content, /Price: ₹1,800/)
  assert.deepEqual(SA.serviceHits(services, 'hello'), [])
})

test('Assistant: an amount the data does not have is caught', () => {
  assert.deepEqual(SA.amountsIn('Haircut is ₹600, facial Rs. 1,800 and makeup 15000 rupees'), [600, 1800, 15000])
  const facts = SA.deskFacts({ business: 'Glow', hours: 'x', services, staff: [], approval: true })
  assert.deepEqual(SA.unknownAmounts('A women\'s haircut is ₹600 and takes 45 min.', [facts]), [])
  assert.deepEqual(SA.unknownAmounts('Haircut and gold facial together come to ₹2,400.', [facts]), [], 'two listed prices added up')
  assert.deepEqual(SA.unknownAmounts('A haircut is ₹500.', [facts]), [500], 'an invented price')
  assert.deepEqual(SA.unknownAmounts('We are open till 9 pm.', [facts]), [], 'no amounts, nothing to check')
})

test('Assistant: a reply with a made-up price is never sent', async () => {
  const FA = require('../lib/ai/faq-answer.ts')
  const answers = [
    JSON.stringify({ reply: 'A haircut is ₹500.', status: 'answered', used: [], next: [], summary: 'price', urgent: false }),
    JSON.stringify({ reply: 'A haircut is ₹450.', status: 'answered', used: [], next: [], summary: 'price', urgent: false }),
  ]
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body || '{}')
    calls.push(String(url))
    if (String(url).includes('/embeddings')) return new Response(JSON.stringify({ data: [{ embedding: Array(1536).fill(0) }] }), { status: 200 })
    if (body.response_format) return new Response(JSON.stringify({ choices: [{ message: { content: answers.shift() || answers[0] } }] }), { status: 200 })
    return new Response(JSON.stringify({ choices: [{ message: { content: 'haircut price' } }] }), { status: 200 })
  }
  try {
    const db = salonDb({})
    db.rpc = async () => ({ data: [], error: null })
    const facts = SA.deskFacts({ business: 'Glow', hours: 'x', services, staff: [], approval: true })
    const answer = await FA.answerFromKnowledge({ db, ai: { organizationId: 'o1', apiKey: 'k', billed: false, allowed: true }, org: { id: 'o1', name: 'Glow' }, message: 'how much is a haircut', history: [], channel: 'website', facts, strictAmounts: true, products: (s) => SA.serviceHits(services, s) })
    assert.ok(answer)
    assert.doesNotMatch(answer.reply, /₹500|₹450/, 'neither made-up price reaches the customer')
    assert.equal(answer.handoff, true, 'it says the team will tell instead')
    assert.equal(calls.filter((u) => u.includes('/chat/completions')).length >= 3, true, 'it was asked once more first')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('Wiring: both chats answer orders / bookings from the data, and use the shared chat window', () => {
  const store = read('app/api/public/store/[slug]/chat/route.ts')
  assert.match(store, /asksAboutOrder\(message\)/)
  assert.match(store, /trackOrder\(db, page\.organization\.id, given\.orderNumber, given\.phone\)/)
  assert.match(store, /shopperOrders\(/)
  assert.match(store, /strictAmounts: true/)
  assert.match(store, /store-chat-track:/, 'order look-ups are limited')
  const desk = read('app/api/public/booking/[slug]/chat/route.ts')
  assert.match(desk, /asksAboutBooking\(message\)/)
  assert.match(desk, /serviceHits\(data\.view\.services/)
  assert.match(desk, /strictAmounts: true/)
  assert.match(desk, /split\(\/\\s\+\/\)\[0\] === first/, 'phone and first name must both match')
  assert.match(read('components/salon-site/business-site.tsx'), /<SiteChat kind="desk"/)
  assert.match(read('app/s/[slug]/store-chat.tsx'), /<SiteChat kind="store"/)
  assert.match(read('components/salon/salon-website.tsx'), /AI chat on your website/)
})
