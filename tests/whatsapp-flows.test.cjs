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
  const tables = { flow_sessions: [], flow_submissions: [], whatsapp_workflows: [workflow(baseNodes, baseEdges)], whatsapp_native_flows: [{ id: 'native', organization_id: 'org', status: 'PUBLISHED', flow_id_meta: '123456', flow_json: { screens: [{ id: 'LEAD_DETAILS' }] } }], pipeline_stages: [{ id: 'stage', organization_id: 'org', name: 'New Lead', position: 1 }], leads: [], tickets: [], conversations: [{ id: 'conversation', organization_id: 'org' }], users: [], flow_runtime_locks: [], ...seed }
  const rpc = async name => ({ data: name === 'acquire_flow_lock' ? true : null, error: null })
  const from = table => {
    let filters = [], op = 'select', values, singular = false, ignoreDuplicate = false
    const query = {
      select() { return this }, eq(key, value) { filters.push(row => row[key] === value); return this },
      in(key, values) { filters.push(row => values.includes(row[key])); return this },
      order() { return this }, limit() { return this }, maybeSingle() { singular = true; return this }, single() { singular = true; return this },
      insert(data) { op = 'insert'; values = Array.isArray(data) ? data : [data]; return this },
      upsert(data, options) { op = 'insert'; values = [data]; ignoreDuplicate = options.ignoreDuplicates; return this },
      update(data) { op = 'update'; values = data; return this }, delete() { op = 'delete'; return this },
      then(resolve, reject) {
        try {
          let rows = tables[table].filter(row => filters.every(filter => filter(row)))
          if (op === 'insert') {
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
  return { from, rpc, tables }
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
test('ordinary text and mismatched tokens never complete a waiting form', async () => {
  const db = database()
  await executeFlowRuntime(input, db)
  for (const [index, data] of [undefined, { flow_token: 'wrong', full_name: 'Attacker' }].entries()) {
    const result = await executeFlowRuntime({ ...input, messageId: `inbound-other-${index}`, flowSubmissionData: data }, db)
    assert.equal(result.actionTaken, 'waiting_for_form')
    assert.equal(db.tables.flow_submissions.length, 0)
    assert.equal(db.tables.leads.length, 0)
  }
})
test('cannot send a native form belonging to another organization', async () => {
  const db = database()
  db.tables.whatsapp_native_flows[0].organization_id = 'other-org'
  await assert.rejects(executeFlowRuntime(input, db), /Publish the selected form/)
  assert.equal(db.tables.flow_sessions[0].status, 'FAILED')
  assert.equal(db.tables.flow_sessions[0].current_node_id, 'form')
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
  assert.equal(interpolateVariables('{{constructor.name}}', {}), '{{constructor.name}}')
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
  await assert.rejects(executeFlowRuntime({ ...input, sendReply: async () => { throw new Error('Meta rejected delivery') } }, db), /Meta rejected delivery/)
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
  db.tables.flow_sessions.push({ ...structuredClone(current), id: 'superseded-session' })
  await executeFlowRuntime({ ...input, messageId: 'new-input', userInput: 'ordinary text' }, db)
  assert.equal(db.tables.flow_sessions[1].status, 'EXPIRED')
  assert.equal(db.tables.flow_sessions[0].status, 'IN_PROGRESS')
})
