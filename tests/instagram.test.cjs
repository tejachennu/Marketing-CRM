require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const R = require('../lib/instagram/rules.ts')
const S = require('../lib/instagram/store.ts')
const { salonDb } = require('./salon-fake-db.cjs')
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
const ORG = '11111111-1111-4111-8111-111111111111'
const IG = '17841400000000001'

test('webhook: DMs, echoes, seen, postbacks and comments (both id shapes)', () => {
  const events = R.readIgWebhook({
    object: 'instagram',
    entry: [
      { id: IG, time: 1763450000, messaging: [
        { sender: { id: '901' }, recipient: { id: IG }, timestamp: 1763450000000, message: { mid: 'm1', text: 'Is the red saree available?' } },
        { sender: { id: IG }, recipient: { id: '901' }, timestamp: 1763450001000, message: { mid: 'm2', text: 'Yes!', is_echo: true } },
        { sender: { id: '901' }, recipient: { id: IG }, timestamp: 1763450002000, message: { mid: 'm3', attachments: [{ type: 'image', payload: { url: 'https://cdn/x.jpg' } }] } },
        { sender: { id: '901' }, recipient: { id: IG }, timestamp: 1763450003000, read: { mid: 'm2' } },
        { sender: { id: '901' }, recipient: { id: IG }, timestamp: 1763450004000, message: { mid: 'm4', is_deleted: true } },
      ], changes: [
        { field: 'comments', value: { from: { id: '777', username: 'asha' }, comment_id: 'c1', text: 'Price?', media: { id: 'med1', media_product_type: 'REELS' } } },
        { field: 'comments', value: { from: { id: '778', username: 'ravi' }, id: 'c2', text: 'Nice', media: { id: 'med1' } } },
        { field: 'mentions', value: {} },
      ] },
    ],
  })
  assert.deepEqual(events.map((e) => e.kind), ['message', 'message', 'message', 'seen', 'comment', 'comment'])
  assert.equal(events[0].senderId, '901')
  assert.equal(events[1].echo, true)
  assert.equal(events[1].senderId, '901') // echo: the customer is the recipient
  assert.equal(R.messageText(events[2]), '[Photo]')
  assert.deepEqual([events[4].commentId, events[5].commentId], ['c1', 'c2'])
  assert.deepEqual(R.readIgWebhook({ object: 'page', entry: [] }), [])
})

test('reply bodies and the reply window', () => {
  assert.deepEqual(R.dmBody('901', { text: 'Hi' }), { recipient: { id: '901' }, message: { text: 'Hi' } })
  assert.deepEqual(R.dmBody('901', { text: 'Hi', humanAgent: true }), { recipient: { id: '901' }, message: { text: 'Hi' }, messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' })
  assert.ok(R.dmBody('901', { text: 'x'.repeat(1001) }).error)
  assert.ok(R.dmBody('901', {}).error)
  assert.equal(R.dmBody('901', { imageUrl: 'https://a/b.jpg' }).message.attachment.type, 'image')
  const now = Date.parse('2026-11-19T12:00:00Z')
  assert.deepEqual(R.replyWindow('2026-11-19T01:00:00Z', now), { ok: true, humanAgent: false })
  assert.deepEqual(R.replyWindow('2026-11-16T12:00:00Z', now), { ok: true, humanAgent: true })
  assert.equal(R.replyWindow('2026-11-01T12:00:00Z', now).ok, false)
  assert.equal(R.replyWindow(null, now).ok, false)
})

test('feed items, captions, product captions; Instagram contacts never in campaigns', () => {
  assert.equal(R.feedItem({ id: '1', media_type: 'VIDEO', thumbnail_url: 'https://t.jpg', permalink: 'https://instagram.com/p/x' }).image, 'https://t.jpg')
  assert.equal(R.feedItem({ id: '2', media_type: 'VIDEO', permalink: 'https://instagram.com/p/y' }).image, '') // copyrighted audio: no media_url
  assert.equal(R.feedItem({ id: '3', media_type: 'IMAGE', media_url: 'https://m.jpg' }), null) // no permalink
  assert.ok(R.checkCaption('#a '.repeat(31)).error)
  assert.equal(R.checkCaption(' New arrivals ').caption, 'New arrivals')
  assert.equal(R.productCaption({ title: 'Red saree', price: 1299, description: 'Soft cotton.' }, 'https://shop/x'), 'Red saree · ₹1,299\n\nSoft cotton.\n\nOrder: https://shop/x')
  const A = require('../lib/campaigns/audience.ts')
  assert.equal(A.toDialablePhone(R.igContactKey('17841400000000001')), null)
  assert.equal(A.toDialablePhone('ig:12345678'), null)
})

function graph(routes) {
  const calls = []
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null })
    for (const [match, reply] of routes) if (String(url).includes(match)) { const r = typeof reply === 'function' ? reply(String(url), init) : reply; return { ok: !r.error, status: r.error ? 400 : 200, json: async () => r } }
    return { ok: false, status: 404, json: async () => ({ error: { message: 'not mocked', code: 1 } }) }
  }
  return { fetcher, calls }
}

