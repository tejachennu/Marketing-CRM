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
  let count = false, range = null, single = false, update = null, insert = null, remove = false
  for (const [op, ...args] of ops) {
    if (op === 'select' && args[0] !== '*' && known) {
      for (const column of String(args[0]).split(',').map((c) => c.trim())) { const error = unknown(column); if (error) return error }
    }
    if (op === 'select') count = args[1]?.count === 'exact'
    else if (['eq', 'in'].includes(op) && unknown(args[0])) return unknown(args[0])
    else if (op === 'eq') rows = rows.filter((row) => row[args[0]] === args[1])
    else if (op === 'neq') rows = rows.filter((row) => row[args[0]] !== args[1])
    else if (op === 'gte') rows = rows.filter((row) => row[args[0]] >= args[1])
    else if (op === 'lt') rows = rows.filter((row) => row[args[0]] < args[1])
    else if (op === 'in') rows = rows.filter((row) => args[1].includes(row[args[0]]))
    else if (op === 'is') rows = rows.filter((row) => row[args[0]] == null)
    else if (op === 'not') rows = rows.filter((row) => row[args[0]] != null)
    else if (op === 'limit') rows = rows.slice(0, args[0])
    else if (op === 'range') range = args
    else if (op === 'update') update = args[0]
    else if (op === 'insert') insert = args[0]
    else if (op === 'delete') remove = true
    else if (op === 'single' || op === 'maybeSingle') single = true
  }
  if (insert) { rows = insert.map((row) => ({ id: `new-${calls.length}`, ...row })); (tables[table] ||= []).push(...rows) }
  if (update) rows.forEach((row) => Object.assign(row, update))
  if (remove) tables[table] = (tables[table] || []).filter((row) => !rows.includes(row))
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
  getAuthenticatedUser: async () => user,
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

test('Forms: validating a form Meta already published is refused, and the stored status catches up', async () => {
  reset()
  Object.assign(tables.whatsapp_native_flows[0], { flow_id_meta: 'meta-1', status: 'DRAFT' })
  metaStatus = 'PUBLISHED'
  const edited = structuredClone(tables.whatsapp_native_flows[0].screens)
  edited[0].title = 'Changed'
  const res = await nativeIdRoute.PUT(json('/api/flows/native/form', 'PUT', { screens: edited, action: 'validate' }), params('form'))
  assert.equal(res.status, 409)
  const body = await res.json()
  assert.equal(body.error, "This form is published on Meta, so it can't be edited. Duplicate it to make changes.")
  assert.equal(body.flow.status, 'PUBLISHED')
  assert.equal(tables.whatsapp_native_flows[0].status, 'PUBLISHED')
  assert.equal(tables.whatsapp_native_flows[0].screens[0].title, 'Details', 'the edits were not saved')
})

// ── Deleting forms ──

const defaultFetch = global.fetch
const metaError = (status, error) => async () => new Response(JSON.stringify({ error }), { status })

test('Forms: a form Meta no longer knows is deleted locally; any other Meta error keeps it', async () => {
  try {
    for (const [status, error] of [[404, { message: "Unsupported delete request. Object with ID 'meta-1' does not exist", code: 100, error_subcode: 33 }], [400, { message: 'Object does not exist', code: 100 }]]) {
      reset()
      Object.assign(tables.whatsapp_native_flows[0], { flow_id_meta: 'meta-1', status: 'DRAFT' })
      global.fetch = metaError(status, error)
      const gone = await nativeIdRoute.DELETE(get('/api/flows/native/form'), params('form'))
      assert.equal(gone.status, 200)
      assert.equal(tables.whatsapp_native_flows.length, 0)
    }
    reset()
    Object.assign(tables.whatsapp_native_flows[0], { flow_id_meta: 'meta-1', status: 'DRAFT' })
    global.fetch = metaError(400, { message: 'Invalid OAuth access token.', code: 190 })
    const refused = await nativeIdRoute.DELETE(get('/api/flows/native/form'), params('form'))
    assert.equal(refused.status, 422)
    assert.equal((await refused.json()).error, 'Invalid OAuth access token.')
    assert.equal(tables.whatsapp_native_flows.length, 1)
  } finally { global.fetch = defaultFetch }
})

