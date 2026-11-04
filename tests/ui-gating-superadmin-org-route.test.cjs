// The super admin's organization switches (PUT /api/superadmin/organizations/[id]): the Flow
// Builder switch (enable_flows) is accepted, and a database that has not had its migration yet
// gets a clear answer instead of a server error. Against a fake database; nothing here reaches
// the network or a real database.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const ORG = '44444444-4444-4444-8444-444444444444'
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

let row = {}
let missingColumn = null
let updates = []
const fakeDb = {
  from() {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row, error: null }),
          neq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      }),
      update: (values) => ({
        eq: () => ({
          select: () => ({
            single: async () => {
              if (missingColumn && missingColumn.column in values) return { data: null, error: missingColumn.error }
              updates.push(values)
              row = { ...row, ...values }
              return { data: row, error: null }
            },
          }),
        }),
      }),
    }
  },
}
stub(path.join(PROJECT, 'lib/superadmin-auth.ts'), { checkSuperAdmin: async () => ({ id: 'admin-1', role: 'super_admin', organization_id: 'master-org' }), getSupabaseAdminClient: () => fakeDb })
console.error = () => {}

const route = require(path.join(PROJECT, 'app/api/superadmin/organizations/[id]/route.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))

async function put(body) {
  const request = new NextRequest(`https://wamacrm.example.com/api/superadmin/organizations/${ORG}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const res = await route.PUT(request, { params: Promise.resolve({ id: ORG }) })
  return { status: res.status, ...(await res.json()) }
}

function reset() {
  row = { id: ORG, name: 'Acme Stores', slug: 'acme-stores', enable_messages: true, enable_flows: true }
  missingColumn = null
  updates = []
}

test('Superadmin organization: the Flow Builder switch is saved like the other feature switches', async () => {
  reset()
  const answer = await put({ enable_flows: false })
  assert.equal(answer.status, 200)
  assert.deepEqual(updates, [{ enable_flows: false }])
  assert.equal(answer.organization.enable_flows, false)

  // Back on, together with another switch; fields the route does not know are dropped
  const again = await put({ enable_flows: true, enable_messages: false, role: 'super_admin' })
  assert.equal(again.status, 200)
  assert.deepEqual(updates[1], { enable_flows: true, enable_messages: false })
  assert.equal((await put({ role: 'super_admin' })).status, 400)
})

test('Superadmin organization: before the enable_flows migration the toggle says which migration is missing', async () => {
  reset()
  // PGRST204: the column is missing from PostgREST's schema cache (what a write reports)
  missingColumn = { column: 'enable_flows', error: { code: 'PGRST204', message: "Could not find the 'enable_flows' column of 'organizations' in the schema cache" } }
  const answer = await put({ enable_flows: false })
  assert.equal(answer.status, 400)
  assert.equal(answer.error, 'Apply the enable_flows migration first')
  assert.deepEqual(updates, [], 'nothing saved')

  // 42703: undefined column, as Postgres itself reports it
  missingColumn = { column: 'enable_flows', error: { code: '42703', message: 'column "enable_flows" of relation "organizations" does not exist' } }
  assert.equal((await put({ enable_flows: true })).status, 400)

  // The other switches keep working on that database
  const other = await put({ enable_ai: false })
  assert.equal(other.status, 200)
  assert.deepEqual(updates, [{ enable_ai: false }])
})

test('Superadmin organization: any other database error is still a server error', async () => {
  reset()
  missingColumn = { column: 'enable_flows', error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
  const answer = await put({ enable_flows: false })
  assert.equal(answer.status, 500)
})
