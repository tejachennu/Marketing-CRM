require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  EMPTY_AUDIENCE_FILTERS,
  UNTAGGED,
  buildParticipantSet,
  buildRecipientList,
  countTags,
  filterContacts,
  getContactTags,
  hasActiveFilters,
  isReachable,
  normalizeEmail,
  normalizePhoneDigits,
  participantsLoaded,
  summarizeSelection,
  toDialablePhone,
  wasInCampaigns,
} = require('../lib/campaigns/audience.ts')

const CONTACTS = [
  { id: 'a', first_name: 'Asha', last_name: 'Rao', phone_number: '+91 98765 43210', email: 'asha@example.com', company: 'Acme', tags: ['VIP', 'Hyderabad'] },
  { id: 'b', first_name: 'Bilal', last_name: 'Khan', phone_number: '9876500000', email: null, company: 'Globex', tags: ['Hyderabad '] },
  { id: 'c', first_name: 'Chen', last_name: null, phone_number: '+1 (415) 555-0100', email: 'CHEN@Example.com', company: null, tags: [] },
  { id: 'd', first_name: 'Divya', last_name: 'S', phone_number: '', email: 'divya@example.com', company: 'Acme', tags: null },
  { id: 'e', first_name: 'Asha', last_name: 'Duplicate', phone_number: '9876543210', email: 'asha2@example.com', company: null, tags: ['VIP'] },
]
const ids = (list) => list.map((c) => c.id)
const filter = (overrides, context = {}) =>
  ids(filterContacts(CONTACTS, { ...EMPTY_AUDIENCE_FILTERS, ...overrides }, { channel: 'whatsapp', participants: new Set(), ...context }))

// ── Phone numbers and emails ────────────────────────────────────────────────

test('Audience: the same number written differently is one recipient', () => {
  for (const raw of ['9876543210', '+91 98765 43210', '91-98765-43210', '+919876543210', '0091 9876543210', ' 98765 43210 ']) {
    assert.equal(normalizePhoneDigits(raw), '919876543210', raw)
  }
  assert.equal(toDialablePhone('+1 (415) 555-0100'), '+14155550100')
  // A 10-digit number that is not an Indian mobile is left alone
  assert.equal(normalizePhoneDigits('4155550100'), '4155550100')
})

test('Audience: values that cannot be a phone number are rejected', () => {
  for (const raw of ['', null, undefined, 'abc', '12345', '1234567', '1234567890123456', 'N/A']) {
    assert.equal(normalizePhoneDigits(raw), '', String(raw))
    assert.equal(toDialablePhone(raw), null, String(raw))
  }
})

test('Audience: emails are compared without case or padding, and must look like one', () => {
  assert.equal(normalizeEmail('  CHEN@Example.com '), 'chen@example.com')
  for (const raw of ['', null, 'chen', 'chen@', '@example.com', 'a b@example.com', 'chen@example']) {
    assert.equal(normalizeEmail(raw), '', String(raw))
  }
})

test('Audience: who can be reached depends on the channel', () => {
  assert.deepEqual(CONTACTS.map((c) => isReachable(c, 'whatsapp')), [true, true, true, false, true])
  assert.deepEqual(CONTACTS.map((c) => isReachable(c, 'sms')), [true, true, true, false, true])
  assert.deepEqual(CONTACTS.map((c) => isReachable(c, 'email')), [true, false, true, true, true])
})

// ── Tags ────────────────────────────────────────────────────────────────────

test('Audience: tags are trimmed, de-duplicated and counted once per contact', () => {
  assert.deepEqual(getContactTags({ tags: [' VIP ', 'VIP', '', null, 7, 'New'] }), ['VIP', 'New'])
  assert.deepEqual(getContactTags({ tags: null }), [])
  assert.deepEqual(countTags(CONTACTS), [
    { tag: 'Hyderabad', count: 2 },
    { tag: 'VIP', count: 2 },
  ])
})

