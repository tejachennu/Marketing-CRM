require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const rbac = require('../lib/rbac.ts')
const { planOrganizationUpdate, toSafeOrganization, getOrganizationCredentials } = require('../lib/organization-access.ts')
const { canAccessConversation, getAssignedConversationScope, isUuid } = require('../lib/record-visibility.ts')
const { isPublicHttpUrl } = require('../lib/utils.ts')

const superAdmin = { id: 'u-super', role: 'superadmin' }
const owner = { id: 'u-owner', role: 'owner' }
const admin = { id: 'u-admin', role: 'org_admin' }
const manager = { id: 'u-manager', role: 'org_manager' }
const employee = { id: 'u-emp', role: 'sales_employee' }
const employeeSeeAll = { id: 'u-emp2', role: 'sales_employee', see_all: true }
const employeeReadOnly = { id: 'u-emp3', role: 'sales_employee', read_only: true }

// ── Role names ──────────────────────────────────────────────────────────────

test('Roles: every legacy role name maps onto one of the four roles', () => {
  const expected = {
    superadmin: 'super_admin', super_admin: 'super_admin', 'Super Admin': 'super_admin',
    owner: 'org_admin', admin: 'org_admin', OrgAdmin: 'org_admin', org_admin: 'org_admin',
    Manager: 'org_manager', saleslead: 'org_manager', org_manager: 'org_manager',
    member: 'sales_employee', agent: 'sales_employee', viewer: 'sales_employee',
    salesemployees: 'sales_employee', sales_employee: 'sales_employee',
  }
  for (const [stored, canonical] of Object.entries(expected)) {
    assert.equal(rbac.normalizeRole(stored), canonical, stored)
    assert.equal(rbac.isKnownRole(stored), true, stored)
  }
})

test('Roles: an empty or unknown role gets the least access, never admin', () => {
  for (const role of ['', null, undefined, 'root', 'administrator', 'god', 42, {}]) {
    assert.equal(rbac.normalizeRole(role), 'sales_employee')
    assert.equal(rbac.isKnownRole(role), false)
    assert.equal(rbac.isAdmin({ role }), false)
    assert.equal(rbac.isManager({ role }), false)
    assert.equal(rbac.isSuperAdmin({ role }), false)
  }
  assert.equal(rbac.can(null, 'records.write'), false)
  assert.equal(rbac.canSeeAll(undefined), false)
})

test('Roles: each role includes the ones below it', () => {
  assert.deepEqual([superAdmin, owner, admin, manager, employee].map(rbac.isSuperAdmin), [true, false, false, false, false])
  assert.deepEqual([superAdmin, owner, admin, manager, employee].map(rbac.isAdmin), [true, true, true, false, false])
  assert.deepEqual([superAdmin, owner, admin, manager, employee].map(rbac.isManager), [true, true, true, true, false])
  assert.deepEqual([superAdmin, owner, admin, manager, employee].map(rbac.isSalesEmployee), [false, false, false, false, true])
  assert.equal(rbac.isOwner(owner), true)
  assert.equal(rbac.isOwner(admin), false)
})

test('Roles: stored values keep "superadmin" and "owner", everything else is canonical', () => {
  assert.equal(rbac.toStoredRole('super_admin'), 'superadmin')
  assert.equal(rbac.toStoredRole('superadmin'), 'superadmin')
  assert.equal(rbac.toStoredRole('owner'), 'owner')
  assert.equal(rbac.toStoredRole('Manager'), 'org_manager')
  assert.equal(rbac.toStoredRole('OrgAdmin'), 'org_admin')
  assert.equal(rbac.toStoredRole('agent'), 'sales_employee')
})

