require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const { buildSendComponents } = require('../lib/whatsapp-templates/send-components.ts')
const { extraSendVariables, sendVariableLabel } = require('../lib/whatsapp-templates/send-variables.ts')
const { summarizeInsights } = require('../lib/whatsapp-templates/meta-templates.ts')
const M = require('../lib/whatsapp-templates/template-model.ts')

const NOW = Date.parse('2026-10-18T10:00:00Z')

test('Sending: header, body, coupon and URL values keep the keys campaigns already map', async () => {
  const components = [
    { type: 'HEADER', format: 'TEXT', text: 'Sale for {{1}}', example: { header_text: ['you'] } },
    { type: 'BODY', text: 'Hi {{1}}, enjoy {{2}} off', example: { body_text: [['Teja', '20%']] } },
    { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Shop', url: 'https://x.in/{{1}}' }, { type: 'COPY_CODE', example: ['DIWALI20'] }, { type: 'QUICK_REPLY', text: 'Stop' }] },
  ]
  const sent = await buildSendComponents(components, { vars: { 1: 'Ravi', 2: '30%', header_text_1: 'Ravi garu', button_url_1: 'diwali' }, now: NOW })
  assert.deepEqual(sent, [
    { type: 'header', parameters: [{ type: 'text', text: 'Ravi garu' }] },
    { type: 'body', parameters: [{ type: 'text', text: 'Ravi' }, { type: 'text', text: '30%' }] },
    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'diwali' }] },
    { type: 'button', sub_type: 'copy_code', index: '1', parameters: [{ type: 'coupon_code', coupon_code: 'DIWALI20' }] },
  ])
})

test('Sending: limited-time offers, media carousels and Flows', async () => {
  const draft = { ...M.emptyDraft('MARKETING', 'carousel'), name: 'cards', body: 'Pick one, {{1}}', samples: { 1: 'Teja' } }
  draft.cards = [0, 1].map((i) => ({ headerFormat: 'IMAGE', headerHandle: '4::x', headerPreview: '', body: `Card ${i + 1} for {{1}}`, samples: { 1: 'you' }, buttons: [{ type: 'URL', text: 'Buy', url: 'https://x.in/p/{{1}}', example: 'https://x.in/p/42' }] }))
  const components = M.buildComponents(draft)
  components.find((c) => c.type === 'CAROUSEL').cards.forEach((card, i) => { card.components[0].example = { header_handle: [`https://scontent.whatsapp.net/${i}.jpg`] } })
  const resolved = []
  const sent = await buildSendComponents([
    { type: 'LIMITED_TIME_OFFER', limited_time_offer: { text: 'Ends soon', has_expiration: true } },
    ...components,
    { type: 'BUTTONS', buttons: [{ type: 'FLOW', text: 'Book' }] },
  ], { vars: { 1: 'Ravi', card_2_media_url: 'https://cdn.x.in/2.jpg', card_1_button_url: '7' }, flowToken: 'campaign:1:2', now: NOW, resolveMedia: async (url) => { resolved.push(url); return { link: url } } })
  assert.deepEqual(sent[0], { type: 'limited_time_offer', parameters: [{ type: 'limited_time_offer', limited_time_offer: { expiration_time_ms: NOW + 86_400_000 } }] })
  const carousel = sent.find((c) => c.type === 'carousel')
  assert.equal(carousel.cards.length, 2)
  assert.deepEqual(carousel.cards[0].components[0], { type: 'header', parameters: [{ type: 'image', image: { link: 'https://scontent.whatsapp.net/0.jpg' } }] })
  assert.deepEqual(carousel.cards[1].components[0].parameters[0].image, { link: 'https://cdn.x.in/2.jpg' })
  assert.deepEqual(carousel.cards[0].components[1], { type: 'body', parameters: [{ type: 'text', text: 'you' }] })
  assert.deepEqual(carousel.cards[0].components[2].parameters, [{ type: 'text', text: '7' }])
  assert.deepEqual(carousel.cards[1].components[2].parameters, [{ type: 'text', text: '42' }], 'falls back to the sample suffix')
  assert.deepEqual(sent.at(-1), { type: 'button', sub_type: 'flow', index: '0', parameters: [{ type: 'action', action: { flow_token: 'campaign:1:2' } }] })
  assert.deepEqual(resolved, ['https://scontent.whatsapp.net/0.jpg', 'https://cdn.x.in/2.jpg'])

  const dated = await buildSendComponents([{ type: 'LIMITED_TIME_OFFER', limited_time_offer: { has_expiration: true } }], { vars: { offer_expires_at: '2026-10-20T18:30:00Z' }, now: NOW })
  assert.equal(dated[0].parameters[0].limited_time_offer.expiration_time_ms, Date.parse('2026-10-20T18:30:00Z'))
})