test('Audience: tag filter modes — any, all, none, and untagged', () => {
  assert.deepEqual(filter({ tags: ['VIP', 'Hyderabad'], tagMode: 'any' }), ['a', 'b', 'e'])
  assert.deepEqual(filter({ tags: ['VIP', 'Hyderabad'], tagMode: 'all' }), ['a'])
  assert.deepEqual(filter({ tags: ['VIP'], tagMode: 'none' }), ['b', 'c', 'd'])
  assert.deepEqual(filter({ tags: [UNTAGGED], tagMode: 'any' }), ['c', 'd'])
  assert.deepEqual(filter({ tags: [UNTAGGED, 'VIP'], tagMode: 'any' }), ['a', 'c', 'd', 'e'])
  assert.deepEqual(filter({ tags: [UNTAGGED], tagMode: 'none' }), ['a', 'b', 'e'])
  // A tag stored with a stray space still matches
  assert.deepEqual(filter({ tags: ['Hyderabad'] }), ['a', 'b'])
})

// ── Search ──────────────────────────────────────────────────────────────────

test('Audience: one search box covers name, company, email and phone', () => {
  assert.deepEqual(filter({ search: 'asha' }), ['a', 'e'])
  assert.deepEqual(filter({ search: 'ASHA RAO' }), ['a'])
  assert.deepEqual(filter({ search: 'acme' }), ['a', 'd'])
  assert.deepEqual(filter({ search: 'chen@example' }), ['c'])
  assert.deepEqual(filter({ search: '98765 432' }), ['a', 'e'])
  assert.deepEqual(filter({ search: '+91-98765' }), ['a', 'b', 'e'])
  assert.deepEqual(filter({ search: '555-0100' }), ['c'])
  assert.deepEqual(filter({ search: 'nobody' }), [])
  // Matches as you type: every number containing the digits so far
  assert.deepEqual(filter({ search: '98' }), ['a', 'b', 'e'])
  // Digits with letters are a text search, not a phone search
  assert.deepEqual(filter({ search: 'acme 98' }), [])
})

// ── Past campaigns ──────────────────────────────────────────────────────────

const LOGS = {
  diwali: ['+919876543210', 'chen@example.com', '', null],
  newyear: ['9876500000'],
}

test('Audience: past-campaign matching normalizes both sides', () => {
  const diwali = buildParticipantSet(['diwali'], LOGS)
  assert.deepEqual([...diwali].sort(), ['919876543210', 'chen@example.com'])
  assert.deepEqual(CONTACTS.map((c) => wasInCampaigns(c, diwali)), [true, false, true, false, true])
  assert.equal(buildParticipantSet(['missing'], LOGS).size, 0)
})

test('Audience: filter by who received a campaign, or who did not', () => {
  const participants = buildParticipantSet(['diwali'], LOGS)
  assert.deepEqual(filter({ campaigns: ['diwali'], campaignMode: 'received' }, { participants }), ['a', 'c', 'e'])
  assert.deepEqual(filter({ campaigns: ['diwali'], campaignMode: 'not_received' }, { participants }), ['b', 'd'])

  const both = buildParticipantSet(['diwali', 'newyear'], LOGS)
  assert.deepEqual(filter({ campaigns: ['diwali', 'newyear'], campaignMode: 'not_received' }, { participants: both }), ['d'])
})

test('Audience: the filter knows when delivery logs are still loading', () => {
  assert.equal(participantsLoaded(['diwali', 'newyear'], LOGS), true)
  assert.equal(participantsLoaded(['diwali', 'pending'], LOGS), false)
  assert.equal(participantsLoaded([], {}), true)
  // A campaign with no recipients is loaded, not pending
  assert.equal(participantsLoaded(['empty'], { empty: [] }), true)
})

// ── Combining filters ───────────────────────────────────────────────────────

test('Audience: every active filter must match', () => {
  const participants = buildParticipantSet(['diwali'], LOGS)
  assert.deepEqual(filter({ search: 'asha', tags: ['Hyderabad'] }), ['a'])
  assert.deepEqual(filter({ tags: ['VIP'], campaigns: ['diwali'], campaignMode: 'not_received' }, { participants }), [])
  assert.deepEqual(filter({ reachableOnly: true }), ['a', 'b', 'c', 'e'])
  assert.deepEqual(filter({ reachableOnly: true }, { channel: 'email' }), ['a', 'c', 'd', 'e'])
  assert.deepEqual(filter({}), ['a', 'b', 'c', 'd', 'e'])
})

