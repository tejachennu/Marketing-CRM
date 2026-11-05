require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { createHmac } = require('node:crypto')

const B = require('../lib/billing.ts')
const S = require('../lib/billing-service.ts')
const R = require('../lib/razorpay.ts')
const A = require('../lib/ai-access.ts')

const DAY = 86_400_000
const NOW = Date.parse('2026-11-05T10:00:00Z')
const iso = (offsetDays) => new Date(NOW + offsetDays * DAY).toISOString()
const row = (changes = {}) => ({
  organization_id: 'org-1', billing_exempt: false, plan: 'pro_monthly', status: 'trialing', trial_ends_at: iso(10),
  current_period_end: null, cancel_at_period_end: false, razorpay_subscription_id: null, ai_balance: 300, ai_allowance: 300, ...changes,
})

/** A small in-memory stand-in for the Supabase client, with the two wallet functions. */
function database(seed = {}) {
  const tables = { organizations: [], organization_billing: [], ai_wallet_transactions: [], billing_payments: [], ...structuredClone(seed) }
  const unique = { billing_payments: 'razorpay_payment_id', organization_billing: 'organization_id' }
  const from = (table) => {
    let filters = [], op = 'select', values, singular = false
    const query = {
      select() { return this }, eq(key, value) { filters.push((r) => r[key] === value); return this },
      maybeSingle() { singular = true; return this }, single() { singular = true; return this },
      insert(data) { op = 'insert'; values = data; return this }, update(data) { op = 'update'; values = data; return this },
      then(resolve, reject) {
        let rows = tables[table].filter((r) => filters.every((f) => f(r)))
        if (op === 'insert') {
          const key = unique[table]
          if (key && tables[table].some((r) => r[key] === values[key])) return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value' } }).then(resolve, reject)
          const defaults = table === 'organization_billing' ? row({ organization_id: values.organization_id, trial_ends_at: iso(14) }) : {}
          rows = [{ ...defaults, ...structuredClone(values) }]
          tables[table].push(...rows)
        } else if (op === 'update') rows.forEach((r) => Object.assign(r, structuredClone(values)))
        return Promise.resolve({ data: structuredClone(singular ? rows[0] || null : rows), error: null }).then(resolve, reject)
      },
    }
    return query
  }
  const rpc = async (fn, args) => {
    const billing = tables.organization_billing.find((r) => r.organization_id === args.p_org)
    if (fn === 'ai_wallet_charge') {
      billing.ai_balance = Math.max(0, Number(billing.ai_balance) - args.p_amount)
      tables.ai_wallet_transactions.push({ organization_id: args.p_org, kind: 'usage', amount: -args.p_amount, feature: args.p_feature, model: args.p_model, tokens: args.p_tokens })
      return { data: billing.ai_balance, error: null }
    }
    if (fn === 'ai_wallet_credit') {
      if (args.p_payment_id && tables.ai_wallet_transactions.some((t) => t.razorpay_payment_id === args.p_payment_id)) return { data: billing.ai_balance, error: null }
      billing.ai_balance = Number(billing.ai_balance) + args.p_amount
      billing.ai_allowance = billing.ai_balance
      tables.ai_wallet_transactions.push({ organization_id: args.p_org, kind: args.p_kind, amount: args.p_amount, razorpay_payment_id: args.p_payment_id })
      return { data: billing.ai_balance, error: null }
    }
    return { data: null, error: { message: `unknown function ${fn}` } }
  }
  return { from, rpc, tables }
}

/** fetch for api.razorpay.com and api.openai.com, answering from a table of routes. */
function fakeFetch(routes) {
  const calls = []
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    const key = `${init.method || 'GET'} ${String(url).replace(/^https:\/\/api\.(razorpay|openai)\.com\/v1/, '')}`
    const handler = routes[key]
    if (!handler) return new Response(JSON.stringify({ error: { description: `no route ${key}` } }), { status: 404 })
    const [status, body] = typeof handler === 'function' ? handler(init) : [200, handler]
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }
  fetcher.calls = calls
  return fetcher
}

