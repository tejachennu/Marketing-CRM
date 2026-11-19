require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const F = require('../lib/ai/reply-format.ts')
const R = require('../lib/ai/knowledge-rules.ts')
const S = require('../lib/ai/knowledge-store.ts')
const IG = require('../lib/instagram/rules.ts')
const { salonDb } = require('./salon-fake-db.cjs')
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')
const ORG = '11111111-1111-4111-8111-111111111111'
const bytes = (s) => new TextEncoder().encode(s).length

test('each channel\'s look: WhatsApp keeps *bold* and • lists; Instagram has no marks', () => {
  assert.equal(F.forWhatsApp('## Prices\n**Hair cut:** ₹300\n- Facial\n* Pedicure\n[Book](https://glow.in/b)'), '*Prices*\n*Hair cut:* ₹300\n• Facial\n• Pedicure\nBook: https://glow.in/b')
  assert.equal(F.forInstagram('*Hair cut:* ₹300, _today_ only ~old~\n- Facial'), 'Hair cut: ₹300, today only old\n• Facial')
  assert.equal(F.forInstagram('2*3 = 6 and file_name.pdf'), '2*3 = 6 and file_name.pdf', 'stars and underscores inside words stay')
})

test('long Instagram answers go as up to three messages of at most 1,000 characters', () => {
  assert.deepEqual(F.splitMessage('Short.'), ['Short.'])
  const long = Array.from({ length: 60 }, (_, i) => `Sentence ${i} tells something useful about the shop.`).join(' ')
  const parts = F.splitMessage(long, 1000, 3)
  assert.ok(parts.length >= 2 && parts.length <= 3)
  assert.ok(parts.every((p) => bytes(p) <= 1000))
  const telugu = 'మా షాప్ ఉదయం 10 నుండి రాత్రి 9 వరకు తెరిచి ఉంటుంది. '.repeat(30)
  assert.ok(F.splitMessage(telugu, 1000, 3).every((p) => bytes(p) <= 1000), 'counted in bytes, so Telugu fits too')
  const huge = F.splitMessage('word '.repeat(2000), 1000, 3)
  assert.equal(huge.length, 3)
  assert.ok(huge[2].endsWith('…'))
  assert.deepEqual(F.splitMessage('  '), [])
})

test('quick buttons: short labels, the full question behind them, "Talk to a person" last', () => {
  assert.equal(F.buttonTitle('Sunday timings?'), 'Sunday timings')
  assert.ok(F.buttonTitle('What are your timings on Sunday and holidays').length <= 20)
  const b = F.quickButtons([{ label: 'Sunday timings', question: 'What are your timings on Sunday?' }, 'Price list', 'Third one'], { person: true })
  assert.deepEqual(b, [
    { title: 'Sunday timings', id: 'aq:What are your timings on Sunday?' },
    { title: 'Price list', id: 'aq:Price list' },
    { title: 'Talk to a person', id: 'aq:Talk to a person' },
  ])
  assert.deepEqual(F.quickButtons([], { person: false }), [])
  assert.equal(F.quickButtons(['Talk to a person', 'Parking'], { person: true }).length, 2, 'no second person button')
  assert.equal(F.askedByButton('aq:What are your timings on Sunday?'), 'What are your timings on Sunday?')
  assert.equal(F.askedByButton('codok:123'), null)
  assert.equal(F.askedByButton('aq:'), null)
  // The person button's words are understood as asking for a person
  assert.equal(R.wantsPerson(F.askedByButton('aq:Talk to a person')), true)
})

