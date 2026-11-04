// Hand-off visibility: an agent limited to their own work also sees, opens and replies to the chats
// the chatbot handed to the team (nobody assigned, chatbot off). Against a fake database; nothing
// here reaches the network.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const ORG = '99999999-9999-4999-8999-999999999999'
const AGENT = '11111111-1111-4111-8111-111111111111'
const TEAMMATE = '22222222-2222-4222-8222-222222222222'
const CONTACT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TICKET_CHAT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const CHAT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

// The caller verifyRecordAccess would have authenticated; set per test
let caller = null
stub(path.join(PROJECT, 'lib/api-auth-helper.ts'), {
  verifyRecordAccess: async () => (caller ? { authorized: true, user: caller } : { authorized: false, error: 'Unauthorized', status: 401, user: null }),
})

/** A stand-in for the Supabase client over in-memory rows, remembering which columns were asked for. */
const tables = { leads: [], tickets: [], conversations: [] }
const selected = []
const DB = {
  from(table) {
    let rows = [...(tables[table] || [])]
    const query = {
      select: (columns) => { selected.push({ table, columns }); return query },
      eq: (column, value) => { rows = rows.filter((row) => row[column] === value); return query },
      limit: (count) => { rows = rows.slice(0, count); return query },
      maybeSingle: () => ({ then: (resolve) => resolve({ data: rows[0] || null, error: null }) }),
      then: (resolve) => resolve({ data: rows, error: null }),
    }
    return query
  },
}

const { canAccessConversation, getAssignedConversationScope, verifyConversationAccess, HANDED_OFF_FILTER, isHandedOff, onlyHandedOff } = require(path.join(PROJECT, 'lib/record-visibility.ts'))
const { describeDenied } = require(path.join(PROJECT, 'lib/rbac.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))

const agent = { id: AGENT, role: 'sales_employee' }
const conv = (overrides) => ({ id: CHAT, organization_id: ORG, contact_id: null, assigned_to: null, ...overrides })

test('Hand-off: the rule names a chat nobody owns while the chatbot is off, and nothing else', () => {
  assert.equal(HANDED_OFF_FILTER, 'and(assigned_to.is.null,auto_reply_enabled.eq.false)')
  assert.equal(isHandedOff({ assigned_to: null, auto_reply_enabled: false }), true)
  assert.equal(isHandedOff({ assigned_to: undefined, auto_reply_enabled: false }), true)
  assert.equal(isHandedOff({ assigned_to: null, auto_reply_enabled: true }), false)        // the chatbot is still answering
  assert.equal(isHandedOff({ assigned_to: null, auto_reply_enabled: null }), false)        // never switched off
  assert.equal(isHandedOff({ assigned_to: null }), false)
  assert.equal(isHandedOff({ assigned_to: TEAMMATE, auto_reply_enabled: false }), false)   // a teammate took over

  // The query form of the same rule
  const applied = []
  const query = {
    is: (column, value) => { applied.push(['is', column, value]); return query },
    eq: (column, value) => { applied.push(['eq', column, value]); return query },
  }
  assert.equal(onlyHandedOff(query), query)
  assert.deepEqual(applied, [['is', 'assigned_to', null], ['eq', 'auto_reply_enabled', false]])
})

test('Hand-off: the assigned scope is unchanged and the visible scope adds the queue', async () => {
  tables.leads = [{ id: 'l1', organization_id: ORG, contact_id: CONTACT, assigned_to: AGENT, status: 'active' }]
  tables.tickets = [{ id: 't1', organization_id: ORG, conversation_id: TICKET_CHAT, assigned_to: AGENT, status: 'open' }]
  const scope = await getAssignedConversationScope(DB, AGENT, ORG)
  assert.equal(scope.orFilter, `assigned_to.eq.${AGENT},contact_id.in.(${CONTACT}),id.in.(${TICKET_CHAT})`)
  assert.equal(scope.visibleFilter, `${scope.orFilter},${HANDED_OFF_FILTER}`)

  tables.leads = []
  tables.tickets = []
  const bare = await getAssignedConversationScope(DB, TEAMMATE, ORG)
  assert.equal(bare.orFilter, `assigned_to.eq.${TEAMMATE}`)
  assert.equal(bare.visibleFilter, `assigned_to.eq.${TEAMMATE},and(assigned_to.is.null,auto_reply_enabled.eq.false)`)
})

test('Hand-off: opening one chat follows the same rule', async () => {
  tables.leads = []
  tables.tickets = []
  assert.equal(await canAccessConversation(DB, agent, conv({ auto_reply_enabled: false })), true)                         // waiting for the team
  assert.equal(await canAccessConversation(DB, { ...agent, read_only: true }, conv({ auto_reply_enabled: false })), true)  // may read it; writing is checked separately
  assert.equal(await canAccessConversation(DB, agent, conv({ auto_reply_enabled: true })), false)                         // the chatbot has it
  assert.equal(await canAccessConversation(DB, agent, conv({})), false)                                                   // unassigned, chatbot never switched off
  assert.equal(await canAccessConversation(DB, agent, conv({ assigned_to: TEAMMATE, auto_reply_enabled: false })), false) // a teammate's chat
  assert.equal(await canAccessConversation(DB, null, conv({ auto_reply_enabled: false })), false)
})

test('Hand-off: a single-chat request reads the chatbot state and lets an agent in', async () => {
  const request = new NextRequest(`https://wamacrm.example.com/api/messages?conversationId=${CHAT}`)
  caller = agent
  tables.conversations = [conv({ auto_reply_enabled: false })]
  selected.length = 0
  let result = await verifyConversationAccess(request, DB, CHAT)
  assert.equal(result.authorized, true)
  assert.equal(result.user, agent)
  assert.match(selected.find((entry) => entry.table === 'conversations').columns, /auto_reply_enabled/)

  tables.conversations = [conv({ assigned_to: TEAMMATE, auto_reply_enabled: false })]
  result = await verifyConversationAccess(request, DB, CHAT)
  assert.equal(result.authorized, false)
  assert.equal(result.status, 403)
  assert.equal(result.error, describeDenied('records.view_all'))

  // Managers never need the lookup
  caller = { id: TEAMMATE, role: 'org_manager' }
  selected.length = 0
  assert.equal((await verifyConversationAccess(request, DB, CHAT)).authorized, true)
  assert.equal(selected.length, 0)

  caller = null
  assert.equal((await verifyConversationAccess(request, DB, CHAT)).status, 401)
})
