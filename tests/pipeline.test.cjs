require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const { salonDb } = require('./salon-fake-db.cjs')

const R = require('../lib/pipeline/rules.ts')
const S = require('../lib/pipeline/store.ts')
const { withPipelineSchema, isMissingPipelineSchema, PIPELINE_SQL } = require('../lib/pipeline/schema.ts')
const C = require('../lib/connectors.ts')

const ORG = 'c0ffee00-0000-4000-8000-0000000000aa'
const OTHER = 'c0ffee00-0000-4000-8000-0000000000bb'
const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const RAVI = 'bbbbbbbb-0000-4000-8000-000000000002'
const STAGE = (n) => `5ea9e000-0000-4000-8000-00000000000${n}`
// Monday 9 Nov 2026, 11:00 India time
const NOW = Date.parse('2026-11-09T11:00:00+05:30')

// ── Money ───────────────────────────────────────────────────────────────────

test('Money: rupees with Indian grouping, and lakh / crore in short form; other currencies too', () => {
  assert.equal(R.formatMoney(1250000), '₹12,50,000')
  assert.equal(R.formatMoney('85000.4'), '₹85,000')
  assert.equal(R.formatMoney(null), '₹0')
  assert.equal(R.formatMoney(1250000, 'INR', true), '₹12.5 L')
  assert.equal(R.formatMoney(33000000, 'INR', true), '₹3.3 Cr')
  assert.equal(R.formatMoney(42000, 'INR', true), '₹42K')
  assert.equal(R.formatMoney(950, 'INR', true), '₹950')
  assert.equal(R.formatMoney(100000, 'inr', true), '₹1 L')
  assert.equal(R.formatMoney(1500, 'USD'), '$1,500')
  assert.match(R.formatMoney(1500, 'XYZ'), /1,500/)
})

// ── A deal sent to the server ───────────────────────────────────────────────

test('Deal input: a name is needed; amounts may carry ₹ and commas; dates, priority and owner are checked', () => {
  assert.equal(R.parseLeadInput({}).field, 'title')
  const ok = R.parseLeadInput({ title: '  500   shirts ', value: '₹2,40,000', priority: 'high', source: 'Walk In', expected_close_date: '2026-12-01', next_follow_up_at: '2026-11-10T10:30:00+05:30', assigned_to: '' })
  assert.deepEqual(ok.value, { title: '500 shirts', value: 240000, priority: 'high', source: 'walk_in', expected_close_date: '2026-12-01', next_follow_up_at: '2026-11-10T05:00:00.000Z', assigned_to: null })
  assert.equal(R.parseLeadInput({ title: 'x', value: 'lots' }).field, 'value')
  assert.equal(R.parseLeadInput({ title: 'x', value: -5 }).field, 'value')
  assert.equal(R.parseLeadInput({ title: 'x', priority: 'urgent' }).field, 'priority')
  assert.equal(R.parseLeadInput({ title: 'x', expected_close_date: '01/12/2026' }).field, 'expected_close_date')
  assert.equal(R.parseLeadInput({ title: 'x', next_follow_up_at: 'someday' }).field, 'next_follow_up_at')
  assert.equal(R.parseLeadInput({ title: 'x', pipeline_stage_id: 'stage-1' }).field, 'pipeline_stage_id')
  assert.equal(R.parseLeadInput({ title: 'x', assigned_to: 'bob' }).field, 'assigned_to')
  // Only what is sent changes
  assert.deepEqual(R.parseLeadInput({ value: '' }, true).value, { value: null })
  assert.deepEqual(R.parseLeadInput({ next_follow_up_at: null }, true).value, { next_follow_up_at: null })
  assert.deepEqual(R.parseLeadInput({}, true).value, {})
})

// ── Follow-ups ──────────────────────────────────────────────────────────────

test('Follow-ups: overdue, today, tomorrow, later or none, by India days', () => {
  assert.equal(R.followUpState(null, NOW), 'none')
  assert.equal(R.followUpState('garbage', NOW), 'none')
  assert.equal(R.followUpState('2026-11-08T18:00:00+05:30', NOW), 'overdue')
  assert.equal(R.followUpState('2026-11-09T10:30:00+05:30', NOW), 'today') // half an hour ago still counts as today
  assert.equal(R.followUpState('2026-11-09T09:00:00+05:30', NOW), 'overdue') // two hours ago
  assert.equal(R.followUpState('2026-11-09T18:00:00+05:30', NOW), 'today')
  assert.equal(R.followUpState('2026-11-10T00:15:00+05:30', NOW), 'tomorrow')
  assert.equal(R.followUpState('2026-11-12T10:30:00+05:30', NOW), 'later')
})

