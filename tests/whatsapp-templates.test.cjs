require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const M = require('../lib/whatsapp-templates/template-model.ts')

const marketing = (changes = {}) => ({ ...M.emptyDraft('MARKETING', 'custom'), name: 'diwali_offer', body: 'Hi {{1}}, enjoy {{2}} off on all books this Diwali!', samples: { 1: 'Teja', 2: '20%' }, ...changes })
const messages = (draft) => M.validateDraft(draft).map((problem) => problem.message)

test('Templates: a valid custom marketing template builds Meta\'s exact payload', () => {
  const draft = marketing({
    headerFormat: 'TEXT', headerText: 'Diwali sale for {{1}}', samples: { 1: 'Teja', 2: '20%', 'header:1': 'you' },
    footer: 'Reply STOP to opt out',
    buttons: [{ type: 'QUICK_REPLY', text: 'Interested' }, { type: 'URL', text: 'Shop now', url: 'https://magnetora.in/shop/{{1}}', example: 'https://magnetora.in/shop/diwali' }, { type: 'PHONE_NUMBER', text: 'Call us', phone_number: '+91 98765 43210' }],
  })
  assert.deepEqual(messages(draft), [])
  assert.deepEqual(M.buildCreatePayload(draft), {
    name: 'diwali_offer', language: 'en', category: 'MARKETING', allow_category_change: true,
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Diwali sale for {{1}}', example: { header_text: ['you'] } },
      { type: 'BODY', text: 'Hi {{1}}, enjoy {{2}} off on all books this Diwali!', example: { body_text: [['Teja', '20%']] } },
      { type: 'FOOTER', text: 'Reply STOP to opt out' },
      { type: 'BUTTONS', buttons: [
        { type: 'QUICK_REPLY', text: 'Interested' },
        { type: 'URL', text: 'Shop now', url: 'https://magnetora.in/shop/{{1}}', example: ['https://magnetora.in/shop/diwali'] },
        { type: 'PHONE_NUMBER', text: 'Call us', phone_number: '+919876543210' },
      ] },
    ],
  })
})

test('Templates: named variables use Meta\'s named-parameter examples', () => {
  const draft = marketing({ parameterFormat: 'NAMED', body: 'Hello {{first_name}}, your order {{order_id}} is ready for pickup today.', samples: { first_name: 'Teja', order_id: 'ORD-1' } })
  assert.deepEqual(messages(draft), [])
  const payload = M.buildCreatePayload(draft)
  assert.equal(payload.parameter_format, 'NAMED')
  assert.deepEqual(payload.components[0].example, { body_text_named_params: [{ param_name: 'first_name', example: 'Teja' }, { param_name: 'order_id', example: 'ORD-1' }] })
  assert.equal(M.nextVariable('Hi {{variable_1}}', 'NAMED'), '{{variable_2}}')
  assert.equal(M.nextVariable('Hi {{1}} and {{2}}', 'POSITIONAL'), '{{3}}')
})

