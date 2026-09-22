const { Client } = require('pg')
const fs = require('fs')
const path = require('path')
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let envContent = ''
try {
  envContent = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8')
} catch (e) {
  try {
    envContent = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  } catch (e2) {}
}

const env = {}
if (envContent) {
  envContent.split('\n').forEach((line) => {
    const match = line.match(/^([^=]+)=\s*'?(.*?)'?\s*$/)
    if (match) env[match[1].trim()] = match[2]
  })
}

const POSTGRES_URL = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL || env.DATABASE_URL
if (!POSTGRES_URL) {
  console.error('❌ No POSTGRES_URL found in environment.')
  process.exit(1)
}

const client = new Client({
  connectionString: POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
})

async function run() {
  try {
    await client.connect()
    console.log('✅ Connected to database')

    console.log('1. Adding scheduled_at column and index to campaigns...')
    await client.query(`
      ALTER TABLE public.campaigns 
      ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

      CREATE INDEX IF NOT EXISTS idx_campaigns_scheduled_at 
      ON public.campaigns(scheduled_at) 
      WHERE status = 'SCHEDULED';
    `)
    console.log('   ✅ scheduled_at & index applied.')

    console.log('2. Adding template_language column to campaigns...')
    await client.query(`
      ALTER TABLE public.campaigns 
      ADD COLUMN IF NOT EXISTS template_language VARCHAR(20) DEFAULT 'en';
    `)
    console.log('   ✅ template_language applied.')

    console.log('3. Verifying contacts tags column...')
    await client.query(`
      ALTER TABLE public.contacts 
      ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

      CREATE INDEX IF NOT EXISTS idx_contacts_tags 
      ON public.contacts USING GIN (tags);
    `)
    console.log('   ✅ contacts tags applied.')

    console.log('\n--- VERIFYING CAMPAIGNS COLUMNS ---')
    const cols = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'campaigns'
      ORDER BY ordinal_position;
    `)
    console.table(cols.rows)

  } catch (err) {
    console.error('❌ Migration error:', err)
  } finally {
    await client.end()
  }
}

run()
