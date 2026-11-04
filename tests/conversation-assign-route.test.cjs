// POST /api/conversations/[id]/assign and PATCH /api/conversations/[id]: taking a chat, giving it to
// a teammate, and switching the chatbot back on, all on the server and all ending a hand-off.
// Against a fake database; nothing here reaches the network.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const ORG = '99999999-9999-4999-8999-999999999999'
const AGENT = '11111111-1111-4111-8111-111111111111'
const TEAMMATE = '22222222-2222-4222-8222-222222222222'
const MANAGER = '33333333-3333-4333-8333-333333333333'
const VIEWER = '44444444-4444-4444-8444-444444444444'
const CONTACT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CHAT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const HANDED = '2026-11-04T05:00:00Z'
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

const tables = {}
const writes = []
const fake = { noHandOffColumn: false, takenMeanwhileBy: null }
const missing = { code: '42703', message: 'column conversations.handed_off_at does not exist' }
const db = {
  from(table) {
    const filters = []
    let action = 'select'
    let values = null
    let columns = '*'
    let shape = 'many'
    const run = () => {
      const rows = tables[table] || []
      if (fake.noHandOffColumn && table === 'conversations' && (/handed_off_at/.test(columns) || (values && 'handed_off_at' in values))) {
        return { data: null, error: missing }
      }
      if (action === 'update' && table === 'conversations' && fake.takenMeanwhileBy) {
        // Another agent's statement lands first
        for (const row of rows) row.assigned_to = fake.takenMeanwhileBy
        fake.takenMeanwhileBy = null
      }
      const matched = rows.filter((row) => filters.every((filter) => filter(row)))
      if (action === 'update') {
        writes.push({ table, values })
        for (const row of matched) Object.assign(row, values)
      }
      const copies = matched.map((row) => ({ ...row }))
      return shape === 'maybe' ? { data: copies[0] || null, error: null } : { data: copies, error: null }
    }
    const query = {
      select: (selected) => { if (action === 'select') columns = selected || '*'; return query },
      update: (patch) => { action = 'update'; values = patch; return query },
      eq: (column, value) => { filters.push((row) => row[column] === value); return query },
      is: (column, value) => { filters.push((row) => (value === null ? row[column] == null : row[column] === value)); return query },
      not: (column, operator, value) => { filters.push((row) => row[column] != null); return query },
      limit: () => query,
      maybeSingle: () => { shape = 'maybe'; return query },
      then: (resolve, reject) => Promise.resolve().then(run).then(resolve, reject),
    }
    return query
  },
}

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.invalid'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'
let caller = null
stub(require.resolve('@supabase/supabase-js', { paths: [PROJECT] }), { createClient: () => db })
const { can, describeDenied } = require(path.join(PROJECT, 'lib/rbac.ts'))
stub(path.join(PROJECT, 'lib/api-auth-helper.ts'), {
  // The organization check is the helper's own; the permission check follows lib/rbac.ts as the real one does
  verifyRecordAccess: async (_request, _table, _id, options = {}) => {
    if (!caller) return { authorized: false, error: 'Unauthorized', status: 401, user: null }
    if (options.permission && !can(caller, options.permission)) return { authorized: false, error: describeDenied(options.permission), status: 403, user: caller }
    return { authorized: true, user: caller }
  },
})
console.warn = () => {}
console.error = () => {}