test('Templates: Meta\'s variable rules are enforced', () => {
  assert.match(messages(marketing({ body: '{{1}} is your discount code for today', samples: { 1: 'X' } })).join(' '), /can't be at the very start or end/)
  assert.match(messages(marketing({ body: 'Hi {{1}}, use {{3}} today at our store', samples: { 1: 'a', 3: 'b' } })).join(' '), /in order without gaps/)
  assert.match(messages(marketing({ body: 'Hi {{1}} {{2}} welcome to our lovely store', samples: { 1: 'a', 2: 'b' } })).join(' '), /next to each other/)
  assert.match(messages(marketing({ samples: { 1: 'Teja' } })).join(' '), /Add a sample for \{\{2\}\}/)
  assert.match(messages(marketing({ body: 'Hi {{1}} {{2}} {{3}}!', samples: { 1: 'a', 2: 'b', 3: 'c' } })).join(' '), /Too many variables/)
  assert.match(messages(marketing({ name: 'Diwali Offer' })).join(' '), /lowercase letters, numbers and underscores/)
})

test('Templates: button rules', () => {
  const tooMany = marketing({ buttons: [1, 2, 3].map((n) => ({ type: 'URL', text: `Site ${n}`, url: 'https://x.com' })) })
  assert.match(messages(tooMany).join(' '), /at most 2 Visit website buttons/)
  const split = marketing({ buttons: [{ type: 'QUICK_REPLY', text: 'A' }, { type: 'URL', text: 'B', url: 'https://x.com' }, { type: 'QUICK_REPLY', text: 'C' }] })
  assert.match(messages(split).join(' '), /keep quick reply buttons together/)
  assert.match(messages(marketing({ buttons: [{ type: 'QUICK_REPLY', text: 'Yes' }, { type: 'QUICK_REPLY', text: 'yes' }] })).join(' '), /same text/)
  assert.match(messages(marketing({ buttons: [{ type: 'PHONE_NUMBER', text: 'Call', phone_number: '12345' }] })).join(' '), /country code/)
  assert.match(messages(marketing({ buttons: [{ type: 'URL', text: 'Go', url: 'https://x.com/{{1}}/a' }] })).join(' '), /one variable, \{\{1\}\}, at the end/)
})

test('Templates: authentication (one-time passcode) payloads', () => {
  const copy = { ...M.emptyDraft('AUTHENTICATION', 'otp'), name: 'login_code' }
  assert.deepEqual(messages(copy), [])
  assert.deepEqual(M.buildCreatePayload(copy).components, [
    { type: 'BODY', add_security_recommendation: true },
    { type: 'FOOTER', code_expiration_minutes: 10 },
    { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy code' }] },
  ])
  const oneTap = { ...copy, otp: { ...copy.otp, type: 'ONE_TAP', apps: [{ packageName: 'in.magnetora.app', signatureHash: 'K8a/AINcGX7' }] } }
  assert.deepEqual(messages(oneTap), [])
  assert.deepEqual(M.buildCreatePayload(oneTap).components[2].buttons[0], { type: 'OTP', otp_type: 'ONE_TAP', text: 'Copy code', supported_apps: [{ package_name: 'in.magnetora.app', signature_hash: 'K8a/AINcGX7' }], autofill_text: 'Autofill' })
  assert.match(messages({ ...oneTap, otp: { ...oneTap.otp, apps: [{ packageName: 'in.magnetora.app', signatureHash: 'short' }] } }).join(' '), /11-character signature hash/)
  // Zero-tap: several apps, and the business must accept the terms itself
  const zeroTap = { ...oneTap, otp: { ...oneTap.otp, type: 'ZERO_TAP', apps: [{ packageName: 'in.magnetora.app', signatureHash: 'K8a/AINcGX7' }, { packageName: 'in.magnetora.lite', signatureHash: 'Z9b/BJOdHY8' }] } }
  assert.match(messages(zeroTap).join(' '), /Accept the zero-tap terms/)
  zeroTap.otp.zeroTapTermsAccepted = true
  assert.deepEqual(messages(zeroTap), [])
  const zeroButton = M.buildCreatePayload(zeroTap).components[2].buttons[0]
  assert.deepEqual([zeroButton.supported_apps.length, zeroButton.zero_tap_terms_accepted], [2, true])
  assert.equal(M.buildCreatePayload(copy).allow_category_change, undefined)
})

test('Templates: coupon, limited-time offer, catalogue and flows', () => {
  const coupon = { ...M.emptyDraft('MARKETING', 'coupon'), name: 'coupon', body: 'Use this code to get {{1}} off your next order with us.', samples: { 1: '10%' } }
  assert.match(messages(coupon).join(' '), /enter the offer code/)
  coupon.buttons = [{ type: 'COPY_CODE', example: 'SAVE10' }]
  assert.deepEqual(messages(coupon), [])
  assert.deepEqual(M.buildComponents(coupon).at(-1), { type: 'BUTTONS', buttons: [{ type: 'COPY_CODE', example: 'SAVE10' }] })

  const lto = { ...M.emptyDraft('MARKETING', 'lto'), name: 'flash_sale', body: 'Flash sale on all books, today only for our members.', footer: 'ignored' }
  lto.buttons = [{ type: 'COPY_CODE', example: 'FLASH50' }, { type: 'URL', text: 'Shop now', url: 'https://magnetora.in' }]
  assert.deepEqual(messages(lto), [])
  const ltoComponents = M.buildComponents(lto)
  assert.deepEqual(ltoComponents[0], { type: 'LIMITED_TIME_OFFER', limited_time_offer: { text: 'Expiring offer!', has_expiration: true } })
  assert.ok(!ltoComponents.some((c) => c.type === 'FOOTER'))

  const catalog = { ...M.emptyDraft('MARKETING', 'catalog'), name: 'new_arrivals', body: 'New books just arrived in our store. Have a look!' }
  assert.deepEqual(M.buildComponents(catalog).at(-1), { type: 'BUTTONS', buttons: [{ type: 'CATALOG', text: 'View catalog' }] })

  const flow = { ...M.emptyDraft('UTILITY', 'flow'), name: 'feedback', body: 'Tell us how your recent order went, it takes a minute.' }
  assert.match(messages(flow).join(' '), /choose the flow/)
  flow.buttons = [{ type: 'FLOW', text: 'Give feedback', flow_id: '123456' }]
  assert.deepEqual(M.buildComponents(flow).at(-1).buttons[0], { type: 'FLOW', text: 'Give feedback', flow_id: '123456', flow_action: 'navigate' })
})

test('Templates: carousel cards', () => {
  const card = (n) => ({ headerFormat: 'IMAGE', headerHandle: `4::h${n}`, body: `Book ${n} for {{1}} readers`, samples: { 1: 'young' }, buttons: [{ type: 'QUICK_REPLY', text: 'Interested' }] })
  const carousel = { ...M.emptyDraft('MARKETING', 'carousel'), name: 'picks', body: 'Our top picks this week for you to enjoy.', cards: [card(1), card(2)] }
  assert.deepEqual(messages(carousel), [])
  const built = M.buildComponents(carousel)
  assert.deepEqual(built.map((c) => c.type), ['BODY', 'CAROUSEL'])
  assert.deepEqual(built[1].cards[0].components[0], { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['4::h1'] } })
  assert.match(messages({ ...carousel, cards: [card(1)] }).join(' '), /2 to 10 cards/)
  const mismatched = { ...carousel, cards: [card(1), { ...card(2), buttons: [{ type: 'URL', text: 'Go', url: 'https://x.com' }] }] }
  assert.match(messages(mismatched).join(' '), /same buttons/)
})

test('Templates: a template read back from Meta becomes an editable draft', () => {
  const fromMeta = {
    id: '123', name: 'diwali_offer', language: 'en', category: 'MARKETING', status: 'REJECTED', rejected_reason: 'INVALID_FORMAT',
    components: [
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['https://scontent.whatsapp.net/x.jpg'] } },
      { type: 'BODY', text: 'Hi {{1}}, enjoy {{2}} off!', example: { body_text: [['Teja', '20%']] } },
      { type: 'FOOTER', text: 'Reply STOP' },
      { type: 'BUTTONS', buttons: [{ type: 'COPY_CODE', example: ['SAVE20'] }, { type: 'URL', text: 'Shop', url: 'https://x.com/{{1}}', example: ['https://x.com/a'] }] },
    ],
  }
  const draft = M.draftFromMeta(fromMeta)
  assert.deepEqual([draft.type, draft.headerFormat, draft.body, draft.footer, draft.samples['1'], draft.samples['2']], ['coupon', 'IMAGE', 'Hi {{1}}, enjoy {{2}} off!', 'Reply STOP', 'Teja', '20%'])
  assert.deepEqual(draft.buttons, [{ type: 'COPY_CODE', example: 'SAVE20' }, { type: 'URL', text: 'Shop', url: 'https://x.com/{{1}}', example: 'https://x.com/a' }])
  assert.equal(draft.headerPreview, 'https://scontent.whatsapp.net/x.jpg')
  // Round trip: what was read builds the same components
  assert.deepEqual(M.buildComponents(draft).find((c) => c.type === 'BODY'), fromMeta.components[1])
  const otp = M.draftFromMeta({ name: 'otp', category: 'AUTHENTICATION', components: [{ type: 'BODY', add_security_recommendation: true }, { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy' }] }] })
  assert.deepEqual([otp.type, otp.otp.type, otp.otp.buttonText, otp.otp.codeExpirationMinutes], ['otp', 'COPY_CODE', 'Copy', null])
  assert.equal(M.fillSamples('Hi {{1}}!', { 1: 'Teja' }), 'Hi Teja!')
  assert.equal(M.STATUS_INFO.APPROVED.label, 'Active')
})

test('Templates: product, order, calling templates and the validity period', () => {
  const base = (category, type, changes = {}) => ({ ...M.emptyDraft(category, type), name: 'tpl', body: 'Here are our newest books, picked just for you.', ...changes })

  const mpm = base('MARKETING', 'mpm')
  assert.match(messages(mpm).join(' '), /Enter the header text/)
  mpm.headerText = 'New arrivals'
  assert.deepEqual(messages(mpm), [])
  assert.deepEqual(M.buildComponents(mpm), [
    { type: 'HEADER', format: 'TEXT', text: 'New arrivals' },
    { type: 'BODY', text: mpm.body },
    { type: 'BUTTONS', buttons: [{ type: 'MPM', text: 'View items' }] },
  ])

  const spm = base('MARKETING', 'spm', { footer: 'Limited stock' })
  assert.deepEqual(messages(spm), [])
  assert.deepEqual(M.buildComponents(spm), [
    { type: 'HEADER', format: 'PRODUCT' },
    { type: 'BODY', text: spm.body },
    { type: 'FOOTER', text: 'Limited stock' },
    { type: 'BUTTONS', buttons: [{ type: 'SPM', text: 'View' }] },
  ])

  const productCarousel = base('MARKETING', 'product_carousel', { productCards: 2 })
  assert.deepEqual(messages(productCarousel), [])
  const built = M.buildComponents(productCarousel)
  assert.deepEqual(built[1], { type: 'CAROUSEL', cards: [1, 2].map(() => ({ components: [{ type: 'HEADER', format: 'PRODUCT' }, { type: 'BUTTONS', buttons: [{ type: 'SPM', text: 'View' }] }] })) })

  const order = base('UTILITY', 'order_details', { body: 'Your order is ready. Review it and pay securely in WhatsApp.' })
  assert.deepEqual(messages(order), [])
  assert.deepEqual(M.buildComponents(order).at(-1), { type: 'BUTTONS', buttons: [{ type: 'ORDER_DETAILS', text: 'Review and pay' }] })

  const call = base('MARKETING', 'call_permission', { body: 'Can our book advisor call you on WhatsApp about your order?' })
  assert.deepEqual(messages(call), [])
  assert.deepEqual(M.buildComponents(call).map((c) => c.type), ['BODY', 'CALL_PERMISSION_REQUEST'])

  const voice = base('MARKETING', 'custom', { buttons: [{ type: 'VOICE_CALL', text: 'Call us' }] })
  assert.deepEqual(messages(voice), [])
  assert.deepEqual(M.buildComponents(voice).at(-1), { type: 'BUTTONS', buttons: [{ type: 'VOICE_CALL', text: 'Call us' }] })
  assert.match(messages({ ...voice, buttons: [...voice.buttons, { type: 'PHONE_NUMBER', text: 'Phone', phone_number: '+919876543210' }] }).join(' '), /not both/)

  // Validity period: in range per category, sent as message_send_ttl_seconds
  const otp = { ...M.emptyDraft('AUTHENTICATION', 'otp'), name: 'code', ttlSeconds: 300 }
  assert.equal(M.buildCreatePayload(otp).message_send_ttl_seconds, 300)
  assert.match(messages({ ...otp, ttlSeconds: 3600 }).join(' '), /30 seconds to 15 minutes/)
  assert.match(messages({ ...base('MARKETING', 'custom'), ttlSeconds: 600 }).join(' '), /12 hours to 30 days/)
  assert.equal(M.describeDuration(2592000), '30 days')

  // Read back from Meta
  assert.equal(M.draftFromMeta({ category: 'MARKETING', components: [{ type: 'HEADER', format: 'PRODUCT' }, { type: 'BODY', text: 'x' }, { type: 'BUTTONS', buttons: [{ type: 'SPM', text: 'View' }] }] }).type, 'spm')
  assert.equal(M.draftFromMeta({ category: 'MARKETING', components: [{ type: 'BODY', text: 'x' }, { type: 'BUTTONS', buttons: [{ type: 'MPM', text: 'View items' }] }] }).type, 'mpm')
  const pc = M.draftFromMeta({ category: 'MARKETING', components: [{ type: 'BODY', text: 'x' }, { type: 'CAROUSEL', cards: [1, 2, 3, 4].map(() => ({ components: [{ type: 'HEADER', format: 'PRODUCT' }] })) }] })
  assert.deepEqual([pc.type, pc.productCards], ['product_carousel', 4])
  assert.equal(M.draftFromMeta({ category: 'UTILITY', components: [{ type: 'BODY', text: 'x' }, { type: 'BUTTONS', buttons: [{ type: 'ORDER_DETAILS', text: 'Review and pay' }] }] }).type, 'order_details')
  assert.equal(M.draftFromMeta({ category: 'MARKETING', components: [{ type: 'BODY', text: 'x' }, { type: 'CALL_PERMISSION_REQUEST' }] }).type, 'call_permission')
})