test('connect: code → token → assigned account → saved and subscribed; one workspace per account', async () => {
  process.env.META_APP_ID = 'app1'; process.env.META_APP_SECRET = 'sec'
  const db = salonDb({ instagram_accounts: [] })
  const { fetcher, calls } = graph([
    ['/oauth/access_token', { access_token: 'BISU', token_type: 'bearer' }],
    ['/me/assigned_instagram_accounts', { data: [{ id: IG, username: 'ashasilks' }] }],
    ['/me?', { client_business_id: 'biz1', id: 'x' }],
    [`/${IG}/subscribed_apps`, { success: true }],
    [`/${IG}?`, { id: IG, username: 'ashasilks', name: 'Asha Silks', profile_picture_url: 'https://p.jpg' }],
  ])
  const res = await S.connectInstagram(db, ORG, { code: 'abcdefghijkl' }, fetcher)
  assert.equal(res.account.username, 'ashasilks')
  assert.equal(res.account.subscribed, true)
  assert.equal(db.tables.instagram_accounts[0].access_token, 'BISU')
  assert.equal(S.publicAccount(db.tables.instagram_accounts[0]).access_token, undefined)
  assert.ok(calls.some((c) => c.url.startsWith('https://graph.facebook.com/v27.0/oauth/access_token') && c.url.includes('client_secret=sec')))
  assert.ok(calls.some((c) => c.method === 'POST' && c.url.includes(`/${IG}/subscribed_apps?subscribed_fields=messages%2Cmessaging_postbacks%2Cmessaging_seen%2Ccomments`)))
  const other = await S.connectInstagram(db, '22222222-2222-4222-8222-222222222222', { code: 'abcdefghijkl' }, fetcher)
  assert.match(other.error, /already connected to another/)
})

test('DMs: saved once into an Instagram chat; replies honour the window; AI cannot use the Human Agent tag', async () => {
  const account = { id: 'a1', organization_id: ORG, ig_user_id: IG, access_token: 'BISU' }
  const db = salonDb({ instagram_accounts: [account], contacts: [], conversations: [], messages: [] })
  const { fetcher, calls } = graph([
    ['/901?', { name: 'Ravi Kumar', username: 'ravik' }],
    [`/${IG}/messages`, { recipient_id: '901', message_id: 'out1' }],
  ])
  const m = { kind: 'message', accountId: IG, senderId: '901', mid: 'm1', text: 'Hi', attachments: [], timestamp: Date.now() - 60_000, echo: false, replyTo: null }
  const saved = await S.saveIncomingDm(db, account, m, fetcher)
  assert.equal(saved.contact.phone_number, 'ig:901')
  assert.equal(saved.contact.instagram_username, 'ravik')
  assert.equal(saved.conversation.channel, 'instagram')
  assert.equal(await S.saveIncomingDm(db, account, m, fetcher), null) // Meta retries: once only
  const sent = await S.sendDm(db, ORG, saved.conversation, { text: 'Yes, in stock', byPerson: true }, fetcher)
  assert.deepEqual(sent, { ok: true, mid: 'out1' })
  assert.deepEqual(calls.at(-1).body, { recipient: { id: '901' }, message: { text: 'Yes, in stock' } })
  // Three days later only a person may answer (Human Agent tag)
  db.tables.messages[0].created_at = new Date(Date.now() - 3 * 86_400_000).toISOString()
  assert.equal((await S.sendDm(db, ORG, saved.conversation, { text: 'Hi', byPerson: false }, fetcher)).ok, false)
  await S.sendDm(db, ORG, saved.conversation, { text: 'Hi', byPerson: true }, fetcher)
  assert.equal(calls.at(-1).body.tag, 'HUMAN_AGENT')
})

