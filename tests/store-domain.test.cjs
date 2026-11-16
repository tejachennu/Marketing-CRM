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

test('root domains get an A record, sub-domains a CNAME, both to the store server', () => {
  const gw = { host: 'stores.magnetora.in', ip: '203.0.113.10' }
  assert.equal(D.isRootDomain('glowstore.com'), true)
  assert.equal(D.isRootDomain('glowstore.co.in'), true)
  assert.equal(D.isRootDomain('shop.glowstore.in'), false)
  assert.equal(D.isRootDomain('shop.glowstore.co.in'), false)
  assert.deepEqual(D.dnsRecordsFor('glowstore.com', gw), [{ type: 'A', name: '@', value: '203.0.113.10' }])
  assert.deepEqual(D.dnsRecordsFor('shop.glowstore.co.in', gw), [{ type: 'CNAME', name: 'shop', value: 'stores.magnetora.in' }])
})

test('without the store server set up, the option says so', async () => {
  delete process.env.STORE_GATEWAY_HOST
  delete process.env.STORE_GATEWAY_IP
  assert.equal(D.gatewayConfig(), null)
  assert.equal(D.domainsAvailable(), false)
  let looked = 0
  const dns = { cname: async () => { looked++; return [] }, a: async () => { looked++; return [] } }
  const s = await D.domainStatus('shop.glowstore.in', dns)
  assert.equal(s.state, 'unavailable')
  assert.equal(s.note, D.NOT_SET_UP)
  assert.equal(looked, 0)
  assert.deepEqual(await D.domainStatus(null, dns), { domain: null, state: null, records: [], note: '' })
})

test('no Vercel is used for domains any more', () => {
  const src = fs.readFileSync(path.join(__dirname, '../lib/commerce/store-domain.ts'), 'utf8') + fs.readFileSync(path.join(__dirname, '../app/api/commerce/storefront/domain/route.ts'), 'utf8')
  assert.doesNotMatch(src, /api\.vercel\.com|VERCEL_TOKEN|vercel-dns/)
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
  assert.match(src, /url\.pathname = product \? `\/s\/\$\{host\}\/p\/\$\{product\.toLowerCase\(\)\}` : `\/s\/\$\{host\}`/)
  assert.match(src, /x-store-via-domain/)
  // store-host must stay import-free (the middleware runs at the edge)
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../lib/commerce/store-host.ts'), 'utf8'), /^import /m)
})

test('store server: records point at it and DNS decides connected', async () => {
  process.env.STORE_GATEWAY_HOST = 'stores.magnetora.in'
  process.env.STORE_GATEWAY_IP = '203.0.113.10'
  assert.deepEqual(D.gatewayConfig(), { host: 'stores.magnetora.in', ip: '203.0.113.10' })
  assert.equal(D.domainsAvailable(), true)

  let s = await D.domainStatus('shop.glowstore.in', { cname: async () => [], a: async () => [] })
  assert.equal(s.state, 'waiting')
  assert.deepEqual(s.records, [{ type: 'CNAME', name: 'shop', value: 'stores.magnetora.in' }])
  assert.match(s.note, /Add the record/)

  s = await D.domainStatus('shop.glowstore.in', { cname: async () => [], a: async () => ['198.51.100.1'] })
  assert.match(s.note, /points somewhere else/)

  s = await D.domainStatus('shop.glowstore.in', { cname: async () => ['Stores.Magnetora.in.'], a: async () => ['203.0.113.10'] }, async () => false)
  assert.equal(s.state, 'waiting', 'pointing here is not enough: it must open over https')
  assert.match(s.note, /secure \(https\) link/)
  s = await D.domainStatus('shop.glowstore.in', { cname: async () => ['Stores.Magnetora.in.'], a: async () => ['203.0.113.10'] }, async () => true)
  assert.equal(s.state, 'connected')

  s = await D.domainStatus('glowstore.in', { cname: async () => [], a: async () => ['203.0.113.10'] }, async () => true)
  assert.deepEqual(s.records, [{ type: 'A', name: '@', value: '203.0.113.10' }])
  assert.equal(s.state, 'connected')

  process.env.STORE_GATEWAY_IP = 'not-an-ip'
  assert.equal(D.gatewayConfig(), null)
  delete process.env.STORE_GATEWAY_HOST
  delete process.env.STORE_GATEWAY_IP
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

test('nginx servers: one command adds a business domain, and only its own site file', () => {
  const root = path.join(__dirname, '..')
  const add = fs.readFileSync(path.join(root, 'deploy/nginx/add-store-domain.sh'), 'utf8')
  assert.match(add, /store-domain-check\?domain=/, 'only domains a store has connected in WAMA')
  assert.match(add, /nginx -t/, 'tests nginx before reloading')
  assert.match(add, /systemctl reload nginx/)
  assert.doesNotMatch(add, /systemctl (restart|stop) nginx/, 'never restarts or stops the existing nginx')
  assert.match(add, /rm -f "\/etc\/nginx\/sites-enabled\/wama-store-\$DOMAIN\.conf" "\$SITE"/, 'a refused site is removed again')
  assert.match(add, /certbot --nginx -d "\$DOMAIN"/)
  assert.ok(fs.existsSync(path.join(root, 'deploy/nginx/remove-store-domain.sh')))
})