const assignRoute = require(path.join(PROJECT, 'app/api/conversations/[id]/assign/route.ts'))
const chatRoute = require(path.join(PROJECT, 'app/api/conversations/[id]/route.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))

const agent = { id: AGENT, role: 'sales_employee', organization_id: ORG }
const manager = { id: MANAGER, role: 'org_manager', organization_id: ORG }

async function call(route, method, body, id = CHAT) {
  const request = new NextRequest(`https://wamacrm.example.com/api/conversations/${id}${route === assignRoute ? '/assign' : ''}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const res = await route[method](request, { params: Promise.resolve({ id }) })
  return { status: res.status, ...(await res.json()) }
}
const assign = (body) => call(assignRoute, 'POST', body)
const chat = () => tables.conversations[0]

function reset(conversation = {}) {
  fake.noHandOffColumn = false
  fake.takenMeanwhileBy = null
  caller = agent
  writes.length = 0
  tables.conversations = [{ id: CHAT, organization_id: ORG, contact_id: CONTACT, assigned_to: null, auto_reply_enabled: false, handed_off_at: HANDED, ...conversation }]
  tables.leads = []
  tables.tickets = []
  tables.users = [
    { id: AGENT, organization_id: ORG, role: 'sales_employee', full_name: 'Ravi' },
    { id: TEAMMATE, organization_id: ORG, role: 'sales_employee', full_name: 'Priya Nair' },
    { id: VIEWER, organization_id: ORG, role: 'sales_employee', read_only: true, full_name: 'Sam' },
  ]
}

test('Assign: an agent takes a handed-off chat, which leaves the queue', async () => {
  reset()
  const answer = await assign()
  assert.equal(answer.status, 200)
  assert.equal(answer.changed, true)
  assert.equal(chat().assigned_to, AGENT)
  assert.equal(chat().handed_off_at, null)
  assert.deepEqual(writes, [{ table: 'conversations', values: { assigned_to: AGENT, handed_off_at: null } }])

  // Asking again changes nothing
  writes.length = 0
  assert.equal((await assign()).changed, false)
  assert.equal(writes.length, 0)
})

test('Assign: two agents at once, the second gets a 409 and the chat stays with the first', async () => {
  reset()
  fake.takenMeanwhileBy = TEAMMATE
  const answer = await assign()
  assert.equal(answer.status, 409)
  assert.equal(answer.code, 'already_assigned')
  assert.equal(chat().assigned_to, TEAMMATE)
})

test('Assign: an agent cannot take a chat they cannot see, a teammate holds, or whose customer a teammate handles', async () => {
  // A manager answered it without taking it: not the team queue, so not the agent's to open
  reset({ handed_off_at: null })
  assert.equal((await assign()).status, 403)
  assert.equal(chat().assigned_to, null)

  reset({ assigned_to: TEAMMATE })
  tables.leads = [{ id: 'l0', organization_id: ORG, contact_id: CONTACT, assigned_to: AGENT, status: 'active' }] // the agent may see it through a lead
  const held = await assign()
  assert.equal(held.status, 409)
  assert.equal(chat().assigned_to, TEAMMATE)

  reset()
  tables.leads = [{ id: 'l1', organization_id: ORG, contact_id: CONTACT, assigned_to: TEAMMATE, status: 'active' }]
  const handled = await assign()
  assert.equal(handled.status, 403)
  assert.equal(handled.code, 'handled_by_teammate')
  assert.match(handled.error, /Priya Nair/)
  assert.equal(chat().assigned_to, null)
})

test('Assign: read-only accounts take nothing, and agents give chats to nobody else', async () => {
  reset()
  caller = { id: VIEWER, role: 'sales_employee', organization_id: ORG, read_only: true }
  assert.equal((await assign()).status, 403)

  reset()
  const answer = await assign({ assignedTo: TEAMMATE })
  assert.equal(answer.status, 403)
  assert.equal(answer.error, describeDenied('records.assign'))
  assert.equal((await assign({ assignedTo: null })).status, 403)
  assert.equal(chat().assigned_to, null)
  assert.equal((await assign({ assignedTo: 'not-a-uuid' })).status, 400)
})

test('Assign: a manager gives a chat to a teammate, reassigns it, or leaves it with nobody', async () => {
  reset()
  caller = manager
  assert.equal((await assign({ assignedTo: TEAMMATE })).status, 200)
  assert.equal(chat().assigned_to, TEAMMATE)
  assert.equal(chat().handed_off_at, null)

  assert.equal((await assign({ assignedTo: AGENT })).status, 200)
  assert.equal(chat().assigned_to, AGENT)

  // Not to a read-only teammate, nor to someone outside the organization
  assert.equal((await assign({ assignedTo: VIEWER })).status, 400)
  assert.equal((await assign({ assignedTo: '55555555-5555-4555-8555-555555555555' })).status, 404)
  assert.equal(chat().assigned_to, AGENT)

  assert.equal((await assign({ assignedTo: null })).status, 200)
  assert.equal(chat().assigned_to, null)
})

test('Assign: works before the hand-off migration', async () => {
  reset()
  delete chat().handed_off_at
  fake.noHandOffColumn = true
  const answer = await assign()
  assert.equal(answer.status, 200)
  assert.equal(chat().assigned_to, AGENT)
})

test('Chatbot switch: back on ends the hand-off, off by hand is no hand-off', async () => {
  reset()
  const on = await call(chatRoute, 'PATCH', { auto_reply_enabled: true })
  assert.equal(on.status, 200)
  assert.equal(chat().auto_reply_enabled, true)
  assert.equal(chat().handed_off_at, null)

  reset({ handed_off_at: null, auto_reply_enabled: true, assigned_to: AGENT })
  assert.equal((await call(chatRoute, 'PATCH', { auto_reply_enabled: false })).status, 200)
  assert.deepEqual(writes.map((write) => write.values), [{ auto_reply_enabled: false }])
  assert.equal(chat().handed_off_at, null)

  assert.equal((await call(chatRoute, 'PATCH', { auto_reply_enabled: 'yes' })).status, 400)

  // Someone else's chat, for an agent limited to their own work
  reset({ assigned_to: TEAMMATE, handed_off_at: null })
  assert.equal((await call(chatRoute, 'PATCH', { auto_reply_enabled: true })).status, 403)
  assert.equal(chat().auto_reply_enabled, false)

  // Without the column, the switch still works
  reset()
  delete chat().handed_off_at
  fake.noHandOffColumn = true
  assert.equal((await call(chatRoute, 'PATCH', { auto_reply_enabled: true })).status, 200)
  assert.equal(chat().auto_reply_enabled, true)
})
