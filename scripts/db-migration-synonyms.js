/**
 * Migration: Add service_synonyms column to organizations table
 * using PostgreSQL client and pre-seed Consularhelpdesk org with synonym dictionary.
 * 
 * Run: node scripts/db-migration-synonyms.js
 */

const { Client } = require('pg')
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

// Load environment variables
let envContent = ''
try {
  envContent = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8')
} catch (e) {
  try {
    envContent = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  } catch (err) {
    console.error('Missing .env or .env.local file')
    process.exit(1)
  }
}

const env = {}
envContent.split('\n').forEach((line) => {
  const match = line.match(/^([^=]+)=\s*'?(.*?)'?\s*$/)
  if (match) env[match[1].trim()] = match[2]
})

// Setup PostgreSQL client
const POSTGRES_URL = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL || env.DATABASE_URL
if (!POSTGRES_URL) {
  console.error('Missing PostgreSQL connection string (POSTGRES_URL_NON_POOLING or DATABASE_URL)')
  process.exit(1)
}

const pgClient = new Client({
  connectionString: POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
})

// Setup Supabase client
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase env vars (NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

const SYNONYM_DICTIONARY = [
  {
    canonical: "PCC",
    aliases: [
      "Police Clearance Certificate",
      "Police Clearance",
      "Police Clearance Check",
      "Police Clearance Letter",
      "Police Check",
      "Police Verification",
      "Police Certificate",
      "Indian PCC",
      "Indian Police Clearance Certificate",
      "Indian Police Certificate",
      "Indian Police Check",
      "Clearance Certificate",
      "Background Clearance",
      "Background Check Certificate",
      "Criminal Record Certificate",
      "Character Certificate"
    ]
  },
  {
    canonical: "OCI",
    aliases: [
      "OCI Card",
      "Indian OCI",
      "Indian OCI Card",
      "OCI Application",
      "Apply OCI",
      "OCI Registration",
      "Overseas Citizen of India",
      "Overseas Citizenship of India",
      "OCI Booklet",
      "OCI Document",
      "OCI Card Canada",
      "Indian OCI Canada",
      "New OCI",
      "Fresh OCI",
      "Adult OCI",
      "Minor OCI",
      "Child OCI"
    ]
  },
  {
    canonical: "Passport Renewal",
    aliases: [
      "Renew Passport",
      "Renew my Passport",
      "Renew Indian Passport",
      "Indian Passport Renewal",
      "Passport Extension",
      "Extend Passport",
      "New Passport",
      "Reissue Passport",
      "Passport Reissue",
      "Expired Passport",
      "Passport Expired",
      "Passport About to Expire",
      "Renew Adult Passport",
      "Adult Passport Renewal",
      "Minor Passport Renewal",
      "Child Passport Renewal",
      "Kid Passport Renewal"
    ]
  },
  {
    canonical: "Passport Surrender",
    aliases: [
      "Surrender Passport",
      "Indian Passport Surrender",
      "Surrender Indian Passport",
      "Renunciation",
      "Renounce Indian Citizenship",
      "Renunciation Certificate",
      "Passport Cancellation",
      "Cancel Indian Passport",
      "Indian Passport Cancel",
      "Surrender Certificate",
      "Indian Citizenship Renunciation",
      "Passport Surrender Certificate",
      "PPT Surr",
      "PPT Surrender",
      "PPT Cancel"
    ]
  },
  {
    canonical: "Damaged OCI Card",
    aliases: [
      "Damaged OCI",
      "OCI Card Damaged",
      "Broken OCI Card",
      "Damaged OCI Document",
      "OCI Card Replacement",
      "Replace OCI Card",
      "OCI Reissue"
    ]
  }
]

async function run() {
  console.log('=== Synonym Dictionary Migration ===\n')

  try {
    // Step 1: Add service_synonyms column via direct PostgreSQL query
    console.log('Step 1: Connecting to PostgreSQL database...')
    await pgClient.connect()
    console.log('  ✅ Connected successfully')

    console.log('Step 2: Checking if service_synonyms column exists in organizations...')
    const checkColRes = await pgClient.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='organizations' AND column_name='service_synonyms';
    `)

    if (checkColRes.rows.length === 0) {
      console.log('  Column does not exist. Adding service_synonyms column...')
      await pgClient.query(`
        ALTER TABLE public.organizations 
        ADD COLUMN service_synonyms JSONB DEFAULT '[]';
      `)
      console.log('  ✅ Column service_synonyms added to organizations!')
    } else {
      console.log('  ✅ Column service_synonyms already exists.')
    }
  } catch (err) {
    console.error('  ❌ PostgreSQL error:', err.message)
    console.log('\n  👉 Attempting to continue in case column already exists...')
  } finally {
    try {
      await pgClient.end()
    } catch (e) {}
  }

  // Step 3: Fetch organizations and seed synonyms
  console.log('\nStep 3: Fetching organizations via Supabase client...')
  const { data: orgs, error: orgsError } = await supabase
    .from('organizations')
    .select('id, name, slug')

  if (orgsError) {
    console.error('  ❌ Failed to fetch organizations:', orgsError.message)
    process.exit(1)
  }

  console.log(`  Found ${orgs.length} organization(s)`)

  for (const org of orgs) {
    console.log(`\nStep 4: Seeding synonyms for "${org.name}" (${org.id})...`)
    
    const { error: updateError } = await supabase
      .from('organizations')
      .update({ service_synonyms: SYNONYM_DICTIONARY })
      .eq('id', org.id)

    if (updateError) {
      console.error(`  ❌ Failed to update org "${org.name}":`, updateError.message)
    } else {
      console.log(`  ✅ Seeded ${SYNONYM_DICTIONARY.length} synonym groups (${SYNONYM_DICTIONARY.reduce((sum, g) => sum + g.aliases.length, 0)} total aliases)`)
    }
  }

  console.log('\n=== Migration Complete ===')
  console.log('Synonym dictionary has been stored. The query expansion will now work automatically.')
}

run().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