test('Roles: badges show one label per role, with the owner called out', () => {
  assert.equal(rbac.getRoleDisplay('Manager').label, 'Org Manager')
  assert.equal(rbac.getRoleDisplay('saleslead').label, 'Org Manager')
  assert.equal(rbac.getRoleDisplay('agent').label, 'Sales Employee')
  assert.equal(rbac.getRoleDisplay('owner').label, 'Owner')
  assert.equal(rbac.getRoleDisplay('superadmin').label, 'Super Admin')
  assert.equal(rbac.getRoleDisplay(null).label, 'Sales Employee')
  assert.equal(rbac.ASSIGNABLE_ROLES.some((r) => r.value === rbac.DEFAULT_TEAMMATE_ROLE), true)
  assert.equal(rbac.DEFAULT_TEAMMATE_ROLE, 'sales_employee')
})

// ── Visibility and read-only ────────────────────────────────────────────────

test('Access: employees see assigned work only unless "see all" is granted', () => {
  assert.equal(rbac.canSeeAll(employee), false)
  assert.equal(rbac.canSeeAll(employeeSeeAll), true)
  assert.equal(rbac.canSeeAll(manager), true)
  assert.equal(rbac.canSeeAll({ role: 'org_manager', see_all: false }), true)

  assert.equal(rbac.canAccessAssigned(employee, 'u-emp'), true)
  assert.equal(rbac.canAccessAssigned(employee, 'u-other'), false)
  assert.equal(rbac.canAccessAssigned(employee, null), false)
  assert.equal(rbac.canAccessAssigned(employeeSeeAll, 'u-other'), true)
  assert.equal(rbac.canAccessAssigned({ role: 'sales_employee' }, undefined), false)
})

test('Access: read-only applies to employees and never to managers or admins', () => {
  assert.equal(rbac.isReadOnly(employeeReadOnly), true)
  assert.equal(rbac.isReadOnly(employee), false)
  assert.equal(rbac.isReadOnly({ role: 'viewer' }), true)
  assert.equal(rbac.isReadOnly({ role: 'org_manager', read_only: true }), false)
  assert.equal(rbac.isReadOnly({ role: 'owner', read_only: true }), false)
})

test('Permissions: the full role matrix', () => {
  const matrix = {
    //                     super  owner  admin  manager emp   emp+all emp+ro
    'platform.manage':    [true,  false, false, false,  false, false, false],
    'settings.manage':    [true,  true,  true,  false,  false, false, false],
    'team.manage':        [true,  true,  true,  false,  false, false, false],
    'team.grant_access':  [true,  true,  true,  true,   false, false, false],
    'records.assign':     [true,  true,  true,  true,   false, false, false],
    'automation.manage':  [true,  true,  true,  true,   false, false, false],
    'records.view_all':   [true,  true,  true,  true,   false, true,  false],
    'records.write':      [true,  true,  true,  true,   true,  true,  false],
    'contacts.manage':    [true,  true,  true,  true,   false, true,  false],
    'campaigns.manage':   [true,  true,  true,  true,   false, true,  false],
  }
  const people = [superAdmin, owner, admin, manager, employee, employeeSeeAll, employeeReadOnly]
  for (const [permission, expected] of Object.entries(matrix)) {
    assert.deepEqual(people.map((person) => rbac.can(person, permission)), expected, permission)
    assert.ok(rbac.describeDenied(permission).length > 10, permission)
  }
  // "See all" widens what an employee sees; it never unlocks settings or the team
  assert.equal(rbac.can(employeeSeeAll, 'settings.manage'), false)
  assert.equal(rbac.can(employeeSeeAll, 'team.manage'), false)
  // Seeing everything while read-only still cannot change anything
  assert.equal(rbac.can({ role: 'sales_employee', see_all: true, read_only: true }, 'campaigns.manage'), false)
  assert.equal(rbac.can(admin, 'not.a.permission'), false)
})

