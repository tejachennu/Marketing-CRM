/**
 * disable-rls.js
 * 
 * One-time setup script to:
 * 1. Disable RLS on all application tables
 * 2. Drop existing RLS policies
 * 3. Enable Supabase Realtime on all tables
 * 
 * Run with: node scripts/disable-rls.js
 */

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

const TABLES = [
  'organizations',
  'users',
  'contacts',
  'conversations',
  'messages',
  'pipeline_stages',
  'leads',
]

async function run() {
  console.log('🔌 Connecting to database...')
  // Strip sslmode from URL - we handle SSL config separately
  const cleanUrl = POSTGRES_URL.replace(/[?&]sslmode=[^&]*/g, '').replace(/[?&]supa=[^&]*/g, '')
  console.log('   URL:', cleanUrl.replace(/:([^@]+)@/, ':****@'))
  const client = new Client({
    connectionString: cleanUrl,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  console.log('✅ Connected\n')

  // Step 1: Check which tables exist
  console.log('📋 Checking tables...')
  const { rows: existingTables } = await client.query(`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `)
  const tableNames = existingTables.map((r) => r.tablename)
  console.log('   Found tables:', tableNames.join(', '))

  const appTables = TABLES.filter((t) => tableNames.includes(t))
  console.log('   App tables:', appTables.join(', '), '\n')

  // Step 2: Disable RLS and drop all policies on each table
  for (const table of appTables) {
    console.log(`🔓 Processing table: ${table}`)

    // Get existing policies
    const { rows: policies } = await client.query(`
      SELECT policyname FROM pg_policies WHERE tablename = $1 AND schemaname = 'public'
    `, [table])

    if (policies.length > 0) {
      for (const policy of policies) {
        console.log(`   Dropping policy: ${policy.policyname}`)
        await client.query(`DROP POLICY IF EXISTS "${policy.policyname}" ON public."${table}"`)
      }
    }

    // Disable RLS
    await client.query(`ALTER TABLE public."${table}" DISABLE ROW LEVEL SECURITY`)
    console.log(`   ✅ RLS disabled`)

    // Grant full access to anon and authenticated roles
    await client.query(`GRANT ALL ON public."${table}" TO anon`)
    await client.query(`GRANT ALL ON public."${table}" TO authenticated`)
    console.log(`   ✅ Granted access to anon + authenticated`)
  }

  // Step 3: Enable Supabase Realtime on tables
  console.log('\n⚡ Enabling Supabase Realtime...')

  // First, check which tables are already in the publication
  const { rows: pubTables } = await client.query(`
    SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
  `)
  const pubTableNames = pubTables.map((r) => r.tablename)
  console.log('   Currently in realtime publication:', pubTableNames.join(', ') || '(none)')

  const realtimeTables = ['contacts', 'conversations', 'messages']
  for (const table of realtimeTables) {
    if (!appTables.includes(table)) {
      console.log(`   ⚠️  Table ${table} not found, skipping`)
      continue
    }

    if (pubTableNames.includes(table)) {
      console.log(`   ✅ ${table} already in realtime publication`)
    } else {
      try {
        await client.query(`ALTER PUBLICATION supabase_realtime ADD TABLE public."${table}"`)
        console.log(`   ✅ Added ${table} to realtime publication`)
      } catch (err) {
        // If already added, ignore
        if (err.message.includes('already member')) {
          console.log(`   ✅ ${table} already in realtime publication`)
        } else {
          console.error(`   ❌ Error adding ${table}:`, err.message)
        }
      }
    }
  }

  // Step 4: Set REPLICA IDENTITY FULL for proper realtime (needed for UPDATE/DELETE events)
  console.log('\n🔧 Setting REPLICA IDENTITY FULL for realtime tables...')
  for (const table of realtimeTables) {
    if (!appTables.includes(table)) continue
    try {
      await client.query(`ALTER TABLE public."${table}" REPLICA IDENTITY FULL`)
      console.log(`   ✅ ${table} → REPLICA IDENTITY FULL`)
    } catch (err) {
      console.error(`   ❌ Error on ${table}:`, err.message)
    }
  }

  // Step 5: Verify
  console.log('\n📊 Verification:')
  for (const table of appTables) {
    const { rows } = await client.query(`
      SELECT relrowsecurity FROM pg_class WHERE relname = $1
    `, [table])
    const rlsEnabled = rows[0]?.relrowsecurity || false
    console.log(`   ${table}: RLS ${rlsEnabled ? '⚠️ ENABLED' : '✅ DISABLED'}`)
  }

  const { rows: finalPub } = await client.query(`
    SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
  `)
  console.log(`   Realtime publication: ${finalPub.map(r => r.tablename).join(', ')}`)

  await client.end()
  console.log('\n🎉 Done! RLS disabled, Realtime enabled.')
  console.log('   You can now use Supabase Realtime WebSockets with the anon key.')
}

run().catch((err) => {
  console.error('❌ Script failed:', err)
  process.exit(1)
})
