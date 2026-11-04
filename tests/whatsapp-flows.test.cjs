require('./register-typescript.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { compileMetaFlowJSON, NATIVE_FLOW_TEMPLATES } = require('../lib/flows/meta-flows-spec.ts')
const { resolveReply, getNextNode, validateWorkflow, matchesTrigger, interpolateVariables } = require('../lib/flows/flow-graph.ts')
const { runFlow } = require('../lib/flows/flow-runner.ts')
const { buildWhatsAppFlowMessage } = require('../lib/flows/flow-messages.ts')
const { uploadNativeFlow, getMetaCredentials } = require('../lib/flows/meta-client.ts')
const { executeFlowRuntime } = require('../lib/flows/flow-executor.ts')

const node = (id, type, data = {}) => ({ id, type, data, position: { x: 0, y: 0 } })
const edge = (source, target, sourceHandle) => ({ id: `${source}-${target}`, source, target, sourceHandle })
const workflow = (nodes, edges) => ({ id: 'workflow', organization_id: 'org', name: 'Test workflow', canvas_nodes: nodes, canvas_edges: edges, trigger_type: 'keyword', trigger_config: {}, is_active: true, execution_count: 0 })
const baseNodes = [node('trigger', 'trigger', { keywords: ['hi'], trigger_type: 'keyword', match_mode: 'exact' }), node('intro', 'message', { body: 'Hello {{contact.name}}' }), node('form', 'native_flow_trigger', { native_flow_id: 'native' }), node('lead', 'crm_deal_action', { deal_name: '{{form.full_name}} enquiry', monetary_value: 100, pipeline_stage: 'lead_in' })]
const baseEdges = [edge('trigger', 'intro'), edge('intro', 'form'), edge('form', 'lead')]

for (const [key, template] of Object.entries(NATIVE_FLOW_TEMPLATES)) test(`compiles ${key} into Meta forms and terminal actions`, () => {
  const json = compileMetaFlowJSON(template.screens)
  assert.equal(json.version, '7.3')
  assert.equal(json.screens.filter(screen => screen.terminal).length, 1)
  for (const [index, screen] of json.screens.entries()) {
    const form = screen.layout.children[0]
    assert.equal(form.type, 'Form')
    const footer = form.children.at(-1)
    assert.equal(footer.type, 'Footer')
    assert.equal(footer['on-click-action'].name, index === json.screens.length - 1 ? 'complete' : 'navigate')
    for (const component of form.children) {
      assert.equal(component.id, undefined)
      assert.equal(component.options, undefined)
      assert.equal(component.type === 'TimePicker' || component.type === 'RadioGroup', false)
      if (component.type.startsWith('Text') && component.type !== 'TextInput' && component.type !== 'TextArea') assert.equal(typeof component.text, 'string')
    }
  }
})
test('carries typed answers across screens into the final submission', () => {
  const json = compileMetaFlowJSON(NATIVE_FLOW_TEMPLATES.LEAD_QUALIFICATION.screens)
  const first = json.screens[0].layout.children[0].children.at(-1)['on-click-action']
  assert.equal(first.payload.full_name, '${form.full_name}')
  const last = json.screens[1]
  assert.equal(last.data.opt_in.type, 'boolean')
  assert.equal(last.layout.children[0].children.at(-1)['on-click-action'].payload.full_name, '${data.full_name}')
})
test('rejects ambiguous field names instead of silently overwriting answers', () => {
  const screens = structuredClone(NATIVE_FLOW_TEMPLATES.LEAD_QUALIFICATION.screens)
  screens[1].layout.children.push({ type: 'TextInput', name: 'full_name', label: 'Name' })
  assert.throws(() => compileMetaFlowJSON(screens), /unique/)
})
test('builds the nested Meta flow message contract', () => {
  const message = buildWhatsAppFlowMessage('+1 555 123', { type: 'native_flow', body: 'Complete this form', flowPayload: { flow_id: '123456', flow_cta: 'Open Form', flow_token: 'random-session-token', flow_action: 'navigate', flow_action_payload: { screen: 'LEAD_DETAILS' } } })
  assert.equal(message.interactive.type, 'flow')
  assert.equal(message.interactive.action.name, 'flow')
  assert.equal(message.interactive.action.parameters.flow_message_version, '3')
  assert.equal(message.interactive.body.text, 'Complete this form')
  assert.equal(message.to, '1555123')
  assert.throws(() => buildWhatsAppFlowMessage('1', { type: 'native_flow', body: 'Form', flowPayload: { flow_id: 'local-uuid' } }), /Meta Flow ID/)
})
test('does not route an unknown reply to the first button branch', () => {
  const menu = node('menu', 'interactive_buttons', { body: 'Choose', buttons: [{ id: 'yes', title: 'Yes' }, { id: 'no', title: 'No' }] })
  const nodes = [menu, node('a', 'message'), node('b', 'message')]
  const edges = [edge('menu', 'a', 'yes'), edge('menu', 'b', 'no')]
  assert.equal(resolveReply(menu, nodes, edges, 'unrelated question').matched, false)
  assert.equal(resolveReply(menu, nodes, edges, 'No').next.id, 'b')
  assert.equal(resolveReply(menu, nodes, edges, 'Yes', 'stale-button').matched, false)
  assert.equal(getNextNode(nodes, edges, 'menu', 'unknown'), undefined)
})
test('keyword and first-message triggers are explicit', () => {
  const wf = workflow(baseNodes, baseEdges)
  assert.equal(matchesTrigger(wf, 'high'), false)
  assert.equal(matchesTrigger(wf, ' Hi '), true)
  wf.canvas_nodes = [node('trigger', 'trigger', { trigger_type: 'first_message' })]
  assert.equal(matchesTrigger(wf, 'hello', false), false)
  assert.equal(matchesTrigger(wf, 'hello', true), true)
})
test('rejects unsupported actions, unconnected choices and automatic cycles', () => {
  assert.match(validateWorkflow([baseNodes[0], node('x', 'delay_action')], [edge('trigger', 'x')]).join(), /not supported/)
  const nodes = [baseNodes[0], node('a', 'message', { body: 'A' }), node('b', 'message', { body: 'B' })]
  assert.match(validateWorkflow(nodes, [edge('trigger', 'a'), edge('a', 'b'), edge('b', 'a')]).join(), /loop/)
  const menu = node('m', 'interactive_buttons', { body: 'Menu', buttons: [{ id: 'one', title: 'One' }] })
  assert.match(validateWorkflow([baseNodes[0], menu], [edge('trigger', 'm')]).join(), /connect the "One"/)
})
test('chains welcome messages into the form in a single incoming turn', async () => {
  const sent = []
  const result = await runFlow(baseNodes, baseEdges, baseNodes[1], { contact: { name: 'Asha' } }, { send: async reply => sent.push(reply), nativeFlow: async () => ({ type: 'native_flow', body: 'Form' }), action: async () => { throw new Error('Must wait for submission') } })
  assert.deepEqual(sent.map(reply => reply.type), ['text', 'native_flow'])
  assert.equal(sent[0].body, 'Hello Asha')
  assert.equal(result.status, 'IN_PROGRESS')
  assert.equal(result.currentNodeId, 'form')
})
test('takes the false condition path and marks the terminal message completed', async () => {
  const nodes = [node('condition', 'condition_branch', { variable_name: 'form.budget', operator: 'greater_than', compare_value: '100' }), node('yes', 'message', { body: 'High' }), node('no', 'message', { body: 'Low' })]
  const result = await runFlow(nodes, [edge('condition', 'yes', 'true'), edge('condition', 'no', 'false')], nodes[0], { form: { budget: 50 } }, { send: async () => {}, nativeFlow: async () => {}, action: async () => ({}) })
  assert.equal(result.replies[0].body, 'Low')
  assert.equal(result.status, 'COMPLETED')
})
test('stops before CRM actions when delivery fails', async () => {
  let acted = false
  const nodes = [baseNodes[1], baseNodes[3]]
  await assert.rejects(runFlow(nodes, [edge('intro', 'lead')], nodes[0], {}, { send: async () => { throw new Error('Meta unavailable') }, nativeFlow: async () => {}, action: async () => { acted = true; return {} } }), /Meta unavailable/)
  assert.equal(acted, false)
})
test('checks Meta upload validation and saves the remote draft ID for retries', async () => {
  const events = []
  const credentials = { token: 'test', version: 'v25.0', businessAccountId: 'waba' }
  const fetcher = async (url, options) => {
    events.push(url.split('/').at(-1))
    assert.equal(options.headers.Authorization, 'Bearer test')
    if (url.endsWith('/flows')) return Response.json({ id: '123' })
    assert.equal(options.body.get('asset_type'), 'FLOW_JSON')
    return Response.json({ success: true, validation_errors: [{ message: 'Invalid component' }] })
  }
  await assert.rejects(uploadNativeFlow(credentials, { name: 'Form', categories: ['LEAD_GENERATION'] }, { version: '7.3', screens: [] }, async id => events.push(`saved:${id}`), fetcher), /Meta rejected/)
  assert.deepEqual(events, ['flows', 'saved:123', 'assets'])
})
test('refuses credentials from another tenant and published form edits', async () => {
  assert.throws(() => getMetaCredentials({ whatsapp_provider: 'facebook' }), /Settings/)
  let calls = 0
  await assert.rejects(uploadNativeFlow({ version: 'v25.0', token: 'test' }, { name: 'Form', categories: ['OTHER'], flow_id_meta: '123' }, {}, async () => {}, async () => { calls++; return Response.json({ status: 'PUBLISHED' }) }), /cannot be edited/)
  assert.equal(calls, 1)
})

// Small in-memory Supabase adapter. All filters are applied, so tenant-scoping
// regressions surface rather than being hidden behind fixed response stubs.
function database(seed = {}) {
  const tables = { flow_sessions: [], flow_submissions: [], whatsapp_workflows: [workflow(baseNodes, baseEdges)], whatsapp_native_flows: [{ id: 'native', organization_id: 'org', status: 'PUBLISHED', flow_id_meta: '123456', flow_json: { screens: [{ id: 'LEAD_DETAILS' }] } }], pipeline_stages: [{ id: 'stage', organization_id: 'org', name: 'New Lead', position: 1 }], leads: [], tickets: [], conversations: [{ id: 'conversation', organization_id: 'org' }], users: [], flow_runtime_locks: [],
    organizations: [{ id: 'org', whatsapp_provider: 'facebook', whatsapp_api_token: 'token', whatsapp_business_account_id: '1', whatsapp_phone_number_id: '2' }], ...seed }
  const rpc = async name => ({ data: name === 'acquire_flow_lock' ? true : null, error: null })
  // `state_data->>key` reads one JSON field, as PostgREST does
  const read = (row, column) => column.includes('->>') ? row[column.split('->>')[0]]?.[column.split('->>')[1]] : row[column]
  // rejectColumns: writes naming one of these fail like a column the migration has not added yet.
  // failUpsertWith: every upsert fails with this error, like a missing unique index.
  const db = { rpc, tables, rejectColumns: new Set(), failUpsertWith: null }
  db.from = table => {
    let filters = [], op = 'select', values, singular = false, ignoreDuplicate = false, sort = null, max = Infinity
    const query = {
      select() { return this }, eq(key, value) { filters.push(row => read(row, key) === value); return this },
      in(key, list) { filters.push(row => list.includes(read(row, key))); return this },
      not(key, operator, value) { filters.push(row => operator === 'is' && value === null ? read(row, key) != null : true); return this },
      order(key, options = {}) { sort = { key, ascending: options.ascending !== false }; return this }, limit(count) { max = count; return this },
      maybeSingle() { singular = true; return this }, single() { singular = true; return this },
      insert(data) { op = 'insert'; values = Array.isArray(data) ? data : [data]; return this },
      upsert(data, options) { op = 'upsert'; values = [data]; ignoreDuplicate = options.ignoreDuplicates; return this },
      update(data) { op = 'update'; values = data; return this }, delete() { op = 'delete'; return this },
      then(resolve, reject) {
        try {
          const written = op === 'update' ? [values] : op === 'insert' || op === 'upsert' ? values : []
          const missing = [...db.rejectColumns].find(column => written.some(value => column in value))
          if (missing) return Promise.resolve({ data: null, error: { code: 'PGRST204', message: `Could not find the '${missing}' column of '${table}' in the schema cache` } }).then(resolve, reject)
          if (op === 'upsert' && db.failUpsertWith) return Promise.resolve({ data: null, error: db.failUpsertWith }).then(resolve, reject)
          let rows = tables[table].filter(row => filters.every(filter => filter(row)))
          if (sort) {
            // Rows inserted later count as newer when timestamps tie, as they would in the database
            const direction = sort.ascending ? 1 : -1
            rows = rows.map((row, index) => ({ row, index })).sort((a, b) => {
              const left = read(a.row, sort.key), right = read(b.row, sort.key)
              return (left > right ? 1 : left < right ? -1 : 0) * direction || (a.index - b.index) * direction
            }).map(entry => entry.row)
          }
          rows = rows.slice(0, max)
          if (op === 'insert' || op === 'upsert') {
            rows = values.filter(value => !ignoreDuplicate || !tables[table].some(row => row.organization_id === value.organization_id && row.flow_token === value.flow_token)).map(value => ({ id: `${table}-${tables[table].length + 1}`, created_at: new Date().toISOString(), last_interaction_at: new Date().toISOString(), ...structuredClone(value) }))
            tables[table].push(...rows)
          } else if (op === 'update') rows.forEach(row => Object.assign(row, structuredClone(values)))
          else if (op === 'delete') tables[table] = tables[table].filter(row => !rows.includes(row))
          return Promise.resolve({ data: structuredClone(singular ? rows[0] || null : rows), error: null }).then(resolve, reject)
        } catch (error) { return Promise.reject(error).then(resolve, reject) }
      },
    }
    return query
  }
  return db
}
const input = { organizationId: 'org', conversationId: 'conversation', contactPhone: '+15550000000', userInput: 'hi', messageId: 'inbound-1', contactData: { contact: { id: 'contact', name: 'Asha' } } }

test('full runtime correlates form submission, persists answers and creates a contact-linked lead once', async () => {
  const db = database()
  const start = await executeFlowRuntime(input, db)
  assert.equal(start.replyMessages.length, 2)
  const session = db.tables.flow_sessions[0]
  const token = session.state_data._flow_token
  assert.equal(typeof token, 'string')
  assert.notEqual(token, 'token_configured_in_designer')
  const submit = { ...input, userInput: 'Submitted', messageId: 'inbound-2', flowSubmissionData: { flow_token: token, full_name: 'Asha', budget: 'tier_2' } }
  const done = await executeFlowRuntime(submit, db)
  assert.equal(done.handled, true)
  assert.equal(db.tables.flow_sessions[0].status, 'COMPLETED')
  assert.equal(db.tables.leads.length, 1)
  assert.equal(db.tables.leads[0].contact_id, 'contact')
  assert.equal(db.tables.leads[0].title, 'Asha enquiry')
  assert.equal(db.tables.leads[0].currency, undefined)
  assert.equal(db.tables.leads[0].pipeline_stage_id, 'stage')
  assert.equal(db.tables.flow_submissions[0].response_payload.budget, 'tier_2')
  assert.equal(db.tables.flow_submissions[0].lead_id, db.tables.leads[0].id)
  assert.equal(db.tables.conversations[0].lead_id, db.tables.leads[0].id)
  await executeFlowRuntime(submit, db)
  assert.equal(db.tables.leads.length, 1)
})
test('ordinary text never completes a waiting form; a form with another token is kept but does not advance it', async () => {
  const db = database()
  await executeFlowRuntime(input, db)
  const typed = await executeFlowRuntime({ ...input, messageId: 'inbound-text' }, db)
  assert.equal(typed.actionTaken, 'waiting_for_form')
  assert.equal(db.tables.flow_submissions.length, 0)
  const other = await executeFlowRuntime({ ...input, messageId: 'inbound-other', flowSubmissionData: { flow_token: 'wrong', full_name: 'Attacker' } }, db)
  assert.equal(other.actionTaken, 'saved_submission')
  assert.equal(other.replyMessage.body, 'Thanks, we received your form.')
  assert.equal(db.tables.flow_submissions.length, 1)
  assert.equal(db.tables.flow_submissions[0].session_id, undefined, 'not correlated with the running session')
  assert.equal(db.tables.leads.length, 0)
  assert.equal(db.tables.flow_sessions[0].status, 'IN_PROGRESS')
  assert.equal(db.tables.flow_sessions[0].current_node_id, 'form')
})
test('cannot send a native form belonging to another organization', async () => {
  const db = database()
  db.tables.whatsapp_native_flows[0].organization_id = 'other-org'
  const sent = []
  const result = await executeFlowRuntime({ ...input, sendReply: async reply => { sent.push(reply) } }, db)
  assert.equal(result.actionTaken, 'failed')
  assert.equal(db.tables.flow_sessions[0].status, 'FAILED')
  assert.equal(db.tables.flow_sessions[0].current_node_id, 'form')
  assert.match(db.tables.flow_sessions[0].state_data._last_error, /Publish the selected form/)
  // The customer is told instead of left waiting
  assert.match(sent.at(-1).body, /something went wrong/)
})
test('handles action-only workflows without a second chatbot reply', async () => {
  const db = database({ whatsapp_workflows: [workflow([baseNodes[0], node('ticket', 'ticket_action', { subject: 'Help' })], [edge('trigger', 'ticket')])] })
  const result = await executeFlowRuntime(input, db)
  assert.equal(result.handled, true)
  assert.equal(result.replyMessages.length, 0)
  assert.equal(db.tables.tickets[0].contact_id, 'contact')
  assert.equal(db.tables.tickets[0].priority, undefined)
  assert.equal(db.tables.flow_sessions[0].status, 'COMPLETED')
})
test('agent handoff disables automatic replies and completes the session', async () => {
  const db = database({ whatsapp_workflows: [workflow([baseNodes[0], node('handoff', 'assign_agent_action', { assignmentType: 'team_queue' })], [edge('trigger', 'handoff')])] })
  await executeFlowRuntime(input, db)
  assert.equal(db.tables.conversations[0].auto_reply_enabled, false)
  assert.equal(db.tables.flow_sessions[0].status, 'COMPLETED')
})
test('does not expose inherited state through template interpolation', () => {
  assert.equal(interpolateVariables('{{constructor.name}}', {}), '')
  assert.equal(interpolateVariables('{{__proto__.polluted}}', {}), '')
})

test('an expired session cannot consume a later customer message', async () => {
  const db = database()
  await executeFlowRuntime(input, db)
  db.tables.flow_sessions[0].last_interaction_at = '2000-01-01T00:00:00.000Z'
  const result = await executeFlowRuntime({ ...input, messageId: 'later', userInput: 'unmatched text' }, db)
  assert.equal(result.handled, false)
  assert.equal(db.tables.flow_sessions[0].status, 'EXPIRED')
})
test('list replies route by row ID and serialize as native WhatsApp lists', async () => {
  const menu = node('list', 'list_menu', { body: 'Choose a team', button_text: 'Teams', sections: [{ title: 'Teams', rows: [{ id: 'sales', title: 'Sales' }, { id: 'support', title: 'Support' }] }] })
  const nodes = [menu, node('sales', 'message'), node('support', 'message')]
  const edges = [edge('list', 'sales', 'sales'), edge('list', 'support', 'support')]
  assert.equal(resolveReply(menu, nodes, edges, 'Support', 'support').next.id, 'support')
  const result = await runFlow(nodes, edges, menu, {}, { send: async () => {}, nativeFlow: async () => {}, action: async () => ({}) })
  assert.equal(buildWhatsAppFlowMessage('123', result.replies[0]).interactive.action.sections[0].rows.length, 2)
})
test('two native forms in one session retain separate submissions and tokens', async () => {
  const second = node('second-form', 'native_flow_trigger', { native_flow_id: 'native' })
  const db = database({ whatsapp_workflows: [workflow([...baseNodes, second], [edge('trigger', 'intro'), edge('intro', 'form'), edge('form', 'second-form'), edge('second-form', 'lead')])] })
  await executeFlowRuntime(input, db)
  const firstToken = db.tables.flow_sessions[0].state_data._flow_token
  await executeFlowRuntime({ ...input, messageId: 'form-1', flowSubmissionData: { flow_token: firstToken, full_name: 'Asha' } }, db)
  const secondToken = db.tables.flow_sessions[0].state_data._flow_token
  assert.notEqual(firstToken, secondToken)
  await executeFlowRuntime({ ...input, messageId: 'form-2', flowSubmissionData: { flow_token: secondToken, full_name: 'Asha' } }, db)
  assert.equal(db.tables.flow_submissions.length, 2)
  assert.equal(db.tables.leads.length, 1)
})
test('a provider send error is visible on the session and not silently rerun on retry', async () => {
  const db = database()
  const failed = await executeFlowRuntime({ ...input, sendReply: async () => { throw new Error('Meta rejected delivery') } }, db)
  assert.equal(failed.actionTaken, 'failed')
  assert.equal(db.tables.flow_sessions[0].status, 'FAILED')
  assert.equal(db.tables.flow_sessions[0].state_data._last_error, 'Meta rejected delivery')
  const result = await executeFlowRuntime(input, db)
  assert.equal(result.actionTaken, 'duplicate_message')
  assert.equal(db.tables.flow_sessions.length, 1)
})
test('another worker holding the contact lock prevents simultaneous execution', async () => {
  const db = database()
  db.rpc = async () => ({ data: false, error: null })
  await assert.rejects(executeFlowRuntime(input, db), /being processed/)
  assert.equal(db.tables.flow_sessions.length, 0)
})

test('superseded legacy sessions cannot revive after the newest flow completes', async () => {
  const db = database()
  await executeFlowRuntime(input, db)
  const current = db.tables.flow_sessions[0]
  db.tables.flow_sessions.push({ ...structuredClone(current), id: 'superseded-session', created_at: '2020-01-01T00:00:00.000Z' })
  await executeFlowRuntime({ ...input, messageId: 'new-input', userInput: 'ordinary text' }, db)
  assert.equal(db.tables.flow_sessions[1].status, 'EXPIRED')
  assert.equal(db.tables.flow_sessions[0].status, 'IN_PROGRESS')
})

// ── Builder templates, generated graphs and the variable / tag blocks ──────────
const { createStarterWorkflow, createFormWorkflow, sanitizeWorkflowGraph, getTriggerSummary } = require('../lib/flows/flow-templates.ts')
const { setStateValue, getVariableNameError, SUPPORTED_NODE_TYPES } = require('../lib/flows/flow-graph.ts')

test('a new workflow starts from a canvas that can be activated as-is', () => {
  const starter = createStarterWorkflow()
  assert.deepEqual(validateWorkflow(starter.canvas_nodes, starter.canvas_edges), [])
  const withForm = createFormWorkflow({ id: 'native', name: 'Lead form' })
  assert.deepEqual(validateWorkflow(withForm.canvas_nodes, withForm.canvas_edges), [])
  for (const item of [...starter.canvas_nodes, ...withForm.canvas_nodes]) assert.ok(SUPPORTED_NODE_TYPES.includes(item.type), item.type)
})
test('generated graphs lose unsupported blocks and dangling connections, and keep one trigger', () => {
  const graph = sanitizeWorkflowGraph(
    [node('a', 'message', { body: 'Hello' }), node('wait', 'delay_action'), node('t1', 'trigger', { keywords: ['x'] }), node('t2', 'trigger'), { id: 'a', type: 'message' }, null, { type: 'message' }],
    [edge('t1', 'a'), edge('a', 'wait'), edge('a', 'missing'), edge('t1', 'a'), { source: 'a', target: 'a' }],
  )
  assert.deepEqual(graph.canvas_nodes.map(item => item.id), ['a', 't1'])
  assert.deepEqual(graph.canvas_edges.map(item => [item.source, item.target]), [['t1', 'a']])
  assert.deepEqual(validateWorkflow(graph.canvas_nodes, graph.canvas_edges), [])
})
test('a generated graph without a trigger gets one wired to its first step', () => {
  const graph = sanitizeWorkflowGraph([node('a', 'message', { body: 'Hello' })], [])
  assert.equal(graph.canvas_nodes[0].type, 'trigger')
  assert.deepEqual(validateWorkflow(graph.canvas_nodes, graph.canvas_edges), [])
})
test('the trigger summary mirrors the trigger node', () => {
  assert.deepEqual(getTriggerSummary([node('t', 'trigger', { trigger_type: 'keyword', keywords: [' Hi ', ''], match_mode: 'fuzzy' })]), { trigger_type: 'keyword', trigger_config: { keywords: ['Hi'], match_mode: 'contains' } })
  assert.deepEqual(getTriggerSummary([node('t', 'trigger', { trigger_type: 'first_message', keywords: ['old'] })]).trigger_config.keywords, [])
})
test('set variable stores typed, nested values without touching prototypes or engine state', async () => {
  const nodes = [node('score', 'set_variable', { variable_name: 'lead.score', value_expression: '42', value_type: 'number' }), node('tier', 'set_variable', { variable_name: 'tier', value_expression: '{{contact.name}}-vip' }), node('say', 'message', { body: 'Score {{lead.score}} for {{tier}}' })]
  const initial = { contact: { name: 'Asha' }, lead: { source: 'ad' } }
  const result = await runFlow(nodes, [edge('score', 'tier'), edge('tier', 'say')], nodes[0], initial, { send: async () => {}, nativeFlow: async () => {}, action: async () => ({}) })
  assert.equal(result.replies[0].body, 'Score 42 for Asha-vip')
  assert.deepEqual(result.state.lead, { source: 'ad', score: 42 })
  assert.deepEqual(initial.lead, { source: 'ad' }) // the caller's object is not mutated

  assert.throws(() => setStateValue({}, '__proto__.polluted', true), /Unsafe/)
  assert.equal({}.polluted, undefined)
  assert.match(getVariableNameError('contact.id'), /automatically/)
  assert.match(getVariableNameError('a.__proto__'), /letters|different/)
  assert.equal(getVariableNameError('lead.score'), null)
  assert.match(validateWorkflow([baseNodes[0], node('v', 'set_variable', { variable_name: 'contact.id' })], [edge('trigger', 'v')]).join(), /automatically/)
  await assert.rejects(runFlow([node('n', 'set_variable', { variable_name: 'count', value_expression: 'abc', value_type: 'number' })], [], node('n', 'set_variable', { variable_name: 'count', value_expression: 'abc', value_type: 'number' }), {}, { send: async () => {}, nativeFlow: async () => {}, action: async () => ({}) }), /not a number/)
})
test('tag blocks add and remove contact tags inside the organization only', async () => {
  const tagFlow = action => workflow([baseNodes[0], node('tag', 'tag_action', { action, tags: [' vip ', 'vip', 'lead-{{contact.name}}'] })], [edge('trigger', 'tag')])
  const contacts = [{ id: 'contact', organization_id: 'org', tags: ['existing'] }, { id: 'contact', organization_id: 'other-org', tags: ['untouched'] }]
  const db = database({ whatsapp_workflows: [tagFlow('add')], contacts })
  await executeFlowRuntime(input, db)
  assert.deepEqual(db.tables.contacts[0].tags, ['existing', 'vip', 'lead-Asha'])
  assert.deepEqual(db.tables.contacts[1].tags, ['untouched'])
  // A tag block is not a handoff: automation stays on
  assert.equal(db.tables.conversations[0].auto_reply_enabled, undefined)

  const removal = database({ whatsapp_workflows: [tagFlow('remove')], contacts: [{ id: 'contact', organization_id: 'org', tags: ['existing', 'vip'] }] })
  await executeFlowRuntime(input, removal)
  assert.deepEqual(removal.tables.contacts[0].tags, ['existing'])
  assert.match(validateWorkflow([baseNodes[0], node('tag', 'tag_action', { tags: [] })], [edge('trigger', 'tag')]).join(), /at least one tag/)
})
test('blocks without a runtime are rejected instead of silently handing the chat to an agent', async () => {
  for (const type of ['delay_action', 'webhook_action', 'notification_action']) {
    assert.match(validateWorkflow([baseNodes[0], node('x', type)], [edge('trigger', 'x')]).join(), /not supported/)
    await assert.rejects(runFlow([node('x', type)], [], node('x', type), {}, { send: async () => {}, nativeFlow: async () => {}, action: async () => ({}) }), /Unsupported workflow action/)
  }
})

// ── End-to-end review fixes ──────────────────────────────────────────────────
const { keywordMatches } = require('../lib/flows/flow-graph.ts')
const menuFlow = (buttons, extraNodes = [], extraEdges = []) => workflow(
  [node('trigger', 'trigger', { keywords: ['hi'], trigger_type: 'keyword' }), node('menu', 'interactive_buttons', { body: 'Choose', buttons }), ...extraNodes],
  [edge('trigger', 'menu'), ...extraEdges])

test('"contains" keywords match whole words, not parts of other words', () => {
  for (const text of ['Hi there', 'hi', 'HI!', 'namaste hi', 'hi, do you have books?']) assert.equal(keywordMatches(text, 'hi'), true, text)
  for (const text of ['Which size fits?', 'Do you ship to Delhi?', 'this', 'high price']) assert.equal(keywordMatches(text, 'hi'), false, text)
  assert.equal(keywordMatches('send me the price list', 'price list'), true)
  assert.equal(keywordMatches('నమస్తే అండి', 'నమస్తే'), true)
  assert.equal(keywordMatches('Which size?', 'hi', 'fuzzy'), true, 'fuzzy still matches anywhere')
  assert.equal(keywordMatches('hi there', 'hi', 'exact'), false)
})
test('flows nothing can trigger skip the lock and leave the message to the assistants', async () => {
  const db = database({ whatsapp_workflows: [] })
  let locked = false
  db.rpc = async () => { locked = true; return { data: true, error: null } }
  const result = await executeFlowRuntime(input, db)
  assert.equal(result.handled, false)
  assert.equal(locked, false)
})
test('a tapped "Cancel" button follows its own branch; a typed "cancel" still leaves the flow', async () => {
  const flow = menuFlow([{ id: 'confirm', title: 'Confirm' }, { id: 'cancel', title: 'Cancel' }],
    [node('ok', 'message', { body: 'Booked!' }), node('no', 'message', { body: 'No problem, booking cancelled.' })],
    [edge('menu', 'ok', 'confirm'), edge('menu', 'no', 'cancel')])
  let db = database({ whatsapp_workflows: [flow] })
  await executeFlowRuntime(input, db)
  let result = await executeFlowRuntime({ ...input, messageId: 'in-2', userInput: 'Cancel', buttonId: 'cancel' }, db)
  assert.equal(result.replyMessage.body, 'No problem, booking cancelled.')
  db = database({ whatsapp_workflows: [menuFlow([{ id: 'confirm', title: 'Confirm' }], [node('ok', 'message', { body: 'Booked!' })], [edge('menu', 'ok', 'confirm')])] })
  await executeFlowRuntime(input, db)
  result = await executeFlowRuntime({ ...input, messageId: 'in-2', userInput: 'cancel' }, db)
  assert.match(result.replyMessage.body, /cancelled/)
})
test('choosing "Ask a question" asks for the question, then the AI answers the next message', async () => {
  const flow = menuFlow([{ id: 'ask', title: 'Ask a question' }], [node('ai', 'ai_rag_node', { title: 'Assistant' })], [edge('menu', 'ai', 'ask')])
  const db = database({ whatsapp_workflows: [flow] })
  await executeFlowRuntime(input, db)
  const asked = await executeFlowRuntime({ ...input, messageId: 'in-2', userInput: 'Ask a question', buttonId: 'ask' }, db)
  assert.equal(asked.handled, true)
  assert.match(asked.replyMessage.body, /Type your question/)
  assert.equal(db.tables.flow_sessions[0].status, 'PAUSED_RAG')
  // "Which…" contains "hi" but is the question, not a new start
  const question = await executeFlowRuntime({ ...input, messageId: 'in-3', userInput: 'Which plan is cheapest?' }, db)
  assert.equal(question.handled, false)
  assert.equal(question.isRagFallback, true)
  assert.equal(db.tables.flow_sessions[0].status, 'COMPLETED')
})
test('form answers that arrive outside a running flow are saved under their form', async () => {
  const db = database()
  const result = await executeFlowRuntime({ ...input, userInput: '[form]', flowSubmissionData: { flow_token: 'campaign:c1:log9:123456', full_name: 'Ravi' } }, db)
  assert.equal(result.actionTaken, 'saved_submission')
  assert.equal(db.tables.flow_submissions.length, 1)
  assert.equal(db.tables.flow_submissions[0].flow_id, 'native')
  assert.equal(db.tables.flow_submissions[0].response_payload.full_name, 'Ravi')
  // The same submission redelivered is stored once
  await executeFlowRuntime({ ...input, userInput: '[form]', flowSubmissionData: { flow_token: 'campaign:c1:log9:123456', full_name: 'Ravi' } }, db)
  assert.equal(db.tables.flow_submissions.length, 1)
})
test('validation catches what WhatsApp would reject at send time, and blocks that never run', () => {
  const trigger = node('trigger', 'trigger', { keywords: ['hi'] })
  const titled = title => validateWorkflow([trigger, node('m', 'interactive_buttons', { body: 'Menu', buttons: [{ id: 'a', title }] }), node('x', 'message', { body: 'x' })], [edge('trigger', 'm'), edge('m', 'x', 'a')]).join()
  assert.match(titled('Hi {{name}}'), /can't contain \{\{variables\}\}/)
  assert.equal(titled('Yes'), '')
  const twins = validateWorkflow([trigger, node('m', 'interactive_buttons', { body: 'Menu', buttons: [{ id: 'a', title: 'Yes' }, { id: 'b', title: 'yes' }] }), node('x', 'message', { body: 'x' })], [edge('trigger', 'm'), edge('m', 'x', 'a'), edge('m', 'x', 'b')]).join()
  assert.match(twins, /titles must be different/)
  const list = node('l', 'list_menu', { body: 'Pick', sections: [{ title: '', rows: [{ id: 'r1', title: 'One', description: 'x'.repeat(73) }] }, { title: 'B', rows: [{ id: 'r2', title: 'Two' }] }] })
  const listIssues = validateWorkflow([trigger, list, node('x', 'message', { body: 'x' })], [edge('trigger', 'l'), edge('l', 'x', 'r1'), edge('l', 'x', 'r2')]).join()
  assert.match(listIssues, /at most 72 characters/)
  assert.match(listIssues, /every section a title/)
  const condition = node('c', 'condition_branch', { variableName: 'score', operator: 'is_set' })
  assert.match(validateWorkflow([trigger, condition, node('x', 'message', { body: 'x' })], [edge('trigger', 'c'), edge('c', 'x')]).join(), /"If it matches" branch/)
  assert.match(validateWorkflow([trigger, node('a', 'message', { body: 'A' }), node('lonely', 'message', { title: 'Lonely', body: 'B' })], [edge('trigger', 'a')]).join(), /Lonely: connect this block to the flow/)
})

// ── Production hardening: forms at the wrong step, broken live flows, limits, actions ──
const { getWorkflowReadiness } = require('../lib/flows/flow-readiness.ts')
const { fitReply } = require('../lib/flows/flow-runner.ts')
const { FlowLockBusyError } = require('../lib/flows/flow-executor.ts')
const adapter = { send: async () => {}, nativeFlow: async () => {}, action: async () => ({}) }

test('a form answered while the flow waits on a menu is saved and acknowledged without moving the flow', async () => {
  const flow = menuFlow([{ id: 'yes', title: 'Yes' }], [node('ok', 'message', { body: 'Great' })], [edge('menu', 'ok', 'yes')])
  const db = database({ whatsapp_workflows: [flow] })
  await executeFlowRuntime(input, db)
  const sent = []
  const result = await executeFlowRuntime({ ...input, messageId: 'form-1', userInput: '[form]', flowSubmissionData: { flow_token: 'campaign:c1:log9:123456', full_name: 'Ravi' }, sendReply: async reply => { sent.push(reply) } }, db)
  assert.equal(result.handled, true)
  assert.equal(result.actionTaken, 'saved_submission')
  assert.equal(sent[0].body, 'Thanks, we received your form.')
  assert.equal(db.tables.flow_submissions.length, 1)
  assert.equal(db.tables.flow_submissions[0].flow_id, 'native')
  assert.equal(db.tables.flow_submissions[0].response_payload.full_name, 'Ravi')
  assert.equal(db.tables.flow_sessions[0].status, 'IN_PROGRESS')
  assert.equal(db.tables.flow_sessions[0].current_node_id, 'menu')
  // The same delivery again is a duplicate, and the menu still works afterwards
  assert.equal((await executeFlowRuntime({ ...input, messageId: 'form-1', flowSubmissionData: { flow_token: 'campaign:c1:log9:123456' } }, db)).actionTaken, 'duplicate_message')
  const chosen = await executeFlowRuntime({ ...input, messageId: 'in-3', userInput: 'Yes', buttonId: 'yes' }, db)
  assert.equal(chosen.replyMessage.body, 'Great')
})
test('a form answered while the assistant waits for a question is saved, and the question still goes to the AI', async () => {
  const flow = menuFlow([{ id: 'ask', title: 'Ask a question' }], [node('ai', 'ai_rag_node', { title: 'Assistant' })], [edge('menu', 'ai', 'ask')])
  const db = database({ whatsapp_workflows: [flow] })
  await executeFlowRuntime(input, db)
  await executeFlowRuntime({ ...input, messageId: 'in-2', userInput: 'Ask a question', buttonId: 'ask' }, db)
  const result = await executeFlowRuntime({ ...input, messageId: 'form-1', userInput: '[form]', flowSubmissionData: { flow_token: 'tok-1', full_name: 'Ravi' } }, db)
  assert.equal(result.handled, true)
  assert.equal(result.replyMessage.body, 'Thanks, we received your form.')
  assert.equal(db.tables.flow_submissions.length, 1)
  assert.equal(db.tables.flow_sessions[0].status, 'PAUSED_RAG')
  const question = await executeFlowRuntime({ ...input, messageId: 'in-4', userInput: 'Which plan is cheapest?' }, db)
  assert.equal(question.handled, false)
  assert.equal(question.isRagFallback, true)
  assert.equal(db.tables.flow_sessions[0].status, 'COMPLETED')
})
test('a live flow that no longer passes validation is paused with the reason, and the message goes to the assistants', async () => {
  const broken = () => workflow([node('trigger', 'trigger', { keywords: ['hi'], trigger_type: 'keyword' }), node('menu', 'interactive_buttons', { body: 'Menu', buttons: [{ id: 'one', title: 'One' }] })], [edge('trigger', 'menu')])
  const db = database({ whatsapp_workflows: [broken()] })
  const errors = []
  const error = console.error
  console.error = message => errors.push(String(message))
  try {
    const result = await executeFlowRuntime(input, db)
    assert.equal(result.handled, false)
    assert.equal(db.tables.whatsapp_workflows[0].is_active, false)
    assert.match(db.tables.whatsapp_workflows[0].paused_reason, /connect the "One" choice/)
    assert.equal(typeof db.tables.whatsapp_workflows[0].paused_at, 'string')
    assert.equal(db.tables.flow_sessions.length, 0)
    assert.equal(errors.filter(message => /paused/.test(message)).length, 1)
    // The next message finds no live flow and is not logged again
    assert.equal((await executeFlowRuntime({ ...input, messageId: 'in-2' }, db)).handled, false)
    assert.equal(errors.length, 1)
  } finally { console.error = error }
  // Before migration 20261104 adds the columns, the flow is still paused
  const legacy = database({ whatsapp_workflows: [broken()] })
  legacy.rejectColumns.add('paused_reason')
  console.error = () => {}
  try { assert.equal((await executeFlowRuntime(input, legacy)).handled, false) } finally { console.error = error }
  assert.equal(legacy.tables.whatsapp_workflows[0].is_active, false)
  assert.equal(legacy.tables.whatsapp_workflows[0].paused_reason, undefined)
})
test('only lock contention is an exception; data problems fail the run visibly', async () => {
  const busy = database()
  busy.rpc = async () => ({ data: false, error: null })
  await assert.rejects(executeFlowRuntime(input, busy), error => error instanceof FlowLockBusyError && error.name === 'FlowLockBusyError')
  // A trigger saved with malformed keywords neither matches nor throws
  const malformed = workflow([node('trigger', 'trigger', { keywords: 'hi', trigger_type: 'keyword' }), node('m', 'message', { body: 'x' })], [edge('trigger', 'm')])
  assert.equal((await executeFlowRuntime(input, database({ whatsapp_workflows: [malformed] }))).handled, false)
  // A session whose step was edited away is expired, and the message starts afresh
  const db = database()
  await executeFlowRuntime(input, db)
  db.tables.flow_sessions[0].current_node_id = 'gone'
  const restarted = await executeFlowRuntime({ ...input, messageId: 'in-2' }, db)
  assert.equal(db.tables.flow_sessions[0].status, 'EXPIRED')
  assert.equal(restarted.handled, true)
  assert.equal(db.tables.flow_sessions.length, 2)
  // A delivery failure while re-prompting ends the run as FAILED instead of failing the webhook
  const menu = database({ whatsapp_workflows: [menuFlow([{ id: 'yes', title: 'Yes' }], [node('ok', 'message', { body: 'ok' })], [edge('menu', 'ok', 'yes')])] })
  await executeFlowRuntime(input, menu)
  const failed = await executeFlowRuntime({ ...input, messageId: 'in-2', userInput: 'what?', sendReply: async () => { throw new Error('Meta down') } }, menu)
  assert.equal(failed.actionTaken, 'failed')
  assert.equal(menu.tables.flow_sessions[0].status, 'FAILED')
  assert.equal(menu.tables.flow_sessions[0].state_data._last_error, 'Meta down')
})
test('runs before the v32 lease function and submission columns exist', async () => {
  const db = database()
  db.rpc = async name => ({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache` } })
  const warn = console.warn
  const warnings = []
  console.warn = message => warnings.push(String(message))
  try {
    assert.equal((await executeFlowRuntime(input, db)).handled, true)
    assert.equal(db.tables.whatsapp_workflows[0].execution_count, 1)
    await executeFlowRuntime({ ...input, messageId: 'in-2', userInput: 'cancel' }, db)
  } finally { console.warn = warn }
  assert.equal(warnings.filter(message => /acquire_flow_lock/.test(message)).length, 1, 'warned once, not per message')
  // Without the token column the answers are still kept; without the unique index they are still kept once
  const legacy = database()
  legacy.rejectColumns.add('flow_token')
  const form = { ...input, userInput: '[form]', flowSubmissionData: { flow_token: 'campaign:c1:log9:123456', full_name: 'Ravi' } }
  assert.equal((await executeFlowRuntime(form, legacy)).actionTaken, 'saved_submission')
  assert.equal(legacy.tables.flow_submissions[0].flow_token, undefined)
  assert.equal(legacy.tables.flow_submissions[0].response_payload.full_name, 'Ravi')
  const unindexed = database()
  unindexed.failUpsertWith = { code: '42P10', message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' }
  await executeFlowRuntime(form, unindexed)
  await executeFlowRuntime({ ...form, messageId: 'form-again' }, unindexed)
  assert.equal(unindexed.tables.flow_submissions.length, 1)
})
test('a run stops at the step cap and the time budget', async () => {
  const chain = Array.from({ length: 51 }, (_, index) => node(`m${index}`, 'message', { body: `Step ${index}` }))
  const links = chain.slice(1).map((item, index) => edge(`m${index}`, item.id))
  await assert.rejects(runFlow(chain, links, chain[0], {}, adapter), /50 automatic steps/)
  const realNow = Date.now
  let clock = realNow()
  Date.now = () => clock
  try {
    await assert.rejects(runFlow(chain.slice(0, 3), links.slice(0, 2), chain[0], {}, { ...adapter, send: async () => { clock += 60000 } }), /time limit/)
  } finally { Date.now = realNow }
})
test('missing variables render as nothing and structured values read naturally', async () => {
  assert.equal(interpolateVariables('Hi {{contact.name}}, budget {{form.budget}}', { contact: {} }), 'Hi , budget ')
  assert.equal(interpolateVariables('{{form.extras}} / {{form.address}} / {{count}}', { form: { extras: ['Install', 'Training'], address: { city: 'Pune' } }, count: 0 }), 'Install, Training / {"city":"Pune"} / 0')
  assert.equal(interpolateVariables(undefined, {}), '')
  // A message that is only a missing variable is skipped rather than sent empty
  const nodes = [node('a', 'message', { body: '{{nothing}}' }), node('b', 'message', { body: 'Next' })]
  const result = await runFlow(nodes, [edge('a', 'b')], nodes[0], {}, adapter)
  assert.deepEqual(result.replies.map(reply => reply.body), ['Next'])
  assert.equal(result.status, 'COMPLETED')
})
test('lists beyond WhatsApp limits are refused at activation and trimmed at run time', async () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({ id: `r${index}`, title: `Option number ${index} with a very long title` }))
  const list = node('l', 'list_menu', { body: 'Pick', button_text: 'A rather long button label', sections: [{ title: 'A section title that is too long', rows }, { title: 'Empty', rows: [] }] })
  const targets = rows.map(row => node(`t-${row.id}`, 'message', { body: 'ok' }))
  const links = rows.map(row => edge('l', `t-${row.id}`, row.id))
  const issues = validateWorkflow([baseNodes[0], list, ...targets], [edge('trigger', 'l'), ...links]).join()
  assert.match(issues, /between 1 and 10 choices/)
  assert.match(issues, /at least one option/)
  assert.match(issues, /button label must be at most 20/)
  const result = await runFlow([list, ...targets], links, list, {}, adapter)
  const reply = result.replies[0]
  assert.equal(reply.sections.length, 1)
  assert.equal(reply.sections[0].rows.length, 10)
  assert.ok(reply.sections[0].rows.every(row => row.title.length <= 24))
  assert.equal(reply.sections[0].title.length, 24)
  assert.equal(reply.buttonText.length, 20)
  assert.equal(buildWhatsAppFlowMessage('123', reply).interactive.action.sections[0].rows.length, 10)
  const buttons = fitReply({ type: 'interactive_buttons', body: 'x'.repeat(2000), buttons: [1, 2, 3, 4].map(index => ({ id: `b${index}`, title: `Button ${index} with a long title` })) })
  assert.equal(buttons.buttons.length, 3)
  assert.ok(buttons.buttons.every(button => button.title.length === 20))
  assert.equal(buttons.body.length, 1024)
  assert.equal(fitReply({ type: 'text', body: '😀'.repeat(5000) }).body.length, 4096 * 2, 'cut between characters, never inside one')
})
test('conditions compare amounts as numbers and words as text', async () => {
  const branch = async (operator, compare_value, state) => {
    const nodes = [node('c', 'condition_branch', { variable_name: 'answer', operator, compare_value }), node('yes', 'message', { body: 'yes' }), node('no', 'message', { body: 'no' })]
    const result = await runFlow(nodes, [edge('c', 'yes', 'true'), edge('c', 'no', 'false')], nodes[0], state, adapter)
    return result.replies[0].body
  }
  assert.equal(await branch('greater_than', '9', { answer: '10' }), 'yes')
  assert.equal(await branch('less_than', '10', { answer: 9 }), 'yes')
  assert.equal(await branch('equals', '10', { answer: '10.0' }), 'yes')
  assert.equal(await branch('not_equals', '10', { answer: 10 }), 'no')
  assert.equal(await branch('greater_than', '5', { answer: 'abc' }), 'no')
  assert.equal(await branch('greater_than', '5', {}), 'no')
  assert.equal(await branch('equals', 'Pro', { answer: 'pro' }), 'no')
  assert.equal(await branch('contains', 'pro', { answer: 'Pro plan' }), 'yes')
  assert.equal(await branch('is_set', '', { answer: 0 }), 'yes')
})
test('tag blocks merge case-insensitively without duplicates or losing existing tags', async () => {
  const flow = (action, tags) => workflow([baseNodes[0], node('tag', 'tag_action', { action, tags })], [edge('trigger', 'tag')])
  const db = database({ whatsapp_workflows: [flow('add', ['vip', 'New', 'hot', 'hot'])], contacts: [{ id: 'contact', organization_id: 'org', tags: ['VIP', ' new ', 'kept'] }, { id: 'contact', organization_id: 'other-org', tags: ['VIP'] }] })
  await executeFlowRuntime(input, db)
  assert.deepEqual(db.tables.contacts[0].tags, ['VIP', 'new', 'kept', 'hot'])
  assert.deepEqual(db.tables.contacts[1].tags, ['VIP'])
  const removal = database({ whatsapp_workflows: [flow('remove', ['vip'])], contacts: [{ id: 'contact', organization_id: 'org', tags: ['VIP', 'kept'] }] })
  await executeFlowRuntime(input, removal)
  assert.deepEqual(removal.tables.contacts[0].tags, ['kept'])
})
test('tickets and leads are inserted the way their tables expect', async () => {
  const ticketFlow = workflow([baseNodes[0], node('ticket', 'ticket_action', { subject: 'Help for {{contact.name}}', priority: 'high' })], [edge('trigger', 'ticket')])
  let db = database({ whatsapp_workflows: [ticketFlow] })
  await executeFlowRuntime(input, db)
  const ticket = db.tables.tickets[0]
  assert.equal(ticket.status, 'open')
  assert.equal(ticket.conversation_id, 'conversation')
  assert.equal(ticket.contact_id, 'contact')
  assert.equal(ticket.subject, 'Help for Asha')
  assert.equal(ticket.priority, undefined)
  // Without a conversation the ticket row would be refused: the run fails visibly instead
  db = database({ whatsapp_workflows: [ticketFlow] })
  const noConversation = await executeFlowRuntime({ ...input, conversationId: undefined }, db)
  assert.equal(noConversation.actionTaken, 'failed')
  assert.match(db.tables.flow_sessions[0].state_data._last_error, /conversation is required/)
  assert.equal(db.tables.tickets.length, 0)
  // Leads land in this organization's first stage by position, with a numeric value
  const leadFlow = workflow([baseNodes[0], node('lead', 'crm_deal_action', { deal_name: 'Quote for {{contact.name}}', monetary_value: '{{budget}}' })], [edge('trigger', 'lead')])
  db = database({ whatsapp_workflows: [leadFlow], pipeline_stages: [{ id: 'later', organization_id: 'org', name: 'Qualified', position: 2 }, { id: 'first', organization_id: 'org', name: 'New', position: 1 }, { id: 'foreign', organization_id: 'other-org', name: 'New', position: 0 }] })
  await executeFlowRuntime({ ...input, contactData: { ...input.contactData, budget: '2500' } }, db)
  assert.equal(db.tables.leads[0].pipeline_stage_id, 'first')
  assert.equal(db.tables.leads[0].value, 2500)
  assert.equal(db.tables.leads[0].status, 'active')
  assert.equal(db.tables.leads[0].title, 'Quote for Asha')
  assert.equal(db.tables.leads[0].priority, undefined)
})
test('round-robin hand-off takes turns through the teammates who can work conversations', async () => {
  const users = [
    { id: 'u-viewer', organization_id: 'org', role: 'sales_employee', read_only: true, created_at: '2026-01-01' },
    { id: 'u-asha', organization_id: 'org', role: 'sales_employee', created_at: '2026-01-02' },
    { id: 'u-ben', organization_id: 'org', role: 'org_manager', created_at: '2026-01-03' },
    { id: 'u-other', organization_id: 'other-org', role: 'org_admin', created_at: '2026-01-04' },
  ]
  const flow = workflow([baseNodes[0], node('handoff', 'assign_agent_action', { assignmentType: 'round_robin' })], [edge('trigger', 'handoff')])
  const db = database({ whatsapp_workflows: [flow], users, conversations: ['c1', 'c2', 'c3'].map(id => ({ id, organization_id: 'org' })) })
  for (const [index, id] of ['c1', 'c2', 'c3'].entries()) {
    const result = await executeFlowRuntime({ ...input, conversationId: id, contactPhone: `+1555000000${index}`, messageId: `m-${index}` }, db)
    assert.equal(result.handled, true)
  }
  assert.deepEqual(db.tables.conversations.map(conversation => conversation.assigned_to), ['u-asha', 'u-ben', 'u-asha'])
  assert.ok(db.tables.conversations.every(conversation => conversation.auto_reply_enabled === false))
  assert.equal(db.tables.flow_sessions[0].state_data._round_robin_user, 'u-asha')
  assert.equal((await getWorkflowReadiness(db, flow)).length, 0)
  // Nobody can take the chat: it still reaches the shared queue, and activation says why
  const empty = database({ whatsapp_workflows: [flow], users: [users[0], users[3]] })
  await executeFlowRuntime(input, empty)
  assert.equal(empty.tables.conversations[0].assigned_to, null)
  assert.equal(empty.tables.conversations[0].auto_reply_enabled, false)
  assert.match((await getWorkflowReadiness(empty, flow)).join(), /add a teammate/)
  assert.match(validateWorkflow([baseNodes[0], node('h', 'assign_agent_action', { assignmentType: 'random' })], [edge('trigger', 'h')]).join(), /team queue, round-robin or a specific agent/)
})
test('activation checks refuse unpublished or foreign forms, unconnected options and unsupported blocks', async () => {
  const db = database({ whatsapp_native_flows: [
    { id: 'native', organization_id: 'org', status: 'DRAFT', flow_id_meta: null, flow_json: { screens: [] } },
    { id: 'foreign', organization_id: 'other-org', status: 'PUBLISHED', flow_id_meta: '9', flow_json: { screens: [] } },
    { id: 'odd', organization_id: 'org', status: 'PUBLISHED', flow_id_meta: 'local-uuid', flow_json: { screens: [] } },
  ] })
  const check = (nodes, edges) => getWorkflowReadiness(db, workflow(nodes, edges))
  assert.match((await check(baseNodes, baseEdges)).join(), /publish the selected form/)
  assert.match((await check([baseNodes[0], node('f', 'native_flow_trigger', { native_flow_id: 'foreign' })], [edge('trigger', 'f')])).join(), /belongs to this organization/)
  assert.match((await check([baseNodes[0], node('f', 'native_flow_trigger', { native_flow_id: 'odd' })], [edge('trigger', 'f')])).join(), /Meta Flow ID/)
  const menu = node('m', 'interactive_buttons', { body: 'Menu', buttons: [{ id: 'one', title: 'One' }, { id: 'two', title: 'Two' }] })
  assert.match((await check([baseNodes[0], menu, node('x', 'message', { body: 'x' })], [edge('trigger', 'm'), edge('m', 'x', 'one')])).join(), /connect the "Two" choice/)
  const list = node('l', 'list_menu', { body: 'Pick', sections: [{ title: 'A', rows: [{ id: 'r1', title: 'One' }, { id: 'r2', title: 'Two' }] }] })
  assert.match((await check([baseNodes[0], list, node('x', 'message', { body: 'x' })], [edge('trigger', 'l'), edge('l', 'x', 'r1')])).join(), /connect the "Two" choice/)
  for (const type of ['delay_action', 'webhook_action', 'notification_action']) assert.match((await check([baseNodes[0], node('u', type)], [edge('trigger', 'u')])).join(), /not supported/)
  // With everything in place the flow can go live
  db.tables.whatsapp_native_flows[0] = { id: 'native', organization_id: 'org', status: 'PUBLISHED', flow_id_meta: '123456', flow_json: { screens: [{ id: 'LEAD_DETAILS' }] } }
  assert.deepEqual(await check(baseNodes, baseEdges), [])
})
