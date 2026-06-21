const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

// Load .env
const envPath = path.join(__dirname, '..', '.env')
const envContent = fs.readFileSync(envPath, 'utf8')
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
  console.log('🔌 Connecting to database...')
  const cleanUrl = POSTGRES_URL.replace(/[?&]sslmode=[^&]*/g, '').replace(/[?&]supa=[^&]*/g, '')
  const client = new Client({
    connectionString: cleanUrl,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  console.log('✅ Connected\n')

  // 1. Add new columns to leads table
  console.log('🛠️ Adding new columns to leads table...')
  
  const columns = [
    { name: 'status', sql: "ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'" },
    { name: 'source', sql: "ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'other'" },
    { name: 'expected_close_date', sql: "ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS expected_close_date DATE" },
    { name: 'notes', sql: "ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''" },
    { name: 'product_service', sql: "ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS product_service TEXT DEFAULT ''" },
    { name: 'won_lost_reason', sql: "ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS won_lost_reason TEXT DEFAULT ''" },
    { name: 'last_activity_at', sql: "ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT now()" },
    { name: 'won_at', sql: "ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS won_at TIMESTAMPTZ" },
    { name: 'lost_at', sql: "ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS lost_at TIMESTAMPTZ" },
  ]

  for (const col of columns) {
    await client.query(col.sql)
    console.log(`   ✅ Column '${col.name}' ready`)
  }

  // 2. Update pipeline_stages with the 8 new stages
  console.log('\n🔄 Updating pipeline stages...')

  // Get the first organization_id from existing stages (or orgs table)
  const { rows: orgRows } = await client.query(`SELECT id FROM public.organizations LIMIT 1`)
  if (orgRows.length === 0) {
    console.log('   ⚠️ No organizations found. Skipping stage seeding.')
  } else {
    const orgId = orgRows[0].id

    // Delete old stages for this org
    await client.query(`DELETE FROM public.pipeline_stages WHERE organization_id = $1`, [orgId])
    console.log('   🗑️ Cleared old pipeline stages')

    const newStages = [
      { name: 'New Lead', color: '#6366f1', position: 1 },
      { name: 'Contacted', color: '#3b82f6', position: 2 },
      { name: 'Interested', color: '#06b6d4', position: 3 },
      { name: 'Qualified', color: '#10b981', position: 4 },
      { name: 'Proposal Sent', color: '#f59e0b', position: 5 },
      { name: 'Negotiation', color: '#f97316', position: 6 },
      { name: 'Follow-up', color: '#8b5cf6', position: 7 },
      { name: 'Demo/Meeting', color: '#ec4899', position: 8 },
    ]

    for (const stage of newStages) {
      await client.query(
        `INSERT INTO public.pipeline_stages (organization_id, name, color, position)
         VALUES ($1, $2, $3, $4)`,
        [orgId, stage.name, stage.color, stage.position]
      )
      console.log(`   ✅ Stage '${stage.name}' created`)
    }
  }

  // 3. Ensure RLS is disabled
  console.log('\n🔓 Ensuring RLS disabled on leads & pipeline_stages...')
  await client.query(`ALTER TABLE public.leads DISABLE ROW LEVEL SECURITY`)
  await client.query(`ALTER TABLE public.pipeline_stages DISABLE ROW LEVEL SECURITY`)
  await client.query(`GRANT ALL ON public.leads TO anon`)
  await client.query(`GRANT ALL ON public.leads TO authenticated`)
  await client.query(`GRANT ALL ON public.pipeline_stages TO anon`)
  await client.query(`GRANT ALL ON public.pipeline_stages TO authenticated`)
  console.log('   ✅ Done')

  await client.end()
  console.log('\n🎉 Migration v4 complete!')
}

run().catch((err) => {
  console.error('❌ Migration v4 failed:', err)
  process.exit(1)
})
