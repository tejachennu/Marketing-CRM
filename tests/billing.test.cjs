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
        return Promise.resolve({ data: structuredClone(singular ? rows[0] || null : rows), error: null, count: rows.length }).then(resolve, reject)
      },
    }
    return query
  }
  const rpc = async (fn, args) => {
    const billing = tables.organization_billing.find((r) => r.organization_id === args.p_org)
    if (fn === 'ai_wallet_charge') {
      // As the SQL function does: never below zero, and the ledger records what was actually taken
      const before = Number(billing.ai_balance)
      billing.ai_balance = Math.max(0, before - args.p_amount)
      tables.ai_wallet_transactions.push({ organization_id: args.p_org, kind: 'usage', amount: -(before - billing.ai_balance), feature: args.p_feature, model: args.p_model, tokens: args.p_tokens })
      return { data: billing.ai_balance, error: null }
    }
    if (fn === 'ai_wallet_credit') {
      if (args.p_payment_id && tables.ai_wallet_transactions.some((t) => t.razorpay_payment_id === args.p_payment_id)) return { data: billing.ai_balance, error: null }
      billing.ai_balance = Number(billing.ai_balance) + args.p_amount
      billing.ai_allowance = billing.ai_balance
      tables.ai_wallet_transactions.push({ organization_id: args.p_org, kind: args.p_kind, amount: args.p_amount, razorpay_payment_id: args.p_payment_id })
      return { data: billing.ai_balance, error: null }
    }
    // The message wallet, as the SQL functions do it
    tables.message_wallet_transactions = tables.message_wallet_transactions || []
    const ledger = tables.message_wallet_transactions
    if (fn === 'message_wallet_charge') {
      if (ledger.some((t) => t.message_ref === args.p_ref && t.kind === 'usage')) return { data: true, error: null }
      if (!billing || Number(billing.message_balance || 0) < args.p_amount) return { data: false, error: null }
      billing.message_balance = Number(billing.message_balance) - args.p_amount
      ledger.push({ organization_id: args.p_org, kind: 'usage', amount: -args.p_amount, message_ref: args.p_ref, category: args.p_category })
      return { data: true, error: null }
    }
    if (fn === 'message_wallet_refund') {
      const charge = ledger.find((t) => t.message_ref === args.p_ref && t.kind === 'usage')
      if (!charge || ledger.some((t) => t.message_ref === args.p_ref && t.kind === 'refund')) return { data: 0, error: null }
      const owner = tables.organization_billing.find((r) => r.organization_id === charge.organization_id)
      owner.message_balance = Number(owner.message_balance) - charge.amount
      ledger.push({ organization_id: charge.organization_id, kind: 'refund', amount: -charge.amount, message_ref: args.p_ref })
      return { data: -charge.amount, error: null }
    }
    if (fn === 'message_wallet_credit') {
      if (args.p_payment_id && ledger.some((t) => t.razorpay_payment_id === args.p_payment_id)) return { data: billing.message_balance, error: null }
      billing.message_balance = Math.max(0, Number(billing.message_balance || 0) + args.p_amount)
      ledger.push({ organization_id: args.p_org, kind: args.p_kind, amount: args.p_amount, razorpay_payment_id: args.p_payment_id })
      return { data: billing.message_balance, error: null }
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

test('Billing: the old single plan now means Growth at ₹2,500 a month', () => {
  assert.equal(B.PLAN.amountPaise, 250000)
  assert.equal(B.PLAN.id, 'growth')
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
    const old = { id: 'plan_old', period: 'monthly', item: { amount: 300000 }, notes: { app: 'wamacrm', plan: 'pro_monthly' } }
    const ours = { id: 'plan_ours', period: 'monthly', item: { amount: 250000 }, notes: { app: 'wamacrm', plan: 'growth' } }
    assert.equal(await R.ensurePlan('growth', fakeFetch({ 'GET /plans?count=100': { items: [other, old, ours] } })), 'plan_ours')
    const created = fakeFetch({ 'GET /plans?count=100': { items: [other, old] }, 'POST /plans': { id: 'plan_new' } })
    assert.equal(await R.ensurePlan('starter', created), 'plan_new')
    const body = JSON.parse(created.calls[1].init.body)
    assert.deepEqual([body.period, body.item.amount, body.item.currency, body.notes.app, body.notes.plan], ['monthly', 99900, 'INR', 'wamacrm', 'starter'])
    // A plan pinned in the environment is used as it is
    await withEnv({ RAZORPAY_PLAN_PRO_2: 'plan_pinned' }, async () => assert.equal(await R.ensurePlan('pro_2', fakeFetch({})), 'plan_pinned'))
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
    assert.deepEqual(await S.creditTopup(db, 'org-1', 'pay_1', fetcher), { credited: true, amount: 1000, purpose: 'ai_topup' })
    assert.deepEqual(await S.creditTopup(db, 'org-1', 'pay_1', fetcher), { credited: false, amount: 1000, purpose: 'ai_topup' })
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
    assert.deepEqual(await S.creditTopup(db, 'org-1', 'pay_1', fetcher), { credited: true, amount: 500, purpose: 'ai_topup' })
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

test('Console: totals add up each paying workspace\'s plan price', () => {
  const org = (id, extra = {}) => ({ id, name: id, slug: id, created_at: iso(-1), ...extra })
  const list = [
    W.summarizeWorkspace(org('a', { whatsapp_provider: 'facebook', whatsapp_phone_number_id: '1' }), row({ status: 'active', current_period_end: iso(10) }), 3, NOW),
    W.summarizeWorkspace(org('b'), row({ plan: 'pro_1', status: 'past_due', current_period_end: iso(-1) }), 1, NOW),
    W.summarizeWorkspace(org('c'), row(), 2, NOW),
    W.summarizeWorkspace(org('d'), row({ trial_ends_at: iso(-2), ai_balance: 0 }), 1, NOW),
    W.summarizeWorkspace(org('e', { twilio_account_sid: 'AC1' }), row({ billing_exempt: true }), 5, NOW),
  ]
  assert.equal(list[0].whatsapp, 'meta')
  assert.equal(list[4].whatsapp, 'twilio')
  const totals = W.workspaceTotals(list)
  assert.deepEqual({ ...totals, byPlan: undefined }, { workspaces: 5, paying: 2, trialing: 1, expired: 1, exempt: 1, pastDue: 1, aiPaused: 1, monthlyRevenue: 8500, people: 12, attention: 3, trialsEndingSoon: 0, byPlan: undefined })
  assert.deepEqual(totals.byPlan.filter((p) => p.paying || p.trial).map((p) => [p.plan, p.paying, p.trial, p.revenue]), [['growth', 1, 1, 2500], ['pro_1', 1, 0, 6000]])
})

// ── When the first charge happens ───────────────────────────────────────────

test('Subscribing during the trial charges when the trial ends, not now', () => {
  const start = S.subscriptionStartAt(row({ status: 'trialing', trial_ends_at: iso(4) }), NOW)
  assert.equal(start, Math.floor(Date.parse(iso(4)) / 1000))
  // Trial already over, or ending within the hour: charge now
  assert.equal(S.subscriptionStartAt(row({ status: 'trialing', trial_ends_at: iso(-1) }), NOW), undefined)
  assert.equal(S.subscriptionStartAt(row({ status: 'trialing', trial_ends_at: new Date(NOW + 20 * 60000).toISOString() }), NOW), undefined)
})

test('Turning auto-renew back on charges when the paid month ends', () => {
  const cancelling = row({ status: 'active', cancel_at_period_end: true, current_period_end: iso(12) })
  assert.equal(S.subscriptionStartAt(cancelling, NOW), Math.floor(Date.parse(iso(12)) / 1000))
  // A failed or ended plan is charged straight away
  assert.equal(S.subscriptionStartAt(row({ status: 'past_due', current_period_end: iso(-1) }), NOW), undefined)
  assert.equal(S.subscriptionStartAt(row({ status: 'cancelled', current_period_end: iso(-3) }), NOW), undefined)
})

test('Auto-pay set up for a later start keeps access, clears "renewal stopped" and records no payment yet', async () => {
  await withEnv(KEYS, async () => {
    const db = database({ organization_billing: [row({ status: 'active', cancel_at_period_end: true, current_period_end: iso(12), razorpay_subscription_id: 'sub_new' })] })
    const fetcher = fakeFetch({ 'GET /subscriptions/sub_new': { id: 'sub_new', status: 'authenticated', paid_count: 0, charge_at: Math.floor(Date.parse(iso(12)) / 1000), notes: { app: 'wamacrm', organization_id: 'org-1' } } })
    await S.activateSubscription(db, 'org-1', 'sub_new', 'pay_auth', fetcher)
    const billing = db.tables.organization_billing[0]
    assert.deepEqual([billing.status, billing.cancel_at_period_end, billing.current_period_end], ['active', false, iso(12)])
    assert.equal(db.tables.billing_payments.length, 0)
  })
})

test('Webhook: events from a replaced subscription do not touch the current one', async () => {
  await withEnv(KEYS, async () => {
    const db = database({ organization_billing: [row({ status: 'active', razorpay_subscription_id: 'sub_new', current_period_end: iso(20) })] })
    const { POST } = loadWebhook(db)
    const old = { event: 'subscription.cancelled', payload: { subscription: { entity: { id: 'sub_old', status: 'cancelled', current_end: Math.floor(NOW / 1000), notes: { app: 'wamacrm', organization_id: 'org-1' } } } } }
    assert.equal((await POST(webhookRequest(old))).status, 200)
    assert.deepEqual([db.tables.organization_billing[0].status, db.tables.organization_billing[0].razorpay_subscription_id], ['active', 'sub_new'])
  })
})

// ── Switching billing on from the console ───────────────────────────────────

const M = require('../lib/billing-migration.ts')

test('Switch on: the console runs the migration file word for word', () => {
  const file = require('fs').readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261105_billing_and_ai_wallet.sql'), 'utf8')
  assert.equal(M.BILLING_MIGRATION_SQL, file)
})

test('Switch on: uses the direct database connection, with TLS options set in code', () => {
  assert.equal(M.migrationConnectionString({}), null)
  const url = M.migrationConnectionString({ POSTGRES_URL: 'postgres://u:p@pooler.example.com:6543/postgres?sslmode=require&pgbouncer=true', POSTGRES_URL_NON_POOLING: 'postgres://u:p@pooler.example.com:5432/postgres?sslmode=require' })
  assert.equal(url, 'postgres://u:p@pooler.example.com:5432/postgres')
  assert.equal(M.migrationConnectionString({ DATABASE_URL: 'not a url' }), null)
})

test('Switch on: all of the migration applies, or none of it', async () => {
  const runs = []
  const fakeClient = (failOn) => class {
    constructor(options) { runs.push(['options', options.ssl]) }
    async connect() { runs.push(['connect']) }
    async query(sql) { runs.push(['query', sql.length > 40 ? 'MIGRATION' : sql]); if (sql === failOn || (failOn === 'MIGRATION' && sql.length > 40)) throw new Error('boom') }
    async end() { runs.push(['end']) }
  }
  await M.runBillingMigration('postgres://x', fakeClient(null))
  assert.deepEqual(runs.map((r) => r[1] || r[0]).slice(1), ['connect', 'BEGIN', 'SELECT pg_advisory_xact_lock(724519001)', 'MIGRATION', 'COMMIT', 'end'])
  runs.length = 0
  await assert.rejects(M.runBillingMigration('postgres://x', fakeClient('MIGRATION')), /boom/)
  assert.deepEqual(runs.map((r) => r[1] || r[0]).slice(1), ['connect', 'BEGIN', 'SELECT pg_advisory_xact_lock(724519001)', 'MIGRATION', 'ROLLBACK', 'end'])
})

test('Switch on: billing switches itself on once, and can be turned off', async () => {
  const A = require('../lib/billing-auto-setup.ts')
  const runs = []
  const run = async (url) => { runs.push(url) }
  await withEnv({ POSTGRES_URL_NON_POOLING: 'postgres://u:p@db.example.com:5432/postgres?sslmode=require', BILLING_AUTO_SETUP: '' }, async () => {
    A.resetAutoSetup()
    assert.equal(await A.ensureBillingSwitchedOn(run, 1_000_000), true)
    assert.deepEqual(runs, ['postgres://u:p@db.example.com:5432/postgres'])
    // Not again straight away (a failing connection is not hammered on every page view)
    assert.equal(await A.ensureBillingSwitchedOn(run, 1_000_000 + 60_000), false)
    assert.equal(await A.ensureBillingSwitchedOn(run, 1_000_000 + 11 * 60_000), true)
    // A failed run reports false and the page still loads
    A.resetAutoSetup()
    assert.equal(await A.ensureBillingSwitchedOn(async () => { throw new Error('refused') }, 5_000_000), false)
  })
  await withEnv({ POSTGRES_URL_NON_POOLING: 'postgres://u:p@db.example.com/postgres', BILLING_AUTO_SETUP: 'off' }, async () => {
    A.resetAutoSetup()
    assert.equal(await A.ensureBillingSwitchedOn(run, 9_000_000), false)
  })
  // No database connection: nothing to do
  await withEnv({ POSTGRES_URL_NON_POOLING: '', POSTGRES_URL: '', DATABASE_URL: '' }, async () => {
    A.resetAutoSetup()
    assert.equal(await A.ensureBillingSwitchedOn(run, 9_000_000), false)
  })
  assert.equal(runs.length, 2)
})

// ── Cancelling auto-pay, and clearing test data ─────────────────────────────

test('Cancel before the first charge: auto-pay stops at once and the trial carries on', async () => {
  await withEnv(KEYS, async () => {
    const db = database({ organization_billing: [row({ status: 'active', trial_ends_at: iso(14), current_period_end: iso(14), razorpay_subscription_id: 'sub_a' })] })
    const fetcher = fakeFetch({
      'GET /subscriptions/sub_a': { id: 'sub_a', status: 'authenticated', paid_count: 0 },
      'POST /subscriptions/sub_a/cancel': (init) => [200, { id: 'sub_a', status: 'cancelled', sent: JSON.parse(init.body) }],
    })
    const result = await S.stopAutoPay(db, 'org-1', fetcher)
    assert.deepEqual(result, { accessUntil: iso(14), trial: true })
    // Cancelled straight away: there is no billing cycle to finish (Razorpay refuses "at cycle end" here)
    assert.equal(JSON.parse(fetcher.calls.find((c) => c.url.endsWith('/cancel')).init.body).cancel_at_cycle_end, 0)
    const billing = db.tables.organization_billing[0]
    assert.deepEqual([billing.status, billing.razorpay_subscription_id, billing.cancel_at_period_end], ['trialing', null, false])
    assert.equal(B.billingState(billing, NOW).hasAccess, true)
    // Razorpay's "cancelled" event for that subscription arrives later and changes nothing
    const { POST } = loadWebhook(db)
    await POST(webhookRequest({ event: 'subscription.cancelled', payload: { subscription: { entity: { id: 'sub_a', status: 'cancelled', notes: { app: 'wamacrm', organization_id: 'org-1' } } } } }))
    assert.equal(db.tables.organization_billing[0].status, 'trialing')
  })
})

test('Cancel after paying: renewal stops and access lasts to the end of the paid month', async () => {
  await withEnv(KEYS, async () => {
    const db = database({ organization_billing: [row({ status: 'active', current_period_end: iso(20), razorpay_subscription_id: 'sub_p' })] })
    const fetcher = fakeFetch({
      'GET /subscriptions/sub_p': { id: 'sub_p', status: 'active', paid_count: 2 },
      'POST /subscriptions/sub_p/cancel': { id: 'sub_p', status: 'active' },
    })
    assert.deepEqual(await S.stopAutoPay(db, 'org-1', fetcher), { accessUntil: iso(20), trial: false })
    assert.equal(JSON.parse(fetcher.calls.find((c) => c.url.endsWith('/cancel')).init.body).cancel_at_cycle_end, 1)
    assert.equal(db.tables.organization_billing[0].cancel_at_period_end, true)
  })
})

test('Webhook: events for a subscription the workspace does not hold are ignored, even with none saved', async () => {
  await withEnv(KEYS, async () => {
    const db = database({ organization_billing: [row({ status: 'trialing', razorpay_subscription_id: null })] })
    const { POST } = loadWebhook(db)
    const stray = { event: 'subscription.charged', payload: { subscription: { entity: { id: 'sub_test_old', status: 'active', current_end: Math.floor((NOW + 30 * DAY) / 1000), notes: { app: 'wamacrm', organization_id: 'org-1' } } } } }
    assert.equal((await POST(webhookRequest(stray))).status, 200)
    assert.deepEqual([db.tables.organization_billing[0].status, db.tables.organization_billing[0].razorpay_subscription_id], ['trialing', null])
  })
})

test('Billing page: auto-pay set up but not yet charged is told apart from a paid plan', async () => {
  const pending = database({ organization_billing: [row({ status: 'active', current_period_end: iso(14), razorpay_subscription_id: 'sub_a' })] })
  assert.equal((await S.billingSummary(pending, 'org-1')).autoPayPending, true)
  const paid = database({ organization_billing: [row({ status: 'active', current_period_end: iso(14), razorpay_subscription_id: 'sub_a' })], billing_payments: [{ organization_id: 'org-1', purpose: 'subscription', razorpay_payment_id: 'pay_1' }] })
  assert.equal((await S.billingSummary(paid, 'org-1')).autoPayPending, false)
})

test('Clearing test data: live subscriptions are always kept', async () => {
  const Reset = require('../lib/billing-reset.ts')
  assert.equal(Reset.razorpayMode({}), 'off')
  assert.equal(Reset.razorpayMode({ RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: 's' }), 'test')
  assert.equal(Reset.razorpayMode({ RAZORPAY_KEY_ID: 'rzp_live_abc', RAZORPAY_KEY_SECRET: 's' }), 'live')
  const rows = [
    { organization_id: 'org-live', razorpay_subscription_id: 'sub_live' },
    { organization_id: 'org-test', razorpay_subscription_id: 'sub_test' },
    { organization_id: 'org-none', razorpay_subscription_id: null },
    { organization_id: 'org-unsure', razorpay_subscription_id: 'sub_unsure' },
  ]
  const fetcher = fakeFetch({
    'GET /subscriptions/sub_live': { id: 'sub_live', status: 'active' },
    'GET /subscriptions/sub_test': () => [400, { error: { description: 'The id provided does not exist' } }],
    'GET /subscriptions/sub_unsure': () => [500, { error: { description: 'Razorpay is down' } }],
  })
  // Live keys: the real one, and any we could not check, are kept; test ones are cleared
  await withEnv({ RAZORPAY_KEY_ID: 'rzp_live_abc', RAZORPAY_KEY_SECRET: 'secret' }, async () => {
    assert.deepEqual(await Reset.workspacesWithLiveSubscriptions(rows, fetcher), ['org-live', 'org-unsure'])
  })
  // Test keys: everything is test data
  await withEnv({ RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: 'secret' }, async () => {
    assert.deepEqual(await Reset.workspacesWithLiveSubscriptions(rows, fetcher), [])
  })
  // The reset statements never touch the kept workspaces
  for (const [sql, params] of Reset.RESET_STATEMENTS) {
    assert.match(sql, /NOT \(organization_id = ANY\(\$1::uuid\[\]\)\)/)
    assert.deepEqual(params(['org-live'])[0], ['org-live'])
  }
})

test('AI prices: speech-to-text models have their own price (US$ per million tokens × ₹88 × 1.5)', () => {
  const { aiCostInr } = require('../lib/billing.ts')
  assert.equal(aiCostInr('gpt-4o-mini-transcribe', 1_000_000, 0), 396)
  assert.equal(aiCostInr('gpt-4o-transcribe', 1_000_000, 0), 792)
  assert.equal(aiCostInr('gpt-4o-mini', 1_000_000, 0), 19.8)
})

// ── Plans (lib/plans.ts) ────────────────────────────────────────────────────

const P = require('../lib/plans.ts')
const MW = require('../lib/message-wallet.ts')

test('Plans: five plans at the agreed prices; the old ₹3,000 plan reads as Growth', () => {
  assert.deepEqual(P.PLANS.map((p) => [p.id, p.amountPaise / 100, p.whatsapp]), [
    ['starter', 999, 'shared'], ['growth', 2500, 'own'], ['pro_1', 6000, 'own'], ['pro_2', 9000, 'own'], ['pro_3', 12000, 'own'],
  ])
  assert.equal(P.planIdOf('pro_monthly'), 'growth')
  assert.equal(P.planIdOf(undefined), 'growth')
  assert.equal(P.getPlan('pro_2').limits.videos, 4)
})

test('Plans: Starter has no inbox or campaigns and Front Desk only; Growth has one connector', () => {
  const starter = P.limitsOf('starter')
  assert.equal(P.planAllows(starter, 'campaigns'), false)
  assert.equal(P.planAllows(starter, 'inbox'), false)
  assert.match(P.connectorBlockReason(starter, [], 'ecommerce'), /Front Desk only/)
  assert.equal(P.connectorBlockReason(starter, [], 'salon'), null)
  const growth = P.limitsOf('growth')
  assert.equal(P.planAllows(growth, 'campaigns'), true)
  assert.equal(P.connectorBlockReason(growth, ['salon'], 'pipeline') !== null, true)
  // E-commerce and Sales Pipeline start switched on: on Growth only the first one counts
  assert.deepEqual(P.activeConnectors(growth, ['ecommerce', 'pipeline']), ['ecommerce'])
  assert.deepEqual(P.activeConnectors(starter, ['salon', 'ecommerce', 'pipeline']), ['salon'])
  assert.deepEqual(P.activeConnectors(P.limitsOf('pro_1'), ['salon', 'ecommerce', 'pipeline']), ['salon', 'ecommerce', 'pipeline'])
})

test('Plans: Super Admin overrides change one workspace\'s limits; bad values are ignored', () => {
  const limits = P.limitsOf('growth', { connectors: 3, team: 50, aiMonthly: 'lots', videos: -1 })
  assert.deepEqual([limits.connectors, limits.team, limits.aiMonthly, limits.videos], [3, 50, 300, 0])
  assert.equal(P.limitsOf('pro_1', { team: null }).team, null)
  // A connector number opens Starter up to every connector
  assert.deepEqual(P.limitsOf('starter', { connectors: 2 }).connectorKeys, [])
  assert.equal(P.teamBlockReason(P.limitsOf('growth'), 4), null)
  assert.match(P.teamBlockReason(P.limitsOf('growth'), 5), /up to 5 team members/)
  assert.equal(P.teamBlockReason(P.limitsOf('pro_3'), 500), null)
})

test('Plans: an upgrade costs the difference for the days left, in whole rupees', () => {
  // Growth → Pro 1 with 15 of 30 days left: (6,000 − 2,500) × 15/30 = ₹1,750
  assert.equal(P.upgradeDifferencePaise('growth', 'pro_1', iso(15), NOW), 175000)
  assert.equal(P.upgradeDifferencePaise('pro_1', 'growth', iso(15), NOW), 0)
  assert.equal(P.upgradeDifferencePaise('growth', 'pro_1', iso(-1), NOW), 0)
  assert.equal(P.planDirection('starter', 'growth'), 'up')
  assert.equal(P.planDirection('pro_3', 'pro_2'), 'down')
})

test('Plans: the migration file is the same SQL the app runs', () => {
  const S2 = require('../lib/plans-schema.ts')
  const file = require('fs').readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261111_plans_and_message_wallet.sql'), 'utf8')
  assert.equal(S2.PLANS_SQL, file)
  assert.equal(S2.PLANS_LOCK, 724519013)
  assert.match(file, /UPDATE organization_billing SET plan = 'growth' WHERE plan = 'pro_monthly'/)
})

test('Billing summary: plan, limits, what is allowed and the message wallet', async () => {
  const db = database({ organization_billing: [row({ plan: 'starter', whatsapp_mode: 'shared', message_balance: 40 })] })
  const summary = await S.billingSummary(db, 'org-1')
  assert.equal(summary.plan.id, 'starter')
  assert.equal(summary.allows.campaigns, false)
  assert.equal(summary.plans.length, 5)
  assert.equal(summary.whatsappMode, 'shared')
  assert.equal(summary.messageBalance, 40)
  assert.equal(summary.messageLow, true)
})

// ── Message wallet ──────────────────────────────────────────────────────────

test('Message wallet: Meta\'s price with no markup, changeable in the environment', async () => {
  assert.equal(MW.messagePrice('utility', {}), 0.115)
  assert.equal(MW.messagePrice('service', {}), 0)
  assert.equal(MW.messagePrice('utility', { META_PRICE_UTILITY_INR: '0.13' }), 0.13)
  assert.equal(MW.messagePrice('utility', { META_PRICE_UTILITY_INR: 'abc' }), 0.115)
})

test('Message wallet: a message is paid once, refused when the wallet is short, refunded once', async () => {
  await withEnv({ META_PRICE_UTILITY_INR: '0.5' }, async () => {
    const db = database({ organization_billing: [row({ message_balance: 1 })] })
    assert.equal(await MW.chargeMessage(db, 'org-1', 'msg-1'), true)
    assert.equal(await MW.chargeMessage(db, 'org-1', 'msg-1'), true)
    assert.equal(db.tables.organization_billing[0].message_balance, 0.5)
    assert.equal(await MW.chargeMessage(db, 'org-1', 'msg-2'), true)
    assert.equal(await MW.chargeMessage(db, 'org-1', 'msg-3'), false)
    assert.equal(db.tables.organization_billing[0].message_balance, 0)
    assert.equal(await MW.refundMessage(db, 'msg-1'), 0.5)
    assert.equal(await MW.refundMessage(db, 'msg-1'), 0)
    assert.equal(db.tables.organization_billing[0].message_balance, 0.5)
  })
})

test('Message wallet: a top-up payment is added once', async () => {
  await withEnv(KEYS, async () => {
    const db = database({ organization_billing: [row({ message_balance: 0 })] })
    const notes = { app: 'wamacrm', purpose: 'message_topup', organization_id: 'org-1' }
    const fetcher = fakeFetch({ 'GET /payments/pay_m': { id: 'pay_m', status: 'captured', amount: 50000, notes } })
    assert.deepEqual(await S.creditTopup(db, 'org-1', 'pay_m', fetcher, 'message_topup'), { credited: true, amount: 500, purpose: 'message_topup' })
    await S.creditTopup(db, 'org-1', 'pay_m', fetcher, 'message_topup')
    assert.equal(db.tables.organization_billing[0].message_balance, 500)
    // A message top-up is not AI credit
    await assert.rejects(S.creditTopup(db, 'org-1', 'pay_m', fetcher, 'ai_topup'), /not an AI credit top-up/)
  })
})

// ── Changing plan ───────────────────────────────────────────────────────────

const sub = (id, extra = {}) => ({ id, status: 'active', paid_count: 1, current_end: Math.floor(Date.parse(iso(15)) / 1000), notes: { app: 'wamacrm', organization_id: 'org-1', plan: 'growth' }, ...extra })

test('Change plan: on the trial it switches at once, and old-price auto-pay is stopped', async () => {
  await withEnv(KEYS, async () => {
    const db = database({ organization_billing: [row({ plan: 'growth', status: 'active', razorpay_subscription_id: 'sub_t', current_period_end: iso(10) })] })
    const fetcher = fakeFetch({
      'GET /subscriptions/sub_t': sub('sub_t', { status: 'authenticated', paid_count: 0 }),
      'POST /subscriptions/sub_t/cancel': { id: 'sub_t', status: 'cancelled' },
    })
    const result = await S.changePlan(db, 'org-1', 'pro_1', fetcher, NOW)
    assert.deepEqual(result, { kind: 'switched', plan: 'pro_1', autoPayCleared: true })
    const billing = db.tables.organization_billing[0]
    assert.deepEqual([billing.plan, billing.razorpay_subscription_id, billing.status], ['pro_1', null, 'trialing'])
  })
})

test('Change plan: an upgrade while paying asks for the difference first', async () => {
  await withEnv(KEYS, async () => {
    const db = database({ organization_billing: [row({ plan: 'growth', status: 'active', razorpay_subscription_id: 'sub_g', current_period_end: iso(15) })] })
    const fetcher = fakeFetch({
      'GET /subscriptions/sub_g': sub('sub_g'),
      'POST /orders': (init) => [200, { id: 'order_up', amount: JSON.parse(init.body).amount, currency: 'INR', notes: JSON.parse(init.body).notes }],
    })
    const result = await S.changePlan(db, 'org-1', 'pro_1', fetcher, NOW)
    assert.equal(result.kind, 'pay_difference')
    assert.equal(result.amount, 175000)
    const order = JSON.parse(fetcher.calls.find((c) => c.url.endsWith('/orders')).init.body)
    assert.deepEqual([order.notes.purpose, order.notes.plan], ['upgrade', 'pro_1'])
    // Nothing changes until it is paid
    assert.equal(db.tables.organization_billing[0].plan, 'growth')
  })
})

test('Change plan: once the difference is paid the bigger plan starts, then auto-pay for the new price waits for the bill date', async () => {
  await withEnv(KEYS, async () => {
    const db = database({ organization_billing: [row({ plan: 'growth', status: 'active', razorpay_subscription_id: 'sub_g', current_period_end: iso(15) })] })
    const notes = { app: 'wamacrm', purpose: 'upgrade', organization_id: 'org-1', plan: 'pro_1' }
    const fetcher = fakeFetch({
      'GET /payments/pay_up': { id: 'pay_up', status: 'captured', amount: 175000, order_id: 'order_up', notes },
      'GET /subscriptions/sub_g': sub('sub_g'),
      'GET /plans?count=100': { items: [] },
      'POST /plans': { id: 'plan_pro_1' },
      'POST /subscriptions': (init) => [200, { id: 'sub_p', status: 'created', ...JSON.parse(init.body) }],
    })
    const paid = await S.creditTopup(db, 'org-1', 'pay_up', fetcher, 'upgrade')
    assert.equal(paid.plan, 'pro_1')
    assert.equal(db.tables.organization_billing[0].plan, 'pro_1')
    const next = await S.changePlan(db, 'org-1', 'pro_1', fetcher, NOW)
    assert.equal(next.kind, 'auto_pay')
    assert.equal(next.startsAt, iso(15).replace(/\.\d{3}Z$/, '.000Z'))
    const created = JSON.parse(fetcher.calls.find((c) => c.url.endsWith('/subscriptions') && c.init.method === 'POST').init.body)
    assert.deepEqual([created.plan_id, created.notes.plan], ['plan_pro_1', 'pro_1'])
    assert.deepEqual([db.tables.organization_billing[0].pending_subscription_id, db.tables.organization_billing[0].pending_plan], ['sub_p', 'pro_1'])
  })
})

test('Change plan: a downgrade keeps the plan until the bill date, then the new auto-pay takes over', async () => {
  await withEnv(KEYS, async () => {
    const db = database({ organization_billing: [row({ plan: 'pro_2', status: 'active', razorpay_subscription_id: 'sub_old', current_period_end: iso(15) })] })
    const cancels = []
    const fetcher = fakeFetch({
      'GET /subscriptions/sub_old': sub('sub_old', { notes: { app: 'wamacrm', organization_id: 'org-1', plan: 'pro_2' } }),
      'GET /plans?count=100': { items: [] },
      'POST /plans': { id: 'plan_growth' },
      'POST /subscriptions': (init) => [200, { id: 'sub_new', status: 'created', ...JSON.parse(init.body) }],
    })
    const result = await S.changePlan(db, 'org-1', 'growth', fetcher, NOW)
    assert.equal(result.kind, 'auto_pay')
    let billing = db.tables.organization_billing[0]
    assert.deepEqual([billing.plan, billing.pending_plan], ['pro_2', 'growth'])

    // The customer approves the new auto-pay: the old one stops at the end of its month
    const cancel = async (id, _f, atCycleEnd) => { cancels.push([id, atCycleEnd]) }
    await S.applySubscription(db, 'org-1', sub('sub_new', { status: 'authenticated', paid_count: 0, notes: { app: 'wamacrm', organization_id: 'org-1', plan: 'growth' } }), { cancel })
    assert.deepEqual(cancels, [['sub_old', true]])
    assert.equal(db.tables.organization_billing[0].plan, 'pro_2')

    // The old one ends: nothing changes while the new one waits
    await S.applySubscription(db, 'org-1', sub('sub_old', { status: 'cancelled' }))
    billing = db.tables.organization_billing[0]
    assert.deepEqual([billing.status, billing.plan, billing.razorpay_subscription_id], ['active', 'pro_2', 'sub_old'])

    // First charge of the new one: it becomes the subscription and Growth applies
    await S.applySubscription(db, 'org-1', sub('sub_new', { notes: { app: 'wamacrm', organization_id: 'org-1', plan: 'growth' }, current_end: Math.floor(Date.parse(iso(45)) / 1000) }))
    billing = db.tables.organization_billing[0]
    assert.deepEqual([billing.plan, billing.razorpay_subscription_id, billing.pending_subscription_id, billing.status, billing.cancel_at_period_end], ['growth', 'sub_new', null, 'active', false])
  })
})

test('Change plan: an upgrade whose new auto-pay was never set up ends when the old plan renews', async () => {
  const db = database({ organization_billing: [row({ plan: 'pro_1', status: 'active', razorpay_subscription_id: 'sub_g', current_period_end: iso(1) })] })
  await S.applySubscription(db, 'org-1', sub('sub_g', { paid_count: 2 }))
  assert.equal(db.tables.organization_billing[0].plan, 'growth')
})

test('Change plan: exempt workspaces and the same plan are refused', async () => {
  await withEnv(KEYS, async () => {
    const exempt = database({ organization_billing: [row({ billing_exempt: true })] })
    await assert.rejects(S.changePlan(exempt, 'org-1', 'pro_1', fakeFetch({}), NOW), /does not need a plan/)
    const paying = database({ organization_billing: [row({ plan: 'growth', status: 'active', razorpay_subscription_id: 'sub_g', current_period_end: iso(15) })] })
    await assert.rejects(S.changePlan(paying, 'org-1', 'growth', fakeFetch({ 'GET /subscriptions/sub_g': sub('sub_g') }), NOW), /already on Growth/)
  })
})

test('Monthly AI credit: each plan payment adds the plan\'s credit once', async () => {
  const db = database({ organization_billing: [row({ plan: 'pro_1', ai_balance: 10, ai_allowance: 300 })] })
  assert.equal(await S.grantMonthlyAi(db, 'org-1', 'pro_1', 'pay_9'), 500)
  await S.grantMonthlyAi(db, 'org-1', 'pro_1', 'pay_9')
  assert.equal(db.tables.organization_billing[0].ai_balance, 510)
  assert.equal(await S.grantMonthlyAi(db, 'org-1', 'starter', 'pay_10'), 0)
})

test('Console: set a plan, limits, WAMA\'s number and message wallet money by hand', async () => {
  const W2 = require('../lib/superadmin-workspaces.ts')
  assert.deepEqual(W2.parseWorkspaceAction({ action: 'set_plan', plan: 'pro_3' }), { action: { action: 'set_plan', plan: 'pro_3' } })
  assert.ok('error' in W2.parseWorkspaceAction({ action: 'set_plan', plan: 'gold' }))
  assert.deepEqual(W2.parseWorkspaceAction({ action: 'set_overrides', overrides: { connectors: 9, team: '', aiMonthly: 700, ads: true } }), { action: { action: 'set_overrides', overrides: { connectors: 3, aiMonthly: 700, ads: true } } })
  assert.ok('error' in W2.parseWorkspaceAction({ action: 'set_overrides', overrides: { team: -2 } }))
  const db = database({ organization_billing: [row({ plan: 'growth', message_balance: 0 })] })
  await W2.applyWorkspaceAction(db, 'org-1', { action: 'set_plan', plan: 'starter' }, 'admin-1', NOW)
  assert.deepEqual([db.tables.organization_billing[0].plan, db.tables.organization_billing[0].whatsapp_mode], ['starter', 'shared'])
  await W2.applyWorkspaceAction(db, 'org-1', { action: 'add_message_credit', amount: 250 }, 'admin-1', NOW)
  assert.equal(db.tables.organization_billing[0].message_balance, 250)
  const summary = W2.summarizeWorkspace({ id: 'org-1', name: 'x', slug: 'x', created_at: iso(-1) }, db.tables.organization_billing[0], 1, NOW)
  assert.deepEqual([summary.billing.plan, summary.billing.price, summary.billing.messageBalance], ['starter', 999, 250])
})

test('Console: what needs attention on a workspace, most pressing first', () => {
  const org = { id: 'x', name: 'x', slug: 'x', created_at: iso(-1) }
  const connected = { ...org, whatsapp_provider: 'facebook', whatsapp_phone_number_id: '1' }
  const kinds = (o, r) => W.summarizeWorkspace(o, r, 1, NOW).attention.map((a) => a.kind)
  assert.deepEqual(kinds(connected, row()), [])
  assert.deepEqual(kinds(org, row({ trial_ends_at: iso(2) })), ['trial_ending', 'no_whatsapp'])
  assert.deepEqual(kinds(connected, row({ status: 'past_due', current_period_end: iso(-1) })), ['payment_failed'])
  assert.deepEqual(kinds(connected, row({ trial_ends_at: iso(-2), ai_balance: 0 })), ['ended'])
  assert.deepEqual(kinds(connected, row({ ai_balance: 0 })), ['ai_paused'])
  // Starter: WAMA's number sends, so no WhatsApp is needed, but the wallet must have money; it has no AI
  assert.deepEqual(kinds(org, row({ plan: 'starter', whatsapp_mode: 'shared', message_balance: 20, ai_balance: 0 })), ['wallet_low'])
  assert.deepEqual(kinds(org, row({ billing_exempt: true })), [])
})

test('Connectors: a one-connector plan offers to swap; Starter keeps Front Desk only', () => {
  const growth = P.limitsOf('growth')
  // E-commerce and Sales Pipeline start switched on: turning on Front Desk asks to swap
  const asked = P.connectorSwitch(growth, ['ecommerce', 'pipeline'], 'salon', false)
  assert.deepEqual([asked.ok, asked.canSwap], [false, true])
  assert.deepEqual(P.connectorSwitch(growth, ['ecommerce', 'pipeline'], 'salon', true), { ok: true, switchOff: ['ecommerce', 'pipeline'] })
  // Making the locked one the active one
  assert.deepEqual(P.connectorSwitch(growth, ['ecommerce', 'pipeline'], 'pipeline', true), { ok: true, switchOff: ['ecommerce'] })
  // Room left: just on
  assert.deepEqual(P.connectorSwitch(P.limitsOf('pro_1'), ['ecommerce', 'pipeline'], 'salon', false), { ok: true, switchOff: [] })
  assert.deepEqual(P.connectorSwitch(growth, [], 'salon', false), { ok: true, switchOff: [] })
  const starter = P.connectorSwitch(P.limitsOf('starter'), ['salon'], 'ecommerce', true)
  assert.deepEqual([starter.ok, starter.canSwap], [false, false])
  // Grandfathered workspaces (3 connectors) are never asked
  assert.deepEqual(P.connectorSwitch(P.limitsOf('growth', { connectors: 3 }), ['ecommerce', 'pipeline'], 'salon', false), { ok: true, switchOff: [] })
})

test('Connectors: a workspace still on the old ₹3,000 plan keeps all of them', () => {
  assert.equal(B.billingLimits(row({ plan: 'pro_monthly' })).connectors, 3)
  assert.equal(B.billingLimits(row({ plan: 'growth' })).connectors, 1)
  assert.equal(B.billingLimits(row({ billing_exempt: true })).connectors, 3)
})
