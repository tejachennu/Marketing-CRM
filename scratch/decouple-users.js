const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

const workspaceEnvPath = path.join(__dirname, '..', '.env')
const envContent = fs.readFileSync(workspaceEnvPath, 'utf8')
const env = {}
envContent.split('\n').forEach((line) => {
  const match = line.match(/^([^=]+)=\s*'?(.*?)'?\s*$/)
  if (match) env[match[1].trim()] = match[2]
})

const POSTGRES_URL = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL not found in .env')
  process.exit(1)
}

async function run() {
  const cleanUrl = POSTGRES_URL.replace(/[?&]sslmode=[^&]*/g, '').replace(/[?&]supa=[^&]*/g, '')
  const client = new Client({
    connectionString: cleanUrl,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  console.log('🔌 Connected to database')

  // Mappings to restore
  const userOrgMappings = [
    {
      email: 'tejachennu@blsindia-canada.ca',
      orgId: '6141c7e6-f64c-4ecd-9143-4e26bdca1e8b', // canada
    },
    {
      email: 'tejachennu17@gmail.com',
      orgId: '303b7a2d-281c-403c-b794-54d1e195ca69', // tejachennu17's Company
    },
    {
      email: 'demo-1781759633172@test.local',
      orgId: '0ed963d2-0dc3-4428-ba24-9a0a8aaa62dc', // Demo Company (demo-1781759633463)
    },
    {
      email: 'demo-1781760138020@test.local',
      orgId: '258c4615-c1e2-4abc-9e32-15883e84d6ba', // Demo Company (demo-1781760138337)
    },
    {
      email: 'demo-1781760200996@test.local',
      orgId: 'b3060e36-e630-4201-bd50-b7dac0682072', // Demo Company (demo-1781760201137)
    },
    {
      email: 'demo-1781760351331@test.local',
      orgId: '2d85480a-9e4d-4a61-8acd-725a4544c02c', // Demo Company (demo-1781760351501)
    }
  ]

  for (const mapping of userOrgMappings) {
    console.log(`⚡ Updating user ${mapping.email} to organization ${mapping.orgId}...`)
    const res = await client.query(
      'UPDATE public.users SET organization_id = $1 WHERE email = $2',
      [mapping.orgId, mapping.email]
    )
    console.log(`   ✅ Rows affected: ${res.rowCount}`)
  }

  // Check and insert default pipeline stages for the organizations if missing
  const targetOrgs = [
    '6141c7e6-f64c-4ecd-9143-4e26bdca1e8b', // canada
    '0ed963d2-0dc3-4428-ba24-9a0a8aaa62dc',
    '258c4615-c1e2-4abc-9e32-15883e84d6ba',
    'b3060e36-e630-4201-bd50-b7dac0682072',
    '2d85480a-9e4d-4a61-8acd-725a4544c02c'
  ]

  const defaultStages = [
    { name: 'New', color: '#6366f1', position: 1 },
    { name: 'Contacted', color: '#8b5cf6', position: 2 },
    { name: 'Qualified', color: '#ec4899', position: 3 },
    { name: 'Negotiating', color: '#f59e0b', position: 4 },
    { name: 'Closed Won', color: '#10b981', position: 5 },
  ]

  for (const orgId of targetOrgs) {
    const { rows: stages } = await client.query(
      'SELECT id FROM public.pipeline_stages WHERE organization_id = $1',
      [orgId]
    )
    if (stages.length === 0) {
      console.log(`🛠️ Inserting default pipeline stages for organization ${orgId}...`)
      for (const stage of defaultStages) {
        await client.query(
          'INSERT INTO public.pipeline_stages (organization_id, name, color, position) VALUES ($1, $2, $3, $4)',
          [orgId, stage.name, stage.color, stage.position]
        )
      }
      console.log(`   ✅ Inserted 5 pipeline stages.`)
    } else {
      console.log(`ℹ️ Pipeline stages already exist for organization ${orgId}.`)
    }
  }

  // Print updated user list
  const { rows: updatedUsers } = await client.query('SELECT id, email, organization_id, full_name FROM public.users')
  console.log('\n📋 Updated users mapping in db:')
  console.log(updatedUsers)

  await client.end()
}

run().catch(console.error)