test('WhatsApp: buttons, or one link button, else text; always a plain twin', () => {
  const withButtons = F.whatsappMessage({ text: 'Hair cut is **₹300**.', buttons: F.quickButtons(['Price list'], { person: true }) })
  assert.equal(withButtons.message.type, 'interactive')
  assert.equal(withButtons.message.interactive.type, 'button')
  assert.equal(withButtons.message.interactive.body.text, 'Hair cut is *₹300*.')
  assert.equal(withButtons.message.interactive.action.buttons.length, 2)
  assert.deepEqual(withButtons.plain, { type: 'text', text: { body: 'Hair cut is *₹300*.', preview_url: false } })

  const withLink = F.whatsappMessage({ text: 'You can book online.', link: { url: 'https://glow.in/book', label: 'Book online' } })
  assert.equal(withLink.message.interactive.type, 'cta_url')
  assert.deepEqual(withLink.message.interactive.action, { name: 'cta_url', parameters: { display_text: 'Book online', url: 'https://glow.in/book' } })
  assert.equal(withLink.plain.text.body, 'You can book online.\n\nBook online: https://glow.in/book')
  assert.equal(withLink.plain.text.preview_url, true)

  // Too long for a button message (1,024): plain text
  const long = F.whatsappMessage({ text: 'x'.repeat(1100), buttons: F.quickButtons([], { person: true }) })
  assert.equal(long.message, long.plain)
  assert.equal(F.whatsappMessage({ text: 'Hi' }).message.type, 'text')
  assert.deepEqual(F.whatsappTyping('wamid.ABC'), { messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.ABC', typing_indicator: { type: 'text' } })
})

test('Instagram: chips under the last message, link written out, quick replies read back', () => {
  const msgs = F.instagramMessages({ text: '*Yes*, open today.', buttons: F.quickButtons(['Parking'], { person: true }), link: { url: 'https://glow.in/map', label: 'Map' } })
  assert.equal(msgs.length, 1)
  assert.equal(msgs[0].text, 'Yes, open today.\n\nMap: https://glow.in/map')
  assert.deepEqual(msgs[0].quick_replies.map((q) => q.payload), ['aq:Parking', 'aq:Talk to a person'])
  const bodies = IG.dmBodies('igsid', { text: 'Hello', quickReplies: [{ title: 'Talk to a person', payload: 'aq:Talk to a person' }] })
  assert.deepEqual(bodies[0].message, { text: 'Hello', quick_replies: [{ content_type: 'text', title: 'Talk to a person', payload: 'aq:Talk to a person' }] })
  assert.deepEqual(IG.dmBodies('igsid', { text: 'Hello' })[0].message, { text: 'Hello' })
  const events = IG.readIgWebhook({ object: 'instagram', entry: [{ id: 'biz', messaging: [{ sender: { id: 'cust' }, recipient: { id: 'biz' }, timestamp: 1, message: { mid: 'm1', text: 'Sunday timings', quick_reply: { payload: 'aq:What are your timings on Sunday?' } } }] }] })
  assert.equal(events[0].text, 'What are your timings on Sunday?')
})

test('reply style settings and the AI\'s instructions', () => {
  assert.deepEqual(F.readReplyStyle(null), F.DEFAULT_STYLE)
  assert.deepEqual(F.readReplyStyle({ tone: 'short', emoji: false, buttons: false, typing: false }), { tone: 'short', emoji: false, buttons: false, typing: false })
  assert.equal(F.readReplyStyle({ tone: 'rude' }).tone, 'friendly')
  assert.match(F.styleRules(F.DEFAULT_STYLE, 'instagram'), /No formatting marks/)
  assert.match(F.styleRules({ ...F.DEFAULT_STYLE, emoji: false }, 'whatsapp'), /\*bold\*[\s\S]*No emoji/)
  assert.deepEqual(R.parseAnswer('{"reply":"x","status":"answered","next":[{"label":"Parking","question":"Do you have parking?"},"Price list",{"label":""},"a","b"]}').next, [{ label: 'Parking', question: 'Do you have parking?' }, { label: 'Price list', question: 'Price list' }])
})

test('search ranking: the exact question first, FAQs ahead of parts that scored the same', () => {
  const hits = [
    { id: 'p', title: 'Menu — Prices', content: 'Hair cut 300', score: 0.033, similarity: 0.6, wordScore: 0.5, kind: 'part' },
    { id: 'f', title: 'How much is a hair cut?', content: '₹300', score: 0.032, similarity: 0.58, wordScore: 0.4, kind: 'faq' },
    { id: 'o', title: 'Do you have parking?', content: 'Yes', score: 0.031, similarity: 0.4, wordScore: null, kind: 'faq' },
  ]
  assert.deepEqual(R.rankHits(hits, 'how much is a hair cut').map((h) => h.id), ['f', 'p', 'o'])
  assert.equal(R.rankHits(hits, 'parking do you have?')[0].id, 'o', 'same words in another order still match the question')
  const merged = R.mergeByMeaning([[{ id: 'a', title: 'A', content: 'x', similarity: 0.5 }], [{ id: 'a', title: 'A', content: 'x', similarity: 0.7 }, { id: 'b', title: 'B', content: 'y', similarity: 0.6 }]])
  assert.deepEqual(merged.map((r) => [r.id, r.similarity]), [['a', 0.7], ['b', 0.6]])
  assert.equal(R.sameMeaningText('Do you have parking?', 'parking you have'), true)
  assert.equal(R.sameMeaningText('price entha', 'What is the price?'), false)
})

test('a matching part comes with the text around it, without repeating the overlap', async () => {
  assert.equal(R.joinPassage('First part ends here. Shared tail words', 'Shared tail words\n\nSecond part.', null), 'First part ends here. Shared tail words\n\nSecond part.')
  assert.equal(R.joinPassage(null, 'Only.', 'After.'), 'Only.\n\nAfter.')
  const long = R.joinPassage('a'.repeat(3000), 'MIDDLE', 'b'.repeat(3000), 1000)
  assert.ok(long.length <= 1002 && long.includes('MIDDLE'))
  const db = salonDb({ knowledge_base: [
    { id: 'k0', organization_id: ORG, source_id: 's1', chunk_index: 0, content: 'Returns within 7 days.' },
    { id: 'k1', organization_id: ORG, source_id: 's1', chunk_index: 1, content: 'Refunds reach your bank in 5 days.' },
    { id: 'k2', organization_id: ORG, source_id: 's1', chunk_index: 2, content: 'Exchanges are free once.' },
    { id: 'x1', organization_id: ORG, source_id: 's2', chunk_index: 0, content: 'Other document.' },
  ] })
  const out = await S.withNeighbours(db, ORG, [
    { id: 'k1', title: 'Policy', content: 'Refunds reach your bank in 5 days.', score: 1, similarity: 0.6, wordScore: null, kind: 'part' },
    { id: 'f1', title: 'FAQ', content: 'An FAQ stays as it is.', score: 0.9, similarity: 0.5, wordScore: null, kind: 'faq' },
  ])
  assert.equal(out[0].content, 'Returns within 7 days.\n\nRefunds reach your bank in 5 days.\n\nExchanges are free once.')
  assert.equal(out[1].content, 'An FAQ stays as it is.')
})

test('both channels send the AI answer in their own style', () => {
  const hook = read('app/api/webhooks/facebook/[orgIdAndSlug]/route.ts')
  assert.match(hook, /const asked = askedByButton\(interactiveButtonId\)/)
  assert.match(hook, /whatsappTyping\(messageSid\)/)
  assert.match(hook, /const tries = styled === plain \? \[plain\] : \[styled, plain\]/, 'plain text when Meta refuses the buttons')
  const ig = read('lib/instagram/automation.ts')
  assert.match(ig, /instagramMessages\(answer\.plan/)
  assert.match(ig, /sendTyping\(db, account\.organization_id, conversation\)/)
  assert.match(read('lib/ai/faq-answer.ts'), /quickButtons\(answer\.next/)
})
