// The inbox list and its hand-off queue: GET /api/conversations lists the chats the chatbot handed
// to the team with filter=needs_agent, counts them in every answer, and shows them to assigned-only
// agents next to their own chats. Against a fake database; nothing here reaches the network.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const ORG = '99999999-9999-4999-8999-999999999999'
const OTHER_ORG = '88888888-8888-4888-8888-888888888888'
const AGENT = '11111111-1111-4111-8111-111111111111'
const TEAMMATE = '22222222-2222-4222-8222-222222222222'
const MANAGER = '33333333-3333-4333-8333-333333333333'
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

// ── A fake database that evaluates the filters the route sends, PostgREST `or` strings included ──

/** Split "a.eq.1,and(b.is.null,c.eq.false),d.in.(x,y)" on the commas outside parentheses. */
function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') depth--
    else if (text[i] === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1 }
  }
  parts.push(text.slice(start))
  return parts
}

/** A PostgREST filter string as a row predicate. A plain list is an `or`, as `.or(...)` sends it. */
function parseFilter(text) {
  const group = text.match(/^(and|or)\((.*)\)$/s)
  if (group) {
    const parts = splitTopLevel(group[2]).map(parseFilter)
    return group[1] === 'and' ? (row) => parts.every((part) => part(row)) : (row) => parts.some((part) => part(row))
  }
  if (splitTopLevel(text).length > 1) return parseFilter(`or(${text})`)
  const [column, op, ...rest] = text.split('.')
  if (fake.noHandOffColumn && column === 'handed_off_at') throw missingColumn()
  if (op === 'not') {
    const inner = parseFilter([column, ...rest].join('.'))
    return (row) => !inner(row)
  }
  const value = rest.join('.')
  switch (op) {
    case 'eq': return (row) => String(row[column]) === value
    case 'is': return (row) => (value === 'null' ? row[column] == null : String(row[column]) === value)
    case 'in': return (row) => value.slice(1, -1).split(',').includes(String(row[column]))
    case 'ilike': {
      const pattern = new RegExp('^' + value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i')
      return (row) => pattern.test(String(row[column] ?? ''))
    }
    default: throw new Error(`Unsupported filter: ${text}`)
  }
}

const fake = { countFails: false, noHandOffColumn: false }
const missingColumn = () => ({ code: '42703', message: 'column conversations.handed_off_at does not exist' })
const tables = {}
const db = {
  from(table) {
    const filters = []
    let broken = null // a filter or column the database does not have
    let selection = {}
    let ordering = null
    let window = null
    const query = {
      select: (columns = '*', options = {}) => {
        selection = { columns, ...options }
        if (fake.noHandOffColumn && table === 'conversations' && /handed_off_at/.test(columns)) broken = missingColumn()
        return query
      },
      eq: (column, value) => { filters.push((row) => row[column] === value); return query },
      not: (column, operator, value) => {
        if (fake.noHandOffColumn && column === 'handed_off_at') broken = missingColumn()
        filters.push((row) => !(operator === 'is' && value === null ? row[column] == null : row[column] === value))
        return query
      },
      gt: (column, value) => { filters.push((row) => row[column] > value); return query },
      is: (column, value) => { filters.push((row) => (value === null ? row[column] == null : row[column] === value)); return query },
      in: (column, values) => { filters.push((row) => values.includes(row[column])); return query },
      or: (text) => { try { filters.push(parseFilter(text)) } catch (error) { broken = error } return query },
      order: (column, { ascending = true } = {}) => { ordering = { column, ascending }; return query },
      range: (from, to) => { window = [from, to]; return query },
      limit: (count) => { window = [0, count - 1]; return query },
      then(resolve, reject) {
        if (broken) return Promise.resolve({ data: null, count: null, error: broken }).then(resolve, reject)
        if (fake.countFails && table === 'conversations' && selection.head) {
          const error = { code: '42703', message: 'column conversations.auto_reply_enabled does not exist' }
          return Promise.resolve({ data: null, count: null, error }).then(resolve, reject)
        }
        let rows = (tables[table] || []).filter((row) => filters.every((filter) => filter(row)))
        if (ordering) {
          const { column, ascending } = ordering
          // Nulls last, as the route asks for
          rows.sort((a, b) => (a[column] == null) - (b[column] == null) || (ascending ? 1 : -1) * String(a[column]).localeCompare(String(b[column])))
        }
        const count = selection.count === 'exact' ? rows.length : null
        if (window) rows = rows.slice(window[0], window[1] + 1)
        return Promise.resolve({ data: selection.head ? null : rows.map((row) => ({ ...row })), count, error: null }).then(resolve, reject)
      },
    }
    return query
  },
}

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.invalid'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'
let caller = {}
stub(require.resolve('@supabase/supabase-js', { paths: [PROJECT] }), { createClient: () => db })
stub(path.join(PROJECT, 'lib/api-auth-helper.ts'), { verifyOrgAccess: async () => ({ authorized: true, user: caller }) })
const warnings = []
console.warn = (...args) => { warnings.push(args.join(' ')) }
console.error = () => {}

const route = require(path.join(PROJECT, 'app/api/conversations/route.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))

const manager = { id: MANAGER, role: 'org_manager', organization_id: ORG }
const agent = { id: AGENT, role: 'sales_employee', organization_id: ORG }

async function list(params = {}) {
  const url = new URL('https://wamacrm.example.com/api/conversations')
  url.searchParams.set('organizationId', ORG)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const res = await route.GET(new NextRequest(url.toString()))
  return { status: res.status, ...(await res.json()) }
}
const ids = (answer) => answer.conversations.map((conversation) => conversation.id)

const chat = (id, hour, overrides) => ({ id, organization_id: ORG, contact_id: `contact-${id}`, unread_count: 0, last_message_at: `2026-11-04T${hour}:00:00Z`, ...overrides })
const HANDED = '2026-11-04T05:00:00Z'
function reset() {
  fake.countFails = false
  fake.noHandOffColumn = false
  warnings.length = 0
  tables.conversations = [
    chat('mine', '10', { assigned_to: AGENT, auto_reply_enabled: true, unread_count: 2 }),
    chat('waiting-newer', '09', { assigned_to: null, auto_reply_enabled: false, handed_off_at: HANDED, unread_count: 3 }),
    chat('bot', '08', { assigned_to: null, auto_reply_enabled: true, unread_count: 1 }),        // the chatbot is still answering
    chat('taken', '07', { assigned_to: TEAMMATE, auto_reply_enabled: false, handed_off_at: null, unread_count: 5 }), // a teammate took over
    chat('waiting-older', '06', { assigned_to: null, auto_reply_enabled: false, handed_off_at: HANDED, unread_count: 4 }),
    chat('elsewhere', '05', { organization_id: OTHER_ORG, assigned_to: null, auto_reply_enabled: false, handed_off_at: HANDED, unread_count: 9 }),
    // A manager answered this one without taking it: the chatbot is off, but nobody handed it off
    chat('answered', '04', { assigned_to: null, auto_reply_enabled: false, handed_off_at: null, unread_count: 0 }),
  ]
  tables.contacts = [{ id: 'contact-mine', organization_id: ORG, first_name: 'Asha', last_name: null, phone_number: '+15550000001' }]
  tables.leads = []
  tables.tickets = []
  tables.messages = []
}

test('Inbox: filter=needs_agent lists the chats handed to the team, newest first, with the queue size', async () => {
  reset()
  caller = manager
  const answer = await list({ filter: 'needs_agent' })
  assert.equal(answer.status, 200)
  assert.deepEqual(ids(answer), ['waiting-newer', 'waiting-older'])
  assert.equal(answer.count, 2)
  assert.equal(answer.needsAgentCount, 2) // the other organization's chat is not counted

  // The whole inbox, for a manager: the queue size still comes along
  const all = await list()
  assert.deepEqual(ids(all), ['mine', 'waiting-newer', 'bot', 'taken', 'waiting-older', 'answered'])
  assert.equal(all.needsAgentCount, 2)
  assert.equal(all.unreadMessagesCount, 15)
})

test('Inbox: an assigned-only agent sees their own chats and the queue, nothing else', async () => {
  reset()
  caller = agent
  const answer = await list({ assignedTo: AGENT })
  assert.deepEqual(ids(answer), ['mine', 'waiting-newer', 'waiting-older'])
  assert.equal(answer.count, 3)
  assert.equal(answer.unreadMessagesCount, 2 + 3 + 4)
  assert.equal(answer.needsAgentCount, 2)

  // The server decides the limit, whatever the request says
  assert.deepEqual(ids(await list({ assignedTo: TEAMMATE })), ['mine', 'waiting-newer', 'waiting-older'])
  assert.deepEqual(ids(await list()), ['mine', 'waiting-newer', 'waiting-older'])
  // The queue on its own
  assert.deepEqual(ids(await list({ filter: 'needs_agent' })), ['waiting-newer', 'waiting-older'])
  // A single chat looked up by id follows the same rule
  assert.deepEqual(ids(await list({ id: 'waiting-older' })), ['waiting-older'])
  assert.deepEqual(ids(await list({ id: 'taken' })), [])
  // A chat a manager answered without taking is not the team's queue, so it stays out of sight
  assert.deepEqual(ids(await list({ id: 'answered' })), [])
})

test("Inbox: a manager filtering by a teammate gets that teammate's chats only", async () => {
  reset()
  caller = manager
  const answer = await list({ assignedTo: TEAMMATE })
  assert.deepEqual(ids(answer), ['taken'])
  assert.equal(answer.unreadMessagesCount, 5)
  assert.equal(answer.needsAgentCount, 2)
})

test('Inbox: the queue size comes with every answer, a search that matches nobody included', async () => {
  reset()
  caller = manager
  const nobody = await list({ search: 'nobody' })
  assert.deepEqual(nobody.conversations, [])
  assert.equal(nobody.needsAgentCount, 2)
  assert.equal(nobody.unreadMessagesCount, 15)

  assert.deepEqual(ids(await list({ search: 'Asha' })), ['mine'])
  // Asha's chat is assigned, so it is not in the queue
  assert.deepEqual(ids(await list({ search: 'Asha', filter: 'needs_agent' })), [])
})

test('Inbox: when the queue cannot be counted the list still loads, with one warning', async () => {
  reset()
  caller = manager
  fake.countFails = true
  const answer = await list()
  assert.equal(answer.status, 200)
  assert.deepEqual(ids(answer), ['mine', 'waiting-newer', 'bot', 'taken', 'waiting-older', 'answered'])
  assert.equal(answer.needsAgentCount, 0)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /Needs-agent count unavailable/)
})

test('Inbox: before the hand-off migration the queue is inferred from the chatbot being off, with one warning', async () => {
  reset()
  fake.noHandOffColumn = true
  caller = agent
  const answer = await list()
  assert.equal(answer.status, 200)
  // The old rule: the chat a manager answered shows up as well
  assert.deepEqual(ids(answer), ['mine', 'waiting-newer', 'waiting-older', 'answered'])
  assert.equal(answer.needsAgentCount, 3)
  assert.ok(warnings.some((warning) => /20261104_handoff_state\.sql/.test(warning)))

  caller = manager
  assert.deepEqual(ids(await list({ filter: 'needs_agent' })), ['waiting-newer', 'waiting-older', 'answered'])
})