function withEnv(values, fn) {
  const before = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]))
  Object.assign(process.env, values)
  const restore = () => { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } }
  return Promise.resolve().then(fn).finally(restore)
}

// ── The plan and the trial ──────────────────────────────────────────────────

test('Billing: one plan at ₹3,000 a month', () => {
  assert.equal(B.PLAN.amountPaise, 300000)
  assert.equal(B.PLAN.currency, 'INR')
  assert.equal(B.PLAN.interval, 'monthly')
  assert.equal(B.FREE_AI_CREDIT, 300)
})

test('Billing: a trial gives access until it ends, then the workspace is locked', () => {
  const trial = B.billingState(row(), NOW)
  assert.equal(trial.hasAccess, true)
  assert.equal(trial.status, 'trialing')
  assert.equal(trial.trialDaysLeft, 10)
  const over = B.billingState(row({ trial_ends_at: iso(-1) }), NOW)
  assert.equal(over.hasAccess, false)
  assert.equal(over.status, 'expired')
})

test('Billing: a paid month keeps access, with a few days of grace for a late renewal', () => {
  assert.equal(B.billingState(row({ status: 'active', current_period_end: iso(20) }), NOW).hasAccess, true)
  assert.equal(B.billingState(row({ status: 'active', current_period_end: iso(-2) }), NOW).hasAccess, true)
  assert.equal(B.billingState(row({ status: 'active', current_period_end: iso(-4) }), NOW).hasAccess, false)
  // A failed renewal: access until the grace runs out
  const pastDue = B.billingState(row({ status: 'past_due', current_period_end: iso(-1) }), NOW)
  assert.equal(pastDue.hasAccess, true)
  assert.equal(pastDue.status, 'past_due')
  assert.equal(B.billingState(row({ status: 'past_due', current_period_end: iso(-5) }), NOW).status, 'expired')
})

test('Billing: a cancelled plan works until the end of the paid month', () => {
  const cancelled = B.billingState(row({ status: 'cancelled', current_period_end: iso(5), cancel_at_period_end: true }), NOW)
  assert.equal(cancelled.hasAccess, true)
  assert.equal(cancelled.cancelAtPeriodEnd, true)
  assert.equal(B.billingState(row({ status: 'cancelled', current_period_end: iso(-1) }), NOW).hasAccess, false)
})

test('Billing: exempt workspaces always have access and no AI wallet', () => {
  const exempt = B.billingState(row({ billing_exempt: true, trial_ends_at: iso(-100) }), NOW)
  assert.deepEqual([exempt.exempt, exempt.hasAccess, exempt.aiPercentLeft, exempt.aiPaused], [true, true, null, false])
  // Before the migration has run there is no row: everything works as before
  assert.equal(B.billingState(null, NOW).hasAccess, true)
})

test('Billing: Consular Helpdesk, Magnetora and the platform workspace are never billed', () => {
  assert.equal(B.isExemptOrganization({ id: '303b7a2d-281c-403c-b794-54d1e195ca69' }), true)
  assert.equal(B.isExemptOrganization({ id: 'b2acf062-c379-49f2-8905-267413c9c394' }), true)
  assert.equal(B.isExemptOrganization({ id: 'x', name: 'Consular Helpdesk' }), true)
  assert.equal(B.isExemptOrganization({ id: 'x', name: 'Help', slug: 'consularhelpdesk' }), true)
  // WhatsApp through Twilio
  assert.equal(B.isExemptOrganization({ id: 'x', name: 'Desk', whatsapp_provider: 'twilio', twilio_account_sid: 'AC123' }), true)
  assert.equal(B.isExemptOrganization({ id: 'x', name: 'Desk', whatsapp_provider: 'facebook', twilio_account_sid: 'AC123' }), false)
  assert.equal(B.isExemptOrganization({ id: 'x', name: 'Radhakrishna Books' }), false)
  assert.equal(B.isExemptOrganization(null), false)
})