test('Pages: who may open what', () => {
  const pages = {
    //                           super  admin  manager emp    emp+all
    '/dashboard':               [false, true,  true,   true,  true],
    '/dashboard/leads':         [false, true,  true,   true,  true],
    '/dashboard/tickets':       [false, true,  true,   true,  true],
    '/dashboard/commerce':      [false, true,  true,   true,  true],
    '/dashboard/profile':       [true,  true,  true,   true,  true],
    '/dashboard/settings':      [false, true,  true,   false, false],
    '/dashboard/flows':         [false, true,  true,   false, false],
    '/dashboard/flows/abc':     [false, true,  true,   false, false],
    '/dashboard/campaigns':     [false, true,  true,   false, true],
    '/dashboard/campaigns/123': [false, true,  true,   false, true],
    '/dashboard/contacts':      [false, true,  true,   false, true],
    '/dashboard/superadmin':    [true,  false, false,  false, false],
  }
  const people = [superAdmin, admin, manager, employee, employeeSeeAll]
  for (const [path, expected] of Object.entries(pages)) {
    assert.deepEqual(people.map((person) => rbac.canAccessPage(person, path)), expected, path)
  }
  assert.equal(rbac.canAccessPage(null, '/dashboard'), false)
  // A path that merely starts with the same letters is a different page
  assert.equal(rbac.canAccessPage(employee, '/dashboard/settings-help'), true)
})

// ── Team management ─────────────────────────────────────────────────────────

test('Team: nobody can hand out a role above their own', () => {
  assert.deepEqual(rbac.getGrantableRoles(superAdmin), ['super_admin', 'org_admin', 'org_manager', 'sales_employee'])
  assert.deepEqual(rbac.getGrantableRoles(admin), ['org_admin', 'org_manager', 'sales_employee'])
  assert.deepEqual(rbac.getGrantableRoles(manager), [])
  assert.deepEqual(rbac.getGrantableRoles(employee), [])

  const ctx = { adminCount: 2 }
  assert.match(rbac.getTeamChangeError(admin, employee, { role: 'superadmin' }, ctx), /above your own/)
  assert.match(rbac.getTeamChangeError(admin, employee, { role: 'super_admin' }, ctx), /above your own/)
  assert.match(rbac.getTeamChangeError(admin, employee, { role: 'wizard' }, ctx), /valid role/)
  assert.equal(rbac.getTeamChangeError(admin, employee, { role: 'org_manager' }, ctx), null)
  assert.equal(rbac.getTeamChangeError(admin, employee, { role: 'org_admin' }, ctx), null)
  assert.equal(rbac.getTeamChangeError(superAdmin, employee, { role: 'superadmin' }, ctx), null)
})

test('Team: employees and managers cannot add, remove or promote anyone', () => {
  const ctx = { adminCount: 2 }
  for (const actor of [employee, employeeSeeAll, manager]) {
    assert.match(rbac.getTeamChangeError(actor, employee, { role: 'org_admin' }, ctx), /Only organization admins/)
    assert.match(rbac.getTeamChangeError(actor, admin, { remove: true }, ctx), /Only organization admins/)
    // The escalation the old API allowed: promoting yourself
    assert.ok(rbac.getTeamChangeError(actor, actor, { role: 'org_admin' }, ctx))
  }
})

test('Team: you cannot change your own role, remove yourself or flip your own switches', () => {
  const ctx = { adminCount: 2 }
  assert.match(rbac.getTeamChangeError(admin, admin, { role: 'sales_employee' }, ctx), /own role/)
  assert.match(rbac.getTeamChangeError(admin, admin, { remove: true }, ctx), /own account/)
  assert.match(rbac.getTeamChangeError(manager, manager, { access: true }, ctx), /own access/)
})

test('Team: the owner and super admins are protected from org admins', () => {
  const ctx = { adminCount: 3 }
  assert.match(rbac.getTeamChangeError(admin, owner, { remove: true }, ctx), /owner cannot be removed/)
  assert.match(rbac.getTeamChangeError(admin, owner, { role: 'sales_employee' }, ctx), /owner cannot be removed/)
  assert.match(rbac.getTeamChangeError(admin, superAdmin, { remove: true }, ctx), /Only a super admin/)
  assert.equal(rbac.getTeamChangeError(superAdmin, owner, { remove: true }, ctx), null)
  // The owner can manage other admins
  assert.equal(rbac.getTeamChangeError(owner, admin, { remove: true }, ctx), null)
  assert.equal(rbac.getTeamChangeError(owner, admin, { role: 'org_manager' }, ctx), null)
})

