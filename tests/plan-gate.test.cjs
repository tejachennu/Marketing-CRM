require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const G = require('../lib/plan-gate.ts')
const P = require('../lib/plans.ts')
const B = require('../lib/billing.ts')

const starter = P.limitsOf('starter')
const growth = P.limitsOf('growth')
const exempt = B.billingLimits({ billing_exempt: true })

test('Starter (₹999, no own WhatsApp) is refused every own-WhatsApp feature on the server', () => {
  for (const path of ['/api/conversations', '/api/messages/send', '/api/instagram/posts', '/api/tickets', '/api/tickets/to-deal', '/api/whatsapp-templates', '/api/templates', '/api/campaigns/run', '/api/campaigns/senders', '/api/flows/simulate', '/api/knowledge/sources', '/api/ai/agent', '/api/ai/playground-chat', '/api/commerce/catalog', '/api/commerce/meta-detect', '/api/settings/api-keys', '/api/whatsapp/embedded-signup']) {
    assert.ok(G.planRefusal(starter, path), `Starter should be refused ${path}`)
  }
})

test('Starter keeps Front Desk: bookings, bills, invoices, reports, contacts, billing', () => {
  for (const path of ['/api/salon/act', '/api/salon/invoices', '/api/salon/appointments', '/api/salon/setup', '/api/contacts', '/api/billing', '/api/media/upload', '/api/organization']) {
    assert.equal(G.planRefusal(starter, path), null, path)
  }
})

test('Starter cannot use the E-commerce or Sales Pipeline connectors', () => {
  assert.match(G.planRefusal(starter, '/api/commerce/orders'), /Front Desk only/)
  assert.match(G.planRefusal(starter, '/api/pipeline/leads'), /Sales Pipeline/)
})

test('Growth and Pro reach everything; exempt workspaces have no limits', () => {
  for (const limits of [growth, P.limitsOf('pro_1'), exempt]) {
    for (const path of ['/api/conversations', '/api/campaigns/run', '/api/ai/agent', '/api/commerce/orders', '/api/pipeline/leads', '/api/salon/act']) {
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
