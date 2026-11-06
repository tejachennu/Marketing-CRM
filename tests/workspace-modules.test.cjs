require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const { isConsularHelpdesk, workspaceHasPage } = require('../lib/workspace-modules.ts')
const { toSafeOrganization } = require('../lib/organization-access.ts')

const client = { id: 'org-1', name: 'Radhakrishna Books', slug: 'rk-books', whatsapp_provider: 'facebook' }
const consular = { id: 'org-2', name: 'Consular Helpdesk', slug: 'consularhelpdesk', whatsapp_provider: 'twilio', twilio_account_sid: 'AC1', twilio_auth_token: 'tok' }

test('Modules: every client workspace gets Flow Builder, Commerce, Team and Billing', () => {
  for (const page of ['/dashboard/flows', '/dashboard/flows/abc', '/dashboard/flows/submissions', '/dashboard/commerce', '/dashboard/team', '/dashboard/billing']) {
    assert.equal(workspaceHasPage(client, page), true, page)
  }
  // A brand-new workspace that has not connected WhatsApp yet is a client too
  assert.equal(workspaceHasPage({ id: 'new', name: 'Sri Lakshmi Sarees', slug: 'sri-lakshmi', whatsapp_provider: null }, '/dashboard/flows'), true)
})

test('Modules: Consular Helpdesk keeps its original setup', () => {
  for (const page of ['/dashboard/flows', '/dashboard/flows/abc', '/dashboard/commerce', '/dashboard/team', '/dashboard/billing']) {
    assert.equal(workspaceHasPage(consular, page), false, page)
  }
  // Everything it already had stays
  for (const page of ['/dashboard', '/dashboard/tickets', '/dashboard/campaigns', '/dashboard/settings', '/dashboard/leads']) {
    assert.equal(workspaceHasPage(consular, page), true, page)
  }
  // A page that merely starts with the same letters is a different page
  assert.equal(workspaceHasPage(consular, '/dashboard/teams-help'), true)
})

test('Modules: Consular is recognised by name, or as the workspace on Twilio', () => {
  assert.equal(isConsularHelpdesk({ name: 'Consular Help Desk' }), true)
  assert.equal(isConsularHelpdesk({ name: 'Help', slug: 'consularhelpdesk' }), true)
  assert.equal(isConsularHelpdesk({ name: 'Desk', whatsapp_provider: 'twilio', twilio_account_sid: 'AC1', twilio_auth_token: 't' }), true)
  // Twilio credentials left over after moving to Meta do not count
  assert.equal(isConsularHelpdesk({ name: 'Desk', whatsapp_provider: 'facebook', twilio_account_sid: 'AC1', twilio_auth_token: 't' }), false)
  assert.equal(isConsularHelpdesk({ name: 'Magnetora AI Solutions', whatsapp_provider: 'facebook' }), false)
  assert.equal(isConsularHelpdesk(null), false)
})

test('Modules: members see the same answer without the Twilio credentials', () => {
  const safe = toSafeOrganization({ ...consular, name: 'Desk', slug: 'desk' })
  assert.equal(safe.twilio_account_sid, undefined)
  assert.equal(safe.twilio_auth_token, undefined)
  assert.equal(safe.twilio_connected, true)
  assert.equal(isConsularHelpdesk(safe), true)
  assert.equal(isConsularHelpdesk(toSafeOrganization(client)), false)
})