// ── AI flow generation ──

const aiGenerateRoute = require(path.join(PROJECT, 'app/api/flows/ai-generate/route.ts'))
const generate = (organizationId, prompt) => aiGenerateRoute.POST(json('/api/flows/ai-generate', 'POST', { organizationId, prompt }))

test('AI generation: prompts are capped, the OpenAI call is bounded, and generations are rate limited per person and organization', async () => {
  reset()
  tables.organizations[0].openai_api_key = 'sk-test'
  const requests = []
  const graph = { name: 'Generated', canvas_nodes: [{ id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: { keywords: ['hi'] } }, { id: 'm', type: 'message', position: { x: 300, y: 0 }, data: { body: 'Hello' } }], canvas_edges: [{ id: 'e', source: 't', target: 'm' }] }
  global.fetch = async (url, init) => {
    requests.push({ url, init })
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(graph) } }] }))
  }
  try {
    const long = await generate(ORG, 'x'.repeat(2001))
    assert.equal(long.status, 400)
    assert.match((await long.json()).error, /2000 characters/)
    assert.equal(requests.length, 0)

    const ok = await generate(ORG, 'A lead flow')
    assert.equal(ok.status, 200)
    assert.equal((await ok.json()).flow.name, 'Generated')
    assert.equal(JSON.parse(requests[0].init.body).max_tokens, 4000)
    assert.ok(requests[0].init.signal instanceof AbortSignal, 'the call cannot hang the request')

    // 10 per person per 10 minutes
    const statuses = [ok.status]
    let limited
    while (statuses.length < 12) {
      const res = await generate(ORG, 'Another flow')
      statuses.push(res.status)
      if (res.status === 429 && !limited) limited = res
    }
    assert.equal(statuses.filter((status) => status === 200).length, 10)
    assert.deepEqual(statuses.slice(10), [429, 429])
    assert.equal(requests.length, 10, 'no OpenAI call is made once the limit is reached')
    assert.match((await limited.json()).error, /wait a few minutes/)
    assert.ok(Number(limited.headers.get('Retry-After')) > 0)

    // A slow AI answers with a time-out, not a hung request
    user = { id: 'slow', role: 'org_manager', organization_id: ORG }
    global.fetch = async () => { const error = new Error('The operation was aborted due to timeout'); error.name = 'TimeoutError'; throw error }
    const slow = await generate(ORG, 'A slow flow')
    assert.equal(slow.status, 504)
    assert.match((await slow.json()).error, /took too long/)

    // 60 per organization per hour, whoever asks
    global.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(graph) } }] }))
    const organization = []
    for (let person = 0; person < 7; person++) {
      user = { id: `person-${person}`, role: 'org_manager', organization_id: OTHER_ORG }
      for (let attempt = 0; attempt < 10; attempt++) organization.push((await generate(OTHER_ORG, 'Flow')).status)
    }
    assert.equal(organization.filter((status) => status === 200).length, 60)
    assert.deepEqual(organization.slice(60), Array(10).fill(429))
  } finally {
    global.fetch = defaultFetch
    user = MANAGER
  }
})

test('AI generation: the prompt describes blocks the way the runtime executes them', async () => {
  reset()
  tables.organizations[0].openai_api_key = 'sk-test'
  user = { id: 'prompt-reader', role: 'org_manager', organization_id: ORG }
  let system = ''
  global.fetch = async (url, init) => {
    system = JSON.parse(init.body).messages[0].content
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ name: 'X', canvas_nodes: [], canvas_edges: [] }) } }] }))
  }
  try {
    await generate(ORG, 'A flow')
    assert.doesNotMatch(system, /priority/, 'tickets have no priority column')
    assert.match(system, /"ai_rag_node": data: \{ title, promptText: string \}/)
    assert.match(system, /Only edges leaving interactive_buttons, list_menu and condition_branch carry a sourceHandle/)
    assert.match(system, /Only use variables that exist at that step/)
  } finally {
    global.fetch = defaultFetch
    user = MANAGER
  }
})

// ── Round 2: saving drafts, retiring forms, keyword collisions, the list's counts and the simulator ──