test('Follow-up choices: later today rounds to the half hour; others are 10:30 am India time', () => {
  assert.equal(R.followUpPreset('today', NOW), '2026-11-09T07:30:00.000Z') // 1:00 pm IST
  assert.equal(R.followUpPreset('tomorrow', NOW), '2026-11-10T05:00:00.000Z')
  assert.equal(R.followUpPreset('3days', NOW), '2026-11-12T05:00:00.000Z')
  assert.equal(R.followUpPreset('week', NOW), '2026-11-16T05:00:00.000Z')
  assert.equal(R.followUpPreset('today', Date.parse('2026-11-09T11:10:00+05:30')), '2026-11-09T08:00:00.000Z') // 1:30 pm
})

// ── Board ───────────────────────────────────────────────────────────────────

const stages = [{ id: STAGE(2), name: 'Contacted', position: 2 }, { id: STAGE(1), name: 'New lead', position: 1 }]
const lead = (over) => ({ id: over.id || String(Math.random()), title: 'Deal', value: 0, status: 'active', pipeline_stage_id: STAGE(1), created_at: '2026-11-01T00:00:00Z', ...over })

test('Board: stages in order, open deals only, unknown stages in the first column, due follow-ups first', () => {
  const columns = R.boardColumns([
    lead({ id: 'a', value: 1000 }),
    lead({ id: 'b', value: 90000 }),
    lead({ id: 'c', value: 500, next_follow_up_at: new Date(Date.now() - 2 * 86400e3).toISOString() }),
    lead({ id: 'd', value: 5000, pipeline_stage_id: STAGE(2) }),
    lead({ id: 'e', value: 7000, pipeline_stage_id: 'gone' }),
    lead({ id: 'f', value: 9999, status: 'won' }),
  ], stages)
  assert.deepEqual(columns.map((c) => c.stage.name), ['New lead', 'Contacted'])
  assert.deepEqual(columns[0].leads.map((l) => l.id), ['c', 'b', 'e', 'a'])
  assert.equal(columns[0].total, 98500)
  assert.deepEqual(columns[1].leads.map((l) => l.id), ['d'])
  assert.deepEqual(R.boardColumns([lead({})], []), [])
})

// ── Reports ─────────────────────────────────────────────────────────────────

test('Reports: open pipeline now; created, won and lost in the range; by source, by person and why lost', () => {
  const range = { start: '2026-11-01T00:00:00Z', end: '2026-11-10T00:00:00Z' }
  const leads = [
    lead({ id: '1', value: 100000, source: 'whatsapp', assigned_to: ME, created_at: '2026-11-02T00:00:00Z' }),
    lead({ id: '2', value: 50000, source: 'referral', assigned_to: RAVI, created_at: '2026-10-01T00:00:00Z', next_follow_up_at: '2026-11-01T00:00:00Z' }),
    lead({ id: '3', value: 80000, status: 'won', source: 'whatsapp', assigned_to: ME, created_at: '2026-11-01T00:00:00Z', won_at: '2026-11-05T00:00:00Z' }),
    lead({ id: '4', value: 20000, status: 'won', source: 'website', assigned_to: RAVI, created_at: '2026-10-20T00:00:00Z', won_at: '2026-11-04T00:00:00Z' }),
    lead({ id: '5', value: 30000, status: 'lost', source: 'website', assigned_to: RAVI, created_at: '2026-11-03T00:00:00Z', lost_at: '2026-11-06T00:00:00Z', won_lost_reason: 'Price too high: wanted 20% off' }),
    lead({ id: '6', value: 99999, status: 'won', source: 'whatsapp', assigned_to: ME, created_at: '2026-09-01T00:00:00Z', won_at: '2026-10-01T00:00:00Z' }), // won before the range
  ]
  const users = [{ id: ME, full_name: 'Teja' }, { id: RAVI, full_name: 'Ravi' }]
  const report = R.pipelineReport(leads, stages, users, range, NOW)
  assert.deepEqual(report.open, { count: 2, value: 150000 })
  assert.equal(report.created, 3)
  assert.deepEqual(report.won, { count: 2, value: 100000 })
  assert.equal(report.lost, 1)
  assert.equal(report.winRate, 67)
  assert.equal(report.averageDeal, 50000)
  assert.equal(report.averageDaysToClose, (4 + 15) / 2)
  assert.deepEqual(report.followUps, { overdue: 1, today: 0 })
  assert.deepEqual(report.byStage.map((s) => [s.name, s.count, s.value]), [['New lead', 2, 150000], ['Contacted', 0, 0]])
  assert.deepEqual(report.bySource.map((s) => [s.label, s.created, s.won, s.wonValue]), [['WhatsApp', 2, 1, 80000], ['Website', 1, 1, 20000]])
  const ravi = report.byOwner.find((o) => o.name === 'Ravi')
  assert.deepEqual([ravi.open, ravi.openValue, ravi.won, ravi.wonValue, ravi.lost, ravi.winRate], [1, 50000, 1, 20000, 1, 50])
  assert.deepEqual(report.lostReasons, [{ reason: 'Price too high', count: 1 }])
  const empty = R.pipelineReport([], stages, users, range, NOW)
  assert.equal(empty.winRate, null)
  assert.equal(empty.averageDeal, null)
})

