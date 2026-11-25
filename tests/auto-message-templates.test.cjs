require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const A = require('../lib/whatsapp-templates/auto-messages.ts')
const S = require('../lib/whatsapp-templates/auto-submit.ts')
const { validateDraft } = require('../lib/whatsapp-templates/template-model.ts')
const { FRONT_DESK_MESSAGES } = require('../lib/salon/templates.ts')
const M = require('../lib/commerce/shop-messages.ts')
const SEND = require('../lib/commerce/shop-messages-send.ts')
const MT = require('../lib/salon/message-templates.ts')

const ORIGIN = 'https://wamacrm.magnetora.in/'
const ALL = [...Object.values(FRONT_DESK_MESSAGES), ...Object.values(M.SHOP_MESSAGE_DEFS)]
const bill = FRONT_DESK_MESSAGES.bill

test('editor text: Meta blanks shown as words, and back, keeping what fills each one', () => {
  const text = A.toEditorText('Hi {{1}}, your bill {{3}} at {{2}} is ready.', ['first_name', 'business', 'bill_number'], bill.fields)
  assert.equal(text, 'Hi {Customer first name}, your bill {Bill number} at {Business name} is ready.')
  const back = A.readEditorText(text, bill.fields)
  // Numbered in the order they first appear
  assert.equal(back.body, 'Hi {{1}}, your bill {{2}} at {{3}} is ready.')
  assert.deepEqual(back.fields, ['first_name', 'bill_number', 'business'])
  assert.deepEqual(back.unknown, [])
  // The same blank twice keeps one number; any letter case and spacing; field keys work too
  const twice = A.readEditorText('Hi {customer  FIRST name}, {business} thanks you, {Customer first name}.', bill.fields)
  assert.equal(twice.body, 'Hi {{1}}, {{2}} thanks you, {{1}}.')
  assert.deepEqual(twice.fields, ['first_name', 'business'])
  assert.deepEqual(A.readEditorText('Hi {Pet name}, ok {Pet name}', bill.fields).unknown, ['Pet name'])
  assert.equal(A.toEditorText('Hi {{1}} and {{2}}', ['first_name'], bill.fields), 'Hi {Customer first name} and {?}')
  assert.equal(A.previewText('Hi {Customer first name}, bill {Bill amount}.', bill.fields), 'Hi Priya, bill ₹1,200.')
})

test('every suggested wording is a valid Utility template for Meta, plain and not promotional', () => {
  for (const def of ALL) {
    const view = A.autoView(def, null, [], { checked: true, business: 'Asha Beauty' })
    const { draft, fields, problems } = A.autoDraft(def, { text: view.suggestion.text, language: 'en', buttons: view.suggestion.buttons }, { name: def.baseName, origin: ORIGIN })
    assert.deepEqual(problems, [], def.purpose)
    assert.deepEqual(validateDraft(draft), [], def.purpose)
    assert.equal(draft.category, 'UTILITY')
    assert.deepEqual(fields, def.suggestion.fields, def.purpose)
    assert.match(def.baseName, /^[a-z0-9_]+$/)
    assert.doesNotMatch(def.suggestion.body, /offer|discount|sale\b|% off|\bfree\b|deal|hurry|limited|best price|buy now/i, def.purpose)
    assert.doesNotMatch(def.suggestion.body, /[^\x20-\x7E]/, `${def.purpose}: plain English, no emoji`)
    assert.ok(view.fields.every((f) => !/[{}]/.test(f.label)), 'labels never hold braces')
  }
  // The shop's name is the business's own in the examples
  const cod = A.autoView(M.SHOP_MESSAGE_DEFS.cod_confirm, null, [], { checked: true, business: 'Asha Beauty' })
  assert.equal(cod.fields.find((f) => f.key === 'shop').sample, 'Asha Beauty')
})