test('Audience: "active filters" ignores modes on their own', () => {
  assert.equal(hasActiveFilters(EMPTY_AUDIENCE_FILTERS), false)
  assert.equal(hasActiveFilters({ ...EMPTY_AUDIENCE_FILTERS, tagMode: 'all', campaignMode: 'not_received', search: '   ' }), false)
  assert.equal(hasActiveFilters({ ...EMPTY_AUDIENCE_FILTERS, search: 'a' }), true)
  assert.equal(hasActiveFilters({ ...EMPTY_AUDIENCE_FILTERS, tags: ['VIP'] }), true)
  assert.equal(hasActiveFilters({ ...EMPTY_AUDIENCE_FILTERS, campaigns: ['x'] }), true)
  assert.equal(hasActiveFilters({ ...EMPTY_AUDIENCE_FILTERS, reachableOnly: true }), true)
})

// ── Selection ───────────────────────────────────────────────────────────────

test('Audience: the summary says how many messages really go out', () => {
  const everyone = new Set(ids(CONTACTS))
  const all = summarizeSelection(CONTACTS, everyone, everyone, 'whatsapp')
  // 5 ticked: Divya has no phone, and the two Ashas share a number
  assert.deepEqual(all, { selected: 5, selectedVisible: 5, selectedHidden: 0, unreachable: 1, duplicates: 1, recipients: 3 })

  const email = summarizeSelection(CONTACTS, everyone, everyone, 'email')
  assert.deepEqual(email, { selected: 5, selectedVisible: 5, selectedHidden: 0, unreachable: 1, duplicates: 0, recipients: 4 })
})

test('Audience: ticked contacts hidden by a filter are still counted, and reported', () => {
  const selected = new Set(['a', 'b', 'c'])
  const visible = new Set(['a']) // a filter is showing only Asha
  const summary = summarizeSelection(CONTACTS, selected, visible, 'whatsapp')
  assert.equal(summary.selected, 3)
  assert.equal(summary.selectedVisible, 1)
  assert.equal(summary.selectedHidden, 2)
  assert.equal(summary.recipients, 3)

  const none = summarizeSelection(CONTACTS, new Set(), visible, 'whatsapp')
  assert.deepEqual(none, { selected: 0, selectedVisible: 0, selectedHidden: 0, unreachable: 0, duplicates: 0, recipients: 0 })
  // An id that is no longer in the contact list is not counted
  assert.equal(summarizeSelection(CONTACTS, new Set(['gone']), visible, 'whatsapp').selected, 0)
})

// ── Final list ──────────────────────────────────────────────────────────────

test('Audience: the final list has one message per valid, distinct number', () => {
  const rows = [
    { address: '98765 43210', variables: { 1: 'Asha' } },
    { address: '+919876543210', variables: { 1: 'Asha again' } },
    { address: 'not a number', variables: {} },
    { address: '', variables: {} },
    { address: '+14155550100', variables: { 1: 'Chen' } },
  ]
  const list = buildRecipientList(rows, 'whatsapp')
  assert.deepEqual(list.recipients, [
    { phone: '+919876543210', variables: { 1: 'Asha' } },
    { phone: '+14155550100', variables: { 1: 'Chen' } },
  ])
  assert.equal(list.duplicates, 1)
  assert.equal(list.invalid, 2)
})

test('Audience: an email campaign de-duplicates by address', () => {
  const list = buildRecipientList(
    [
      { address: 'Chen@Example.com', variables: {} },
      { address: 'chen@example.com ', variables: {} },
      { address: '9876543210', variables: {} },
    ],
    'email'
  )
  assert.deepEqual(list.recipients, [{ email: 'chen@example.com', variables: {} }])
  assert.equal(list.duplicates, 1)
  assert.equal(list.invalid, 1)
  assert.deepEqual(buildRecipientList([], 'email'), { recipients: [], invalid: 0, duplicates: 0 })
})