// ── Connector ───────────────────────────────────────────────────────────────

test('Connector: Sales Pipeline is on unless switched off, and its columns set themselves up', async () => {
  assert.equal(C.isConnectorOn({}, 'pipeline'), true)
  assert.equal(C.isConnectorOn({ enable_pipeline: false }, 'pipeline'), false)
  assert.ok(C.CONNECTORS.some((c) => c.key === 'pipeline' && c.href === '/dashboard/leads'))
  assert.deepEqual(C.withConnector(['salon'], 'pipeline', true), ['salon']) // its switch is a column, not the list
  assert.match(PIPELINE_SQL, /enable_pipeline BOOLEAN NOT NULL DEFAULT TRUE/)
  assert.match(PIPELINE_SQL, /next_follow_up_at TIMESTAMPTZ/)
  assert.equal(isMissingPipelineSchema({ code: '42703', message: 'column leads.next_follow_up_at does not exist' }), true)
  assert.equal(isMissingPipelineSchema({ message: 'Could not find the next_follow_up_at column' }), true)
  assert.equal(isMissingPipelineSchema({ code: '23505', message: 'duplicate key' }), false)
  let calls = 0, ensured = 0
  const result = await withPipelineSchema(async () => (++calls === 1 ? { error: { code: '42703', message: 'column leads.next_follow_up_at does not exist' } } : { data: 'ok', error: null }), { ensure: async () => { ensured++; return true } })
  assert.deepEqual([result.data, calls, ensured], ['ok', 2, 1])
})

// ── Storage ─────────────────────────────────────────────────────────────────

function pipelineDb() {
  return salonDb({
    pipeline_stages: [
      { id: STAGE(1), organization_id: ORG, name: 'New lead', position: 1 },
      { id: STAGE(2), organization_id: ORG, name: 'Contacted', position: 2 },
      { id: STAGE(9), organization_id: OTHER, name: 'Theirs', position: 1 },
    ],
    users: [{ id: ME, organization_id: ORG, full_name: 'Teja' }, { id: RAVI, organization_id: ORG, full_name: 'Ravi' }],
    contacts: [{ id: 'c0000000-0000-4000-8000-000000000001', organization_id: ORG, first_name: 'Rahul', last_name: 'Mehta', company: 'Mehta Exports', phone_number: '+919849010000', whatsapp_number: 'whatsapp:+919849010000' }],
    leads: [], lead_activities: [],
  })
}
const manager = (db) => ({ db, organizationId: ORG, userId: ME, seeAll: true, canAssign: true })
const employee = (db) => ({ db, organizationId: ORG, userId: RAVI, seeAll: false, canAssign: false })