test('buttons: the bill opens this app, Cash on Delivery has its two quick replies, words can change', () => {
  const b = A.autoDraft(bill, { text: A.autoView(bill, null, [], { checked: true }).suggestion.text, language: 'te', buttons: ['See my bill'] }, { name: 'bill_ready', origin: ORIGIN })
  assert.deepEqual(b.draft.buttons, [{ type: 'URL', text: 'See my bill', url: 'https://wamacrm.magnetora.in/i/{{1}}', example: 'https://wamacrm.magnetora.in/i/AbCdEf123456' }])
  assert.equal(b.draft.language, 'te')
  assert.equal(b.draft.samples['1'], 'Priya')
  const def = M.SHOP_MESSAGE_DEFS.cod_confirm
  const c = A.autoDraft(def, { text: A.autoView(def, null, [], { checked: true }).suggestion.text, language: 'xx' }, { name: 'cod_order_check', origin: ORIGIN })
  assert.deepEqual(c.draft.buttons, [{ type: 'QUICK_REPLY', text: 'Yes, send it' }, { type: 'QUICK_REPLY', text: 'Cancel order' }])
  assert.equal(c.draft.language, 'en', 'an unknown language falls back to English')
  const long = A.autoDraft(def, { text: 'Hi {Customer first name}, please confirm order {Order number} now.', language: 'en', buttons: ['Yes', 'Yes'] }, { name: 'x', origin: ORIGIN })
  assert.ok(long.problems.some((p) => /same text/.test(p)))
})

