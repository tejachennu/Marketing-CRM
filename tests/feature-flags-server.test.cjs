// The module switches as server code applies them (lib/feature-flags.ts): the organization's
// switches plus the platform's kill switch, which the server also reads at runtime from
// DISABLED_MODULES. Nothing here reaches the network.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const { isModuleDisabledOnServer, isModuleEnabledOnServer, isModuleDisabledByPlatform } = require('../lib/feature-flags.ts')

const clear = () => { delete process.env.DISABLED_MODULES; delete process.env.NEXT_PUBLIC_DISABLED_MODULES }

test('Server module switches: on unless the organization or the platform switches a module off', () => {
  clear()
  // No row, columns not migrated yet, or left at their defaults: on
  for (const org of [undefined, null, {}, { enable_messages: true, enable_flows: true }, { enable_flows: null }]) {
    assert.equal(isModuleEnabledOnServer(org, 'flows'), true, JSON.stringify(org))
    assert.equal(isModuleEnabledOnServer(org, 'commerce'), true, JSON.stringify(org))
  }
  assert.equal(isModuleEnabledOnServer({ enable_flows: false }, 'flows'), false)
  assert.equal(isModuleEnabledOnServer({ enable_flows: false }, 'commerce'), true)
  assert.equal(isModuleEnabledOnServer({ enable_messages: false }, 'flows'), false)
})

test('Server module switches: DISABLED_MODULES is read at runtime, as well as NEXT_PUBLIC_DISABLED_MODULES', () => {
  clear()
  process.env.DISABLED_MODULES = ' Flows '
  assert.equal(isModuleDisabledOnServer('flows'), true)
  assert.equal(isModuleDisabledOnServer('commerce'), false)
  assert.equal(isModuleEnabledOnServer({ enable_flows: true }, 'flows'), false)
  assert.equal(isModuleDisabledByPlatform('flows'), false, 'the dashboard keeps reading only the build-time variable')

  clear()
  process.env.NEXT_PUBLIC_DISABLED_MODULES = 'commerce'
  assert.equal(isModuleDisabledOnServer('commerce'), true)
  assert.equal(isModuleEnabledOnServer({}, 'commerce'), false)
  assert.equal(isModuleEnabledOnServer({}, 'flows'), true)

  // A name that only contains a module's name is not that module
  clear()
  process.env.DISABLED_MODULES = 'workflows,ecommerce'
  assert.equal(isModuleDisabledOnServer('flows'), false)
  assert.equal(isModuleDisabledOnServer('commerce'), false)
  clear()
})
