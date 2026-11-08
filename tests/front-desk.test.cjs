require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const MT = require('../lib/salon/message-templates.ts')
const AI = require('../lib/whatsapp-templates/ai-draft.ts')
const B = require('../lib/salon/business.ts')
const { validateDraft } = require('../lib/whatsapp-templates/template-model.ts')

// ── Business types ──────────────────────────────────────────────────────────

test('Business types: every starter kit is complete — each person does services that exist, prices and times are sensible', () => {
  for (const [id, info] of Object.entries(B.BUSINESS_TYPES)) {
    assert.ok(info.label && info.describe, id)
    if (!info.kit) { assert.equal(id, 'other'); continue }
    const categories = new Set(info.kit.services.map((s) => s.category))
    for (const member of info.kit.staff) for (const category of member.categories) assert.ok(categories.has(category), `${id}: ${member.name} does ${category}`)
    for (const service of info.kit.services) assert.ok(service.price > 0 && service.duration_minutes >= 10, `${id}: ${service.name}`)
    assert.ok([0, 5, 12, 18].includes(info.kit.taxRate), id)
  }
  assert.equal(B.BUSINESS_TYPES.clinic.kit.taxRate, 0, 'healthcare is GST exempt')
  assert.equal(B.businessType('clinic'), 'clinic')
  assert.equal(B.businessType('bakery'), 'salon', 'unknown types fall back to the original')
})

// ── Choosing a template for each message ────────────────────────────────────

test('Message templates: a choice names an approved template, its language and what fills each blank', () => {
  const ok = MT.parseMessageTemplates({ bill: { name: 'clinic_bill_v2', language: 'en_US', fields: ['customer_name', 'amount', 'bill_number'], url_field: 'link' }, reminder: null })
  assert.deepEqual(ok, { value: { bill: { name: 'clinic_bill_v2', language: 'en_US', fields: ['customer_name', 'amount', 'bill_number'], url_field: 'link' } } })
  assert.deepEqual(MT.parseMessageTemplates(undefined), { value: {} })
  assert.match(MT.parseMessageTemplates({ bill: { name: 'Bill Template!', language: 'en', fields: [] } }).error, /Choose a template for the bill/)
  assert.match(MT.parseMessageTemplates({ bill: { name: 'x', language: 'english', fields: [] } }).error, /language/)
  // A reminder cannot be filled with a bill number
  assert.match(MT.parseMessageTemplates({ reminder: { name: 'x', language: 'en', fields: ['bill_number'] } }).error, /each blank of the appointment reminder/)
  assert.match(MT.parseMessageTemplates({ invoice_paid: { name: 'x', language: 'en', fields: [] } }).error, /not one Front Desk sends/)
  assert.match(MT.parseMessageTemplates([]).error, /Choose a template/)
})

test('Message templates: the chosen template is sent with its blanks filled and the link on its button', () => {
  const payload = MT.chosenTemplatePayload({ name: 'my_bill', language: 'te', fields: ['first_name', 'amount'], url_field: 'link' }, '+91 98765 43210', { first_name: 'Priya', amount: '₹1,200\n', link: 'tok123' })
  assert.deepEqual(payload, {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: '919876543210', type: 'template',
    template: { name: 'my_bill', language: { code: 'te' }, components: [
      { type: 'body', parameters: [{ type: 'text', text: 'Priya' }, { type: 'text', text: '₹1,200' }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'tok123' }] },
    ] },
  })
  // A value that is missing is sent as "-" (WhatsApp refuses empty values); no blanks, no body component
  assert.equal(MT.chosenTemplatePayload({ name: 'x', language: 'en', fields: ['staff'] }, '1', {}).template.components[0].parameters[0].text, '-')
  assert.deepEqual(MT.chosenTemplatePayload({ name: 'x', language: 'en', fields: [] }, '1', {}).template.components, [])
})

test('Message templates: blanks are counted from Meta\'s description, and a first guess fills them', () => {
  const template = { components: [
    { type: 'BODY', text: 'Hi {{1}}, your bill {{3}} for {{2}} is ready.' },
    { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'View', url: 'https://x.in/i/{{1}}' }, { type: 'QUICK_REPLY', text: 'Thanks' }] },
  ] }
  assert.deepEqual(MT.templateBlanks(template), { blanks: 3, urlButton: true })
  assert.deepEqual(MT.templateBlanks({ components: [{ type: 'BODY', text: 'Hello!' }] }), { blanks: 0, urlButton: false })
  assert.deepEqual(MT.guessFields('bill', 3), ['first_name', 'business', 'bill_number'])
  assert.deepEqual(MT.guessFields('reminder', 5), ['first_name', 'business', 'time', 'services', 'customer_name'])
  assert.ok(!MT.guessFields('feedback', 10).includes('link'), 'the link code goes on the button, never in the text')
})

// ── AI writes a template ────────────────────────────────────────────────────