test('New deal: an existing contact is found by number; a new one is saved to Contacts (tagged Sales)', async () => {
  const db = pipelineDb()
  const found = await S.resolveContact(manager(db), { contact: { name: 'Someone', phone: '98490 10000' } })
  assert.equal(found.id, 'c0000000-0000-4000-8000-000000000001')
  const made = await S.resolveContact(manager(db), { contact: { name: 'Kiran Rao', phone: '9000012345', company: 'KR School' } })
  const saved = db.tables.contacts.find((c) => c.id === made.id)
  assert.deepEqual([saved.first_name, saved.last_name, saved.phone_number, saved.whatsapp_number, saved.company, saved.tags], ['Kiran', 'Rao', '+919000012345', 'whatsapp:+919000012345', 'KR School', ['Sales']])
  assert.equal((await S.resolveContact(manager(db), { contact: {} })).field, 'contact')
  assert.equal((await S.resolveContact(manager(db), { contact: { phone: '12' } })).field, 'contact.phone')
  assert.equal((await S.resolveContact(manager(db), { contact_id: 'c0000000-0000-4000-8000-00000000dead' })).field, 'contact_id')
})

test('New deal: first stage by default, history noted; a salesperson always owns what they create', async () => {
  const db = pipelineDb()
  const contactId = 'c0000000-0000-4000-8000-000000000001'
  const mine = await S.createLead(manager(db), { title: 'Bulk order', value: 85000, contactId })
  assert.equal(mine.lead.pipeline_stage_id, STAGE(1))
  assert.equal(mine.lead.assigned_to, ME)
  assert.equal(mine.lead.contact.name, 'Rahul Mehta')
  assert.equal(db.tables.lead_activities[0].activity_type, 'creation')
  const given = await S.createLead(manager(db), { title: 'For Ravi', contactId, assigned_to: RAVI, pipeline_stage_id: STAGE(2) })
  assert.equal(given.lead.assigned_to, RAVI)
  const theirs = await S.createLead(employee(db), { title: 'Ravi tries to give it away', contactId, assigned_to: ME })
  assert.equal(theirs.lead.assigned_to, RAVI)
  assert.equal((await S.createLead(manager(db), { title: 'x', contactId, pipeline_stage_id: STAGE(9) })).field, 'pipeline_stage_id')
  assert.equal((await S.createLead(manager(db), { title: 'x', contactId, assigned_to: 'cccccccc-0000-4000-8000-000000000009' })).field, 'assigned_to')
})

test('Changing a deal: moves, owners, follow-ups and outcomes are noted; lost needs a reason; closing clears the follow-up', async () => {
  const db = pipelineDb()
  const actor = manager(db)
  const stageNames = new Map([[STAGE(1), 'New lead'], [STAGE(2), 'Contacted']])
  const userNames = new Map([[ME, 'Teja'], [RAVI, 'Ravi']])
  const { lead } = await S.createLead(actor, { title: 'Deal', contactId: 'c0000000-0000-4000-8000-000000000001', next_follow_up_at: '2026-11-10T05:00:00.000Z' })
  let current = (await S.updateLead(actor, lead, { pipeline_stage_id: STAGE(2), assigned_to: RAVI }, stageNames, userNames)).lead
  assert.deepEqual([current.pipeline_stage_id, current.assigned_to], [STAGE(2), RAVI])
  // The same follow-up written another way is no change
  current = (await S.updateLead(actor, current, { next_follow_up_at: '2026-11-10T05:00:00+00:00' }, stageNames, userNames)).lead
  assert.equal((await S.updateLead(actor, current, { status: 'lost' }, stageNames, userNames)).field, 'reason')
  current = (await S.updateLead(actor, current, { status: 'lost', reason: 'No budget' }, stageNames, userNames)).lead
  assert.deepEqual([current.status, current.won_lost_reason, current.next_follow_up_at, Boolean(current.lost_at)], ['lost', 'No budget', null, true])
  current = (await S.updateLead(actor, current, { status: 'active' }, stageNames, userNames)).lead
  assert.deepEqual([current.status, current.won_lost_reason, current.lost_at], ['active', null, null])
  current = (await S.updateLead(actor, current, { status: 'won' }, stageNames, userNames)).lead
  assert.equal(current.status, 'won')
  const history = await S.leadHistory(actor, lead.id)
  assert.deepEqual(history.map((h) => h.content).reverse(), ['Deal created', 'Moved to Contacted', 'Given to Ravi', 'Lost: No budget', 'Reopened', 'Won'])
  assert.equal(history[0].by, 'Teja')
  // A salesperson cannot give a deal away
  assert.equal((await S.updateLead(employee(db), current, { assigned_to: ME }, stageNames, userNames)).field, 'assigned_to')
})