test('Sending: catalogue, product, multi-product and product carousel templates', async () => {
  const context = { vars: { product_ids: 'SKU1, SKU2,SKU3', section_title: 'Diwali picks' }, catalogId: 'CAT9', now: NOW }
  const mpm = await buildSendComponents([{ type: 'HEADER', format: 'TEXT', text: 'Picks' }, { type: 'BODY', text: 'New arrivals' }, { type: 'BUTTONS', buttons: [{ type: 'MPM', text: 'View items' }] }], context)
  assert.deepEqual(mpm, [{ type: 'button', sub_type: 'mpm', index: 0, parameters: [{ type: 'action', action: { thumbnail_product_retailer_id: 'SKU1', sections: [{ title: 'Diwali picks', product_items: [{ product_retailer_id: 'SKU1' }, { product_retailer_id: 'SKU2' }, { product_retailer_id: 'SKU3' }] }] } }] }])

  const spm = await buildSendComponents([{ type: 'HEADER', format: 'PRODUCT' }, { type: 'BODY', text: 'Back in stock' }, { type: 'BUTTONS', buttons: [{ type: 'SPM', text: 'View' }] }], { ...context, vars: { product_id: 'SKU7' } })
  assert.deepEqual(spm, [{ type: 'header', parameters: [{ type: 'product', product: { product_retailer_id: 'SKU7', catalog_id: 'CAT9' } }] }])

  const catalog = await buildSendComponents([{ type: 'BODY', text: 'Shop' }, { type: 'BUTTONS', buttons: [{ type: 'CATALOG', text: 'View catalog' }] }], { ...context, vars: { thumbnail_product_id: 'SKU5' } })
  assert.deepEqual(catalog, [{ type: 'button', sub_type: 'catalog', index: 0, parameters: [{ type: 'action', action: { thumbnail_product_retailer_id: 'SKU5' } }] }])

  const draft = { ...M.emptyDraft('MARKETING', 'product_carousel'), name: 'p', body: 'Top picks' }
  const carousel = await buildSendComponents(M.buildComponents(draft), context)
  assert.deepEqual(carousel[0].cards.map((card) => card.components[0].parameters[0].product.product_retailer_id), ['SKU1', 'SKU2', 'SKU3'])

  await assert.rejects(buildSendComponents([{ type: 'HEADER', format: 'PRODUCT' }], { vars: { product_id: 'X' }, catalogId: null }), /catalogue/)
  await assert.rejects(buildSendComponents([{ type: 'BUTTONS', buttons: [{ type: 'MPM' }] }], { vars: {}, catalogId: 'C' }), /product_ids/)
})