const output = (over = {}) => ({ name: 'Diwali Offer 2026!', category: 'MARKETING', header: 'Festive offer {{1}}', body: 'Hi {{2}}, Happy Diwali from {{1}}! Enjoy 20% off all services this week. Reply to book.', footer: '', buttons: [{ type: 'QUICK_REPLY', text: 'Book now', url: '', phone: '' }], samples: ['Glow Studio', 'Priya'], fields: [], ...over })

test('AI templates: the draft is cleaned for Meta — name, variables renumbered in order with their samples, no variables in the title', () => {
  const { draft, problems } = AI.draftFromAi(output(), { description: 'Diwali offer', language: 'hi' }, 'https://app.example.in/')
  assert.equal(draft.name, 'diwali_offer_2026')
  assert.equal(draft.language, 'hi')
  assert.equal(draft.category, 'MARKETING')
  assert.equal(draft.body, 'Hi {{1}}, Happy Diwali from {{2}}! Enjoy 20% off all services this week. Reply to book.')
  assert.deepEqual(draft.samples, { 1: 'Priya', 2: 'Glow Studio' })
  assert.equal(draft.headerText, 'Festive offer')
  assert.deepEqual(draft.buttons, [{ type: 'QUICK_REPLY', text: 'Book now' }])
  assert.deepEqual(problems, [])
  assert.deepEqual(validateDraft(draft), [])
})

test('AI templates: for a Front Desk message the blanks map to its values and the link button opens this app\'s page', () => {
  const ai = output({ category: 'MARKETING', header: '', body: 'Hi {{1}}, thank you for visiting {{2}}. Your bill {{3}} for {{4}} is ready.', samples: ['Priya', 'Glow Studio', 'GLOW-0001', '₹1,200'], fields: ['first_name', 'business', 'bill_number', 'link'], buttons: [{ type: 'URL', text: 'See bill', url: 'https://example.com', phone: '' }] })
  const { draft, fields, urlField, problems } = AI.draftFromAi(ai, { description: 'bill', purpose: 'bill' }, 'https://app.example.in')
  assert.equal(draft.category, 'UTILITY', 'Front Desk messages are always utility')
  assert.deepEqual(fields, ['first_name', 'business', 'bill_number', 'amount'], 'the link code is never put in the text: the usual value for that blank goes instead')
  assert.equal(urlField, 'link')
  assert.deepEqual(draft.buttons, [{ type: 'URL', text: 'See bill', url: 'https://app.example.in/i/{{1}}', example: 'https://app.example.in/i/AbCdEf123456' }])
  assert.deepEqual(problems, [])
  // A message with no page to open keeps no link buttons
  const booking = AI.draftFromAi(output({ body: 'Hi {{1}}, see you on {{2}}.', samples: ['Priya', 'Sat'], fields: ['first_name', 'date_time'], buttons: [{ type: 'URL', text: 'Map', url: 'https://maps.example', phone: '' }] }), { description: 'x', purpose: 'booking' }, 'https://a.in')
  assert.deepEqual([booking.draft.buttons, booking.urlField, booking.fields], [[], null, ['first_name', 'date_time']])
})

test('AI templates: the instructions carry Meta\'s rules, the business, and for a message the values it may use', () => {
  const general = AI.aiTemplateSystemPrompt({ description: 'x', businessName: 'Sunrise Clinic', businessKind: 'a clinic' })
  assert.match(general, /must not start or end with a variable/)
  assert.match(general, /The business: Sunrise Clinic, a clinic\./)
  assert.match(general, /"fields" must be an empty list/)
  const feedback = AI.aiTemplateSystemPrompt({ description: 'x', purpose: 'feedback' })
  assert.match(feedback, /- first_name: Customer first name/)
  assert.doesNotMatch(feedback, /- link:/)
  assert.match(feedback, /exactly one URL button/)
  assert.equal(AI.cleanTemplateName('  Order Ready / Notice  '), 'order_ready_notice')
  assert.equal(AI.cleanTemplateName('!!!'), 'new_template')
})

test('AI calls go to OpenAI; only a development server may point them at a local stand-in', () => {
  const { openAiUrl } = require('../lib/ai-access.ts')
  const url = 'https://api.openai.com/v1/chat/completions'
  assert.equal(openAiUrl(url, { NODE_ENV: 'production', OPENAI_API_BASE: 'http://127.0.0.1:9999/v1' }), url)
  assert.equal(openAiUrl(url, { NODE_ENV: 'development', OPENAI_API_BASE: 'http://127.0.0.1:9999/v1/' }), 'http://127.0.0.1:9999/v1/chat/completions')
  assert.equal(openAiUrl(url, { NODE_ENV: 'development' }), url)
  assert.equal(openAiUrl('https://example.com/x', { NODE_ENV: 'development', OPENAI_API_BASE: 'http://l/v1' }), 'https://example.com/x')
})
