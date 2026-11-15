require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const D = require('../lib/commerce/store-domain.ts')
const S = require('../lib/commerce/storefront.ts')

test('a typed domain is cleaned, and bad or WAMA addresses are refused', () => {
  assert.deepEqual(D.cleanDomain('https://Shop.MyName.com/path?x=1'), { domain: 'shop.myname.com' })
  assert.deepEqual(D.cleanDomain(' myname.co.in. '), { domain: 'myname.co.in' })
  for (const bad of ['', 'myname', 'my name.com', '-bad.com', 'shop..com', 'shop.c0m']) assert.ok('error' in D.cleanDomain(bad), bad)
  for (const own of ['wamacrm.magnetora.in', 'magnetora.in', 'x.vercel.app', 'localhost']) assert.match(D.cleanDomain(own).error || '', /belongs to WAMA|does not look/, own)
})

test('WAMA hosts are never treated as a store', () => {
  for (const h of ['wamacrm.magnetora.in', 'wamacrm.magnetora.in:443', 'marketing-crm-pi.vercel.app', 'localhost:3000', '127.0.0.1', '10.0.0.5']) assert.equal(D.isOwnHost(h), true, h)
  assert.equal(D.isOwnHost('shop.glowstore.in'), false)
  process.env.STORE_APP_HOSTS = 'app.example.org'
  assert.equal(D.isOwnHost('app.example.org'), true)
  delete process.env.STORE_APP_HOSTS
})

test('root domains get an A record, others a CNAME; a TXT check is added when asked', () => {
  assert.equal(D.isRootDomain('glowstore.com'), true)
  assert.equal(D.isRootDomain('glowstore.co.in'), true)
  assert.equal(D.isRootDomain('shop.glowstore.in'), false)
  assert.equal(D.isRootDomain('shop.glowstore.co.in'), false)
  assert.deepEqual(D.dnsRecordsFor('glowstore.com'), [{ type: 'A', name: '@', value: '76.76.21.21' }])
  assert.deepEqual(D.dnsRecordsFor('shop.glowstore.co.in'), [{ type: 'CNAME', name: 'shop', value: 'cname.vercel-dns.com' }])
  const withTxt = D.dnsRecordsFor('shop.glowstore.in', [{ type: 'TXT', domain: '_vercel.glowstore.in', value: 'vc-domain-verify=abc' }])
  assert.deepEqual(withTxt[1], { type: 'TXT', name: '_vercel', value: 'vc-domain-verify=abc' })
})

test('without Vercel settings the option says it is not ready, and nothing is called', async () => {
  delete process.env.VERCEL_TOKEN
  delete process.env.VERCEL_PROJECT_ID
  let called = 0
  const fetcher = async () => { called++; return new Response('{}') }
  const added = await D.addDomain('shop.glowstore.in', fetcher)
  assert.equal(added.ok, false)
  const status = await D.domainStatus('shop.glowstore.in', fetcher)
  assert.equal(status.state, 'unavailable')
  assert.equal(called, 0)
})

test('domain status reads Vercel: waiting until verified and configured, then connected', async () => {
  process.env.VERCEL_TOKEN = 'test-token'
  process.env.VERCEL_PROJECT_ID = 'prj_test'
  process.env.VERCEL_TEAM_ID = 'team_test'
  const seen = []
  let misconfigured = true
  const fetcher = async (url, init) => {
    seen.push(`${init.method} ${new URL(url).pathname} ${new URL(url).searchParams.get('teamId')}`)
    assert.equal(init.headers.Authorization, 'Bearer test-token')
    if (url.includes('/config')) return new Response(JSON.stringify({ misconfigured, recommendedCNAME: [{ rank: 1, value: 'abc.vercel-dns-017.com.' }] }))
    return new Response(JSON.stringify({ name: 'shop.glowstore.in', verified: true }))
  }
  let status = await D.domainStatus('shop.glowstore.in', fetcher)
  assert.equal(status.state, 'waiting')
  assert.deepEqual(status.records, [{ type: 'CNAME', name: 'shop', value: 'abc.vercel-dns-017.com' }])
  assert.ok(seen.every((s) => s.endsWith('team_test')))
  misconfigured = false
  status = await D.domainStatus('shop.glowstore.in', fetcher)
  assert.equal(status.state, 'connected')

  // Adding: already on our project is fine; used elsewhere is explained
  const conflict = async () => new Response(JSON.stringify({ error: { code: 'domain_already_in_use', message: 'in use by another project' } }), { status: 409 })
  assert.match((await D.addDomain('shop.glowstore.in', conflict)).error, /already connected to another website/)
  const ours = async () => new Response(JSON.stringify({ error: { code: 'domain_already_exists', message: 'already exists on this project' } }), { status: 409 })
  assert.deepEqual(await D.addDomain('shop.glowstore.in', ours), { ok: true })
  delete process.env.VERCEL_TOKEN
  delete process.env.VERCEL_PROJECT_ID
  delete process.env.VERCEL_TEAM_ID
})

