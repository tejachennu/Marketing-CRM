require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const N = require('../lib/connector-nav.ts')
const FD = require('../lib/front-desk-nav.ts')

test('Connector bottom bar: each connector page is known, with its tabs and the tab in the address', () => {
  assert.equal(N.connectorAppAt('/dashboard/front-desk'), 'front-desk')
  assert.equal(N.connectorAppAt('/dashboard/salon'), 'front-desk')
  assert.equal(N.connectorAppAt('/dashboard/leads'), 'pipeline')
  assert.equal(N.connectorAppAt('/dashboard/commerce'), 'commerce')
  assert.equal(N.connectorAppAt('/dashboard'), null)
  assert.equal(N.connectorAppAt('/dashboard/leadsx'), null)
  assert.equal(N.connectorTabFromSearch('pipeline', '?tab=follow-ups&deal=1'), 'follow-ups')
  assert.equal(N.connectorTabFromSearch('pipeline', '?tab=invoices'), null)
  assert.equal(N.connectorTabFromSearch('commerce', '?tab=settings'), 'settings')
  assert.equal(FD.tabFromSearch('?tab=reviews'), 'reviews')
  assert.equal(FD.isFrontDeskTab('board'), false)
  for (const app of Object.keys(N.CONNECTOR_APPS)) assert.ok(N.CONNECTOR_APPS[app].tabs.includes(N.CONNECTOR_APPS[app].first), app)
})

test('Connector bottom bar: events reach only the connector they are for', () => {
  const before = globalThis.window
  globalThis.window = new EventTarget()
  try {
    const opened = [], shown = [], badges = []
    const stops = [
      N.onTabRequest('pipeline', (tab) => opened.push(tab)),
      N.onConnectorEvent(N.TAB_SHOWN_EVENT, 'pipeline', (tab) => shown.push(tab)),
      N.onConnectorEvent(N.BADGES_EVENT, 'pipeline', (b) => badges.push(b)),
    ]
    N.openConnectorTab('pipeline', 'list')
    N.openConnectorTab('pipeline', 'nonsense')
    FD.openFrontDeskTab('invoices') // Front Desk's, not the pipeline's
    N.announceConnectorTab('pipeline', 'reports')
    N.announceConnectorTab('commerce', 'orders')
    N.announceConnectorBadges('pipeline', { 'follow-ups': 3 })
    assert.deepEqual(opened, ['list'])
    assert.deepEqual(shown, ['reports'])
    assert.deepEqual(badges, [{ 'follow-ups': 3 }])
    stops.forEach((stop) => stop())
    N.openConnectorTab('pipeline', 'board')
    assert.deepEqual(opened, ['list'])
    const frontDesk = []
    const stop = FD.onFrontDeskTabRequest((tab) => frontDesk.push(tab))
    FD.openFrontDeskTab('team')
    stop()
    assert.deepEqual(frontDesk, ['team'])
  } finally {
    globalThis.window = before
  }
})
