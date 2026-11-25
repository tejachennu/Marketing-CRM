require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const D = require('../lib/account-deletion.ts')

const base = {
  userId: 'u-1',
  email: 'owner@shop.in',
  name: 'Teja',
  role: 'Admin',
  organizationId: 'org-1',
  organizationName: 'Sri <Lakshmi> Fashions',
  wholeWorkspace: true,
  reason: null,
  at: new Date('2026-11-25T06:30:00Z'),
}

test('the reason is trimmed, squeezed and cut; empty or not text is no reason', () => {
  assert.equal(D.cleanReason('  too   costly \n for now '), 'too costly for now')
  assert.equal(D.cleanReason('   '), null)
  assert.equal(D.cleanReason(42), null)
  assert.equal(D.cleanReason('x'.repeat(900)).length, D.MAX_REASON)
})

test('owners delete the workspace, staff only their login', () => {
  assert.match(D.deletionScope(true), /whole workspace/)
  assert.match(D.deletionScope(false), /stay for the rest of your team/)
})

test('the team email goes to super admins, else the support mailbox', () => {
  assert.deepEqual(D.teamRecipients([' Boss@Magnetora.in ', 'boss@magnetora.in', 'not-an-email']), ['boss@magnetora.in'])
  assert.deepEqual(D.teamRecipients([]), [D.DELETION_SUPPORT_EMAIL])
})

test('both emails name the account, escape what people typed, and say what goes', () => {
  const { team, person } = D.deletionEmails({ ...base, reason: '<b>closing</b> the shop' })
  assert.match(team.subject, /owner@shop\.in/)
  assert.match(team.html, /Sri &lt;Lakshmi&gt; Fashions/)
  assert.doesNotMatch(team.html, /<b>closing/)
  assert.match(team.html, /&lt;b&gt;closing/)
  assert.match(team.text, /Delete: Whole workspace and login/)
  assert.match(team.text, /IST/)
  assert.match(person.text, /whole workspace/)
  assert.match(person.text, /support@magnetora\.ai/)

  const staff = D.deletionEmails({ ...base, wholeWorkspace: false, name: null })
  assert.match(staff.team.text, /This login only/)
  assert.match(staff.person.text, /^Hi,/)
})