test('Team: an organization always keeps at least one admin', () => {
  const other = { id: 'u-admin-2', role: 'org_admin' }
  assert.match(rbac.getTeamChangeError(superAdmin, other, { remove: true }, { adminCount: 1 }), /at least one admin/)
  assert.match(rbac.getTeamChangeError(superAdmin, other, { role: 'org_manager' }, { adminCount: 1 }), /at least one admin/)
  assert.equal(rbac.getTeamChangeError(admin, other, { remove: true }, { adminCount: 2 }), null)
  // Keeping the role at admin level is fine even for the only admin
  assert.equal(rbac.getTeamChangeError(superAdmin, other, { role: 'org_admin' }, { adminCount: 1 }), null)
  // Removing a non-admin is never blocked by the admin count
  assert.equal(rbac.getTeamChangeError(admin, employee, { remove: true }, { adminCount: 1 }), null)
})

test('Team: managers may widen or limit a sales employee, and only a sales employee', () => {
  const ctx = { adminCount: 1 }
  assert.equal(rbac.getTeamChangeError(manager, employee, { access: true }, ctx), null)
  assert.equal(rbac.getTeamChangeError(admin, employeeReadOnly, { access: true }, ctx), null)
  assert.match(rbac.getTeamChangeError(manager, admin, { access: true }, ctx), /only apply to sales employees/)
  assert.match(rbac.getTeamChangeError(manager, { id: 'u-m2', role: 'Manager' }, { access: true }, ctx), /only apply to sales employees/)
  assert.match(rbac.getTeamChangeError(employeeSeeAll, employee, { access: true }, ctx), /Only admins and managers/)
  assert.match(rbac.getTeamChangeError(admin, null, { access: true }, ctx), /not found/)
})

// ── Organization settings ───────────────────────────────────────────────────

const ORG = {
  id: 'org-1', name: 'Acme', slug: 'acme', currency: 'INR', enable_ai: true, meta_catalog_id: 'cat-1',
  twilio_account_sid: 'ACxxx', twilio_auth_token: 'tok', sendgrid_api_key: 'SG.x', openai_api_key: 'sk-x',
  smtp_host: 'smtp.example.com', smtp_email: 'a@example.com', smtp_password: 'pw',
  whatsapp_api_token: 'EAAG', whatsapp_phone_number_id: '123', whatsapp_webhook_verify_token: 'v',
}

test('Organization: members get no credentials, only whether each channel is configured', () => {
  const safe = toSafeOrganization(ORG)
  for (const secret of ['twilio_account_sid', 'twilio_auth_token', 'sendgrid_api_key', 'openai_api_key', 'smtp_password', 'whatsapp_api_token', 'whatsapp_webhook_verify_token']) {
    assert.equal(secret in safe, false, secret)
  }
  assert.equal(JSON.stringify(safe).includes('EAAG'), false)
  assert.equal(JSON.stringify(safe).includes('sk-x'), false)
  assert.equal(safe.name, 'Acme')
  assert.equal(safe.meta_catalog_id, 'cat-1')
  assert.equal(safe.whatsapp_phone_number_id, '123')
  assert.deepEqual(safe.credentials, { messaging: true, email: true, ai: true })
  assert.equal(safe.whatsapp_connected, true)
})