test('Sending: order details, location headers and one-time passwords', async () => {
  const order = await buildSendComponents([{ type: 'BODY', text: 'Your order is ready' }, { type: 'BUTTONS', buttons: [{ type: 'ORDER_DETAILS', text: 'Review and pay' }] }], {
    vars: { order_amount: '499', order_item_name: 'Telugu novel', order_reference_id: 'ORD42' },
    paymentGateway: { type: 'razorpay', configName: 'rzp_live' }, currency: 'INR', now: NOW,
  })
  const details = order[0].parameters[0].action.order_details
  assert.equal(order[0].sub_type, 'order_details')
  assert.equal(details.reference_id, 'ORD42')
  assert.deepEqual(details.total_amount, { value: 49900, offset: 100 })
  assert.equal(details.order.items[0].name, 'Telugu novel')
  assert.equal(details.payment_settings[0].payment_gateway.configuration_name, 'rzp_live')
  await assert.rejects(buildSendComponents([{ type: 'BUTTONS', buttons: [{ type: 'ORDER_DETAILS' }] }], { vars: { order_amount: '10' } }), /payment gateway/)

  const location = await buildSendComponents([{ type: 'HEADER', format: 'LOCATION' }], { vars: { location_latitude: '17.38', location_longitude: '78.48', location_name: 'Store' } })
  assert.deepEqual(location[0].parameters[0], { type: 'location', location: { latitude: '17.38', longitude: '78.48', name: 'Store', address: '' } })
  await assert.rejects(buildSendComponents([{ type: 'HEADER', format: 'LOCATION' }], { vars: {} }), /location_latitude/)

  const otp = await buildSendComponents([{ type: 'BODY', text: '*{{1}}* is your verification code.' }, { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy code' }] }], { vars: { otp_code: '482913' } })
  assert.deepEqual(otp, [
    { type: 'body', parameters: [{ type: 'text', text: '482913' }] },
    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '482913' }] },
  ])
})

test('Sending: campaigns ask for the values each template type needs', () => {
  const draft = { ...M.emptyDraft('MARKETING', 'carousel'), name: 'cards', body: 'Pick one' }
  draft.cards = [{ headerFormat: 'IMAGE', headerHandle: '4::x', headerPreview: '', body: 'For {{1}}', samples: { 1: 'you' }, buttons: [{ type: 'URL', text: 'Buy', url: 'https://x.in/{{1}}', example: 'https://x.in/1' }] }]
  assert.deepEqual(extraSendVariables(M.buildComponents(draft)).variables, ['card_1_media_url', 'card_1_1', 'card_1_button_url'])
  assert.deepEqual(extraSendVariables([{ type: 'HEADER', format: 'LOCATION' }, { type: 'LIMITED_TIME_OFFER', limited_time_offer: { has_expiration: true } }, { type: 'BUTTONS', buttons: [{ type: 'MPM' }, { type: 'ORDER_DETAILS' }, { type: 'OTP' }] }]).variables,
    ['location_latitude', 'location_longitude', 'location_name', 'location_address', 'offer_expires_at', 'product_ids', 'section_title', 'order_amount', 'order_item_name', 'order_reference_id', 'otp_code'])
  assert.equal(sendVariableLabel('card_2_media_url'), 'Card 2 Image/Video')
  assert.equal(sendVariableLabel('product_ids'), 'Product SKUs (comma separated)')
  assert.equal(sendVariableLabel('3'), 'Variable 3')
})

test('Insights: Meta\'s daily data points become a gap-free series with totals and clicks', () => {
  const day = (offset) => Math.floor(NOW / 86_400_000) * 86_400 - offset * 86_400
  const insights = summarizeInsights([
    { template_id: '1', start: day(2), sent: 10, delivered: 9, read: 6, clicked: [{ type: 'url_button', button_content: 'Shop', count: 3 }] },
    { template_id: '1', start: day(0), sent: 5, delivered: 5, read: 2, clicked: [{ type: 'url_button', button_content: 'Shop', count: 1 }, { type: 'quick_reply_button', button_content: 'Stop', count: 2 }] },
  ], 7, NOW)
  assert.equal(insights.days.length, 7)
  assert.equal(insights.days[6].start, day(0))
  assert.equal(insights.days[5].sent, 0)
  assert.deepEqual(insights.totals, { sent: 15, delivered: 14, read: 8, clicked: 6 })
  assert.deepEqual(insights.buttons, [{ text: 'Shop', type: 'url_button', count: 4 }, { text: 'Stop', type: 'quick_reply_button', count: 2 }])
})
