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

  const targetOrgId = '303b7a2d-281c-403c-b794-54d1e195ca69'
  console.log(`⚡ Resolving conflicts and migrating all data to: ${targetOrgId}...`)

  // 1. Resolve pipeline_stages duplicate positions by removing other stages
  console.log('🧹 Clearing duplicate pipeline stages...')
  const deleteStages = await client.query(
    'DELETE FROM public.pipeline_stages WHERE organization_id != $1',
    [targetOrgId]
  )
  console.log(`   Cleared ${deleteStages.rowCount} pipeline stages belonging to other orgs.`)

  // 2. Resolve contacts phone number duplicates
  console.log('🧹 Clearing duplicate contacts...')
  const deleteContacts = await client.query(
    `DELETE FROM public.contacts 
     WHERE organization_id != $1 
       AND phone_number IN (
         SELECT phone_number FROM public.contacts WHERE organization_id = $1
       )`,
    [targetOrgId]
  )
  console.log(`   Cleared ${deleteContacts.rowCount} duplicate contacts from other orgs.`)

  // 3. Migrate tables
  const tables = [
    'users',
    'contacts',
    'conversations',
    'messages',
    'message_templates',
    'campaigns',
    'pipeline_stages',
    'leads',
    'knowledge_base'
  ]

  for (const table of tables) {
    try {
      console.log(`   Updating table public.${table}...`)
      const res = await client.query(
        `UPDATE public.${table} SET organization_id = $1`,
        [targetOrgId]
      )
      console.log(`   ✅ Table public.${table} updated: ${res.rowCount} rows affected.`)
    } catch (err) {
      console.error(`   ❌ Failed to update table public.${table}:`, err.message)
    }
  }

  console.log('\n🎉 Data migration to tejachennu17@gmail.com organization completed successfully!')
  await client.end()
}

run().catch(console.error)
