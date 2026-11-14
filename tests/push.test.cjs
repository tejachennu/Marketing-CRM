require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { generateKeyPairSync, createVerify } = require('node:crypto')

const P = require('../lib/push.ts')

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
const ACCOUNT = JSON.stringify({ client_email: 'push@test.iam.gserviceaccount.com', private_key: privateKey, project_id: 'test-project' })

function withEnv(values, fn) {
  const before = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]))
  Object.assign(process.env, values)
  return Promise.resolve().then(fn).finally(() => { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } })
}

function database(rows) {
  const tables = { device_tokens: rows }
  const from = (table) => {
    let filters = [], op = 'select'
    const q = {
      select() { return q }, eq(k, v) { filters.push((r) => r[k] === v); return q }, in(k, list) { filters.push((r) => list.includes(r[k])); return q }, limit() { return q },
      delete() { op = 'delete'; return q },
      then(resolve, reject) {
        const rows = tables[table].filter((r) => filters.every((f) => f(r)))
        if (op === 'delete') tables[table] = tables[table].filter((r) => !rows.includes(r))
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject)
      },
    }
    return q
  }
  return { from, tables }
}

function fetcher(answer) {
  const calls = []
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body })
    if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), { status: 200 })
    const [status, body] = answer(JSON.parse(init.body).message.token)
    return new Response(JSON.stringify(body), { status })
  }
  f.calls = calls
  return f
}

const NOTICE = { kind: 'message', title: 'Priya', body: 'Hi,\n are you open today?', open: 'chat:c1', tag: 'chat:c1' }
const phones = () => [
  { token: 'phone-a', user_id: 'u1', organization_id: 'org-1' },
  { token: 'phone-b', user_id: 'u2', organization_id: 'org-1' },
  { token: 'phone-x', user_id: 'u9', organization_id: 'org-2' },
]

test('Push: the migration file is the same SQL the app runs', () => {
  const file = require('fs').readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261113_push_devices.sql'), 'utf8')
  assert.equal(P.PUSH_SQL, file)
  assert.equal(P.PUSH_LOCK, 724519014)
})

test('Push: the app gets its Firebase settings only when all four are set', () => {
  assert.equal(P.firebaseAppConfig({ FIREBASE_PROJECT_ID: 'p' }), null)
  assert.deepEqual(P.firebaseAppConfig({ FIREBASE_PROJECT_ID: 'p', FIREBASE_ANDROID_APP_ID: '1:2:android:3', FIREBASE_API_KEY: 'k', FIREBASE_SENDER_ID: '2' }), { projectId: 'p', appId: '1:2:android:3', apiKey: 'k', senderId: '2', iosAppId: null })
})

test('Push: the service account is read as JSON or base64, and the request to Google is signed with it', () => {
  assert.equal(P.serviceAccount({}), null)
  assert.equal(P.serviceAccount({ FIREBASE_SERVICE_ACCOUNT: 'not json' }), null)
  const account = P.serviceAccount({ FIREBASE_SERVICE_ACCOUNT: Buffer.from(ACCOUNT).toString('base64') })
  assert.equal(account.project_id, 'test-project')
  const [head, claims, signature] = P.signedAssertion(account, 1_800_000_000_000).split('.')
  assert.equal(JSON.parse(Buffer.from(claims, 'base64url')).scope, 'https://www.googleapis.com/auth/firebase.messaging')
  assert.equal(createVerify('RSA-SHA256').update(`${head}.${claims}`).verify(publicKey, Buffer.from(signature, 'base64url')), true)
})

test('Push: one notification per chat, opening that chat, on the right channel', () => {
  const { message } = P.fcmMessage('phone-a', NOTICE)
  assert.deepEqual(message.notification, { title: 'Priya', body: 'Hi, are you open today?' })
  assert.deepEqual(message.data, { open: 'chat:c1', kind: 'message' })
  assert.equal(message.android.notification.channel_id, 'messages')
  assert.equal(message.android.notification.tag, 'chat:c1')
  assert.equal(P.fcmMessage('p', { ...NOTICE, kind: 'booking', open: 'bookings' }).message.android.notification.channel_id, 'bookings')
})

test('Push: goes to the workspace\'s phones only, or just the people named', async () => {
  await withEnv({ FIREBASE_SERVICE_ACCOUNT: ACCOUNT }, async () => {
    P.resetPushToken()
    const db = database(phones())
    const all = fetcher(() => [200, { name: 'ok' }])
    assert.equal(await P.sendPush(db, { organizationId: 'org-1' }, NOTICE, all), 2)
    assert.match(all.calls[1].url, /projects\/test-project\/messages:send$/)
    const one = fetcher(() => [200, {}])
    assert.equal(await P.sendPush(db, { organizationId: 'org-1', userIds: ['u2', null] }, NOTICE, one), 1)
    assert.equal(JSON.parse(one.calls.at(-1).body).message.token, 'phone-b')
    // Not the person who did it
    assert.equal(await P.sendPush(db, { organizationId: 'org-1', userIds: ['u2'], exceptUserId: 'u2' }, NOTICE, fetcher(() => [200, {}])), 0)
  })
})