test('Notes and calls: saved in the history, with the next follow-up', async () => {
  const db = pipelineDb()
  const actor = manager(db)
  const { lead } = await S.createLead(actor, { title: 'Deal', contactId: 'c0000000-0000-4000-8000-000000000001' })
  const saved = await S.addActivity(actor, lead, { type: 'call', content: 'Wants samples', next_follow_up_at: '2026-11-12T05:00:00.000Z' })
  assert.equal(saved.next_follow_up_at, '2026-11-12T05:00:00.000Z')
  const history = await S.leadHistory(actor, lead.id)
  assert.deepEqual(history.map((h) => h.type).sort(), ['call', 'creation', 'follow_up'])
  assert.match(history.find((h) => h.type === 'follow_up').content, /^Follow up Thu, 12 Nov/)
  assert.equal(S.followUpNote(null), 'Follow-up cleared')
  assert.equal(S.sameMoment('2026-11-12T05:00:00.000Z', '2026-11-12T05:00:00+00:00'), true)
  assert.equal(S.sameMoment(null, undefined), true)
  assert.equal(S.sameMoment(null, '2026-11-12T05:00:00Z'), false)
})

test('Listing deals: a salesperson sees only their own; search by name, deal or number; follow-ups due', async () => {
  const db = pipelineDb()
  const contactId = 'c0000000-0000-4000-8000-000000000001'
  const yesterday = new Date(Date.now() - 86400e3).toISOString()
  const nextWeek = new Date(Date.now() + 7 * 86400e3).toISOString()
  await S.createLead(manager(db), { title: 'Teja deal', contactId, next_follow_up_at: yesterday })
  await S.createLead(manager(db), { title: 'Ravi deal', contactId, assigned_to: RAVI, next_follow_up_at: nextWeek })
  await S.createLead(manager(db), { title: 'Nobody deal', contactId, assigned_to: null })
  db.tables.leads.push({ id: 'dddddddd-0000-4000-8000-000000000001', organization_id: OTHER, title: 'Other workspace', status: 'active' })
  const page = { limit: 50, offset: 0 }
  assert.equal((await S.listLeads(manager(db), {}, page)).length, 3)
  assert.deepEqual((await S.listLeads(employee(db), {}, page)).map((l) => l.title), ['Ravi deal'])
  assert.deepEqual((await S.listLeads(manager(db), { owner: 'none' }, page)).map((l) => l.title), ['Nobody deal'])
  assert.deepEqual((await S.listLeads(manager(db), { owner: 'me' }, page)).map((l) => l.title), ['Teja deal'])
  assert.deepEqual((await S.listLeads(manager(db), { follow: 'due' }, page)).map((l) => l.title), ['Teja deal'])
  assert.deepEqual((await S.listLeads(manager(db), { follow: 'upcoming' }, page)).map((l) => l.title), ['Ravi deal'])
  assert.equal((await S.listLeads(manager(db), { q: 'nobody' }, page)).length, 1)
  assert.equal((await S.listLeads(manager(db), { q: '9849010000' }, page)).length, 3) // the contact's number
  assert.equal((await S.listLeads(manager(db), { q: 'Mehta' }, page)).length, 3) // the contact's name
  await assert.rejects(S.listLeads(manager(db), { status: 'deleted' }, page), /Unknown status/)
  assert.equal(await S.findLead(employee(db), db.tables.leads[0].id), null)
  assert.deepEqual(await S.pipelineCounts(manager(db)), { open: 3, overdue: 1, today: 0 })
})

test('Stages: the default ones are made the first time a workspace has none', async () => {
  const db = salonDb({ pipeline_stages: [] })
  const made = await S.loadStages(db, ORG)
  assert.deepEqual(made.map((s) => s.name), R.DEFAULT_STAGES)
  assert.equal((await S.loadStages(db, ORG)).length, R.DEFAULT_STAGES.length)
  assert.deepEqual(await S.loadStages(salonDb({}), ORG, false), [])
})

