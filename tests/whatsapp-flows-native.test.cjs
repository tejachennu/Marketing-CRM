// WhatsApp native forms: the Meta Flow JSON rules, the form routes and the submissions list,
// against a fake database and a fake Meta API. Nothing here reaches the network or a real database.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER_ORG = '22222222-2222-4222-8222-222222222222'
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

// A fake Supabase that understands the query-builder calls these routes make. Like PostgREST it
// returns at most MAX_ROWS rows per request and refuses columns a table does not have.
const MAX_ROWS = 1000
const COLUMNS = { contacts: ['id', 'organization_id', 'first_name', 'last_name', 'email', 'phone_number'] }
let tables = {}
let calls = []
function run(table, ops) {
  const known = COLUMNS[table]
  const unknown = (column) => known && !known.includes(column) ? { data: null, error: { message: `column ${table}.${column} does not exist` } } : null
  let rows = tables[table] || []
  let count = false, range = null, single = false, update = null, insert = null
  for (const [op, ...args] of ops) {
    if (op === 'select' && args[0] !== '*' && known) {
      for (const column of String(args[0]).split(',').map((c) => c.trim())) { const error = unknown(column); if (error) return error }
    }
    if (op === 'select') count = args[1]?.count === 'exact'
    else if (['eq', 'in'].includes(op) && unknown(args[0])) return unknown(args[0])
    else if (op === 'eq') rows = rows.filter((row) => row[args[0]] === args[1])
    else if (op === 'in') rows = rows.filter((row) => args[1].includes(row[args[0]]))
    else if (op === 'is') rows = rows.filter((row) => row[args[0]] == null)
    else if (op === 'not') rows = rows.filter((row) => row[args[0]] != null)
    else if (op === 'limit') rows = rows.slice(0, args[0])
    else if (op === 'range') range = args
    else if (op === 'update') update = args[0]
    else if (op === 'insert') insert = args[0]
    else if (op === 'single' || op === 'maybeSingle') single = true
  }
  if (insert) { rows = insert.map((row) => ({ id: `new-${calls.length}`, ...row })); (tables[table] ||= []).push(...rows) }
  if (update) rows.forEach((row) => Object.assign(row, update))
  const total = rows.length
  if (range) {
    if (count && range[0] > 0 && range[0] >= total) return { data: null, count: null, error: { code: 'PGRST103', message: 'Requested range not satisfiable' } }
    rows = rows.slice(range[0], Math.min(range[1] + 1, range[0] + MAX_ROWS))
  } else rows = rows.slice(0, MAX_ROWS)
  if (single) return { data: rows[0] ?? null, error: rows[0] ? null : { message: 'Not found' } }
  return { data: rows, count: count ? total : null, error: null }
}
function from(table) {
  const ops = []
  calls.push({ table, ops })
  const query = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (resolve, reject) => Promise.resolve(run(table, ops)).then(resolve, reject)
      return (...args) => { ops.push([prop, ...args]); return query }
    },
  })
  return query
}
stub(require.resolve('@supabase/supabase-js', { paths: [PROJECT] }), { createClient: () => ({ from }) })
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.example.com'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'

const MANAGER = { id: 'manager', role: 'org_manager', organization_id: ORG }
const AGENT = { id: 'agent', role: 'sales_employee', organization_id: ORG }
let user = MANAGER
stub(path.join(PROJECT, 'lib/api-auth-helper.ts'), {
  verifyOrgAccess: async () => ({ authorized: true, user }),
  verifyRecordAccess: async () => ({ authorized: true, user }),
})

// Fake Meta: reports every form as whatever `metaStatus` is
let metaStatus = 'DRAFT'
global.fetch = async () => new Response(JSON.stringify({ id: 'meta-1', status: metaStatus }))
console.error = () => {}