test('comments: saved, own replies skipped, reply / private reply once / hide / delete', async () => {
  const account = { id: 'a1', organization_id: ORG, ig_user_id: IG, access_token: 'BISU' }
  const db = salonDb({ instagram_accounts: [account], instagram_comments: [] })
  await S.saveComment(db, account, { kind: 'comment', accountId: IG, commentId: 'c1', parentId: null, text: 'Price?', fromId: '777', fromUsername: 'asha', mediaId: 'med1', mediaType: 'REELS', timestamp: Date.now() })
  await S.saveComment(db, account, { kind: 'comment', accountId: IG, commentId: 'c9', parentId: 'c1', text: 'DM sent!', fromId: IG, fromUsername: 'ashasilks', mediaId: 'med1', mediaType: '', timestamp: Date.now() })
  assert.equal(db.tables.instagram_comments.length, 1)
  const { fetcher, calls } = graph([['/c1/replies', { id: 'r1' }], [`/${IG}/messages`, { message_id: 'pm1' }], ['/c1?hide=true', { success: true }], ['/c1', { success: true }]])
  assert.deepEqual(await S.actOnComment(db, ORG, 'c1', { type: 'reply', text: 'Sent you a DM' }, fetcher), { ok: true })
  assert.deepEqual(await S.actOnComment(db, ORG, 'c1', { type: 'private', text: 'It is ₹1,299' }, fetcher), { ok: true })
  assert.deepEqual(calls.at(-1).body, { recipient: { comment_id: 'c1' }, message: { text: 'It is ₹1,299' } })
  assert.match((await S.actOnComment(db, ORG, 'c1', { type: 'private', text: 'again' }, fetcher)).error, /one private reply/)
  await S.actOnComment(db, ORG, 'c1', { type: 'hide' }, fetcher)
  assert.equal(db.tables.instagram_comments[0].hidden, true)
  await S.actOnComment(db, ORG, 'c1', { type: 'delete' }, fetcher)
  assert.ok(db.tables.instagram_comments[0].deleted_at)
})

test('posting: one photo or a carousel, waits until ready, explains the daily limit', async () => {
  const account = { id: 'a1', organization_id: ORG, ig_user_id: IG, access_token: 'BISU' }
  const db = salonDb({ instagram_accounts: [account] })
  let n = 0
  const { fetcher, calls } = graph([
    [`/${IG}/media_publish`, { id: 'media9' }],
    [`/${IG}/media?`, () => ({ id: `cont${++n}` })],
    ['fields=status_code', () => ({ status_code: n > 2 ? 'FINISHED' : 'FINISHED' })],
  ])
  const one = await S.publishPost(db, ORG, { images: ['https://a/1.jpg'], caption: 'New' }, fetcher, async () => {})
  assert.deepEqual(one, { ok: true, mediaId: 'media9' })
  const many = await S.publishPost(db, ORG, { images: ['https://a/1.jpg', 'https://a/2.jpg'], caption: 'Two' }, fetcher, async () => {})
  assert.equal(many.ok, true)
  assert.ok(calls.some((c) => c.url.includes('media_type=CAROUSEL') && c.url.includes('children=cont2%2Ccont3')))
  assert.ok((await S.publishPost(db, ORG, { images: ['http://x'], caption: '' }, fetcher)).error)
  const limit = graph([[`/${IG}/media?`, { error: { message: 'limit', code: 9, error_subcode: 2207042 } }]])
  assert.match((await S.publishPost(db, ORG, { images: ['https://a/1.jpg'], caption: '' }, limit.fetcher)).error, /posts-per-day/)
})

test('wiring: migration, webhook signed, inbox replies go to Instagram, store live feed', () => {
  assert.equal(read('supabase/migrations/20261204_instagram.sql'), S.INSTAGRAM_SQL)
  const hook = read('app/api/webhooks/instagram/route.ts')
  assert.match(hook, /verifyMetaSignature\(raw/)
  assert.match(hook, /INSTAGRAM_WEBHOOK_VERIFY_TOKEN/)
  assert.match(read('app/api/messages/send/route.ts'), /channel === 'instagram'[\s\S]*sendDm\(supabase, orgId, conversation/)
  assert.match(read('lib/commerce/storefront.ts'), /settings\.instagram\.live \? /)
  assert.match(read('app/dashboard/layout.tsx'), /'\/dashboard\/instagram'/)
})