test('Push: a phone Firebase no longer knows is forgotten; nothing is sent without the service account', async () => {
  await withEnv({ FIREBASE_SERVICE_ACCOUNT: ACCOUNT }, async () => {
    P.resetPushToken()
    const db = database(phones())
    const gone = fetcher((token) => (token === 'phone-a' ? [404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }] : [200, {}]))
    assert.equal(await P.sendPush(db, { organizationId: 'org-1' }, NOTICE, gone), 1)
    assert.deepEqual(db.tables.device_tokens.map((r) => r.token), ['phone-b', 'phone-x'])
  })
  await withEnv({ FIREBASE_SERVICE_ACCOUNT: '' }, async () => {
    const none = fetcher(() => [200, {}])
    assert.equal(await P.sendPush(database(phones()), { organizationId: 'org-1' }, NOTICE, none), 0)
    assert.equal(none.calls.length, 0)
  })
})

// ── Pop-ups for what happens in a workspace (lib/push-events.ts) ──

const E = require('../lib/push-events.ts')

function eventsDatabase() {
  const tables = { device_tokens: phones(), conversations: [{ id: 'conv-1', organization_id: 'org-1', assigned_to: 'u2' }, { id: 'conv-2', organization_id: 'org-1', assigned_to: null }] }
  const from = (table) => {
    let filters = [], single = false
    const q = {
      select() { return q }, eq(k, v) { filters.push((r) => r[k] === v); return q }, in(k, list) { filters.push((r) => list.includes(r[k])); return q }, limit() { return q },
      maybeSingle() { single = true; return q },
      then(resolve, reject) {
        const rows = tables[table].filter((r) => filters.every((f) => f(r)))
        return Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(resolve, reject)
      },
    }
    return q
  }
  return { from }
}

/** Run with Firebase faked; returns what was sent (token, notification, android channel, open). */
async function sent(run) {
  const real = globalThis.fetch
  const f = fetcher(() => [200, {}])
  globalThis.fetch = f
  try {
    await withEnv({ FIREBASE_SERVICE_ACCOUNT: ACCOUNT }, async () => { P.resetPushToken(); await run() })
  } finally {
    globalThis.fetch = real
  }
  return f.calls.filter((c) => c.url.includes('messages:send')).map((c) => {
    const m = JSON.parse(c.body).message
    return { token: m.token, title: m.notification.title, body: m.notification.body, channel: m.android.notification.channel_id, open: m.data.open }
  })
}

test('Push events: a raised ticket goes to whoever has the chat, else to everyone, and opens Tickets', async () => {
  const owned = await sent(() => E.notifyTicketRaised(eventsDatabase(), { organizationId: 'org-1', ticketId: 't1', subject: 'Refund please', contactName: 'Priya', conversationId: 'conv-1' }))
  assert.deepEqual(owned.map((s) => s.token), ['phone-b'])
  assert.equal(owned[0].channel, 'tickets')
  assert.equal(owned[0].open, 'tickets')
  assert.match(owned[0].title, /New ticket · Priya/)
  const nobody = await sent(() => E.notifyTicketRaised(eventsDatabase(), { organizationId: 'org-1', ticketId: 't2', subject: 'Help', conversationId: 'conv-2' }))
  assert.deepEqual(nobody.map((s) => s.token).sort(), ['phone-a', 'phone-b'])
})

test('Push events: a paid or COD order tells the whole workspace and opens Orders', async () => {
  const out = await sent(() => E.notifyOrderReady(eventsDatabase(), { organizationId: 'org-1', orderId: 'o1', orderNumber: 'ORD-1', how: 'paid', amount: '₹1,499', customer: 'Priya' }))
  assert.equal(out.length, 2)
  assert.equal(out[0].channel, 'orders')
  assert.equal(out[0].open, 'orders')
  assert.match(out[0].title, /Payment received · ₹1,499/)
  assert.match(out[0].body, /ORD-1 from Priya is ready to ship/)
})

test('Push events: a deal given to someone tells only them, never for their own deal', async () => {
  const given = await sent(() => E.notifyDealAssigned(eventsDatabase(), { organizationId: 'org-1', dealId: 'd1', title: 'Bridal package', ownerId: 'u1', byUserId: 'u2' }))
  assert.deepEqual(given.map((s) => [s.token, s.channel, s.open]), [['phone-a', 'deals', 'deals']])
  assert.equal((await sent(() => E.notifyDealAssigned(eventsDatabase(), { organizationId: 'org-1', dealId: 'd1', ownerId: 'u1', byUserId: 'u1' }))).length, 0)
})

test('Push events: only a review of 3 stars or less pops up', async () => {
  const low = await sent(() => E.notifyLowReview(eventsDatabase(), { organizationId: 'org-1', feedbackId: 'f1', rating: 2, customer: 'Ravi', comment: 'Waited long' }))
  assert.equal(low.length, 2)
  assert.equal(low[0].channel, 'reviews')
  assert.match(low[0].title, /2★ review from Ravi/)
  assert.equal((await sent(() => E.notifyLowReview(eventsDatabase(), { organizationId: 'org-1', feedbackId: 'f2', rating: 5 }))).length, 0)
})