test('Forms: a plain save never calls Meta; credential and network problems are reported, not 500s', async () => {
  reset()
  Object.assign(tables.whatsapp_native_flows[0], { flow_id_meta: 'meta-1', status: 'DRAFT' })
  let requests = 0
  global.fetch = async () => { requests++; return new Response(JSON.stringify({ id: 'meta-1', status: 'DRAFT' })) }
  try {
    const edited = structuredClone(tables.whatsapp_native_flows[0].screens)
    edited[0].title = 'Changed'
    const saved = await nativeIdRoute.PUT(json('/api/flows/native/form', 'PUT', { screens: edited }), params('form'))
    assert.equal(saved.status, 200)
    assert.equal((await saved.json()).validated, false)
    assert.equal(requests, 0, 'a plain save stays local')
    assert.equal(tables.whatsapp_native_flows[0].screens[0].title, 'Changed')
    // Without WhatsApp Cloud API credentials, validating is the caller's problem to fix
    tables.organizations[0].whatsapp_provider = 'twilio'
    const refused = await nativeIdRoute.PUT(json('/api/flows/native/form', 'PUT', { screens: edited, action: 'validate' }), params('form'))
    assert.equal(refused.status, 400)
    assert.match((await refused.json()).error, /Connect WhatsApp Cloud API in Settings/)
    assert.equal(requests, 0)
    // Meta unreachable while creating the remote draft: the draft is saved and the answer says so
    reset()
    const fresh = structuredClone(tables.whatsapp_native_flows[0].screens)
    fresh[0].title = 'Kept'
    global.fetch = async () => { throw new TypeError('fetch failed') }
    const down = await nativeIdRoute.PUT(json('/api/flows/native/form', 'PUT', { screens: fresh, action: 'validate' }), params('form'))
    assert.equal(down.status, 502)
    assert.match((await down.json()).error, /could not be reached/)
    assert.equal(tables.whatsapp_native_flows[0].screens[0].title, 'Kept')
    global.fetch = async () => { const error = new Error('The operation was aborted due to timeout'); error.name = 'TimeoutError'; throw error }
    const slow = await nativeIdRoute.PUT(json('/api/flows/native/form', 'PUT', { screens: fresh, action: 'validate' }), params('form'))
    assert.equal(slow.status, 504)
    assert.match((await slow.json()).error, /did not answer in time/)
  } finally { global.fetch = defaultFetch }
})

test('Forms: retiring a published form deprecates it on Meta, frees it for deletion, and spares the store\'s address form', async () => {
  reset()
  Object.assign(tables.whatsapp_native_flows[0], { flow_id_meta: 'meta-1', status: 'PUBLISHED' })
  const requests = []
  global.fetch = async (url, init) => { requests.push([init?.method || 'GET', url.split('/').slice(-2).join('/')]); return new Response(JSON.stringify({ success: true })) }
  try {
    const retired = await nativeIdRoute.PUT(json('/api/flows/native/form', 'PUT', { action: 'deprecate' }), params('form'))
    assert.equal(retired.status, 200)
    const body = await retired.json()
    assert.equal(body.flow.status, 'DEPRECATED')
    assert.equal(body.retired, true)
    assert.deepEqual(requests, [['POST', 'meta-1/deprecate']])
    assert.equal(tables.whatsapp_native_flows[0].status, 'DEPRECATED')
    // A retired form is frozen for good
    const edit = await nativeIdRoute.PUT(json('/api/flows/native/form', 'PUT', { screens: tables.whatsapp_native_flows[0].screens }), params('form'))
    assert.equal(edit.status, 409)
    assert.match((await edit.json()).error, /retired/)
    assert.equal((await nativeIdRoute.PUT(json('/api/flows/native/form', 'PUT', { action: 'publish', screens: tables.whatsapp_native_flows[0].screens }), params('form'))).status, 409)
    // ...but can be deleted here without asking Meta, unless a flow (even a paused one) still sends it
    tables.whatsapp_workflows[0].canvas_nodes = [{ id: 'f', type: 'native_flow_trigger', data: { native_flow_id: 'form' } }]
    tables.whatsapp_workflows[0].is_active = false
    const used = await nativeIdRoute.DELETE(get('/api/flows/native/form'), params('form'))
    assert.equal(used.status, 409)
    assert.match((await used.json()).error, /used by the flow "Workflow"\. Remove it from that flow/)
    assert.equal(tables.whatsapp_native_flows.length, 1)
    tables.whatsapp_workflows[0].canvas_nodes = []
    const deleted = await nativeIdRoute.DELETE(get('/api/flows/native/form'), params('form'))
    assert.equal(deleted.status, 200)
    assert.equal(requests.length, 1, 'Meta is not asked to delete a retired form')
    assert.equal(tables.whatsapp_native_flows.length, 0)
    // The store's delivery address form is Commerce's to change first
    reset()
    Object.assign(tables.whatsapp_native_flows[0], { flow_id_meta: 'meta-1', status: 'PUBLISHED' })
    tables.organizations[0].commerce_address_flow_id = 'meta-1'
    const guarded = await nativeIdRoute.PUT(json('/api/flows/native/form', 'PUT', { action: 'deprecate' }), params('form'))
    assert.equal(guarded.status, 409)
    assert.equal((await guarded.json()).error, "This form is the store's delivery address form; change it in Commerce → Store settings first")
    assert.equal(tables.whatsapp_native_flows[0].status, 'PUBLISHED')
    tables.whatsapp_native_flows[0].status = 'DEPRECATED'
    const guardedDelete = await nativeIdRoute.DELETE(get('/api/flows/native/form'), params('form'))
    assert.equal(guardedDelete.status, 409)
    assert.match((await guardedDelete.json()).error, /delivery address form/)
    assert.equal(tables.whatsapp_native_flows.length, 1)
    assert.equal(requests.length, 1)
    // Only a published form can be retired
    reset()
    const draft = await nativeIdRoute.PUT(json('/api/flows/native/form', 'PUT', { action: 'deprecate' }), params('form'))
    assert.equal(draft.status, 409)
    assert.match((await draft.json()).error, /Only a published form can be retired/)
  } finally { global.fetch = defaultFetch }
})