// ── Public API ──────────────────────────────────────────────────────────────

test('Public API deals: stage by id or name, hot/warm/cold, open/won/lost, owner_id; checked like the screens', () => {
  const L = require('../lib/public-api/leads.ts')
  const list = [{ id: STAGE(1), name: 'New lead', position: 1 }, { id: STAGE(2), name: 'Proposal sent', position: 2 }]
  const ok = L.parseApiLead({ title: 'Shirts', stage: 'proposal SENT', priority: 'Hot', owner_id: RAVI, value: '85,000', pipeline_stage_id: STAGE(1) }, list, false)
  assert.deepEqual(ok.value, { title: 'Shirts', pipeline_stage_id: STAGE(2), priority: 'high', assigned_to: RAVI, value: 85000 })
  assert.equal(L.parseApiLead({ title: 'x', stage: 'Nowhere' }, list, false).field, 'stage')
  assert.equal(L.parseApiLead({ title: 'x', stage_id: STAGE(9) }, list, false).field, 'stage_id')
  assert.equal(L.parseApiLead({ title: 'x', priority: 'urgent' }, list, false).field, 'priority')
  assert.equal(L.parseApiLead({ title: 'x', owner_id: 'bob' }, list, false).field, 'owner_id')
  assert.equal(L.parseApiLead({ status: 'closed' }, list, true).field, 'status')
  assert.deepEqual(L.parseApiLead({ status: 'lost', reason: 'No budget' }, list, true).value, { status: 'lost', reason: 'No budget' })
  assert.deepEqual(L.parseApiLead({ status: 'open' }, list, true).value, { status: 'active', reason: null })
  assert.equal(L.parseApiLead({}, list, false).field, 'title')
})

test('Public API deals: the shape sent back, and a clear refusal when the pipeline is switched off', async () => {
  const L = require('../lib/public-api/leads.ts')
  const row = { id: 'd1', title: 'Shirts', value: '85000.00', status: 'active', priority: 'high', source: 'api', pipeline_stage_id: STAGE(1), assigned_to: RAVI, contact: { id: 'c1', name: 'Rahul Mehta', phone: '+919849010000', whatsapp: '+919849010000', email: null, company: 'Mehta Exports' }, created_at: '2026-11-08T10:00:00Z' }
  const out = L.toApiLead(row, [{ id: STAGE(1), name: 'New lead' }], [{ id: RAVI, full_name: 'Ravi Kumar' }], 'INR')
  assert.deepEqual([out.value, out.currency, out.status, out.priority, out.stage, out.owner, out.contact.company], [85000, 'INR', 'open', 'hot', { id: STAGE(1), name: 'New lead' }, { id: RAVI, name: 'Ravi Kumar' }, 'Mehta Exports'])
  assert.equal(L.toApiLead({ ...row, value: null, assigned_to: null, status: 'lost' }, [], [], 'INR').stage, null)
  assert.equal(L.pipelineOff({}), null)
  const off = L.pipelineOff({ enable_pipeline: false })
  assert.equal(off.status, 403)
  assert.equal((await off.json()).error.code, 'pipeline_off')
  const actor = L.apiActor({ db: {}, organizationId: ORG })
  assert.deepEqual([actor.userId, actor.seeAll, actor.canAssign], [null, true, true])
})

test('Public API docs: the deal endpoints and their permissions are documented', () => {
  const SP = require('../lib/public-api/spec.ts')
  const { ALL_SCOPES } = require('../lib/public-api/scopes.ts')
  assert.ok(ALL_SCOPES.includes('leads:read') && ALL_SCOPES.includes('leads:write'))
  const group = SP.API_GROUPS.find((g) => g.id === 'leads')
  assert.deepEqual(group.endpoints.map((e) => `${e.method} ${e.path}`), ['GET /pipeline-stages', 'GET /leads', 'POST /leads', 'GET /leads/{id}', 'PATCH /leads/{id}', 'POST /leads/{id}/activities'])
  assert.ok(SP.ERROR_CODES.some((e) => e.code === 'pipeline_off'))
  const spec = SP.openApiSpec('https://app.example.in')
  assert.ok(spec.paths['/leads'].post.requestBody && spec.paths['/leads/{id}'].patch)
})