test('problems in plain words: blanks at the ends, side by side, unknown, typed by hand', () => {
  const check = (text) => A.autoDraft(bill, { text, language: 'en' }, { name: 'x', origin: ORIGIN }).problems
  assert.match(check('{Customer first name}, your bill is ready to see now').join(' '), /can't start or end with a blank/)
  assert.match(check('Hi there, your bill {Bill number}{Bill amount} is ready to see now.').join(' '), /side by side/)
  assert.match(check('Hi {Pet name}, your bill is ready to see now.').join(' '), /\{Pet name\} is not a blank/)
  assert.match(check('Hi {{1}}, your bill is ready to see now.').join(' '), /single braces/)
  assert.match(check('').join(' '), /Write the message/)
  assert.match(check('Hi {Customer first name} {Bill number} {Bill amount} ok.').join(' '), /side by side|Too many blanks/)
  assert.ok(check('Hi {Customer first name}, your bill {Bill number} is ready to see now.').length === 0)
  assert.ok(check('Hi {Customer first name}, your bill is ready.\n\nSee it any time.').length === 0, 'new lines are fine in the text')
})

test('names: free on the account, a new one for each new version, Meta refusing a taken name', () => {
  assert.equal(A.autoTemplateName('bill_ready', []), 'bill_ready')
  assert.equal(A.autoTemplateName('bill_ready', ['bill_ready', 'bill_ready_2']), 'bill_ready_3')
  assert.equal(A.autoTemplateName('Bill Ready!', ['other']), 'bill_ready')
  assert.equal(A.cleanTemplateName('__'), 'message')
  assert.ok(A.isNameTakenError({ details: [{ error_subcode: 2388024, message: 'x' }] }))
  assert.ok(A.isNameTakenError({ message: 'Message template "bill_ready" is being deleted' }))
  assert.ok(A.isNameTakenError({ details: [{ error_user_msg: 'Content in this language already exists' }] }))
  assert.ok(!A.isNameTakenError({ details: [{ error_subcode: 2388073, error_user_msg: 'Variables can not be at the start' }] }))
})

const approved = (name, extra = {}) => ({ name, language: 'en', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Hi {{1}}, bill {{2}} is ready now.' }, { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'View bill', url: 'https://x/i/{{1}}' }] }], ...extra })

test('status: in review, approved, rejected with the reason in plain words, not found, not checked', () => {
  assert.deepEqual(A.autoStatus(approved('a')), { state: 'approved', label: 'Approved', reason: null })
  assert.equal(A.autoStatus(approved('a', { status: 'PENDING' })).label, 'In review')
  const rejected = A.autoStatus(approved('a', { status: 'REJECTED', rejected_reason: 'PROMOTIONAL' }))
  assert.equal(rejected.state, 'rejected')
  assert.match(rejected.reason, /advert/)
  assert.match(A.autoStatus(approved('a', { status: 'REJECTED', rejected_reason: 'NONE' })).reason, /did not say why/)
  assert.equal(A.autoStatus(null).state, 'missing')
  assert.equal(A.autoStatus(null, false).state, 'unknown')
  assert.equal(A.autoStatus(approved('a', { status: 'PAUSED' })).state, 'paused')
})

test('view: the set-up template as the editor shows it, its fallback, and a category Meta changed', () => {
  const account = [approved('bill_ready_2', { status: 'PENDING', category: 'MARKETING' }), approved('bill_ready')]
  const view = A.autoView(bill, { name: 'bill_ready_2', language: 'en', fields: ['first_name', 'bill_number'], previous: { name: 'bill_ready', language: 'en', fields: ['first_name', 'bill_number'] } }, account, { checked: true, business: 'Asha Beauty' })
  assert.equal(view.current.state, 'review')
  assert.equal(view.current.text, 'Hi {Customer first name}, bill {Bill number} is ready now.')
  assert.deepEqual(view.current.buttons, ['View bill'])
  assert.deepEqual(view.current.previous, { name: 'bill_ready', state: 'approved' })
  assert.equal(view.current.category, 'MARKETING')
  assert.equal(view.fields.find((f) => f.key === 'business').sample, 'Asha Beauty')
  assert.equal(A.autoView(bill, null, account, { checked: true }).current, null)
})

test('a new version keeps the approved one going until Meta approves it', () => {
  const account = [approved('bill_ready'), approved('bill_ready_2', { status: 'REJECTED' })]
  // The approved one stays as the fallback
  const first = A.nextChoice({ name: 'bill_ready', language: 'en', fields: ['first_name'] }, { name: 'bill_ready_2', language: 'en', fields: ['first_name'] }, account)
  assert.deepEqual(first.previous, { name: 'bill_ready', language: 'en', fields: ['first_name'] })
  // Sent again after a rejection: the fallback is still the approved one, not the rejected one
  const again = A.nextChoice(first, { name: 'bill_ready_3', language: 'en', fields: ['first_name'] }, account)
  assert.equal(again.previous.name, 'bill_ready')
  // Nothing approved before: no fallback
  assert.equal(A.nextChoice(null, { name: 'bill_ready', language: 'en', fields: [] }, []).previous, null)
  // Approved now: the fallback is dropped
  assert.equal(A.settledChoice({ ...again, name: 'bill_ready_2' }, account).previous.name, 'bill_ready', 'rejected: keep the fallback')
  assert.equal(A.settledChoice({ name: 'bill_ready', language: 'en', fields: [], previous: { name: 'x', language: 'en', fields: [] } }, account).previous, null)
})

test('pick one I already have: approved only, link buttons only where there is a link to open', () => {
  const account = [approved('bill_ready'), approved('plain', { components: [{ type: 'BODY', text: 'Hello {{1}} there' }] }), approved('waiting', { status: 'PENDING' })]
  assert.deepEqual(A.pickableTemplates(account, bill).map((t) => t.name), ['bill_ready', 'plain'])
  const booking = A.pickableTemplates(account, FRONT_DESK_MESSAGES.booking)
  assert.deepEqual(booking.map((t) => [t.name, t.blanks, t.urlButton]), [['plain', 1, false]])
})

test('shop settings: field lists and the fallback kept, order updates always on, values by field', () => {
  const m = M.readShopMessages({
    cod_confirm: { on: true, template: 'cod_order_check_2', language: 'en', fields: ['first_name', 'order_number', 'shop', 'amount'], previous: { template: 'cod_order_check', language: 'en' } },
    review_ask: { on: true, template: 'x', language: 'en', fields: ['pet'] },
    order_update: { on: false },
  })
  assert.deepEqual(m.cod_confirm.fields, ['first_name', 'order_number', 'shop', 'amount'])
  assert.deepEqual(m.cod_confirm.previous, { template: 'cod_order_check', language: 'en' })
  assert.equal(m.review_ask.fields, undefined, 'a field this message cannot fill: the usual order')
  assert.equal(m.order_update.on, true, 'order updates follow the order screen, not a switch')
  assert.deepEqual(M.shopTemplateValues('cod_confirm', m.cod_confirm, ['Asha', 'W-1', '₹950', 'Glow']), ['Asha', 'W-1', 'Glow', '₹950'])
  assert.deepEqual(M.shopTemplateValues('cod_confirm', { template: 'old', language: 'en' }, ['Asha', 'W-1', '₹950', 'Glow']), ['Asha', 'W-1', '₹950', 'Glow'])
  assert.deepEqual(M.shopTemplateValues('order_update', { template: 't', language: 'en', fields: ['first_name', 'update'] }, ['Asha', 'W-1', 'Shipped.']), ['Asha', 'Shipped.'])
  // Front Desk keeps its fallback too, and drops a broken one
  const fd = MT.parseMessageTemplates({ bill: { name: 'bill_ready_2', language: 'en', fields: ['first_name'], url_field: 'link', previous: { name: 'bill_ready', language: 'en', fields: ['first_name'], url_field: 'link' } }, reminder: { name: 'r', language: 'en', fields: [], previous: { name: 'Bad Name', language: 'en', fields: [] } } })
  assert.equal(fd.value.bill.previous.name, 'bill_ready')
  assert.equal(fd.value.reminder.previous, undefined)
})

test('sending: a newer wording in review is refused, the earlier approved one goes instead', async () => {
  const sent = []
  const real = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    sent.push(body)
    if (body.template.name === 'cod_order_check_2') return new Response(JSON.stringify({ error: { code: 132001, message: 'Template name does not exist in the translation' } }), { status: 400 })
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 })
  }
  const errors = console.error
  console.error = () => {}
  try {
    const setting = M.readShopMessages({ cod_confirm: { on: true, template: 'cod_order_check_2', language: 'en', fields: ['first_name', 'order_number', 'shop', 'amount'], previous: { template: 'cod_order_check', language: 'en' } } }).cod_confirm
    const result = await SEND.sendShopTemplate({ whatsapp_api_token: 't', whatsapp_phone_number_id: '1' }, '+919876543210', 'cod_confirm', setting, ['Asha', 'W-1', '₹950', 'Glow'], ['codok:x', 'codno:x'])
    assert.equal(result.ok, true)
    assert.deepEqual(sent.map((s) => s.template.name), ['cod_order_check_2', 'cod_order_check'])
    assert.deepEqual(sent[0].template.components[0].parameters.map((p) => p.text), ['Asha', 'W-1', 'Glow', '₹950'], 'the new wording, by its field list')
    assert.deepEqual(sent[1].template.components[0].parameters.map((p) => p.text), ['Asha', 'W-1', '₹950', 'Glow'], 'the old one, in the usual order')
  } finally {
    globalThis.fetch = real
    console.error = errors
  }
})