const workflowsRoute = require(path.join(PROJECT, 'app/api/flows/workflows/route.ts'))
const simulateRoute = require(path.join(PROJECT, 'app/api/flows/simulate/route.ts'))
const canvasNode = (id, type, data) => ({ id, type, position: { x: 0, y: 0 }, data })

test('Flows: going live is refused while another live flow starts on the same keyword', async () => {
  reset()
  const graph = (keywords) => ({ canvas_nodes: [canvasNode('t', 'trigger', { trigger_type: 'keyword', keywords, match_mode: 'contains' }), canvasNode('m', 'message', { body: 'Hello' })], canvas_edges: [{ id: 'e', source: 't', target: 'm' }] })
  tables.whatsapp_workflows = [
    { id: 'wf', organization_id: ORG, name: 'Pricing', is_active: false, ...graph(['hi', 'pricing']) },
    { id: 'other', organization_id: ORG, name: 'Support desk', is_active: true, ...graph(['Hi']) },
    { id: 'foreign', organization_id: OTHER_ORG, name: 'Elsewhere', is_active: true, ...graph(['pricing']) },
  ]
  const res = await workflowIdRoute.PUT(json('/api/flows/workflows/wf', 'PUT', { is_active: true }), params('wf'))
  assert.equal(res.status, 422)
  const body = await res.json()
  assert.equal(body.validationErrors.length, 1)
  assert.match(body.validationErrors[0], /The keyword "hi" already starts "Support desk"/)
  assert.equal(tables.whatsapp_workflows[0].is_active, false)
  // Pausing the other flow clears the way
  tables.whatsapp_workflows[1].is_active = false
  const ok = await workflowIdRoute.PUT(json('/api/flows/workflows/wf', 'PUT', { is_active: true }), params('wf'))
  assert.equal(ok.status, 200)
  assert.equal(tables.whatsapp_workflows[0].is_active, true)
})