test('the store page loads by its own domain', async () => {
  const org = { id: 'o1', slug: 'glow', name: 'Glow', store_domain: 'shop.glowstore.in', storefront: { enabled: true } }
  const calls = []
  const db = {
    from(table) {
      const q = { filters: [], select() { return q }, eq(k, v) { q.filters.push([k, v]); return q }, order() { return q }, limit() { return Promise.resolve({ data: [] }) },
        maybeSingle() { calls.push(q.filters); const [[k, v]] = q.filters; return Promise.resolve({ data: org[k] === v ? org : null }) } }
      return q
    },
  }
  const page = await S.loadStore(db, 'shop.glowstore.in')
  assert.equal(page.organization.slug, 'glow')
  assert.deepEqual(calls[0], [['store_domain', 'shop.glowstore.in']])
  assert.equal(await S.loadStore(db, 'other.example.com'), null)
  assert.equal(await S.loadStore(db, 'bad domain'), null)
})

test('the migration file matches the SQL the app runs', () => {
  const file = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261120_store_domain.sql'), 'utf8')
  assert.equal(file, D.STORE_DOMAIN_SQL)
})

test('the middleware sends custom domains to the store and leaves API calls alone', () => {
  const src = fs.readFileSync(path.join(__dirname, '../middleware.ts'), 'utf8')
  assert.match(src, /from '@\/lib\/commerce\/store-host'/)
  assert.match(src, /!pathname\.startsWith\('\/api'\)/)
  assert.match(src, /url\.pathname = `\/s\/\$\{host\}`/)
  // store-host must stay import-free (the middleware runs at the edge)
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../lib/commerce/store-host.ts'), 'utf8'), /^import /m)
})

test('gateway mode: records point at the gateway and DNS decides connected', async () => {
  process.env.STORE_GATEWAY_HOST = 'stores.magnetora.in'
  process.env.STORE_GATEWAY_IP = '203.0.113.10'
  assert.deepEqual(D.gatewayConfig(), { host: 'stores.magnetora.in', ip: '203.0.113.10' })
  assert.equal(D.domainsAvailable(), true)
  // No Vercel call is made in gateway mode
  const fetcher = async () => { throw new Error('Vercel should not be called') }
  assert.deepEqual(await D.addDomain('shop.glowstore.in', fetcher), { ok: true })
  assert.equal(await D.removeDomain('shop.glowstore.in', fetcher), true)

  const dnsNone = { cname: async () => [], a: async () => [] }
  let s = await D.domainStatus('shop.glowstore.in', fetcher, dnsNone)
  assert.equal(s.state, 'waiting')
  assert.deepEqual(s.records, [{ type: 'CNAME', name: 'shop', value: 'stores.magnetora.in' }])
  assert.match(s.note, /Add the record/)

  const dnsElsewhere = { cname: async () => [], a: async () => ['198.51.100.1'] }
  s = await D.domainStatus('shop.glowstore.in', fetcher, dnsElsewhere)
  assert.match(s.note, /points somewhere else/)

  const dnsCname = { cname: async () => ['Stores.Magnetora.in.'], a: async () => ['203.0.113.10'] }
  s = await D.domainStatus('shop.glowstore.in', fetcher, dnsCname)
  assert.equal(s.state, 'connected')

  const dnsRoot = { cname: async () => [], a: async () => ['203.0.113.10'] }
  s = await D.domainStatus('glowstore.in', fetcher, dnsRoot)
  assert.deepEqual(s.records, [{ type: 'A', name: '@', value: '203.0.113.10' }])
  assert.equal(s.state, 'connected')

  process.env.STORE_GATEWAY_IP = 'not-an-ip'
  assert.equal(D.gatewayConfig(), null)
  delete process.env.STORE_GATEWAY_HOST
  delete process.env.STORE_GATEWAY_IP
  assert.equal(D.domainsAvailable(), false)
})

test('the gateway files are complete and keep no secrets', () => {
  const root = path.join(__dirname, '..')
  const caddy = fs.readFileSync(path.join(root, 'deploy/gateway/Caddyfile'), 'utf8')
  assert.match(caddy, /on_demand_tls/)
  assert.match(caddy, /ask \{\$APP_URL\}\/api\/public\/store-domain-check/)
  assert.match(caddy, /header_up X-Store-Domain \{host\}/)
  assert.match(caddy, /header_up X-Gateway-Key \{\$STORE_GATEWAY_KEY\}/)
  const setup = fs.readFileSync(path.join(root, 'deploy/gateway/setup.sh'), 'utf8')
  assert.match(setup, /set -euo pipefail/)
  assert.match(setup, /caddy validate/)
  const flow = fs.readFileSync(path.join(root, '.github/workflows/deploy-gateway.yml'), 'utf8')
  assert.match(flow, /workflow_dispatch/)
  assert.doesNotMatch(flow, /^\s+push:/m, 'never deploys on a push')
  for (const text of [caddy, setup, flow]) assert.doesNotMatch(text, /BEGIN [A-Z ]*PRIVATE KEY|rzp_live_[A-Za-z0-9]{6,}/)
  // The middleware trusts the gateway header only with the key
  const mw = fs.readFileSync(path.join(root, 'middleware.ts'), 'utf8')
  assert.match(mw, /x-gateway-key'\) === gatewayKey/)
  assert.match(mw, /gatewayKey\.length >= 16/)
})