test('Organization: a Meta-only or SMTP-only setup counts as configured', () => {
  assert.deepEqual(getOrganizationCredentials({ whatsapp_api_token: 't', whatsapp_phone_number_id: '1' }), { messaging: true, email: false, ai: false })
  assert.deepEqual(getOrganizationCredentials({ smtp_host: 'h', smtp_email: 'e', smtp_password: 'p' }), { messaging: false, email: true, ai: false })
  assert.deepEqual(getOrganizationCredentials({ twilio_account_sid: 'AC', twilio_auth_token: '  ' }), { messaging: false, email: false, ai: false })
  assert.deepEqual(getOrganizationCredentials(null), { messaging: false, email: false, ai: false })
  assert.equal(toSafeOrganization({ whatsapp_api_token: 't' }).whatsapp_connected, false)
})

test('Organization: only admins change channels and API keys', () => {
  const credentials = { openai_api_key: 'sk-new', whatsapp_api_token: 'EAAG-new' }
  assert.deepEqual(planOrganizationUpdate(admin, credentials), { ok: true, values: credentials })
  assert.deepEqual(planOrganizationUpdate(owner, { enable_ai: false }), { ok: true, values: { enable_ai: false } })
  for (const actor of [manager, employee, employeeSeeAll, employeeReadOnly]) {
    const plan = planOrganizationUpdate(actor, credentials)
    assert.equal(plan.ok, false)
    assert.equal(plan.status, 403)
  }
})

test('Organization: managers run the store and knowledge settings; employees change nothing', () => {
  const store = { meta_catalog_id: 'cat-2', commerce_enable_cod: true, service_synonyms: [] }
  assert.equal(planOrganizationUpdate(manager, store).ok, true)
  assert.equal(planOrganizationUpdate(admin, store).ok, true)
  assert.equal(planOrganizationUpdate(employee, store).status, 403)
  assert.equal(planOrganizationUpdate(employeeSeeAll, store).status, 403)
  // One field the caller may not change refuses the whole save, so nothing is applied partially
  assert.equal(planOrganizationUpdate(manager, { ...store, openai_api_key: 'sk' }).status, 403)
})

test('Organization: fields outside the list cannot be changed here, by anyone', () => {
  for (const updates of [{ max_teammates: 999 }, { id: 'other' }, { slug: 'x' }, { name: 'x', enable_ai: true }]) {
    const plan = planOrganizationUpdate(admin, updates)
    assert.equal(plan.ok, false)
    assert.equal(plan.status, 400)
  }
  assert.match(planOrganizationUpdate(admin, { max_teammates: 999 }).error, /max_teammates/)
  for (const empty of [null, undefined, [], 'x', {}, { enable_ai: undefined }]) {
    assert.equal(planOrganizationUpdate(admin, empty).status, 400)
  }
  // null is a real value: it clears a setting
  assert.deepEqual(planOrganizationUpdate(admin, { openai_api_key: null }), { ok: true, values: { openai_api_key: null } })
})

// ── Conversation visibility (server side) ───────────────────────────────────

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const ORG_ID = '99999999-9999-4999-8999-999999999999'
const CONTACT_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CONTACT_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CONV_1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const CONV_2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

/** A stand-in for the Supabase client: `.from(table).select().eq()...` over in-memory rows. */
function fakeSupabase(tables) {
  return {
    from(table) {
      let rows = [...(tables[table] || [])]
      const query = {
        select: () => query,
        eq: (column, value) => { rows = rows.filter((row) => row[column] === value); return query },
        limit: (count) => { rows = rows.slice(0, count); return query },
        then: (resolve) => resolve({ data: rows, error: null }),
      }
      return query
    },
  }
}

const DB = fakeSupabase({
  leads: [
    { id: 'l1', organization_id: ORG_ID, contact_id: CONTACT_1, assigned_to: A, status: 'active' },
    { id: 'l2', organization_id: ORG_ID, contact_id: CONTACT_2, assigned_to: A, status: 'won' },
    { id: 'l3', organization_id: 'other-org', contact_id: CONTACT_2, assigned_to: A, status: 'active' },
  ],
  tickets: [
    { id: 't1', organization_id: ORG_ID, conversation_id: CONV_2, assigned_to: A, status: 'open' },
    { id: 't2', organization_id: ORG_ID, conversation_id: CONV_1, assigned_to: B, status: 'resolved' },
  ],
})