const { compileMetaFlowJSON, NATIVE_FLOW_TEMPLATES, formAnswerText, formSubmissionsCsv } = require(path.join(PROJECT, 'lib/flows/meta-flows-spec.ts'))
const submissionsRoute = require(path.join(PROJECT, 'app/api/flows/submissions/route.ts'))
const nativeRoute = require(path.join(PROJECT, 'app/api/flows/native/route.ts'))
const nativeIdRoute = require(path.join(PROJECT, 'app/api/flows/native/[id]/route.ts'))
const workflowIdRoute = require(path.join(PROJECT, 'app/api/flows/workflows/[id]/route.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))

const BASE = 'https://crm.example.com'
const get = (url) => new NextRequest(BASE + url)
const json = (url, method, body) => new NextRequest(BASE + url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const params = (id) => ({ params: Promise.resolve({ id }) })
const screen = (id, children, extra = {}) => ({ id, title: 'Details', layout: { type: 'SingleColumnLayout', children }, ...extra })
const input = (name, extra = {}) => ({ id: name, type: 'TextInput', label: 'Name', name, ...extra })

function submissions(count, extra = (i) => ({})) {
  // Newest first, as the route orders them
  return Array.from({ length: count }, (_, i) => ({ id: `s${String(count - i).padStart(5, '0')}`, organization_id: ORG, flow_id: 'form', workflow_id: null,
    contact_phone: '919876543210', lead_id: null, response_payload: { full_name: `Person ${i}` }, created_at: new Date(Date.UTC(2026, 0, 1) - i * 60000).toISOString(), ...extra(i) }))
}
function reset() {
  user = MANAGER
  metaStatus = 'DRAFT'
  calls = []
  tables = {
    flow_submissions: [],
    contacts: [],
    whatsapp_native_flows: [{ id: 'form', organization_id: ORG, name: 'Lead form', status: 'DRAFT', flow_id_meta: null, categories: ['LEAD_GENERATION'],
      screens: [screen('DETAILS', [input('full_name', { label: 'Full Name' }), { id: 'plan', type: 'RadioGroup', label: 'Plan', name: 'plan', options: [{ id: 'p1', title: 'Starter' }, { id: 'p2', title: 'Pro' }] }])] }],
    whatsapp_workflows: [{ id: 'wf', organization_id: ORG, name: 'Workflow', canvas_nodes: [], canvas_edges: [] }],
    flow_sessions: [],
    pipeline_stages: [],
    organizations: [{ id: ORG, whatsapp_provider: 'facebook', whatsapp_api_token: 'token', whatsapp_business_account_id: '1', whatsapp_phone_number_id: '2' }],
  }
}

// ── Meta Flow JSON rules ──

test('Forms: every starter template still compiles', () => {
  for (const template of Object.values(NATIVE_FLOW_TEMPLATES)) assert.equal(compileMetaFlowJSON(template.screens).version, '7.3')
})

test('Forms: screen IDs are capital letters and underscores, and SUCCESS is reserved', () => {
  for (const id of ['screen_one', 'SCREEN_1', 'Details', '_DETAILS']) {
    assert.throws(() => compileMetaFlowJSON([screen(id, [input('a')])]), new RegExp(`Screen 1 \\("Details"\\): the screen ID "${id}" is not allowed`))
  }
  assert.throws(() => compileMetaFlowJSON([screen('SUCCESS', [input('a')])]), /reserved/)
  assert.equal(compileMetaFlowJSON([screen('CONTACT_DETAILS', [input('a')])]).screens[0].id, 'CONTACT_DETAILS')
})

test('Forms: screens saved without an ID get letter-only IDs, and navigation follows them', () => {
  const json = compileMetaFlowJSON([screen('', [input('a')]), screen('', [input('b')]), screen('SCREEN_B', [input('c')])])
  assert.deepEqual(json.screens.map((s) => s.id), ['SCREEN_A', 'SCREEN_BX', 'SCREEN_B'])
  assert.equal(json.screens[0].layout.children[0].children.at(-1)['on-click-action'].next.name, 'SCREEN_BX')
  for (const s of json.screens) assert.match(s.id, /^[A-Z][A-Z_]*$/)
})

test('Forms: option titles, button labels, text and input types are checked before Meta sees them', () => {
  const choice = (title) => ({ id: 'plan', type: 'Dropdown', label: 'Plan', name: 'plan', options: [{ id: 'a', title }] })
  assert.throws(() => compileMetaFlowJSON([screen('DETAILS', [choice('x'.repeat(31))])]), /Screen 1 \("Details"\): option "x{31}" in "Plan" is 31 characters\. WhatsApp allows at most 30/)
  compileMetaFlowJSON([screen('DETAILS', [choice('x'.repeat(30))])])

  assert.throws(() => compileMetaFlowJSON([screen('DETAILS', [input('a'), { id: 'f', type: 'Footer', label: 'y'.repeat(36), name: '' }])]), /button label .* 36 characters\. WhatsApp allows at most 35/)
  assert.equal(compileMetaFlowJSON([screen('DETAILS', [input('a'), { id: 'f', type: 'Footer', label: 'y'.repeat(35), name: '' }])]).screens[0].layout.children[0].children.at(-1).label, 'y'.repeat(35))

  for (const type of ['TextHeading', 'TextSubheading', 'TextBody', 'TextCaption']) {
    assert.throws(() => compileMetaFlowJSON([screen('DETAILS', [{ id: 't', type, label: '  ', name: '' }, input('a')])]), new RegExp(`a ${type} element has no text`))
  }
  assert.equal(compileMetaFlowJSON([screen('DETAILS', [{ id: 't', type: 'TextHeading', label: 'Welcome', name: '' }])]).screens[0].layout.children[0].children[0].type, 'TextHeading')

  for (const inputType of ['text', 'number', 'email', 'password', 'passcode', 'phone']) compileMetaFlowJSON([screen('DETAILS', [input('a', { input_type: inputType })])])
  assert.throws(() => compileMetaFlowJSON([screen('DETAILS', [input('a', { input_type: 'numeric' })])]), /"Name" has input type "numeric"\. Use one of: text, number, email, password, passcode, phone/)
})

// ── CSV export helpers ──

test('Export: cells are quoted and spreadsheet formulas are neutralised', () => {
  const csv = formSubmissionsCsv(['Name, "full"', 'Phone'], [['=HYPERLINK("x")', '+919876543210'], ['-1', '@SUM(A1)'], ['\tx', '\rx'], ['plain', null]])
  const lines = csv.split('\r\n')
  assert.equal(lines[0], '"Name, ""full""","Phone"')
  assert.equal(lines[1], `"'=HYPERLINK(""x"")","'+919876543210"`)
  assert.equal(lines[2], `"'-1","'@SUM(A1)"`)
  assert.equal(lines[3], `"'\tx","'\rx"`)
  assert.equal(lines[4], '"plain",""')
})

test('Export: nested answers are read and choice IDs become their titles', () => {
  const payload = { plan: 'p2', extras: ['e1', 'e2'], address: { city: 'Pune' }, 'a.b': 'flat key', agreed: false }
  assert.equal(formAnswerText(payload, 'plan', { p1: 'Starter', p2: 'Pro' }), 'Pro')
  assert.equal(formAnswerText(payload, 'extras', { e1: 'Install', e2: 'Training' }), 'Install, Training')
  assert.equal(formAnswerText(payload, 'address.city'), 'Pune')
  assert.equal(formAnswerText(payload, 'a.b'), 'flat key')
  assert.equal(formAnswerText(payload, 'address'), '{"city":"Pune"}')
  assert.equal(formAnswerText(payload, 'agreed'), 'false')
  assert.equal(formAnswerText(payload, 'missing.key'), '')
  assert.equal(formAnswerText(payload, 'plan', { toString: 'x' }), 'p2')
})

// ── Submissions list ──

test('Submissions: contacts are matched by phone number in either spelling and named from first and last name', async () => {
  reset()
  tables.flow_submissions = [
    ...submissions(1),
    ...submissions(1, () => ({ id: 'plus', contact_phone: '+14155550100' })),
    ...submissions(1, () => ({ id: 'other', contact_phone: '+447700900000' })),
  ]
  tables.contacts = [
    { id: 'c1', organization_id: ORG, first_name: 'Asha', last_name: 'Rao', email: 'asha@example.com', phone_number: '+919876543210' },
    { id: 'c2', organization_id: ORG, first_name: 'Ben', last_name: null, email: null, phone_number: '14155550100' },
    { id: 'c3', organization_id: OTHER_ORG, first_name: 'Other', last_name: 'Org', email: 'x@example.com', phone_number: '+447700900000' },
  ]
  const res = await submissionsRoute.GET(get(`/api/flows/submissions?organizationId=${ORG}`))
  assert.equal(res.status, 200)
  const body = await res.json()
  const byId = Object.fromEntries(body.submissions.map((s) => [s.id, s]))
  assert.equal(byId.s00001.contact_name, 'Asha Rao')
  assert.equal(byId.s00001.contact_email, 'asha@example.com')
  assert.equal(byId.plus.contact_name, 'Ben')
  assert.equal(byId.other.contact_name, null, 'another organization\'s contact is never used')
  assert.equal(byId.s00001.flow_name, 'Lead form')
})

test('Submissions: pages are read with range and the total counts every match', async () => {
  reset()
  tables.flow_submissions = submissions(2600)
  const res = await submissionsRoute.GET(get(`/api/flows/submissions?organizationId=${ORG}&page=3&pageSize=25`))
  const body = await res.json()
  assert.equal(body.total, 2600)
  assert.equal(body.totalPages, 104)
  assert.equal(body.submissions.length, 25)
  assert.equal(body.submissions[0].id, tables.flow_submissions[50].id)
  const query = calls.find((c) => c.table === 'flow_submissions')
  assert.deepEqual(query.ops.find(([op]) => op === 'range'), ['range', 50, 74])
  assert.deepEqual(query.ops.find(([op]) => op === 'select'), ['select', '*', { count: 'exact' }])

  // The oldest page is reachable, not lost behind the 1000-row cap
  const last = await (await submissionsRoute.GET(get(`/api/flows/submissions?organizationId=${ORG}&page=104&pageSize=25`))).json()
  assert.equal(last.submissions.at(-1).id, tables.flow_submissions.at(-1).id)

  // A page past the end is empty but still reports the total
  const past = await (await submissionsRoute.GET(get(`/api/flows/submissions?organizationId=${ORG}&page=500&pageSize=25`))).json()
  assert.equal(past.submissions.length, 0)
  assert.equal(past.total, 2600)
})

test('Submissions: lead status filters in SQL, answer filters search past the first 1000 rows', async () => {
  reset()
  tables.flow_submissions = submissions(2500, (i) => ({ lead_id: i % 2 ? 'lead' : null, response_payload: { full_name: i === 2400 ? 'Zed Old' : `Person ${i}` } }))
  const status = await (await submissionsRoute.GET(get(`/api/flows/submissions?organizationId=${ORG}&filters=${encodeURIComponent(JSON.stringify([{ field: 'status', operator: 'eq', value: 'lead_created' }]))}`))).json()
  assert.equal(status.total, 1250)
  assert.ok(calls.find((c) => c.table === 'flow_submissions').ops.some(([op, column]) => op === 'not' && column === 'lead_id'))

  const answer = await (await submissionsRoute.GET(get(`/api/flows/submissions?organizationId=${ORG}&filters=${encodeURIComponent(JSON.stringify([{ field: 'full_name', operator: 'contains', value: 'zed' }]))}`))).json()
  assert.equal(answer.total, 1)
  assert.equal(answer.submissions[0].response_payload.full_name, 'Zed Old')
  assert.equal(answer.truncated, false)
})

test('Submissions: an export returns every matching row in one response, up to 10,000', async () => {
  reset()
  tables.flow_submissions = submissions(2300)
  const body = await (await submissionsRoute.GET(get(`/api/flows/submissions?organizationId=${ORG}&export=1&pageSize=25`))).json()
  assert.equal(body.submissions.length, 2300)
  assert.equal(new Set(body.submissions.map((s) => s.id)).size, 2300)
  assert.equal(body.truncated, false)

  reset()
  tables.flow_submissions = submissions(10050)
  const capped = await (await submissionsRoute.GET(get(`/api/flows/submissions?organizationId=${ORG}&export=1`))).json()
  assert.equal(capped.submissions.length, 10000)
  assert.equal(capped.total, 10050)
  assert.equal(capped.truncated, true)
})

test('Submissions: the question list only reads the caller\'s own organization\'s form', async () => {
  reset()
  tables.whatsapp_native_flows[0].organization_id = OTHER_ORG
  const res = await submissionsRoute.POST(json('/api/flows/submissions', 'POST', { organizationId: ORG, flowId: 'form' }))
  const { fields } = await res.json()
  assert.equal(fields.some((f) => f.key === 'plan'), false)
  const lookup = calls.find((c) => c.table === 'whatsapp_native_flows')
  assert.ok(lookup.ops.some(([op, column, value]) => op === 'eq' && column === 'organization_id' && value === ORG))

  reset()
  const own = await (await submissionsRoute.POST(json('/api/flows/submissions', 'POST', { organizationId: ORG, flowId: 'form' }))).json()
  assert.deepEqual(own.fields.find((f) => f.key === 'plan').options, [{ value: 'p1', label: 'Starter' }, { value: 'p2', label: 'Pro' }])
})

// ── Who sees customers' answers ──

test('Forms and workflows: submissions and customer phones need records.view_all', async () => {
  reset()
  tables.flow_submissions = submissions(3, () => ({ workflow_id: 'wf' }))
  tables.flow_sessions = [{ id: 'run', workflow_id: 'wf', status: 'FAILED', contact_phone: '919876543210', current_node_id: 'n1', last_interaction_at: '2026-01-01', state_data: { form: { full_name: 'Asha' }, _last_error: 'Stage missing' } }]

  user = AGENT
  const form = await (await nativeIdRoute.GET(get('/api/flows/native/form'), params('form'))).json()
  assert.equal(form.flow.id, 'form')
  assert.deepEqual(form.submissions, [])
  const workflow = await (await workflowIdRoute.GET(get('/api/flows/workflows/wf'), params('wf'))).json()
  assert.deepEqual(workflow.recentSubmissions, [])
  assert.equal(workflow.recentSessions[0].contact_phone, undefined)
  assert.deepEqual(workflow.recentSessions[0].state_data, { _last_error: 'Stage missing' }, 'failures stay visible to the builder')

  user = MANAGER
  assert.equal((await (await nativeIdRoute.GET(get('/api/flows/native/form'), params('form'))).json()).submissions.length, 3)
  const managed = await (await workflowIdRoute.GET(get('/api/flows/workflows/wf'), params('wf'))).json()
  assert.equal(managed.recentSubmissions.length, 3)
  assert.equal(managed.recentSessions[0].contact_phone, '919876543210')
})

// ── Creating and saving forms ──

test('Forms: creating a form Meta would reject is a 400 with the reason, and categories are checked', async () => {
  reset()
  const bad = await nativeRoute.POST(json('/api/flows/native', 'POST', { organizationId: ORG, name: 'Bad', screens: [screen('step_1', [input('a')])] }))
  assert.equal(bad.status, 400)
  assert.match((await bad.json()).error, /screen ID "step_1" is not allowed/)

  const category = await nativeRoute.POST(json('/api/flows/native', 'POST', { organizationId: ORG, name: 'Bad', categories: ['MARKETING'] }))
  assert.equal(category.status, 400)
  assert.match((await category.json()).error, /valid form category/)
  assert.equal((await nativeRoute.POST(json('/api/flows/native', 'POST', { organizationId: ORG, name: 'Bad', categories: 'LEAD_GENERATION' }))).status, 400)

  const created = await nativeRoute.POST(json('/api/flows/native', 'POST', { organizationId: ORG, template_key: 'LEAD_QUALIFICATION' }))
  assert.equal(created.status, 201)
  assert.equal((await nativeRoute.POST(json('/api/flows/native', 'POST', { organizationId: ORG, name: 'Default' }))).status, 201)
})

test('Forms: saving a form Meta already published is refused, and the stored status catches up', async () => {
  reset()
  Object.assign(tables.whatsapp_native_flows[0], { flow_id_meta: 'meta-1', status: 'DRAFT' })
  metaStatus = 'PUBLISHED'
  const edited = structuredClone(tables.whatsapp_native_flows[0].screens)
  edited[0].title = 'Changed'
  const res = await nativeIdRoute.PUT(json('/api/flows/native/form', 'PUT', { screens: edited }), params('form'))
  assert.equal(res.status, 409)
  const body = await res.json()
  assert.equal(body.error, "This form is published on Meta, so it can't be edited. Duplicate it to make changes.")
  assert.equal(body.flow.status, 'PUBLISHED')
  assert.equal(tables.whatsapp_native_flows[0].status, 'PUBLISHED')
  assert.equal(tables.whatsapp_native_flows[0].screens[0].title, 'Details', 'the edits were not saved')
})
