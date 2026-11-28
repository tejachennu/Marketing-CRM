require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const G = require('../lib/plan-gate.ts')
const P = require('../lib/plans.ts')
const B = require('../lib/billing.ts')

const starter = P.limitsOf('starter')
const growth = P.limitsOf('growth')
const exempt = B.billingLimits({ billing_exempt: true })

test('Starter (₹300, no own WhatsApp) is refused every own-WhatsApp feature on the server', () => {
  for (const path of ['/api/conversations', '/api/messages/send', '/api/instagram/posts', '/api/tickets', '/api/tickets/to-deal', '/api/whatsapp-templates', '/api/templates', '/api/campaigns/run', '/api/campaigns/senders', '/api/flows/simulate', '/api/knowledge/sources', '/api/ai/agent', '/api/ai/playground-chat', '/api/commerce/catalog', '/api/commerce/meta-detect', '/api/settings/api-keys', '/api/whatsapp/embedded-signup']) {
    assert.ok(G.planRefusal(starter, path), `Starter should be refused ${path}`)
  }
})

test('Starter keeps Front Desk: bookings, bills, invoices, reports, contacts, billing', () => {
  for (const path of ['/api/salon/act', '/api/salon/invoices', '/api/salon/appointments', '/api/salon/setup', '/api/contacts', '/api/billing', '/api/media/upload', '/api/organization']) {
    assert.equal(G.planRefusal(starter, path), null, path)
  }
})

test('Starter (₹300) has Front Desk and E-commerce, not the Sales Pipeline or the WhatsApp catalog', () => {
  assert.equal(G.planRefusal(starter, '/api/commerce/orders'), null)
  assert.equal(G.planRefusal(starter, '/api/commerce/storefront'), null)
  assert.match(G.planRefusal(starter, '/api/commerce/catalog'), /Upgrade/)
  assert.match(G.planRefusal(starter, '/api/pipeline/leads'), /Sales Pipeline/)
})

test('Business (₹999) has the inbox, AI, campaigns and flows, but not Instagram or its own website (those come with Growth)', () => {
  const business = P.limitsOf('business')
  for (const path of ['/api/conversations', '/api/campaigns/run', '/api/ai/agent', '/api/flows/simulate', '/api/tickets', '/api/commerce/catalog', '/api/commerce/orders', '/api/pipeline/leads', '/api/salon/act', '/api/salon/booking-flow/draft']) {
    assert.equal(G.planRefusal(business, path), null, path)
  }
  for (const path of ['/api/instagram', '/api/instagram/posts', '/api/salon/website', '/api/commerce/storefront', '/api/commerce/storefront/payments', '/api/commerce/storefront/domain']) {
    assert.match(G.planRefusal(business, path), /Upgrade to Growth or a bigger plan/, path)
  }
  // Starter keeps its website (store orders are confirmed from WAMA's number) but has no Instagram
  assert.equal(G.planRefusal(starter, '/api/salon/website'), null)
  assert.match(G.planRefusal(starter, '/api/instagram'), /Upgrade to Growth/)
  // Things that need your own WhatsApp point Starter to Business
  assert.match(G.planRefusal(starter, '/api/campaigns/run'), /Upgrade to Business or a bigger plan/)
})

test('Growth, Growth + Content and Pro reach everything; exempt workspaces have no limits', () => {
  for (const limits of [growth, P.limitsOf('content'), P.limitsOf('pro_1'), exempt]) {
    for (const path of ['/api/conversations', '/api/campaigns/run', '/api/ai/agent', '/api/commerce/orders', '/api/pipeline/leads', '/api/salon/act', '/api/instagram', '/api/salon/website', '/api/commerce/storefront']) {
      assert.equal(G.planRefusal(limits, path), null, path)
    }
  }
})

test('similar names are not mistaken for gated addresses', () => {
  assert.equal(G.featureForPath('/api/aidrop'), null)
  assert.equal(G.featureForPath('/api/ai-realtime'), 'ai_replies')
  assert.equal(G.connectorForPath('/api/salonx'), null)
})

test('typing WhatsApp keys in Settings counts as connecting; clearing them does not', () => {
  assert.equal(G.connectsWhatsApp({ whatsapp_api_token: 'EAAG...' }), true)
  assert.equal(G.connectsWhatsApp({ twilio_account_sid: 'AC1' }), true)
  assert.equal(G.connectsWhatsApp({ whatsapp_api_token: '', twilio_auth_token: '  ' }), false)
  assert.equal(G.connectsWhatsApp({ enable_ai: true }), false)
})