test('Visibility: an assigned-only user is scoped to their chats, active leads and open tickets', async () => {
  const scope = await getAssignedConversationScope(DB, A, ORG_ID)
  assert.deepEqual(scope.contactIds, [CONTACT_1])
  assert.deepEqual(scope.conversationIds, [CONV_2])
  assert.equal(scope.orFilter, `assigned_to.eq.${A},contact_id.in.(${CONTACT_1}),id.in.(${CONV_2})`)

  const none = await getAssignedConversationScope(DB, B, ORG_ID)
  assert.equal(none.orFilter, `assigned_to.eq.${B}`)
})

test('Visibility: a user id that is not a UUID never reaches the query filter', async () => {
  await assert.rejects(() => getAssignedConversationScope(DB, `${A},organization_id.neq.x`, ORG_ID), /Invalid user id/)
  assert.equal(isUuid(A), true)
  assert.equal(isUuid(`${A})`), false)
  assert.equal(isUuid(''), false)
  assert.equal(isUuid(null), false)
})

test('Visibility: opening one conversation follows the same rules', async () => {
  const restricted = { id: A, role: 'sales_employee' }
  const stranger = { id: B, role: 'agent' }
  const conv = (overrides) => ({ id: 'x', organization_id: ORG_ID, contact_id: null, assigned_to: null, ...overrides })

  assert.equal(await canAccessConversation(DB, restricted, conv({ assigned_to: A })), true)            // assigned directly
  assert.equal(await canAccessConversation(DB, restricted, conv({ contact_id: CONTACT_1 })), true)      // through an active lead
  assert.equal(await canAccessConversation(DB, restricted, conv({ contact_id: CONTACT_2 })), false)     // the lead is won, or in another org
  assert.equal(await canAccessConversation(DB, restricted, conv({ id: CONV_2 })), true)                 // through an open ticket
  assert.equal(await canAccessConversation(DB, restricted, conv({ assigned_to: B })), false)            // someone else's chat
  assert.equal(await canAccessConversation(DB, restricted, conv({})), false)                            // unassigned
  assert.equal(await canAccessConversation(DB, stranger, conv({ id: CONV_1 })), false)                  // their ticket is resolved

  assert.equal(await canAccessConversation(DB, { id: B, role: 'org_manager' }, conv({ assigned_to: A })), true)
  assert.equal(await canAccessConversation(DB, { id: B, role: 'agent', see_all: true }, conv({ assigned_to: A })), true)
  assert.equal(await canAccessConversation(DB, { role: 'sales_employee' }, conv({ assigned_to: undefined })), false)
  assert.equal(await canAccessConversation(DB, null, conv({ assigned_to: A })), false)
})

// ── Media URLs the server is asked to download ──────────────────────────────

test('Media URLs: only public http(s) addresses may be fetched by the server', () => {
  for (const url of ['https://cdn.example.com/a.png', 'http://example.org/file.pdf?x=1', 'https://8.8.8.8/x', 'https://172.32.0.1/x']) {
    assert.equal(isPublicHttpUrl(url), true, url)
  }
  for (const url of [
    'http://localhost:3000/api/x', 'http://127.0.0.1/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://172.16.0.1/',
    'http://172.31.255.255/', 'http://169.254.169.254/latest/meta-data/', 'http://0.0.0.0/', 'http://[::1]/', 'http://[fd00::1]/',
    'http://[fe80::1]/', 'http://db.internal/', 'http://printer.local/', 'file:///etc/passwd', 'ftp://example.com/a', 'javascript:alert(1)',
    '/uploads/a.png', '', null, undefined, 'not a url',
  ]) {
    assert.equal(isPublicHttpUrl(url), false, String(url))
  }
})