test('Billing: a new workspace gets a trial and ₹300 of AI credit once', async () => {
  const db = database({ organizations: [{ id: 'org-1', name: 'Books', whatsapp_provider: 'facebook' }] })
  const first = await B.getBilling(db, 'org-1')
  assert.equal(first.billing_exempt, false)
  assert.equal(Number(first.ai_balance), 300)
  await B.getBilling(db, 'org-1')
  assert.equal(db.tables.organization_billing.length, 1)
  assert.deepEqual(db.tables.ai_wallet_transactions.map((t) => [t.kind, t.amount]), [['free_grant', 300]])
})

test('Billing: a new Twilio workspace is created exempt', async () => {
  const db = database({ organizations: [{ id: 'org-2', name: 'Desk', twilio_account_sid: 'AC1' }] })
  assert.equal((await B.getBilling(db, 'org-2')).billing_exempt, true)
})

// ── The AI wallet ───────────────────────────────────────────────────────────

test('AI wallet: customers see a percentage left, and AI pauses at zero', () => {
  assert.equal(B.billingState(row({ ai_balance: 300, ai_allowance: 300 }), NOW).aiPercentLeft, 100)
  assert.equal(B.billingState(row({ ai_balance: 150, ai_allowance: 300 }), NOW).aiPercentLeft, 50)
  assert.equal(B.billingState(row({ ai_balance: '45.5', ai_allowance: '300' }), NOW).aiPercentLeft, 15)
  // A little left never reads as 0%
  const tiny = B.billingState(row({ ai_balance: 0.01, ai_allowance: 300 }), NOW)
  assert.deepEqual([tiny.aiPercentLeft, tiny.aiPaused], [1, false])
  const empty = B.billingState(row({ ai_balance: 0, ai_allowance: 300 }), NOW)
  assert.deepEqual([empty.aiPercentLeft, empty.aiPaused], [0, true])
})

test('AI wallet: each call costs OpenAI\'s price in rupees, with the margin', async () => {
  await withEnv({ AI_USD_INR_RATE: '88', AI_PRICE_MARKUP: '1.5' }, () => {
    // gpt-4o-mini: $0.15 per million input tokens, $0.60 per million output
    assert.equal(B.aiCostInr('gpt-4o-mini', 1_000_000, 0), 19.8)
    assert.equal(B.aiCostInr('gpt-4o-mini-2024-07-18', 1000, 500), Math.round((1000 * 0.15 + 500 * 0.6) / 1e6 * 88 * 1.5 * 10000) / 10000)
    assert.equal(B.aiCostInr('text-embedding-3-small', 1_000_000, 0), 2.64)
    // An unknown model is charged at the higher rate, never free
    assert.equal(B.aiCostInr('mystery-model', 1_000_000, 0), 330)
  })
})

test('AI access: billed workspaces use WAMA CRM\'s key; exempt ones keep their own', async () => {
  await withEnv({ OPENAI_API_KEY: 'sk-platform' }, async () => {
    const db = database({ organization_billing: [row(), row({ organization_id: 'exempt', billing_exempt: true }), row({ organization_id: 'empty', ai_balance: 0 })] })
    const billed = await A.getAiAccess(db, 'org-1', { openai_api_key: 'sk-own' })
    assert.deepEqual([billed.apiKey, billed.billed, billed.allowed], ['sk-platform', true, true])
    const exempt = await A.getAiAccess(db, 'exempt', { openai_api_key: 'sk-own' })
    assert.deepEqual([exempt.apiKey, exempt.billed, exempt.allowed], ['sk-own', false, true])
    const exemptNoKey = await A.getAiAccess(db, 'exempt', { openai_api_key: null })
    assert.equal(exemptNoKey.apiKey, 'sk-platform')
    const empty = await A.getAiAccess(db, 'empty', {})
    assert.deepEqual([empty.allowed, empty.reason], [false, A.AI_PAUSED_MESSAGE])
  })
})

