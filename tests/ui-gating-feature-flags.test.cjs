// Which organizations get Commerce and the Flow Builder (lib/feature-flags.ts): the organization's
// switches, the platform's kill switch and the lookup of the switches. Nothing here reaches the network.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const { fetchModuleSwitches, isModuleDisabledByPlatform, isModuleEnabled, moduleForPath } = require('../lib/feature-flags.ts')

test('Feature flags: both modules are on for every organization unless a switch is off', () => {
  delete process.env.NEXT_PUBLIC_DISABLED_MODULES
  // No organization, no columns yet, or columns left at their defaults: on
  for (const org of [undefined, null, {}, { enable_messages: true, enable_flows: true }, { enable_messages: null, enable_flows: null }]) {
    assert.equal(isModuleEnabled(org, 'commerce'), true, JSON.stringify(org))
    assert.equal(isModuleEnabled(org, 'flows'), true, JSON.stringify(org))
  }
  // Messaging off takes both modules with it; the Flow Builder has a switch of its own as well
  assert.equal(isModuleEnabled({ enable_messages: false }, 'commerce'), false)
  assert.equal(isModuleEnabled({ enable_messages: false, enable_flows: true }, 'flows'), false)
  assert.equal(isModuleEnabled({ enable_messages: true, enable_flows: false }, 'flows'), false)
  assert.equal(isModuleEnabled({ enable_messages: true, enable_flows: false }, 'commerce'), true)
  // The store's own switch (enable_commerce) is separate and does not hide the module
  assert.equal(isModuleEnabled({ enable_messages: true, enable_commerce: false }, 'commerce'), true)
})

test('Feature flags: NEXT_PUBLIC_DISABLED_MODULES hides a module everywhere', () => {
  process.env.NEXT_PUBLIC_DISABLED_MODULES = ' Flows ,commerce'
  assert.equal(isModuleDisabledByPlatform('flows'), true)
  assert.equal(isModuleDisabledByPlatform('commerce'), true)
  assert.equal(isModuleEnabled({ enable_messages: true, enable_flows: true }, 'flows'), false)
  assert.equal(isModuleEnabled({ enable_messages: true }, 'commerce'), false)

  process.env.NEXT_PUBLIC_DISABLED_MODULES = 'flows'
  assert.equal(isModuleEnabled({}, 'commerce'), true)
  assert.equal(isModuleEnabled({}, 'flows'), false)

  // A name that merely contains a module's name is not that module; empty or unset means nothing is hidden
  process.env.NEXT_PUBLIC_DISABLED_MODULES = 'workflows'
  assert.equal(isModuleDisabledByPlatform('flows'), false)
  process.env.NEXT_PUBLIC_DISABLED_MODULES = ''
  assert.equal(isModuleDisabledByPlatform('flows'), false)
  delete process.env.NEXT_PUBLIC_DISABLED_MODULES
  assert.equal(isModuleDisabledByPlatform('commerce'), false)
})

test('Feature flags: the module behind a dashboard path', () => {
  assert.equal(moduleForPath('/dashboard/commerce'), 'commerce')
  assert.equal(moduleForPath('/dashboard/flows'), 'flows')
  assert.equal(moduleForPath('/dashboard/flows/submissions'), 'flows')
  assert.equal(moduleForPath('/dashboard/flows/native/abc'), 'flows')
  // A path that merely starts with the same letters is a different page
  assert.equal(moduleForPath('/dashboard/flowsmith'), null)
  assert.equal(moduleForPath('/dashboard'), null)
  assert.equal(moduleForPath('/dashboard/settings'), null)
})

test('Feature flags: the switches come from /api/organization with the session token; a failed lookup means on', async () => {
  delete process.env.NEXT_PUBLIC_DISABLED_MODULES
  const calls = []
  const originalFetch = global.fetch
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers })
    if (calls.length === 1) return new Response(JSON.stringify({ organization: { id: 'org-1', enable_messages: true, enable_flows: false } }), { status: 200 })
    if (calls.length === 2) return new Response(JSON.stringify({ error: 'Organization not found' }), { status: 404 })
    throw new Error('network down')
  }
  try {
    const switches = await fetchModuleSwitches('org-1', 'token-1')
    assert.deepEqual(switches, { id: 'org-1', enable_messages: true, enable_flows: false })
    assert.equal(isModuleEnabled(switches, 'flows'), false)
    assert.equal(calls[0].url, '/api/organization?organizationId=org-1')
    assert.deepEqual(calls[0].headers, { Authorization: 'Bearer token-1' })

    assert.equal(await fetchModuleSwitches('org-1'), null)
    assert.equal(calls[1].headers, undefined)
    assert.equal(await fetchModuleSwitches('org-1'), null)
    assert.equal(isModuleEnabled(null, 'flows'), true)
  } finally {
    global.fetch = originalFetch
  }
})