test('Flows list: conversations in progress are counted in the database, per flow, within the last day', async () => {
  reset()
  const hoursAgo = (hours) => new Date(Date.now() - hours * 3600000).toISOString()
  tables.whatsapp_workflows = [
    { id: 'wf', organization_id: ORG, name: 'A', canvas_nodes: [], canvas_edges: [] },
    { id: 'wf2', organization_id: ORG, name: 'B', canvas_nodes: [], canvas_edges: [] },
  ]
  tables.flow_sessions = [
    { id: 's1', organization_id: ORG, workflow_id: 'wf', status: 'IN_PROGRESS', last_interaction_at: hoursAgo(1) },
    { id: 's2', organization_id: ORG, workflow_id: 'wf', status: 'PAUSED_RAG', last_interaction_at: hoursAgo(2) },
    { id: 's3', organization_id: ORG, workflow_id: 'wf', status: 'COMPLETED', last_interaction_at: hoursAgo(1) },
    { id: 's4', organization_id: ORG, workflow_id: 'wf', status: 'IN_PROGRESS', last_interaction_at: hoursAgo(30) },
    { id: 's5', organization_id: OTHER_ORG, workflow_id: 'wf', status: 'IN_PROGRESS', last_interaction_at: hoursAgo(1) },
    { id: 's6', organization_id: ORG, workflow_id: 'wf2', status: 'IN_PROGRESS', last_interaction_at: hoursAgo(1) },
  ]
  const res = await workflowsRoute.GET(get(`/api/flows/workflows?organizationId=${ORG}`))
  assert.equal(res.status, 200)
  const { workflows } = await res.json()
  assert.deepEqual(Object.fromEntries(workflows.map((w) => [w.id, w.active_sessions_count])), { wf: 2, wf2: 1 })
  const counts = calls.filter((c) => c.table === 'flow_sessions')
  assert.equal(counts.length, 2, 'one count per flow, never a read of every session row')
  assert.deepEqual(counts[0].ops.find(([op]) => op === 'select'), ['select', 'id', { count: 'exact', head: true }])
  assert.ok(counts[0].ops.some(([op, column, values]) => op === 'in' && column === 'status' && values.includes('PAUSED_RAG')))
  assert.ok(counts[0].ops.some(([op, column]) => op === 'gte' && column === 'last_interaction_at'))
  assert.ok(counts[0].ops.some(([op, column, value]) => op === 'eq' && column === 'organization_id' && value === ORG))
})

test('Simulator: reaching the knowledge assistant shows its prompt, with the organization name filled in; a final form is acknowledged', async () => {
  reset()
  const nodes = [canvasNode('t', 'trigger', { keywords: ['hi'] }), canvasNode('ai', 'ai_rag_node', { title: 'Assistant', promptText: 'Ask {{org.name}} anything, {{contact.name}}' })]
  const edges = [{ id: 'e', source: 't', target: 'ai' }]
  const res = await simulateRoute.POST(json('/api/flows/simulate', 'POST', { nodes, edges, organizationName: 'Acme' }))
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.reply, 'Ask Acme anything, Test Customer')
  assert.equal(body.isCompleted, false)
  assert.equal(body.currentNodeId, 'ai')
  // The next message is the question: live it goes to the assistant, and the test ends there
  const next = await (await simulateRoute.POST(json('/api/flows/simulate', 'POST', { nodes, edges, currentNodeId: 'ai', userInput: 'Do you ship?', simulatedState: body.simulatedState }))).json()
  assert.equal(next.isCompleted, true)
  assert.match(next.reply, /knowledge assistant answers/)
  // Without a name the placeholder still reads naturally
  assert.equal((await (await simulateRoute.POST(json('/api/flows/simulate', 'POST', { nodes, edges }))).json()).reply, 'Ask Your business anything, Test Customer')
  // A form as the last block is acknowledged in the test, as it is live
  const formNodes = [nodes[0], canvasNode('f', 'native_flow_trigger', { native_flow_id: 'form' })]
  const formEdges = [{ id: 'e', source: 't', target: 'f' }]
  const sent = await (await simulateRoute.POST(json('/api/flows/simulate', 'POST', { nodes: formNodes, edges: formEdges }))).json()
  assert.equal(sent.isNativeFlow, true)
  const done = await (await simulateRoute.POST(json('/api/flows/simulate', 'POST', { nodes: formNodes, edges: formEdges, currentNodeId: 'f', simulatedState: sent.simulatedState, flowSubmissionData: { full_name: 'Asha' } }))).json()
  assert.equal(done.reply, 'Thanks, we received your form.')
  assert.equal(done.isCompleted, true)
})