test('submitting: a new Utility template under a free name, the next name when Meta says it is taken', async () => {
  const calls = []
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push(body)
    if (body.name === 'bill_ready_2') return new Response(JSON.stringify({ error: { message: 'Message template is being deleted', error_subcode: 2388023 } }), { status: 400 })
    return new Response(JSON.stringify({ id: '991', status: 'PENDING', category: 'UTILITY' }), { status: 200 })
  }
  const credentials = { token: 't', version: 'v25.0', businessAccountId: '555', phoneNumberId: '1' }
  const input = { text: A.autoView(bill, null, [], { checked: true }).suggestion.text, language: 'en', buttons: ['View bill'] }
  const result = await S.submitAutoTemplate(credentials, bill, input, { origin: ORIGIN, account: [approved('bill_ready')], fetcher })
  assert.equal(result.ok, true)
  assert.equal(result.name, 'bill_ready_3')
  assert.deepEqual(calls.map((c) => c.name), ['bill_ready_2', 'bill_ready_3'])
  assert.equal(calls[1].category, 'UTILITY')
  assert.deepEqual(result.fields, ['first_name', 'business', 'bill_number', 'amount'])
  // Problems never reach Meta
  const bad = await S.submitAutoTemplate(credentials, bill, { text: '{Customer first name}', language: 'en' }, { origin: ORIGIN, account: [], fetcher })
  assert.equal(bad.ok, false)
  assert.equal(bad.status, 400)
  assert.equal(calls.length, 2)
  // Meta's own refusal comes back in its words
  const refused = await S.submitAutoTemplate(credentials, bill, input, { origin: ORIGIN, account: [], fetcher: async () => new Response(JSON.stringify({ error: { message: 'x', error_user_msg: 'Too many templates on this account' } }), { status: 400 }) })
  assert.deepEqual([refused.ok, refused.error, refused.status], [false, 'Too many templates on this account', 422])
})