test('AI access: a billed call is charged to the wallet from OpenAI\'s reported usage', async () => {
  await withEnv({ OPENAI_API_KEY: 'sk-platform', AI_USD_INR_RATE: '88', AI_PRICE_MARKUP: '1.5' }, async () => {
    const db = database({ organization_billing: [row()] })
    const access = await A.getAiAccess(db, 'org-1', {})
    const fetcher = fakeFetch({ 'POST /chat/completions': { model: 'gpt-4o-mini', choices: [{ message: { content: 'Hi' } }], usage: { prompt_tokens: 100000, completion_tokens: 10000 } } })
    const res = await A.aiFetch(db, access, 'chatbot', 'https://api.openai.com/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'gpt-4o-mini' }) }, fetcher)
    // The feature still reads the answer
    assert.equal((await res.json()).choices[0].message.content, 'Hi')
    assert.equal(fetcher.calls[0].init.headers.get('Authorization'), 'Bearer sk-platform')
    const cost = B.aiCostInr('gpt-4o-mini', 100000, 10000)
    assert.ok(cost > 0)
    assert.equal(db.tables.organization_billing[0].ai_balance, 300 - cost)
    assert.deepEqual(db.tables.ai_wallet_transactions.map((t) => [t.kind, t.feature, t.tokens]), [['usage', 'chatbot', 110000]])
  })
})

test('AI access: exempt workspaces and failed calls are never charged', async () => {
  const db = database({ organization_billing: [row()] })
  const fetcher = fakeFetch({ 'POST /embeddings': { model: 'text-embedding-3-small', usage: { prompt_tokens: 50 } }, 'POST /chat/completions': () => [500, { error: { message: 'down' } }] })
  await A.aiFetch(db, { organizationId: 'org-1', apiKey: 'sk-own', billed: false, allowed: true }, 'knowledge', 'https://api.openai.com/v1/embeddings', { method: 'POST' }, fetcher)
  await A.aiFetch(db, { organizationId: 'org-1', apiKey: 'sk', billed: true, allowed: true }, 'chatbot', 'https://api.openai.com/v1/chat/completions', { method: 'POST' }, fetcher)
  assert.equal(db.tables.ai_wallet_transactions.length, 0)
  assert.equal(A.readUsage({ usage: { prompt_tokens: 5, completion_tokens: 2 }, model: 'gpt-4o-mini' }).input, 5)
  assert.equal(A.readUsage({}), null)
})

// ── Razorpay ────────────────────────────────────────────────────────────────

const KEYS = { RAZORPAY_KEY_ID: 'rzp_test_key', RAZORPAY_KEY_SECRET: 'test_secret', RAZORPAY_WEBHOOK_SECRET: 'hook_secret' }
const sign = (secret, payload) => createHmac('sha256', secret).update(payload).digest('hex')

test('Razorpay: Checkout and webhook signatures are checked with the right secret', async () => {
  await withEnv(KEYS, () => {
    assert.equal(R.verifyOrderSignature('order_1', 'pay_1', sign('test_secret', 'order_1|pay_1')), true)
    assert.equal(R.verifyOrderSignature('order_1', 'pay_2', sign('test_secret', 'order_1|pay_1')), false)
    assert.equal(R.verifySubscriptionSignature('pay_1', 'sub_1', sign('test_secret', 'pay_1|sub_1')), true)
    assert.equal(R.verifySubscriptionSignature('pay_1', 'sub_1', 'nonsense'), false)
    assert.equal(R.verifyWebhookSignature('{"a":1}', sign('hook_secret', '{"a":1}')), true)
    assert.equal(R.verifyWebhookSignature('{"a":1}', sign('test_secret', '{"a":1}')), false)
    assert.equal(R.verifyWebhookSignature('{"a":1}', undefined), false)
  })
  // Without the webhook secret nothing is trusted
  assert.equal(R.verifyWebhookSignature('{}', sign('', '{}')), false)
})

test('Razorpay: the plan is found by its notes in a shared account, or created once', async () => {
  await withEnv(KEYS, async () => {
    const other = { id: 'plan_other', period: 'monthly', item: { amount: 300000 }, notes: { app: 'another-app' } }
    const ours = { id: 'plan_ours', period: 'monthly', item: { amount: 300000 }, notes: { app: 'wamacrm', plan: 'pro_monthly' } }
    assert.equal(await R.ensurePlan(fakeFetch({ 'GET /plans?count=100': { items: [other, ours] } })), 'plan_ours')
    const created = fakeFetch({ 'GET /plans?count=100': { items: [other] }, 'POST /plans': { id: 'plan_new' } })
    assert.equal(await R.ensurePlan(created), 'plan_new')
    const body = JSON.parse(created.calls[1].init.body)
    assert.deepEqual([body.period, body.item.amount, body.item.currency, body.notes.app], ['monthly', 300000, 'INR', 'wamacrm'])
  })
})

test('Razorpay: subscription states map to the workspace\'s', () => {
  assert.equal(S.mapSubscriptionStatus('active'), 'active')
  assert.equal(S.mapSubscriptionStatus('authenticated'), 'active')
  assert.equal(S.mapSubscriptionStatus('halted'), 'past_due')
  assert.equal(S.mapSubscriptionStatus('pending'), 'past_due')
  assert.equal(S.mapSubscriptionStatus('cancelled'), 'cancelled')
  assert.equal(S.mapSubscriptionStatus('created'), null)
})

test('Top-ups: a captured payment for this workspace is credited exactly once', async () => {
  await withEnv(KEYS, async () => {
    const db = database({ organization_billing: [row({ ai_balance: 12, ai_allowance: 300 })] })
    const payment = { id: 'pay_1', status: 'captured', amount: 100000, order_id: 'order_1', notes: {} }
    const fetcher = fakeFetch({ 'GET /payments/pay_1': payment, 'GET /orders/order_1': { id: 'order_1', notes: { app: 'wamacrm', purpose: 'ai_topup', organization_id: 'org-1' } } })
    assert.deepEqual(await S.creditTopup(db, 'org-1', 'pay_1', fetcher), { credited: true, amount: 1000 })
    assert.deepEqual(await S.creditTopup(db, 'org-1', 'pay_1', fetcher), { credited: false, amount: 1000 })
    const billing = db.tables.organization_billing[0]
    assert.equal(billing.ai_balance, 1012)
    // The new balance counts as 100%
    assert.equal(B.billingState(billing, NOW).aiPercentLeft, 100)
    assert.equal(db.tables.billing_payments.length, 1)
  })
})

test('Top-ups: another workspace\'s payment, a wrong amount, or an unpaid one is refused', async () => {
  await withEnv(KEYS, async () => {
    const db = database({ organization_billing: [row()] })
    const notes = { app: 'wamacrm', purpose: 'ai_topup', organization_id: 'org-other' }
    await assert.rejects(S.creditTopup(db, 'org-1', 'pay_1', fakeFetch({ 'GET /payments/pay_1': { status: 'captured', amount: 100000, notes } })), /not an AI credit top-up for this workspace/)
    const mine = { ...notes, organization_id: 'org-1' }
    await assert.rejects(S.creditTopup(db, 'org-1', 'pay_1', fakeFetch({ 'GET /payments/pay_1': { status: 'captured', amount: 100, notes: mine } })), /not a valid top-up/)
    await assert.rejects(S.creditTopup(db, 'org-1', 'pay_1', fakeFetch({ 'GET /payments/pay_1': { status: 'failed', amount: 100000, notes: mine } })), /not gone through/)
    assert.equal(db.tables.organization_billing[0].ai_balance, 300)
  })
})

test('Top-ups: an authorized payment is captured before the credit is added', async () => {
  await withEnv(KEYS, async () => {
    const db = database({ organization_billing: [row()] })
    const notes = { app: 'wamacrm', purpose: 'ai_topup', organization_id: 'org-1' }
    const fetcher = fakeFetch({
      'GET /payments/pay_1': { id: 'pay_1', status: 'authorized', amount: 50000, notes },
      'POST /payments/pay_1/capture': (init) => [200, { id: 'pay_1', status: 'captured', amount: JSON.parse(init.body).amount, notes }],
    })
    assert.deepEqual(await S.creditTopup(db, 'org-1', 'pay_1', fetcher), { credited: true, amount: 500 })
    assert.equal(JSON.parse(fetcher.calls.find((c) => c.url.endsWith('/capture')).init.body).amount, 50000)
  })
})

// ── The webhook ─────────────────────────────────────────────────────────────

function loadWebhook(db) {
  const helper = path.join(__dirname, '..', 'lib', 'api-auth-helper.ts')
  require.cache[helper] = { id: helper, filename: helper, loaded: true, exports: { getSupabaseAdminClient: () => db } }
  const route = path.join(__dirname, '..', 'app', 'api', 'billing', 'razorpay', 'webhook', 'route.ts')
  delete require.cache[route]
  return require(route)
}

const webhookRequest = (body, secret = 'hook_secret') => {
  const raw = JSON.stringify(body)
  return new Request('https://wamacrm.test/api/billing/razorpay/webhook', { method: 'POST', body: raw, headers: { 'x-razorpay-signature': sign(secret, raw) } })
}

test('Webhook: an unsigned or wrongly signed event is refused', async () => {
  await withEnv(KEYS, async () => {
    const { POST } = loadWebhook(database())
    assert.equal((await POST(webhookRequest({ event: 'subscription.charged' }, 'wrong'))).status, 401)
  })
})

test('Webhook: a renewal extends the paid month and records the payment once', async () => {
  await withEnv(KEYS, async () => {
    const db = database({ organization_billing: [row({ status: 'active', razorpay_subscription_id: 'sub_1', current_period_end: iso(0) })] })
    const { POST } = loadWebhook(db)
    const nextEnd = Math.floor((NOW + 30 * DAY) / 1000)
    const event = {
      event: 'subscription.charged',
      payload: {
        subscription: { entity: { id: 'sub_1', status: 'active', current_end: nextEnd, notes: { app: 'wamacrm', organization_id: 'org-1' } } },
        payment: { entity: { id: 'pay_9', amount: 300000 } },
      },
    }
    assert.equal((await POST(webhookRequest(event))).status, 200)
    assert.equal((await POST(webhookRequest(event))).status, 200)
    const billing = db.tables.organization_billing[0]
    assert.equal(billing.current_period_end, new Date(nextEnd * 1000).toISOString())
    assert.equal(billing.status, 'active')
    assert.equal(db.tables.billing_payments.length, 1)
  })
})

test('Webhook: a halted subscription becomes past due; other apps\' events are ignored', async () => {
  await withEnv(KEYS, async () => {
    const db = database({ organization_billing: [row({ status: 'active', razorpay_subscription_id: 'sub_1' })] })
    const { POST } = loadWebhook(db)
    const halted = { event: 'subscription.halted', payload: { subscription: { entity: { id: 'sub_1', status: 'halted', notes: { app: 'wamacrm', organization_id: 'org-1' } } } } }
    assert.equal((await POST(webhookRequest(halted))).status, 200)
    assert.equal(db.tables.organization_billing[0].status, 'past_due')
    // A store's own Razorpay payment, or another app sharing the account
    const foreign = { event: 'subscription.cancelled', payload: { subscription: { entity: { id: 'sub_x', status: 'cancelled', notes: { app: 'another-app', organization_id: 'org-1' } } } } }
    assert.equal((await POST(webhookRequest(foreign))).status, 200)
    assert.equal(db.tables.organization_billing[0].status, 'past_due')
  })
})

// ── Super Admin actions ─────────────────────────────────────────────────────

const W = require('../lib/superadmin-workspaces.ts')

test('Console: actions are checked before they reach the database', () => {
  assert.deepEqual(W.parseWorkspaceAction({ action: 'extend_trial', days: '14' }), { action: { action: 'extend_trial', days: 14 } })
  assert.match(W.parseWorkspaceAction({ action: 'extend_trial', days: 0 }).error, /between 1 and 365/)
  assert.match(W.parseWorkspaceAction({ action: 'add_ai_credit', amount: -5 }).error, /between ₹1/)
  assert.deepEqual(W.parseWorkspaceAction({ action: 'set_seat_limit', limit: '' }), { action: { action: 'set_seat_limit', limit: null } })
  assert.match(W.parseWorkspaceAction({ action: 'paid_until', date: '2001-01-01' }).error, /future/)
  assert.match(W.parseWorkspaceAction({ action: 'drop_tables' }).error, /Unknown/)
  assert.match(W.parseWorkspaceAction(null).error, /Unknown/)
})

test('Console: extending a trial, marking paid, adding credit and ending access', async () => {
  const db = database({ organization_billing: [row({ trial_ends_at: iso(-3), status: 'trialing', ai_balance: 0, ai_allowance: 300 })], organizations: [{ id: 'org-1', name: 'Books', max_teammates: 4 }] })
  const billing = () => db.tables.organization_billing[0]

  // An ended trial restarts from today
  await W.applyWorkspaceAction(db, 'org-1', { action: 'extend_trial', days: 7 }, 'staff', NOW)
  assert.equal(billing().trial_ends_at, iso(7))
  assert.equal(B.billingState(billing(), NOW).hasAccess, true)

  await W.applyWorkspaceAction(db, 'org-1', { action: 'add_ai_credit', amount: 500 }, 'staff', NOW)
  assert.equal(billing().ai_balance, 500)
  assert.equal(B.billingState(billing(), NOW).aiPercentLeft, 100)
  assert.equal(db.tables.ai_wallet_transactions.at(-1).kind, 'adjustment')

  await W.applyWorkspaceAction(db, 'org-1', { action: 'paid_until', date: iso(40) }, 'staff', NOW)
  assert.deepEqual([billing().status, B.billingState(billing(), NOW).hasAccess, B.billingState(billing(), NOW + 41 * DAY).hasAccess], ['active', true, true])
  // After the paid date plus grace it locks
  assert.equal(B.billingState(billing(), NOW + 44 * DAY).hasAccess, false)

  await W.applyWorkspaceAction(db, 'org-1', { action: 'end_access' }, 'staff', NOW)
  assert.equal(B.billingState(billing(), NOW).hasAccess, false)

  await W.applyWorkspaceAction(db, 'org-1', { action: 'set_seat_limit', limit: null }, 'staff', NOW)
  assert.equal(db.tables.organizations[0].max_teammates, null)

  await W.applyWorkspaceAction(db, 'org-1', { action: 'set_exempt', exempt: true }, 'staff', NOW)
  assert.equal(B.billingState(billing(), NOW).hasAccess, true)
})

test('Console: extending a paying workspace\'s trial keeps it on its plan', async () => {
  const db = database({ organization_billing: [row({ status: 'active', current_period_end: iso(10) })] })
  await W.applyWorkspaceAction(db, 'org-1', { action: 'extend_trial', days: 14 }, null, NOW)
  assert.equal(db.tables.organization_billing[0].status, 'active')
})

test('Console: totals count paying workspaces at ₹3,000 each', () => {
  const org = (id, extra = {}) => ({ id, name: id, slug: id, created_at: iso(-1), ...extra })
  const list = [
    W.summarizeWorkspace(org('a', { whatsapp_provider: 'facebook', whatsapp_phone_number_id: '1' }), row({ status: 'active', current_period_end: iso(10) }), 3, NOW),
    W.summarizeWorkspace(org('b'), row({ status: 'past_due', current_period_end: iso(-1) }), 1, NOW),
    W.summarizeWorkspace(org('c'), row(), 2, NOW),
    W.summarizeWorkspace(org('d'), row({ trial_ends_at: iso(-2), ai_balance: 0 }), 1, NOW),
    W.summarizeWorkspace(org('e', { twilio_account_sid: 'AC1' }), row({ billing_exempt: true }), 5, NOW),
  ]
  assert.equal(list[0].whatsapp, 'meta')
  assert.equal(list[4].whatsapp, 'twilio')
  assert.deepEqual(W.workspaceTotals(list), { workspaces: 5, paying: 2, trialing: 1, expired: 1, exempt: 1, pastDue: 1, aiPaused: 1, monthlyRevenue: 6000, people: 12 })
})
